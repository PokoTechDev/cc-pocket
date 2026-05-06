import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticHandler } from '../../server/static.js';

async function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-pocket-static-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>X</title>');
  writeFileSync(join(dir, 'app.js'), 'console.log(1)');
  writeFileSync(join(dir, 'style.css'), 'body{}');
  writeFileSync(join(dir, 'manifest.webmanifest'), '{"name":"X"}');
  writeFileSync(join(dir, 'icon.svg'), '<svg/>');
  try { return await fn(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

async function withServer(serve, fn) {
  const server = createServer((req, res) => {
    if (!serve(req, res)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); }
  finally { await new Promise((r) => server.close(r)); }
}

describe('createStaticHandler', () => {
  test('serves index.html for /', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /text\/html/);
        const body = await res.text();
        assert.match(body, /<title>X<\/title>/);
      });
    });
  });

  test('serves app.js with javascript content-type', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/app.js`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /javascript/);
      });
    });
  });

  test('serves manifest.webmanifest', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/manifest.webmanifest`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type'), /manifest\+json/);
      });
    });
  });

  test('returns false for unknown path (caller handles 404)', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/something-else`);
        assert.equal(res.status, 404);
      });
    });
  });

  test('returns false for non-GET methods', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/`, { method: 'POST' });
        assert.equal(res.status, 404);
      });
    });
  });

  test('does not serve files outside the allowlist', async () => {
    await withFixture(async (dir) => {
      writeFileSync(join(dir, 'secret.txt'), 'hidden');
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/secret.txt`);
        assert.equal(res.status, 404);
      });
    });
  });

  test('rejects path traversal attempts', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/../etc/passwd`);
        assert.equal(res.status, 404);
      });
    });
  });

  test('sends CSP header on HTML response', async () => {
    await withFixture(async (dir) => {
      const handler = createStaticHandler(dir);
      await withServer(handler, async (base) => {
        const res = await fetch(`${base}/`);
        const csp = res.headers.get('content-security-policy');
        assert.ok(csp);
        assert.match(csp, /default-src 'self'/);
      });
    });
  });
});
