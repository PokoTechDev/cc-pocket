// Idea Inbox — 外出中に思いついた指示文を貯めて、後で送る用。
// localStorage にのみ永続化（サーバ非経由、デバイスローカル）。

const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'cc-pocket-ideas';
const MAX_IDEAS = 50;
const MAX_LENGTH = 1000;

function readIdeas() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeIdeas(ideas) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas)); } catch { /* quota */ }
}

export function createIdeasController({ onSendToInput }) {
  function add(text) {
    const trimmed = text.trim().slice(0, MAX_LENGTH);
    if (!trimmed) return;
    const ideas = readIdeas();
    const next = [{ id: Date.now(), text: trimmed }, ...ideas].slice(0, MAX_IDEAS);
    writeIdeas(next);
    renderList();
  }

  function remove(id) {
    writeIdeas(readIdeas().filter((i) => i.id !== id));
    renderList();
  }

  function renderList() {
    const list = $('#ideas-list');
    const empty = $('#ideas-empty');
    list.innerHTML = '';
    const ideas = readIdeas();
    empty.hidden = ideas.length > 0;
    for (const idea of ideas) {
      const li = document.createElement('li');
      li.className = 'idea-item';
      li.innerHTML = `
        <div class="idea-text"></div>
        <div class="idea-actions">
          <button class="idea-send" aria-label="入力欄に送る">▶</button>
          <button class="idea-delete" aria-label="削除">✕</button>
        </div>
      `;
      li.querySelector('.idea-text').textContent = idea.text;
      li.querySelector('.idea-send').addEventListener('click', () => {
        onSendToInput(idea.text);
      });
      li.querySelector('.idea-delete').addEventListener('click', () => remove(idea.id));
      list.appendChild(li);
    }
  }

  function openModal() {
    $('#idea-modal').hidden = false;
    $('#idea-modal-scrim').hidden = false;
    const ta = $('#idea-modal-text');
    ta.value = '';
    setTimeout(() => ta.focus(), 50);
  }

  function closeModal() {
    $('#idea-modal').hidden = true;
    $('#idea-modal-scrim').hidden = true;
  }

  function submit() {
    const ta = $('#idea-modal-text');
    add(ta.value);
    closeModal();
  }

  function attach() {
    renderList();
    $('#idea-add-btn').addEventListener('click', openModal);
    $('#idea-modal-scrim').addEventListener('click', closeModal);
    $('#idea-modal-close').addEventListener('click', closeModal);
    $('#idea-modal-save').addEventListener('click', submit);
  }

  return { attach, renderList };
}
