/**
 * BM25 lexical retrieval over document chunks.
 *
 * Pure functions, no index files, no model, no network: building the index for
 * a single document is fast enough to do per call, which keeps this free of
 * the cache-invalidation problems a persisted index would bring.
 *
 * BM25 rather than embeddings on purpose, see the retrieval notes in the
 * plan. For a "where does this spec say X" question over one document, exact
 * term matching is both stronger and instant, and it costs no VRAM on a
 * machine whose GPU is busy serving the coding model.
 */

import type {DocumentChunk} from './chunker';

/** Term-frequency saturation. 1.2-2.0 is the usual range; 1.5 is the common default. */
const BM25_K1 = 1.5;

/** Length normalization strength. 0.75 is the standard value. */
const BM25_B = 0.75;

/**
 * Very common English words carry no discriminating signal and would
 * otherwise let a long chunk win on "the" alone. Kept deliberately short:
 * over-aggressive stopword lists hurt technical text, where words like "not"
 * and "no" change meaning.
 */
const STOPWORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'by',
	'for',
	'from',
	'in',
	'is',
	'it',
	'of',
	'on',
	'or',
	'that',
	'the',
	'this',
	'to',
	'was',
	'were',
	'will',
	'with',
]);

/**
 * Split text into lowercased terms.
 *
 * Keeps `_`, `.`, `-` inside a token so identifiers and file paths survive as
 * single terms (`handleChatMessage`, `agents.config.json`), which is most of
 * what makes this useful over code-adjacent prose.
 */
export function tokenize(text: string): string[] {
	const matches = text.toLowerCase().match(/[a-z0-9][a-z0-9_.-]*/g);
	if (!matches) return [];

	const terms: string[] = [];
	for (const match of matches) {
		// `.`, `-` and `_` are only meaningful *inside* a token. Left attached,
		// a sentence-final word indexes as `429.` or `configuration.` and never
		// matches a query for `429` or `configuration`, silently missing every
		// term that happens to end a sentence.
		const term = match.replace(/[._-]+$/, '');
		if (term.length > 0 && !STOPWORDS.has(term)) {
			terms.push(term);
		}
	}
	return terms;
}

export interface ScoredChunk {
	chunk: DocumentChunk;
	score: number;
}

interface IndexedChunk {
	chunk: DocumentChunk;
	termFrequencies: Map<string, number>;
	length: number;
}

export interface LexicalIndex {
	chunks: IndexedChunk[];
	documentFrequencies: Map<string, number>;
	averageLength: number;
}

export function buildLexicalIndex(chunks: DocumentChunk[]): LexicalIndex {
	const indexed: IndexedChunk[] = [];
	const documentFrequencies = new Map<string, number>();
	let totalLength = 0;

	for (const chunk of chunks) {
		const terms = tokenize(`${chunk.heading ?? ''} ${chunk.text}`);
		const termFrequencies = new Map<string, number>();
		for (const term of terms) {
			termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + 1);
		}
		for (const term of termFrequencies.keys()) {
			documentFrequencies.set(term, (documentFrequencies.get(term) ?? 0) + 1);
		}
		indexed.push({chunk, termFrequencies, length: terms.length});
		totalLength += terms.length;
	}

	return {
		chunks: indexed,
		documentFrequencies,
		averageLength: indexed.length > 0 ? totalLength / indexed.length : 0,
	};
}

/**
 * Score every chunk against `query` and return the best `limit`, highest
 * first. Chunks scoring zero are dropped rather than padded in, an empty
 * result is a more honest answer than a list of irrelevant chunks.
 */
export function searchLexicalIndex(
	index: LexicalIndex,
	query: string,
	limit: number,
): ScoredChunk[] {
	const queryTerms = tokenize(query);
	if (queryTerms.length === 0 || index.chunks.length === 0) return [];

	const totalChunks = index.chunks.length;
	const scored: ScoredChunk[] = [];

	for (const entry of index.chunks) {
		let score = 0;

		for (const term of queryTerms) {
			const termFrequency = entry.termFrequencies.get(term);
			if (!termFrequency) continue;

			const docFrequency = index.documentFrequencies.get(term) ?? 0;
			// BM25's probabilistic IDF, in the +0.5/+1 smoothed form that stays
			// positive even for a term appearing in every chunk.
			const idf = Math.log(
				1 + (totalChunks - docFrequency + 0.5) / (docFrequency + 0.5),
			);

			const normalizedLength =
				index.averageLength > 0 ? entry.length / index.averageLength : 1;
			const denominator =
				termFrequency + BM25_K1 * (1 - BM25_B + BM25_B * normalizedLength);

			score += idf * ((termFrequency * (BM25_K1 + 1)) / denominator);
		}

		if (score > 0) {
			scored.push({chunk: entry.chunk, score});
		}
	}

	scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
	return scored.slice(0, limit);
}
