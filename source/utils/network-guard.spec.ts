import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'ava';
import {fetch} from 'undici';
import {
	assertPublicHttpUrl,
	isPrivateAddress,
	publicOnlyAgent,
} from './network-guard';

console.log('\nnetwork-guard.spec.ts');

test('internal addresses are refused in every spelling', t => {
	for (const address of [
		'127.0.0.1',
		'127.0.0.2',
		'10.1.2.3',
		'172.20.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'0.0.0.0',
		'::1',
		'[::1]',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
		'::ffff:a9fe:a9fe',
	]) {
		t.true(isPrivateAddress(address), address);
	}
});

test('public addresses are allowed', t => {
	for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
		t.false(isPrivateAddress(address), address);
	}
});

test('assertPublicHttpUrl rejects localhost names and non-http schemes', t => {
	for (const url of [
		'http://localhost/',
		'http://localhost./',
		'http://api.localhost/',
		'http://169.254.169.254/latest/meta-data/',
		'http://[::ffff:7f00:1]/',
		'file:///etc/passwd',
	]) {
		t.throws(() => assertPublicHttpUrl(new URL(url)), undefined, url);
	}
	t.notThrows(() => assertPublicHttpUrl(new URL('https://example.com/')));
});

test('the dispatcher refuses a hostname that resolves to loopback', async t => {
	let hit = false;
	const server = createServer((_req, res) => {
		hit = true;
		res.end('internal');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const {port} = server.address() as AddressInfo;
	try {
		// The name check alone would miss this: it is a lookup, not a literal.
		await t.throwsAsync(
			fetch(`http://localhost:${port}/`, {dispatcher: publicOnlyAgent}),
		);
		t.false(hit);
	} finally {
		server.close();
	}
});
