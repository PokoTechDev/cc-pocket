// CC Pocket — Phase 1 v0 client entry
// 承認バナー / awaiting_approval は Phase 3 まで未実装。

import { createApi } from '/api.js';
import { createPinController } from '/pin.js';
import { parseAnsi } from '/ansi.js';
import { createApprovalController } from '/approval.js';
import { createDrawerController } from '/drawer.js';

const MAX_INPUT_BYTES = 8192;
const RECONNECT_DELAYS_MS = [1000, 3000, 7000, 15000, 30000, 60000];
const STATE_LABEL = {
  idle: 'Idle',
  streaming: 'Running',
  awaiting_approval: 'Needs input',
  error: 'Error',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const api = createApi();
const state = {
  windows: new Map(),
  currentId: null,
  es: null,
  reconnectAttempts: 0,
};

function showScreen(name) {
  document.getElementById('app').dataset.screen = name;
  for (const el of $$('.screen')) el.hidden = el.dataset.screenId !== name;
}

const pin = createPinController({
  api,
  onAuthSuccess: () => bootMain(),
  showScreen,
});

async function bootMain() {
  showScreen('main');
  try {
    const r = await api.request('GET', '/session');
    if (r.status === 401) { api.clearToken(); showScreen('pin'); return; }
    if (r.status !== 200) throw new Error('session failed');
    state.windows.clear();
    for (const w of r.body.windows) state.windows.set(w.id, w);
    if (state.windows.size > 0) state.currentId = [...state.windows.keys()][0];
    renderHeader();
    renderDrawer();
    renderApproval();
    await loadInitialScreen();
    connectSse();
  } catch {
    showScreen('error');
  }
}

async function loadInitialScreen() {
  if (!state.currentId) return;
  const r = await api.request('GET', `/windows/${encodeURIComponent(state.currentId)}/screen`);
  if (r.status === 200) {
    renderScreen(r.body.text ?? '');
  } else {
    $('#log-area').innerHTML = '';
  }
}

function renderScreen(text) {
  const log = $('#log-area');
  log.innerHTML = '';
  for (const seg of parseAnsi(text)) {
    if (!seg.text) continue;
    const node = document.createElement('span');
    node.className = 'log-line';
    if (seg.style) node.style.cssText = seg.style;
    node.textContent = seg.text;
    log.appendChild(node);
  }
  log.scrollTop = log.scrollHeight;
}

function connectSse() {
  if (state.es) state.es.close();
  const url = `/events?token=${encodeURIComponent(api.getToken())}`;
  state.es = new EventSource(url);
  state.es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    state.windows.clear();
    for (const w of data.windows) state.windows.set(w.id, w);
    renderHeader();
    renderDrawer();
    renderApproval();
  });
  state.es.addEventListener('output', (e) => {
    // chunk-based output は Discovery 用ログ。画面表示は screen イベント側で置換する。
    const chunk = JSON.parse(e.data);
    const w = state.windows.get(chunk.windowId);
    if (w) {
      w.state = 'streaming';
      w.lastActivityAt = chunk.timestamp;
      renderDrawerItem(chunk.windowId);
      if (chunk.windowId === state.currentId) renderHeader();
    }
  });
  state.es.addEventListener('screen', (e) => {
    const { windowId, text } = JSON.parse(e.data);
    if (windowId === state.currentId) renderScreen(text ?? '');
  });
  state.es.addEventListener('state', (e) => {
    const { windowId, state: s, approval } = JSON.parse(e.data);
    const w = state.windows.get(windowId);
    if (w) {
      w.state = s;
      w.approval = approval ?? null;
      renderDrawerItem(windowId);
      if (windowId === state.currentId) {
        renderHeader();
        renderApproval();
      }
    }
  });
  state.es.addEventListener('ping', () => { state.reconnectAttempts = 0; });
  state.es.onerror = () => {
    state.es.close();
    state.es = null;
    const delay = RECONNECT_DELAYS_MS[Math.min(state.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    state.reconnectAttempts += 1;
    setTimeout(() => { if (api.getToken()) connectSse(); }, delay);
  };
}

const approvalCtrl = createApprovalController({
  api,
  getCurrentWindow: () => state.windows.get(state.currentId) ?? null,
  onUnauthorized: () => { api.clearToken(); showScreen('pin'); },
  appendSystemLine: (msg) => appendSystemLine(msg),
});

function renderApproval() {
  approvalCtrl.render();
  renderHeader();
}

function renderHeader() {
  const w = state.windows.get(state.currentId);
  $('#window-name').textContent = w ? (w.name || w.id) : '—';
  const dot = $('.state-dot', $('#state-pill'));
  const label = $('.state-label', $('#state-pill'));
  const s = w?.state ?? 'idle';
  dot.dataset.state = s;
  label.textContent = STATE_LABEL[s] ?? s;
}

const drawer = createDrawerController({
  getWindows: () => [...state.windows.values()],
  getCurrentId: () => state.currentId,
  onSelect: (id) => {
    state.currentId = id;
    renderHeader();
    drawer.renderAll();
    renderApproval();
    loadInitialScreen();
  },
});
const renderDrawer = () => drawer.renderAll();
const renderDrawerItem = (id) => drawer.renderItem(id);

function appendSystemLine(text) {
  const log = $('#log-area');
  const node = document.createElement('div');
  node.className = 'log-line system';
  node.textContent = `— ${text} —`;
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
}

async function sendInputText() {
  const field = $('#input-field');
  const raw = field.value;
  if (!state.currentId) return;
  // 末尾改行は除去 (literal \\n は TUI で「テキスト中の改行」になる)。
  // 代わりに Enter key event を別 POST で送ることで shell も TUI も統一動作。
  const text = raw.replace(/\n+$/, '');
  if (new Blob([text]).size > MAX_INPUT_BYTES) {
    appendSystemLine('入力が長すぎます (>8KB)');
    return;
  }
  const btn = $('#send-btn');
  btn.disabled = true;
  try {
    if (text) {
      const r1 = await api.request('POST', `/windows/${encodeURIComponent(state.currentId)}/input`, { text });
      if (r1.status === 401) { api.clearToken(); showScreen('pin'); return; }
      if (r1.status !== 200) { appendSystemLine(`送信失敗 (${r1.status})`); return; }
    }
    const r2 = await api.request('POST', `/windows/${encodeURIComponent(state.currentId)}/keys`, { keys: 'Enter' });
    if (r2.status === 200) {
      field.value = '';
      autoSizeInput();
    } else if (r2.status === 401) {
      api.clearToken();
      showScreen('pin');
    } else {
      appendSystemLine(`Enter送信失敗 (${r2.status})`);
    }
  } catch {
    appendSystemLine('送信失敗 (ネットワーク)');
  } finally {
    setTimeout(() => { btn.disabled = false; }, 500);
  }
}

async function sendKey(keys) {
  if (!state.currentId) return;
  const r = await api.request('POST', `/windows/${encodeURIComponent(state.currentId)}/keys`, { keys });
  if (r.status === 401) { api.clearToken(); showScreen('pin'); }
  else if (r.status !== 200) appendSystemLine(`キー送信失敗 (${r.status})`);
}

function autoSizeInput() {
  const field = $('#input-field');
  field.style.height = 'auto';
  field.style.height = Math.min(field.scrollHeight, 120) + 'px';
}

function logout() {
  if (state.es) { state.es.close(); state.es = null; }
  api.request('POST', '/auth/logout', {}).catch(() => {});
  api.clearToken();
  state.windows.clear();
  state.currentId = null;
  $('#log-area').innerHTML = '';
  showScreen('pin');
}

function attachMainListeners() {
  drawer.attach();
  $('#logout-btn').addEventListener('click', logout);
  $('#send-btn').addEventListener('click', sendInputText);
  $('#input-field').addEventListener('input', autoSizeInput);
  $('#input-field').addEventListener('keydown', (e) => {
    // LINE 方式: Enter は改行、送信は明示的に Cmd/Ctrl+Enter または送信ボタンのみ。
    // モバイルでの誤送信ゼロ + IME 変換確定の Enter を取り逃しても安全。
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      sendInputText();
    }
  });
  for (const btn of $$('.qk')) {
    btn.addEventListener('click', () => sendKey(btn.dataset.qk));
  }
  $('#error-retry').addEventListener('click', () => {
    if (api.getToken()) bootMain();
    else showScreen('pin');
  });
}

// iOS Safari は font-size 16px だけでは auto-zoom が完全に止まらないケースがあるため
// maximum-scale=1 を動的注入して focus 起因のズームを抑える。iOS は manual pinch-zoom を
// 引き続き許可するため accessibility への影響なし。Android では pinch-zoom が止まるので
// iOS 限定で適用する。
function applyIosViewportLock() {
  if (!/iPhone|iPad|iPod/.test(navigator.userAgent)) return;
  const meta = document.querySelector('meta[name=viewport]');
  if (!meta) return;
  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover',
  );
}

applyIosViewportLock();
pin.attach();
attachMainListeners();
showScreen('pin');
