import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/app.js': 'app.js',
  '/api.js': 'api.js',
  '/pin.js': 'pin.js',
  '/ansi.js': 'ansi.js',
  '/approval.js': 'approval.js',
  '/drawer.js': 'drawer.js',
  '/style.css': 'style.css',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/icon.svg': 'icon.svg',
  '/icon-maskable.svg': 'icon-maskable.svg',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
};

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:;";

export function createStaticHandler(publicDir) {
  return function serve(req, res) {
    if (req.method !== 'GET') return false;
    const url = new URL(req.url, 'http://localhost');
    const filename = STATIC_FILES[url.pathname];
    if (!filename) return false;
    const filepath = join(publicDir, filename);
    if (!existsSync(filepath)) return false;
    const ext = filename.slice(filename.lastIndexOf('.'));
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    };
    if (ext === '.html') headers['Content-Security-Policy'] = CSP;
    try {
      res.writeHead(200, headers);
      res.end(readFileSync(filepath));
      return true;
    } catch {
      return false;
    }
  };
}
