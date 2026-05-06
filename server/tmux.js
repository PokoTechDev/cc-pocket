import { execFile } from 'node:child_process';

export const TMUX_SESSION_DEFAULT = 'cc-pocket';

const TMUX_BIN = 'tmux';
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

function runTmux(exec, args) {
  return new Promise((resolve, reject) => {
    exec(TMUX_BIN, args, { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES }, (err, stdout, stderr) => {
      if (err) {
        const message = `tmux ${args.join(' ')} failed: ${(stderr || '').trim() || err.message}`;
        const wrapped = new Error(message);
        wrapped.code = err.code;
        wrapped.stderr = stderr;
        return reject(wrapped);
      }
      resolve(stdout);
    });
  });
}

export function createTmuxDriver({ session = TMUX_SESSION_DEFAULT, exec = execFile } = {}) {
  const target = (windowId) => `${session}:${windowId}`;

  async function sessionExists() {
    try {
      await runTmux(exec, ['has-session', '-t', session]);
      return true;
    } catch {
      return false;
    }
  }

  async function ensureSession() {
    if (await sessionExists()) return false;
    await runTmux(exec, ['new-session', '-d', '-s', session]);
    return true;
  }

  async function listWindows() {
    const stdout = await runTmux(exec, [
      'list-windows', '-t', session,
      '-F', '#{window_id}\t#{window_name}',
    ]);
    return stdout
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => {
        const tab = line.indexOf('\t');
        if (tab === -1) return { id: line, name: '' };
        return { id: line.slice(0, tab), name: line.slice(tab + 1) };
      });
  }

  async function sendText(windowId, text) {
    await runTmux(exec, ['send-keys', '-t', target(windowId), '-l', text]);
  }

  async function sendKey(windowId, keyName) {
    await runTmux(exec, ['send-keys', '-t', target(windowId), keyName]);
  }

  async function capturePane(windowId, { lines = 2000, ansi = false } = {}) {
    const args = ['capture-pane', '-p', '-t', target(windowId)];
    if (ansi) args.push('-e');
    args.push('-S', `-${lines}`);
    return runTmux(exec, args);
  }

  async function captureScreen(windowId) {
    return runTmux(exec, [
      'capture-pane', '-p', '-e', '-J', '-t', target(windowId),
    ]);
  }

  async function pipePane(windowId, shellCommand) {
    await runTmux(exec, ['pipe-pane', '-O', '-t', target(windowId), shellCommand]);
  }

  return {
    session,
    sessionExists,
    ensureSession,
    listWindows,
    sendText,
    sendKey,
    capturePane,
    captureScreen,
    pipePane,
  };
}
