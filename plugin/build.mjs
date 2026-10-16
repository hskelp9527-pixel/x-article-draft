import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
await build({
  absWorkingDir: root, entryPoints: ['plugin/main.mjs'], outfile: 'main.js',
  bundle: true, platform: 'node', format: 'cjs', target: 'node18',
  external: ['obsidian', 'electron', 'bufferutil', 'utf-8-validate'],
  sourcemap: false, legalComments: 'inline',
});
const licenses = [];
for (const name of ['markdown-it', 'yaml', 'ws', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro']) {
  const dir = path.join(root, 'node_modules', name);
  if (!fs.existsSync(dir)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const file = fs.readdirSync(dir).find(f => /^licen[sc]e(?:\.|$)/i.test(f));
  licenses.push(`${name}@${meta.version}\n${file ? fs.readFileSync(path.join(dir, file), 'utf8') : 'License: ' + meta.license}`);
}
fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.txt'), licenses.join('\n\n----------------\n\n'));
console.log('Built main.js and THIRD_PARTY_NOTICES.txt. Install with manifest.json and styles.css.');
