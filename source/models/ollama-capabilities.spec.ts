import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'ava';
import {
	getOllamaVisionCapability,
	resetOllamaCapabilityCache,
} from './ollama-capabilities';

console.log('\nollama-capabilities.spec.ts');

/**
 * A stand-in Ollama. Nothing here contacts a real server: the whole point of
 * the module is what it does with `/api/show`, so the suite serves that route
 * itself.
 */
async function withFakeOllama(
	handler: (
		body: {model?: string},
		respond: (status: number, payload: unknown) => void,
	) => void,
	run: (baseUrl: string, requests: string[]) => Promise<void>,
): Promise<void> {
	const requests: string[] = [];
	const server: Server = createServer((req, res) => {
		let raw = '';
		req.on('data', chunk => {
			raw += chunk;
		});
		req.on('end', () => {
			requests.push(req.url ?? '');
			let parsed: {model?: string} = {};
			try {
				parsed = JSON.parse(raw || '{}');
			} catch {
				// A malformed body is the caller's problem; hand the handler {}.
			}
			handler(parsed, (status, payload) => {
				res.writeHead(status, {'content-type': 'application/json'});
				res.end(JSON.stringify(payload));
			});
		});
	});

	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;

	try {
		// The provider config points at the OpenAI-compatible path; the native
		// /api routes live on the origin, which is what the module must derive.
		await run(`http://127.0.0.1:${port}/v1`, requests);
	} finally {
		await new Promise<void>(resolve => {
			server.close(() => resolve());
		});
	}
}

test.beforeEach(() => {
	resetOllamaCapabilityCache();
});

test.serial('reports yes when the server lists the vision capability', async t => {
	await withFakeOllama(
		(_body, respond) =>
			respond(200, {capabilities: ['completion', 'vision', 'tools']}),
		async baseUrl => {
			t.is(await getOllamaVisionCapability(baseUrl, 'some-model'), 'yes');
		},
	);
});

test.serial('reports no when the server omits the vision capability', async t => {
	await withFakeOllama(
		(_body, respond) => respond(200, {capabilities: ['completion', 'tools']}),
		async baseUrl => {
			// Authoritative: the server was asked and answered.
			t.is(await getOllamaVisionCapability(baseUrl, 'text-only'), 'no');
		},
	);
});

test.serial('derives the /api/show route from a /v1 base URL', async t => {
	await withFakeOllama(
		(_body, respond) => respond(200, {capabilities: ['vision']}),
		async (baseUrl, requests) => {
			await getOllamaVisionCapability(baseUrl, 'm');
			t.deepEqual(requests, ['/api/show']);
		},
	);
});

test.serial('sends the model name the caller asked about', async t => {
	let seen: string | undefined;
	await withFakeOllama(
		(body, respond) => {
			seen = body.model;
			respond(200, {capabilities: ['vision']});
		},
		async baseUrl => {
			await getOllamaVisionCapability(baseUrl, 'ornith-1.5:9b-pdm');
		},
	);
	t.is(seen, 'ornith-1.5:9b-pdm');
});

test.serial('returns null - not a verdict - on a non-200 response', async t => {
	await withFakeOllama(
		(_body, respond) => respond(404, {error: 'model not found'}),
		async baseUrl => {
			// null means "could not ask", which must stay distinct from 'no' so
			// the caller falls through to its other sources.
			t.is(await getOllamaVisionCapability(baseUrl, 'missing'), null);
		},
	);
});

test.serial('returns null when the payload has no capabilities array', async t => {
	await withFakeOllama(
		(_body, respond) => respond(200, {details: {family: 'llama'}}),
		async baseUrl => {
			t.is(await getOllamaVisionCapability(baseUrl, 'm'), null);
		},
	);
});

test.serial('returns null when nothing is listening', async t => {
	// Port 1 is reserved and will refuse instantly.
	t.is(await getOllamaVisionCapability('http://127.0.0.1:1/v1', 'm'), null);
});

test.serial('returns null for a missing or malformed base URL', async t => {
	t.is(await getOllamaVisionCapability(undefined, 'm'), null);
	t.is(await getOllamaVisionCapability('not a url', 'm'), null);
	t.is(await getOllamaVisionCapability('http://x/v1', ''), null);
});

test.serial('asks the server only once per model', async t => {
	await withFakeOllama(
		(_body, respond) => respond(200, {capabilities: ['vision']}),
		async (baseUrl, requests) => {
			await getOllamaVisionCapability(baseUrl, 'cached-model');
			await getOllamaVisionCapability(baseUrl, 'cached-model');
			t.is(requests.length, 1, 'the second call is served from the memo');
		},
	);
});

test.serial('caches per model, not globally', async t => {
	await withFakeOllama(
		(body, respond) =>
			respond(200, {
				capabilities: body.model === 'seer' ? ['vision'] : ['completion'],
			}),
		async baseUrl => {
			t.is(await getOllamaVisionCapability(baseUrl, 'seer'), 'yes');
			t.is(await getOllamaVisionCapability(baseUrl, 'blind'), 'no');
		},
	);
});
