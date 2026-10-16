#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function windowsHtml(html) {
  const before = '<html><body><!--StartFragment-->';
  const after = '<!--EndFragment--></body></html>';
  const template = 'Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n';
  const startHtml = Buffer.byteLength(template, 'utf8');
  const start = startHtml + Buffer.byteLength(before, 'utf8');
  const end = start + Buffer.byteLength(html, 'utf8');
  const endHtml = end + Buffer.byteLength(after, 'utf8');
  let header = template;
  for (const [key, value] of Object.entries({ StartHTML: startHtml, EndHTML: endHtml, StartFragment: start, EndFragment: end })) header = header.replace(key + ':0000000000', key + ':' + String(value).padStart(10, '0'));
  return header + before + html + after;
}
export function copyHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  if (process.platform === 'win32') {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'x-draft-clipboard-'));
    const temp = path.join(folder, 'clipboard.html');
    try {
      fs.writeFileSync(temp, windowsHtml(html), { mode: 0o600 });
      const script = `Add-Type -AssemblyName System.Windows.Forms
$draftHtml = [System.IO.File]::ReadAllText($env:X_ARTICLE_HTML_FILE, [System.Text.Encoding]::UTF8)
$draftDataObject = New-Object System.Windows.Forms.DataObject
$draftDataObject.SetData('HTML Format', $draftHtml)
[System.Windows.Forms.Clipboard]::SetDataObject($draftDataObject, $true)`;
      execFileSync('powershell.exe', ['-STA', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, X_ARTICLE_HTML_FILE: temp }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  } else if (process.platform === 'darwin') {
    // Only hexadecimal document bytes enter AppleScript source, never user strings.
    const script = 'set the clipboard to {«class HTML»:«data HTML' + Buffer.from(html).toString('hex') + '»}';
    execFileSync('osascript', [], { input: script, stdio: ['pipe', 'pipe', 'pipe'] });
  } else {
    try { execFileSync('wl-copy', ['--type', 'text/html'], { input: html, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) {
      if (e.code !== 'ENOENT') throw new Error('Wayland HTML 剪贴板不可用；请核对 wl-copy 和图形会话');
      try { execFileSync('xclip', ['-selection', 'clipboard', '-t', 'text/html', '-i'], { input: html, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { throw new Error('Linux 需要可用的 wl-copy 或 xclip 图形剪贴板；也可用宿主富文本剪贴板工具'); }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (!process.argv[2]) throw new Error('用法: node scripts/clipboard.mjs /path/body.html');
    copyHtml(process.argv[2]);
    console.log('HTML clipboard ready; use a real paste in the Article editor.');
  } catch (e) { console.error('HTML clipboard failed: ' + e.message); process.exitCode = 1; }
}
