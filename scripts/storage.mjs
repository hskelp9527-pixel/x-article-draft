import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const stateDir = () => path.resolve(process.env.X_ARTICLE_DRAFT_HOME || path.join(os.homedir(), '.x-article-draft'));
export function readState(name, fallback = {}) {
  const file = path.join(stateDir(), name + '.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
export function writeState(name, data) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = path.join(stateDir(), name + '.json');
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, file);
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}
export async function withLock(name, action) {
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = path.join(stateDir(), name + '.lock');
  let fd;
  try { fd = fs.openSync(file, 'wx', 0o600); } catch (e) {
    if (e.code === 'EEXIST') throw new Error('已有任务或未清理的锁: ' + file + '。确认没有任务运行后才能移除。');
    throw e;
  }
  try { fs.writeSync(fd, String(process.pid)); return await action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(file); }
}
