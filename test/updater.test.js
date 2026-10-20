import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUpdater, compareVersions, HELPER_VERSION} from '../updater.js';
import {apply} from '../index.js';
function fixture(options = {}) {
  let bundle = {name: 'dshmarket', installed: true, removable: true, availability: 'profile', enabled: true, version: '1.0.0', source: 'dshmarket@1.0.0', ...options.bundle};
  const calls = [];
  const manager = {
    async listBundles() {return bundle ? [bundle] : [];},
    async removeBundle(name) {calls.push(['remove', name]); if (options.removeFail) return {application: 'failed', error: {code: 'stop-profile'}}; bundle = null; return {application: 'applied'};},
    async installBundle(spec, config) {
      calls.push(['install', spec, config]);
      if (options.installThrow && spec.endsWith('@2.0.0')) throw new Error('network lost');
      if (options.installFail && spec.endsWith('@2.0.0') || options.recoveryFail && spec.endsWith('@1.0.0')) return {application: 'failed', error: {code: 'incompatible-version'}};
      bundle = {name: 'dshmarket', installed: true, version: spec.split('@')[1], enabled: config.enabled};
      return {application: options.restart ? 'restart-required' : 'applied'};
    },
  };
  return {manager, calls};
}
test('helper status version follows package manifest', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(HELPER_VERSION, manifest.version);
  const f = fixture();
  assert.equal((await createUpdater(f.manager).status()).helperVersion, manifest.version);
});
test('stable version comparison rejects prerelease and downgrade', () => {
  assert.equal(compareVersions('1.66.44', '1.66.42'), 1);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.throws(() => compareVersions('2.0.0-beta.1', '1.0.0'));
});
test('update uses pinned registry spec and preserves disabled selection', async () => {
  const f = fixture({bundle: {enabled: false}});
  const u = createUpdater(f.manager, async () => '2.0.0');
  assert.equal((await u.update()).phase, 'succeeded');
  assert.deepEqual(f.calls.map(x => x[0]), ['remove', 'install']);
  assert.equal(f.calls[1][1], 'dshmarket@2.0.0');
  assert.equal(f.calls[1][2].enabled, false);
  assert.equal(f.calls[1][2].approvedBuilds, undefined);
});
test('already current makes no mutations', async () => {
  const f = fixture(); const u = createUpdater(f.manager, async () => '1.0.0');
  assert.equal((await u.update()).phase, 'current'); assert.equal(f.calls.length, 0);
});
test('network lookup failure leaves original untouched', async () => {
  const f = fixture(); const u = createUpdater(f.manager, async () => {throw new Error('offline');});
  assert.equal((await u.update()).phase, 'failed'); assert.equal(f.calls.length, 0);
});
test('failed removal stops before installation', async () => {
  const f = fixture({removeFail: true}); const u = createUpdater(f.manager, async () => '2.0.0');
  assert.equal((await u.update()).phase, 'failed'); assert.equal(f.calls.length, 1);
});
for (const kind of ['installFail', 'installThrow']) test(`${kind} recovers old version`, async () => {
  const f = fixture({[kind]: true}); const u = createUpdater(f.manager, async () => '2.0.0');
  const result = await u.update(); assert.equal(result.phase, 'rolled-back'); assert.equal(result.installedVersion, '1.0.0');
});
test('recovery failure stays explicit', async () => {
  const f = fixture({installFail: true, recoveryFail: true}); const u = createUpdater(f.manager, async () => '2.0.0');
  const result = await u.update(); assert.equal(result.phase, 'failed'); assert.equal(result.installed, false); assert.ok(result.recoveryResult);
});
test('concurrent requests coalesce', async () => {
  const f = fixture(); let release; const u = createUpdater(f.manager, () => new Promise(r => {release = r;}));
  const first = u.update(); const second = u.update(); assert.equal(first, second);
  await Promise.resolve(); release('2.0.0'); await first; assert.equal(f.calls.length, 2);
});
test('restart-required is not claimed live', async () => {
  const f = fixture({restart: true}); const u = createUpdater(f.manager, async () => '2.0.0');
  assert.equal((await u.update()).phase, 'restart-required');
});
test('local source is never replaced by npm', async () => {
  const f = fixture({bundle: {source: 'link:D:\\source'}}); const u = createUpdater(f.manager, async () => '2.0.0');
  assert.equal((await u.update()).phase, 'failed'); assert.equal(f.calls.length, 0);
});
test('Host route requires same-origin marker; tool fails closed on approval rejection', async () => {
  const f = fixture(); let route, tool; const cleanup = [];
  const ctx = {pluginManager: f.manager, provide: () => () => {}, effect: fn => {const d = fn(); if (d) cleanup.push(d);}, connection: {fetch: {register: r => {route = r; return () => {};}}}, tools: {register: t => {tool = t; return () => {};}}, approval: {request: async () => 'rejected'}};
  apply(ctx);
  const rejected = await route.fetch(new Request('http://localhost/api/market-update-helper', {method: 'POST', headers: {origin: 'http://other'}}));
  assert.equal(rejected.status, 403);
  await assert.rejects(tool.execute({action: 'update'}, {agent: {}, signal: new AbortController().signal}), /not authorized/);
  assert.equal(f.calls.length, 0);
  assert.equal((await tool.execute({action: 'status'}, {})).installedVersion, '1.0.0');
  for (const dispose of cleanup.reverse()) await dispose();
});
