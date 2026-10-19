const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function setup(t) {
  const { createConsoleClient } = await import('../tools/dify-workflow-mcp/src/console-client.mjs');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dify-console-auth-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const envPath = path.join(folder, '.env');
  fs.writeFileSync(envPath, 'OTHER_SETTING=keep\nDIFY_CONSOLE_TOKEN=old-access\nDIFY_REFRESH_TOKEN=old-refresh\nDIFY_CSRF_COOKIE_NAME=__Host-csrf_token\n');
  return { createConsoleClient, envPath };
}

function refreshedResponse() {
  const headers = new Headers();
  for (const [key, value] of Object.entries({ access_token: 'new-access', csrf_token: 'new-csrf', refresh_token: 'new-refresh' })) {
    headers.append('Set-Cookie', `__Host-${key}=${value}; Secure; Path=/`);
  }
  return new Response('{}', { headers });
}

test('two console clients share rotated credentials and serialize refresh without losing env settings', async t => {
  const { createConsoleClient, envPath } = await setup(t);
  let refreshes = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/refresh-token')) {
      refreshes++;
      assert.equal(options.headers.Cookie, '__Host-refresh_token=old-refresh');
      await new Promise(resolve => setTimeout(resolve, 30));
      return refreshedResponse();
    }
    if (options.headers.Authorization === 'Bearer old-access') return new Response('{}', { status: 401 });
    assert.equal(options.headers.Authorization, 'Bearer new-access');
    assert.equal(options.headers['X-CSRF-Token'], 'new-csrf');
    return new Response('{"hash":"current"}');
  };
  const clients = [0, 1].map(() => createConsoleClient({ envPath, env: {}, fetchImpl }));
  const values = await Promise.all(clients.map(client => client('/apps/test/workflows/draft')));
  assert.equal(refreshes, 1);
  assert.deepEqual(values, [{ hash: 'current' }, { hash: 'current' }]);
  assert.match(fs.readFileSync(envPath, 'utf8'), /OTHER_SETTING=keep/);
  assert.match(fs.readFileSync(envPath, 'utf8'), /DIFY_REFRESH_TOKEN="new-refresh"/);
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600);
  assert.equal(fs.existsSync(`${envPath}.refresh.lock`), false);
  // A long-lived caller must reload credentials even if it inherited an old environment.
  const inherited = createConsoleClient({ envPath, env: { DIFY_CONSOLE_TOKEN: 'old-access' }, fetchImpl });
  assert.deepEqual(await inherited('/apps/test/workflows/draft'), { hash: 'current' });
  assert.equal(refreshes, 1);
});

test('revoked refresh cookies produce a precise safe error and release the lock', async t => {
  const { createConsoleClient, envPath } = await setup(t);
  const request = createConsoleClient({ envPath, env: {}, fetchImpl: async () =>
    new Response('{"message":"private-cookie-value"}', { status: 401 }) });
  await assert.rejects(request('/apps/test/workflows/draft'), error => {
    assert.match(error.message, /DIFY_REFRESH_SESSION_EXPIRED/);
    assert.doesNotMatch(error.message, /old-access|old-refresh|private-cookie-value/);
    return true;
  });
  assert.equal(fs.existsSync(`${envPath}.refresh.lock`), false);
});

test('updated cookie names and tokens are read on every request, preserving raw responses', async t => {
  const { createConsoleClient, envPath } = await setup(t);
  const request = createConsoleClient({ envPath, env: {}, fetchImpl: async (_, options) => {
    assert.equal(options.headers.Authorization, 'Bearer manual-new-access');
    assert.equal(options.headers.Cookie, 'csrf_token=manual-csrf');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { inputs: {} });
    return new Response('data: streaming-result');
  } });
  fs.writeFileSync(envPath, 'DIFY_CONSOLE_TOKEN=manual-new-access\nDIFY_CSRF_TOKEN=manual-csrf\n');
  const response = await request('/apps/test/workflows/draft/run', { method: 'POST', raw: true, body: { inputs: {} } });
  assert.equal(await response.text(), 'data: streaming-result');
});
