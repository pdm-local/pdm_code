import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import {DEFAULT_DOCUMENT_CHUNKS, MAX_DOCUMENT_CHUNKS} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {chunkDocument} from '@/retrieval/chunker';
import {buildLexicalIndex, searchLexicalIndex} from '@/retrieval/lexical-index';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {PdmCodeToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getCachedFileContent} from '@/utils/file-cache';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface SearchDocumentArgs {
	path: string;
	query: string;
	max_chunks?: number;
}

const executeSearchDocument = async (
	args: SearchDocumentArgs,
): Promise<string> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);

	let content: string;
	try {
		// Routes through the shared file cache, which transparently converts
		// PDF and DOCX to markdown, so this works on the exact file types
		// that motivate retrieval in the first place.
		const cached = await getCachedFileContent(absPath);
		content = cached.content;
	} catch (error) {
		return `Could not read "${args.path}": ${formatError(error)}`;
	}

	const chunks = chunkDocument(content);
	if (chunks.length === 0) {
		return `"${args.path}" is empty.`;
	}

	const limit = Math.min(
		Math.max(args.max_chunks ?? DEFAULT_DOCUMENT_CHUNKS, 1),
		MAX_DOCUMENT_CHUNKS,
	);

	const index = buildLexicalIndex(chunks);
	const results = searchLexicalIndex(index, args.query, limit);

	if (results.length === 0) {
		return `No passages in "${args.path}" match "${args.query}" (searched ${chunks.length} sections).`;
	}

	const parts = results.map(({chunk}) => {
		const heading = chunk.heading ? `, ${chunk.heading}` : '';
		return `[lines ${chunk.startLine}-${chunk.endLine}${heading}]\n${chunk.text}`;
	});

	return `${results.length} of ${chunks.length} sections in "${args.path}" matched "${args.query}":\n\n${parts.join('\n\n---\n\n')}`;
};

const searchDocumentCoreTool = tool({
	description:
		'Search a long document (markdown, text, PDF, DOCX) for passages relevant to a query, returning only the matching sections rather than the whole file. Use this INSTEAD OF read_file when a document is too large to read whole and you need the parts about a specific topic. For finding code by symbol name across the project, use search_file_contents instead.',
	inputSchema: jsonSchema<SearchDocumentArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'Path to the document to search.',
			},
			query: {
				type: 'string',
				description:
					'What to look for. Natural language or keywords; matching is lexical, so terms that literally appear in the document work best.',
			},
			max_chunks: {
				type: 'number',
				description: `Optional: how many passages to return (default ${DEFAULT_DOCUMENT_CHUNKS}, max ${MAX_DOCUMENT_CHUNKS}).`,
			},
		},
		required: ['path', 'query'],
	}),
	execute: async (
		args: SearchDocumentArgs,
		_options: {toolCallId: string; messages: unknown[]},
	) => {
		return await executeSearchDocument(args);
	},
});

function SearchDocumentFormatter({
	args,
	result,
}: {
	args: {path?: string; query?: string};
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();
	const matchLine = result?.split('\n')[0];
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ search_document</Text>
			<Box>
				<Text color={colors.secondary}>Document: </Text>
				<Text color={colors.text}>{args.path ?? 'unknown'}</Text>
			</Box>
			<Box>
				<Text color={colors.secondary}>Query: </Text>
				<Text color={colors.text}>{args.query ?? ''}</Text>
			</Box>
			{matchLine && (
				<Box>
					<Text color={colors.secondary}>{matchLine}</Text>
				</Box>
			)}
		</Box>
	);
}

const searchDocumentFormatter = (
	args: {path?: string; query?: string},
	result?: string,
): React.ReactElement => (
	<SearchDocumentFormatter args={args} result={result} />
);

const searchDocumentValidator = async (
	args: SearchDocumentArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const cwd = getSafeSessionCwd();
	const root = getProjectRoot();

	if (!isValidFilePath(args.path, root)) {
		return {
			valid: false,
			error: `Invalid file path: "${args.path}". Path must be within the project directory.`,
		};
	}

	try {
		resolveFilePath(args.path, cwd, root);
	} catch (error) {
		return {
			valid: false,
			error: `Path validation failed: ${formatError(error)}`,
		};
	}

	if (!args.query || args.query.trim().length === 0) {
		return {valid: false, error: 'query must not be empty'};
	}

	return {valid: true};
};

export const searchDocumentTool: PdmCodeToolExport = {
	name: 'search_document' as const,
	tool: searchDocumentCoreTool,
	formatter: searchDocumentFormatter,
	validator: searchDocumentValidator,
	readOnly: true,
};
