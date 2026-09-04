/**
 * Heading-aware chunking for long documents.
 *
 * Splits on markdown headings first so a chunk rarely straddles two topics,
 * then packs paragraphs up to a token budget, carrying a small overlap so a
 * fact sitting on a chunk boundary is still retrievable from one side of it.
 *
 * Token counts use the char/4 estimate from `calculateTokens` rather than a
 * real BPE encoder: chunking only needs to be roughly even, and pulling in a
 * tokenizer here would put tiktoken's WASM on this path for no accuracy that
 * matters.
 */

import {calculateTokens} from '@/utils/token-calculator';

/** Target size of a chunk, in estimated tokens. */
const CHUNK_TARGET_TOKENS = 400;

/** How much of the previous chunk to repeat at the start of the next one. */
const CHUNK_OVERLAP_RATIO = 0.15;

export interface DocumentChunk {
	/** 0-based position in the document. */
	index: number;
	/** Nearest enclosing markdown heading, or undefined above the first one. */
	heading?: string;
	/** 1-based line number this chunk starts on, for citation. */
	startLine: number;
	/** 1-based line number this chunk ends on, inclusive. */
	endLine: number;
	text: string;
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/;

interface Block {
	lines: string[];
	startLine: number;
	heading?: string;
}

/**
 * Group lines into blocks that never cross a heading, so heading context can
 * be attached to every chunk derived from them.
 */
function splitIntoBlocks(lines: string[]): Block[] {
	const blocks: Block[] = [];
	let current: Block = {lines: [], startLine: 1};
	let heading: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';
		const match = HEADING_RE.exec(line);

		if (match) {
			if (current.lines.length > 0) {
				blocks.push(current);
			}
			heading = match[2];
			current = {lines: [line], startLine: i + 1, heading};
			continue;
		}

		if (current.lines.length === 0) {
			current = {lines: [line], startLine: i + 1, heading};
		} else {
			current.lines.push(line);
		}
	}

	if (current.lines.length > 0) {
		blocks.push(current);
	}

	return blocks;
}

/**
 * Split `content` into overlapping, heading-aware chunks.
 *
 * A block larger than the budget is split across several chunks rather than
 * emitted whole, a single 5,000-token section would otherwise defeat the
 * point of chunking.
 */
export function chunkDocument(
	content: string,
	targetTokens: number = CHUNK_TARGET_TOKENS,
): DocumentChunk[] {
	if (content.trim().length === 0) return [];

	const lines = content.split('\n');
	const blocks = splitIntoBlocks(lines);
	const chunks: DocumentChunk[] = [];

	let pending: string[] = [];
	let pendingStartLine = 1;
	let pendingHeading: string | undefined;
	let pendingTokens = 0;

	const flush = () => {
		if (pending.length === 0) return;
		const text = pending.join('\n').trim();
		if (text.length === 0) {
			pending = [];
			pendingTokens = 0;
			return;
		}
		chunks.push({
			index: chunks.length,
			heading: pendingHeading,
			startLine: pendingStartLine,
			endLine: pendingStartLine + pending.length - 1,
			text,
		});

		// Carry the tail of this chunk into the next one so a sentence split
		// across the boundary is still findable from the following chunk.
		const overlapLines = Math.floor(pending.length * CHUNK_OVERLAP_RATIO);
		if (overlapLines > 0) {
			const carried = pending.slice(-overlapLines);
			pendingStartLine = pendingStartLine + pending.length - overlapLines;
			pending = carried;
			pendingTokens = calculateTokens(carried.join('\n'));
		} else {
			pendingStartLine = pendingStartLine + pending.length;
			pending = [];
			pendingTokens = 0;
		}
	};

	for (const block of blocks) {
		for (let i = 0; i < block.lines.length; i++) {
			const line = block.lines[i] ?? '';

			// A heading starts a fresh chunk: it is the strongest topic
			// boundary the document gives us.
			if (i === 0 && block.heading !== undefined && pending.length > 0) {
				flush();
				// A heading boundary is a real topic change, so don't drag the
				// previous section's overlap across it.
				pending = [];
				pendingStartLine = block.startLine;
				pendingTokens = 0;
			}

			if (pending.length === 0) {
				pendingStartLine = block.startLine + i;
				pendingHeading = block.heading;
			}

			pending.push(line);
			pendingTokens += calculateTokens(line) + 1;

			if (pendingTokens >= targetTokens) {
				flush();
				pendingHeading = block.heading;
			}
		}
	}

	flush();
	return chunks;
}
