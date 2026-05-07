// Prompt presets — タップで input field に流し込む (送信は手動)。
// data/prompts.json に手書き定義したエントリを GET /prompts で取得。

const $ = (sel) => document.querySelector(sel);

export function createPromptsController({ api, onPick, onUnauthorized }) {
  function open() {
    $('#pp-modal').hidden = false;
    $('#pp-modal-scrim').hidden = false;
    loadAndRender();
  }

  function close() {
    $('#pp-modal').hidden = true;
    $('#pp-modal-scrim').hidden = true;
  }

  function setStatus(text) { $('#pp-modal-status').textContent = text; }

  async function loadAndRender() {
    const list = $('#pp-modal-list');
    list.innerHTML = '';
    setStatus('読み込み中…');
    let res;
    try { res = await api.request('GET', '/prompts'); }
    catch { setStatus('読み込み失敗'); return; }
    if (res.status === 401) { onUnauthorized(); return; }
    if (res.status !== 200) { setStatus(`読み込み失敗 (${res.status})`); return; }
    const prompts = res.body.prompts ?? [];
    if (prompts.length === 0) {
      setStatus('data/prompts.json に定義がありません');
      return;
    }
    setStatus('');
    for (const p of prompts) {
      const li = document.createElement('li');
      li.className = 'pp-item';
      li.innerHTML = `
        <div class="pp-name"></div>
        <div class="pp-text"></div>
      `;
      li.querySelector('.pp-name').textContent = p.name;
      li.querySelector('.pp-text').textContent = p.text;
      li.addEventListener('click', () => {
        onPick(p.text);
        close();
      });
      list.appendChild(li);
    }
  }

  function attach() {
    $('#pp-open-btn').addEventListener('click', open);
    $('#pp-modal-scrim').addEventListener('click', close);
    $('#pp-modal-close').addEventListener('click', close);
  }

  return { attach, open, close };
}
