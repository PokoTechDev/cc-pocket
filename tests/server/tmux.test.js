import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createTmuxDriver, TMUX_SESSION_DEFAULT } from '../../server/tmux.js';

const execFileP = promisify(execFile);

function createMockExec(handler) {
  const calls = [];
  const exec = (cmd, args, options, callback) => {
    calls.push({ cmd, args, options });
    const result = handler(cmd, args);
    process.nextTick(() => callback(result.err ?? null, result.stdout ?? '', result.stderr ?? ''));
  };
  return { exec, calls };
}

describe('createTmuxDriver — defaults', () => {
  test('uses cc-pocket as default session name', () => {
    const tmux = createTmuxDriver();
    assert.equal(tmux.session, TMUX_SESSION_DEFAULT);
    assert.equal(TMUX_SESSION_DEFAULT, 'cc-pocket');
  });

  test('accepts custom session name', () => {
    const tmux = createTmuxDriver({ session: 'custom' });
    assert.equal(tmux.session, 'custom');
  });
});

describe('createTmuxDriver — sessionExists (mocked)', () => {
  test('returns true when has-session succeeds', async () => {
    const { exec, calls } = createMockExec(() => ({}));
    const tmux = createTmuxDriver({ exec });
    assert.equal(await tmux.sessionExists(), true);
    assert.deepEqual(calls[0].args, ['has-session', '-t', 'cc-pocket']);
  });

  test('returns false when has-session fails', async () => {
    const { exec } = createMockExec(() => ({
      err: Object.assign(new Error('no session'), { code: 1 }),
      stderr: "can't find session",
    }));
    const tmux = createTmuxDriver({ exec });
    assert.equal(await tmux.sessionExists(), false);
  });
});

describe('createTmuxDriver — ensureSession (mocked)', () => {
  test('creates session when missing', async () => {
    let hasSessionCalls = 0;
    const { exec, calls } = createMockExec((_, args) => {
      if (args[0] === 'has-session') {
        hasSessionCalls += 1;
        return { err: Object.assign(new Error('no session'), { code: 1 }) };
      }
      return {};
    });
    const tmux = createTmuxDriver({ exec });
    const created = await tmux.ensureSession();
    assert.equal(created, true);
    assert.equal(hasSessionCalls, 1);
    const newSession = calls.find((c) => c.args[0] === 'new-session');
    assert.ok(newSession);
    assert.deepEqual(newSession.args, ['new-session', '-d', '-s', 'cc-pocket']);
  });

  test('does not create when session exists', async () => {
    const { exec, calls } = createMockExec(() => ({}));
    const tmux = createTmuxDriver({ exec });
    const created = await tmux.ensureSession();
    assert.equal(created, false);
    assert.equal(calls.find((c) => c.args[0] === 'new-session'), undefined);
  });
});

describe('createTmuxDriver — listWindows (mocked)', () => {
  test('parses tab-separated output into id/name pairs', async () => {
    const { exec, calls } = createMockExec(() => ({
      stdout: '@0\tmain\n@1\tlogs\n@2\tfeature-x\n',
    }));
    const tmux = createTmuxDriver({ exec });
    const windows = await tmux.listWindows();
    assert.deepEqual(windows, [
      { id: '@0', name: 'main' },
      { id: '@1', name: 'logs' },
      { id: '@2', name: 'feature-x' },
    ]);
    assert.deepEqual(calls[0].args, [
      'list-windows', '-t', 'cc-pocket',
      '-F', '#{window_id}\t#{window_name}',
    ]);
  });

  test('returns empty array when no windows', async () => {
    const { exec } = createMockExec(() => ({ stdout: '' }));
    const tmux = createTmuxDriver({ exec });
    assert.deepEqual(await tmux.listWindows(), []);
  });

  test('handles names with no tab character gracefully', async () => {
    const { exec } = createMockExec(() => ({ stdout: '@0\t\n' }));
    const tmux = createTmuxDriver({ exec });
    const windows = await tmux.listWindows();
    assert.deepEqual(windows, [{ id: '@0', name: '' }]);
  });
});

describe('createTmuxDriver — sendText (mocked)', () => {
  test('uses -l literal flag with provided text', async () => {
    const { exec, calls } = createMockExec(() => ({}));
    const tmux = createTmuxDriver({ exec });
    await tmux.sendText('@0', 'hello world');
    assert.deepEqual(calls[0].args, [
      'send-keys', '-t', 'cc-pocket:@0', '-l', 'hello world',
    ]);
  });

  test('rejects when tmux fails', async () => {
    const { exec } = createMockExec(() => ({
      err: Object.assign(new Error('boom'), { code: 1 }),
      stderr: 'no target',
    }));
    const tmux = createTmuxDriver({ exec });
    await assert.rejects(() => tmux.sendText('@99', 'x'), /tmux send-keys/);
  });
});

describe('createTmuxDriver — sendKey (mocked)', () => {
  test('passes named key without -l', async () => {
    const { exec, calls } = createMockExec(() => ({}));
    const tmux = createTmuxDriver({ exec });
    await tmux.sendKey('@0', 'Enter');
    assert.deepEqual(calls[0].args, [
      'send-keys', '-t', 'cc-pocket:@0', 'Enter',
    ]);
  });

  test('handles control sequences like C-c', async () => {
    const { exec, calls } = createMockExec(() => ({}));
    const tmux = createTmuxDriver({ exec });
    await tmux.sendKey('@0', 'C-c');
    assert.deepEqual(calls[0].args, [
      'send-keys', '-t', 'cc-pocket:@0', 'C-c',
    ]);
  });
});

describe('createTmuxDriver — capturePane (mocked)', () => {
  test('default captures last 2000 lines via -S -2000', async () => {
    const { exec, calls } = createMockExec(() => ({ stdout: 'line1\nline2\n' }));
    const tmux = createTmuxDriver({ exec });
    const out = await tmux.capturePane('@0');
    assert.equal(out, 'line1\nline2\n');
    assert.deepEqual(calls[0].args, [
      'capture-pane', '-p', '-t', 'cc-pocket:@0', '-S', '-2000',
    ]);
  });

  test('honors custom lines', async () => {
    const { exec, calls } = createMockExec(() => ({ stdout: '' }));
    const tmux = createTmuxDriver({ exec });
    await tmux.capturePane('@0', { lines: 100 });
    assert.deepEqual(calls[0].args, [
      'capture-pane', '-p', '-t', 'cc-pocket:@0', '-S', '-100',
    ]);
  });
});

describe('createTmuxDriver — integration with real tmux', () => {
  const testSession = `cc-pocket-it-${process.pid}-${Date.now()}`;
  let tmux;

  before(async () => {
    tmux = createTmuxDriver({ session: testSession });
    try {
      await execFileP('tmux', ['kill-session', '-t', testSession]);
    } catch {}
  });

  after(async () => {
    try {
      await execFileP('tmux', ['kill-session', '-t', testSession]);
    } catch {}
  });

  test('sessionExists is false initially', async () => {
    assert.equal(await tmux.sessionExists(), false);
  });

  test('ensureSession creates the session', async () => {
    const created = await tmux.ensureSession();
    assert.equal(created, true);
    assert.equal(await tmux.sessionExists(), true);
  });

  test('ensureSession is idempotent', async () => {
    const created = await tmux.ensureSession();
    assert.equal(created, false);
  });

  test('listWindows returns the freshly created window', async () => {
    const windows = await tmux.listWindows();
    assert.equal(windows.length, 1);
    assert.match(windows[0].id, /^@\d+$/);
  });

  test('sendText + sendKey reach the pane and capturePane reads it back', async () => {
    const [w] = await tmux.listWindows();
    await tmux.sendText(w.id, 'echo CC_POCKET_TEST_OK');
    await tmux.sendKey(w.id, 'Enter');
    await new Promise((r) => setTimeout(r, 500));
    const out = await tmux.capturePane(w.id);
    assert.match(out, /CC_POCKET_TEST_OK/);
  });
});
