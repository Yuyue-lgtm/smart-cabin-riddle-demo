import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { ecsOrigin, saveEcsSession } from './ecs-console.mjs';

export async function loginEcs({ origin = ecsOrigin(), port = 4190,
  nonce = process.env.DIFY_ECS_LOGIN_NONCE || randomBytes(24).toString('hex') } = {}) {
  if (!/^[a-f0-9]{48}$/.test(nonce)) throw new Error('Invalid local login nonce');
  const base = `http://127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    let busy = false;
    const server = http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; script-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'`);
      if (req.headers.host !== `127.0.0.1:${port}` || req.url !== `/login?nonce=${nonce}`) {
        res.writeHead(404).end(); return;
      }
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接阿里云 Dify</title>
<style>body{font:16px system-ui;max-width:520px;margin:60px auto;padding:24px;color:#20252b}label{display:block;margin:20px 0}input{display:block;box-sizing:border-box;width:100%;padding:12px;margin-top:8px}button{padding:12px 24px;background:#2576de;color:white;border:0;border-radius:4px}</style>
<h1>连接阿里云 Dify</h1><p>输入你在阿里云 Dify 中创建的管理员账号。密码仅用于本次登录，不保存、不写入日志。</p>
<form action="/login?nonce=${nonce}" method="post" autocomplete="off"><label>邮箱<input name="email" type="email" required autocomplete="username"></label>
<label>密码<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">连接</button></form>
<p id="status" role="status"></p><script nonce="${nonce}">
document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();
const form=event.currentTarget,button=form.querySelector('button'),status=document.getElementById('status');
button.disabled=true;status.textContent='正在连接服务器，请稍候…';
try{const response=await fetch(form.action,{method:'POST',body:new URLSearchParams(new FormData(form)),signal:AbortSignal.timeout(25000)});
const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message||'连接失败');
form.remove();status.textContent='阿里云 Dify 已连接。可以返回对话，密码未保存。';document.title='已连接';}
catch(error){status.textContent=error.message;button.disabled=false;}});
</script></html>`);
        return;
      }
      if (req.method !== 'POST' || req.headers.origin !== base || busy) {
        res.writeHead(403).end(); return;
      }
      busy = true;
      console.log('ECS_LOGIN_ATTEMPT');
      let stage = 'request', upstreamStatus = null, safeCode = '';
      try {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 16000) throw new Error('Invalid login payload');
        }
        const values = new URLSearchParams(body);
        const response = await fetch(`${origin}/console/api/login`, {
          method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: values.get('email'),
            password: Buffer.from(values.get('password') || '', 'utf8').toString('base64'), remember_me: true }),
          signal: AbortSignal.timeout(20000),
        });
        upstreamStatus = response.status;
        const result = await response.json();
        if (/^[a-z_]{1,80}$/.test(result.code || '')) safeCode = result.code;
        if (!response.ok || result.result !== 'success') throw new Error('Login failed');
        stage = 'cookies';
        saveEcsSession(response, origin);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
        clearTimeout(timeout);
        server.close(() => resolve({ connected: true }));
      } catch {
        console.log(JSON.stringify({ event: 'ECS_LOGIN_FAILURE', stage, http: upstreamStatus, code: safeCode }));
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        const message = upstreamStatus === null ? '阿里云客户端维护通道断开，请恢复转发后再点连接。'
          : stage === 'cookies' ? '登录成功但会话 Cookie 不完整，维护工具需要核对配置。'
          : `Dify 未接受登录（HTTP ${upstreamStatus}${safeCode ? `，${safeCode}` : ''}），请核对该实例的账号密码。`;
        res.end(JSON.stringify({ ok: false, message }));
      } finally { busy = false; }
    });
    const timeout = setTimeout(() => { server.close(); reject(new Error('Local login timed out')); }, 15 * 60000);
    server.on('error', error => { clearTimeout(timeout); reject(error); });
    server.listen(port, '127.0.0.1', () => console.log(`${base}/login?nonce=${nonce}`));
  });
}
