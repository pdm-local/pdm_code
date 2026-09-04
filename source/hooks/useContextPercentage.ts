import {useEffect, useMemo, useRef} from 'react';
import {CONTEXT_STREAM_TOKEN_QUANTUM} from '@/constants';
import {getModelContextLimit} from '@/models/index';
import type {ToolManager} from '@/tools/tool-manager';
import type {AIProviderConfig, TuneConfig} from '@/types/config';
import {getTuneToolMode} from '@/types/config';
import type {
	ApiUsageSnapshot,
	ContextSource,
	DevelopmentMode,
	Message,
} from '@/types/core';
import type {Tokenizer} from '@/types/tokenization';
import {
	calculateTokenBreakdown,
	calculateToolDefinitionsTokensFromDefs,
} from '@/usage/calculator';
import {resolveContextUsage} from '@/usage/context-source';
import {filterModelFacing, isModelFacing} from '@/utils/message-visibility';
import {getLastBuiltPrompt} from '@/utils/prompt-builder';

interface UseContextPercentageProps {
	currentModel: string;
	currentProvider: string;
	currentProviderConfig: AIProviderConfig | null;
	messages: Message[];
	tokenizer: Tokenizer;
	getMessageTokens: (message: Message) => number;
	toolManager: ToolManager | null;
	streamingTokenCount: number;
	contextLimit: number | null;
	lastApiUsage: ApiUsageSnapshot | null;
	setContextPercentUsed: (value: number | null) => void;
	setContextLimit: (value: number | null) => void;
	setContextSource: (value: ContextSource | null) => void;
	developmentMode?: DevelopmentMode;
	tune?: TuneConfig;
}

export function useContextPercentage({
	currentModel,
	currentProvider,
	currentProviderConfig,
	messages,
	tokenizer,
	getMessageTokens,
	toolManager,
	streamingTokenCount,
	contextLimit,
	lastApiUsage,
	setContextPercentUsed,
	setContextLimit,
	setContextSource,
	developmentMode = 'normal',
	tune,
}: UseContextPercentageProps): void {
	const lastResolvedKeyRef = useRef<string>('');

	// Tool definition overhead, only when native tool calling is active, and
	// only for the tools actually exposed (profile + mode filtered). Under
	// XML/JSON fallback the definitions already live inside the system prompt.
	//
	// This is memoized rather than computed inside Effect 2 because it is
	// expensive and cannot change mid-stream: every exposed tool's JSON schema
	// is stringified and run through the real BPE encoder. Recomputing it per
	// streamed token was tens of KB of JSON.stringify + tokenizer.encode per
	// token, on the same thread Ink renders on.
	const toolDefTokens = useMemo(() => {
		const nativeToolsDisabled =
			currentProviderConfig?.disableTools === true ||
			(currentProviderConfig?.disableToolModels?.includes(currentModel) ??
				false) ||
			getTuneToolMode(tune) !== 'native';

		if (!toolManager || nativeToolsDisabled) return 0;

		return calculateToolDefinitionsTokensFromDefs(
			toolManager.getFilteredTools(
				toolManager.getAvailableToolNames(
					tune,
					developmentMode,
					undefined,
					currentModel,
				),
			),
			tokenizer,
		);
	}, [
		toolManager,
		tune,
		developmentMode,
		currentModel,
		currentProviderConfig,
		tokenizer,
	]);

	// The context figure is displayed as a rounded percentage, so tracking the
	// streaming reply to single-token precision buys nothing visible while
	// re-running the whole breakdown on every token. Quantizing to 50-token
	// steps cuts that work by ~50x and is invisible in the UI.
	const streamingTokensQuantized =
		Math.floor(streamingTokenCount / CONTEXT_STREAM_TOKEN_QUANTUM) *
		CONTEXT_STREAM_TOKEN_QUANTUM;

	// Effect 1: Resolve context limit when model or provider changes. The
	// resolved limit is published to `contextLimit` (state), which Effect 2
	// depends on, so the percentage recomputes against the new model's window
	// as soon as it resolves (not just on the next message).
	useEffect(() => {
		if (!currentModel) {
			lastResolvedKeyRef.current = '';
			setContextLimit(null);
			setContextPercentUsed(null);
			setContextSource(null);
			return;
		}

		const resolutionKey = `${currentProvider}:${currentModel}`;
		if (resolutionKey === lastResolvedKeyRef.current) return;
		lastResolvedKeyRef.current = resolutionKey;

		let cancelled = false;

		void getModelContextLimit(currentModel, {
			providerConfig: currentProviderConfig ?? undefined,
		}).then(limit => {
			if (cancelled) return;
			setContextLimit(limit);
			if (!limit) {
				setContextPercentUsed(null);
				setContextSource(null);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [
		currentModel,
		currentProvider,
		currentProviderConfig,
		setContextLimit,
		setContextPercentUsed,
		setContextSource,
	]);

	// The cached prompt, which includes XML tool definitions when applicable.
	// Read at render (a cached string read, not a rebuild) so Effect 2 can
	// depend on it directly and re-run exactly when the prompt changes.
	const systemPrompt = getLastBuiltPrompt();

	// Effect 2: Recalculate percentage. Mirrors the /usage command exactly:
	// the tool-definition overhead counts only the tools actually exposed to
	// the model (profile + mode filtered), and the prompt/tools/limit all
	// re-resolve when the model, mode, tune profile, or window changes.
	useEffect(() => {
		if (!contextLimit) {
			setContextPercentUsed(null);
			setContextSource(null);
			return;
		}

		const systemMessage: Message = {
			role: 'system',
			content: systemPrompt,
		};

		// Display-only notices never reach the provider, so they must not show up
		// in the context figure that reports what the provider is holding.
		const breakdown = calculateTokenBreakdown(
			[systemMessage, ...filterModelFacing(messages)],
			tokenizer,
			(message: Message) => {
				// System message won't be in the cache, use tokenizer directly
				if (message.role === 'system') {
					return tokenizer.countTokens(message);
				}
				return getMessageTokens(message);
			},
		);

		const total = breakdown.total + toolDefTokens + streamingTokensQuantized;

		// Estimate of only the messages appended since the API snapshot was taken,
		// plus the in-flight streaming reply. The API total already accounts for
		// the system prompt, tool definitions and history up to `atMessageCount`,
		// so the anchor must add nothing but this fresh tail. Guard the slice
		// against a snapshot whose count overtook the conversation (stale across a
		// clear/compaction), `resolveContextUsage` ignores that snapshot anyway.
		const apiAtCount = lastApiUsage?.atMessageCount ?? null;
		let tailTokens = streamingTokensQuantized;
		if (apiAtCount !== null && apiAtCount <= messages.length) {
			// Index against the full array, `atMessageCount` counts every message
			// in history, but skip the notices the payload never carried.
			for (let i = apiAtCount; i < messages.length; i++) {
				if (!isModelFacing(messages[i])) continue;
				tailTokens += getMessageTokens(messages[i]);
			}
		}

		// Anchor on API-reported usage and estimate only the fresh tail; fall back
		// to the full client-side estimate when there's no usable snapshot.
		const {percent, source} = resolveContextUsage({
			estimatedTotalTokens: total,
			estimatedTailTokens: tailTokens,
			apiSnapshot: lastApiUsage,
			currentMessageCount: messages.length,
			contextLimit,
		});
		setContextPercentUsed(percent);
		setContextSource(source);
		// contextLimit is included to re-trigger calculation after async limit
		// resolution. `systemPrompt` stands in for the model/mode/tune inputs the
		// old dep list carried: those mattered only because they change the built
		// prompt, and depending on the prompt itself is both narrower and exact.
	}, [
		systemPrompt,
		messages,
		tokenizer,
		getMessageTokens,
		toolDefTokens,
		streamingTokensQuantized,
		lastApiUsage,
		setContextPercentUsed,
		setContextSource,
		contextLimit,
	]);
}
