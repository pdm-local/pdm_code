import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
// CRITICAL: redirect preference writes to a temp dir BEFORE any production
// code reads getPreferencesPath() - this handler writes the visionModel
// preference, which would otherwise land in the user's real preferences file.
process.env.PDM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'pdm-spec-'));
const {resetPreferencesCache, getVisionModel, clearVisionModel} = await import(
	'@/config/preferences'
);
resetPreferencesCache();

import type {MessageSubmissionOptions} from '@/types';
import {handleVisionModelCommand} from './vision-model-handler.js';

console.log('\nvision-model-handler.spec.ts');

function createOptions(
	overrides: Partial<MessageSubmissionOptions> = {},
): MessageSubmissionOptions {
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onRenameSession: () => {},
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterTune: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: () => {},
		setLiveComponent: () => {},
		setIsToolExecuting: () => {},
		setMessages: () => {},
		messages: [],
		provider: 'test-provider',
		providerConfig: null,
		client: null,
		model: 'test-model',
		theme: 'dark',
		getMessageTokens: () => 0,
		...overrides,
	} as MessageSubmissionOptions;
}

function getMessageText(node: React.ReactNode): string {
	if (!React.isValidElement(node)) return '';
	return String((node.props as {message?: string}).message ?? '');
}

test.afterEach(() => {
	clearVisionModel();
});

test.serial('returns false for an unrelated command', async t => {
	const handled = await handleVisionModelCommand(
		['context-max'],
		createOptions(),
	);
	t.false(handled);
});

test.serial('reports the delegate as unconfigured when none is set', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleVisionModelCommand(
		['vision-model'],
		createOptions({
			onAddToChatQueue: node => {
				queued = node;
			},
		}),
	);

	t.true(handled);
	t.regex(getMessageText(queued), /Vision delegate: not configured/);
});

test.serial('rejects a provider that is not configured', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleVisionModelCommand(
		['vision-model', 'no-such-provider', 'some-model'],
		createOptions({
			onAddToChatQueue: node => {
				queued = node;
			},
		}),
	);

	t.true(handled);
	t.regex(getMessageText(queued), /Unknown provider "no-such-provider"/);
	t.is(getVisionModel(), undefined, 'nothing was persisted');
});

test.serial('clears the delegate on --clear', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleVisionModelCommand(
		['vision-model', '--clear'],
		createOptions({
			onAddToChatQueue: node => {
				queued = node;
			},
		}),
	);

	t.true(handled);
	t.regex(getMessageText(queued), /Vision delegate cleared/);
	t.is(getVisionModel(), undefined);
});
