import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {memo, useEffect, useState} from 'react';
import {MODEL_STALL_WARNING_MS} from '@/constants';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
import {useTheme} from '@/hooks/useTheme';

/**
 * Shown while a turn is in flight but nothing has streamed back yet.
 *
 * Without this the live slot renders `null` between the user pressing enter
 * and the first token arriving - which, against a local model, is exactly the
 * window where the weights are being loaded into memory. That is routinely
 * 10-60 seconds of a completely blank screen with no sign the app is alive.
 *
 * The only thing changing here is a seconds counter, so it ticks at 1Hz rather
 * than the 10Hz used by the older progress components.
 */
export default memo(function WaitingIndicator({model}: {model: string}) {
	const {colors} = useTheme();
	const nonInteractive = useNonInteractiveRender();
	const [elapsedMs, setElapsedMs] = useState(0);

	useEffect(() => {
		const startedAt = Date.now();
		const timer = setInterval(() => {
			setElapsedMs(Date.now() - startedAt);
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	// `run` mode prints its own status line and has no spinner surface.
	if (nonInteractive) return null;

	const seconds = Math.floor(elapsedMs / 1000);
	const stalled = elapsedMs >= MODEL_STALL_WARNING_MS;

	return (
		<Box flexDirection="column" marginBottom={1} marginTop={1}>
			<Box>
				<Text color={stalled ? colors.warning : colors.info} bold>
					<Spinner type="dots" /> {model}
				</Text>
				<Text color={colors.secondary}>
					{stalled
						? ` · no response for ${seconds}s, a large local model may still be loading`
						: ' · waiting for the first token'}
					{/* Below ~2s the counter is noise, not information. */}
					{seconds >= 2 && !stalled ? ` · ${seconds}s` : ''}
				</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={colors.secondary}>Press Escape to cancel</Text>
			</Box>
		</Box>
	);
});
