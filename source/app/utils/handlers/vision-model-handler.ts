import {loadAllProviderConfigs} from '@/config/mcp-config-loader';
import {
	clearVisionModel,
	getVisionModel,
	updateVisionModel,
} from '@/config/preferences';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {getModelVisionSupport} from '@/models/index';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg, infoMsg, successMsg} from '@/utils/message-factory';

/**
 * Handles /vision-model command. Returns true if handled.
 *
 * The vision delegate is a preferences setting, not a provider entry in
 * agents.config.json - see the rationale in source/vision/vision-delegate.ts.
 * This command is the only way to set it.
 */
export async function handleVisionModelCommand(
	commandParts: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {onAddToChatQueue, onCommandComplete} = options;

	if (commandParts[0] !== 'vision-model') {
		return false;
	}

	const args = commandParts.slice(1);

	if (args[0] === '--clear') {
		clearVisionModel();
		onAddToChatQueue(
			successMsg('Vision delegate cleared.', 'vision-model-clear'),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	if (args.length >= 2 && args[0] && args[1]) {
		const provider = args[0];
		const model = args[1];
		const providerConfig = loadAllProviderConfigs().find(
			p => p.name === provider,
		);

		if (!providerConfig) {
			onAddToChatQueue(
				errorMsg(
					`Unknown provider "${provider}". Check agents.config.json.`,
					'vision-model-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		if (!providerConfig.models.includes(model)) {
			onAddToChatQueue(
				errorMsg(
					`"${model}" is not in ${provider}'s \`models\` list in agents.config.json. Add it there first.`,
					'vision-model-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		// Ask the serving instance itself, which is the only source that can be
		// right about a derived tag like `ornith-1.5:9b-pdm`.
		const support = await getModelVisionSupport(model, {providerConfig});
		if (support === 'no') {
			onAddToChatQueue(
				errorMsg(
					`"${model}" is confirmed to not accept image input, so it can't be a vision delegate.`,
					'vision-model-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
			return true;
		}

		updateVisionModel(provider, model);
		onAddToChatQueue(
			successMsg(
				`Vision delegate set to ${provider}/${model}.`,
				'vision-model-set',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	// No args: show the current setting plus any vision-capable models found
	// across configured providers, to help pick one.
	const current = getVisionModel();
	const lines: string[] = [
		current
			? `Vision delegate: ${current.provider}/${current.model}`
			: 'Vision delegate: not configured',
	];

	const candidates: string[] = [];
	for (const providerConfig of loadAllProviderConfigs()) {
		for (const model of providerConfig.models) {
			const support = await getModelVisionSupport(model, {providerConfig});
			if (support === 'yes') {
				candidates.push(`${providerConfig.name}/${model}`);
			}
		}
	}

	if (candidates.length > 0) {
		lines.push('', 'Vision-capable models found in your configured providers:');
		for (const candidate of candidates) {
			lines.push(`  ${candidate}`);
		}
		lines.push('', 'Set one with /vision-model <provider> <model>.');
	} else {
		lines.push(
			'',
			"No vision-capable models detected among configured providers. Add one to a provider's `models` list in agents.config.json, then set it with /vision-model <provider> <model>.",
		);
	}

	onAddToChatQueue(infoMsg(lines.join('\n'), 'vision-model-info'));
	setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
	return true;
}
