import {readFileSync} from 'node:fs';
// One source of truth: npm version also drives the UI and status endpoint.
export const HELPER_VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
export const NAME = 'dshmarket';
export const REGISTRY = 'https://registry.npmjs.org/';
const good = r => ['applied', 'restart-required'].includes(r?.application);
const diagnostic = r => r?.error?.diagnostic || r?.error?.code || r?.packageResult?.output || r?.application || 'Unknown failure';
export function compareVersions(a, b) {
  const parse = s => /^\d+\.\d+\.\d+$/.test(s || '') ? s.split('.').map(Number) : null;
  const x = parse(a), y = parse(b);
  if (!x || !y) throw new Error('Only stable semantic versions are supported.');
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export async function latestRelease() {
  const response = await fetch(`${REGISTRY}${NAME}/latest`, {signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`npm registry: HTTP ${response.status}`);
  const data = await response.json();
  if (data.name !== NAME || !/^\d+\.\d+\.\d+$/.test(data.version)) throw new Error('Invalid stable release metadata.');
  return data.version;
}
export function createUpdater(manager, resolveLatest = latestRelease) {
  let state = {phase: 'idle', busy: false};
  let active;
  let checkActive;
  let checkState = {phase: 'idle', latestVersion: null, checkedAt: null, error: null};
  let disposed = false;
  const set = patch => { state = {...state, ...patch, updatedAt: new Date().toISOString()}; };
  async function status() {
    const bundle = (await manager.listBundles()).find(b => b.name === NAME);
    let comparison = null;
    if (checkState.phase === 'succeeded') {
      if (!bundle?.installed) comparison = 'not-installed';
      else {
        try {
          const difference = compareVersions(checkState.latestVersion, bundle.version);
          comparison = difference > 0 ? 'available' : difference < 0 ? 'ahead' : 'current';
        } catch { comparison = 'unsupported'; }
      }
    }
    return {...state, helperVersion: HELPER_VERSION, installedVersion: bundle?.version || null, installed: !!bundle?.installed,
      check: {...checkState}, comparison, updateAvailable: comparison === null || comparison === 'unsupported' || comparison === 'not-installed' ? null : comparison === 'available'};
  }
  // Version discovery never installs anything or overwrites the update outcome.
  // Concurrent checks (including the update's preflight) share one registry request.
  function probe() {
    if (checkActive) return checkActive;
    checkState = {phase: 'checking', latestVersion: null, checkedAt: null, error: null};
    checkActive = (async () => {
      try {
        const latestVersion = await resolveLatest();
        compareVersions(latestVersion, latestVersion);
        checkState = {phase: 'succeeded', latestVersion, checkedAt: new Date().toISOString(), error: null};
        return latestVersion;
      } catch (error) {
        checkState = {phase: 'failed', latestVersion: null, checkedAt: new Date().toISOString(), error: String(error.message || error)};
        throw error;
      }
    })().finally(() => { checkActive = undefined; });
    return checkActive;
  }
  async function perform() {
    let old, removed = false;
    try {
      const bundle = (await manager.listBundles()).find(b => b.name === NAME);
      old = bundle?.installed ? bundle : null;
      if (old && (!old.removable || old.availability !== 'profile')) throw new Error('This market is not removable by the profile manager.');
      // Do not silently replace a local checkout, Git build or prerelease with npm stable.
      if (old && !/^dshmarket@(?:[~^]?\d|latest)/.test(old.source || '')) throw new Error('Only an npm-installed stable dshmarket is supported.');
      set({phase: 'checking'});
      const targetVersion = await probe();
      set({targetVersion, beforeVersion: old?.version || null});
      if (old && compareVersions(targetVersion, old.version) <= 0) {
        set({phase: 'current'}); return;
      }
      if (disposed) throw new Error('Updater unloaded before mutation.');
      if (old) {
        set({phase: 'removing'});
        const result = await manager.removeBundle(NAME);
        set({removeResult: result});
        if (!good(result)) throw new Error(`Remove: ${diagnostic(result)}`);
        removed = true;
      }
      set({phase: 'installing'});
      const result = await manager.installBundle(`${NAME}@${targetVersion}`, {enabled: old?.enabled ?? true, saveExact: true, registry: REGISTRY});
      set({installResult: result});
      if (!good(result)) throw new Error(`Install: ${diagnostic(result)}`);
      const after = (await manager.listBundles()).find(b => b.name === NAME);
      if (!after?.installed || after.version !== targetVersion) throw new Error(`Version verification failed: expected ${targetVersion}, got ${after?.version || 'missing'}`);
      set({phase: result.application === 'restart-required' ? 'restart-required' : 'succeeded', installedVersion: after.version});
    } catch (error) {
      set({phase: 'failed', error: String(error.message || error)});
      if (removed && old) {
        try {
          const current = (await manager.listBundles()).find(b => b.name === NAME);
          // Never remove a partially activated new version automatically.
          if (!current?.installed) {
            set({phase: 'recovering'});
            const recovery = await manager.installBundle(`${NAME}@${old.version}`, {enabled: old.enabled, saveExact: true, registry: REGISTRY});
            const restored = (await manager.listBundles()).find(b => b.name === NAME);
            set({recoveryResult: recovery, phase: good(recovery) && restored?.version === old.version ? 'rolled-back' : 'failed'});
          }
        } catch (recoveryError) { set({recoveryError: String(recoveryError.message || recoveryError), phase: 'failed'}); }
      }
    } finally { set({busy: false}); }
  }
  return {
    status,
    check() {
      if (disposed) return Promise.reject(new Error('Updater is disposed.'));
      // An ongoing update owns its preflight and version transition. Do not race it.
      if (active) return active;
      return probe().catch(() => {}).then(status);
    },
    update() {
      if (disposed) return Promise.reject(new Error('Updater is disposed.'));
      if (active) return active;
      state = {phase: 'checking', busy: true};
      active = perform().then(status).finally(() => { active = undefined; });
      return active;
    },
    async dispose() { disposed = true; await Promise.allSettled([active, checkActive].filter(Boolean)); },
  };
}
