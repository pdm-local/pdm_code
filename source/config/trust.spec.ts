import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {UserPreferences} from '@/types/index';
import {addTrustedDirectory, isDirectoryTrusted} from './trust';

console.log('\ntrust.spec.ts');

const testConfigDir = join(tmpdir(), `pdm-test-trust-${Date.now()}`);
const getTestPreferencesPath = () => join(testConfigDir, 'pdm-preferences.json');

test.before(() => {
	process.env.PDM_CONFIG_DIR = testConfigDir;
	mkdirSync(testConfigDir, {recursive: true});
});

test.after.always(() => {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true, force: true});
	}
	delete process.env.PDM_CONFIG_DIR;
});

test.serial('a relative trusted entry such as "." never trusts the cwd', t => {
	const preferencesPath = getTestPreferencesPath();
	writeFileSync(
		preferencesPath,
		JSON.stringify({trustedDirectories: ['.', 'project']}),
		'utf-8',
	);

	try {
		t.false(isDirectoryTrusted(process.cwd()));
		t.false(isDirectoryTrusted(join(process.cwd(), 'project')));
	} finally {
		rmSync(preferencesPath, {force: true});
	}
});

test.serial('addTrustedDirectory persists an absolute path once', t => {
	const preferencesPath = getTestPreferencesPath();
	const dir = join(tmpdir(), 'pdm-trust-target');

	try {
		addTrustedDirectory(dir);
		addTrustedDirectory(dir);

		t.true(isDirectoryTrusted(dir));
		const parsed = JSON.parse(
			readFileSync(preferencesPath, 'utf-8'),
		) as UserPreferences;
		t.deepEqual(parsed.trustedDirectories, [dir]);
	} finally {
		rmSync(preferencesPath, {force: true});
	}
});
