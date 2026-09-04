/**
 * Routes images to a vision-capable model when the active chat model can't
 * accept image input itself. Deliberately independent of the parent
 * conversation's client and tool set: the delegate gets no tools (small
 * vision models are poor tool callers) and a system prompt oriented at
 * literal transcription rather than task completion.
 */

import {createLLMClient} from '@/client-factory';
import {getVisionModel} from '@/config/preferences';
import {getModelVisionSupport} from '@/models/index';
import type {ImageAttachment, LLMClient, Message} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getShutdownManager} from '@/utils/shutdown';

export class VisionUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VisionUnavailableError';
	}
}

const VISION_SYSTEM_PROMPT =
	"You are the vision component for a coding agent that cannot see images itself. Describe exactly what appears in the image: visible text (transcribe it verbatim), error messages, file paths, UI layout, diagrams, and any other detail relevant to a software task. Be literal and complete rather than interpretive, your description is the agent's only view of the image.";

const DEFAULT_QUESTION =
	'Describe this image in full detail for a coding agent that cannot see it.';

export interface DescribeImagesRequest {
	images: ImageAttachment[];
	question?: string;
	/**
	 * The chat session's current provider/model, used only as a fallback
	 * target when no delegate preference is set and it happens to support
	 * image input itself. Omit when there is no chat session in scope (e.g.
	 * the standalone analyze_image tool), a configured delegate is then
	 * required.
	 */
	currentProvider?: string;
	currentModel?: string;
}

export interface DescribeImagesResult {
	description: string;
	provider: string;
	model: string;
	elapsedMs: number;
}

/**
 * One client per delegate (provider, model) pair, reused across calls.
 * AISDKClient's constructor creates a fresh undici Agent, a client per
 * image would leak a keep-alive connection pool per call.
 */
const clientCache = new Map<string, LLMClient>();
let disposalRegistered = false;

/**
 * Indirection point for tests: specs inject a fake LLMClient here so
 * describeImages's success path can be exercised without contacting a real
 * provider. Production code never calls this setter.
 */
let clientFactory: typeof createLLMClient = createLLMClient;

/** Test-only: override how getOrCreateClient builds a client. Pass `null` to restore the real createLLMClient. */
export function __setClientFactoryForTesting(
	factory: typeof createLLMClient | null,
): void {
	clientFactory = factory ?? createLLMClient;
}

function ensureDisposalRegistered(): void {
	if (disposalRegistered) return;
	disposalRegistered = true;
	getShutdownManager().register({
		name: 'vision-delegate-clients',
		priority: 50,
		handler: async () => {
			const clients = Array.from(clientCache.values());
			clientCache.clear();
			await Promise.all(clients.map(client => client.dispose?.()));
		},
	});
}

async function getOrCreateClient(
	provider: string,
	model: string,
): Promise<LLMClient> {
	const key = `${provider}:${model}`;
	const cached = clientCache.get(key);
	if (cached) return cached;

	ensureDisposalRegistered();
	const {client} = await clientFactory(provider, model);
	clientCache.set(key, client);
	return client;
}

/** Exposed for tests: drops every cached delegate client without disposing them. */
export function resetVisionDelegateClients(): void {
	clientCache.clear();
}

async function resolveTarget(
	currentProvider?: string,
	currentModel?: string,
): Promise<{provider: string; model: string}> {
	const preference = getVisionModel();
	if (preference) {
		return preference;
	}

	if (currentProvider && currentModel) {
		const support = await getModelVisionSupport(currentModel);
		if (support === 'yes') {
			return {provider: currentProvider, model: currentModel};
		}
	}

	throw new VisionUnavailableError(
		currentModel
			? `No vision-capable model available. The current model '${currentModel}' does not accept image input, and no vision delegate is configured. Run /vision-model to pick one, or add a vision model to a provider's \`models\` list in agents.config.json.`
			: "No vision-capable model available. No vision delegate is configured. Run /vision-model to pick one, or add a vision model to a provider's `models` list in agents.config.json.",
	);
}

export async function describeImages(
	req: DescribeImagesRequest,
	options: {signal?: AbortSignal} = {},
): Promise<DescribeImagesResult> {
	const target = await resolveTarget(req.currentProvider, req.currentModel);

	let client: LLMClient;
	try {
		client = await getOrCreateClient(target.provider, target.model);
	} catch (error) {
		throw new VisionUnavailableError(
			`Could not start the vision delegate (${target.provider}/${target.model}): ${formatError(error)}`,
		);
	}

	const messages: Message[] = [
		{role: 'system', content: VISION_SYSTEM_PROMPT},
		{
			role: 'user',
			content: req.question?.trim() || DEFAULT_QUESTION,
			images: req.images,
		},
	];

	const start = Date.now();
	const response = await client.chat(messages, {}, {}, options.signal);
	const elapsedMs = Date.now() - start;

	const description = response.choices[0]?.message.content.trim() || '';
	if (!description) {
		throw new VisionUnavailableError(
			`The vision delegate (${target.provider}/${target.model}) returned an empty description.`,
		);
	}

	return {
		description,
		provider: target.provider,
		model: target.model,
		elapsedMs,
	};
}
