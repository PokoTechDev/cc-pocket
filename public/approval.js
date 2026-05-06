// Approval banner UI — spec/06 §6.3.4 の承認バナー実装

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

export function createApprovalController({ api, getCurrentWindow, onUnauthorized, appendSystemLine }) {
  function render() {
    const banner = $('#approval-banner');
    const w = getCurrentWindow();
    const approval = w?.approval;
    if (!approval) {
      banner.hidden = true;
      return;
    }
    $('#approval-prompt').textContent = approval.prompt ?? '';
    const actions = $('#approval-actions');
    actions.innerHTML = '';
    for (const opt of approval.options) {
      const btn = document.createElement('button');
      btn.className = 'approval-btn';
      if (opt.isDefault) btn.classList.add('default');
      if (/拒否|reject|no/i.test(opt.label)) btn.classList.add('deny');
      btn.textContent = opt.label;
      btn.addEventListener('click', () => act(approval.detectedAt, opt.keystroke));
      actions.appendChild(btn);
    }
    banner.hidden = false;
  }

  async function act(approvalId, keystroke) {
    const w = getCurrentWindow();
    if (!w) return;
    const buttons = $$('.approval-btn');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const r = await api.request(
        'POST',
        `/windows/${encodeURIComponent(w.id)}/approve`,
        { approvalId, keystroke },
      );
      if (r.status === 200) {
        w.state = 'streaming';
        w.approval = null;
        render();
      } else if (r.status === 410) {
        appendSystemLine('承認リクエストが古くなりました');
        w.approval = null;
        render();
      } else if (r.status === 401) {
        onUnauthorized();
      } else {
        appendSystemLine(`承認送信失敗 (${r.status})`);
        buttons.forEach((b) => { b.disabled = false; });
      }
    } catch {
      appendSystemLine('承認送信失敗 (ネットワーク)');
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  return { render };
}
