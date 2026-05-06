import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

import { createAuth } from './auth.js';
import { createStateStore } from './state.js';
import { createTmuxDriver } from './tmux.js';
import { createFileTailer } from './tailer.js';
import { createSseBroadcaster } from './sse.js';
import { createRouter } from './routes.js';
import { createStaticHandler } from './static.js';

export const PORT = 7000;
export const SERVER_VERSION = '0.0.0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PIN_FILE = join(__dirname, '..', 'data', 'pin.json');
const DEFAULT_PIPE_DIR = join(homedir(), '.cc-pocket', 'pipe');
const DEFAULT_PUBLIC_DIR = join(__dirname, '..', 'public');
const TICK_INTERVAL_MS = 1000;

export function createPinStore(filepath) {
  return {
    read() {
      if (!existsSync(filepath)) return null;
      try { return JSON.parse(readFileSync(filepath, 'utf8')); }
      catch { return null; }
    },
    exists() {
      return existsSync(filepath);
    },
  };
}

export function detectTailscaleIp({ exec = execFileSync } = {}) {
  try {
    const out = exec('tailscale', ['ip', '-4'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

export function buildApp({
  pinFile = DEFAULT_PIN_FILE,
  pipeDir = DEFAULT_PIPE_DIR,
  publicDir = DEFAULT_PUBLIC_DIR,
  serverVersion = SERVER_VERSION,
  startedAt = Date.now(),
  port = PORT,
  ip,
} = {}) {
  const auth = createAuth();
  const state = createStateStore();
  const tmux = createTmuxDriver();
  const sse = createSseBroadcaster();
  const pinStore = createPinStore(pinFile);
  const tailers = new Map();

  const { handler } = createRouter({
    pinStore, auth, state, tmux, sse, serverVersion, startedAt,
  });
  const serveStatic = createStaticHandler(publicDir);

  function startTailerForWindow(windowId) {
    if (tailers.has(windowId)) return;
    const tailer = createFileTailer(join(pipeDir, `${windowId}.log`), (text) => {
      const chunk = state.appendOutput(windowId, text);
      if (chunk) sse.broadcast({ event: 'output', id: chunk.seq, data: chunk });
    });
    tailer.start();
    tailers.set(windowId, tailer);
  }

  function stopTailers() {
    for (const t of tailers.values()) t.stop();
    tailers.clear();
  }

  async function syncWindows() {
    const windows = await tmux.listWindows();
    state.setWindows(windows);
    for (const id of [...tailers.keys()]) {
      if (!windows.find((w) => w.id === id)) {
        tailers.get(id).stop();
        tailers.delete(id);
      }
    }
    for (const w of windows) startTailerForWindow(w.id);
  }

  async function start() {
    if (!pinStore.exists()) {
      throw new Error('PIN not configured. Run: npm run set-pin');
    }
    const bindIp = ip ?? detectTailscaleIp();
    if (!bindIp) {
      throw new Error('Tailscale IP not detected. Run: sudo tailscale up');
    }
    await tmux.ensureSession();
    await syncWindows();
    const stopKeepalive = sse.startKeepalive();
    const httpServer = createServer((req, res) => {
      if (serveStatic(req, res)) return;
      handler(req, res).catch((err) => {
        try {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'internal', message: err.message }));
        } catch { /* socket already closed */ }
      });
    });
    await new Promise((resolve) => httpServer.listen(port, bindIp, resolve));
    const tickTimer = setInterval(() => {
      const transitions = state.tick();
      for (const t of transitions) {
        const w = state.getWindow(t.id);
        if (w) sse.broadcast({ event: 'state', data: { windowId: t.id, state: w.state } });
      }
    }, TICK_INTERVAL_MS);
    if (tickTimer.unref) tickTimer.unref();
    return {
      ip: bindIp,
      port,
      httpServer,
      stop: async () => {
        clearInterval(tickTimer);
        stopKeepalive();
        stopTailers();
        sse.shutdown();
        await new Promise((resolve) => httpServer.close(resolve));
      },
    };
  }

  return { start, auth, state, tmux, sse, pinStore };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const app = buildApp();
  app.start().then((running) => {
    console.log(`[CC Pocket] info: listening on http://${running.ip}:${running.port}`);
    const shutdown = async (signal) => {
      console.log(`[CC Pocket] info: ${signal} received, shutting down...`);
      await running.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((err) => {
    console.error(`[CC Pocket] error: ${err.message}`);
    process.exit(1);
  });
}
