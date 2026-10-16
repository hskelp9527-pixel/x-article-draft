import { Plugin, PluginSettingTab, Setting, Notice, Modal, MarkdownView, requestUrl } from 'obsidian';
import { clipboard, shell } from 'electron';
import path from 'node:path';
import { prepareArticle } from '../scripts/article.mjs';
import { readState, writeState, stateDir } from '../scripts/storage.mjs';
import { startOAuth, saveApi } from '../scripts/x-api.mjs';
import { saveBrowser, loginBrowser, ARTICLES } from './browser.mjs';

const DEFAULTS = { method: 'browser', chromePath: '', clientId: '', configured: false };
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
    const modal = new MessageModal(this.app, '把当前文章存到 X 草稿', '默认使用专用 Chrome。第一次登录 X 后，回到 Obsidian 再点左侧“存到 X 草稿”。之后插件会自动找图、上传并检查草稿，不需要打开 AI 对话。\n\n需要能使用 X Articles 的账号。选择官方 API 的用户可在插件设置中完成授权。', [
      { label: '关闭' },
      { label: '插件设置', run: () => { this.app.setting.open(); this.app.setting.openTabById(this.manifest.id); } },
      { label: '打开 Chrome 登录 X', primary: true, run: () => void this.openLogin() },
    ]);
    modal.open();
  }
  async openLogin() {
    try {
      await loginBrowser({ executable: this.settings.chromePath || undefined });
      this.settings.configured = true; await this.updateSettings();
      new Notice('已打开专用 Chrome。请登录 X，并确认可以撰写 Article；之后回到 Obsidian 点“存到 X 草稿”。', 10000);
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
          executable: this.settings.chromePath || undefined, progress,
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
      new Setting(el).setName('第一次登录 X').setDesc('在插件专用 Chrome 里登录一次，之后保留登录状态。请确认该账号能使用 Articles。').addButton(button => button.setButtonText('打开 Chrome 登录').setCta().onClick(() => void p.openLogin()));
      new Setting(el).setName('Chrome 路径（可选）').setDesc('一般留空自动查找。未找到 Chrome 时，填写它的完整可执行文件路径。').addText(text => text.setPlaceholder('自动查找 Chrome').setValue(p.settings.chromePath).onChange(async value => { p.settings.chromePath = value.trim(); await p.updateSettings(); }));
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
