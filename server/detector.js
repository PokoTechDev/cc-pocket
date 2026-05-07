// Approval prompt detector — spec/05-approval-detection.md
// data/patterns.json の regex を使って capture-pane snapshot から承認待ちを検出する。

const PROMPT_CONTEXT_MAX = 500;
// CSI (\x1b[...x) と OSC (\x1b]...BEL) を除去
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;
// 行を " ❯ N. label" or "   N. label" にマッチさせる (^❯ なくてもよい)
const OPTION_LINE_RE = /^\s*(❯\s+)?(\d+)\.\s+(.+?)\s*$/;

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
}

/**
 * 末尾から逆順に走査して連続する numbered option 行を集め、
 * 昇順にソートして返す。空行や非マッチに当たったら停止 (前段の文章を取り込まない)。
 */
export function extractOptions(text) {
  const lines = text.split('\n');
  const found = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(OPTION_LINE_RE);
    if (m) {
      found.push({
        keystroke: m[2],
        label: m[3].trim(),
        isDefault: !!m[1],
      });
      continue;
    }
    if (found.length > 0) break;
  }
  return found.sort((a, b) => Number.parseInt(a.keystroke, 10) - Number.parseInt(b.keystroke, 10));
}

export function createDetector({ patterns, now = () => Date.now() } = { patterns: [] }) {
  const compiled = (patterns || []).map((p) => ({
    raw: p,
    regex: new RegExp(p.regex, p.flags ?? ''),
  }));

  function detect(text) {
    if (!text) return null;
    for (const { raw, regex } of compiled) {
      const window = raw.windowSize > 0 && text.length > raw.windowSize
        ? text.slice(text.length - raw.windowSize)
        : text;
      const stripped = stripAnsi(window);
      if (!regex.test(stripped)) continue;
      const promptStart = Math.max(0, stripped.length - PROMPT_CONTEXT_MAX);
      const dynamic = extractOptions(stripped);
      const options = dynamic.length === (raw.options?.length ?? 0)
        ? dynamic
        : (raw.options ?? []).map((o) => ({ ...o }));
      return {
        patternId: raw.id,
        detectedAt: now(),
        prompt: stripped.slice(promptStart),
        options,
      };
    }
    return null;
  }

  return { detect };
}
