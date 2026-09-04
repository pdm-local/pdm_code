import test from 'ava';
import {chunkDocument} from './chunker';

console.log('\nchunker.spec.ts');

test('chunkDocument returns nothing for empty or whitespace-only input', t => {
	t.deepEqual(chunkDocument(''), []);
	t.deepEqual(chunkDocument('   \n\n  \n'), []);
});

test('chunkDocument keeps a short document as a single chunk', t => {
	const chunks = chunkDocument('Just one short paragraph about widgets.');
	t.is(chunks.length, 1);
	t.is(chunks[0]!.index, 0);
	t.is(chunks[0]!.startLine, 1);
	t.regex(chunks[0]!.text, /widgets/);
});

test('chunkDocument attaches the enclosing heading to each chunk', t => {
	const doc = [
		'# Title',
		'Intro text.',
		'',
		'## Installation',
		'Run the installer.',
		'',
		'## Configuration',
		'Edit the config file.',
	].join('\n');

	const chunks = chunkDocument(doc);
	const headings = chunks.map(c => c.heading);

	t.true(headings.includes('Installation'));
	t.true(headings.includes('Configuration'));
});

test('chunkDocument starts a new chunk at each heading', t => {
	const doc = [
		'## Alpha',
		'Content about alpha.',
		'## Beta',
		'Content about beta.',
	].join('\n');

	const chunks = chunkDocument(doc);

	// Beta's content must not be buried in the same chunk as Alpha's - that
	// is the whole point of splitting on headings.
	const alpha = chunks.find(c => c.heading === 'Alpha');
	t.truthy(alpha);
	t.false(alpha!.text.includes('Content about beta'));
});

test('chunkDocument splits a section larger than the token budget', t => {
	const longSection = Array.from(
		{length: 400},
		(_, i) => `Line ${i} with some filler words to build up length.`,
	).join('\n');
	const doc = `## Big\n${longSection}`;

	const chunks = chunkDocument(doc);

	t.true(
		chunks.length > 1,
		'a section far over the budget must not be emitted whole',
	);
	// Every chunk still knows which section it came from.
	t.true(chunks.every(c => c.heading === 'Big'));
});

test('chunkDocument reports line ranges that point back into the document', t => {
	const lines = Array.from({length: 60}, (_, i) => `line ${i + 1}`);
	const chunks = chunkDocument(lines.join('\n'));

	for (const chunk of chunks) {
		t.true(chunk.startLine >= 1);
		t.true(chunk.endLine >= chunk.startLine);
		t.true(chunk.endLine <= lines.length);
	}
});

test('chunkDocument numbers chunks consecutively from zero', t => {
	const doc = Array.from({length: 300}, (_, i) => `Paragraph ${i}.`).join('\n');
	const chunks = chunkDocument(doc);
	t.deepEqual(
		chunks.map(c => c.index),
		chunks.map((_, i) => i),
	);
});

test('chunkDocument overlaps consecutive chunks within a section', t => {
	const doc = Array.from(
		{length: 300},
		(_, i) => `Sentence number ${i} carrying enough words to add up.`,
	).join('\n');

	const chunks = chunkDocument(doc);
	t.true(chunks.length > 1);

	// The second chunk should begin before the first one ended, so a fact on
	// the boundary is retrievable from either side.
	t.true(chunks[1]!.startLine <= chunks[0]!.endLine);
});
