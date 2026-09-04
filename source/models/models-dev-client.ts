/**
 * API client for models.dev
 * Fetches and caches model metadata
 */

import {request} from 'undici';
import {TIMEOUT_HTTP_BODY_MS, TIMEOUT_HTTP_HEADERS_MS} from '@/constants';
import type {AIProviderConfig, ProviderConfig} from '@/types/config';
import {formatError} from '@/utils/error-formatter';
import {getLogger} from '@/utils/logging';
import {createSessionOverride} from '@/utils/session-override';
import {readCache, writeCache} from './models-cache.js';
import type {
	ModelInfo,
	ModelsDevDatabase,
	ModelsDevModel,
	ModelsDevProvider,
	VisionSupport,
} from './models-types.js';
import {getOllamaVisionCapability} from './ollama-capabilities.js';

const MODELS_DEV_API_URL = 'https://models.dev/api.json';

/**
 * Fallback context limits for common Ollama model architectures
 * Used when models.dev doesn't have the model data
 */
const OLLAMA_MODEL_CONTEXT_LIMITS: Record<string, number> = {
	// Llama 3.2 models (not on models.dev)
	'llama3.2': 128000,
	'llama3.2:1b': 128000,
	'llama3.2:3b': 128000,

	// Llama 3.1 models (base matches wrong model on models.dev)
	'llama3.1': 128000,
	'llama3.1:8b': 128000,
	'llama3.1:70b': 128000,
	'llama3.1:405b': 128000,

	// Llama 3 models (size variants not on models.dev)
	'llama3:8b': 8192,
	'llama3:70b': 8192,

	// Llama 2 models (not on models.dev)
	llama2: 4096,
	'llama2:7b': 4096,
	'llama2:13b': 4096,
	'llama2:70b': 4096,

	// Mistral models (base matches wrong model on models.dev)
	mistral: 32000,
	'mistral:7b': 32000,
	'mixtral:8x7b': 32000,
	'mixtral:8x22b': 64000,
	'ministral:3b': 256000,
	'ministral:8b': 256000,

	// Qwen models (base names match wrong models on models.dev)
	qwen: 32000,
	'qwen:7b': 32000,
	'qwen:14b': 32000,
	qwen2: 32000,
	'qwen2:7b': 32000,
	'qwen2.5': 128000,
	'qwen2.5:7b': 128000,
	qwen3: 128000,
	'qwen3:7b': 128000,
	'qwen3:14b': 128000,
	'qwen3:32b': 128000,

	// Gemma models (base matches wrong model on models.dev)
	gemma: 8192,
	'gemma:2b': 8192,
	'gemma:7b': 8192,
	'gemma2:9b': 8192,
	'gemma2:27b': 8192,
	gemma4: 128000,
	'gemma4:e2b': 128000,
	'gemma4:e4b': 128000,
	'gemma4:26b': 256000,
	'gemma4:31b': 256000,

	// DeepSeek models (base matches wrong model on models.dev)
	'deepseek-coder': 16000,
	'deepseek-coder-v2': 128000,
	'deepseek-v3.1': 128000,

	// Phi models (not on models.dev)
	phi3: 128000,
	'phi3:mini': 128000,
	'phi3:medium': 128000,

	// Moonshot AI models (kimi-for-coding is a provider, not a model ID)
	'kimi-k2': 128000,
	'kimi-for-coding': 256000,

	// Mistral cloud aliases
	'devstral-small-2': 128000,
};

/**
 * Match a model name against a set of known base-architecture keys, longest
 * (most specific) key first, e.g. "qwen3-coder:480b" matches before "qwen3",
 * "mixtral:8x22b" before "mixtral". Shared by the context-limit table below
 * and the vision-capability table, since Ollama tag naming is the same
 * problem in both cases: models.dev covers Ollama tags poorly, so both tables
 * exist as local, offline fallbacks.
 */
function matchOllamaModelKey(
	modelName: string,
	keys: readonly string[],
): string | null {
	const lower = modelName.toLowerCase();
	const sortedKeys = [...keys].sort((a, b) => b.length - a.length);

	// Try exact and prefix matches
	for (const key of sortedKeys) {
		if (
			lower === key ||
			lower.startsWith(`${key}-`) ||
			lower.startsWith(`${key}:`)
		) {
			return key;
		}
	}

	// Try to match base architecture (also sorted by specificity)
	for (const key of sortedKeys) {
		if (lower.includes(key)) {
			return key;
		}
	}

	return null;
}

/**
 * Extract base model architecture from Ollama model name
 * e.g., "llama3.1:8b-instruct-q4_0" -> "llama3.1:8b"
 */
function extractOllamaModelBase(modelName: string): string | null {
	return matchOllamaModelKey(
		modelName,
		Object.keys(OLLAMA_MODEL_CONTEXT_LIMITS),
	);
}

/**
 * Get fallback context limit for Ollama models
 */
function getOllamaFallbackContextLimit(modelName: string): number | null {
	const baseModel = extractOllamaModelBase(modelName);
	if (!baseModel) {
		return null;
	}

	return OLLAMA_MODEL_CONTEXT_LIMITS[baseModel] || null;
}

/**
 * Ollama model families known to accept image input. models.dev's modality
 * data barely covers Ollama tags, so, same rationale as
 * OLLAMA_MODEL_CONTEXT_LIMITS above, this is a local, offline fallback table
 * rather than a live lookup.
 */
const OLLAMA_VISION_PATTERNS: readonly string[] = [
	'gemma3',
	'gemma4',
	'llava',
	'llama3.2-vision',
	'minicpm-v',
	'qwen2.5vl',
	'moondream',
	'mistral-small3',
];

/**
 * Offline fallback: does this Ollama tag match a known vision-capable model
 * family? Returns a plain boolean (not the tri-state VisionSupport) because a
 * miss here means "this table doesn't cover it", not "confirmed non-vision", * callers combine it with the models.dev result to decide 'unknown' vs 'no'.
 */
function isKnownOllamaVisionModel(modelName: string): boolean {
	return matchOllamaModelKey(modelName, OLLAMA_VISION_PATTERNS) !== null;
}

/**
 * Fetch models data from models.dev API
 * Falls back to cache if API is unavailable
 */
async function fetchModelsData(): Promise<ModelsDevDatabase | null> {
	try {
		const response = await request(MODELS_DEV_API_URL, {
			method: 'GET',
			headersTimeout: TIMEOUT_HTTP_HEADERS_MS,
			bodyTimeout: TIMEOUT_HTTP_BODY_MS,
		});

		if (response.statusCode !== 200) {
			throw new Error(
				`Failed to fetch models data: HTTP ${response.statusCode}`,
			);
		}

		const body = await response.body.json();
		const data = body as ModelsDevDatabase;

		// Cache the successful response
		await writeCache(data);

		return data;
	} catch (error) {
		const logger = getLogger();
		logger.warn({error: formatError(error)}, 'Failed to fetch from models.dev');

		// Try to use cached data as fallback
		const cached = await readCache();
		if (cached) {
			logger.info('Using cached models data');
			return cached.data;
		}

		return null;
	}
}

/**
 * In-process memo of the parsed models.dev database. The payload is ~3.5MB,
 * so re-reading and JSON.parsing it from disk on every lookup costs ~13ms a
 * call, and the per-response usage indicator made that a per-message tax.
 * The in-flight promise is shared so concurrent lookups don't stampede, and
 * negative results (no cache, fetch failed) are memoized too: an offline
 * session pays the fetch timeout once per process, not once per response.
 */
let modelsDataMemo: Promise<ModelsDevDatabase | null> | null = null;

/**
 * Get models data, preferring cache if valid
 */
function getModelsData(): Promise<ModelsDevDatabase | null> {
	if (!modelsDataMemo) {
		modelsDataMemo = (async () => {
			// Try cache first
			const cached = await readCache();
			if (cached) {
				return cached.data;
			}

			// Fetch fresh data if cache is invalid
			return fetchModelsData();
		})();
	}
	return modelsDataMemo;
}

/**
 * Project a models.dev model + its provider into our ModelInfo shape.
 */
function createModelInfo(
	model: ModelsDevModel,
	provider: ModelsDevProvider,
): ModelInfo {
	const supportsImageInput: VisionSupport = model.modalities?.input
		? model.modalities.input.includes('image')
			? 'yes'
			: 'no'
		: 'unknown';

	return {
		id: model.id,
		name: model.name,
		provider: provider.name,
		contextLimit: model.limit?.context ?? null,
		outputLimit: model.limit?.output ?? null,
		supportsToolCalls: model.tool_call ?? false,
		supportsImageInput,
		cost: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			// Left undefined rather than zeroed when models.dev omits them:
			// pricing falls back to the input rate, and a 0 would price cache
			// hits as free.
			...(model.cost?.cache_read != null
				? {cache_read: model.cost.cache_read}
				: {}),
			...(model.cost?.cache_write != null
				? {cache_write: model.cost.cache_write}
				: {}),
		},
	};
}

/**
 * Find a model by ID across all providers
 * Returns the model info and provider name
 */
async function findModelById(modelId: string): Promise<ModelInfo | null> {
	const data = await getModelsData();
	if (!data) {
		return null;
	}

	let bestMatch: ModelInfo | null = null;

	// Search through all providers, picking the match with highest context limit
	for (const [_providerId, provider] of Object.entries(data)) {
		// Skip malformed provider entries
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		const model = provider.models[modelId];
		if (model) {
			const contextLimit = model.limit?.context ?? null;
			if (
				!bestMatch ||
				(contextLimit !== null &&
					(bestMatch.contextLimit === null ||
						contextLimit > bestMatch.contextLimit))
			) {
				bestMatch = createModelInfo(model, provider);
			}
		}
	}

	return bestMatch;
}

/**
 * Find a model by partial name match
 * Useful for local models where exact ID might not match
 */
async function findModelByName(modelName: string): Promise<ModelInfo | null> {
	// Empty string matches everything with .includes(), so return null early
	if (!modelName) {
		return null;
	}

	const data = await getModelsData();
	if (!data) {
		return null;
	}

	const lowerName = modelName.toLowerCase();

	let bestMatch: ModelInfo | null = null;
	let bestScore = 0;

	// Search through all providers with scored matching
	for (const [_providerId, provider] of Object.entries(data)) {
		// Skip malformed provider entries
		if (!provider || typeof provider !== 'object' || !provider.models) {
			continue;
		}
		for (const [_modelId, model] of Object.entries(provider.models)) {
			// Skip malformed model entries
			if (!model || typeof model !== 'object') {
				continue;
			}

			const modelIdLower = model.id?.toLowerCase() ?? '';
			const modelNameLower = model.name?.toLowerCase() ?? '';

			let score = 0;

			// Exact ID match → return immediately
			if (modelIdLower === lowerName) {
				return createModelInfo(model, provider);
			}

			// ID starts with search term → high score
			if (modelIdLower.startsWith(lowerName)) {
				score = 3;
			}
			// Name starts with search term → medium score
			else if (modelNameLower.startsWith(lowerName)) {
				score = 2;
			}
			// ID or Name contains search term → low score
			else if (
				modelIdLower.includes(lowerName) ||
				modelNameLower.includes(lowerName)
			) {
				score = 1;
			}

			if (score > bestScore) {
				bestScore = score;
				bestMatch = createModelInfo(model, provider);
			}
		}
	}

	return bestMatch;
}

/**
 * Session-level context limit override.
 * Allows users to manually set a context limit via /context-max command.
 * Non-positive values collapse back to null (no override).
 */
const contextLimitSession = createSessionOverride<number>(limit =>
	limit !== null && limit > 0 ? limit : null,
);

export function setSessionContextLimit(limit: number | null): void {
	contextLimitSession.set(limit);
}

export function getSessionContextLimit(): number | null {
	return contextLimitSession.get();
}

export function resetSessionContextLimit(): void {
	contextLimitSession.reset();
}

export type ContextLimitSource =
	| 'session'
	| 'provider-model-config'
	| 'provider-config'
	| 'env'
	| 'model-lookup'
	| 'unknown';

export interface ModelContextLimitOptions {
	providerConfig?: AIProviderConfig | ProviderConfig;
}

export interface ResolvedContextLimit {
	limit: number | null;
	source: ContextLimitSource;
}

function getProviderConfiguredContextLimit(
	modelId: string,
	providerConfig?: AIProviderConfig | ProviderConfig,
): ResolvedContextLimit | null {
	if (!providerConfig) {
		return null;
	}

	const normalizedModelId = modelId.toLowerCase();
	const contextWindows = providerConfig.contextWindows;
	if (contextWindows) {
		for (const [configuredModel, configuredLimit] of Object.entries(
			contextWindows,
		)) {
			if (
				configuredModel.toLowerCase() === normalizedModelId &&
				typeof configuredLimit === 'number' &&
				configuredLimit > 0
			) {
				return {
					limit: configuredLimit,
					source: 'provider-model-config',
				};
			}
		}
	}

	if (
		typeof providerConfig.contextWindow === 'number' &&
		providerConfig.contextWindow > 0
	) {
		return {
			limit: providerConfig.contextWindow,
			source: 'provider-config',
		};
	}

	return null;
}

/**
 * Get context limit for a model.
 * Resolution order:
 * 1. Session override (from /context-max command)
 * 2. Provider model config override
 * 3. Provider default context window
 * 4. PDM_CONTEXT_LIMIT env variable
 * 5. models.dev lookup / hardcoded Ollama defaults
 * 6. null (unknown)
 */
export async function resolveModelContextLimit(
	modelId: string,
	options: ModelContextLimitOptions = {},
): Promise<ResolvedContextLimit> {
	try {
		// Check session override first (highest priority)
		const sessionLimit = contextLimitSession.get();
		if (sessionLimit !== null) {
			return {limit: sessionLimit, source: 'session'};
		}

		const providerConfiguredLimit = getProviderConfiguredContextLimit(
			modelId,
			options.providerConfig,
		);
		if (providerConfiguredLimit) {
			return providerConfiguredLimit;
		}

		// Check environment variable fallback
		const envLimit = process.env.PDM_CONTEXT_LIMIT;
		if (envLimit) {
			const parsed = Number.parseInt(envLimit, 10);
			if (!Number.isNaN(parsed) && parsed > 0) {
				return {limit: parsed, source: 'env'};
			}
		}

		// Strip :cloud or -cloud suffix if present (Ollama cloud models)
		const normalizedModelId =
			modelId.endsWith(':cloud') || modelId.endsWith('-cloud')
				? modelId.slice(0, -6)
				: modelId;

		// Try models.dev exact ID match first (primary source)
		let modelInfo = await findModelById(normalizedModelId);

		// Try models.dev partial name match if exact match fails
		if (!modelInfo) {
			modelInfo = await findModelByName(normalizedModelId);
		}

		// If found in models.dev, return that
		if (modelInfo) {
			return {limit: modelInfo.contextLimit, source: 'model-lookup'};
		}

		// Fall back to hardcoded Ollama model defaults (offline fallback)
		const ollamaLimitOriginal = getOllamaFallbackContextLimit(modelId);
		if (ollamaLimitOriginal) {
			return {limit: ollamaLimitOriginal, source: 'model-lookup'};
		}

		const ollamaLimit = getOllamaFallbackContextLimit(normalizedModelId);
		if (ollamaLimit) {
			return {limit: ollamaLimit, source: 'model-lookup'};
		}

		return {limit: null, source: 'unknown'};
	} catch (error) {
		const logger = getLogger();
		logger.error(
			{error: formatError(error), modelId},
			'Error getting model context limit',
		);
		return {limit: null, source: 'unknown'};
	}
}

export async function getModelContextLimit(
	modelId: string,
	options: ModelContextLimitOptions = {},
): Promise<number | null> {
	const resolved = await resolveModelContextLimit(modelId, options);
	return resolved.limit;
}

/**
 * Per-model pricing memo. Both lookups below scan the whole database (and a
 * miss scans it twice), so the result, including the negative one for local
 * models that will never be on models.dev, is cached for the process.
 */
const pricingMemo = new Map<string, ModelInfo['cost'] | null>();

/**
 * Get pricing for a model in USD per 1M tokens.
 * Returns { input, output } from the cached models.dev database,
 * or null when the model isn't found (local model, no pricing data).
 */
export async function getModelPricing(
	modelId: string,
): Promise<ModelInfo['cost'] | null> {
	const memoized = pricingMemo.get(modelId);
	if (memoized !== undefined) {
		return memoized;
	}
	try {
		let modelInfo = await findModelById(modelId);

		if (!modelInfo) {
			modelInfo = await findModelByName(modelId);
		}

		const pricing = modelInfo ? modelInfo.cost : null;
		pricingMemo.set(modelId, pricing);
		return pricing;
	} catch {
		return null;
	}
}

/**
 * The two provider-config shapes in this codebase spell the endpoint
 * differently: `ProviderConfig` (config file / wizard) uses `baseUrl`, while
 * `AIProviderConfig` (runtime, AI SDK) nests it as `config.baseURL`.
 */
function providerBaseUrl(
	providerConfig: AIProviderConfig | ProviderConfig | undefined,
): string | undefined {
	if (!providerConfig) return undefined;
	if ('baseUrl' in providerConfig && providerConfig.baseUrl) {
		return providerConfig.baseUrl;
	}
	if ('config' in providerConfig) {
		const config = providerConfig.config as {baseURL?: string} | undefined;
		return config?.baseURL;
	}
	return undefined;
}

const visionSupportMemo = new Map<string, VisionSupport>();

/**
 * Can this model accept image input? Tri-state, and the 'unknown' case is
 * load-bearing: callers must only reroute on a confident 'no', never on
 * 'unknown', coverage for local tags is thin enough that "we don't know" is
 * common, and treating it as "no" would silently degrade models that can
 * actually see images.
 *
 * Resolution order, most to least authoritative:
 *   1. The serving Ollama instance's own `/api/show` capabilities, when a
 *      provider config points at one. This is the only source that can be
 *      right about a derived or renamed tag (`ornith-1.5:9b-pdm`), which no
 *      name-based table will ever match.
 *   2. models.dev modality data.
 *   3. The local Ollama name-pattern table, as an offline fallback.
 */
export async function getModelVisionSupport(
	modelId: string,
	options: ModelContextLimitOptions = {},
): Promise<VisionSupport> {
	const baseUrl = providerBaseUrl(options.providerConfig);
	const memoKey = baseUrl ? `${baseUrl} ${modelId}` : modelId;

	const memoized = visionSupportMemo.get(memoKey);
	if (memoized !== undefined) {
		return memoized;
	}

	let result: VisionSupport = 'unknown';
	try {
		const fromOllama = await getOllamaVisionCapability(baseUrl, modelId);
		if (fromOllama !== null) {
			result = fromOllama;
		} else {
			let modelInfo = await findModelById(modelId);
			if (!modelInfo) {
				modelInfo = await findModelByName(modelId);
			}

			if (modelInfo && modelInfo.supportsImageInput !== 'unknown') {
				result = modelInfo.supportsImageInput;
			} else if (isKnownOllamaVisionModel(modelId)) {
				result = 'yes';
			}
		}
	} catch {
		if (isKnownOllamaVisionModel(modelId)) {
			result = 'yes';
		}
	}

	visionSupportMemo.set(memoKey, result);
	return result;
}
