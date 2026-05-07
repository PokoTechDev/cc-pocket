// Drawer (left sidebar) UI — spec/06 §6.3.2

const $ = (sel) => document.querySelector(sel);

export function createDrawerController({ getWindows, getCurrentId, onSelect, onOpen }) {
  function open() {
    $('#drawer').hidden = false;
    $('#drawer-scrim').hidden = false;
    onOpen?.();
  }

  function close() {
    $('#drawer').hidden = true;
    $('#drawer-scrim').hidden = true;
  }

  function makeItem(w) {
    const li = document.createElement('li');
    li.className = 'drawer-item';
    li.dataset.windowId = w.id;
    if (w.id === getCurrentId()) li.classList.add('active');
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
      onSelect(w.id);
      close();
    });
    return li;
  }

  function renderAll() {
    const list = $('#drawer-list');
    list.innerHTML = '';
    for (const w of getWindows()) list.appendChild(makeItem(w));
  }

  function renderItem(windowId) {
    const list = $('#drawer-list');
    const old = list.querySelector(`[data-window-id="${CSS.escape(windowId)}"]`);
    const w = getWindows().find((x) => x.id === windowId);
    if (!w) { old?.remove(); return; }
    const fresh = makeItem(w);
    if (old) old.replaceWith(fresh);
    else list.appendChild(fresh);
  }

  function attach() {
    $('#drawer-toggle').addEventListener('click', open);
    $('#drawer-scrim').addEventListener('click', close);
  }

  return { attach, open, close, renderAll, renderItem };
}
