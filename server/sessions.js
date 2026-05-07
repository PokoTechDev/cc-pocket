// Sessions Discovery — spec/03 §3.6
// ~/.claude/projects/<encoded>/<sessionId>.jsonl から直近セッションを scan する。
// 各 jsonl 内に "cwd" フィールドが入っているので encoded path のあいまい復号は不要。

import {
  closeSync,
  existsSync as defaultExistsSync,
  openSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, join } from 'node:path';

const JSONL_HEAD_BYTES = 16384;
const FIRST_MESSAGE_MAX = 80;
export const RECENT_LIMIT_MIN = 1;
export const RECENT_LIMIT_MAX = 50;
export const RECENT_LIMIT_DEFAULT = 10;

function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

export function extractCwdFromHead(text) {
  if (!text) return null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const obj = safeJson(line);
    if (obj && typeof obj.cwd === 'string' && obj.cwd.length > 0) {
      return obj.cwd;
    }
  }
  return null;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return null;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join('');
}

export function parseFirstUserMessage(text) {
  if (!text) return null;
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const obj = safeJson(line);
    if (obj?.type !== 'user') continue;
    const extracted = extractTextFromContent(obj?.message?.content);
    if (extracted && extracted.length > 0) {
      return truncate(extracted, FIRST_MESSAGE_MAX);
    }
  }
  return null;
}

function readJsonlHead(filepath, maxBytes = JSONL_HEAD_BYTES) {
  let fd;
  try { fd = openSync(filepath, 'r'); }
  catch { return ''; }
  try {
    const buf = Buffer.allocUnsafe(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function clampLimit(limit) {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return RECENT_LIMIT_DEFAULT;
  if (limit < RECENT_LIMIT_MIN) return RECENT_LIMIT_MIN;
  if (limit > RECENT_LIMIT_MAX) return RECENT_LIMIT_MAX;
  return Math.floor(limit);
}

export async function listRecentSessions({
  projectsDir,
  limit = RECENT_LIMIT_DEFAULT,
  existsSync = defaultExistsSync,
} = {}) {
  // projectsDir は実 fs を直接見る (existsSync injection は cwd 検証のみで使う)
  if (!projectsDir || !defaultExistsSync(projectsDir)) return [];

  const candidates = [];
  let projectDirs;
  try { projectDirs = readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return []; }

  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(projectsDir, entry.name);
    let files;
    try { files = readdirSync(projectDir, { withFileTypes: true }); }
    catch { continue; }
    for (const f of files) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const filepath = join(projectDir, f.name);
      let mtime;
      try { mtime = statSync(filepath).mtimeMs; }
      catch { continue; }
      candidates.push({ filepath, mtime });
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);

  // 上位 N+α を読み出して cwd フィルタ後に top N に絞る (filter で減りすぎる場合に備えて余裕確保)
  const clamped = clampLimit(limit);
  const overshoot = Math.min(candidates.length, clamped * 3);
  const out = [];
  for (let i = 0; i < overshoot && out.length < clamped; i++) {
    const c = candidates[i];
    const head = readJsonlHead(c.filepath);
    const cwd = extractCwdFromHead(head);
    if (!cwd || !existsSync(cwd)) continue;
    out.push({
      sessionId: c.filepath.split('/').pop().replace(/\.jsonl$/, ''),
      projectPath: cwd,
      projectName: basename(cwd),
      mtime: Math.floor(c.mtime),
      firstUserMessage: parseFirstUserMessage(head),
    });
  }
  return out;
}
