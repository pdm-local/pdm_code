import {readFileSync, statSync, writeFileSync} from 'fs';
import type {TitleShape} from '@/components/ui/styled-title';
import {getClosestConfigFile} from '@/config/index';
import type {TuneConfig} from '@/types/config';
import type {UserPreferences} from '@/types/index';
import type {PdmShape, ThemePreset} from '@/types/ui';
import {logError} from '@/utils/message-queue';

let PREFERENCES_PATH: string | null = null;
let CACHED_CONFIG_DIR: string | undefined = undefined;

function getPreferencesPath(): string {
	// Re-compute path if PDM_CONFIG_DIR has changed (important for tests)
	const currentConfigDir = process.env.PDM_CONFIG_DIR;
	if (!PREFERENCES_PATH || CACHED_CONFIG_DIR !== currentConfigDir) {
		PREFERENCES_PATH = getClosestConfigFile('pdm-preferences.json');
		CACHED_CONFIG_DIR = currentConfigDir;
	}
	return PREFERENCES_PATH;
}

// Parsed-content cache. `loadPreferences` is called from render bodies and from
// 25 getters in this file, so during streaming it was running a readFileSync +
// JSON.parse per render - i.e. per token.
//
// Validated against the file's own mtime and size rather than only the write
// counter below, because the file is legitimately written from outside this
// module (tests write it directly, and a second pdm process shares it). A stale
// preference read is a silent wrong-setting bug, so the check has to survive
// writes this module never saw.
let cachedPreferences: UserPreferences | null = null;
let cachedPreferencesPath: string | null = null;
let cachedPreferencesMtimeMs = -1;
let cachedPreferencesSize = -1;

function invalidatePreferencesCache(): void {
	cachedPreferences = null;
	cachedPreferencesPath = null;
	cachedPreferencesMtimeMs = -1;
	cachedPreferencesSize = -1;
}

// Export for testing purposes - allows tests to reset the cache
export function resetPreferencesCache(): void {
	PREFERENCES_PATH = null;
	CACHED_CONFIG_DIR = undefined;
	invalidatePreferencesCache();
}

export function loadPreferences(): UserPreferences {
	const path = getPreferencesPath();

	try {
		const stats = statSync(path);
		if (
			cachedPreferences !== null &&
			cachedPreferencesPath === path &&
			cachedPreferencesMtimeMs === stats.mtimeMs &&
			cachedPreferencesSize === stats.size
		) {
			return cachedPreferences;
		}

		const parsed = JSON.parse(readFileSync(path, 'utf-8')) as UserPreferences;

		cachedPreferences = parsed;
		cachedPreferencesPath = path;
		cachedPreferencesMtimeMs = stats.mtimeMs;
		cachedPreferencesSize = stats.size;

		return parsed;
	} catch (error) {
		// A missing file is the normal first-run state, not an error worth
		// surfacing on every call.
		if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
			logError(`Failed to load preferences: ${String(error)}`);
		}
	}

	invalidatePreferencesCache();
	return {};
}

// Preferences are written straight to disk, so React has no natural signal that
// a setting flipped. Consumers holding derived state (e.g. the memoized system
// prompt in useChatHandler) subscribe here and re-read on the next render.
let preferencesVersion = 0;
const preferencesListeners = new Set<() => void>();

/**
 * Subscribe to preference writes. Returns an unsubscribe function, matching the
 * shape React's useSyncExternalStore expects.
 */
export function subscribeToPreferences(listener: () => void): () => void {
	preferencesListeners.add(listener);
	return () => {
		preferencesListeners.delete(listener);
	};
}

/**
 * Monotonic counter bumped on every successful preferences write. Reading it is
 * free (no file I/O), which is what makes it safe as a snapshot for
 * useSyncExternalStore - unlike the getters below, which hit the disk.
 */
export function getPreferencesVersion(): number {
	return preferencesVersion;
}

export function savePreferences(preferences: UserPreferences): void {
	// Invalidated before the write, not after, and unconditionally. Callers
	// reach here by mutating the object loadPreferences handed them, which is
	// the cached instance - so if the write fails, the cache would otherwise
	// keep serving a change that never reached disk.
	invalidatePreferencesCache();

	try {
		writeFileSync(getPreferencesPath(), JSON.stringify(preferences, null, 2));
	} catch (error) {
		logError(`Failed to save preferences: ${String(error)}`);
		return;
	}

	preferencesVersion++;
	for (const listener of preferencesListeners) {
		listener();
	}
}

export function updateLastUsed(provider: string, model: string): void {
	const preferences = loadPreferences();
	preferences.lastProvider = provider;
	preferences.lastModel = model;

	// Also save the model for this specific provider
	if (!preferences.providerModels) {
		preferences.providerModels = {};
	}
	preferences.providerModels[provider] = model;

	savePreferences(preferences);
}

export function updateTitleShape(shape: string): void {
	const preferences = loadPreferences();
	preferences.titleShape = shape as TitleShape;
	savePreferences(preferences);
}

export function getTitleShape(): TitleShape | undefined {
	const preferences = loadPreferences();
	return preferences.titleShape;
}

export function updateSelectedTheme(theme: string): void {
	const preferences = loadPreferences();
	preferences.selectedTheme = theme as ThemePreset;
	savePreferences(preferences);
}

export function getLastUsedModel(provider: string): string | undefined {
	const preferences = loadPreferences();
	return preferences.providerModels?.[provider];
}

export function updatePdmShape(shape: PdmShape): void {
	const preferences = loadPreferences();
	preferences.pdmShape = shape;
	savePreferences(preferences);
}

export function getPdmShape(): PdmShape | undefined {
	const preferences = loadPreferences();
	return preferences.pdmShape;
}

export function updateVisionModel(provider: string, model: string): void {
	const preferences = loadPreferences();
	preferences.visionModel = {provider, model};
	savePreferences(preferences);
}

export function getVisionModel():
	| {provider: string; model: string}
	| undefined {
	const preferences = loadPreferences();
	return preferences.visionModel;
}

export function clearVisionModel(): void {
	const preferences = loadPreferences();
	delete preferences.visionModel;
	savePreferences(preferences);
}

export function saveTune(config: TuneConfig): void {
	const preferences = loadPreferences();
	preferences.tune = config;
	savePreferences(preferences);
}

/**
 * Get the notifications config from the preferences file.
 */
export function getNotificationsPreference():
	| import('@/types/config').NotificationsConfig
	| undefined {
	const preferences = loadPreferences();
	return preferences.notifications;
}

/**
 * Save the notifications config to the preferences file.
 */
export function updateNotificationsPreference(
	config: import('@/types/config').NotificationsConfig,
): void {
	const preferences = loadPreferences();
	preferences.notifications = config;
	savePreferences(preferences);
}

/**
 * Get the paste threshold from the preferences file.
 */
export function getPasteThreshold(): number | undefined {
	const preferences = loadPreferences();
	const threshold = preferences.paste?.singleLineThreshold;
	if (typeof threshold === 'number' && threshold > 0) {
		return Math.round(threshold);
	}
	return undefined;
}

/**
 * Save the paste threshold to the preferences file.
 */
export function updatePasteThreshold(threshold: number): void {
	const preferences = loadPreferences();
	if (!preferences.paste) {
		preferences.paste = {singleLineThreshold: Math.round(threshold)};
	} else {
		preferences.paste.singleLineThreshold = Math.round(threshold);
	}
	savePreferences(preferences);
}

/**
 * Get the reasoning expanded preference from preferences or environment
 */
export function getReasoningExpanded(): boolean {
	const preferences = loadPreferences();
	return preferences.reasoningExpanded ?? false;
}

/**
 * Save the reasoning expanded preference
 */
export function updateReasoningExpanded(value: boolean): void {
	const preferences = loadPreferences();
	preferences.reasoningExpanded = value;
	savePreferences(preferences);
}

/**
 * Get the compact tool display preference from preferences or environment
 */
export function getCompactToolDisplay(): boolean {
	const preferences = loadPreferences();
	return preferences.compactToolDisplay ?? true;
}

/**
 * Save the compact tool display preference
 */
export function updateCompactToolDisplay(value: boolean): void {
	const preferences = loadPreferences();
	preferences.compactToolDisplay = value;
	savePreferences(preferences);
}

/**
 * Get the per-response usage footer preference. On by default.
 */
export function getShowUsageFooter(): boolean {
	const preferences = loadPreferences();
	return preferences.showUsageFooter ?? true;
}

/**
 * Save the per-response usage footer preference
 */
export function updateShowUsageFooter(value: boolean): void {
	const preferences = loadPreferences();
	preferences.showUsageFooter = value;
	savePreferences(preferences);
}

/**
 * Get the privacy scrubbing preference from preferences
 */
export function getPrivacyPreference(): boolean {
	const preferences = loadPreferences();
	return preferences.enablePromptScrubbing ?? false;
}

/**
 * Save the privacy scrubbing preference
 */
export function updatePrivacyPreference(value: boolean): void {
	const preferences = loadPreferences();
	preferences.enablePromptScrubbing = value;
	savePreferences(preferences);
}

/**
 * Get the alternate-screen (fullscreen) preference. Also settable via
 * --alt-screen/--no-alt-screen at launch; this is the persisted default.
 */
export function getAlternateScreen(): boolean {
	const preferences = loadPreferences();
	return preferences.alternateScreen ?? false;
}

/**
 * Save the alternate-screen preference
 */
export function updateAlternateScreen(value: boolean): void {
	const preferences = loadPreferences();
	preferences.alternateScreen = value;
	savePreferences(preferences);
}

/**
 * Get the professional ("boring") tone preference. When on, progress text is
 * strictly functional and the model is instructed to keep responses terse.
 */
export function getProfessionalTone(): boolean {
	const preferences = loadPreferences();
	return preferences.professionalTone ?? false;
}

/**
 * Save the professional tone preference
 */
export function updateProfessionalTone(value: boolean): void {
	const preferences = loadPreferences();
	preferences.professionalTone = value;
	savePreferences(preferences);
}
