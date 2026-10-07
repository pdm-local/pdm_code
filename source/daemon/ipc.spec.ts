import {createConnection} from 'node:net';
import {statSync} from 'node:fs';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'ava';
import type {Subscription} from '@/events/types';
import {DaemonIpcClient, DaemonIpcServer} from './ipc';
import {resolveSocketPath} from './lockfile';

console.log(`\nipc.spec.ts`);

/**
 * A listenable IPC endpoint for this platform.
 *
 * Deliberately the production resolver rather than a hand-built
 * `<dir>/daemon.sock`: Windows cannot listen on a filesystem path at all, so a
 * literal .sock path fails with EACCES there and the whole suite reported the
 * daemon as broken when only the fixture was. The resolver returns a
 * `\\.\pipe\` name on Windows and a socket file elsewhere, and the unique
 * temp dir keeps each test in its own slot either way.
 */
const tempDirs: string[] = [];

async function makeSocketPath(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'ipc-spec-'));
	tempDirs.push(dir);
	const endpoint = resolveSocketPath(dir, process.platform, tmpdir());
	// A unix socket needs its directory to exist first, which the daemon does
	// for itself before listening. A Windows pipe name lives in a global
	// namespace and has no directory to create.
	if (!endpoint.startsWith('\\\\.\\pipe\\')) {
		await mkdir(dirname(endpoint), {recursive: true});
	}
	return endpoint;
}

// The endpoint is not always a file inside that directory (on Windows it is a
// pipe name in a global namespace), so the directory is tracked and removed
// here rather than derived from the endpoint path.
test.after.always(async () => {
	await Promise.all(
		tempDirs.map(dir => rm(dir, {recursive: true, force: true})),
	);
});

const SAMPLE_SUB: Subscription = {
	id: 'sub-1',
	kind: 'file.changed',
	target: {kind: 'agent', name: 'docs'},
	source: 'frontmatter',
	ownerSkill: 'docs',
	filter: {paths: ['docs/**']},
};

test.serial('ping/pong round-trips through the socket', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		t.is(await client.ping(), 'pong');
	} finally {
		await client.disconnect();
		await server.stop();
	}
});

test.serial('request rejects and releases the pending slot when write throws', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const internals = client as unknown as {
			socket: {write: (payload: string) => boolean};
			pending: Map<number, unknown>;
		};
		const write = internals.socket.write;
		internals.socket.write = () => {
			throw new Error('serialization failed');
		};

		try {
			await t.throwsAsync(client.ping(), {message: 'serialization failed'});
			t.is(internals.pending.size, 0);
		} finally {
			internals.socket.write = write;
		}
	} finally {
		await client.disconnect();
		await server.stop();
	}
});

test.serial('a closing socket rejects and drains every pending request', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const internals = client as unknown as {
			socket: {destroy: () => void};
			pending: Map<number, unknown>;
		};
		const inFlight = client.ping();
		internals.socket.destroy();

		await t.throwsAsync(inFlight, {message: 'IPC connection closed'});
		t.is(internals.pending.size, 0);
	} finally {
		await server.stop();
	}
});

test.serial('listSubscriptions returns server-side list', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [SAMPLE_SUB],
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const subs = await client.listSubscriptions();
		t.is(subs.length, 1);
		t.is(subs[0]?.id, 'sub-1');
	} finally {
		await client.disconnect();
		await server.stop();
	}
});

test.serial('unknown method returns an error response', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		// Sneak past the typed client - send a raw bad request
		const err = await t.throwsAsync(async () => {
			await (
				client as unknown as {
					request: (method: string) => Promise<unknown>;
				}
			).request('nonsense' as never);
		});
		t.regex(err?.message ?? '', /unknown method/);
	} finally {
		await client.disconnect();
		await server.stop();
	}
});

test.serial('invalid JSON returns {id:0, error:"invalid JSON"}', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	try {
		// Talk to the server with a raw socket so we can send garbage that
		// won't parse as JSON. The typed client would never produce this.
		const sock = createConnection(path);
		sock.setEncoding('utf-8');
		const got = await new Promise<string>((resolve, reject) => {
			sock.once('connect', () => sock.write('this is not json\n'));
			sock.once('data', d => resolve(String(d)));
			sock.once('error', reject);
		});
		t.regex(got, /"error":"invalid JSON"/);
		t.regex(got, /"id":0/);
		sock.destroy();
	} finally {
		await server.stop();
	}
});

test.serial('shutdown method calls server-side handler', async t => {
	const path = await makeSocketPath();
	let shutdownCalls = 0;
	const server = new DaemonIpcServer(path, {
		listSubscriptions: () => [],
		shutdown: () => {
			shutdownCalls++;
		},
	});
	await server.start();
	const client = new DaemonIpcClient(path);
	await client.connect();
	try {
		const ack = await client.shutdown();
		t.deepEqual(ack, {accepted: true});
		// Give the deferred shutdown callback a moment to run.
		await new Promise(r => setTimeout(r, 20));
		t.is(shutdownCalls, 1);
	} finally {
		await client.disconnect();
		await server.stop();
	}
});

test.serial(
	'shutdown method returns error when server has no handler',
	async t => {
		const path = await makeSocketPath();
		const server = new DaemonIpcServer(path, {
			listSubscriptions: () => [],
			// no shutdown handler
		});
		await server.start();
		const client = new DaemonIpcClient(path);
		await client.connect();
		try {
			const err = await t.throwsAsync(() => client.shutdown());
			t.regex(err?.message ?? '', /shutdown method not enabled/);
		} finally {
			await client.disconnect();
			await server.stop();
		}
	},
);

test.serial(
	'client disconnects mid-stream - server stays alive and accepts new connections',
	async t => {
		const path = await makeSocketPath();
		const server = new DaemonIpcServer(path, {
			listSubscriptions: () => [SAMPLE_SUB],
		});
		await server.start();
		try {
			// First client sends a partial request, then closes the socket
			// without giving the server a chance to respond.
			await new Promise<void>(resolve => {
				const sock = createConnection(path);
				sock.once('connect', () => {
					sock.write('{"id":5,"method":"pi');
					sock.destroy();
					resolve();
				});
			});

			// Give the server a tick to observe the close event.
			await new Promise(r => setTimeout(r, 50));

			// Second client should be able to connect and round-trip normally.
			const client = new DaemonIpcClient(path);
			await client.connect();
			try {
				t.is(await client.ping(), 'pong');
				const subs = await client.listSubscriptions();
				t.is(subs.length, 1);
			} finally {
				await client.disconnect();
			}
		} finally {
			await server.stop();
		}
	},
);

const posixTest = process.platform === 'win32' ? test.skip : test;

posixTest.serial('the socket is owner-only', async t => {
	const path = await makeSocketPath();
	const server = new DaemonIpcServer(path, {listSubscriptions: () => []});
	await server.start();
	try {
		t.is(statSync(path).mode & 0o777, 0o600);
	} finally {
		await server.stop();
	}
});
