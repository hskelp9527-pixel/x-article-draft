import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { prepareArticle } from '../scripts/article.mjs';
import { saveApi, accessToken, jsonRequest, startOAuth } from '../scripts/x-api.mjs';
import { readState, writeState, withLock } from '../scripts/storage.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-draft-api-test-'));
  const previous = process.env.X_ARTICLE_DRAFT_HOME;
  process.env.X_ARTICLE_DRAFT_HOME = path.join(root, 'state');
  t.after(() => { if (previous === undefined) delete process.env.X_ARTICLE_DRAFT_HOME; else process.env.X_ARTICLE_DRAFT_HOME = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const note = path.join(root, 'article.md');
  fs.writeFileSync(note, '# Test\n\nHello\n\n![A](a.png)\n\n![Again](a.png)');
  fs.writeFileSync(path.join(root, 'a.png'), 'test-image');
  writeState('auth', { access_token: 'TEST-PRIVATE-TOKEN', refresh_token: 'TEST-REFRESH', expiresAt: Date.now() + 3600000, clientId: 'PUBLIC-ID', user: { id: '1', username: 'test' } });
  return { root, article: prepareArticle(note) };
}
const ok = body => new Response(JSON.stringify(body), { status: 200 });
test('API uploads duplicate bytes once, creates only a draft, deduplicates rerun', async t => {
  const { article } = fixture(t); const calls = [];
  const request = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer TEST-PRIVATE-TOKEN');
    if (url.endsWith('/media/upload')) { assert.ok(options.body instanceof FormData); return ok({ data: { id: '99' } }); }
    assert.equal(url, 'https://api.x.com/2/articles/draft');
    const payload = JSON.parse(options.body);
    assert.equal(payload.content_state.entities.filter(e => e.value.type === 'image').length, 2);
    assert.ok(!JSON.stringify(payload).includes('XIMGPH_'));
    return ok({ data: { id: '123', title: 'Test' } });
  };
  assert.equal((await saveApi(article, { request })).articleId, '123');
  assert.equal((await saveApi(article, { request })).reused, true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => !url.includes('/publish')));
});
test('unknown create result is recorded and never automatically retried', async t => {
  const { article } = fixture(t); let creates = 0;
  const request = async url => {
    if (url.endsWith('/media/upload')) return ok({ data: { id: '99' } });
    creates++; throw new Error('simulated network timeout');
  };
  await assert.rejects(saveApi(article, { request }), /timeout/);
  await assert.rejects(saveApi(article, { request }), /结果不明/);
  assert.equal(creates, 1);
  assert.equal(Object.values(readState('journal'))[0].status, 'pending');
});
test('failed image upload does not create a draft or pending draft record', async t => {
  const { article } = fixture(t); const calls = [];
  const request = async url => { calls.push(url); return new Response('{}', { status: 403 }); };
  await assert.rejects(saveApi(article, { request }), /403/);
  assert.equal(calls.length, 1);
  assert.deepEqual(readState('journal'), {});
});
test('expired token refreshes once and saves rotated refresh token', async t => {
  fixture(t); writeState('auth', { ...readState('auth'), expiresAt: 0 });
  const request = async (url, options) => {
    assert.equal(url, 'https://api.x.com/2/oauth2/token');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    return ok({ access_token: 'ROTATED', refresh_token: 'ROTATED-REFRESH', expires_in: 7200 });
  };
  assert.equal((await accessToken(request)).access_token, 'ROTATED');
  assert.equal(readState('auth').refresh_token, 'ROTATED-REFRESH');
});
test('second account does not reuse first account draft', async t => {
  const { article } = fixture(t); let count = 0;
  const request = async url => url.endsWith('/media/upload') ? ok({ data: { id: '99' } }) : ok({ data: { id: String(++count) } });
  await saveApi(article, { request });
  writeState('auth', { ...readState('auth'), user: { id: '2', username: 'second' } });
  await saveApi(article, { request });
  assert.equal(count, 2);
});
test('concurrent API writes refuse second operation', async t => {
  fixture(t);
  await withLock('api', async () => { await assert.rejects(withLock('api', async () => {}), /已有任务/); });
});
test('server error responses never echo tokens', async () => {
  const request = async () => new Response(JSON.stringify({ errors: [{ detail: 'Bearer PRIVATE-SECRET' }] }), { status: 401 });
  await assert.rejects(jsonRequest('https://api.x.com/2/articles/draft', {}, request), error => !error.message.includes('PRIVATE-SECRET') && error.message.includes('401'));
});
test('first authorization validates OAuth state, exchanges PKCE code and stores actual account', async t => {
  fixture(t);
  let authorize, badStatus;
  const getLocal = url => new Promise((resolve, reject) => http.get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject));
  const request = async (url, options) => {
    if (url.endsWith('/oauth2/token')) {
      assert.equal(options.body.get('code'), 'TEST-CODE');
      const challenge = crypto.createHash('sha256').update(options.body.get('code_verifier')).digest('base64url');
      assert.equal(challenge, authorize.searchParams.get('code_challenge'));
      return ok({ access_token: 'NEW-PRIVATE', refresh_token: 'NEW-REFRESH', expires_in: 7200 });
    }
    assert.equal(url, 'https://api.x.com/2/users/me');
    return ok({ data: { id: '88', username: 'actual_account' } });
  };
  let callbackWork;
  const result = await startOAuth('PUBLIC-ID', { port: 0, timeoutMs: 5000, request, onReady: value => {
    authorize = new URL(value);
    const redirect = authorize.searchParams.get('redirect_uri');
    callbackWork = (async () => {
      badStatus = await getLocal(redirect + '?state=WRONG&code=INJECTED');
      return getLocal(redirect + '?state=' + authorize.searchParams.get('state') + '&code=TEST-CODE');
    })();
  } });
  await callbackWork;
  assert.equal(badStatus, 400);
  assert.equal(result.user.username, 'actual_account');
  assert.equal(readState('auth').refresh_token, 'NEW-REFRESH');
  assert.equal(readState('config').method, 'api');
});
test('authorization timeout terminates without overwriting prior account', async t => {
  fixture(t);
  await assert.rejects(startOAuth('PUBLIC-ID', { port: 0, timeoutMs: 20, onReady: () => {} }), /超时/);
  assert.equal(readState('auth').user.username, 'test');
});
