import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { parse as parseYaml } from 'yaml';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const ignored = new Set(['.git', '.obsidian', 'node_modules', '.trash']);
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
export function findVault(note) {
  let folder = path.dirname(path.resolve(note));
  while (true) {
    if (fs.existsSync(path.join(folder, '.obsidian'))) return folder;
    const parent = path.dirname(folder);
    if (parent === folder) return path.dirname(path.resolve(note));
    folder = parent;
  }
}
function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
export function imageResolver(vault, note, lookup) {
  const root = fs.realpathSync(vault);
  if (!inside(root, fs.realpathSync(note))) throw new Error('笔记不在指定 vault 内');
  let attachment = '';
  const config = path.join(root, '.obsidian', 'app.json');
  if (fs.existsSync(config)) attachment = JSON.parse(fs.readFileSync(config, 'utf8')).attachmentFolderPath || '';
  let index;
  function allImages() {
    if (index) return index;
    index = [];
    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (mime[path.extname(file).toLowerCase()]) index.push(file);
      }
    }
    walk(root);
    return index;
  }
  return source => {
    let ref;
    try { ref = decodeURIComponent(source); } catch { throw new Error('图片路径编码无效: ' + source); }
    ref = ref.replaceAll('\\', '/');
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^[A-Za-z]:\//.test(ref)) {
      throw new Error('请先将外链/嵌入图片保存到 vault 再上传: ' + source);
    }
    ref = ref.split('#')[0];
    const noteDir = path.dirname(path.resolve(note));
    const resolvedLink = lookup?.(ref);
    const candidates = [resolvedLink, path.resolve(noteDir, ref), path.resolve(root, ref)].filter(Boolean);
    if (attachment && attachment !== '/') candidates.push(path.resolve(attachment.startsWith('./') ? noteDir : root, attachment, ref));
    let found = candidates.find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    if (!found) {
      const matches = allImages().filter(file => path.relative(root, file).replaceAll(path.sep, '/').endsWith('/' + ref) || path.relative(root, file).replaceAll(path.sep, '/') === ref);
      if (matches.length > 1) throw new Error('图片重名，请在笔记中写明目录: ' + source + '\n' + matches.join('\n'));
      found = matches[0];
    }
    if (!found) throw new Error('找不到图片: ' + source);
    const real = fs.realpathSync(found);
    if (!inside(root, real)) throw new Error('图片超出 vault: ' + source);
    const type = mime[path.extname(real).toLowerCase()];
    if (!type) throw new Error('暂不支持此图片格式: ' + source + '（请转为 PNG/JPEG/WebP/GIF）');
    const bytes = fs.readFileSync(real);
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error('图片为空或超过本工具首版 5MB 限制: ' + source);
    return { path: real, mime: type, sha256: hash(bytes), size: bytes.length };
  };
}
function parser() {
  const md = new MarkdownIt({ html: false, breaks: false });
  md.inline.ruler.before('image', 'obsidian_image', (state, silent) => {
    if (!state.src.startsWith('![[', state.pos)) return false;
    const end = state.src.indexOf(']]', state.pos + 3);
    if (end < 0) return false;
    if (!silent) {
      const [source] = state.src.slice(state.pos + 3, end).split('|');
      const token = state.push('image', 'img', 0);
      token.attrs = [['src', source.trim()], ['alt', '']];
      token.children = [];
    }
    state.pos = end + 2;
    return true;
  });
  return md;
}
export function prepareArticle(note, { vault = findVault(note), title, cover, rawText, resolveImagePath } = {}) {
  note = path.resolve(note);
  const raw = (rawText ?? fs.readFileSync(note, 'utf8')).replace(/^\uFEFF/, '');
  let body = raw, front = {};
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (fm) { front = parseYaml(fm[1]) || {}; body = raw.slice(fm[0].length); }
  const md = parser();
  const tokens = md.parse(body, {});
  const resolve = imageResolver(vault, note, resolveImagePath);
  if (/\bXIMGPH_\d+\b/.test(body)) throw new Error('正文含保留的图片占位符 XIMGPH_，请先改名');
  const images = [], warnings = [], blocks = [], entities = [];
  const entity = (type, data, mutability = 'immutable') => {
    const key = entities.length;
    entities.push({ key: String(key), value: { type, mutability, data } });
    return key;
  };
  const atomic = (type, data, text = ' ', mutability) => blocks.push({ type: 'atomic', text, entity_ranges: [{ key: entity(type, data, mutability), offset: 0, length: text.length }] });
  let list = [], quote = 0, heading = '', h1Title = '', browserParts = [], removedTitleIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') { heading = t.tag; continue; }
    if (t.type === 'heading_close') { heading = ''; continue; }
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') { list.push(t.type); if (list.length > 1) warnings.push('嵌套列表在 API 中展开为同级列表'); continue; }
    if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') { list.pop(); continue; }
    if (t.type === 'blockquote_open') { quote++; continue; }
    if (t.type === 'blockquote_close') { quote--; continue; }
    if (t.type === 'fence' || t.type === 'code_block') { atomic('markdown', { markdown: '```' + t.info + '\n' + t.content + '```' }, ' ', 'mutable'); continue; }
    if (t.type === 'table_open') {
      const start = t.map[0], end = t.map[1];
      atomic('markdown', { markdown: body.split('\n').slice(start, end).join('\n') }, ' ', 'mutable');
      while (i < tokens.length && tokens[i].type !== 'table_close') i++;
      continue;
    }
    if (t.type === 'hr') { atomic('divider', {}); continue; }
    if (t.type !== 'inline') continue;
    const children = t.children || [];
    if (heading === 'h1' && !h1Title) {
      h1Title = children.filter(c => c.type === 'text' || c.type === 'code_inline').map(c => c.content).join('');
      if (!title && !front.title) { removedTitleIndex = i; continue; }
    }
    const type = heading ? ({ h1: 'header-one', h2: 'header-two' }[heading] || 'header-three') : list.length ? (list.at(-1) === 'ordered_list_open' ? 'ordered-list-item' : 'unordered-list-item') : quote ? 'blockquote' : 'unstyled';
    let block = { type, text: '', inline_style_ranges: [], entity_ranges: [] };
    let styles = [], links = [];
    const flush = () => { if (block.text) blocks.push(block); block = { type, text: '', inline_style_ranges: [], entity_ranges: [] }; };
    const append = text => {
      const offset = block.text.length;
      block.text += text;
      for (const style of styles) block.inline_style_ranges.push({ style, offset, length: text.length });
      if (links.length) block.entity_ranges.push({ key: links.at(-1), offset, length: text.length });
    };
    for (const child of children) {
      if (child.type === 'image') {
        flush();
        const image = { ...resolve(child.attrGet('src')), alt: child.content || child.attrGet('alt') || '', placeholder: 'XIMGPH_' + images.length };
        images.push(image);
        atomic('image', { media_items: [{ media_category: 'tweet_image', media_id: image.placeholder }], caption: image.alt });
        child.attrSet('src', image.placeholder);
      } else if (child.type === 'strong_open') styles.push('bold');
      else if (child.type === 'em_open') styles.push('italic');
      else if (child.type === 's_open') styles.push('strikethrough');
      else if (/_close$/.test(child.type) && ['strong_close', 'em_close', 's_close'].includes(child.type)) styles.pop();
      else if (child.type === 'link_open') links.push(entity('link', { url: child.attrGet('href') }, 'mutable'));
      else if (child.type === 'link_close') links.pop();
      else if (child.type === 'softbreak' || child.type === 'hardbreak') append('\n');
      else if (child.type === 'code_inline') { append(child.content); warnings.push('行内代码在 API 中作为普通文本保存'); }
      else append(child.content);
    }
    flush();
  }
  const finalTitle = String(title || front.title || h1Title || path.basename(note, path.extname(note))).trim();
  if (!finalTitle || !blocks.length) throw new Error('文章标题或正文为空');
  // Render browser HTML from the same parsed tokens; image placeholders remain in order.
  md.renderer.rules.image = (ts, idx) => '<span>' + md.utils.escapeHtml(ts[idx].attrGet('src')) + '</span>';
  const browserTokens = removedTitleIndex < 0 ? tokens : tokens.filter((_, i) => i < removedTitleIndex - 1 || i > removedTitleIndex + 1);
  browserParts.push(md.renderer.render(browserTokens, md.options, {}));
  const coverRef = cover || front.cover_image || front.coverImage || front.cover;
  const coverImage = coverRef ? resolve(String(coverRef)) : null;
  const content_state = { blocks, entities };
  const fingerprint = hash(JSON.stringify({ title: finalTitle, content_state, images: images.map(x => x.sha256), cover: coverImage?.sha256 }));
  return { version: 1, note, vault: path.resolve(vault), title: finalTitle, content_state, images, cover: coverImage, warnings: [...new Set(warnings)], html: browserParts.join(''), fingerprint };
}
export function apiPayload(article, mediaIds) {
  const payload = { title: article.title, content_state: structuredClone(article.content_state) };
  for (const e of payload.content_state.entities) if (e.value.type === 'image') {
    for (const item of e.value.data.media_items) {
      const id = mediaIds[item.media_id];
      if (!id) throw new Error('图片尚未上传: ' + item.media_id);
      item.media_id = id;
    }
  }
  if (article.cover) {
    if (!mediaIds.cover) throw new Error('封面尚未上传');
    payload.cover_media = { media_category: 'tweet_image', media_id: mediaIds.cover };
  }
  return payload;
}
