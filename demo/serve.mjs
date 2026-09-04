#!/usr/bin/env node
/**
 * Static file server + HTTP long-poll signaling relay for the kapi demo.
 * Serves repo root so /dist and /demo resolve.
 *
 * Usage (from repo root, after build):
 *   node demo/serve.mjs
 *   npm run demo
 *
 * Cross-machine (ngrok):
 *   npm run demo
 *   ngrok http 5179
 * Share the https URL — same room id works across browsers/devices.
 *
 * Long-poll (not SSE) so clients can send `ngrok-skip-browser-warning`
 * and avoid the free-tier interstitial breaking EventSource.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 5179);
const host = process.env.HOST || '127.0.0.1';
const POLL_MS = 25_000;
const STALE_MS = 60_000;

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

/**
 * @typedef {{
 *   displayName?: string,
 *   joined: boolean,
 *   queue: object[],
 *   waiters: Array<(msgs: object[]) => void>,
 *   lastSeen: number,
 * }} PeerConn
 */

/** @type {Map<string, Map<string, PeerConn>>} */
const rooms = new Map();

function safeJoin(base, reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(base, cleaned);
  if (!full.startsWith(base)) return null;
  return full;
}

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Map();
    rooms.set(roomId, room);
  }
  return room;
}

/** @returns {PeerConn} */
function ensurePeer(roomId, peerId) {
  const room = getRoom(roomId);
  let peer = room.get(peerId);
  if (!peer) {
    peer = { queue: [], waiters: [], lastSeen: Date.now(), joined: false };
    room.set(peerId, peer);
  }
  peer.lastSeen = Date.now();
  return peer;
}

function deliver(peer, message) {
  if (peer.waiters.length) {
    const waiters = peer.waiters.splice(0);
    waiters.forEach((fn) => fn([message]));
    return;
  }
  peer.queue.push(message);
}

function forward(roomId, fromPeerId, message) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (message?.to) {
    const target = room.get(message.to);
    if (target) deliver(target, message);
    return;
  }

  for (const [id, peer] of room) {
    if (id === fromPeerId) continue;
    deliver(peer, message);
  }
}

function removePeer(roomId, peerId, announceLeave = true) {
  const room = rooms.get(roomId);
  if (!room) return;
  const peer = room.get(peerId);
  if (!peer) return;
  peer.waiters.splice(0).forEach((fn) => fn([]));
  room.delete(peerId);
  if (room.size === 0) rooms.delete(roomId);
  if (announceLeave) {
    forward(roomId, peerId, { type: 'leave', peerId });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(data);
}

function handleSignalPoll(req, res, url) {
  const roomId = url.searchParams.get('roomId')?.trim();
  const peerId = url.searchParams.get('peerId')?.trim();
  if (!roomId || !peerId) {
    json(res, 400, { error: 'roomId and peerId required' });
    return;
  }

  const peer = ensurePeer(roomId, peerId);

  if (peer.queue.length) {
    const msgs = peer.queue.splice(0);
    json(res, 200, { messages: msgs });
    return;
  }

  let settled = false;
  const finish = (msgs) => {
    if (settled || res.writableEnded) return;
    settled = true;
    clearTimeout(timer);
    const idx = peer.waiters.indexOf(finish);
    if (idx >= 0) peer.waiters.splice(idx, 1);
    json(res, 200, { messages: msgs });
  };

  peer.waiters.push(finish);
  const timer = setTimeout(() => finish([]), POLL_MS);

  req.on('close', () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    const idx = peer.waiters.indexOf(finish);
    if (idx >= 0) peer.waiters.splice(idx, 1);
  });
}

async function handleSignalPost(req, res) {
  try {
    const body = await readJson(req);
    const roomId = String(body.roomId || '').trim();
    const peerId = String(body.peerId || '').trim();
    const message = body.message;
    if (!roomId || !peerId || !message || typeof message !== 'object') {
      json(res, 400, { error: 'Invalid payload' });
      return;
    }

    // `hello` registers the peer before join (long-poll may not have run yet).
    if (message.type === 'hello') {
      ensurePeer(roomId, peerId);
      json(res, 200, { ok: true });
      return;
    }

    const peer = ensurePeer(roomId, peerId);

    if (message.type === 'join') {
      peer.displayName = message.displayName;
      peer.joined = true;
      const room = getRoom(roomId);
      // Joiner offers to everyone already in the room (full mesh, one offer per link).
      const peers = [...room.entries()]
        .filter(([id, p]) => id !== peerId && p.joined)
        .map(([id, p]) => ({ peerId: id, displayName: p.displayName }));
      if (peers.length) deliver(peer, { type: 'peers', peers });
      // Others only learn presence (library does not offer on `join`).
      forward(roomId, peerId, message);
    } else if (message.type === 'leave') {
      forward(roomId, peerId, message);
      removePeer(roomId, peerId, false);
    } else {
      forward(roomId, peerId, message);
    }

    json(res, 200, { ok: true });
  } catch {
    json(res, 400, { error: 'Bad JSON' });
  }
}

function serveStatic(req, res, urlPath) {
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
}

// Drop peers that stopped polling (tab closed without leave).
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    for (const [peerId, peer] of room) {
      if (now - peer.lastSeen > STALE_MS && peer.waiters.length === 0) {
        removePeer(roomId, peerId, true);
      }
    }
  }
}, 15_000).unref?.();

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/kapi-signal') {
    if (req.method === 'GET') {
      handleSignalPoll(req, res, url);
      return;
    }
    if (req.method === 'POST') {
      void handleSignalPost(req, res);
      return;
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, ngrok-skip-browser-warning',
      }).end();
      return;
    }
    res.writeHead(405).end('Method not allowed');
    return;
  }

  let urlPath = url.pathname || '/';
  if (urlPath === '/' || urlPath === '') urlPath = '/demo/index.html';
  if (urlPath === '/demo' || urlPath === '/demo/') urlPath = '/demo/index.html';
  serveStatic(req, res, urlPath);
});

server.listen(port, host, () => {
  const distOk = fs.existsSync(path.join(root, 'dist', 'index.js'));
  console.log(`kapi demo → http://localhost:${port}`);
  console.log(`Signaling: HTTP long-poll at /kapi-signal (ngrok-friendly).`);
  console.log(`Same room id → P2P call. For ngrok: ngrok http ${port}`);
  if (!distOk) {
    console.warn('Warning: dist/ missing — run `npm run build` first.');
  }
});
