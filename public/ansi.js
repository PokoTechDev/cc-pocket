// ANSI エスケープ解釈 — spec/02 §2.2: SGR カラー(30-37/90-97) + 太字のみ解釈、他は strip

const ESC = '\x1b';
const SGR_FG = {
  30: '#000000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#666666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
};

function isAnsiFinal(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0x40 && code <= 0x7e;
}

function applySgrParams(style, params) {
  if (params === '' || params === '0') {
    style.bold = false;
    style.fg = null;
    return;
  }
  for (const part of params.split(';')) {
    const code = Number.parseInt(part, 10);
    if (Number.isNaN(code)) continue;
    if (code === 0) { style.bold = false; style.fg = null; }
    else if (code === 1) { style.bold = true; }
    else if (code === 22) { style.bold = false; }
    else if (code === 39) { style.fg = null; }
    else if (SGR_FG[code]) { style.fg = SGR_FG[code]; }
  }
}

function styleToCss(style) {
  const parts = [];
  if (style.fg) parts.push(`color:${style.fg}`);
  if (style.bold) parts.push('font-weight:bold');
  return parts.join(';');
}

export function parseAnsi(input) {
  const segments = [];
  const style = { bold: false, fg: null };
  let buf = '';
  let i = 0;

  function flush() {
    if (buf.length > 0) {
      segments.push({ text: buf, style: styleToCss(style) });
      buf = '';
    }
  }

  while (i < input.length) {
    const c = input[i];
    if (c === ESC && input[i + 1] === '[') {
      let j = i + 2;
      while (j < input.length && !isAnsiFinal(input[j])) j++;
      if (j >= input.length) { i = input.length; break; }
      const finalByte = input[j];
      const params = input.slice(i + 2, j);
      if (finalByte === 'm') {
        flush();
        applySgrParams(style, params);
      }
      i = j + 1;
      continue;
    }
    if (c === '\r' || c === '\b' || c === '\x07') { i++; continue; }
    buf += c;
    i++;
  }
  flush();
  return segments;
}
