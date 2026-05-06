// CC Pocket — PIN 入力 + ロックアウト UI

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

export function createPinController({ api, onAuthSuccess, showScreen }) {
  let buffer = '';
  let lockedUntil = null;
  let countdownTimer = null;

  function refreshDots() {
    const dots = $$('.pin-dot');
    dots.forEach((dot, i) => dot.classList.toggle('filled', i < buffer.length));
  }

  function setMessage(text, isError = false) {
    const el = $('#pin-message');
    el.textContent = text || '';
    el.classList.toggle('error', isError);
  }

  function shake() {
    const display = $('#pin-display');
    display.classList.add('shake', 'error');
    setTimeout(() => display.classList.remove('shake', 'error'), 400);
  }

  async function submit() {
    if (buffer.length !== 4) return;
    const pin = buffer;
    buffer = '';
    refreshDots();
    setMessage('認証中…');
    let res;
    try {
      res = await api.request('POST', '/auth/pin', { pin }, { includeToken: false });
    } catch {
      showScreen('error');
      return;
    }
    if (res.status === 200) {
      api.setToken(res.body.token);
      setMessage('');
      onAuthSuccess(res.body);
      return;
    }
    if (res.status === 429) {
      lockedUntil = res.body.unlockAt;
      showLockout();
      return;
    }
    if (res.status === 401) {
      shake();
      const remaining = res.body?.remainingAttempts;
      setMessage(remaining != null ? `PINが違います（残り ${remaining} 回）` : 'PINが違います', true);
      return;
    }
    if (res.status === 503) {
      setMessage('PIN未設定。サーバ側で npm run set-pin を実行してください', true);
      return;
    }
    setMessage(`予期しないエラー (${res.status})`, true);
  }

  function appendDigit(d) {
    if (buffer.length >= 4) return;
    buffer += d;
    refreshDots();
    if (buffer.length === 4) submit();
  }

  function backspace() {
    buffer = buffer.slice(0, -1);
    refreshDots();
  }

  function clear() {
    buffer = '';
    refreshDots();
    setMessage('');
  }

  function showLockout() {
    showScreen('locked');
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      const remaining = lockedUntil - Date.now();
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        lockedUntil = null;
        showScreen('pin');
        return;
      }
      const total = Math.ceil(remaining / 1000);
      const m = String(Math.floor(total / 60)).padStart(2, '0');
      const s = String(total % 60).padStart(2, '0');
      $('#locked-remaining').textContent = `${m}:${s}`;
    }, 500);
  }

  function attach() {
    for (const k of $$('[data-pin-key]')) {
      k.addEventListener('click', () => appendDigit(k.dataset.pinKey));
    }
    $('#pin-back').addEventListener('click', backspace);
    $('#pin-clear').addEventListener('click', clear);
  }

  return { attach, clear };
}
