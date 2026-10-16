import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

test('bundled plugin loads in a desktop host and registers the clickable entry point', async () => {
  const require = createRequire(import.meta.url);
  const notices = [];
  class Plugin {
    constructor() {
      this.app = { workspace: { getActiveFile: () => null } };
      this.manifest = { id: 'x-article-draft' };
    }
    async loadData() { return {}; }
    addRibbonIcon(icon, label, callback) { this.ribbon = { icon, label, callback }; }
    addCommand(command) { (this.commands ||= []).push(command); }
    addStatusBarItem() { return { addClass() {}, setText() {}, addEventListener() {} }; }
    addSettingTab(tab) { this.tab = tab; }
  }
  class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; } }
  class Modal {}
  const obsidian = { Plugin, PluginSettingTab, Modal, MarkdownView: class {}, Notice: class { constructor(text) { notices.push(text); } }, requestUrl: () => { throw new Error('Unexpected network request'); } };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, Buffer, process, console, setTimeout, clearTimeout, URL, AbortSignal, AbortController, fetch, Request, FormData, Blob, queueMicrotask, require: name => name === 'obsidian' ? obsidian : name === 'electron' ? { clipboard: {}, shell: {} } : require(name) });
  vm.runInContext(fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8'), context);
  const plugin = new module.exports.default();
  await plugin.onload();
  assert.equal(plugin.ribbon.label, '存到 X 草稿');
  await plugin.ribbon.callback();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(notices[0], '请先打开一篇 Markdown 文章');
  assert.equal(plugin.settings.method, 'browser');
  assert.equal(plugin.settings.browserMode, 'existing');
  assert.equal(plugin.commands.length, 2);
});
