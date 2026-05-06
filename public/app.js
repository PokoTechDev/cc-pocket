// CC Pocket — Phase 1 v0 client entry
// 承認バナー / awaiting_approval は Phase 3 まで未実装。

import { createApi } from '/api.js';
import { createPinController } from '/pin.js';
import { parseAnsi } from '/ansi.js';

const MAX_INPUT_BYTES = 8192;
const RECONNECT_DELAYS_MS = [1000, 3000, 7000, 15000, 30000, 60000];
const STATE_LABEL = { idle: 'Idle', streaming: 'Running', error: 'Error' };

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
    await loadInitialLog();
    connectSse();
  } catch {
    showScreen('error');
  }
}

async function loadInitialLog() {
  if (!state.currentId) return;
  const r = await api.request('GET', `/windows/${encodeURIComponent(state.currentId)}/log`);
  $('#log-area').innerHTML = '';
  if (r.status === 200) {
    for (const c of r.body.chunks) appendChunk(c.text);
  }
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
  });
  state.es.addEventListener('output', (e) => {
    const chunk = JSON.parse(e.data);
    if (chunk.windowId === state.currentId) appendChunk(chunk.text);
    const w = state.windows.get(chunk.windowId);
    if (w) {
      w.state = 'streaming';
      w.lastActivityAt = chunk.timestamp;
      renderDrawerItem(chunk.windowId);
      if (chunk.windowId === state.currentId) renderHeader();
    }
  });
  state.es.addEventListener('state', (e) => {
    const { windowId, state: s } = JSON.parse(e.data);
    const w = state.windows.get(windowId);
    if (w) {
      w.state = s;
      renderDrawerItem(windowId);
      if (windowId === state.currentId) renderHeader();
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

function renderHeader() {
  const w = state.windows.get(state.currentId);
  $('#window-name').textContent = w ? (w.name || w.id) : '—';
  const dot = $('.state-dot', $('#state-pill'));
  const label = $('.state-label', $('#state-pill'));
  const s = w?.state ?? 'idle';
  dot.dataset.state = s;
  label.textContent = STATE_LABEL[s] ?? s;
}

function renderDrawer() {
  const list = $('#drawer-list');
  list.innerHTML = '';
  for (const w of state.windows.values()) list.appendChild(makeDrawerItem(w));
}

function renderDrawerItem(windowId) {
  const list = $('#drawer-list');
  const old = list.querySelector(`[data-window-id="${CSS.escape(windowId)}"]`);
  const w = state.windows.get(windowId);
  if (!w) { old?.remove(); return; }
  const fresh = makeDrawerItem(w);
  if (old) old.replaceWith(fresh);
  else list.appendChild(fresh);
}

function makeDrawerItem(w) {
  const li = document.createElement('li');
  li.className = 'drawer-item';
  li.dataset.windowId = w.id;
  if (w.id === state.currentId) li.classList.add('active');
  li.innerHTML = `
    <div>
      <div class="drawer-item-title"></div>
      <div class="drawer-item-sub"></div>
    </div>
    <span class="state-dot" data-state="${w.state ?? 'idle'}"></span>
  `;
  li.querySelector('.drawer-item-title').textContent = w.name || w.id;
  li.querySelector('.drawer-item-sub').textContent = w.id;
  li.addEventListener('click', () => {
    state.currentId = w.id;
    closeDrawer();
    renderHeader();
    renderDrawer();
    loadInitialLog();
  });
  return li;
}

function appendChunk(text) {
  const log = $('#log-area');
  const wasAtBottom = (log.scrollHeight - log.scrollTop - log.clientHeight) < 40;
  for (const seg of parseAnsi(text)) {
    if (!seg.text) continue;
    const node = document.createElement('span');
    node.className = 'log-line';
    if (seg.style) node.style.cssText = seg.style;
    node.textContent = seg.text;
    log.appendChild(node);
  }
  if (wasAtBottom) log.scrollTop = log.scrollHeight;
}

function appendSystemLine(text) {
  const log = $('#log-area');
  const node = document.createElement('div');
  node.className = 'log-line system';
  node.textContent = `— ${text} —`;
  log.appendChild(node);
  log.scrollTop = log.scrollHeight;
}

function openDrawer() {
  $('#drawer').hidden = false;
  $('#drawer-scrim').hidden = false;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#drawer-scrim').hidden = true;
}

async function sendInputText() {
  const field = $('#input-field');
  const text = field.value;
  if (!text || !state.currentId) return;
  if (new Blob([text]).size > MAX_INPUT_BYTES) {
    appendSystemLine('入力が長すぎます (>8KB)');
    return;
  }
  const btn = $('#send-btn');
  btn.disabled = true;
  try {
    const r = await api.request('POST', `/windows/${encodeURIComponent(state.currentId)}/input`, { text });
    if (r.status === 200) {
      field.value = '';
      autoSizeInput();
    } else if (r.status === 401) {
      api.clearToken();
      showScreen('pin');
    } else {
      appendSystemLine(`送信失敗 (${r.status})`);
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
  $('#drawer-toggle').addEventListener('click', openDrawer);
  $('#drawer-scrim').addEventListener('click', closeDrawer);
  $('#logout-btn').addEventListener('click', logout);
  $('#send-btn').addEventListener('click', sendInputText);
  $('#input-field').addEventListener('input', autoSizeInput);
  $('#input-field').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInputText(); }
  });
  for (const btn of $$('.qk')) {
    btn.addEventListener('click', () => sendKey(btn.dataset.qk));
  }
  $('#error-retry').addEventListener('click', () => {
    if (api.getToken()) bootMain();
    else showScreen('pin');
  });
}

pin.attach();
attachMainListeners();
showScreen('pin');
