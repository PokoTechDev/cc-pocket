import { URL } from 'node:url';
import { verifyPin } from './auth.js';

const MAX_INPUT_BYTES = 8192;
const MAX_BODY_BYTES = 16_384;
const KEY_WHITELIST = /^([a-zA-Z0-9]|Enter|Escape|Tab|Up|Down|Left|Right|Backspace|Space|C-[a-zA-Z]|M-[a-zA-Z])$/;
const WINDOW_PATH_RE = /^\/windows\/([^/]+)\/(log|input|keys)$/;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const parts = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('payload_too_large'));
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function getToken(req, url) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return url.searchParams.get('token');
}

export function createRouter({
  pinStore,
  auth,
  state,
  tmux,
  sse,
  serverVersion = '0.0.0',
  startedAt = Date.now(),
}) {
  async function handleAuthPin(req, res) {
    const lock = auth.isLocked();
    if (lock.locked) {
      return sendJson(res, 429, { error: 'locked', unlockAt: lock.unlockAt });
    }
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: 'bad_request' }); }
    const pin = body?.pin;
    if (typeof pin !== 'string') {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    let stored;
    try { stored = pinStore.read(); }
    catch { stored = null; }
    if (!stored) {
      return sendJson(res, 503, { error: 'pin_not_set' });
    }
    if (!verifyPin(pin, stored)) {
      const failure = auth.recordFailure();
      if (failure.lockedUntil) {
        return sendJson(res, 429, { error: 'locked', unlockAt: failure.lockedUntil });
      }
      return sendJson(res, 401, { error: 'invalid_pin', remainingAttempts: failure.remainingAttempts });
    }
    auth.clearFailures();
    return sendJson(res, 200, auth.issueToken());
  }

  function handleLogout(req, res, url) {
    const token = getToken(req, url);
    if (token) auth.invalidateToken(token);
    return sendJson(res, 200, { ok: true });
  }

  function handleSession(res) {
    return sendJson(res, 200, {
      serverVersion,
      tmuxSession: tmux.session,
      startedAt,
      windows: state.listWindows(),
    });
  }

  function handleLog(res, url, windowId) {
    const sinceParam = url.searchParams.get('since');
    const since = sinceParam == null ? null : Number.parseInt(sinceParam, 10);
    const chunks = state.getChunksSince(windowId, Number.isFinite(since) ? since : null);
    if (chunks === null) return sendJson(res, 404, { error: 'window_not_found' });
    return sendJson(res, 200, { windowId, chunks, truncated: false });
  }

  async function handleInput(req, res, windowId) {
    if (!state.getWindow(windowId)) {
      return sendJson(res, 404, { error: 'window_not_found' });
    }
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: 'bad_request' }); }
    const text = body?.text;
    if (typeof text !== 'string') {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
      return sendJson(res, 400, { error: 'bad_request', reason: 'text_too_large' });
    }
    try {
      await tmux.sendText(windowId, text);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 503, { error: 'tmux_unavailable', message: err.message });
    }
  }

  async function handleKeys(req, res, windowId) {
    if (!state.getWindow(windowId)) {
      return sendJson(res, 404, { error: 'window_not_found' });
    }
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: 'bad_request' }); }
    const keys = body?.keys;
    if (typeof keys !== 'string' || !KEY_WHITELIST.test(keys)) {
      return sendJson(res, 400, { error: 'bad_request', reason: 'invalid_keys' });
    }
    try {
      await tmux.sendKey(windowId, keys);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 503, { error: 'tmux_unavailable', message: err.message });
    }
  }

  function handleEvents(req, res) {
    const lastEventId = req.headers['last-event-id'] ?? null;
    const client = sse.attach(res, { lastEventId });
    sse.send(client, {
      event: 'snapshot',
      data: {
        serverVersion,
        tmuxSession: tmux.session,
        startedAt,
        windows: state.listWindows(),
      },
    });
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const method = req.method;
    const path = url.pathname;

    if (method === 'POST' && path === '/auth/pin') {
      return handleAuthPin(req, res);
    }

    const token = getToken(req, url);
    const authed = token && auth.validateToken(token);

    if (method === 'POST' && path === '/auth/logout') {
      if (!authed) return sendJson(res, 401, { error: 'unauthorized' });
      return handleLogout(req, res, url);
    }

    if (!authed) {
      return sendJson(res, 401, { error: 'unauthorized' });
    }

    if (method === 'GET' && path === '/session') return handleSession(res);
    if (method === 'GET' && path === '/events') return handleEvents(req, res);

    const m = path.match(WINDOW_PATH_RE);
    if (m) {
      const windowId = decodeURIComponent(m[1]);
      const action = m[2];
      if (method === 'GET' && action === 'log') return handleLog(res, url, windowId);
      if (method === 'POST' && action === 'input') return handleInput(req, res, windowId);
      if (method === 'POST' && action === 'keys') return handleKeys(req, res, windowId);
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  return { handler };
}
