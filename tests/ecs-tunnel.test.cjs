const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../tools/dify-workflow-mcp/src/ecs-tunnel.mjs');

test('persistent tunnel binds only loopback and requires pinned host and key authentication', async () => {
  const { sshArguments, launchAgentXml, verifiedHostKey } = await load();
  const args = sshArguments({ keyFile: '/keys/private key', hostFile: '/keys/known hosts' });
  assert.ok(args.includes('127.0.0.1:8081:127.0.0.1:8080'));
  for (const setting of ['StrictHostKeyChecking=yes', 'BatchMode=yes', 'IdentitiesOnly=yes',
    'ExitOnForwardFailure=yes', 'ServerAliveInterval=15', 'ServerAliveCountMax=3']) {
    assert.ok(args.includes(setting), setting);
  }
  assert.equal(args.at(-1), 'root@47.83.188.59');
  assert.ok(args.includes('UserKnownHostsFile=/keys/known\\ hosts'));
  assert.ok(!args.includes('-f'));
  assert.equal(sshArguments({ viaClient: true }).at(-1), 'root@127.0.0.1');
  const xml = launchAgentXml(args, '/logs/a&b');
  assert.match(xml, /<key>KeepAlive<\/key><true\/>/);
  assert.match(xml, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(xml, /a&amp;b/);
  assert.throws(() => verifiedHostKey('host ssh-ed25519 dW50cnVzdGVk'), /ECS_HOST_KEY_NOT_VERIFIED/);
});

test('a listening port or HTML page is insufficient to mark the Dify tunnel healthy', async () => {
  const { tunnelReachable } = await load();
  assert.equal(await tunnelReachable('http://localhost:8081', async () => new Response('<html>not Dify</html>')), false);
  assert.equal(await tunnelReachable('http://localhost:8081', async () => Response.json({}, { status: 403 })), false);
  assert.equal(await tunnelReachable('http://localhost:8081', async () => Response.json({})), true);
  assert.equal(await tunnelReachable('http://localhost:8081', async () => { throw new Error('closed'); }), false);
});

test('startup checks all service keys without model calls and reports authentication failures explicitly', async () => {
  const { verifyTestApiKeys } = await import('../tools/dify-workflow-mcp/src/ecs-doctor.mjs');
  const env = { DIFY_API_BASE_URL: 'http://127.0.0.1:8081', DIFY_CHATFLOW_API_KEY: 'h',
    DIFY_SITUATION_API_KEY: 's', DIFY_PREVIEW_API_KEY: 'p' };
  const requests = [];
  await verifyTestApiKeys(env, async (url, options) => {
    requests.push({ url, key: options.headers.Authorization });
    return Response.json({});
  });
  assert.equal(requests.length, 3);
  assert.ok(requests.every(request => request.url.endsWith('/v1/parameters')));
  await assert.rejects(verifyTestApiKeys(env, async () => Response.json({}, { status: 401 })), /KEY_CHECK_FAILED: HTTP 401/);
});
