import {mkdirSync, readFileSync, writeFileSync} from 'fs';
import {isAbsolute, join, resolve} from 'path';
import {getConfigPath} from '@/config/paths';
import type {UserPreferences} from '@/types/index';

// Trust must never be granted by a file the project can ship itself. A
// cwd-local pdm-preferences.json shadows every other preference, so the trust
// list is read from and written to the user-level file only, and only
// absolute entries count (a relative "." would match whatever cwd reads it).
function getUserPreferencesPath(): string {
	return join(getConfigPath(), 'pdm-preferences.json');
}

function readUserPreferences(): UserPreferences {
	try {
		return JSON.parse(
			readFileSync(getUserPreferencesPath(), 'utf-8'),
		) as UserPreferences;
	} catch {
		return {};
	}
}

export function getTrustedDirectories(): string[] {
	const entries = readUserPreferences().trustedDirectories;
	if (!Array.isArray(entries)) return [];
	return entries
		.filter(
			(entry): entry is string =>
				typeof entry === 'string' && isAbsolute(entry),
		)
		.map(entry => resolve(entry));
}

export function isDirectoryTrusted(directory: string): boolean {
	const normalized = resolve(directory);
	return getTrustedDirectories().includes(normalized);
}

export function addTrustedDirectory(directory: string): void {
	const normalized = resolve(directory);
	if (isDirectoryTrusted(normalized)) return;

	const preferences = readUserPreferences();
	preferences.trustedDirectories = [
		...(preferences.trustedDirectories ?? []),
		normalized,
	];
	mkdirSync(getConfigPath(), {recursive: true});
	writeFileSync(getUserPreferencesPath(), JSON.stringify(preferences, null, 2));
}
