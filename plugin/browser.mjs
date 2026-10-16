import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { stateDir, readState, writeState, withLock } from '../scripts/storage.mjs';
import { connectChrome, openPage, delay } from './cdp.mjs';

export const ARTICLES = 'https://x.com/compose/articles';
export const TITLE_SELECTOR = 'textarea[placeholder="Add a title"],textarea[placeholder="添加标题"],textarea[placeholder="タイトルを追加"],textarea[placeholder="제목 추가"],textarea[name="Article Title"]';
export function isDraftUrl(url) {
  try { const u = new URL(url); return u.origin === 'https://x.com' && /^\/compose\/articles\/.+/.test(u.pathname); } catch { return false; }
}
export function snapshot() {
  const root = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
  const title = document.querySelector('textarea[placeholder="Add a title"],textarea[placeholder="添加标题"],textarea[placeholder="タイトルを追加"],textarea[placeholder="제목 추가"],textarea[name="Article Title"]');
  const text = root?.innerText || '';
  return { title: title?.value || '', text, imageCount: root ? root.querySelectorAll('img').length : 0, pendingImages: root ? [...root.querySelectorAll('img')].some(img => !img.complete || img.naturalWidth === 0) : false, placeholders: text.match(/\bXIMGPH_\d+\b/g) || [], url: location.href };
}
export function assertSnapshot(actual, expected) {
  const normalize = text => String(text).replace(/[\s\u200b\ufeff]+/g, ' ').trim();
  if (actual.title !== expected.title) throw new Error('草稿标题核验失败，未确认保存');
  if (actual.placeholders?.length) throw new Error('草稿仍有图片占位符，未确认保存');
  if (actual.pendingImages || actual.imageCount !== expected.imageCount) throw new Error(`图片核验失败：应有 ${expected.imageCount} 张，检测到 ${actual.imageCount} 张`);
  if (normalize(actual.text) !== normalize(expected.text)) throw new Error('草稿正文核验失败，未确认保存；请保留 Chrome 现场');
}
export async function selectPlaceholder(page, placeholder) {
  const selected = await page.evaluate(value => {
    const root = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
    if (!root) return false;
    root.focus();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || '';
      const pattern = new RegExp('\\b' + value + '\\b');
      const match = pattern.exec(text);
      if (!match) continue;
      node.parentElement?.scrollIntoView({ block: 'center' });
      const range = document.createRange();
      range.setStart(node, match.index); range.setEnd(node, match.index + value.length);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return selection.toString() === value;
    }
    return false;
  }, placeholder);
  if (!selected) throw new Error('无法定位图片位置: ' + placeholder);
}
async function clickText(page, labels, selector = 'button,[role="button"],[role="menuitem"]') {
  const clicked = await page.evaluate((names, selector) => {
    const elements = [...document.querySelectorAll(selector)];
    const match = elements.find(el => el.getClientRects().length && !el.disabled && names.includes((el.getAttribute('aria-label') || el.textContent || '').trim()));
    if (!match) return false;
    match.click(); return true;
  }, labels, selector);
  if (!clicked) throw new Error('找不到 X 控件：' + labels[0] + '。X 页面可能已调整，请保留现场反馈');
}
async function chooseFile(page, image) {
  const bytes = fs.readFileSync(image.path);
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw new Error('图片已变化，请重新上传');
  const { root } = await page.send('DOM.getDocument', {});
  const { nodeIds } = await page.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[role="dialog"] input[type="file"],input[data-testid="fileInput"]' });
  if (!nodeIds.length) throw new Error('找不到图片上传输入框，请保留 Chrome 现场');
  await page.send('DOM.setFileInputFiles', { nodeId: nodeIds.at(-1), files: [image.path] });
  await delay(700);
  await page.evaluate(() => {
    const apply = document.querySelector('[data-testid="applyButton"]');
    if (apply && !apply.disabled && apply.getClientRects().length) apply.click();
  });
}
export async function compose(page, article, { pasteHtml, progress = () => {} } = {}) {
  await page.wait(selector => !!document.querySelector(selector), [TITLE_SELECTOR]);
  const initial = await page.evaluate(snapshot);
  if (initial.title || initial.text.trim() || initial.imageCount) throw new Error('当前编辑器已有内容，已停止，避免覆盖已有草稿');
  progress('填写标题与正文');
  await page.evaluate(selector => document.querySelector(selector).focus(), TITLE_SELECTOR);
  await page.send('Input.insertText', { text: article.title });
  await page.evaluate(() => {
    const root = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
    if (!root) throw new Error('Missing editor');
    root.focus();
  });
  if (!pasteHtml) throw new Error('缺少富文本粘贴能力');
  await pasteHtml(page, article.html);
  await page.wait(() => !!document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]')?.innerText.trim());
  for (let i = 0; i < article.images.length; i++) {
    const image = article.images[i];
    progress(`上传正文图片 ${i + 1}/${article.images.length}`);
    const before = await page.evaluate(snapshot);
    await selectPlaceholder(page, image.placeholder);
    await page.key('Delete', 'Delete', 46);
    await page.wait(value => !new RegExp('\\b' + value + '\\b').test(document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]')?.innerText || ''), [image.placeholder]);
    await clickText(page, ['Insert', '插入', '挿入', '삽입']);
    await clickText(page, ['Media', '媒体', 'メディア', '미디어']);
    await clickText(page, ['Add photos or video', '添加照片或视频', '写真や動画を追加', '사진 또는 동영상 추가']);
    await chooseFile(page, image);
    await page.wait(count => {
      const root = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
      const images = root ? [...root.querySelectorAll('img')] : [];
      return images.length === count + 1 && images.every(img => img.complete && img.naturalWidth > 0);
    }, [before.imageCount]);
  }
  if (article.cover) {
    progress('上传封面');
    await clickText(page, ['Add photos or video', '添加照片或视频', '写真や動画を追加', '사진 또는 동영상 추가']);
    await chooseFile(page, article.cover);
    await page.wait(() => !document.querySelector('[data-testid="applyButton"]'));
  }
  // Compute expected plain text from the prepared HTML in the page, independent of editor contents.
  const text = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent.replace(/\bXIMGPH_\d+\b/g, ''), article.html);
  const expected = { title: article.title, text, imageCount: article.images.length };
  assertSnapshot(await page.evaluate(snapshot), expected);
  return expected;
}
export async function loginBrowser({ executable } = {}) {
  const { cdp } = await connectChrome({ profile: path.join(stateDir(), 'chrome-profile'), executable });
  try { await openPage(cdp, ARTICLES); } finally { cdp.close(); }
}
export async function saveBrowser(article, { executable, pasteHtml, progress = () => {}, confirmNew = async () => false } = {}) {
  return withLock('browser', async () => {
    progress('连接专用 Chrome');
    const { cdp } = await connectChrome({ profile: path.join(stateDir(), 'chrome-profile'), executable });
    try {
      let page = await openPage(cdp, ARTICLES);
      await page.wait(() => !!document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'), [], 15000);
      const account = await page.evaluate(() => document.querySelector('a[data-testid="AppTabBar_Profile_Link"]').getAttribute('href').replace(/^\//, ''));
      if (!account || account.includes('/')) throw new Error('无法核对当前 X 账号；请先在专用 Chrome 中登录');
      const journal = readState('browser-journal', {});
      const noteKey = crypto.createHash('sha256').update(account + ':' + article.vault + ':' + article.note).digest('hex');
      const previous = journal[noteKey];
      if (previous?.status === 'pending') throw new Error('上次操作尚未确认保存，请先在专用 Chrome 检查已有草稿。设置页可打开草稿箱，确认后再清除该任务记录。');
      if (previous?.fingerprint === article.fingerprint && previous.status === 'saved') {
        if (!isDraftUrl(previous.url)) throw new Error('本地草稿地址无效');
        page = await openPage(cdp, previous.url, { reuse: false });
        await page.wait(selector => !!document.querySelector(selector), [TITLE_SELECTOR]);
        assertSnapshot(await page.evaluate(snapshot), previous.expected);
        return { ...previous, reused: true };
      }
      if (previous && !await confirmNew('这篇笔记已经存过草稿，正文或图片已变化。是否新建一份草稿？原草稿会保留。')) return { cancelled: true };
      const pending = { status: 'pending', title: article.title, fingerprint: article.fingerprint, account, startedAt: new Date().toISOString() };
      journal[noteKey] = pending; writeState('browser-journal', journal);
      // New isolated tab prevents accidentally overwriting a manually opened editor.
      page = await openPage(cdp, ARTICLES, { reuse: false });
      await page.wait(() => document.readyState === 'complete');
      await page.wait(() => !!document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'));
      await clickText(page, ['Write', 'Create', '撰写', '创建', '写文章', '書く', '작성']);
      const expected = await compose(page, article, { pasteHtml, progress });
      const current = await page.evaluate(snapshot);
      if (!isDraftUrl(current.url)) throw new Error('未取得可重新打开的草稿地址，请保留 Chrome 现场');
      journal[noteKey] = { ...pending, url: current.url, expected }; writeState('browser-journal', journal);
      progress('等待保存并重新打开核验');
      await page.evaluate(() => { document.activeElement?.blur(); });
      await delay(3500);
      await page.send('Page.reload', {});
      await page.wait(selector => !!document.querySelector(selector), [TITLE_SELECTOR]);
      await page.wait(count => {
        const root = document.querySelector('.DraftEditor-editorContainer [contenteditable="true"]');
        return root && root.querySelectorAll('img').length >= count;
      }, [article.images.length]);
      assertSnapshot(await page.evaluate(snapshot), expected);
      const saved = { ...journal[noteKey], status: 'saved', savedAt: new Date().toISOString(), imageCount: article.images.length };
      journal[noteKey] = saved; writeState('browser-journal', journal);
      return saved;
    } finally { cdp.close(); }
  });
}
