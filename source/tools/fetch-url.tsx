// `@nanocollective/get-md` (and its transitive chain: cheerio, turndown,
// readability, domutils, entities) is loaded lazily inside the handler, // only users who actually invoke `fetch_url` pay the cost.
import {Box, Text} from 'ink';
import React from 'react';
import {fetch as undiciFetch} from 'undici';
import {DEFAULT_TERMINAL_COLUMNS, MAX_URL_CONTENT_BYTES} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import type {PdmCodeToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {assertPublicHttpUrl, publicOnlyAgent} from '@/utils/network-guard';
import {calculateTokens} from '@/utils/token-calculator';

interface FetchArgs {
	url: string;
}

const MAX_REDIRECTS = 5;
// Raw response cap, before markdown conversion (get-md's own default).
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Fetch `url` through the public-only dispatcher, following redirects by hand
 * so every hop is re-validated: a public page answering 302 to the metadata
 * endpoint is refused like a direct request would be.
 */
async function fetchPublicPage(
	url: string,
): Promise<{body: string; contentType: string}> {
	let current = new URL(url);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		assertPublicHttpUrl(current);
		const response = await undiciFetch(current, {
			dispatcher: publicOnlyAgent,
			redirect: 'manual',
			signal: AbortSignal.timeout(30_000),
			headers: {
				Accept:
					'text/html,application/xhtml+xml,text/plain,text/markdown;q=0.9,*/*;q=0.5',
			},
		});

		const location = response.headers.get('location');
		if (response.status >= 300 && response.status < 400 && location) {
			await response.body?.cancel();
			current = new URL(location, current);
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const declared = Number(response.headers.get('content-length') ?? 0);
		if (declared > MAX_RESPONSE_BYTES) {
			await response.body?.cancel();
			throw new Error(`Response too large (${declared} bytes)`);
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > MAX_RESPONSE_BYTES) {
			throw new Error(`Response too large (${buffer.byteLength} bytes)`);
		}
		return {
			body: new TextDecoder('utf-8').decode(buffer),
			contentType: response.headers.get('content-type') ?? '',
		};
	}
	throw new Error(`Too many redirects (more than ${MAX_REDIRECTS})`);
}

const executeFetchUrl = async (args: FetchArgs): Promise<string> => {
	// Validate URL
	try {
		new URL(args.url);
	} catch {
		throw new Error(`Invalid URL: ${args.url}`);
	}

	try {
		const {body, contentType} = await fetchPublicPage(args.url);

		let content: string;
		if (/html|xml/i.test(contentType) || contentType === '') {
			// Use get-md to convert HTML to LLM-friendly markdown (lazy import
			// so the ~100-module HTML-parsing graph only loads when the tool
			// actually runs). It gets the body, never the URL, so it can't make
			// an unguarded request of its own.
			const {convertToMarkdown} = await import('@nanocollective/get-md');
			content = (await convertToMarkdown(body, {isUrl: false})).markdown;
		} else if (/^text\/|json/i.test(contentType)) {
			content = body;
		} else {
			throw new Error(`Unsupported content type: ${contentType}`);
		}

		if (!content || content.length === 0) {
			throw new Error('No content returned from URL');
		}

		// Limit content size to prevent context overflow
		if (content.length > MAX_URL_CONTENT_BYTES) {
			const truncated = content.substring(0, MAX_URL_CONTENT_BYTES);
			return `${truncated}\n\n[Content truncated - original size was ${content.length} characters]`;
		}

		return content;
	} catch (error: unknown) {
		const message = formatError(error);
		throw new Error(`Failed to fetch URL: ${message}`);
	}
};

const fetchUrlCoreTool = tool({
	description:
		'Fetch a URL and return its content as cleaned markdown. HTML is converted to readable text. Use for reading documentation pages, blog posts, or any web content.',
	inputSchema: jsonSchema<FetchArgs>({
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'The URL to fetch content from.',
			},
		},
		required: ['url'],
	}),
	execute: async (args, _options) => {
		return await executeFetchUrl(args);
	},
});

function FetchUrlFormatterComponent({
	url,
	result,
}: {
	url: string;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Calculate content stats from result
	let estimatedTokens = 0;
	let wasTruncated = false;

	if (result) {
		estimatedTokens = calculateTokens(result);
		wasTruncated = result.includes('[Content truncated');
	}

	const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;
	const urlLabelWidth = 6; // "URL: " + 1 margin
	const availableWidth = Math.max(terminalWidth - urlLabelWidth, 20);

	const truncatedUrl =
		url.length <= availableWidth
			? url
			: url.slice(0, Math.floor(availableWidth / 2) - 1) +
				'…' +
				url.slice(-(Math.ceil(availableWidth / 2) - 1));

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ fetch_url</Text>
			<Box>
				<Text color={colors.secondary}>URL: </Text>
				<Box marginLeft={1}>
					<Text color={colors.text}>{truncatedUrl}</Text>
				</Box>
			</Box>
			{result && (
				<>
					<Box>
						<Text color={colors.secondary}>Tokens: </Text>
						<Text color={colors.text}>~{estimatedTokens} tokens</Text>
					</Box>
					{wasTruncated && (
						<Box>
							<Text color={colors.warning}>
								⚠ Content was truncated to 100KB
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}

const fetchUrlFormatter = (
	args: FetchArgs,
	result?: string,
): React.ReactElement => {
	return (
		<FetchUrlFormatterComponent url={args.url || 'unknown'} result={result} />
	);
};

const fetchUrlValidator = (
	args: FetchArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(args.url);
	} catch {
		return Promise.resolve({
			valid: false,
			error: `Invalid URL format: ${args.url}`,
		});
	}
	try {
		assertPublicHttpUrl(parsedUrl);
	} catch (error) {
		return Promise.resolve({valid: false, error: formatError(error)});
	}
	return Promise.resolve({valid: true});
};

export const fetchUrlTool: PdmCodeToolExport = {
	name: 'fetch_url' as const,
	tool: fetchUrlCoreTool,
	formatter: fetchUrlFormatter,
	validator: fetchUrlValidator,
	readOnly: true,
	// Read-only, but outbound: the URL can carry anything the model has read
	// (e.g. `?d=<secrets>` after a prompt injection), so it is not silent in
	// the modes where the user reviews each step.
	approval: (_args, mode) => mode === 'normal' || mode === 'plan',
};
