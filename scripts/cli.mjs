#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { prepareArticle } from './article.mjs';
import { stateDir, readState, writeState } from './storage.mjs';
import { startOAuth, saveApi } from './x-api.mjs';

const { values: opts, positionals } = parseArgs({ allowPositionals: true, options: {
  method: { type: 'string' }, vault: { type: 'string' }, title: { type: 'string' }, cover: { type: 'string' },
  'client-id': { type: 'string' }, port: { type: 'string' }, out: { type: 'string' }, new: { type: 'boolean' }, help: { type: 'boolean' }
} });
const [command = 'help', note] = positionals;
const emit = value => console.log(JSON.stringify(value, null, 2));
try {
  if (opts.help || command === 'help') {
    console.log(`x-article-draft (Node.js 22+)\n\nnode scripts/cli.mjs setup [--method browser|api]\nnode scripts/cli.mjs doctor\nnode scripts/cli.mjs auth --client-id ID [--port 8765]\nnode scripts/cli.mjs prepare /path/article.md [--vault /path/vault] [--cover image.png] [--out /path/export]\nnode scripts/cli.mjs save /path/article.md [--method browser|api] [--vault /path/vault] [--new]\n\nBrowser mode prepares files for an AI agent controlling your logged-in browser.\nAPI mode creates a remote draft. No command publishes an Article.\nSecrets and local article data: ${stateDir()}`);
  } else if (command === 'setup') {
    const method = opts.method || 'browser';
    if (!['browser', 'api'].includes(method)) throw new Error('method 只能是 browser 或 api');
    writeState('config', { ...readState('config'), method });
    emit({ method, configured: true, verified: false, guide: path.resolve(import.meta.dirname, '../references/setup.md'), next: method === 'browser' ? ['让宿主 Agent 检查可用的 Chrome 浏览器控制工具', '在所选 Chrome 中打开 https://x.com/compose/articles', '用户本人登录，并确认可以创建 Article', '在用户要求上传的第一篇文章上验证草稿；重新打开核验后才报告成功'] : ['打开 https://developer.x.com/ 创建/选择自己的应用', '按 setup.md 设置 Public client（Native App）和回调地址 http://127.0.0.1:8765/callback', '复制 OAuth 2.0 Client ID，运行 auth；无需把密钥粘贴到聊天', '在浏览器完成账号授权，核对返回的账号', '查看控制台费用与 Articles 权限；第一篇草稿投递才验证写权限'] });
  } else if (command === 'doctor') {
    const config = readState('config'), auth = readState('auth');
    emit({ node: process.versions.node, supported: Number(process.versions.node.split('.')[0]) >= 22, method: config.method || 'unconfigured', stateDir: stateDir(), api: { authorized: !!auth.access_token, user: auth.user?.username || null, expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : null, refreshAvailable: !!auth.refresh_token, draftPermissionVerified: false }, browser: { requiresHostBrowserTools: true, loginVerified: false }, note: '本命令只检查本地状态；没有执行远程写操作，也不能证明 X 登录态或 Articles 写权限。' });
  } else if (command === 'auth') {
    const port = Number(opts.port || 8765);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port 必须是 1024–65535 的整数');
    emit(await startOAuth(opts['client-id'], { port, onReady: url => console.log('请在浏览器打开此授权链接（5 分钟内完成）：\n' + url) }));
  } else if (command === 'prepare' || command === 'save') {
    if (!note) throw new Error('请指定 Markdown 笔记路径');
    const article = prepareArticle(note, { vault: opts.vault, title: opts.title, cover: opts.cover });
    const method = opts.method || readState('config').method || 'browser';
    if (!['browser', 'api'].includes(method)) throw new Error('未知 method');
    if (command === 'save' && method === 'api') emit(await saveApi(article, { allowNew: opts.new }));
    else {
      const folder = opts.out ? path.resolve(opts.out) : fs.mkdtempSync(path.join(os.tmpdir(), 'x-article-draft-'));
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      // An explicit output directory must be empty; never overwrite somebody's article.
      if (fs.readdirSync(folder).length) throw new Error('输出目录必须为空: ' + folder);
      const manifest = path.join(folder, 'article.json'), html = path.join(folder, 'body.html');
      fs.writeFileSync(manifest, JSON.stringify(article, null, 2), { mode: 0o600 });
      fs.writeFileSync(html, article.html, { mode: 0o600 });
      emit({ status: command === 'save' ? 'browser_action_required' : 'prepared', remotelySaved: false, method, title: article.title, imageCount: article.images.length, cover: !!article.cover, warnings: article.warnings, manifest, html, next: '宿主 Agent 按 references/browser.md 上传，并重新打开草稿核验。文件准备成功不等于已保存 X 草稿。' });
    }
  } else throw new Error('未知命令: ' + command);
} catch (error) {
  console.error(JSON.stringify({ status: 'error', message: error.message }));
  process.exitCode = 1;
}
