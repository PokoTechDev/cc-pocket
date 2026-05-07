// Screen renderer with code-block copy buttons.
// Claude Code TUI が box-drawing chars (╭╮╰╯│ または ┌┐└┘│) で囲むエリアを検出して
// "コピー" ボタン付きのブロックとしてレンダリング、それ以外は ANSI スタイル保持で描画。

import { parseAnsi } from './ansi.js';

const TOP_RE = /[╭┌]─+/;
const BOTTOM_RE = /[╰└]─+/;
const SIDE_CHARS = /[│|]/;
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(s) { return s.replace(ANSI_RE, ''); }

function isTopBorder(line) { return TOP_RE.test(stripAnsi(line)); }
function isBottomBorder(line) { return BOTTOM_RE.test(stripAnsi(line)); }
function isSideLine(line) {
  const plain = stripAnsi(line).trim();
  return plain.startsWith('│') || plain.startsWith('|');
}

function extractContent(sideLines) {
  return sideLines.map((line) => {
    const plain = stripAnsi(line);
    return plain
      .replace(/^\s*[│|]\s?/, '')
      .replace(/\s?[│|]\s*$/, '')
      .trimEnd();
  }).join('\n');
}

export function splitIntoSections(text) {
  const lines = text.split('\n');
  const sections = [];
  let plain = [];
  let block = null;

  for (const line of lines) {
    if (block) {
      if (isBottomBorder(line)) {
        sections.push({ type: 'block', lines: block.lines, content: extractContent(block.sides) });
        block = null;
      } else if (isSideLine(line)) {
        block.lines.push(line);
        block.sides.push(line);
      } else {
        // 想定外の行が来たらブロックを諦めて全部 plain に戻す
        plain.push(...block.lines, line);
        block = null;
      }
    } else if (isTopBorder(line)) {
      if (plain.length) { sections.push({ type: 'plain', lines: plain }); plain = []; }
      block = { lines: [line], sides: [] };
    } else {
      plain.push(line);
    }
  }
  if (block) plain.push(...block.lines);
  if (plain.length) sections.push({ type: 'plain', lines: plain });
  return sections;
}

function appendPlainLines(parent, lines) {
  // 改行を保持しつつ各行を ANSI parse (line 単位で SGR は完結している前提)
  const text = lines.join('\n');
  for (const seg of parseAnsi(text)) {
    if (!seg.text) continue;
    const span = document.createElement('span');
    span.className = 'log-line';
    if (seg.style) span.style.cssText = seg.style;
    span.textContent = seg.text;
    parent.appendChild(span);
  }
}

function makeCopyBlock(section) {
  const wrap = document.createElement('div');
  wrap.className = 'code-block';
  const btn = document.createElement('button');
  btn.className = 'code-block-copy';
  btn.type = 'button';
  btn.textContent = 'コピー';
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(section.content);
      btn.textContent = 'コピー済';
      setTimeout(() => { btn.textContent = 'コピー'; }, 1500);
    } catch {
      btn.textContent = '失敗';
      setTimeout(() => { btn.textContent = 'コピー'; }, 1500);
    }
  });
  const pre = document.createElement('pre');
  pre.className = 'code-block-body';
  appendPlainLines(pre, section.lines);
  wrap.appendChild(btn);
  wrap.appendChild(pre);
  return wrap;
}

export function renderScreen(logEl, text) {
  logEl.innerHTML = '';
  for (const sec of splitIntoSections(text)) {
    if (sec.type === 'block') {
      logEl.appendChild(makeCopyBlock(sec));
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'log-section';
      appendPlainLines(wrap, sec.lines);
      logEl.appendChild(wrap);
    }
  }
  logEl.scrollTop = logEl.scrollHeight;
}
