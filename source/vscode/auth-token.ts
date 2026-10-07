/**
 * Shared secret between the CLI's VS Code WebSocket server and the extension.
 *
 * Binding to 127.0.0.1 keeps other machines out, but not a web page in the
 * user's browser (WebSockets are exempt from CORS) or another local user. The
 * CLI writes a per-run token to a 0600 file only the same OS user can read;
 * the extension sends it back in a header, which a browser cannot set.
 *
 * Imported by the extension bundle too, hence the relative import.
 */

import {chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {join} from 'path';
import {getConfigPath} from '../config/paths';

export const VSCODE_TOKEN_HEADER = 'x-pdm-token';

export function getVSCodeTokenPath(port: number): string {
	return join(getConfigPath(), 'vscode', `${port}.token`);
}

export function writeVSCodeToken(port: number, token: string): void {
	const dir = join(getConfigPath(), 'vscode');
	mkdirSync(dir, {recursive: true, mode: 0o700});
	chmodSync(dir, 0o700);
	writeFileSync(getVSCodeTokenPath(port), token, {mode: 0o600});
	chmodSync(getVSCodeTokenPath(port), 0o600);
}

export function readVSCodeToken(port: number): string | undefined {
	try {
		return readFileSync(getVSCodeTokenPath(port), 'utf-8').trim() || undefined;
	} catch {
		return undefined;
	}
}

export function removeVSCodeToken(port: number): void {
	rmSync(getVSCodeTokenPath(port), {force: true});
}
