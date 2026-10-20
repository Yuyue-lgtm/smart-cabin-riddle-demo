const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// One-use, loopback-only UI bridge: browser-visible keys never enter tool output.
const destination = path.resolve(process.argv[2] || '');
const allowedRoot = path.resolve(__dirname, '../../tmp/alibaba-cloud');
if (!destination.startsWith(allowedRoot + path.sep) || !destination.endsWith('.env')) {
  throw new Error('Destination must be a private deployment staging .env file');
}
const nonce = crypto.randomBytes(24).toString('hex');
const keys = ['DIFY_CHATFLOW_API_KEY', 'DIFY_SITUATION_API_KEY', 'DIFY_PREVIEW_API_KEY'];
const appIds = {
  DIFY_CHATFLOW_APP_ID: 'b1f6f41d-eb34-4cba-b126-d08ca73052a3',
  DIFY_SITUATION_APP_ID: 'b68a7ef3-f411-49fe-9a9f-92bdfcf40ce4',
  DIFY_PREVIEW_APP_ID: '695710b2-b79e-4d8f-ab2f-6cfc543e7674',
};
let completed = false;
const server = http.createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.headers.host !== new URL(origin).host || req.url !== `/${nonce}` || completed) {
    res.writeHead(404).end(); return;
  }
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<title>Private deployment credentials</title><h1>Private deployment credentials</h1><form method="post" autocomplete="off">${keys.map(k => `<p><label>${k}<input name="${k}" type="password" autocomplete="off" required></label></p>`).join('')}<button type="submit">Stage for ECS transfer</button></form>`);
    return;
  }
  if (req.method !== 'POST' || req.headers.origin !== origin ||
      !String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) {
    res.writeHead(403).end(); return;
  }
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    if (keys.some(k => form.getAll(k).length !== 1 || !/^app-[A-Za-z0-9_-]{16,200}$/.test(form.get(k)))) {
      res.writeHead(400).end('Invalid credential format'); return;
    }
    const lines = ['DIFY_API_BASE_URL=http://127.0.0.1:8080', 'DIFY_BFF_TIMEOUT_MS=60000',
      ...Object.entries(appIds).map(([k, v]) => `${k}=${v}`), ...keys.map(k => `${k}=${form.get(k)}`)];
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, lines.join('\n') + '\n', { mode: 0o600, flag: 'wx' });
    completed = true;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<title>Credentials staged</title><h1>Credentials staged</h1><p>Private file saved. No credentials displayed.</p>');
    console.log(JSON.stringify({ staged: true, file: destination, mode: '600', key_count: keys.length }));
    server.close();
  } catch {
    res.writeHead(500).end('Staging failed; no credentials displayed');
  }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/${nonce}` })));
setTimeout(() => { server.close(); process.exitCode = completed ? 0 : 1; }, 15 * 60 * 1000).unref();
