import test from 'ava';
import {chunkDocument, type DocumentChunk} from './chunker';
import {buildLexicalIndex, searchLexicalIndex, tokenize} from './lexical-index';

console.log('\nlexical-index.spec.ts');

function chunk(index: number, text: string, heading?: string): DocumentChunk {
	return {index, text, heading, startLine: index * 10 + 1, endLine: index * 10 + 9};
}

function search(chunks: DocumentChunk[], query: string, limit = 5) {
	return searchLexicalIndex(buildLexicalIndex(chunks), query, limit);
}

test('tokenize lowercases and drops stopwords', t => {
	t.deepEqual(tokenize('The Quick Brown Fox'), ['quick', 'brown', 'fox']);
});

test('tokenize keeps identifiers and file paths as single terms', t => {
	// This is most of why BM25 works well here: `handleChatMessage` must not
	// be shredded into `handle`, `chat`, `message`.
	t.true(tokenize('call handleChatMessage now').includes('handlechatmessage'));
	t.true(tokenize('edit agents.config.json').includes('agents.config.json'));
	t.true(tokenize('the snake_case_name').includes('snake_case_name'));
});

test('tokenize returns nothing for punctuation-only input', t => {
	t.deepEqual(tokenize('!!! ... ???'), []);
});

test('tokenize strips trailing punctuation but keeps it inside a token', t => {
	// Regression: the token pattern greedily swallowed a sentence-final `.`,
	// so "returns HTTP 429." indexed as `429.` and a query for `429` missed
	// it, quietly breaking every term that ends a sentence.
	t.deepEqual(tokenize('returns HTTP 429.'), ['returns', 'http', '429']);
	t.deepEqual(tokenize('see config.json.'), ['see', 'config.json']);
	t.deepEqual(tokenize('a trailing dash-'), ['trailing', 'dash']);
});

test('searchLexicalIndex finds the chunk containing the query term', t => {
	const chunks = [
		chunk(0, 'This section covers installation and setup steps.'),
		chunk(1, 'This section covers authentication and token refresh.'),
		chunk(2, 'This section covers deployment to production.'),
	];

	const results = search(chunks, 'authentication');

	t.is(results.length, 1);
	t.is(results[0]!.chunk.index, 1);
});

test('searchLexicalIndex ranks the more relevant chunk first', t => {
	const chunks = [
		chunk(0, 'Authentication is mentioned once here.'),
		chunk(
			1,
			'Authentication, authentication tokens, and authentication refresh are the topic.',
		),
	];

	const results = search(chunks, 'authentication');

	t.is(results[0]!.chunk.index, 1, 'the denser chunk outranks the passing mention');
});

test('searchLexicalIndex returns nothing when no chunk matches', t => {
	const chunks = [chunk(0, 'Entirely unrelated prose about gardening.')];
	t.deepEqual(search(chunks, 'kubernetes'), []);
});

test('searchLexicalIndex returns nothing for a stopword-only query', t => {
	const chunks = [chunk(0, 'Some content about the thing.')];
	t.deepEqual(search(chunks, 'the and of'), []);
});

test('searchLexicalIndex respects the result limit', t => {
	const chunks = Array.from({length: 10}, (_, i) =>
		chunk(i, `Chunk ${i} discussing widgets in detail.`),
	);

	t.is(search(chunks, 'widgets', 3).length, 3);
});

test('searchLexicalIndex matches terms appearing only in the heading', t => {
	const chunks = [
		chunk(0, 'Body text with no distinguishing words.', 'Troubleshooting'),
		chunk(1, 'Other body text.', 'Overview'),
	];

	const results = search(chunks, 'troubleshooting');

	t.is(results.length, 1);
	t.is(results[0]!.chunk.index, 0);
});

test('searchLexicalIndex handles an empty index', t => {
	t.deepEqual(search([], 'anything'), []);
});

test('rare terms outrank common ones (IDF actually applies)', t => {
	const chunks = [
		chunk(0, 'config config config config appears everywhere'),
		chunk(1, 'config appears here too, alongside idempotency'),
		chunk(2, 'config again, nothing else notable'),
	];

	// "idempotency" occurs in exactly one chunk; "config" in all three. A
	// query for both must favour the chunk with the rare term.
	const results = search(chunks, 'config idempotency');
	t.is(results[0]!.chunk.index, 1);
});

test('end to end: chunk a document then retrieve the relevant section', t => {
	const doc = [
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

	const results = search(chunkDocument(doc), 'what happens when I hit 429');

	t.true(results.length > 0);
	t.regex(results[0]!.chunk.text, /429/);
});
