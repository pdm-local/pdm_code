#!/usr/bin/env node
/**
 * Post-build steps that used to be `cp` + `chmod` in the build script.
 *
 * Those are POSIX commands: neither exists in cmd.exe or PowerShell, so
 * `pnpm build` failed outright on a clean Windows checkout. Doing the same work
 * in Node keeps the build identical on every platform without adding a
 * dependency.
 */
import {chmodSync, copyFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// The contributors list is data, not code, so tsc never emits it. It is the
// record of upstream authorship that `/credits` reads - see LICENSE.md.
const contributorsTo = join(root, 'dist', 'commands', 'contributors.json');
mkdirSync(dirname(contributorsTo), {recursive: true});
copyFileSync(
	join(root, 'source', 'commands', 'contributors.json'),
	contributorsTo,
);

// Windows has no execute bit; the shebang is honoured by the `pdm` shim there
// instead, so skipping this is correct rather than a degradation.
if (process.platform !== 'win32') {
	chmodSync(join(root, 'dist', 'cli.js'), 0o755);
}
