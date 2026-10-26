import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createUpdater, compareVersions, HELPER_VERSION} from '../updater.js';
import {apply, createUpdateRoute} from '../index.js';
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
test('check discovers a new release without changing installed packages', async () => {
  const f = fixture(); const u = createUpdater(f.manager, async () => '2.0.0');
  const result = await u.check();
  assert.equal(result.phase, 'idle'); assert.equal(result.busy, false);
  assert.equal(result.check.phase, 'succeeded'); assert.equal(result.check.latestVersion, '2.0.0');
  assert.equal(result.comparison, 'available'); assert.equal(result.updateAvailable, true);
  assert.ok(result.check.checkedAt); assert.deepEqual(f.calls, []);
});
for (const [installed, comparison] of [['2.0.0', 'current'], ['3.0.0', 'ahead'], ['2.0.0-beta.1', 'unsupported']]) {
  test(`check comparison: ${comparison}`, async () => {
    const f = fixture({bundle: {version: installed}}); const u = createUpdater(f.manager, async () => '2.0.0');
    const result = await u.check(); assert.equal(result.comparison, comparison);
    assert.equal(result.updateAvailable, comparison === 'unsupported' ? null : false); assert.deepEqual(f.calls, []);
  });
}
test('check failure invalidates an earlier successful result instead of reporting current', async () => {
  const f = fixture(); let fail = false;
  const u = createUpdater(f.manager, async () => {if (fail) throw new Error('offline'); return '1.0.0';});
  assert.equal((await u.check()).comparison, 'current'); fail = true;
  const result = await u.check(); assert.equal(result.check.phase, 'failed');
  assert.equal(result.check.latestVersion, null); assert.equal(result.updateAvailable, null);
  assert.equal(result.comparison, null); assert.match(result.check.error, /offline/); assert.deepEqual(f.calls, []);
});
test('invalid registry version is reported as a failed check', async () => {
  const f = fixture(); const u = createUpdater(f.manager, async () => 'not-a-version');
  assert.equal((await u.check()).check.phase, 'failed'); assert.deepEqual(f.calls, []);
});
test('concurrent checks share one npm query; status alone never queries npm', async () => {
  const f = fixture(); let release; let lookups = 0;
  const u = createUpdater(f.manager, () => {lookups++; return new Promise(resolve => {release = resolve;});});
  await u.status(); assert.equal(lookups, 0);
  const first = u.check(), second = u.check();
  const during = await u.status(); assert.equal(during.check.phase, 'checking'); assert.equal(during.updateAvailable, null);
  release('2.0.0'); await Promise.all([first, second]); assert.equal(lookups, 1); assert.deepEqual(f.calls, []);
});
test('an update shares an in-flight check and recomputes availability after installation', async () => {
  const f = fixture(); let release; let lookups = 0;
  const u = createUpdater(f.manager, () => {lookups++; return new Promise(resolve => {release = resolve;});});
  const check = u.check(), update = u.update();
  await Promise.resolve(); release('2.0.0');
  await Promise.all([check, update]);
  const result = await u.status(); assert.equal(lookups, 1); assert.equal(result.phase, 'succeeded');
  assert.equal(result.comparison, 'current'); assert.equal(result.updateAvailable, false);
});
test('checking does not erase a prior update failure', async () => {
  const f = fixture({removeFail: true}); const u = createUpdater(f.manager, async () => '2.0.0');
  await u.update(); const result = await u.check();
  assert.equal(result.phase, 'failed'); assert.match(result.error, /Remove/); assert.equal(result.updateAvailable, true);
});
test('uninstalled market is not reported as already current', async () => {
  const f = fixture(); await f.manager.removeBundle('dshmarket'); f.calls.length = 0;
  const u = createUpdater(f.manager, async () => '2.0.0'); const result = await u.check();
  assert.equal(result.comparison, 'not-installed'); assert.equal(result.updateAvailable, null); assert.deepEqual(f.calls, []);
});
test('check after disposal does not issue requests', async () => {
  const f = fixture(); let lookups = 0; const u = createUpdater(f.manager, async () => {lookups++; return '2.0.0';});
  await u.dispose(); await assert.rejects(u.check(), /disposed/); assert.equal(lookups, 0);
});
test('GET check invokes only discovery; unknown GET action cannot start installation', async () => {
  let checks = 0, updates = 0;
  const route = createUpdateRoute({async status() {return {};}, async check() {checks++; return {updateAvailable: true};}, async update() {updates++;}});
  const result = await route.fetch(new Request('http://dsh.internal/api/market-update-helper?action=check'));
  assert.equal(result.status, 200); assert.equal((await result.json()).updateAvailable, true);
  const bad = await route.fetch(new Request('http://dsh.internal/api/market-update-helper?action=update'));
  assert.equal(bad.status, 400); assert.equal(checks, 1); assert.equal(updates, 0);
});
// Route-level tests assume Connection has already authenticated the owner.
// Both Web and Desktop carriers are responsible for that admission boundary.
const routeCases = [
  ['bridge internal URL differs from browser Origin', {origin: 'http://127.0.0.1:56845', host: '127.0.0.1:56845'}, 200],
  ['localhost real host is supported', {origin: 'http://localhost:56845', host: 'localhost:56845'}, 200],
  ['HTTPS proxy Host uses Origin scheme', {origin: 'https://dsh.example', host: 'dsh.example:443'}, 200],
  ['authenticated desktop transport may omit Origin', {host: '127.0.0.1:56845'}, 200],
  ['cross-origin request rejected', {origin: 'https://evil.example', host: '127.0.0.1:56845'}, 403],
  ['wrong port rejected', {origin: 'http://127.0.0.1:1', host: '127.0.0.1:56845'}, 403],
  ['null Origin rejected', {origin: 'null', host: '127.0.0.1:56845'}, 403],
  ['Origin without Host rejected', {origin: 'http://127.0.0.1:56845'}, 403],
  ['cross-site Fetch Metadata rejected', {host: '127.0.0.1:56845', 'sec-fetch-site': 'cross-site'}, 403],
  ['forwarded host cannot bypass rejection', {origin: 'https://evil.example', host: '127.0.0.1:56845', 'x-forwarded-host': 'evil.example'}, 403],
];
for (const [label, headers, expected] of routeCases) test(`UI request: ${label}`, async () => {
  let updates = 0;
  const updater = {async status() {return {phase: 'idle', busy: false};}, async update() {updates++;}};
  const route = createUpdateRoute(updater);
  const request = new Request('http://dsh.internal/api/market-update-helper', {method: 'POST', headers: {'x-market-update-helper': '1', ...headers}});
  const result = await route.fetch(request);
  assert.equal(result.status, expected);
  assert.equal(updates, expected === 200 ? 1 : 0);
  assert.equal(result.headers.get('cache-control'), 'no-store');
});
test('UI request marker is mandatory even with a valid Origin', async () => {
  let updates = 0;
  const route = createUpdateRoute({async status() {return {};}, async update() {updates++;}});
  const result = await route.fetch(new Request('http://dsh.internal/api/market-update-helper', {method: 'POST', headers: {origin: 'http://localhost:56845', host: 'localhost:56845'}}));
  assert.equal(result.status, 403); assert.equal(updates, 0);
});
test('reading status never starts an update', async () => {
  let updates = 0;
  const route = createUpdateRoute({async status() {return {phase: 'idle'};}, async update() {updates++;}});
  const result = await route.fetch(new Request('http://dsh.internal/api/market-update-helper'));
  assert.equal(result.status, 200); assert.equal(updates, 0);
});
test('agent check action only discovers versions and does not request mutation approval', async t => {
  const f = fixture(); let tool, approvals = 0; const cleanup = [];
  t.mock.method(globalThis, 'fetch', async () => Response.json({name: 'dshmarket', version: '2.0.0'}));
  const ctx = {pluginManager: f.manager, provide: () => () => {}, effect: fn => {const d = fn(); if (d) cleanup.push(d);}, connection: {fetch: {register: () => () => {}}}, tools: {register: definition => {tool = definition; return () => {};}}, approval: {request: async () => {approvals++; return 'rejected';}}};
  apply(ctx);
  try {
    const result = await tool.execute({action: 'check'}, {});
    assert.equal(result.updateAvailable, true); assert.equal(approvals, 0); assert.deepEqual(f.calls, []);
  } finally {for (const dispose of cleanup.reverse()) await dispose();}
});
test('Host route requires UI marker; tool fails closed on approval rejection', async () => {
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
