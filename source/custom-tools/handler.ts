import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {TRUNCATION_OUTPUT_LIMIT} from '@/constants';
import {renderBody} from '@/custom-tools/template';
import type {CustomToolMetadata} from '@/types/custom-tools';
import type {ToolHandler} from '@/types/index';
import {isRealPathInside} from '@/utils/path-validation';
import {truncateToolResult} from '@/utils/truncate-tool-result';

/**
 * Build a `ToolHandler` that renders the script body and runs it under the
 * configured shell. Captures stdout + stderr, applies the timeout, and
 * returns the trimmed/truncated combined output.
 */
export function buildHandler(
	metadata: CustomToolMetadata,
	body: string,
	projectRoot: string,
): ToolHandler {
	return async (args: Record<string, unknown>): Promise<string> => {
		const rendered = renderBody(body, args ?? {});
		const cwd = resolveCwd(metadata.cwd, projectRoot);
		const env = mergeEnv(metadata.env);
		const shell = pickShell(metadata.shell);
		return runScript(rendered, {
			cwd,
			env,
			shell,
			timeoutMs: metadata.timeoutMs,
		});
	};
}

export interface RunOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	shell: string;
	timeoutMs: number;
}

/**
 * Spawn the shell with the rendered script and wait for completion.
 *
 * Always returns the captured output (matching `execute_bash`'s behavior). A
 * non-zero exit gets an `EXIT_CODE: N` prefix and stderr/stdout sections so
 * the LLM can reason about it, but is NOT treated as a tool failure, many
 * CLIs (`pnpm audit`, `git diff --exit-code`, `grep`, test runners) exit
 * non-zero as part of normal operation. Throws are reserved for genuine tool
 * failures: spawn errors (command not found) and timeouts.
 */
export function runScript(
	script: string,
	options: RunOptions,
): Promise<string> {
	return new Promise((resolvePromise, rejectPromise) => {
		// Own process group on POSIX, so a timeout reaches whatever the script
		// spawned: a surviving grandchild keeps the stdout pipe open and the
		// run would never settle.
		const groupKill = process.platform !== 'win32';
		const child = spawn(options.shell, ['-c', script], {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: groupKill,
		});
		const kill = (signal: NodeJS.Signals) => {
			try {
				if (groupKill && child.pid !== undefined) {
					process.kill(-child.pid, signal);
				} else {
					child.kill(signal);
				}
			} catch {
				// Already gone.
			}
		};

		let stdout = '';
		let stderr = '';
		let timedOut = false;
		let closed = false;

		const timer = setTimeout(() => {
			timedOut = true;
			kill('SIGTERM');
			// Force-kill if the group refuses to exit within a grace window.
			// Keyed on `closed`, not `child.killed`: that turns true as soon as
			// SIGTERM is *sent*, so the escalation never fired.
			setTimeout(() => {
				if (!closed) kill('SIGKILL');
			}, 1_000).unref();
		}, options.timeoutMs);

		child.stdout?.on('data', chunk => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', chunk => {
			stderr += chunk.toString();
		});

		child.on('error', err => {
			clearTimeout(timer);
			rejectPromise(new Error(`Custom tool failed to start: ${err.message}`));
		});

		child.on('close', code => {
			closed = true;
			clearTimeout(timer);
			if (timedOut) {
				rejectPromise(
					new Error(`Custom tool timed out after ${options.timeoutMs}ms`),
				);
				return;
			}
			resolvePromise(
				truncateToolResult(
					formatScriptOutput(code, stdout, stderr),
					TRUNCATION_OUTPUT_LIMIT,
				),
			);
		});
	});
}

/**
 * Format the captured output for the LLM. Mirrors `formatBashResultForLLM`
 * in `source/tools/execute-bash.tsx`: always include `EXIT_CODE: N` (so the
 * LLM can tell success from failure on every call, consistent with
 * `execute_bash`) and split stderr/stdout sections when stderr is present.
 */
function formatScriptOutput(
	code: number | null,
	stdout: string,
	stderr: string,
): string {
	const exitCode = code ?? 0;
	const out = stdout.trimEnd();
	const err = stderr.trimEnd();
	const prefix = `EXIT_CODE: ${exitCode}\n`;
	if (err) {
		return `${prefix}STDERR:\n${err}\nSTDOUT:\n${out}`;
	}
	return `${prefix}${out}`;
}

/**
 * Resolve the working directory with `${VAR}` substitution from process.env.
 * Relative paths resolve against the project root.
 *
 * Returns the project root if the configured directory doesn't exist, so we
 * don't hard-fail on a stale checkout.
 *
 * Throws if the directory exists but really sits outside the project once
 * symlinks are resolved (a symlinked `./scripts`, an absolute path, `${HOME}`).
 * Falling back to the project root would be worse than refusing: a tool whose
 * body is `rm -rf ./*` and whose cwd was meant to be a scratch directory would
 * then run that against the project itself. The escape is a misconfiguration
 * and the user needs to see it, not have it silently redirected.
 *
 * Note this is containment, not a sandbox, the rendered body is arbitrary
 * shell and can `cd` anywhere it likes.
 */
export function resolveCwd(
	configured: string | undefined,
	projectRoot: string,
): string {
	if (!configured) return projectRoot;
	const expanded = expandVars(configured);
	const absolute = isAbsolute(expanded)
		? expanded
		: resolve(projectRoot, expanded);
	if (!existsSync(absolute)) return projectRoot;
	if (!isRealPathInside(absolute, projectRoot)) {
		throw new Error(
			`Custom tool cwd escapes the project directory: ${configured} -> ${absolute}`,
		);
	}
	return absolute;
}

/**
 * Merge configured env vars into `process.env`, performing `${VAR}`
 * substitution on values. Keys with no value resolve to an empty string.
 */
export function mergeEnv(
	configured: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
	const base: NodeJS.ProcessEnv = {...process.env};
	if (!configured) return base;
	for (const [k, v] of Object.entries(configured)) {
		base[k] = expandVars(v);
	}
	return base;
}

const PROCESS_ENV_REF =
	/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Expand `$VAR`, `${VAR}`, and `${VAR:-default}` references using values
 * from `process.env`. Unknown vars without a default expand to "".
 */
export function expandVars(value: string): string {
	return value.replace(PROCESS_ENV_REF, (_match, braced, def, bare) => {
		const name = braced ?? bare;
		const v = process.env[name];
		if (v !== undefined) return v;
		return def ?? '';
	});
}

function pickShell(configured: string | undefined): string {
	if (configured === 'bash') return '/bin/bash';
	if (configured === 'sh') return '/bin/sh';
	// Not cmd.exe: arguments are POSIX single-quoted (template.ts), which
	// cmd.exe does not understand, so `&` or `|` in a model-supplied value
	// would run as a command. Git for Windows puts bash on PATH; without it
	// the spawn fails with a clear "failed to start" instead.
	if (process.platform === 'win32') return 'bash';
	if (existsSync('/bin/bash')) return '/bin/bash';
	return '/bin/sh';
}
