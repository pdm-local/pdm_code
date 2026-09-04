import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
// CRITICAL: redirect preference writes to a temp dir BEFORE any production
// code reads `getPreferencesPath()`. handleModelSelect/handleTuneSelect call
// updateLastUsed/saveTune which would otherwise overwrite the user's real
// `~/Library/Preferences/pdm/pdm-preferences.json`.
process.env.PDM_CONFIG_DIR = mkdtempSync(
	join(tmpdir(), 'pdm-spec-'),
);
const {resetPreferencesCache} = await import('@/config/preferences');
resetPreferencesCache();

import type {SettingsTabId} from '@/app/components/settings-constants';
import type {ActiveMode} from '@/hooks/useAppState';
import type {LLMClient, Message} from '@/types/core';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
import {useModeHandlers} from './useModeHandlers';

console.log('\nuseModeHandlers.spec.tsx');

interface CallSpy<T extends unknown[] = unknown[]> {
	(...args: T): void;
	calls: T[];
}

function spy<T extends unknown[] = unknown[]>(): CallSpy<T> {
	const fn = ((...args: T) => {
		fn.calls.push(args);
	}) as CallSpy<T>;
	fn.calls = [];
	return fn;
}

function createMockClient(model = 'mock-model'): LLMClient {
	let currentModel = model;
	return {
		getCurrentModel: () => currentModel,
		setModel: (m: string) => {
			currentModel = m;
		},
		getContextSize: () => 4096,
		getAvailableModels: async () => [currentModel],
		getProviderConfig: () =>
			({
				name: 'mock-provider',
				baseUrl: 'http://localhost',
				apiKey: 'test',
			}) as unknown as AIProviderConfig,
		chat: async () => ({
			message: {role: 'assistant', content: ''},
			messages: [],
			toolsDisabled: false,
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
}

interface ProbeProps {
	client?: LLMClient | null;
	currentModel?: string;
	currentProvider?: string;
}

type HookResult = ReturnType<typeof useModeHandlers>;

function TestHook({
	probe,
	spies,
	onResult,
}: {
	probe: ProbeProps;
	spies: ReturnType<typeof createSpies>;
	onResult: (result: HookResult) => void;
}) {
	const result = useModeHandlers({
		client: probe.client ?? null,
		currentModel: probe.currentModel ?? 'current-model',
		currentProvider: probe.currentProvider ?? 'current-provider',
		setClient: spies.setClient,
		setCurrentModel: spies.setCurrentModel,
		setCurrentProvider: spies.setCurrentProvider,
		setCurrentProviderConfig: spies.setCurrentProviderConfig,
		setMessages: spies.setMessages,
		messages: [],
		getMessageTokens: () => 0,
		setActiveMode: spies.setActiveMode,
		setIsSettingsMode: spies.setIsSettingsMode,
		setSettingsActiveTab: spies.setSettingsActiveTab,
		addToChatQueue: spies.addToChatQueue,
		reinitializeMCPServers: async () => {
			spies.reinitializeMCPServers(undefined);
		},
		setTune: spies.setTune,
	});

	// No deps: always hands the latest closure back out, same as calling the
	// hook directly would - this component never changes props after mount.
	React.useEffect(() => {
		onResult(result);
	});

	return <></>;
}

function createSpies() {
	return {
		setClient: spy<[LLMClient | null]>(),
		setCurrentModel: spy<[string]>(),
		setCurrentProvider: spy<[string]>(),
		setCurrentProviderConfig: spy<[AIProviderConfig | null]>(),
		setMessages: spy<[Message[]]>(),
		setActiveMode: spy<[ActiveMode]>(),
		setIsSettingsMode: spy<[boolean]>(),
		setSettingsActiveTab: spy<[SettingsTabId | undefined]>(),
		addToChatQueue: spy<[React.ReactNode]>(),
		reinitializeMCPServers: spy<[unknown]>(),
		setTune: spy<[TuneConfig]>(),
	};
}

async function setup(probe: ProbeProps = {}) {
	const spies = createSpies();
	let handlers: HookResult | null = null;

	render(
		<TestHook
			probe={probe}
			spies={spies}
			onResult={result => {
				handlers = result;
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 20));

	if (!handlers) {
		throw new Error('useModeHandlers did not render');
	}

	return {
		handlers: handlers as HookResult,
		...spies,
	};
}

test('returns the expected handler surface', async t => {
	const {handlers} = await setup();

	t.is(typeof handlers.enterMode, 'function');
	t.is(typeof handlers.exitMode, 'function');
	t.is(typeof handlers.enterModelSelectionMode, 'function');
	t.is(typeof handlers.enterModelDatabaseMode, 'function');
	t.is(typeof handlers.enterExplorerMode, 'function');
	t.is(typeof handlers.enterIdeSelectionMode, 'function');
	t.is(typeof handlers.enterSettingsMode, 'function');
	t.is(typeof handlers.enterTune, 'function');
	t.is(typeof handlers.handleModelSelect, 'function');
	t.is(typeof handlers.handleConfigWizardComplete, 'function');
	t.is(typeof handlers.handleTuneSelect, 'function');
});

test('enterMode forwards to setActiveMode', async t => {
	const {handlers, setActiveMode} = await setup();

	handlers.enterMode('model');
	handlers.enterMode('modelDatabase');

	t.deepEqual(setActiveMode.calls, [['model'], ['modelDatabase']]);
});

test('exitMode sets active mode to null', async t => {
	const {handlers, setActiveMode} = await setup();

	handlers.exitMode();

	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('each enter*Mode helper sets the matching active mode', async t => {
	const {handlers, setActiveMode} = await setup();

	handlers.enterModelSelectionMode();
	handlers.enterModelDatabaseMode();
	handlers.enterExplorerMode();
	handlers.enterIdeSelectionMode();
	handlers.enterTune();

	t.deepEqual(setActiveMode.calls, [
		['model'],
		['modelDatabase'],
		['explorer'],
		['ideSelection'],
		['tune'],
	]);
});

test('enterSettingsMode toggles settings flag, handleSettingsCancel clears it', async t => {
	const {handlers, setIsSettingsMode} = await setup();

	handlers.enterSettingsMode();
	handlers.handleSettingsCancel();

	t.deepEqual(setIsSettingsMode.calls, [[true], [false]]);
});

test('cancel handlers all return active mode to null', async t => {
	const {handlers, setActiveMode} = await setup();

	handlers.handleModelSelectionCancel();
	handlers.handleModelDatabaseCancel();
	handlers.handleConfigWizardCancel();
	handlers.handleExplorerCancel();
	handlers.handleIdeSelectionCancel();
	handlers.handleTuneCancel();

	t.is(setActiveMode.calls.length, 6);
	for (const args of setActiveMode.calls) {
		t.deepEqual(args, [null]);
	}
});

test('handleModelSelect short-circuits when provider and model are unchanged', async t => {
	const client = createMockClient('current-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		await setup({
			client,
			currentProvider: 'current-provider',
			currentModel: 'current-model',
		});

	await handlers.handleModelSelect('current-provider', 'current-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect with new model on same provider updates client, keeps history, exits mode', async t => {
	const client = createMockClient('old-model');
	const {handlers, setCurrentModel, setMessages, setActiveMode, addToChatQueue} =
		await setup({
			client,
			currentProvider: 'current-provider',
			currentModel: 'old-model',
		});

	await handlers.handleModelSelect('current-provider', 'new-model');

	t.is(client.getCurrentModel(), 'new-model');
	t.deepEqual(setCurrentModel.calls, [['new-model']]);
	// History is preserved across model switches.
	t.is(setMessages.calls.length, 0);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleModelSelect on same provider with no client only exits mode', async t => {
	const {handlers, setCurrentModel, setMessages, setActiveMode} = await setup({
		client: null,
		currentProvider: 'current-provider',
	});

	await handlers.handleModelSelect('current-provider', 'any-model');

	t.is(setCurrentModel.calls.length, 0);
	t.is(setMessages.calls.length, 0);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleTuneSelect persists tune, clears history, and exits mode', async t => {
	const client = createMockClient();
	const {handlers, setTune, setMessages, setActiveMode, addToChatQueue} = await setup(
		{client},
	);

	const config: TuneConfig = {
		enabled: true,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	} as unknown as TuneConfig;

	await handlers.handleTuneSelect(config);

	t.deepEqual(setTune.calls, [[config]]);
	t.deepEqual(setMessages.calls, [[[]]]);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleTuneSelect with disabled config still clears chat and exits', async t => {
	const {handlers, setTune, setMessages, setActiveMode, addToChatQueue} = await setup();

	const config: TuneConfig = {
		enabled: false,
		toolProfile: 'minimal',
		aggressiveCompact: false,
	} as unknown as TuneConfig;

	await handlers.handleTuneSelect(config);

	t.deepEqual(setTune.calls, [[config]]);
	t.deepEqual(setMessages.calls, [[[]]]);
	t.is(addToChatQueue.calls.length, 1);
	t.deepEqual(setActiveMode.calls, [[null]]);
});

test('handleConfigWizardComplete with no path only exits mode', async t => {
	const {handlers, setActiveMode, addToChatQueue} = await setup();

	await handlers.handleConfigWizardComplete();

	t.deepEqual(setActiveMode.calls, [[null]]);
	t.is(addToChatQueue.calls.length, 0);
});

test('reloadProviders leaves the conversation and settings panel intact', async t => {
	const {
		handlers,
		setMessages,
		setActiveMode,
		setIsSettingsMode,
		addToChatQueue,
	} = await setup({client: createMockClient()});

	await handlers.reloadProviders();

	// This is why reloadProviders exists rather than reusing
	// handleConfigWizardComplete: editing a provider mid-session must not wipe
	// the model's history or tear down the settings panel around the user.
	// These hold whether the rebuild succeeds or fails - handleConfigWizardComplete
	// would have called exitMode() before it ever reached the client swap.
	t.is(setMessages.calls.length, 0, 'conversation history is left alone');
	t.is(setActiveMode.calls.length, 0, 'does not exit the current mode');
	t.is(setIsSettingsMode.calls.length, 0, 'leaves the settings panel open');
	t.is(addToChatQueue.calls.length, 1, 'reports the outcome exactly once');
});

test('enterSettingsMode forwards the requested tab', async t => {
	const {handlers, setSettingsActiveTab} = await setup();

	handlers.enterSettingsMode('mcp');
	handlers.enterSettingsMode();

	t.deepEqual(setSettingsActiveTab.calls, [['mcp'], [undefined]]);
});
