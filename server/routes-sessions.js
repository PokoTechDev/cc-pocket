// Sessions endpoints — split out of routes.js to keep file under 300 lines.
// Provides /sessions/recent and /sessions/open handlers.

const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function isPathUnderHome(p, homeDir) {
  if (typeof p !== 'string' || p.length === 0) return false;
  if (!p.startsWith('/')) return false;
  if (p.split('/').includes('..')) return false;
  const home = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  return p === home || p.startsWith(home + '/');
}

export function createSessionsHandlers({
  sessions = { list: async () => null },
  tmux,
  syncWindows = async () => {},
  homeDir = '/',
  readJsonBody,
}) {
  async function handleSessionsRecent(res, url) {
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam == null ? undefined : Number.parseInt(limitParam, 10);
    const list = await sessions.list(Number.isFinite(limit) ? limit : undefined);
    if (list === null) return sendJson(res, 503, { error: 'claude_history_not_found' });
    return sendJson(res, 200, { sessions: list });
  }

  async function handleSessionOpen(req, res) {
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: 'bad_request' }); }
    const { projectPath, sessionId } = body ?? {};
    if (typeof projectPath !== 'string' || typeof sessionId !== 'string') {
      return sendJson(res, 400, { error: 'bad_request' });
    }
    if (!UUID_RE.test(sessionId)) {
      return sendJson(res, 400, { error: 'bad_request', reason: 'invalid_session_id' });
    }
    if (!isPathUnderHome(projectPath, homeDir)) {
      return sendJson(res, 400, { error: 'bad_request', reason: 'invalid_path' });
    }
    try {
      const windowId = await tmux.newWindow(projectPath);
      await syncWindows();
      await tmux.sendText(windowId, `claude --resume ${sessionId}`);
      await tmux.sendKey(windowId, 'Enter');
      return sendJson(res, 200, { ok: true, windowId });
    } catch (err) {
      return sendJson(res, 503, { error: 'tmux_unavailable', message: err.message });
    }
  }

  return { handleSessionsRecent, handleSessionOpen };
}
