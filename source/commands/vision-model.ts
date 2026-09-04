import {createStubCommand} from '@/commands/create-stub-command';

/**
 * The /vision-model command sets the vision delegate model used to describe
 * images when the active model can't accept image input.
 *
 * Note: The actual command logic is handled in app-util.ts via
 * handleVisionModelCommand() because it requires access to app state that
 * isn't available through the standard command handler interface.
 *
 * Usage:
 * /vision-model                    - Show current delegate and candidates
 * /vision-model <provider> <model> - Set the delegate
 * /vision-model --clear            - Clear the delegate
 */
export const visionModelCommand = createStubCommand(
	'vision-model',
	'Set the vision model used to describe images (e.g. /vision-model ollama gemma3:4b)',
);
