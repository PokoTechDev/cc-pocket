// Workspaces — spec/03 §3.5
// data/workspaces.json から手動定義のプロジェクトランチャーを読み込む。
// 書き込みは行わない (ユーザが手動で JSON を編集する前提)。

import { existsSync, readFileSync } from 'node:fs';

export const DEFAULT_COMMAND = 'claude --resume';

export function expandPath(p, homeDir) {
  if (typeof p !== 'string') return p;
  if (p === '~') return homeDir;
  if (p.startsWith('~/')) return homeDir + p.slice(1);
  return p;
}

function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.name !== 'string' || entry.name.length === 0) return false;
  if (typeof entry.path !== 'string' || entry.path.length === 0) return false;
  return true;
}

function isAbsoluteOrTilde(path) {
  return path.startsWith('/') || path === '~' || path.startsWith('~/');
}

export function loadWorkspaces({ filepath, homeDir }) {
  if (!existsSync(filepath)) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filepath, 'utf8'));
  } catch {
    return [];
  }
  const list = parsed?.workspaces;
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!isValidEntry(entry)) continue;
    if (!isAbsoluteOrTilde(entry.path)) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push({
      name: entry.name,
      path: expandPath(entry.path, homeDir),
      command: typeof entry.command === 'string' && entry.command.length > 0
        ? entry.command
        : DEFAULT_COMMAND,
    });
  }
  return out;
}
