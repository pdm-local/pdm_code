import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'ava';
import {
	__setMeshStatusReaderForTesting,
	listMeshDevices,
	ollamaBaseUrl,
	probeOllama,
} from './server-discovery';

console.log('\nserver-discovery.spec.ts');

/**
 * Every address and hostname below is invented. Real mesh identifiers must not
 * enter the repository, so the fixtures use the documentation-only 203.0.113.0/24
 * range and obviously fake names.
 */
function meshStatus(nodes: {
	self?: Record<string, unknown>;
	peers?: Record<string, unknown>[];
	backendState?: string;
}): string {
	return JSON.stringify({
		BackendState: nodes.backendState ?? 'Running',
		Self: nodes.self ?? {
			HostName: 'this-box',
			TailscaleIPs: ['203.0.113.1', 'fd7a::1'],
			OS: 'linux',
		},
		Peer: Object.fromEntries(
			(nodes.peers ?? []).map((p, i) => [`key${i}`, p]),
		),
	});
}

test.afterEach(() => {
	__setMeshStatusReaderForTesting(null);
});

test.serial('returns an empty list when the CLI cannot be read', async t => {
	__setMeshStatusReaderForTesting(async () => null);
	t.deepEqual(await listMeshDevices(), []);
});

test.serial('returns an empty list on unparseable output', async t => {
	__setMeshStatusReaderForTesting(async () => 'not json at all');
	t.deepEqual(await listMeshDevices(), []);
});

test.serial('returns an empty list unless the backend is Running', async t => {
	// Stopped or NeedsLogin means the addresses are stale or absent.
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({backendState: 'Stopped'}),
	);
	t.deepEqual(await listMeshDevices(), []);
});

test.serial('reports self as online and first', async t => {
	__setMeshStatusReaderForTesting(async () => meshStatus({}));
	const devices = await listMeshDevices();
	t.is(devices.length, 1);
	t.is(devices[0]?.hostname, 'this-box');
	t.is(devices[0]?.address, '203.0.113.1');
	t.true(devices[0]?.isSelf);
	// Self carries no Online flag; the CLI answering is proof enough.
	t.true(devices[0]?.online);
});

test.serial('prefers the IPv4 address', async t => {
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({
			self: {
				HostName: 'v6first',
				TailscaleIPs: ['fd7a::99', '203.0.113.7'],
				OS: 'linux',
			},
		}),
	);
	const devices = await listMeshDevices();
	t.is(devices[0]?.address, '203.0.113.7');
});

test.serial('drops offline peers', async t => {
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({
			peers: [
				{
					HostName: 'awake',
					TailscaleIPs: ['203.0.113.2'],
					OS: 'windows',
					Online: true,
				},
				{
					HostName: 'asleep',
					TailscaleIPs: ['203.0.113.3'],
					OS: 'linux',
					Online: false,
				},
			],
		}),
	);
	const names = (await listMeshDevices()).map(d => d.hostname);
	t.deepEqual(names, ['this-box', 'awake']);
});

test.serial('leaves phones out entirely', async t => {
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({
			peers: [
				{
					HostName: 'a-phone',
					TailscaleIPs: ['203.0.113.4'],
					OS: 'iOS',
					Online: true,
				},
				{
					HostName: 'z-desktop',
					TailscaleIPs: ['203.0.113.5'],
					OS: 'windows',
					Online: true,
				},
			],
		}),
	);
	const names = (await listMeshDevices()).map(d => d.hostname);
	// A phone cannot serve models, so it is not a choice worth offering.
	t.deepEqual(names, ['this-box', 'z-desktop']);
});

test.serial('keeps a device whose OS is unrecognised', async t => {
	// Better one surplus row than hiding a machine that might be the server.
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({
			peers: [
				{
					HostName: 'mystery',
					TailscaleIPs: ['203.0.113.77'],
					OS: 'plan9',
					Online: true,
				},
			],
		}),
	);
	t.deepEqual((await listMeshDevices()).map(d => d.hostname), [
		'this-box',
		'mystery',
	]);
});

test.serial('skips nodes with no usable address or name', async t => {
	__setMeshStatusReaderForTesting(async () =>
		meshStatus({
			peers: [
				{HostName: 'no-address', TailscaleIPs: [], OS: 'linux', Online: true},
				{TailscaleIPs: ['203.0.113.6'], OS: 'linux', Online: true},
				{
					HostName: 'v6only',
					TailscaleIPs: ['fd7a::2'],
					OS: 'linux',
					Online: true,
				},
			],
		}),
	);
	t.deepEqual((await listMeshDevices()).map(d => d.hostname), ['this-box']);
});

test('builds the provider base URL for an address', t => {
	t.is(ollamaBaseUrl('203.0.113.9'), 'http://203.0.113.9:11434/v1');
});

// --- probeOllama -----------------------------------------------------------

async function withFakeOllama(
	handler: (respond: (status: number, payload: unknown) => void) => void,
	run: (baseUrl: string) => Promise<void>,
): Promise<void> {
	const server: Server = createServer((_req, res) => {
		handler((status, payload) => {
			res.writeHead(status, {'content-type': 'application/json'});
			res.end(JSON.stringify(payload));
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	try {
		await run(`http://127.0.0.1:${port}/v1`);
	} finally {
		await new Promise<void>(resolve => {
			server.close(() => resolve());
		});
	}
}

test('lists model names, sorted', async t => {
	await withFakeOllama(
		respond =>
			respond(200, {models: [{name: 'zeta:7b'}, {name: 'alpha:3b'}]}),
		async baseUrl => {
			const result = await probeOllama(baseUrl);
			t.true(result.ok);
			if (result.ok) t.deepEqual(result.models, ['alpha:3b', 'zeta:7b']);
		},
	);
});

test('a reachable server with no models pulled is still a success', async t => {
	await withFakeOllama(
		respond => respond(200, {models: []}),
		async baseUrl => {
			// The address is right, which is what the user needs to hear. Reporting
			// a connection failure here would send them to the network instead.
			const result = await probeOllama(baseUrl);
			t.true(result.ok);
			if (result.ok) t.deepEqual(result.models, []);
		},
	);
});

test('a server that is not Ollama reports not-ollama, not a network error', async t => {
	await withFakeOllama(
		respond => respond(200, {object: 'list', data: []}),
		async baseUrl => {
			t.deepEqual(await probeOllama(baseUrl), {
				ok: false,
				reason: 'not-ollama',
			});
		},
	);
});

test('a non-200 reports not-ollama', async t => {
	await withFakeOllama(
		respond => respond(404, {error: 'nope'}),
		async baseUrl => {
			t.deepEqual(await probeOllama(baseUrl), {
				ok: false,
				reason: 'not-ollama',
			});
		},
	);
});

test('a closed port reports refused, which is the loopback-binding case', async t => {
	// Port 1 is reserved and refuses instantly. This is the distinction the
	// setup screen depends on: refused means Ollama is up but bound to
	// loopback, so the fix is OLLAMA_HOST on the server.
	t.deepEqual(await probeOllama('http://127.0.0.1:1/v1'), {
		ok: false,
		reason: 'refused',
	});
});

test('a malformed base URL reports unknown', async t => {
	t.deepEqual(await probeOllama('not a url'), {ok: false, reason: 'unknown'});
});

test('a server that accepts but never answers reports timeout', async t => {
	// Deliberately a local server that holds the socket open rather than an
	// unroutable address: whether a blackholed route refuses, expires, or hangs
	// depends on the network, which would make this test environment-dependent.
	const server: Server = createServer(() => {
		// Never respond. The probe's own deadline has to end this.
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	try {
		t.deepEqual(
			await probeOllama(`http://127.0.0.1:${port}/v1`, {timeoutMs: 250}),
			{ok: false, reason: 'timeout'},
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>(resolve => {
			server.close(() => resolve());
		});
	}
});
