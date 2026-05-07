// Drawer (left sidebar) UI — spec/06 §6.3.2

const $ = (sel) => document.querySelector(sel);
const SWIPE_CLOSE_THRESHOLD_PX = 60;
const SWIPE_DIRECTION_RATIO = 1.5;
const PIN_STORAGE_KEY = 'cc-pocket-pinned-windows';
const LONG_PRESS_MS = 500;

function getPinnedIds() {
  try {
    const raw = localStorage.getItem(PIN_STORAGE_KEY);
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch { return []; }
}

function setPinnedIds(ids) {
  try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(ids)); } catch { /* quota */ }
}

function togglePin(id) {
  const ids = getPinnedIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  setPinnedIds(next);
  return next;
}

function sortWithPinned(windows) {
  const pinned = getPinnedIds();
  const isPinned = (w) => pinned.includes(w.id);
  return [
    ...windows.filter(isPinned).sort((a, b) => pinned.indexOf(a.id) - pinned.indexOf(b.id)),
    ...windows.filter((w) => !isPinned(w)),
  ];
}

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
    const pinned = getPinnedIds().includes(w.id);
    const li = document.createElement('li');
    li.className = 'drawer-item';
    li.dataset.windowId = w.id;
    if (w.id === getCurrentId()) li.classList.add('active');
    if (pinned) li.classList.add('pinned');
    li.innerHTML = `
      <div>
        <div class="drawer-item-title"></div>
        <div class="drawer-item-sub"></div>
      </div>
      <span class="pin-icon" aria-hidden="true">📌</span>
      <span class="state-dot" data-state="${w.state ?? 'idle'}"></span>
    `;
    li.querySelector('.drawer-item-title').textContent = w.name || w.id;
    li.querySelector('.drawer-item-sub').textContent = w.id;

    let longPressTimer = null;
    let longPressed = false;
    const cancelPress = () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    };
    li.addEventListener('touchstart', () => {
      longPressed = false;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressed = true;
        togglePin(w.id);
        renderAll();
      }, LONG_PRESS_MS);
    }, { passive: true });
    li.addEventListener('touchend', () => {
      cancelPress();
      if (!longPressed) {
        onSelect(w.id);
        close();
      }
    });
    li.addEventListener('touchmove', cancelPress);
    li.addEventListener('touchcancel', cancelPress);
    // Desktop fallback (no touchstart fires): plain click
    li.addEventListener('click', (e) => {
      if (e.detail === 0) return; // suppress synthesized clicks
      // touch path consumes via touchend; this only fires on real mouse
      if ('ontouchstart' in window) return;
      onSelect(w.id);
      close();
    });
    return li;
  }

  function renderAll() {
    const list = $('#drawer-list');
    list.innerHTML = '';
    for (const w of sortWithPinned(getWindows())) list.appendChild(makeItem(w));
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
