import {createUpdater} from './updater.js';
export const inject = ['pluginManager', 'connection', 'tools', 'approval'];
export function apply(ctx) {
  const updater = createUpdater(ctx.pluginManager);
  ctx.effect(() => ctx.provide('marketUpdateHelper', updater));
  ctx.effect(() => () => updater.dispose());
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/market-update-helper', methods: ['GET', 'POST'], requestBody: 'buffered',
    async fetch(request) {
      // Connection authenticates this exact Fetch route; mutation also requires same-origin.
      if (request.method === 'POST') {
        if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-market-update-helper') !== '1') {
          return Response.json({error: 'Same-origin UI request required.'}, {status: 403});
        }
        void updater.update().catch(() => {});
      }
      return Response.json(await updater.status(), {headers: {'Cache-Control': 'no-store'}});
    },
  }));
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
