#!/usr/bin/env node
/**
 * Tiny static server for the kapi demo.
 * Serves repo root so /dist and /demo resolve.
 *
 * Usage (from repo root, after build):
 *   node demo/serve.mjs
 *   npm run demo
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 5179);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(base, cleaned);
  if (!full.startsWith(base)) return null;
  return full;
}

const server = http.createServer((req, res) => {
  let urlPath = req.url || '/';
  if (urlPath === '/' || urlPath === '') urlPath = '/demo/index.html';
  if (urlPath === '/demo' || urlPath === '/demo/') urlPath = '/demo/index.html';

  const filePath = safeJoin(root, urlPath);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500).end(err.code === 'ENOENT' ? 'Not found' : 'Error');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(port, () => {
  const distOk = fs.existsSync(path.join(root, 'dist', 'index.js'));
  console.log(`kapi demo → http://localhost:${port}`);
  console.log(`Open a second tab with the same room id to test P2P.`);
  if (!distOk) {
    console.warn('Warning: dist/ missing — run `npm run build` first.');
  }
});
