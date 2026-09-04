import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import {useTheme} from '@/hooks/useTheme';
import {getProjectRoot, getSafeSessionCwd} from '@/services/session-cwd';
import type {PdmCodeToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {
	MAX_IMAGE_BYTES,
	mediaTypeForPath,
	readImageFile,
} from '@/utils/clipboard-image';
import {formatError} from '@/utils/error-formatter';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';
import {describeImages, VisionUnavailableError} from '@/vision/vision-delegate';

interface AnalyzeImageArgs {
	path: string;
	question?: string;
}

const executeAnalyzeImage = async (args: AnalyzeImageArgs): Promise<string> => {
	const absPath = resolve(getSafeSessionCwd(), args.path);

	const attachment = readImageFile(absPath);
	if (!attachment) {
		return `Could not read image "${args.path}". It may not exist, may not be a supported image type, or may exceed the ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB size limit.`;
	}

	try {
		const result = await describeImages({
			images: [attachment],
			question: args.question,
		});
		return `[analyzed by ${result.provider}/${result.model} in ${(result.elapsedMs / 1000).toFixed(1)}s]\n${result.description}`;
	} catch (error) {
		if (error instanceof VisionUnavailableError) {
			return error.message;
		}
		return `Image analysis failed: ${formatError(error)}`;
	}
};

const analyzeImageCoreTool = tool({
	description:
		'Describe the contents of an image file (screenshot, diagram, photo) through a vision-capable model. Use this when you need to see what an image shows - e.g. a screenshot of an error, a UI mockup, or a diagram - and the active model cannot accept image input itself. Requires a vision delegate to be configured (/vision-model).',
	inputSchema: jsonSchema<AnalyzeImageArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the image file to analyze.',
			},
			question: {
				type: 'string',
				description:
					'Optional: a specific question about the image. Defaults to a general description request.',
			},
		},
		required: ['path'],
	}),
	execute: async (
		args: AnalyzeImageArgs,
		_options: {toolCallId: string; messages: unknown[]},
	) => {
		return await executeAnalyzeImage(args);
	},
});

function AnalyzeImageFormatter({
	args,
}: {
	args: {path?: string; question?: string};
}): React.ReactElement {
	const {colors} = useTheme();
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ analyze_image</Text>
			<Box>
				<Text color={colors.secondary}>Path: </Text>
				<Text color={colors.text}>{args.path ?? 'unknown'}</Text>
			</Box>
			{args.question && (
				<Box>
					<Text color={colors.secondary}>Question: </Text>
					<Text color={colors.text}>{args.question}</Text>
				</Box>
			)}
		</Box>
	);
}

const analyzeImageFormatter = (
	args: {path?: string; question?: string},
	_result?: string,
): React.ReactElement => <AnalyzeImageFormatter args={args} />;

const analyzeImageValidator = async (
	args: AnalyzeImageArgs,
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

	if (!mediaTypeForPath(args.path)) {
		return {
			valid: false,
			error: `"${args.path}" is not a supported image type. Supported: .png, .jpg, .jpeg, .gif, .webp.`,
		};
	}

	return {valid: true};
};

export const analyzeImageTool: PdmCodeToolExport = {
	name: 'analyze_image' as const,
	tool: analyzeImageCoreTool,
	formatter: analyzeImageFormatter,
	validator: analyzeImageValidator,
	readOnly: true,
};
