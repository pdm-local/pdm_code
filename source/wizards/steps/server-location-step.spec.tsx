import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {__setMeshStatusReaderForTesting} from '@/setup/server-discovery';
import {renderWithTheme as render} from '@/test-utils/render-with-theme';
import {
	FailureNotice,
	type LocationChoice,
	ServerLocationStep,
} from './server-location-step.js';

console.log('\nserver-location-step.spec.tsx');

/**
 * Canned CLI output. Every name and address is invented: the documentation-only
 * 203.0.113.0/24 range, and hostnames that could not be anybody's real machine.
 * Real mesh identifiers must never enter a fixture.
 */
function meshWith(peers: Record<string, unknown>[]): string {
	return JSON.stringify({
		BackendState: 'Running',
		Self: {
			HostName: 'this-box',
			TailscaleIPs: ['203.0.113.1'],
			OS: 'linux',
		},
		Peer: Object.fromEntries(peers.map((p, i) => [`k${i}`, p])),
	});
}

const GPU_BOX = {
	HostName: 'gpu-box',
	TailscaleIPs: ['203.0.113.50'],
	OS: 'linux',
	Online: true,
};

/** Let the mount effect and its promise settle before asserting. */
async function settle(): Promise<void> {
	await new Promise(resolve => setTimeout(resolve, 20));
}

test.afterEach(() => {
	__setMeshStatusReaderForTesting(null);
});

test.serial('skips itself when no other device exists', async t => {
	// A one-machine setup has nothing to choose between, so asking "which
	// device?" would be a prompt with a single real answer. The wizard should
	// fall straight through to the base URL field.
	__setMeshStatusReaderForTesting(async () => meshWith([]));

	let manualCalls = 0;
	let selected: string | null = null;
	const {unmount} = render(
		<ServerLocationStep
			serverName="Ollama"
			defaultBaseUrl="http://localhost:11434/v1"
			onSelect={url => {
				selected = url;
			}}
			onManual={() => {
				manualCalls += 1;
			}}
		/>,
	);
	await settle();
	unmount();

	t.is(manualCalls, 1);
	t.is(selected, null);
});

test.serial('skips itself when there is no mesh at all', async t => {
	__setMeshStatusReaderForTesting(async () => null);

	let manualCalls = 0;
	const {unmount} = render(
		<ServerLocationStep
			serverName="Ollama"
			defaultBaseUrl="http://localhost:11434/v1"
			onSelect={() => {}}
			onManual={() => {
				manualCalls += 1;
			}}
		/>,
	);
	await settle();
	unmount();

	t.is(manualCalls, 1);
});

test.serial('asks where the server is once another device exists', async t => {
	__setMeshStatusReaderForTesting(async () => meshWith([GPU_BOX]));

	const {lastFrame, unmount} = render(
		<ServerLocationStep
			serverName="Ollama"
			defaultBaseUrl="http://localhost:11434/v1"
			onSelect={() => {}}
			onManual={() => {}}
		/>,
	);
	await settle();
	const output = stripAnsi(lastFrame() ?? '');
	unmount();

	t.regex(output, /Where is the Ollama model server running/);
	t.regex(output, /This device/);
	t.regex(output, /localhost:11434/);
	t.regex(output, /gpu-box/);
	// The row carries the OS and the address it would use, so the choice is
	// legible without the user recalling which box is which.
	t.regex(output, /linux/);
	t.regex(output, /203\.0\.113\.50:11434/);
	t.regex(output, /Enter an address manually/);
});

test.serial('does not offer this machine twice', async t => {
	// Self is already offered as "This device" with the template's own default
	// URL; listing its mesh address as well is the same machine by two routes.
	__setMeshStatusReaderForTesting(async () => meshWith([GPU_BOX]));

	const {lastFrame, unmount} = render(
		<ServerLocationStep
			serverName="Ollama"
			defaultBaseUrl="http://localhost:11434/v1"
			onSelect={() => {}}
			onManual={() => {}}
		/>,
	);
	await settle();
	const output = stripAnsi(lastFrame() ?? '');
	unmount();

	t.notRegex(output, /this-box/);
	t.notRegex(output, /203\.0\.113\.1:11434/);
});

test.serial('leaves offline devices out of the list', async t => {
	__setMeshStatusReaderForTesting(async () =>
		meshWith([
			GPU_BOX,
			{
				HostName: 'sleeping-laptop',
				TailscaleIPs: ['203.0.113.60'],
				OS: 'windows',
				Online: false,
			},
		]),
	);

	const {lastFrame, unmount} = render(
		<ServerLocationStep
			serverName="Ollama"
			defaultBaseUrl="http://localhost:11434/v1"
			onSelect={() => {}}
			onManual={() => {}}
		/>,
	);
	await settle();
	const output = stripAnsi(lastFrame() ?? '');
	unmount();

	t.regex(output, /gpu-box/);
	t.notRegex(output, /sleeping-laptop/);
});

// Probe classification (refused vs timeout vs not-ollama) is covered by
// source/setup/server-discovery.spec.ts against fake servers. Asserting it
// through this component would mean probing a fixed port 11434 on a real
// address, which makes the result depend on whether the machine running the
// suite happens to have Ollama up.

// --- the failure guidance --------------------------------------------------
//
// Rendered directly rather than by driving a real probe: reaching the refused
// branch through the component would mean probing a fixed port 11434 on a real
// address, so the result would depend on what the machine running the suite
// happens to have listening. Classification itself is covered against fake
// servers in source/setup/server-discovery.spec.ts.

function choiceFor(os: string): LocationChoice {
	return {
		label: 'gpu-box',
		value: '203.0.113.50',
		detail: `${os} http://203.0.113.50:11434/v1`,
		baseUrl: 'http://203.0.113.50:11434/v1',
		device: {
			hostname: 'gpu-box',
			address: '203.0.113.50',
			os,
			online: true,
			isSelf: false,
		},
	};
}

function renderNotice(reason: 'refused' | 'timeout' | 'not-ollama' | 'unknown', os = 'linux') {
	const {lastFrame, unmount} = render(
		<FailureNotice
			choice={choiceFor(os)}
			reason={reason}
			serverName="Ollama"
			onRetry={() => {}}
			onChooseAnother={() => {}}
			onUseAnyway={() => {}}
		/>,
	);
	const output = stripAnsi(lastFrame() ?? '');
	unmount();
	return output;
}

test('refused explains the loopback binding and names the server to fix', t => {
	const output = renderNotice('refused');
	t.regex(output, /gpu-box refused the connection/);
	t.regex(output, /binds loopback by default/);
	// The command has to name the device's own address, not a placeholder.
	t.regex(output, /OLLAMA_HOST=203\.0\.113\.50:11434/);
	t.regex(output, /systemctl edit ollama/);
});

test('refused warns against binding 0.0.0.0', t => {
	// Ollama has no authentication, so 0.0.0.0 exposes the GPU to the whole
	// local network. Dropping this warning would make the advice harmful.
	const output = renderNotice('refused');
	t.regex(output, /0\.0\.0\.0/);
	t.regex(output, /no\s+authentication/);
});

test('refused gives the Windows command for a Windows server', t => {
	const output = renderNotice('refused', 'windows');
	t.regex(output, /setx OLLAMA_HOST 203\.0\.113\.50:11434/);
	t.notRegex(output, /systemctl/);
});

test('timeout points at the device being asleep or off the network', t => {
	const output = renderNotice('timeout');
	t.regex(output, /did not answer in time/);
	t.regex(output, /asleep/);
	// Not a loopback problem, so the OLLAMA_HOST advice must not appear.
	t.notRegex(output, /OLLAMA_HOST/);
});

test('not-ollama says the port is held by something else', t => {
	const output = renderNotice('not-ollama');
	t.regex(output, /not Ollama/);
	t.notRegex(output, /OLLAMA_HOST/);
});

test('every failure offers a way forward', t => {
	for (const reason of ['refused', 'timeout', 'not-ollama', 'unknown'] as const) {
		const output = renderNotice(reason);
		t.regex(output, /Try again/, reason);
		t.regex(output, /Pick a different device/, reason);
		t.regex(output, /Use this address anyway/, reason);
	}
});
