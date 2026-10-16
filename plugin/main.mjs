import { Plugin, PluginSettingTab, Setting, Notice, Modal, MarkdownView, requestUrl } from 'obsidian';
import { clipboard, shell } from 'electron';
import path from 'node:path';
import { prepareArticle } from '../scripts/article.mjs';
import { readState, writeState, stateDir } from '../scripts/storage.mjs';
import { startOAuth, saveApi } from '../scripts/x-api.mjs';
import { saveBrowser, loginBrowser, ARTICLES } from './browser.mjs';

const DEFAULTS = { method: 'browser', browserMode: 'existing', chromeDataDir: '', chromePath: '', clientId: '', configured: false };
async function obsidianRequest(url, options = {}) {
  // Obsidian's native request API avoids browser CORS restrictions in Electron.
  let headers = { ...options.headers }, body;
  if (options.body instanceof FormData) {
    const encoded = new Request(url, { method: 'POST', body: options.body });
    headers['Content-Type'] = encoded.headers.get('content-type');
    body = await encoded.arrayBuffer();
  } else if (options.body instanceof URLSearchParams) body = options.body.toString();
  else body = options.body;
  const pending = requestUrl({ url, method: options.method || 'GET', headers, body, throw: false });
  let remove;
  const result = await Promise.race([pending, new Promise((_, reject) => {
    const abort = () => reject(new Error('网络请求超时，请先检查 X 草稿箱再决定是否重试'));
    if (options.signal?.aborted) return abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    remove = () => options.signal?.removeEventListener('abort', abort);
  })]).finally(() => remove?.());
  return { ok: result.status >= 200 && result.status < 300, status: result.status, text: async () => result.text };
}
class MessageModal extends Modal {
  constructor(app, title, message, actions = []) { super(app); this.heading = title; this.message = message; this.actions = actions; }
  onOpen() {
    this.titleEl.setText(this.heading);
    this.contentEl.createEl('p', { text: this.message, cls: 'x-article-draft-message' });
    const buttons = this.contentEl.createDiv({ cls: 'x-article-draft-actions' });
    for (const action of this.actions) {
      const button = buttons.createEl('button', { text: action.label, cls: action.primary ? 'mod-cta' : '' });
      button.addEventListener('click', () => { this.close(); action.run?.(); });
    }
  }
  onClose() { this.contentEl.empty(); this.dismiss?.(); }
}
function confirm(app, message, label = '新建草稿') {
  return new Promise(resolve => {
    let chosen = false;
    const modal = new MessageModal(app, 'X 草稿', message, [
      { label: '取消', run: () => resolve(false) },
      { label, primary: true, run: () => { chosen = true; resolve(true); } },
    ]);
    // Defer closing dismissal so button handlers can resolve the intended action.
    modal.dismiss = () => queueMicrotask(() => { if (!chosen) resolve(false); });
    modal.open();
  });
}
export default class XArticleDraftPlugin extends Plugin {
  async onload() {
    this.settings = { ...DEFAULTS, ...await this.loadData() };
    this.busy = false; this.authorizing = false; this.unloaded = false;
    this.authorizationController = new AbortController();
    this.request = (url, options) => {
      if (this.unloaded) throw new Error('插件已关闭，操作已停止；请先检查已有草稿');
      return obsidianRequest(url, options);
    };
    this.addRibbonIcon('send', '存到 X 草稿', () => void this.saveCurrent());
    this.addCommand({ id: 'save-current-note', name: '将当前文章存到 X 草稿', callback: () => void this.saveCurrent() });
    this.addCommand({ id: 'open-setup', name: '首次配置 / 打开 X 登录', callback: () => this.openSetup() });
    this.status = this.addStatusBarItem(); this.status.addClass('x-article-draft-status'); this.status.setText('X 草稿');
    this.status.addEventListener('click', () => this.openSetup());
    this.addSettingTab(new DraftSettings(this.app, this));
  }
  onunload() { this.unloaded = true; this.authorizationController.abort(); }
  async updateSettings() { await this.saveData(this.settings); }
  notifyError(error) {
    new MessageModal(this.app, '尚未完成保存', error.message || String(error), [{ label: '知道了' }, { label: '打开 X 草稿箱', run: () => void this.openLogin() }]).open();
  }
  openSetup() {
    const modal = new MessageModal(this.app, '连接你已登录的 Chrome', '默认复用已经登录的 Chrome，不会新开空账号浏览器。\n\n首次请在该 Chrome 打开 chrome://inspect/#remote-debugging，启用远程调试，再回来点“连接已登录的 Chrome”，并在 Chrome 提示中允许连接。之后即可点左侧“存到 X 草稿”。\n\n需要 Chrome 144+ 和能使用 X Articles 的账号。', [
      { label: '关闭' },
      { label: '插件设置', run: () => { this.app.setting.open(); this.app.setting.openTabById(this.manifest.id); } },
      { label: '复制 Chrome 设置地址', run: () => { clipboard.writeText('chrome://inspect/#remote-debugging'); new Notice('已复制，请粘贴到已经登录的 Chrome 地址栏'); } },
      { label: '连接已登录的 Chrome', primary: true, run: async () => { this.settings.browserMode = 'existing'; await this.updateSettings(); await this.openLogin(); } },
    ]);
    modal.open();
  }
  async openLogin() {
    try {
      await loginBrowser({ mode: this.settings.browserMode, executable: this.settings.chromePath || undefined, dataDir: this.settings.chromeDataDir || undefined, progress: message => new Notice(message, 8000) });
      this.settings.configured = true; await this.updateSettings();
      new Notice(this.settings.browserMode === 'existing' ? '已连接现有 Chrome，并打开 X 草稿箱。回到 Obsidian 点“存到 X 草稿”即可。' : '已打开专用 Chrome。请登录 X 后回到 Obsidian 点“存到 X 草稿”。', 10000);
    } catch (error) { new Notice(error.message, 12000); }
  }
  async authorize() {
    if (this.authorizing) return new Notice('已有授权窗口在等待完成');
    if (!this.settings.clientId.trim()) return new Notice('请先填写 OAuth 2.0 Client ID');
    this.authorizing = true;
    new Notice('即将打开 X 授权页。完成后自动保存到本机，无需复制令牌。', 8000);
    try {
      const result = await startOAuth(this.settings.clientId.trim(), { request: this.request, signal: this.authorizationController.signal, onReady: url => void shell.openExternal(url) });
      this.settings.configured = true; this.settings.method = 'api'; await this.updateSettings();
      new Notice('已授权 @' + result.user.username + '，现在可以点“存到 X 草稿”。', 10000);
    } catch (error) { this.notifyError(error); }
    finally { this.authorizing = false; }
  }
  async saveCurrent() {
    if (this.busy || this.authorizing) return new Notice('已有 X 草稿任务在运行，请等它完成');
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== 'md') return new Notice('请先打开一篇 Markdown 文章');
    if (!this.settings.configured) { this.openSetup(); return; }
    const adapter = this.app.vault.adapter;
    if (typeof adapter.getBasePath !== 'function') return new Notice('本插件目前只支持本机桌面知识库');
    this.busy = true;
    const progress = text => {
      if (this.unloaded) throw new Error('插件已关闭，操作已停止；请先检查已有草稿');
      this.status.setText('X · ' + text);
    };
    try {
      progress('查找图片');
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const rawText = view?.file?.path === file.path ? view.editor.getValue() : await this.app.vault.read(file);
      const vault = adapter.getBasePath();
      const article = prepareArticle(path.join(vault, file.path), {
        vault, rawText,
        resolveImagePath: ref => {
          const target = this.app.metadataCache.getFirstLinkpathDest(ref, file.path);
          return target ? path.join(vault, target.path) : undefined;
        },
      });
      let result;
      if (this.settings.method === 'api') {
        if (article.warnings.length && !await confirm(this.app, 'X API 的格式转换提示：\n' + article.warnings.join('\n') + '\n\n是否继续保存？', '继续保存')) return;
        progress('上传到 X');
        result = await saveApi(article, { request: this.request });
      } else {
        result = await saveBrowser(article, {
          mode: this.settings.browserMode, dataDir: this.settings.chromeDataDir || undefined, executable: this.settings.chromePath || undefined, progress,
          confirmNew: message => confirm(this.app, message),
          pasteHtml: async (page, html) => {
            clipboard.write({ html });
            await page.key('v', 'KeyV', 86, process.platform === 'darwin' ? 4 : 2);
          },
        });
      }
      if (result.cancelled) return;
      const message = `${result.reused ? '已找到之前保存的草稿' : '已存入 X 草稿'}\n文章：${article.title}\n账号：@${result.account || result.user}\n正文图片：${article.images.length} 张${result.articleId ? '\n草稿 ID：' + result.articleId : ''}${this.settings.method === 'browser' ? '\n已重新打开并核验正文与图片。' : result.reused ? '\n本次复用了本地草稿记录；尚未重新向 X 核验。' : '\nX API 已返回草稿 ID。'}`;
      new MessageModal(this.app, 'X 草稿已准备好', message, [{ label: '完成', primary: true }, { label: '查看草稿', run: () => void shell.openExternal(result.url || ARTICLES) }]).open();
    } catch (error) { this.notifyError(error); }
    finally { this.busy = false; if (!this.unloaded) this.status.setText('X 草稿'); }
  }
}
class DraftSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.draft = plugin; }
  display() {
    const p = this.draft, el = this.containerEl; el.empty();
    el.createEl('h2', { text: 'X Article Draft' });
    el.createEl('p', { text: '打开文章，点左侧发送图标即可开始。正文与附件只读，插件只保存 X 草稿。' });
    new Setting(el).setName('保存方式').setDesc('浏览器方式无需开发者应用；官方 API 的使用费用以 X 控制台为准。').addDropdown(drop => drop.addOption('browser', 'Chrome 浏览器（默认）').addOption('api', '官方 API').setValue(p.settings.method).onChange(async value => { p.settings.method = value; await p.updateSettings(); this.display(); }));
    if (p.settings.method === 'browser') {
      new Setting(el).setName('使用哪个浏览器').setDesc('默认连接已经登录的 Chrome。只有明确选择备用方式时，才启动专用浏览器。').addDropdown(drop => drop.addOption('existing', '已登录的 Chrome（默认）').addOption('dedicated', '专用 Chrome（备用，需要单独登录）').setValue(p.settings.browserMode).onChange(async value => { p.settings.browserMode = value; await p.updateSettings(); this.display(); }));
      if (p.settings.browserMode === 'existing') {
        new Setting(el).setName('首次允许连接').setDesc('在已登录的 Chrome（144+）打开 chrome://inspect/#remote-debugging 并启用，再点击连接；Chrome 询问时点允许。').addButton(button => button.setButtonText('复制设置地址').onClick(() => { clipboard.writeText('chrome://inspect/#remote-debugging'); new Notice('地址已复制，请粘贴到现有 Chrome 地址栏'); }));
        new Setting(el).setName('连接当前浏览器').setDesc('保留目标 X 账号的标签页，直接复用登录状态，不复制 Cookie，也不关闭或重启浏览器。').addButton(button => button.setButtonText('连接已登录的 Chrome').setCta().onClick(() => void p.openLogin()));
        new Setting(el).setName('Chrome 数据目录（可选）').setDesc('通常留空。仅自定义安装或非默认资料根目录时填写；这是包含 DevToolsActivePort 的 User Data 根目录，不是 Profile 11 子目录。').addText(text => text.setPlaceholder('自动使用 Chrome 默认数据目录').setValue(p.settings.chromeDataDir).onChange(async value => { p.settings.chromeDataDir = value.trim(); await p.updateSettings(); }));
      } else {
        new Setting(el).setName('打开专用 Chrome').setDesc('独立资料需要单独登录，Google 登录可能被此方式拒绝；遇到该情况请改用现有浏览器。').addButton(button => button.setButtonText('打开专用 Chrome').onClick(() => void p.openLogin()));
        new Setting(el).setName('Chrome 路径（可选）').setDesc('一般留空自动查找。未找到 Chrome 时填写可执行文件路径。').addText(text => text.setPlaceholder('自动查找 Chrome').setValue(p.settings.chromePath).onChange(async value => { p.settings.chromePath = value.trim(); await p.updateSettings(); }));
      }
    } else {
      const auth = readState('auth');
      el.createEl('p', { text: auth.user?.username ? '当前已授权：@' + auth.user.username : '尚未授权 X 账号。' });
      new Setting(el).setName('申请和配置指引').setDesc('需要开发者应用、Public client、回调地址和 Client ID。每一步的网站与填写方法都在指南中。').addButton(button => button.setButtonText('打开配置指南').onClick(() => void shell.openExternal('https://github.com/hskelp9527-pixel/x-article-draft/blob/main/docs/obsidian-plugin.md#官方-api可选')));
      new Setting(el).setName('OAuth 2.0 Client ID').setDesc('填写应用的 Client ID。无需填写 API Key、Client Secret 或访问令牌。').addText(text => text.setValue(p.settings.clientId).onChange(async value => { p.settings.clientId = value.trim(); await p.updateSettings(); }));
      new Setting(el).setName('授权 X 账号').setDesc('回调地址：http://127.0.0.1:8765/callback。授权只需首次完成，之后自动尝试续期。').addButton(button => button.setButtonText('连接 X 账号').setCta().onClick(() => void p.authorize()));
    }
    el.createEl('h3', { text: '使用与恢复' });
    new Setting(el).setName('操作指南').setDesc('安装、首次登录、图片路径和常见问题。').addButton(button => button.setButtonText('查看指南').onClick(() => void shell.openExternal('https://github.com/hskelp9527-pixel/x-article-draft/blob/main/docs/obsidian-plugin.md')));
    new Setting(el).setName('查看草稿箱').setDesc('浏览器保存失败时，先检查现有草稿，保留 Chrome 现场。').addButton(button => button.setButtonText('打开草稿箱').onClick(() => p.settings.method === 'browser' ? void p.openLogin() : void shell.openExternal(ARTICLES)));
    const pending = Object.values(readState('browser-journal')).filter(item => item.status === 'pending').length + Object.values(readState('journal')).filter(item => item.status === 'pending').length;
    if (pending) new Setting(el).setName(`有 ${pending} 个任务未确认结果`).setDesc('先到 X 检查是否已经保存。清除后再次点击会尝试新建，可能产生副本。').addButton(button => button.setButtonText('检查后清除记录').onClick(async () => {
      if (p.busy) return new Notice('请先等待当前任务结束');
      if (!await confirm(this.app, '请先确认 X 草稿箱中现有内容。清除这些记录后，再运行可能新建重复草稿。确定清除？', '清除未确认记录')) return;
      for (const name of ['browser-journal', 'journal']) {
        const journal = readState(name); for (const [key, item] of Object.entries(journal)) if (item.status === 'pending') delete journal[key]; writeState(name, journal);
      }
      this.display();
    }));
    el.createEl('p', { text: '登录状态与授权保存在本机个人目录：' + stateDir(), cls: 'setting-item-description' });
  }
}
