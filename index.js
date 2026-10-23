import {createUpdater} from './updater.js';
export const inject = ['pluginManager', 'connection', 'tools', 'approval'];

// This route is mounted behind Connection's authenticated owner-only Fetch registry.
// request.url is reconstructed as http://dsh.internal/... by the HTTP bridge;
// it is a routing URL, NOT the browser's origin. Never use it for Origin checks.
export function createUpdateRoute(updater) {
  return {
    path: '/api/market-update-helper', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.method === 'POST') {
        let trusted = request.headers.get('x-market-update-helper') === '1'
          && request.headers.get('sec-fetch-site') !== 'cross-site';
        const origin = request.headers.get('origin');
        if (origin !== null) {
          try {
            const parsed = new URL(origin);
            const host = request.headers.get('host');
            // Normalize Host under Origin's scheme, including default ports.
            // Do not trust X-Forwarded-Host or the bridge's internal URL.
            trusted = trusted && !!host && ['http:', 'https:'].includes(parsed.protocol)
              && parsed.origin === origin
              && new URL(`${parsed.protocol}//${host}`).origin === parsed.origin;
          } catch { trusted = false; }
        }
        // Some same-origin desktop transports omit Origin. Connection admission
        // plus the non-simple custom header still protect those requests.
        if (!trusted) return Response.json({code: 'UI_REQUEST_REJECTED', error: 'Update request verification failed. Refresh the page and retry.'}, {status: 403, headers: {'Cache-Control': 'no-store'}});
        void updater.update().catch(() => {});
      }
      return Response.json(await updater.status(), {headers: {'Cache-Control': 'no-store'}});
    },
  };
}
export function apply(ctx) {
  const updater = createUpdater(ctx.pluginManager);
  ctx.effect(() => ctx.provide('marketUpdateHelper', updater));
  ctx.effect(() => () => updater.dispose());
  ctx.effect(() => ctx.connection.fetch.register(createUpdateRoute(updater)));
  ctx.effect(() => ctx.tools.register({
    name: 'dshmarket_update',
    description: 'Check the independent market updater, or update npm-stable dshmarket profile-wide. Update removes the old market before installation, attempts recovery on install failure, and may require restart. Requests approval before mutation; does not authorize build scripts.',
    parameters: {type: 'object', properties: {action: {type: 'string', enum: ['status', 'update'], description: 'status reads current progress; update checks npm stable and installs a newer release.'}}, required: ['action'], additionalProperties: false},
    output: {schema: {type: 'object'}, render: (_args, value) => [{type: 'text', text: JSON.stringify(value)}]},
    async execute(args, exec) {
      if (!args || !['status', 'update'].includes(args.action)) throw new Error('Invalid action.');
      if (args.action === 'status') return updater.status();
      if (!exec.agent) throw new Error('A requesting agent is required.');
      const outcome = await ctx.approval.request({agent: exec.agent, callId: exec.callId, toolName: 'dshmarket_update', signal: exec.signal,
        reason: '更新当前配置中的 dshmarket 插件：先卸载旧版，再安装 npm 稳定新版；失败时尝试恢复旧版。影响此配置的所有会话，不自动重启或批准安装脚本。'});
      if (outcome !== 'allowed-once' || exec.signal.aborted) throw new Error(`Update not authorized: ${outcome}`);
      return updater.update();
    },
  }));
}
