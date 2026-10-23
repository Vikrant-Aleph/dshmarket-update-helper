window.__ModuleLoader__.load({
  id: 'dshmarket-update-helper',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const dictionaries = {
      zh: {
        title: '市场更新助手', update: '更新插件市场', working: '正在更新…', refresh: '刷新状态',
        subtitle: '独立更新 dshmarket，不再让市场更新到一半把自己卸载掉。',
        version: '当前安装版本', missing: '未安装', target: '目标稳定版本',
        notice: '点击即检查并更新到 npm 最新稳定版。更新时市场会短暂消失；助手保留。影响当前配置的所有会话，不自动重启。',
        caution: '请勿同时在其他页面安装或卸载插件。安装失败会尝试恢复旧版，但网络或权限问题也可能阻止恢复。不会自动批准构建脚本或忽略版本限制。',
        details: '操作详情', idle: '准备就绪', checking: '正在检查 npm 稳定版…', removing: '正在卸载旧版市场…', installing: '正在安装新版市场…', recovering: '安装失败，正在恢复旧版…',
        current: '已是最新稳定版，无需更新。', succeeded: '更新完成！可重新打开插件市场。', 'restart-required': '新版已安装。请手动重启 DSH 使其生效。',
        failed: '更新失败，请查看操作详情。', 'rolled-back': '更新未完成，已恢复旧版；若提示需要重启，请手动重启 DSH。', connectionError: '请求失败，可刷新状态重试。', requestRejected: '更新请求校验失败，请刷新整个页面；若刚更新助手，请先重启 DSH。',
      },
      en: {
        title: 'Market Update Helper', update: 'Update Plugin Market', working: 'Updating…', refresh: 'Refresh status',
        subtitle: 'Update dshmarket independently, without unloading its own updater.', version: 'Installed version', missing: 'Not installed', target: 'Target stable version',
        notice: 'Click to check and install the latest npm stable release. The market briefly disappears; this helper stays. Affects every session in this profile. Never restarts automatically.',
        caution: 'Do not install or remove plugins elsewhere at the same time. A failed installation attempts to restore the old version, but recovery can also fail. Never approves build scripts or bypasses version requirements.',
        details: 'Operation details', idle: 'Ready', checking: 'Checking npm stable…', removing: 'Removing old market…', installing: 'Installing new market…', recovering: 'Restoring previous version…', current: 'Already on the latest stable version.', succeeded: 'Updated! Reopen Plugin Market.', 'restart-required': 'Installed. Restart DSH manually to activate.', failed: 'Update failed. See operation details.', 'rolled-back': 'Update failed; previous version restored. Restart DSH if required.', connectionError: 'Request failed. Refresh status to retry.', requestRejected: 'Update request verification failed. Reload the page; restart DSH first if the helper was just updated.',
      },
    };
    const css = `.dmuh{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6;max-width:760px;padding:4px 0 24px}.dmuh h2{font-size:20px;font-weight:600;margin:0 0 8px}.dmuh p{margin:8px 0 16px}.dmuh-muted{color:var(--dsw-alias-label-secondary)}.dmuh-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;margin:20px 0;background:var(--dsw-alias-bg-layer-1)}.dmuh-actions{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.dmuh button{font:inherit;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 14px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);cursor:pointer}.dmuh button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.dmuh button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}.dmuh button:disabled{opacity:.55;cursor:wait}.dmuh .dmuh-primary{font-weight:600;border-color:var(--dsw-alias-brand-primary)}.dmuh pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:360px;overflow:auto;padding:12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}.dmuh-error{color:var(--dsw-alias-state-error-primary)}.dmuh-status{padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}`;
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        for (const [language, dict] of Object.entries(dictionaries)) ctx.effect(() => ctx.locale.register('dmuh', language, dict));
        const t = ctx.locale.bind('dmuh');
        function Page() {
          React.useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot());
          const [state, setState] = React.useState(null);
          const [error, setError] = React.useState('');
          const [sending, setSending] = React.useState(false);
          const alive = React.useRef(true);
          const locked = React.useRef(false);
          async function request(method = 'GET', signal) {
            const response = await fetch('./api/market-update-helper', {method, credentials: 'same-origin', cache: 'no-store', signal, headers: method === 'POST' ? {'x-market-update-helper': '1'} : {}});
            if (!response.ok) {
              const details = await response.json().catch(() => null);
              const reason = details?.code === 'UI_REQUEST_REJECTED' ? t('requestRejected') : '';
              throw new Error(`HTTP ${response.status}${reason ? ` · ${reason}` : ''}`);
            }
            return response.json();
          }
          React.useEffect(() => {
            alive.current = true;
            const controller = new AbortController();
            request('GET', controller.signal).then(value => {if (alive.current) setState(value);}).catch(e => {if (!controller.signal.aborted) setError(String(e.message));});
            return () => {alive.current = false; controller.abort();};
          }, []);
          React.useEffect(() => {
            if (!state?.busy) return;
            const controller = new AbortController();
            const timer = setTimeout(() => request('GET', controller.signal).then(value => {setState(value); setError('');}).catch(e => {if (!controller.signal.aborted) setError(String(e.message));}), 1200);
            return () => {clearTimeout(timer); controller.abort();};
          }, [state]);
          async function act(method) {
            if (locked.current) return;
            locked.current = true; setSending(true); setError('');
            try {const value = await request(method); if (alive.current) setState(value);}
            catch (e) {if (alive.current) setError(String(e.message));}
            finally {locked.current = false; if (alive.current) setSending(false);}
          }
          const busy = sending || state?.busy;
          return h('section', {className: 'dmuh', 'aria-busy': !!busy},
            h('style', null, css), h('h2', null, t('title'),
              state?.helperVersion && h('span', {className: 'dmuh-muted', style: {fontSize: 12, fontWeight: 400, marginInlineStart: 10}}, `v${state.helperVersion}`)),
            h('p', {className: 'dmuh-muted'}, t('subtitle')),
            h('div', {className: 'dmuh-card'},
              h('div', null, t('version'), ' · ', h('strong', null, state?.installedVersion || (state ? t('missing') : '…'))),
              state?.targetVersion && h('div', {className: 'dmuh-muted'}, t('target'), ' · ', state.targetVersion),
              h('p', null, t('notice')),
              h('div', {className: 'dmuh-actions'},
                h('button', {type: 'button', className: 'dmuh-primary', disabled: !!busy || !state, onClick: () => act('POST')}, t(busy ? 'working' : 'update')),
                h('button', {type: 'button', disabled: sending, onClick: () => act('GET')}, t('refresh'))),
              h('div', {className: 'dmuh-status', role: 'status', 'aria-live': 'polite'}, t(state?.phase || 'idle')),
              error && h('p', {role: 'alert', className: 'dmuh-error'}, t('connectionError'), ' ', error)),
            h('p', {className: 'dmuh-muted'}, t('caution')),
            state && h('details', null, h('summary', null, t('details')), h('pre', null, JSON.stringify(state, null, 2))));
        }
        ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'dshmarket-update-helper', order: 41, label: () => t('title')}, Page));
      },
    };
  },
});
