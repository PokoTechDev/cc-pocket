// Prompt presets — data/prompts.json から手書きの定型プロンプトを読み込む。
// クライアントが GET /prompts で取得して、入力欄に流し込み (送信は手動)。

import { existsSync, readFileSync } from 'node:fs';

const MAX_NAME = 60;
const MAX_TEXT = 4000;
const MAX_ENTRIES = 50;

function isValidEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.name !== 'string' || entry.name.length === 0) return false;
  if (entry.name.length > MAX_NAME) return false;
  if (typeof entry.text !== 'string' || entry.text.length === 0) return false;
  if (entry.text.length > MAX_TEXT) return false;
  return true;
}

export function loadPrompts({ filepath }) {
  if (!existsSync(filepath)) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(filepath, 'utf8')); }
  catch { return []; }
  const list = parsed?.prompts;
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const out = [];
  for (const entry of list) {
    if (!isValidEntry(entry)) continue;
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    out.push({ name: entry.name, text: entry.text });
    if (out.length >= MAX_ENTRIES) break;
  }
  return out;
}
