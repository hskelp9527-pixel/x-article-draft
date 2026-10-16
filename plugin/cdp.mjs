import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function chromePath(override) {
  if (override) {
    if (!path.isAbsolute(override) || !fs.existsSync(override)) throw new Error('Chrome 路径无效，请在设置中选择 chrome.exe / Google Chrome 可执行文件');
    return override;
  }
  const candidates = process.platform === 'win32' ? [
    path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || os.homedir(), 'Google/Chrome/Application/chrome.exe'),
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(p => fs.existsSync(p));
  if (!found) throw new Error('没有找到 Chrome，请先安装 Chrome，或在插件设置中填写可执行文件路径');
  return found;
}
export function localJson(port, endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: endpoint, timeout: 2500 }, response => {
      let body = '';
      response.on('data', data => { body += data; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('无法读取 Chrome 调试状态')); } });
    });
    req.on('timeout', () => req.destroy(new Error('Chrome 连接超时')));
    req.on('error', reject);
  });
}
export class Cdp {
  constructor(socket) {
    this.socket = socket; this.next = 1; this.pending = new Map();
    socket.on('message', bytes => {
      let message; try { message = JSON.parse(bytes.toString()); } catch { return; }
      const item = this.pending.get(message.id);
      if (!item) return;
      this.pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error('Chrome 操作失败: ' + message.error.message));
      else item.resolve(message.result);
    });
    const closed = () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Chrome 已断开连接，请保留现场后重试')); } this.pending.clear(); };
    socket.on('close', closed); socket.on('error', closed);
  }
  static async connect(url, { timeout = 5000 } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1') throw new Error('只允许连接本机 Chrome');
    const socket = new WebSocket(url, { handshakeTimeout: timeout });
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    return new Cdp(socket);
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Chrome 操作超时: ' + method)); }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  close() { this.socket.close(); }
}
export function defaultChromeDataDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'Google/Chrome/User Data');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library/Application Support/Google/Chrome');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'google-chrome');
}
export function readChromeEndpoint(directory) {
  const [port, endpoint] = fs.readFileSync(path.join(directory, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/).map(x => x.trim());
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(endpoint)) throw new Error('Chrome 连接信息无效，请重新启用浏览器的远程调试');
  return `ws://127.0.0.1:${port}${endpoint}`;
}
export async function connectExistingChrome({ dataDir = defaultChromeDataDir(), progress = () => {} } = {}) {
  let endpoint;
  try { endpoint = readChromeEndpoint(dataDir); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('请在已经登录的 Chrome 中打开 chrome://inspect/#remote-debugging，启用远程调试，再回到 Obsidian 点击连接。需要 Chrome 144 或更新版本；不会自动启动专用浏览器。');
    throw error;
  }
  progress('请在已登录的 Chrome 中允许连接');
  try {
    // Chrome 144+ prompts the user to approve this connection. No profile or cookies are copied.
    const cdp = await Cdp.connect(endpoint, { timeout: 60000 });
    return { cdp, existing: true };
  } catch {
    throw new Error('未能连接已登录的 Chrome。请确认浏览器仍在运行，并在 Chrome 的连接提示中点“允许”。若使用非默认 Chrome 数据目录，请在插件设置中填写；不会自动换浏览器。');
  }
}
export class Page {
  constructor(cdp, sessionId, targetId) { this.cdp = cdp; this.sessionId = sessionId; this.targetId = targetId; }
  async send(method, params) { return this.cdp.send(method, params, this.sessionId); }
  async evaluate(fn, ...args) {
    const result = await this.send('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('X 页面操作失败；请保留浏览器现场并反馈当前步骤');
    return result.result?.value;
  }
  async wait(fn, args = [], timeout = 30000) {
    const until = Date.now() + timeout;
    while (Date.now() < until) { if (await this.evaluate(fn, ...args)) return; await delay(250); }
    throw new Error('等待页面超时。请检查 Chrome 的登录状态、Articles 权限或当前弹窗');
  }
  async key(key, code, virtualKey, modifiers = 0) {
    for (const type of ['keyDown', 'keyUp']) await this.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: virtualKey, modifiers });
  }
  async navigate(url) { await this.send('Page.navigate', { url }); }
}
export async function connectChrome({ profile, executable, url = 'https://x.com/compose/articles', headless = false } = {}) {
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const active = path.join(profile, 'DevToolsActivePort');
  async function existing() {
    try {
      const [port, socketPath] = fs.readFileSync(active, 'utf8').trim().split(/\r?\n/);
      if (!/^\d+$/.test(port) || !socketPath?.startsWith('/devtools/browser/')) return null;
      const version = await localJson(Number(port), '/json/version');
      if (version.webSocketDebuggerUrl?.endsWith(socketPath)) return { port: Number(port), url: `ws://127.0.0.1:${port}${socketPath}` };
    } catch { /* stale profile port; a new launch will replace it */ }
    return null;
  }
  let connection = await existing(), launched;
  if (!connection) {
    const args = [`--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--no-first-run', '--no-default-browser-check', ...(headless ? ['--headless=new'] : []), url];
    launched = spawn(chromePath(executable), args, { detached: true, stdio: 'ignore', windowsHide: headless });
    let error;
    launched.on('error', e => { error = e; }); launched.unref();
    const until = Date.now() + 20000;
    while (!connection && Date.now() < until) { if (error) throw new Error('Chrome 无法启动: ' + error.message); await delay(200); connection = await existing(); }
    if (!connection) throw new Error('Chrome 未能启动。请关闭插件专用 Chrome 后重试；不会关闭你的日常浏览器');
  }
  const cdp = await Cdp.connect(connection.url);
  return { cdp, port: connection.port, launched };
}
export async function openPage(cdp, url, { targetId, reuse = true, browserContextId } = {}) {
  const { targetInfos } = await cdp.send('Target.getTargets');
  let target = targetId ? targetInfos.find(t => t.targetId === targetId) : reuse ? targetInfos.find(t => t.type === 'page' && t.url.startsWith(url) && (!browserContextId || t.browserContextId === browserContextId)) : null;
  if (!target) target = await cdp.send('Target.createTarget', { url, ...(browserContextId ? { browserContextId } : {}) });
  const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = new Page(cdp, attached.sessionId, target.targetId);
  await page.send('Page.enable', {}); await page.send('Runtime.enable', {}); await page.send('DOM.enable', {});
  await page.send('Page.bringToFront', {});
  return page;
}
