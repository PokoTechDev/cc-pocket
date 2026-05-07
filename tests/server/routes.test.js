import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRouter } from '../../server/routes.js';
import { createAuth, hashPin } from '../../server/auth.js';
import { createStateStore } from '../../server/state.js';
import { createSseBroadcaster } from '../../server/sse.js';

function makeMockTmux() {
  const calls = [];
  let nextWindowId = 100;
  return {
    session: 'cc-pocket',
    sessionExists: async () => true,
    ensureSession: async () => false,
    listWindows: async () => [{ id: '@0', name: 'main' }],
    sendText: async (id, text) => { calls.push({ kind: 'sendText', id, text }); },
    sendKey: async (id, key) => { calls.push({ kind: 'sendKey', id, key }); },
    capturePane: async () => '',
    newWindow: async (cwd, opts = {}) => {
      const id = `@${nextWindowId++}`;
      calls.push({ kind: 'newWindow', cwd, opts, id });
      return id;
    },
    _calls: calls,
  };
}

function makeMockPinStore(stored) {
  return {
    read: () => stored,
    exists: () => stored !== null,
  };
}

async function withServer(setupFn, testFn) {
  const deps = setupFn();
  const { handler } = createRouter(deps);
  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'internal', message: err.message }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    return await testFn(`http://127.0.0.1:${port}`, deps);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function defaultDeps(stored = null) {
  return {
    pinStore: makeMockPinStore(stored),
    auth: createAuth(),
    state: createStateStore(),
    tmux: makeMockTmux(),
    sse: createSseBroadcaster(),
    workspaces: { list: () => [] },
    sessions: { list: async () => null },
    homeDir: '/Users/test',
    syncWindows: async () => {},
    serverVersion: '0.0.0-test',
    startedAt: 1_700_000_000_000,
  };
}

async function authenticate(base, pin) {
  const res = await fetch(`${base}/auth/pin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  assert.equal(res.status, 200);
  return (await res.json()).token;
}

describe('routes — POST /auth/pin', () => {
  test('issues token on correct PIN', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/auth/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.token, 'string');
      assert.ok(body.expiresAt > Date.now());
    });
  });

  test('returns 401 invalid_pin with remainingAttempts on wrong PIN', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/auth/pin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '9999' }),
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.error, 'invalid_pin');
      assert.equal(body.remainingAttempts, 4);
    });
  });

  test('returns 429 locked after 5 failures', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      for (let i = 0; i < 4; i++) {
        await fetch(`${base}/auth/pin`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pin: '9999' }),
        });
      }
      const fifth = await fetch(`${base}/auth/pin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '9999' }),
      });
      assert.equal(fifth.status, 429);
      const body = await fifth.json();
      assert.equal(body.error, 'locked');
      assert.ok(body.unlockAt > Date.now());
    });
  });

  test('returns 503 when PIN is not configured', async () => {
    await withServer(() => defaultDeps(null), async (base) => {
      const res = await fetch(`${base}/auth/pin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: '1234' }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'pin_not_set');
    });
  });

  test('returns 400 on malformed body', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/auth/pin`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: 'not json',
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('routes — auth gating', () => {
  test('returns 401 without token on /session', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/session`);
      assert.equal(res.status, 401);
    });
  });

  test('accepts Bearer token', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
    });
  });

  test('accepts token via query param (for SSE EventSource)', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/session?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
    });
  });
});

describe('routes — POST /auth/logout', () => {
  test('invalidates the active token', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const logout = await fetch(`${base}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(logout.status, 200);
      const after = await fetch(`${base}/session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(after.status, 401);
    });
  });
});

describe('routes — GET /session', () => {
  test('returns serverVersion, tmuxSession, startedAt, windows', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }, { id: '@1', name: 'logs' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/session`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      assert.equal(body.serverVersion, '0.0.0-test');
      assert.equal(body.tmuxSession, 'cc-pocket');
      assert.equal(body.startedAt, 1_700_000_000_000);
      assert.equal(body.windows.length, 2);
    });
  });
});

describe('routes — GET /windows/:id/log', () => {
  test('returns chunks since seq', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      deps.state.appendOutput('@0', 'first');
      deps.state.appendOutput('@0', 'second');
      deps.state.appendOutput('@0', 'third');
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/log?since=1`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      assert.equal(body.windowId, '@0');
      assert.equal(body.chunks.length, 2);
      assert.equal(body.chunks[0].text, 'second');
    });
  });

  test('returns 404 for unknown window', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@99')}/log`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 404);
    });
  });
});

describe('routes — POST /windows/:id/input', () => {
  test('forwards text to tmux.sendText for a known window', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/input`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'hello\n' }),
      });
      assert.equal(res.status, 200);
      const sent = deps.tmux._calls.find((c) => c.kind === 'sendText');
      assert.deepEqual(sent, { kind: 'sendText', id: '@0', text: 'hello\n' });
    });
  });

  test('rejects text > 8KB', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/input`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(8193) }),
      });
      assert.equal(res.status, 400);
    });
  });

  test('returns 404 for unknown window', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@99')}/input`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x' }),
      });
      assert.equal(res.status, 404);
    });
  });
});

describe('routes — POST /windows/:id/keys', () => {
  test('forwards whitelisted key to tmux.sendKey', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ keys: 'C-c' }),
      });
      assert.equal(res.status, 200);
      const sent = deps.tmux._calls.find((c) => c.kind === 'sendKey');
      assert.deepEqual(sent, { kind: 'sendKey', id: '@0', key: 'C-c' });
    });
  });

  test('accepts single alphanumeric character', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ keys: 'y' }),
      });
      assert.equal(res.status, 200);
    });
  });

  test('rejects non-whitelisted key', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/keys`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ keys: 'rm -rf /' }),
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('routes — GET /workspaces', () => {
  test('returns workspaces from list provider', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.workspaces = { list: () => [
        { name: 'foo', path: '/abs/foo', command: 'claude --resume' },
        { name: 'bar', path: '/abs/bar', command: 'claude' },
      ]};
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.workspaces.length, 2);
      assert.equal(body.workspaces[0].name, 'foo');
    });
  });

  test('returns 503 when workspaces list is empty (treat as not configured)', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'workspaces_not_configured');
    });
  });

  test('requires authentication', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/workspaces`);
      assert.equal(res.status, 401);
    });
  });
});

describe('routes — POST /workspaces/open', () => {
  function setupDeps(stored, workspaces, syncCounter) {
    const deps = defaultDeps(stored);
    deps.workspaces = { list: () => workspaces };
    deps.syncWindows = async () => { syncCounter.count += 1; };
    return deps;
  }

  test('creates new window with workspace cwd and runs command', async () => {
    const stored = hashPin('1234');
    const sync = { count: 0 };
    await withServer(() => setupDeps(stored, [
      { name: 'foo', path: '/abs/foo', command: 'claude --resume' },
    ], sync), async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'foo' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.match(body.windowId, /^@\d+$/);
      assert.equal(body.name, 'foo');

      const newWin = deps.tmux._calls.find((c) => c.kind === 'newWindow');
      assert.ok(newWin);
      assert.equal(newWin.cwd, '/abs/foo');
      assert.equal(newWin.opts.name, 'foo');

      const sendText = deps.tmux._calls.find((c) => c.kind === 'sendText' && c.id === newWin.id);
      assert.deepEqual(sendText, { kind: 'sendText', id: newWin.id, text: 'claude --resume' });

      const sendKey = deps.tmux._calls.find((c) => c.kind === 'sendKey' && c.id === newWin.id);
      assert.deepEqual(sendKey, { kind: 'sendKey', id: newWin.id, key: 'Enter' });

      assert.equal(sync.count, 1, 'syncWindows should be called once');
    });
  });

  test('returns 404 for unknown workspace name', async () => {
    const stored = hashPin('1234');
    await withServer(() => setupDeps(stored, [
      { name: 'known', path: '/abs', command: 'claude' },
    ], { count: 0 }), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'unknown' }),
      });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, 'workspace_not_found');
    });
  });

  test('returns 400 on missing name', async () => {
    const stored = hashPin('1234');
    await withServer(() => setupDeps(stored, [], { count: 0 }), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });
  });

  test('fresh=true overrides command to "claude" (skips workspace default)', async () => {
    const stored = hashPin('1234');
    const sync = { count: 0 };
    await withServer(() => setupDeps(stored, [
      { name: 'foo', path: '/abs/foo', command: 'claude --resume' },
    ], sync), async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'foo', fresh: true }),
      });
      assert.equal(res.status, 200);
      const sendText = deps.tmux._calls.find((c) => c.kind === 'sendText');
      assert.equal(sendText.text, 'claude');
    });
  });

  test('fresh=false keeps workspace command', async () => {
    const stored = hashPin('1234');
    await withServer(() => setupDeps(stored, [
      { name: 'foo', path: '/abs/foo', command: 'claude --resume' },
    ], { count: 0 }), async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'foo', fresh: false }),
      });
      assert.equal(res.status, 200);
      const sendText = deps.tmux._calls.find((c) => c.kind === 'sendText');
      assert.equal(sendText.text, 'claude --resume');
    });
  });

  test('returns 503 when tmux fails', async () => {
    const stored = hashPin('1234');
    const sync = { count: 0 };
    await withServer(() => {
      const deps = setupDeps(stored, [{ name: 'foo', path: '/abs/foo', command: 'claude' }], sync);
      deps.tmux.newWindow = async () => { throw new Error('tmux dead'); };
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/workspaces/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'foo' }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'tmux_unavailable');
    });
  });
});

describe('routes — POST /windows/:id/approve', () => {
  const APPROVAL = {
    patternId: 'p1',
    detectedAt: 1700,
    prompt: 'do you want to proceed?',
    options: [
      { label: '許可', keystroke: '1', isDefault: true },
      { label: '常に許可', keystroke: '2', isDefault: false },
      { label: '拒否', keystroke: '3', isDefault: false },
    ],
  };

  test('relays selected keystroke to tmux and clears approval', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      deps.state.setApproval('@0', APPROVAL);
      return deps;
    }, async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: 1700, keystroke: '1' }),
      });
      assert.equal(res.status, 200);
      const sent = deps.tmux._calls.find((c) => c.kind === 'sendKey');
      assert.deepEqual(sent, { kind: 'sendKey', id: '@0', key: '1' });
      assert.equal(deps.state.getWindow('@0').state, 'streaming');
      assert.equal(deps.state.getWindow('@0').approval, null);
    });
  });

  test('returns 410 stale_approval on detectedAt mismatch', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      deps.state.setApproval('@0', APPROVAL);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: 9999, keystroke: '1' }),
      });
      assert.equal(res.status, 410);
      const body = await res.json();
      assert.equal(body.error, 'stale_approval');
    });
  });

  test('returns 410 no_active_approval when not awaiting', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: 1700, keystroke: '1' }),
      });
      assert.equal(res.status, 410);
    });
  });

  test('returns 400 on keystroke not in approval.options', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      deps.state.setApproval('@0', APPROVAL);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/windows/${encodeURIComponent('@0')}/approve`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ approvalId: 1700, keystroke: 'q' }),
      });
      assert.equal(res.status, 400);
    });
  });
});

describe('routes — GET /events SSE', () => {
  test('emits snapshot event on connect', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.state.setWindows([{ id: '@0', name: 'main' }]);
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/events?token=${encodeURIComponent(token)}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/event-stream');
      const reader = res.body.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      assert.match(text, /event: snapshot/);
      assert.match(text, /"windows"/);
      reader.cancel();
    });
  });
});

describe('routes — GET /sessions/recent', () => {
  test('returns sessions from list provider', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.sessions = {
        list: async () => [
          { sessionId: 'aaaaaaaa-bbbb-cccc-dddd-111111111111', projectPath: '/Users/test/foo', projectName: 'foo', mtime: 1_700_000_001_000, firstUserMessage: 'hello' },
          { sessionId: 'bbbbbbbb-cccc-dddd-eeee-222222222222', projectPath: '/Users/test/bar', projectName: 'bar', mtime: 1_700_000_000_000, firstUserMessage: null },
        ],
      };
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/recent`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.sessions.length, 2);
      assert.equal(body.sessions[0].projectName, 'foo');
      assert.equal(body.sessions[1].firstUserMessage, null);
    });
  });

  test('forwards limit query to provider', async () => {
    const stored = hashPin('1234');
    let receivedLimit = null;
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.sessions = {
        list: async (limit) => { receivedLimit = limit; return []; },
      };
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/recent?limit=5`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 200);
      assert.equal(receivedLimit, 5);
    });
  });

  test('returns 503 when claude history not present (provider returns null)', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/recent`, {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'claude_history_not_found');
    });
  });

  test('requires authentication', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const res = await fetch(`${base}/sessions/recent`);
      assert.equal(res.status, 401);
    });
  });
});

describe('routes — POST /sessions/open', () => {
  const VALID_ID = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';

  test('creates new window with projectPath and runs claude --resume <id>', async () => {
    const stored = hashPin('1234');
    let syncCount = 0;
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.syncWindows = async () => { syncCount += 1; };
      return deps;
    }, async (base, deps) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/Users/test/foo/bar', sessionId: VALID_ID }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.match(body.windowId, /^@\d+$/);

      const newWin = deps.tmux._calls.find((c) => c.kind === 'newWindow');
      assert.ok(newWin);
      assert.equal(newWin.cwd, '/Users/test/foo/bar');

      const sendText = deps.tmux._calls.find((c) => c.kind === 'sendText' && c.id === newWin.id);
      assert.equal(sendText.text, `claude --resume ${VALID_ID}`);

      const sendKey = deps.tmux._calls.find((c) => c.kind === 'sendKey' && c.id === newWin.id);
      assert.equal(sendKey.key, 'Enter');

      assert.equal(syncCount, 1);
    });
  });

  test('returns 400 on missing projectPath', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: VALID_ID }),
      });
      assert.equal(res.status, 400);
    });
  });

  test('returns 400 on invalid sessionId format', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/Users/test/foo', sessionId: 'not-a-uuid' }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.reason, 'invalid_session_id');
    });
  });

  test('returns 400 on relative projectPath', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: 'foo/bar', sessionId: VALID_ID }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.reason, 'invalid_path');
    });
  });

  test('returns 400 on projectPath containing ..', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/Users/test/foo/../etc', sessionId: VALID_ID }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.reason, 'invalid_path');
    });
  });

  test('returns 400 on projectPath outside homeDir', async () => {
    const stored = hashPin('1234');
    await withServer(() => defaultDeps(stored), async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/etc/passwd', sessionId: VALID_ID }),
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.reason, 'invalid_path');
    });
  });

  test('returns 503 when tmux fails', async () => {
    const stored = hashPin('1234');
    await withServer(() => {
      const deps = defaultDeps(stored);
      deps.tmux.newWindow = async () => { throw new Error('tmux dead'); };
      return deps;
    }, async (base) => {
      const token = await authenticate(base, '1234');
      const res = await fetch(`${base}/sessions/open`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ projectPath: '/Users/test/foo', sessionId: VALID_ID }),
      });
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.error, 'tmux_unavailable');
    });
  });
});
