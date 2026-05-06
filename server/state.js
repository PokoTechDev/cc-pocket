export const IDLE_THRESHOLD_MS = 2000;
export const RING_BUFFER_MAX_CHUNKS = 2000;
export const RING_BUFFER_MAX_BYTES = 2_097_152;

export function createStateStore({ now = () => Date.now() } = {}) {
  const windows = new Map();
  const buffers = new Map();

  function ensureBuffer(id) {
    if (!buffers.has(id)) {
      buffers.set(id, { chunks: [], totalBytes: 0, nextSeq: 1 });
    }
    return buffers.get(id);
  }

  function setWindows(list) {
    const newIds = new Set(list.map((w) => w.id));
    for (const id of [...windows.keys()]) {
      if (!newIds.has(id)) {
        windows.delete(id);
        buffers.delete(id);
      }
    }
    const t = now();
    for (const { id, name } of list) {
      const existing = windows.get(id);
      if (existing) {
        if (existing.name !== name) {
          windows.set(id, { ...existing, name });
        }
      } else {
        windows.set(id, {
          id,
          name,
          state: 'idle',
          lastActivityAt: t,
          outputBytes: 0,
        });
        ensureBuffer(id);
      }
    }
  }

  function trimBuffer(buf) {
    while (buf.chunks.length > RING_BUFFER_MAX_CHUNKS) {
      const removed = buf.chunks.shift();
      buf.totalBytes -= Buffer.byteLength(removed.text, 'utf8');
    }
    while (buf.totalBytes > RING_BUFFER_MAX_BYTES && buf.chunks.length > 1) {
      const removed = buf.chunks.shift();
      buf.totalBytes -= Buffer.byteLength(removed.text, 'utf8');
    }
  }

  function appendOutput(id, text) {
    const w = windows.get(id);
    if (!w) return null;
    const t = now();
    const bytes = Buffer.byteLength(text, 'utf8');
    const buf = ensureBuffer(id);
    const chunk = {
      windowId: id,
      seq: buf.nextSeq,
      text,
      timestamp: t,
    };
    buf.chunks.push(chunk);
    buf.totalBytes += bytes;
    buf.nextSeq += 1;
    trimBuffer(buf);

    windows.set(id, {
      ...w,
      state: 'streaming',
      lastActivityAt: t,
      outputBytes: w.outputBytes + bytes,
    });

    return chunk;
  }

  function tick() {
    const t = now();
    const transitions = [];
    for (const [id, w] of windows) {
      if (w.state === 'streaming' && t - w.lastActivityAt >= IDLE_THRESHOLD_MS) {
        windows.set(id, { ...w, state: 'idle' });
        transitions.push({ id, from: 'streaming', to: 'idle' });
      }
    }
    return transitions;
  }

  function getWindow(id) {
    const w = windows.get(id);
    return w ? { ...w } : null;
  }

  function listWindows() {
    return [...windows.values()].map((w) => ({ ...w }));
  }

  function getChunksSince(id, since) {
    const buf = buffers.get(id);
    if (!buf) return null;
    if (since == null) return [...buf.chunks];
    return buf.chunks.filter((c) => c.seq > since);
  }

  return {
    setWindows,
    appendOutput,
    tick,
    getWindow,
    listWindows,
    getChunksSince,
  };
}
