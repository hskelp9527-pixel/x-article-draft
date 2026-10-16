import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { readState, writeState, withLock } from './storage.mjs';
import { apiPayload } from './article.mjs';

const API = 'https://api.x.com';
const scopes = 'tweet.read tweet.write users.read media.write offline.access';
export async function jsonRequest(url, options = {}, request = fetch) {
  const response = await request(url, { ...options, signal: options.signal || AbortSignal.timeout(60000), redirect: 'error' });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('X 返回非 JSON 响应，HTTP ' + response.status); }
  if (!response.ok || body.errors?.length || body.error) {
    // Deliberately omit server response details: they can echo token-bearing requests.
    const hint = response.status === 401 ? '授权失效，请重新运行 auth' : response.status === 403 ? '检查账号 Articles 权限、应用权限和开发者控制台' : response.status === 402 ? '检查开发者控制台余额/计费' : response.status === 429 ? '达到限流，请稍后手动重试' : '请求未成功；请在 X 控制台核实';
    throw new Error('X API HTTP ' + response.status + ': ' + hint);
  }
  return body;
}
export async function startOAuth(clientId, { port = 8765, onReady = console.log, timeoutMs = 300000, request = fetch, signal } = {}) {
  if (!clientId) throw new Error('缺少 OAuth 2.0 Client ID，请先阅读 references/setup.md');
  let redirect = `http://127.0.0.1:${port}/callback`;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const state = crypto.randomBytes(24).toString('hex');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  let timer, abort;
  const server = http.createServer();
  try {
    const code = await new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('授权已取消')); return; }
      abort = () => reject(new Error('授权已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      server.on('error', reject);
      server.on('request', (req, res) => {
        const url = new URL(req.url, redirect);
        if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
        if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid OAuth state'); return; }
        if (!url.searchParams.get('code')) { res.writeHead(400).end('Authorization declined.'); reject(new Error('X 授权取消或失败')); return; }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('授权已收到，可以关闭本页。请回到终端检查授权结果。');
        resolve(url.searchParams.get('code'));
      });
      server.listen(port, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${server.address().port}/callback`;
        const url = new URL('https://x.com/i/oauth2/authorize');
        for (const [k, v] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: scopes, state, code_challenge: challenge, code_challenge_method: 'S256' })) url.searchParams.set(k, v);
        onReady(url.toString());
      });
      timer = setTimeout(() => reject(new Error('等待授权超时；再次运行 auth 即可')), timeoutMs);
    });
    const token = await jsonRequest(API + '/2/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier })
    }, request);
    if (!token.access_token) throw new Error('X 未返回用户访问令牌');
    const me = await jsonRequest(API + '/2/users/me', { headers: { Authorization: 'Bearer ' + token.access_token } }, request);
    if (!me.data?.id) throw new Error('无法确认授权账号');
    writeState('auth', { clientId, ...token, expiresAt: Date.now() + (token.expires_in || 7200) * 1000, user: me.data });
    writeState('config', { ...readState('config'), method: 'api' });
    return { authorized: true, user: me.data };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); server.close(); server.closeAllConnections(); }
}
export async function accessToken(request = fetch) {
  let auth = readState('auth');
  if (!auth.access_token || !auth.user?.id) throw new Error('尚未授权，请运行 auth');
  if (auth.expiresAt < Date.now() + 60000) {
    if (!auth.refresh_token) throw new Error('授权已过期，请重新运行 auth');
    const token = await jsonRequest(API + '/2/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: auth.refresh_token, client_id: auth.clientId })
    }, request);
    if (!token.access_token) throw new Error('X 未返回刷新后的令牌，请重新授权');
    auth = { ...auth, ...token, expiresAt: Date.now() + (token.expires_in || 7200) * 1000 };
    writeState('auth', auth);
  }
  return auth;
}
export async function uploadImage(image, token, request = fetch) {
  const bytes = fs.readFileSync(image.path);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('准备后图片已改变，请重新 prepare');
  const form = new FormData();
  form.set('media', new Blob([bytes], { type: image.mime }), path.basename(image.path));
  form.set('media_category', 'tweet_image');
  const response = await jsonRequest(API + '/2/media/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form }, request);
  if (!response.data?.id || response.data.processing_info) throw new Error('图片未完成上传/处理，未创建草稿');
  return String(response.data.id);
}
export async function saveApi(article, { request = fetch, allowNew = false } = {}) {
  return withLock('api', async () => {
    const auth = await accessToken(request);
    const journal = readState('journal', {});
    const key = auth.user.id + ':' + article.fingerprint;
    const previous = journal[key];
    if (previous?.status === 'saved' && !allowNew) return { ...previous, reused: true };
    if (previous?.status === 'pending' && !allowNew) throw new Error('上次提交结果不明。先到 X Articles 检查，避免重复创建；确认需要新建后再用 --new');
    const media = {}, byHash = new Map();
    for (const image of [...article.images, ...(article.cover ? [{ ...article.cover, placeholder: 'cover' }] : [])]) {
      if (!byHash.has(image.sha256)) byHash.set(image.sha256, await uploadImage(image, auth.access_token, request));
      media[image.placeholder] = byHash.get(image.sha256);
    }
    const payload = apiPayload(article, media);
    const pending = { status: 'pending', title: article.title, user: auth.user.username, startedAt: new Date().toISOString() };
    journal[key] = pending;
    writeState('journal', journal);
    // Never retry this POST automatically: a timeout may follow a successful remote write.
    const response = await jsonRequest(API + '/2/articles/draft', { method: 'POST', headers: { Authorization: 'Bearer ' + auth.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, request);
    if (!response.data?.id) throw new Error('未返回草稿 ID；请到 X 检查后再决定是否重试');
    const saved = { ...pending, status: 'saved', articleId: String(response.data.id), imageCount: article.images.length, savedAt: new Date().toISOString() };
    journal[key] = saved;
    writeState('journal', journal);
    return saved;
  });
}
