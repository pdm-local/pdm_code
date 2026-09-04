import test from 'ava';
import {existsSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {clearAppConfig} from '@/config/index';
import {isPdmCodeToolAlwaysAllowed} from '@/config/pdm-tools-config';

const testConfigDir = join(process.cwd(), '.test-config-pdm-tools');
const testConfigPath = join(testConfigDir, 'agents.config.json');

function setupConfig(config: Record<string, unknown>) {
	if (!existsSync(testConfigDir)) {
		mkdirSync(testConfigDir, {recursive: true});
	}
	writeFileSync(testConfigPath, JSON.stringify(config));
}

function cleanupConfig() {
	if (existsSync(testConfigDir)) {
		rmSync(testConfigDir, {recursive: true});
	}
}

// Save and restore cwd for tests that change it
const originalCwd = process.cwd();

test.afterEach(() => {
	process.chdir(originalCwd);
	clearAppConfig();
	cleanupConfig();
});

test.serial(
	'isPdmCodeToolAlwaysAllowed returns true for tool in top-level alwaysAllow',
	t => {
		setupConfig({
			pdm: {
				alwaysAllow: ['execute_bash', 'read_file'],
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.true(isPdmCodeToolAlwaysAllowed('execute_bash'));
		t.true(isPdmCodeToolAlwaysAllowed('read_file'));
		t.false(isPdmCodeToolAlwaysAllowed('write_file'));
	},
);

test.serial(
	'isPdmCodeToolAlwaysAllowed ignores removed pdmTools.alwaysAllow path',
	t => {
		setupConfig({
			pdm: {
				pdmTools: {
					alwaysAllow: ['execute_bash'],
				},
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.false(isPdmCodeToolAlwaysAllowed('execute_bash'));
	},
);

test.serial(
	'isPdmCodeToolAlwaysAllowed returns false when no config exists',
	t => {
		clearAppConfig();

		t.false(isPdmCodeToolAlwaysAllowed('execute_bash'));
	},
);

test.serial(
	'isPdmCodeToolAlwaysAllowed returns false when alwaysAllow is not an array',
	t => {
		setupConfig({
			pdm: {
				alwaysAllow: 'execute_bash',
			},
		});
		process.chdir(testConfigDir);
		clearAppConfig();

		t.false(isPdmCodeToolAlwaysAllowed('execute_bash'));
	},
);
