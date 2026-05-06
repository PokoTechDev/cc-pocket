import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRouter } from '../../server/routes.js';
import { createAuth, hashPin } from '../../server/auth.js';
import { createStateStore } from '../../server/state.js';
import { createSseBroadcaster } from '../../server/sse.js';

function makeMockTmux() {
  const calls = [];
  return {
    session: 'cc-pocket',
    sessionExists: async () => true,
    ensureSession: async () => false,
    listWindows: async () => [{ id: '@0', name: 'main' }],
    sendText: async (id, text) => { calls.push({ kind: 'sendText', id, text }); },
    sendKey: async (id, key) => { calls.push({ kind: 'sendKey', id, key }); },
    capturePane: async () => '',
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
