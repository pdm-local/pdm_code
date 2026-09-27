import test from 'ava';
import {createTerminalFileLink} from './terminal-file-link';

test('createTerminalFileLink creates an OSC 8 file URL with the supplied label', t => {
	// Platform-appropriate: `/tmp/...` is not absolute on Windows, so
	// pathToFileURL prefixes the current drive and the expected string would
	// differ by a drive letter rather than by anything meaningful.
	const isWindows = process.platform === 'win32';
	const path = isWindows ? 'C:\\tmp\\implementation plan.md' : '/tmp/implementation plan.md';
	const expectedUrl = isWindows
		? 'file:///C:/tmp/implementation%20plan.md'
		: 'file:///tmp/implementation%20plan.md';

	const link = createTerminalFileLink(path, 'Plan');

	t.is(link, `\u001B]8;;${expectedUrl}\u0007Plan\u001B]8;;\u0007`);
});
