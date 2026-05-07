// Drawer (left sidebar) UI — spec/06 §6.3.2

const $ = (sel) => document.querySelector(sel);
const SWIPE_CLOSE_THRESHOLD_PX = 60;
const SWIPE_DIRECTION_RATIO = 1.5;

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

  let touchStart = null;
  function attachSwipeClose() {
    const drawer = $('#drawer');
    drawer.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    drawer.addEventListener('touchend', (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = Math.abs(t.clientY - touchStart.y);
      // 左方向への明確なスワイプのみ反応 (縦スクロール優先)
      if (dx < -SWIPE_CLOSE_THRESHOLD_PX && Math.abs(dx) > dy * SWIPE_DIRECTION_RATIO) {
        close();
      }
      touchStart = null;
    }, { passive: true });
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
    attachSwipeClose();
  }

  return { attach, open, close, renderAll, renderItem };
}
