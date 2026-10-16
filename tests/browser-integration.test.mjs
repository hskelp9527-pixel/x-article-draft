import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { chromePath, connectChrome, connectExistingChrome, readChromeEndpoint, openPage, delay } from '../plugin/cdp.mjs';
import { compose, snapshot, assertSnapshot, selectPlaceholder, isDraftUrl, existingXContext } from '../plugin/browser.mjs';

let chrome;
try { chrome = chromePath(process.env.X_DRAFT_TEST_CHROME); } catch { /* optional local Chrome */ }

const fixtureHtml = `<!doctype html><meta charset="utf-8">
<textarea placeholder="Add a title"></textarea>
<div class="DraftEditor-editorContainer"><div contenteditable="true" style="min-height:200px"></div></div>
<button id="insert">Insert</button><button id="media" hidden>Media</button>
<div role="dialog" hidden><button id="upload" aria-label="Add photos or video">Upload</button><input type="file" data-testid="fileInput"></div>
<script>
const editor=document.querySelector('[contenteditable]');
const title=document.querySelector('textarea');
let savedRange;
document.querySelector('#insert').onclick=()=>{savedRange=getSelection().getRangeAt(0).cloneRange();document.querySelector('#media').hidden=false;};
document.querySelector('#media').onclick=()=>{document.querySelector('[role=dialog]').hidden=false;};
document.querySelector('input').onchange=async event=>{
 const file=event.target.files[0]; const reader=new FileReader();
 reader.onload=()=>{editor.focus();const selection=getSelection();selection.removeAllRanges();selection.addRange(savedRange);document.execCommand('insertHTML',false,'<img src="'+reader.result+'">');document.querySelector('[role=dialog]').hidden=true;event.target.value='';persist();};reader.readAsDataURL(file);
};
function persist(){localStorage.setItem('draft',JSON.stringify({title:title.value,html:editor.innerHTML}));}
editor.addEventListener('input',persist);title.addEventListener('input',persist);
const old=JSON.parse(localStorage.getItem('draft')||'null');if(old){title.value=old.title;editor.innerHTML=old.html;}
</script>`;

test('standalone browser fills title, pastes HTML, inserts local images and survives reload', { skip: !chrome, timeout: 45000 }, async t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'x-plugin-browser-test-')));
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fixtureHtml); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let cdp;
  t.after(async () => {
    try { await cdp?.send('Browser.close'); } catch { /* process exiting */ }
    cdp?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await delay(500);
    if (path.dirname(root) !== fs.realpathSync(os.tmpdir())) throw new Error('Unexpected browser fixture directory');
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  });
  const url = 'http://127.0.0.1:' + server.address().port;
  ({ cdp } = await connectChrome({ profile: path.join(root, 'profile'), executable: chrome, url, headless: true }));
  const page = await openPage(cdp, url);
  const image = path.join(root, 'image.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1cAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(image, bytes);
  const crypto = await import('node:crypto');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const article = {
    title: '插件测试 😀', html: '<p>开头 <strong>重点</strong></p>\n<p>XIMGPH_0</p>\n<p>中间</p>\n<p>XIMGPH_1</p>\n<p>结尾</p>\n',
    images: [0, 1].map(n => ({ path: image, sha256, placeholder: 'XIMGPH_' + n })),
  };
  const expected = await compose(page, article, { progress: message => t.diagnostic(message), pasteHtml: (page, html) => page.evaluate(html => document.execCommand('insertHTML', false, html), html) });
  assert.equal(expected.imageCount, 2);
  const before = await page.evaluate(snapshot);
  assertSnapshot(before, expected);
  // Attaching preserves the running browser's exact page/session, and disconnecting leaves it alive.
  const attached = await connectExistingChrome({ dataDir: path.join(root, 'profile') });
  const samePage = await openPage(attached.cdp, url);
  assertSnapshot(await samePage.evaluate(snapshot), expected);
  attached.cdp.close();
  assertSnapshot(await page.evaluate(snapshot), expected);
  const structure = await page.evaluate(() => document.querySelector('[contenteditable]').innerHTML);
  assert.match(structure, /<strong>重点<\/strong>/);
  assert.ok(structure.indexOf('<img') > structure.indexOf('开头'));
  assert.ok(structure.lastIndexOf('<img') < structure.indexOf('结尾'));
  await page.send('Page.reload', {});
  await page.wait(() => !!document.querySelector('textarea'));
  await page.wait(() => [...document.querySelectorAll('[contenteditable] img')].every(i => i.complete && i.naturalWidth));
  assertSnapshot(await page.evaluate(snapshot), expected);
  await assert.rejects(compose(page, article, { pasteHtml: async () => {} }), /已有内容/);
  // Exact placeholder selection must not choose XIMGPH_10 when locating XIMGPH_1.
  await page.evaluate(() => { document.querySelector('[contenteditable]').innerHTML = '<p>XIMGPH_10 XIMGPH_1</p>'; });
  await selectPlaceholder(page, 'XIMGPH_1');
  assert.equal(await page.evaluate(() => getSelection().toString()), 'XIMGPH_1');
});
test('existing browser mode never launches a new profile when connection permission is absent', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'x-existing-browser-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = path.join(root, 'must-not-be-created');
  await assert.rejects(connectExistingChrome({ dataDir: missing }), /chrome:\/\/inspect/);
  assert.equal(fs.existsSync(missing), false);
  const portFile = path.join(root, 'DevToolsActivePort');
  for (const invalid of ['0\n/devtools/browser/id', '65536\n/devtools/browser/id', '9222\n//example.com', '9222\n/devtools/browser/id?other=host']) {
    fs.writeFileSync(portFile, invalid);
    assert.throws(() => readChromeEndpoint(root), /无效/);
  }
  fs.writeFileSync(portFile, '9222\n/devtools/browser/test-id\n');
  assert.equal(readChromeEndpoint(root), 'ws://127.0.0.1:9222/devtools/browser/test-id');
});
test('reuse the X tab browser context and stop when several profiles are ambiguous', async () => {
  const cdp = contexts => ({ send: async () => ({ targetInfos: contexts.map(id => ({ type: 'page', url: 'https://x.com/home', browserContextId: id })) }) });
  assert.equal(await existingXContext(cdp(['profile-a'])), 'profile-a');
  assert.equal(await existingXContext(cdp([])), undefined);
  await assert.rejects(existingXContext(cdp(['profile-a', 'profile-b'])), /多个 Chrome 资料/);
});

test('browser confirmation rejects missing text, missing images and unfinished uploads', () => {
  const expected = { title: 'Test', text: 'Complete body', imageCount: 1 };
  const actual = { ...expected, placeholders: [], pendingImages: false };
  assertSnapshot(actual, expected);
  assert.throws(() => assertSnapshot({ ...actual, text: 'Incomplete' }, expected), /正文/);
  assert.throws(() => assertSnapshot({ ...actual, imageCount: 0 }, expected), /图片/);
  assert.throws(() => assertSnapshot({ ...actual, placeholders: ['XIMGPH_0'] }, expected), /占位符/);
  assert.throws(() => assertSnapshot({ ...actual, pendingImages: true }, expected), /图片/);
  assert.equal(isDraftUrl('https://x.com/compose/articles/edit/123'), true);
  assert.equal(isDraftUrl('https://example.com/compose/articles/edit/123'), false);
  assert.equal(isDraftUrl('https://x.com/compose/articles'), false);
});
