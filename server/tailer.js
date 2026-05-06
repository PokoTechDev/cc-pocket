import {
  closeSync,
  openSync,
  readSync,
  statSync,
  watch,
} from 'node:fs';

export const CHUNK_MAX_LEN = 8192;
const POLL_INTERVAL_MS = 1000;

function safeStat(filepath) {
  try {
    return statSync(filepath);
  } catch {
    return null;
  }
}

export function createFileTailer(filepath, onChunk, options = {}) {
  const pollInterval = options.pollInterval ?? POLL_INTERVAL_MS;
  const initialStat = safeStat(filepath);
  let position = initialStat ? initialStat.size : 0;
  let watcher = null;
  let pollTimer = null;

  function emit(text) {
    for (let i = 0; i < text.length; i += CHUNK_MAX_LEN) {
      onChunk(text.slice(i, i + CHUNK_MAX_LEN));
    }
  }

  function sync() {
    const stat = safeStat(filepath);
    if (!stat) return;
    if (stat.size < position) {
      position = 0;
    }
    if (stat.size === position) return;
    const fd = openSync(filepath, 'r');
    try {
      const len = stat.size - position;
      const buf = Buffer.allocUnsafe(len);
      readSync(fd, buf, 0, len, position);
      position = stat.size;
      emit(buf.toString('utf8'));
    } finally {
      closeSync(fd);
    }
  }

  function start() {
    if (pollTimer || watcher) return;
    try {
      watcher = watch(filepath, { persistent: false }, () => {
        try { sync(); } catch { /* ignore transient read errors */ }
      });
    } catch {
      // file may not yet exist; polling will catch it
    }
    pollTimer = setInterval(() => {
      try { sync(); } catch { /* ignore transient read errors */ }
    }, pollInterval);
    if (pollTimer.unref) pollTimer.unref();
  }

  function stop() {
    if (watcher) {
      try { watcher.close(); } catch { /* noop */ }
      watcher = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  return { start, stop, sync };
}
