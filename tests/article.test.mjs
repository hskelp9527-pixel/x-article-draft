import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareArticle, apiPayload, findVault } from '../scripts/article.mjs';

function fixture(t) {
  // macOS /var is an alias for /private/var; compare canonical file locations.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'x-draft-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.obsidian'));
  fs.writeFileSync(path.join(root, '.obsidian/app.json'), JSON.stringify({ attachmentFolderPath: '附件' }));
  fs.mkdirSync(path.join(root, '文章'));
  fs.mkdirSync(path.join(root, '附件'));
  const note = path.join(root, '文章/笔记.md');
  const image = (name = '截图.png', data = 'test-image') => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file; };
  const prepare = (body, opts = {}) => { fs.writeFileSync(note, body); return prepareArticle(note, opts); };
  return { root, note, image, prepare };
}
test('pasted attachments, project images, encoded names, reference images retain positions', t => {
  const f = fixture(t);
  f.image('附件/Pasted image.png'); f.image('文章/插图/解释.png');
  const a = f.prepare('# 标题\n\n开头\n\n![[Pasted image.png|640]]\n\n中间\n\n![解释](插图/解释.png)\n\n![再次][shot]\n\n结尾\n\n[shot]: ../附件/Pasted%20image.png');
  assert.equal(a.title, '标题'); assert.equal(a.images.length, 3);
  assert.equal(a.images[0].path, path.join(f.root, '附件/Pasted image.png'));
  assert.deepEqual(a.content_state.blocks.map(b => b.text), ['开头', ' ', '中间', ' ', ' ', '结尾']);
  assert.equal((a.html.match(/XIMGPH_\d/g) || []).length, 3);
  assert.ok(!a.html.includes('<h1>'));
  assert.equal(findVault(f.note), f.root);
});
test('missing and ambiguous images fail rather than silently selecting or dropping', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare('![[missing.png]]'), /找不到图片/);
  f.image('one/same.png'); f.image('two/same.png');
  assert.throws(() => f.prepare('![[same.png]]'), /重名/);
  assert.equal(f.prepare('![[one/same.png]]').images.length, 1);
});
test('attachment setting relative to note resolves without hardcoded folder', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.obsidian/app.json'), JSON.stringify({ attachmentFolderPath: './assets' }));
  f.image('文章/assets/clipboard.png');
  assert.equal(f.prepare('![[clipboard.png]]').images[0].path, path.join(f.root, '文章/assets/clipboard.png'));
});
test('code examples are not mistaken for image references', t => {
  const f = fixture(t);
  const a = f.prepare('示例 `![[missing.png]]`\n\n```md\n![a](missing.png)\n```');
  assert.equal(a.images.length, 0);
  assert.match(a.content_state.entities[0].value.data.markdown, /missing.png/);
});
test('semantic formatting uses correct UTF-16 offsets with emoji', t => {
  const f = fixture(t);
  const a = f.prepare('😀 **中文** *斜体* ~~删除~~ [链接](https://example.com)');
  const b = a.content_state.blocks[0];
  assert.equal(b.text, '😀 中文 斜体 删除 链接');
  assert.deepEqual(b.inline_style_ranges[0], { style: 'bold', offset: 3, length: 2 });
  const range = b.entity_ranges[0];
  assert.equal(b.text.slice(range.offset, range.offset + range.length), '链接');
  assert.equal(a.content_state.entities[0].value.data.url, 'https://example.com');
});
test('cover, table, code, list and quote survive with clear lossy-format warnings', t => {
  const f = fixture(t); f.image('附件/cover.png');
  const a = f.prepare('---\ntitle: 测试\ncover: 附件/cover.png\n---\n\n## 小标题\n\n> 引用\n\n- 父项\n  - 子项\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nlet x = 1;\n```');
  assert.equal(a.title, '测试'); assert.ok(a.cover);
  assert.ok(a.warnings.some(w => w.includes('嵌套列表')));
  assert.ok(a.content_state.blocks.some(b => b.type === 'blockquote'));
  const markdown = a.content_state.entities.filter(e => e.value.type === 'markdown');
  assert.equal(markdown.length, 2);
});
test('all image ids must be uploaded before producing API payload', t => {
  const f = fixture(t); f.image('附件/a.png');
  const a = f.prepare('前 ![[a.png]] 后');
  assert.throws(() => apiPayload(a, {}), /尚未上传/);
  const payload = apiPayload(a, { XIMGPH_0: '123' });
  assert.equal(payload.content_state.entities[0].value.data.media_items[0].media_id, '123');
  assert.equal(a.content_state.entities[0].value.data.media_items[0].media_id, 'XIMGPH_0');
});
test('unchanged content fingerprints stable and changed image bytes invalidate them', t => {
  const f = fixture(t); f.image('附件/a.png', 'one');
  const first = f.prepare('![[a.png]]');
  assert.equal(f.prepare('![[a.png]]').fingerprint, first.fingerprint);
  f.image('附件/a.png', 'two');
  assert.notEqual(f.prepare('![[a.png]]').fingerprint, first.fingerprint);
});
test('reject external images, traversal, oversize files and reserved placeholders', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare('![a](https://example.com/a.png)'), /外链/);
  const outside = path.join(path.dirname(f.root), path.basename(f.root) + '-outside.png');
  fs.writeFileSync(outside, 'private'); t.after(() => fs.unlinkSync(outside));
  assert.throws(() => f.prepare(`![a](../../${path.basename(outside)})`), /超出 vault/);
  f.image('附件/large.png', Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.throws(() => f.prepare('![[large.png]]'), /5MB/);
  assert.throws(() => f.prepare('XIMGPH_0'), /保留/);
});
