// Workspaces launcher modal — spec/03 §3.5, spec/06 §6.3.2

const $ = (sel) => document.querySelector(sel);

export function createWorkspacesController({ api, onOpened, onUnauthorized }) {
  function open() {
    $('#ws-modal').hidden = false;
    $('#ws-modal-scrim').hidden = false;
    loadAndRender();
  }

  function close() {
    $('#ws-modal').hidden = true;
    $('#ws-modal-scrim').hidden = true;
  }

  function setStatus(text) {
    $('#ws-modal-status').textContent = text;
  }

  async function loadAndRender() {
    const list = $('#ws-modal-list');
    list.innerHTML = '';
    setStatus('読み込み中…');
    let res;
    try { res = await api.request('GET', '/workspaces'); }
    catch { setStatus('読み込み失敗 (ネットワーク)'); return; }
    if (res.status === 401) { onUnauthorized(); return; }
    if (res.status === 503) {
      setStatus('data/workspaces.json に定義がありません');
      return;
    }
    if (res.status !== 200) {
      setStatus(`読み込み失敗 (${res.status})`);
      return;
    }
    setStatus('');
    for (const ws of res.body.workspaces) {
      const li = document.createElement('li');
      li.className = 'ws-modal-item';
      li.innerHTML = `
        <div class="ws-name"></div>
        <div class="ws-path"></div>
      `;
      li.querySelector('.ws-name').textContent = ws.name;
      li.querySelector('.ws-path').textContent = ws.path;
      li.addEventListener('click', () => select(ws.name, li));
      list.appendChild(li);
    }
  }

  async function select(name, itemEl) {
    itemEl.classList.add('selecting');
    setStatus('起動中…');
    let res;
    try { res = await api.request('POST', '/workspaces/open', { name }); }
    catch { setStatus('起動失敗 (ネットワーク)'); itemEl.classList.remove('selecting'); return; }
    if (res.status === 200) {
      close();
      onOpened(res.body.windowId);
      return;
    }
    if (res.status === 401) { onUnauthorized(); return; }
    setStatus(`起動失敗 (${res.status})`);
    itemEl.classList.remove('selecting');
  }

  function attach() {
    $('#ws-open-btn').addEventListener('click', open);
    $('#ws-modal-scrim').addEventListener('click', close);
    $('#ws-modal-close').addEventListener('click', close);
  }

  return { attach, open, close };
}
