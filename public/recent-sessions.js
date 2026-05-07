// Recent Sessions — spec/03 §3.6, spec/06 §6.3.2
// Drawer 上部に直近の claude session 一覧を出して 1 タップで resume する。

const $ = (sel) => document.querySelector(sel);

export function formatRelative(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'たった今';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}日前`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}週間前`;
  return new Date(ms).toLocaleDateString();
}

export function createRecentSessionsController({ api, onOpened, onUnauthorized }) {
  let loaded = false;

  function setStatus(text) {
    $('#recent-status').textContent = text;
  }

  function clearList() {
    $('#recent-list').innerHTML = '';
  }

  function renderSkeleton(count = 5) {
    const list = $('#recent-list');
    list.innerHTML = '';
    for (let i = 0; i < count; i++) {
      const li = document.createElement('li');
      li.className = 'recent-item';
      li.innerHTML = `
        <div class="skeleton-row short"></div>
        <div class="skeleton-row long"></div>
      `;
      list.appendChild(li);
    }
  }

  async function refresh() {
    setStatus('');
    renderSkeleton();
    let res;
    try { res = await api.request('GET', '/sessions/recent?limit=10'); }
    catch { clearList(); setStatus('読み込み失敗'); return; }
    if (res.status === 401) { onUnauthorized(); return; }
    clearList();
    if (res.status === 503) { setStatus('claude 履歴なし'); loaded = true; return; }
    if (res.status !== 200) { setStatus(`読み込み失敗 (${res.status})`); return; }
    setStatus('');
    loaded = true;
    if (res.body.sessions.length === 0) {
      setStatus('履歴なし');
      return;
    }
    for (const s of res.body.sessions) {
      $('#recent-list').appendChild(makeItem(s));
    }
  }

  function makeItem(s) {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `
      <div class="recent-meta">
        <span class="recent-time"></span>
        <span class="recent-project"></span>
      </div>
      <div class="recent-message"></div>
    `;
    li.querySelector('.recent-time').textContent = formatRelative(s.mtime);
    li.querySelector('.recent-project').textContent = s.projectName ?? '';
    li.querySelector('.recent-message').textContent = s.firstUserMessage ?? '(空)';
    li.addEventListener('click', () => select(s, li));
    return li;
  }

  async function select(s, itemEl) {
    itemEl.classList.add('selecting');
    let res;
    try {
      res = await api.request('POST', '/sessions/open', {
        projectPath: s.projectPath,
        sessionId: s.sessionId,
      });
    } catch { itemEl.classList.remove('selecting'); setStatus('起動失敗 (ネットワーク)'); return; }
    if (res.status === 200) {
      onOpened(res.body.windowId);
      return;
    }
    if (res.status === 401) { onUnauthorized(); return; }
    itemEl.classList.remove('selecting');
    setStatus(`起動失敗 (${res.status})`);
  }

  function ensureLoaded() {
    if (!loaded) refresh();
  }

  return { refresh, ensureLoaded };
}
