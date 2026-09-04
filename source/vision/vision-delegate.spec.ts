import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
// CRITICAL: redirect preference writes to a temp dir BEFORE any production
// code reads getPreferencesPath(), updateVisionModel/clearVisionModel would
// otherwise touch the user's real preferences file.
process.env.PDM_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'pdm-spec-'));
const {resetPreferencesCache, clearVisionModel, updateVisionModel} =
	await import('@/config/preferences');
resetPreferencesCache();

import type {createLLMClient} from '@/client-factory';
import type {AIProviderConfig, ImageAttachment, LLMClient} from '@/types/core';
import {
	__setClientFactoryForTesting,
	describeImages,
	resetVisionDelegateClients,
	VisionUnavailableError,
} from './vision-delegate';

console.log('\nvision-delegate.spec.ts');

const image: ImageAttachment = {data: 'ZmFrZQ==', mediaType: 'image/png'};

function fakeProviderConfig(name: string): AIProviderConfig {
	return {name, type: 'openai-compatible', models: ['fake-model']};
}

function createFakeClient(content: string): LLMClient {
	return {
		getCurrentModel: () => 'fake-model',
		setModel: () => {},
		getContextSize: () => 4096,
		getAvailableModels: async () => ['fake-model'],
		getProviderConfig: () => fakeProviderConfig('fake-provider'),
		chat: async () => ({
			choices: [{message: {role: 'assistant', content}}],
			toolsDisabled: false,
		}),
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
}

function fakeFactory(
	client: LLMClient,
	calls: Array<{provider?: string; model?: string}>,
): typeof createLLMClient {
	return async (provider?: string, model?: string) => {
		calls.push({provider, model});
		return {client, actualProvider: provider ?? 'fake-provider'};
	};
}

test.afterEach(() => {
	clearVisionModel();
	resetVisionDelegateClients();
	__setClientFactoryForTesting(null);
});

test.serial(
	'describeImages throws when no delegate is configured and no current model is given',
	async t => {
		await t.throwsAsync(() => describeImages({images: [image]}), {
			instanceOf: VisionUnavailableError,
			message: /no vision delegate is configured/i,
		});
	},
);

test.serial(
	'describeImages throws when the current model is not confirmed vision-capable',
	async t => {
		await t.throwsAsync(
			() =>
				describeImages({
					images: [image],
					currentProvider: 'some-provider',
					currentModel: 'totally-fictional-non-vision-model-xyz',
				}),
			{
				instanceOf: VisionUnavailableError,
				message: /totally-fictional-non-vision-model-xyz/,
			},
		);
	},
);

test.serial(
	'describeImages uses the configured delegate preference over the current model',
	async t => {
		updateVisionModel('delegate-provider', 'delegate-model');
		const client = createFakeClient('a screenshot of a stack trace');
		const calls: Array<{provider?: string; model?: string}> = [];
		__setClientFactoryForTesting(fakeFactory(client, calls));

		const result = await describeImages({
			images: [image],
			currentProvider: 'chat-provider',
			currentModel: 'chat-model',
		});

		t.is(result.description, 'a screenshot of a stack trace');
		t.is(result.provider, 'delegate-provider');
		t.is(result.model, 'delegate-model');
		t.true(result.elapsedMs >= 0);
		t.deepEqual(calls, [
			{provider: 'delegate-provider', model: 'delegate-model'},
		]);
	},
);

test.serial(
	'describeImages falls back to the current model when it is confirmed vision-capable and no delegate is set',
	async t => {
		const client = createFakeClient('a UI mockup');
		const calls: Array<{provider?: string; model?: string}> = [];
		__setClientFactoryForTesting(fakeFactory(client, calls));

		const result = await describeImages({
			images: [image],
			currentProvider: 'ollama',
			// Matches the local Ollama vision-pattern table (gemma3) without
			// needing a live models.dev lookup.
			currentModel: 'my-test-gemma3-build:latest',
		});

		t.is(result.description, 'a UI mockup');
		t.is(result.provider, 'ollama');
		t.is(result.model, 'my-test-gemma3-build:latest');
		t.deepEqual(calls, [
			{provider: 'ollama', model: 'my-test-gemma3-build:latest'},
		]);
	},
);

test.serial('describeImages caches the client across repeated calls', async t => {
	updateVisionModel('delegate-provider', 'delegate-model');
	const client = createFakeClient('description');
	const calls: Array<{provider?: string; model?: string}> = [];
	__setClientFactoryForTesting(fakeFactory(client, calls));

	await describeImages({images: [image]});
	await describeImages({images: [image]});

	t.is(calls.length, 1, 'the second call reuses the cached client');
});

test.serial(
	'describeImages throws when the delegate returns an empty description',
	async t => {
		updateVisionModel('delegate-provider', 'delegate-model');
		const client = createFakeClient('   ');
		__setClientFactoryForTesting(fakeFactory(client, []));

		await t.throwsAsync(() => describeImages({images: [image]}), {
			instanceOf: VisionUnavailableError,
			message: /empty description/,
		});
	},
);

test.serial(
	'describeImages passes the question through as the user message content',
	async t => {
		updateVisionModel('delegate-provider', 'delegate-model');
		let capturedContent: string | undefined;
		const client: LLMClient = {
			...createFakeClient('answer'),
			chat: async messages => {
				capturedContent = messages.find(m => m.role === 'user')?.content;
				return {
					choices: [{message: {role: 'assistant', content: 'answer'}}],
					toolsDisabled: false,
				};
			},
		};
		__setClientFactoryForTesting(fakeFactory(client, []));

		await describeImages({images: [image], question: 'what error is shown?'});

		t.is(capturedContent, 'what error is shown?');
	},
);
