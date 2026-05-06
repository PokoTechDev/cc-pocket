// Approval prompt detector — spec/05-approval-detection.md
// data/patterns.json の regex を使って capture-pane snapshot から承認待ちを検出する。

const PROMPT_CONTEXT_MAX = 500;
// CSI (\x1b[...x) と OSC (\x1b]...BEL) を除去
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '');
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
      return {
        patternId: raw.id,
        detectedAt: now(),
        prompt: stripped.slice(promptStart),
        options: raw.options.map((o) => ({ ...o })),
      };
    }
    return null;
  }

  return { detect };
}
