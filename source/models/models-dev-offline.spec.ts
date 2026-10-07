import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {MockAgent, setGlobalDispatcher} from 'undici';

console.log('\nmodels-dev-offline.spec.ts');

// Own spec file: the models.dev memo and xdg cache path are module state, so
// they must be fresh for this process.
const cacheHome = mkdtempSync(join(tmpdir(), 'pdm-offline-cache-'));

test.after.always(() => {
	rmSync(cacheHome, {recursive: true, force: true});
	delete process.env.PDM_OFFLINE;
});

test.serial('PDM_OFFLINE makes no request to models.dev', async t => {
	process.env.XDG_CACHE_HOME = cacheHome;
	process.env.PDM_OFFLINE = '1';

	const agent = new MockAgent();
	agent.disableNetConnect();
	agent
		.get('https://models.dev')
		.intercept({path: '/api.json', method: 'GET'})
		.reply(200, {});
	setGlobalDispatcher(agent);

	const {getModelPricing} = await import('./models-dev-client.js');
	t.is(await getModelPricing('some-model'), null);
	t.is(agent.pendingInterceptors().length, 1, 'models.dev was never called');
});
