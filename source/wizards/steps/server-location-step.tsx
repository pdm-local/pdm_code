import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useCallback, useEffect, useRef, useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {getColors} from '@/config';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {
	listMeshDevices,
	type MeshDevice,
	ollamaBaseUrl,
	type ProbeResult,
	probeOllama,
	type ReachFailure,
} from '@/setup/server-discovery';

/** Sentinels for the two rows that are not a discovered device. */
const MANUAL = '__manual__';
const THIS_DEVICE = '__this_device__';

export interface LocationChoice {
	label: string;
	value: string;
	detail: string;
	/** Absent on the manual-entry row. */
	baseUrl?: string;
	/** Absent on the manual-entry row. */
	device?: MeshDevice;
}

interface ServerLocationStepProps {
	/** Provider display name, e.g. "Ollama". */
	serverName: string;
	/** The template's own default, offered as "This device". */
	defaultBaseUrl: string;
	/** Chosen and confirmed reachable, or accepted without a reachable server. */
	onSelect: (baseUrl: string) => void;
	/** The user would rather type an address. */
	onManual: () => void;
}

type Phase =
	| {kind: 'loading'}
	| {kind: 'choose'}
	| {kind: 'probing'; choice: LocationChoice}
	| {kind: 'failed'; choice: LocationChoice; reason: ReachFailure};

/**
 * Ask which device runs the model server, offering the user's own machines
 * rather than making them recall an address.
 *
 * The step probes the choice before handing back a base URL, because the
 * failure it catches is near-universal: Ollama binds loopback by default, so a
 * remote box refuses the connection and the only fix is on the server. Letting
 * the wizard continue and fail later would present that as "no models found",
 * which points at the wrong machine entirely.
 */
export function ServerLocationStep({
	serverName,
	defaultBaseUrl,
	onSelect,
	onManual,
}: ServerLocationStepProps) {
	const colors = getColors();
	const {isNarrow} = useResponsiveTerminal();
	const [phase, setPhase] = useState<Phase>({kind: 'loading'});
	const [devices, setDevices] = useState<MeshDevice[]>([]);
	const mountedRef = useRef(true);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	useEffect(() => {
		void listMeshDevices().then(found => {
			if (!mountedRef.current) return;
			// Self is offered as "This device" with the template's own default URL,
			// so listing it again under its mesh address would be the same machine
			// twice by two routes.
			const others = found.filter(d => !d.isSelf);
			if (others.length === 0) {
				// Nothing to choose between, so asking "which device?" would be a
				// prompt with one real answer. Fall through to the base URL field,
				// which still accepts any address the user types.
				onManual();
				return;
			}
			setDevices(others);
			setPhase({kind: 'choose'});
		});
	}, [onManual]);

	const choices: LocationChoice[] = [
		{
			label: 'This device',
			value: THIS_DEVICE,
			detail: defaultBaseUrl,
			baseUrl: defaultBaseUrl,
		},
		...devices.map(device => ({
			label: device.hostname,
			value: device.address,
			detail: `${device.os} ${String.fromCharCode(0xb7)} ${ollamaBaseUrl(device.address)}`,
			baseUrl: ollamaBaseUrl(device.address),
			device,
		})),
		{
			label: 'Enter an address manually',
			value: MANUAL,
			detail: 'for a device not on this list',
		},
	];

	const handleSelect = useCallback(
		(choice: LocationChoice) => {
			if (choice.value === MANUAL || !choice.baseUrl) {
				onManual();
				return;
			}
			const baseUrl = choice.baseUrl;
			setPhase({kind: 'probing', choice});
			void probeOllama(baseUrl).then((result: ProbeResult) => {
				if (!mountedRef.current) return;
				if (result.ok) {
					onSelect(baseUrl);
					return;
				}
				setPhase({kind: 'failed', choice, reason: result.reason});
			});
		},
		[onSelect, onManual],
	);

	if (phase.kind === 'loading') {
		return (
			<Box>
				<Text color={colors.primary}>
					<Spinner type="dots" />
				</Text>
				<Text color={colors.secondary}> Looking for your devices...</Text>
			</Box>
		);
	}

	if (phase.kind === 'probing') {
		return (
			<Box>
				<Text color={colors.primary}>
					<Spinner type="dots" />
				</Text>
				<Text color={colors.secondary}>
					{' '}
					Checking {phase.choice.label} for {serverName}...
				</Text>
			</Box>
		);
	}

	if (phase.kind === 'failed') {
		return (
			<FailureNotice
				choice={phase.choice}
				reason={phase.reason}
				serverName={serverName}
				onRetry={() => handleSelect(phase.choice)}
				onChooseAnother={() => setPhase({kind: 'choose'})}
				onUseAnyway={() => {
					if (phase.choice.baseUrl) onSelect(phase.choice.baseUrl);
				}}
			/>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.primary}>
					{isNarrow
						? `Where does ${serverName} run?`
						: `Where is the ${serverName} model server running?`}
				</Text>
			</Box>
			<StyledSelectInput
				items={choices}
				onSelect={(item: LocationChoice) => handleSelect(item)}
				itemComponent={({isSelected, label, detail}) => (
					<Box flexDirection="column">
						<Text color={isSelected ? colors.primary : colors.text}>
							{label}
						</Text>
						<Box marginLeft={2}>
							<Text color={colors.secondary} wrap="truncate-end">
								{detail}
							</Text>
						</Box>
					</Box>
				)}
			/>
			{devices.length === 0 && !isNarrow && (
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						No other devices found. Connect them to the same private network to
						have them listed here.
					</Text>
				</Box>
			)}
		</Box>
	);
}

export interface FailureNoticeProps {
	choice: LocationChoice;
	reason: ReachFailure;
	serverName: string;
	onRetry: () => void;
	onChooseAnother: () => void;
	onUseAnyway: () => void;
}

/**
 * Explain the failure in terms of the machine that has to change.
 *
 * `refused` is the case worth spelling out: the port is closed because Ollama
 * is bound to loopback, which cannot be fixed from this side.
 */
export function FailureNotice({
	choice,
	reason,
	serverName,
	onRetry,
	onChooseAnother,
	onUseAnyway,
}: FailureNoticeProps) {
	const colors = getColors();
	const device = choice.device;
	const where = device ? device.hostname : 'this device';
	const address = device?.address;
	const isWindows = device?.os.toLowerCase() === 'windows';

	const options = [
		{label: 'Try again', value: 'retry'},
		{label: 'Pick a different device', value: 'another'},
		{label: 'Use this address anyway', value: 'anyway'},
	];

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color={colors.warning}>
					{reason === 'refused' &&
						`${where} refused the connection on that port.`}
					{reason === 'timeout' && `${where} did not answer in time.`}
					{reason === 'not-ollama' &&
						`Something is listening on ${where}, but it is not ${serverName}.`}
					{reason === 'unknown' && `Could not reach ${serverName} on ${where}.`}
				</Text>
			</Box>

			{reason === 'refused' && address && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.text}>
						Ollama binds loopback by default, so it is running but not listening
						on the network interface. On {where}, set OLLAMA_HOST to its address
						and restart Ollama:
					</Text>
					<Box marginTop={1} marginLeft={2}>
						<Text color={colors.secondary}>
							{isWindows
								? `setx OLLAMA_HOST ${address}:11434`
								: `sudo systemctl edit ollama, then add\nEnvironment="OLLAMA_HOST=${address}:11434"`}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Bind that address rather than 0.0.0.0: Ollama has no
							authentication, so 0.0.0.0 would serve every machine on the local
							network too.
						</Text>
					</Box>
				</Box>
			)}

			{reason === 'timeout' && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={colors.text}>
						Nothing refused the connection, so either the device is asleep or
						off the private network, or a firewall is dropping the port. A
						dropped packet times out where a closed port would be refused, so a
						running Ollama behind a firewall looks exactly like this.
					</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							If Ollama is running there, allow the port on the private
							interface only:
						</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color={colors.secondary}>
							sudo ufw allow in on tailscale0 to any port 11434 proto tcp
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Scoping the rule to that interface leaves the port closed to your
							local network, which matters because Ollama has no authentication.
						</Text>
					</Box>
				</Box>
			)}

			{reason === 'not-ollama' && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>
						Another service holds that port, or the address belongs to a
						different machine than you expect.
					</Text>
				</Box>
			)}

			<StyledSelectInput
				items={options}
				onSelect={(item: {value: string}) => {
					if (item.value === 'retry') onRetry();
					else if (item.value === 'another') onChooseAnother();
					else onUseAnyway();
				}}
			/>
		</Box>
	);
}
