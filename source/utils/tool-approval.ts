import {isPdmCodeToolAlwaysAllowed} from '@/config/pdm-tools-config';
import type {DevelopmentMode} from '@/types/core';

// Writing any of these turns an auto-approved edit into code execution or a
// policy change: git runs hooks and config commands (core.fsmonitor,
// diff.external) from the read-only git tools, and the rest is config PDM Code
// itself loads. Compared case-insensitively for macOS and Windows filesystems.
const PROTECTED_DIRS = new Set(['.git', '.pdm']);
const PROTECTED_FILES = new Set([
	'.mcp.json',
	'agents.config.json',
	'pdm-preferences.json',
]);

function isProtectedPath(filePath: string): boolean {
	const parts = filePath.toLowerCase().split(/[\\/]+/);
	if (parts.some(part => PROTECTED_DIRS.has(part))) return true;
	const name = parts.at(-1) ?? '';
	return PROTECTED_FILES.has(name) || /^\.env(\..*)?$/.test(name);
}

/** Whether a file tool's arguments touch a path that must always prompt. */
function touchesProtectedPath(args: unknown): boolean {
	if (!args || typeof args !== 'object') return false;
	const {path, file_path, destination} = args as Record<string, unknown>;
	return [path, file_path, destination].some(
		value => typeof value === 'string' && isProtectedPath(value),
	);
}

/**
 * Creates an approval policy for file-mutation tools.
 * Protected paths always require approval (so a headless run, with nobody to
 * ask, refuses them). Otherwise returns false (no approval) if the tool is
 * always-allowed or the current mode is auto-accept/headless. (Yolo is
 * bypassed centrally by resolveToolApproval.)
 *
 * Mode is supplied by the caller (the central approval resolver), never read
 * from a global.
 */
export function createFileToolApproval(
	toolName: string,
): (args: unknown, mode: DevelopmentMode) => boolean {
	return (args, mode) => {
		if (touchesProtectedPath(args)) return true;
		if (isPdmCodeToolAlwaysAllowed(toolName)) return false;
		return mode !== 'auto-accept' && mode !== 'headless';
	};
}
