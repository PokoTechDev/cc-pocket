export const SSE_KEEPALIVE_INTERVAL_MS = 30_000;

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function formatSseFrame({ event, id, data }) {
  let out = '';
  if (event) out += `event: ${event}\n`;
  if (id != null) out += `id: ${id}\n`;
  out += `data: ${JSON.stringify(data ?? null)}\n\n`;
  return out;
}

export function createSseBroadcaster({
  keepaliveInterval = SSE_KEEPALIVE_INTERVAL_MS,
  now = () => Date.now(),
} = {}) {
  const clients = new Set();

  function attach(res, { lastEventId = null } = {}) {
    res.writeHead(200, SSE_HEADERS);
    const client = { res, lastEventId };
    clients.add(client);
    res.on('close', () => clients.delete(client));
    return client;
  }

  function send(client, frame) {
    try {
      client.res.write(formatSseFrame(frame));
      return true;
    } catch {
      clients.delete(client);
      return false;
    }
  }

  function broadcast(frame) {
    const text = formatSseFrame(frame);
    let delivered = 0;
    for (const client of [...clients]) {
      try {
        client.res.write(text);
        delivered += 1;
      } catch {
        clients.delete(client);
      }
    }
    return delivered;
  }

  function startKeepalive() {
    const timer = setInterval(() => {
      broadcast({ event: 'ping', data: { timestamp: now() } });
    }, keepaliveInterval);
    if (timer.unref) timer.unref();
    return () => clearInterval(timer);
  }

  function clientCount() {
    return clients.size;
  }

  function shutdown() {
    for (const client of [...clients]) {
      try { client.res.end(); } catch { /* noop */ }
    }
    clients.clear();
  }

  return {
    attach,
    send,
    broadcast,
    startKeepalive,
    clientCount,
    shutdown,
  };
}
