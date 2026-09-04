import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../config/themes';
import {MAX_DOCUMENT_CHUNKS} from '../constants';
import {ThemeContext} from '../hooks/useTheme';
import {
	getProjectRoot,
	getSafeSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '../services/session-cwd';
import {searchDocumentTool} from './search-document';

console.log(`\nsearch-document.spec.tsx, ${React.version}`);

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

const GUIDE = [
	'# Service Guide',
	'',
	'## Installation',
	'Download the tarball and run the installer script.',
	'',
	'## Rate Limiting',
	'Requests are capped at 100 per minute; exceeding it returns HTTP 429.',
	'',
	'## Logging',
	'Logs are written to stdout in JSON format.',
].join('\n');

async function withDoc(
	content: string,
	run: (relativePath: string) => Promise<void>,
): Promise<void> {
	const testDir = mkdtempSync(join(tmpdir(), 'pdm-search-document-'));
	const previousCwd = getSafeSessionCwd();
	const previousRoot = getProjectRoot();
	setSessionCwd(testDir);
	setProjectRoot(testDir);
	writeFileSync(join(testDir, 'guide.md'), content);

	try {
		await run('guide.md');
	} finally {
		setSessionCwd(previousCwd);
		setProjectRoot(previousRoot);
		rmSync(testDir, {recursive: true, force: true});
	}
}

const execute = (args: Record<string, unknown>) =>
	searchDocumentTool.tool.execute!(args as never, {
		toolCallId: 'test',
		messages: [],
	}) as Promise<string>;

test.serial('search_document tool has correct name and is read-only', t => {
	t.is(searchDocumentTool.name, 'search_document');
	t.is(searchDocumentTool.readOnly, true);
});

test.serial('returns only the matching section, not the whole document', async t => {
	await withDoc(GUIDE, async path => {
		const result = await execute({path, query: 'rate limit 429'});

		t.regex(result, /429/);
		// The point of the tool: unrelated sections stay out of context.
		t.false(result.includes('stdout in JSON format'));
	});
});

test.serial('cites the line range and heading of each passage', async t => {
	await withDoc(GUIDE, async path => {
		const result = await execute({path, query: '429'});
		t.regex(result, /\[lines \d+-\d+, Rate Limiting\]/);
	});
});

test.serial('says so when nothing matches', async t => {
	await withDoc(GUIDE, async path => {
		const result = await execute({path, query: 'kubernetes helm chart'});
		t.regex(result, /No passages in .* match/);
	});
});

test.serial('caps max_chunks at the documented maximum', async t => {
	const long = Array.from(
		{length: 400},
		(_, i) => `## Section ${i}\nContent about widgets in section ${i}.`,
	).join('\n');

	await withDoc(long, async path => {
		const result = await execute({path, query: 'widgets', max_chunks: 999});
		const passages = result.match(/\[lines \d+-\d+/g) ?? [];
		t.is(passages.length, MAX_DOCUMENT_CHUNKS);
	});
});

test.serial('treats max_chunks below 1 as 1', async t => {
	await withDoc(GUIDE, async path => {
		const result = await execute({path, query: 'installer', max_chunks: 0});
		const passages = result.match(/\[lines \d+-\d+/g) ?? [];
		t.is(passages.length, 1);
	});
});

test.serial('reports an empty document rather than failing', async t => {
	await withDoc('   \n\n', async path => {
		const result = await execute({path, query: 'anything'});
		t.regex(result, /is empty/);
	});
});

test.serial('reports a missing file clearly', async t => {
	await withDoc(GUIDE, async () => {
		const result = await execute({path: 'nope.md', query: 'anything'});
		t.regex(result, /Could not read/);
	});
});

test.serial('validator rejects a path outside the project root', async t => {
	const result = await searchDocumentTool.validator!({
		path: '../outside.md',
		query: 'x',
	} as never);
	t.false(result.valid);
});

test.serial('validator rejects an empty query', async t => {
	await withDoc(GUIDE, async path => {
		const result = await searchDocumentTool.validator!({
			path,
			query: '   ',
		} as never);
		t.false(result.valid);
		if (!result.valid) t.regex(result.error, /query must not be empty/);
	});
});

test.serial('validator accepts a document inside the project', async t => {
	await withDoc(GUIDE, async path => {
		const result = await searchDocumentTool.validator!({
			path,
			query: 'rate limiting',
		} as never);
		t.true(result.valid);
	});
});

test.serial('formatter renders the document, query, and summary line', t => {
	const element = searchDocumentTool.formatter!(
		{path: 'guide.md', query: 'rate limiting'},
		'2 of 4 sections in "guide.md" matched "rate limiting":\n\nbody',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);
	const output = lastFrame();

	t.regex(output!, /search_document/);
	t.regex(output!, /guide\.md/);
	t.regex(output!, /rate limiting/);
});
