import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {ThemeContext} from '../hooks/useTheme';
import {
	getProjectRoot,
	getSafeSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '../services/session-cwd';
import {
	__setClientFactoryForTesting,
	resetVisionDelegateClients,
} from '../vision/vision-delegate';
import {analyzeImageTool} from './analyze-image';

console.log(`\nanalyze-image.spec.tsx, ${React.version}`);

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};
	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

// A valid PNG signature followed by arbitrary bytes - readImageFile only
// checks the extension and size, not the pixel data.
const FAKE_PNG_BYTES = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

function withTempImage(run: (imagePath: string) => Promise<void> | void) {
	const testDir = mkdtempSync(join(tmpdir(), 'pdm-analyze-image-'));
	const previousCwd = getSafeSessionCwd();
	const previousRoot = getProjectRoot();
	setSessionCwd(testDir);
	setProjectRoot(testDir);

	const imagePath = join(testDir, 'screenshot.png');
	writeFileSync(imagePath, FAKE_PNG_BYTES);

	return Promise.resolve(run('screenshot.png'))
		.finally(() => {
			setSessionCwd(previousCwd);
			setProjectRoot(previousRoot);
			rmSync(testDir, {recursive: true, force: true});
		})
		.then(() => imagePath);
}

test.afterEach(() => {
	__setClientFactoryForTesting(null);
	resetVisionDelegateClients();
});

test.serial('analyze_image tool has correct name', t => {
	t.is(analyzeImageTool.name, 'analyze_image');
});

test.serial('analyze_image is read-only', t => {
	t.is(analyzeImageTool.readOnly, true);
});

test.serial('analyze_image tool has formatter and validator', t => {
	t.truthy(analyzeImageTool.formatter);
	t.truthy(analyzeImageTool.validator);
});

test.serial('validator rejects a path outside the project root', async t => {
	const result = await analyzeImageTool.validator!({path: '../outside.png'});
	t.false(result.valid);
});

test.serial('validator rejects a non-image extension', async t => {
	await withTempImage(async () => {
		const result = await analyzeImageTool.validator!({
			path: 'screenshot.png.txt',
		});
		t.false(result.valid);
		if (!result.valid) {
			t.regex(result.error, /not a supported image type/);
		}
	});
});

test.serial('validator accepts a supported image extension within the project', async t => {
	await withTempImage(async relativePath => {
		const result = await analyzeImageTool.validator!({path: relativePath});
		t.true(result.valid);
	});
});

test.serial('execute reports a clear error when the file cannot be read as an image', async t => {
	const result = await analyzeImageTool.tool.execute!(
		{path: 'does-not-exist.png'},
		{toolCallId: 'test', messages: []},
	);
	t.regex(result as string, /Could not read image/);
});

test.serial('execute returns the delegate description with attribution and timing', async t => {
	__setClientFactoryForTesting(async (provider, model) => ({
		client: {
			getCurrentModel: () => model ?? 'delegate-model',
			setModel: () => {},
			getContextSize: () => 0,
			getAvailableModels: async () => [],
			getProviderConfig: () =>
				({
					name: provider ?? 'delegate-provider',
					type: 'openai-compatible',
					models: [model ?? 'delegate-model'],
				}) as unknown as ReturnType<
					import('@/types/core').LLMClient['getProviderConfig']
				>,
			chat: async () => ({
				choices: [
					{message: {role: 'assistant' as const, content: 'a red button'}},
				],
			}),
			clearContext: async () => {},
			getTimeout: () => undefined,
		},
		actualProvider: provider ?? 'delegate-provider',
	}));

	const {updateVisionModel, clearVisionModel, resetPreferencesCache} =
		await import('@/config/preferences');
	const {mkdtempSync: mkTmp} = await import('node:fs');
	const previousDir = process.env.PDM_CONFIG_DIR;
	process.env.PDM_CONFIG_DIR = mkTmp(join(tmpdir(), 'pdm-analyze-image-cfg-'));
	resetPreferencesCache();
	updateVisionModel('delegate-provider', 'delegate-model');

	try {
		await withTempImage(async relativePath => {
			const result = (await analyzeImageTool.tool.execute!(
				{path: relativePath},
				{toolCallId: 'test', messages: []},
			)) as string;

			t.regex(result, /\[analyzed by delegate-provider\/delegate-model in/);
			t.true(result.includes('a red button'));
		});
	} finally {
		clearVisionModel();
		if (previousDir === undefined) {
			delete process.env.PDM_CONFIG_DIR;
		} else {
			process.env.PDM_CONFIG_DIR = previousDir;
		}
		resetPreferencesCache();
	}
});

test.serial('execute surfaces a clear error when no vision delegate is configured', async t => {
	const {clearVisionModel, resetPreferencesCache} = await import(
		'@/config/preferences'
	);
	const previousDir = process.env.PDM_CONFIG_DIR;
	process.env.PDM_CONFIG_DIR = mkdtempSync(
		join(tmpdir(), 'pdm-analyze-image-cfg-'),
	);
	resetPreferencesCache();
	clearVisionModel();

	try {
		await withTempImage(async relativePath => {
			const result = (await analyzeImageTool.tool.execute!(
				{path: relativePath},
				{toolCallId: 'test', messages: []},
			)) as string;

			t.regex(result, /no vision delegate is configured/i);
		});
	} finally {
		if (previousDir === undefined) {
			delete process.env.PDM_CONFIG_DIR;
		} else {
			process.env.PDM_CONFIG_DIR = previousDir;
		}
		resetPreferencesCache();
	}
});

test.serial('formatter renders the path and optional question', t => {
	const element = analyzeImageTool.formatter!(
		{path: 'shot.png', question: 'what error is shown?'},
		undefined,
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /analyze_image/);
	t.regex(output!, /shot\.png/);
	t.regex(output!, /what error is shown\?/);
});
