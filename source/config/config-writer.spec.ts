import {chmodSync, mkdtempSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {writeConfigFileAtomic} from './config-writer';

console.log('\nconfig-writer.spec.ts');

test('writeConfigFileAtomic leaves the config owner-only', t => {
	if (process.platform === 'win32') {
		t.pass('POSIX file modes only');
		return;
	}
	const dir = mkdtempSync(join(tmpdir(), 'pdm-config-writer-'));
	const file = join(dir, 'agents.config.json');
	try {
		// An existing world-readable config is tightened on its next write.
		writeFileSync(file, '{}');
		chmodSync(file, 0o644);
		writeConfigFileAtomic(file, {pdm: {providers: [{apiKey: 'secret'}]}});
		t.is(statSync(file).mode & 0o777, 0o600);
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
});
