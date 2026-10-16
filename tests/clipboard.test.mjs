import test from 'node:test';
import assert from 'node:assert/strict';
import { windowsHtml } from '../scripts/clipboard.mjs';

test('Windows CF_HTML uses UTF-8 byte offsets for Chinese and emoji', () => {
  const html = '<p>中文 😀 <strong>格式</strong></p>';
  const result = windowsHtml(html), bytes = Buffer.from(result);
  const field = name => Number(result.match(new RegExp(name + ':(\\d+)'))[1]);
  assert.equal(bytes.subarray(field('StartFragment'), field('EndFragment')).toString(), html);
  assert.equal(bytes.subarray(field('StartHTML'), field('EndHTML')).toString(), '<html><body><!--StartFragment-->' + html + '<!--EndFragment--></body></html>');
  assert.equal(field('EndHTML'), bytes.length);
});
