/**
 * Find a model server on another device, and say why it could not be reached.
 *
 * PDM Code runs on every machine, but the models usually live on one box with a
 * GPU. Pointing a provider's `baseUrl` at that box already works; the missing
 * pieces are discovering the box without typing an address, and explaining the
 * one failure everybody hits, which is Ollama listening on loopback only.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from 'undici';
import {isBinaryOnPath} from '@/tools/git/utils';

const execFileAsync = promisify(execFile);

/** Ollama's fixed port. It is configurable, but never in practice. */
const OLLAMA_DEFAULT_PORT = 11434;

/** The mesh CLI is fast when up and hangs when confused, so bound it. */
const MESH_STATUS_TIMEOUT_MS = 3000;

/** A device on the user's private mesh network. */
export interface MeshDevice {
	hostname: string;
	/** An IPv4 mesh address. Never persisted: see AGENTS.md on device identifiers. */
	address: string;
	/** As the mesh reports it: linux, windows, macOS, iOS, android. */
	os: string;
	online: boolean;
	isSelf: boolean;
}

/**
 * Shape of `tailscale status --json`, narrowed to what we read. The CLI emits
 * far more; naming only these fields keeps us honest about the dependency.
 */
interface MeshStatus {
	BackendState?: string;
	Self?: MeshStatusNode;
	Peer?: Record<string, MeshStatusNode>;
}

interface MeshStatusNode {
	HostName?: string;
	TailscaleIPs?: string[];
	OS?: string;
	Online?: boolean;
}

/**
 * A phone cannot serve models, so it is noise in a "which device?" list. This
 * excludes only OSes known to be mobile rather than allow-listing desktops: an
 * unrecognised OS might well be a server, and hiding it would be worse than
 * showing one row too many.
 */
const MOBILE_OS = new Set(['ios', 'android', 'ipados', 'tvos']);

function isMobile(os: string): boolean {
	return MOBILE_OS.has(os.toLowerCase());
}

/** Among what remains, the usual suspects first. */
const DESKTOP_OS = new Set(['linux', 'windows', 'macos', 'darwin', 'freebsd']);

function isDesktop(os: string): boolean {
	return DESKTOP_OS.has(os.toLowerCase());
}

function firstIPv4(addresses: string[] | undefined): string | null {
	// TailscaleIPs lists IPv4 first, then IPv6. Prefer v4: it needs no bracket
	// quoting in a URL, and every Ollama build binds it.
	return addresses?.find(a => !a.includes(':')) ?? null;
}

function toMeshDevice(
	node: MeshStatusNode,
	isSelf: boolean,
): MeshDevice | null {
	const address = firstIPv4(node.TailscaleIPs);
	const hostname = node.HostName?.trim();
	if (!address || !hostname) return null;
	return {
		hostname,
		address,
		os: node.OS?.trim() || 'unknown',
		// Self has no Online flag; it is by definition up if the CLI answered.
		online: isSelf ? true : node.Online === true,
		isSelf,
	};
}

/**
 * Reads `tailscale status --json`, or null when it cannot be read.
 *
 * Split out so tests can supply canned output. Spawning a real CLI in the
 * suite would make it depend on the machine's mesh membership, and fixtures
 * must never carry a real device name or address anyway.
 */
async function readMeshStatus(): Promise<string | null> {
	// Never spawn the real CLI under test. Two reasons, both hard requirements:
	// a suite that reads this machine's mesh membership is not reproducible, and
	// real device names and addresses must never reach test output or a fixture.
	// Matches the NODE_ENV guard `loadAllProviderConfigs` uses for the same
	// isolation reason. Tests that want devices install a reader instead.
	if (process.env.NODE_ENV === 'test') return null;
	if (!isBinaryOnPath('tailscale')) return null;
	try {
		const {stdout} = await execFileAsync('tailscale', ['status', '--json'], {
			timeout: MESH_STATUS_TIMEOUT_MS,
			// A large tailnet's status is tens of KB; cap it rather than trust it.
			maxBuffer: 4 * 1024 * 1024,
		});
		return stdout;
	} catch {
		// Not installed after all, not logged in, or too slow. Either way the
		// caller falls back to entering an address by hand.
		return null;
	}
}

let statusReader = readMeshStatus;

/** Exposed for tests, which supply canned CLI output. */
export function __setMeshStatusReaderForTesting(
	reader: (() => Promise<string | null>) | null,
): void {
	statusReader = reader ?? readMeshStatus;
}

/**
 * Devices on the mesh that could plausibly serve models: online, not a phone,
 * desktops first.
 *
 * Returns an empty array when the CLI is absent, the mesh is down, or the
 * output is not what we expect. Never throws: this feeds a setup screen that
 * must still work for somebody who has no mesh at all.
 */
export async function listMeshDevices(): Promise<MeshDevice[]> {
	const raw = await statusReader();
	if (raw === null) return [];

	let status: MeshStatus;
	try {
		status = JSON.parse(raw) as MeshStatus;
	} catch {
		return [];
	}

	// Anything other than Running means addresses are stale or absent.
	if (status.BackendState !== 'Running') return [];

	const devices: MeshDevice[] = [];
	const self = status.Self ? toMeshDevice(status.Self, true) : null;
	if (self) devices.push(self);
	for (const peer of Object.values(status.Peer ?? {})) {
		const device = toMeshDevice(peer, false);
		if (device) devices.push(device);
	}

	return devices
		.filter(d => d.online && !isMobile(d.os))
		.sort((a, b) => {
			if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
			if (isDesktop(a.os) !== isDesktop(b.os)) return isDesktop(a.os) ? -1 : 1;
			return a.hostname.localeCompare(b.hostname);
		});
}

/** The provider `baseUrl` for an Ollama server at `address`. */
export function ollamaBaseUrl(address: string): string {
	return `http://${address}:${OLLAMA_DEFAULT_PORT}/v1`;
}

/**
 * Why a probe failed. `refused` is the one that matters: it means something is
 * listening on the host but not on the interface we asked for, which for Ollama
 * means it is bound to loopback and needs `OLLAMA_HOST` set. Collapsing that
 * into a generic failure is what makes remote setup feel broken.
 */
export type ReachFailure = 'refused' | 'timeout' | 'not-ollama' | 'unknown';

export type ProbeResult =
	| {ok: true; models: string[]}
	| {ok: false; reason: ReachFailure};

interface ProbeOptions {
	timeoutMs?: number;
}

/** Cross-network, so slower than the local `/api/show` probe's budget. */
const PROBE_TIMEOUT_MS = 4000;

/**
 * Classify a connection error. Node's `fetch` reports every transport problem
 * as `TypeError: fetch failed` and buries the cause, which is why this uses
 * undici directly rather than `fetchModels` from the provider wizard: that
 * helper flattens the error to a display string, and the code is the answer.
 */
function classify(error: unknown): ReachFailure {
	const code =
		typeof error === 'object' && error !== null
			? ((error as {code?: string}).code ??
				((error as {cause?: {code?: string}}).cause?.code as
					| string
					| undefined))
			: undefined;

	switch (code) {
		case 'ECONNREFUSED':
			return 'refused';
		case 'UND_ERR_CONNECT_TIMEOUT':
		case 'UND_ERR_HEADERS_TIMEOUT':
		case 'ETIMEDOUT':
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return 'timeout';
		default:
			break;
	}
	if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
	return 'unknown';
}

/**
 * Ask an Ollama server which models it has.
 *
 * Uses the native `/api/tags` rather than the OpenAI-compatible `/v1/models`
 * so that a server answering on the port but not speaking Ollama is reported
 * as `not-ollama` instead of appearing empty.
 */
export async function probeOllama(
	baseUrl: string,
	options: ProbeOptions = {},
): Promise<ProbeResult> {
	let origin: string;
	try {
		origin = new URL(baseUrl).origin;
	} catch {
		return {ok: false, reason: 'unknown'};
	}

	try {
		const response = await request(`${origin}/api/tags`, {
			method: 'GET',
			signal: AbortSignal.timeout(options.timeoutMs ?? PROBE_TIMEOUT_MS),
		});

		if (response.statusCode !== 200) {
			await response.body.dump();
			return {ok: false, reason: 'not-ollama'};
		}

		const body = (await response.body.json()) as {
			models?: Array<{name?: string}>;
		};
		if (!Array.isArray(body?.models)) return {ok: false, reason: 'not-ollama'};

		const models = body.models
			.map(m => m.name?.trim())
			.filter((n): n is string => !!n)
			.sort((a, b) => a.localeCompare(b));

		// Reachable and speaking Ollama, but nothing pulled yet. Still a success:
		// the address is right, and the user needs to hear that rather than a
		// connection error pointing them at the network.
		return {ok: true, models};
	} catch (error) {
		return {ok: false, reason: classify(error)};
	}
}
