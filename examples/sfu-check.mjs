/**
 * Headless mesh → SFU smoke test: three KapiRoom instances over an in-process
 * relay that behaves like a production one (mesh cap, one-way `mode: 'sfu'`
 * upgrade, `peers` snapshot with SFU publications), a fake SFU adapter, and
 * minimal fake WebRTC globals. Verifies: mesh first, upgrade when the room
 * outgrows the mesh, P2P links swapped without a departure, joiner goes
 * straight to the SFU, receiver-driven layer pick, subscriptions closed when
 * a peer leaves, and `full` for an old client at the mesh cap.
 *
 * Run after build: node examples/sfu-check.mjs
 */

// ---------- fake WebRTC globals (Node has none) ----------

class FakeTrack {
  constructor(kind, { muted = false } = {}) {
    this.kind = kind;
    this.id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    this.enabled = true;
    this.muted = muted;
    this.readyState = 'live';
    this._l = {};
  }
  stop() {
    this.readyState = 'ended';
  }
  getSettings() {
    return {};
  }
  addEventListener(type, fn) {
    (this._l[type] ??= []).push(fn);
  }
  removeEventListener() {}
}

class FakeMediaStream {
  constructor(tracks = []) {
    this._tracks = [...tracks];
  }
  getTracks() {
    return [...this._tracks];
  }
  getAudioTracks() {
    return this._tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this._tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t) {
    if (!this._tracks.includes(t)) this._tracks.push(t);
  }
  removeTrack(t) {
    const i = this._tracks.indexOf(t);
    if (i >= 0) this._tracks.splice(i, 1);
  }
}

const clone = (v) => JSON.parse(JSON.stringify(v));

class FakeTransceiver {
  constructor(kind, direction, track = null, encodings) {
    this.kind = kind;
    this.direction = direction;
    this.mid = null;
    this.stopped = false;
    const params = { encodings: encodings ? clone(encodings) : [{}] };
    this.sender = {
      track,
      replaceTrack: async (t) => {
        this.sender.track = t;
      },
      getParameters: () => clone(params),
      setParameters: async (p) => {
        params.encodings = clone(p.encodings);
      },
      getStats: async () =>
        new Map([['out', { type: 'outbound-rtp', kind: 'video', qualityLimitationReason: 'none' }]]),
    };
    this.receiver = { track: null };
  }
  setCodecPreferences() {}
}

let pcSeq = 0;
const pcs = new Map();
/** SFU offers handed to subscribers: id → [{ mid, kind, muted }]. */
const sfuOffers = new Map();

class FakePeerConnection {
  constructor(config) {
    this.id = ++pcSeq;
    // SfuTransport asks for max-bundle; mesh peers don't — keeps the two apart.
    this.isSfu = config?.bundlePolicy === 'max-bundle';
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.localDescription = null;
    this.remoteDescription = null;
    this._t = [];
    this._mid = 0;
    pcs.set(this.id, this);
  }
  addTransceiver(trackOrKind, init) {
    const track = typeof trackOrKind === 'string' ? null : trackOrKind;
    const t = new FakeTransceiver(
      track ? track.kind : trackOrKind,
      init?.direction ?? 'sendrecv',
      track,
      init?.sendEncodings,
    );
    this._t.push(t);
    return t;
  }
  addTrack(track) {
    let t = this._t.find((x) => x.kind === track.kind && !x.sender.track && !x.stopped);
    if (t) {
      t.sender.track = track;
      if (t.direction === 'recvonly' || t.direction === 'inactive') t.direction = 'sendrecv';
    } else {
      t = new FakeTransceiver(track.kind, 'sendrecv', track);
      this._t.push(t);
    }
    return t.sender;
  }
  getTransceivers() {
    return this._t;
  }
  getSenders() {
    return this._t.map((t) => t.sender);
  }
  async getStats() {
    return new Map();
  }
  async createOffer() {
    for (const t of this._t) if (t.mid === null) t.mid = String(this._mid++);
    return { type: 'offer', sdp: `offer:${this.id}` };
  }
  async createAnswer() {
    return { type: 'answer', sdp: `answer:${this.id}` };
  }
  async setLocalDescription(desc) {
    if (desc.type === 'rollback') {
      this.signalingState = 'stable';
      queueMicrotask(() => this.onsignalingstatechange?.());
      return;
    }
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    if (desc.type === 'answer') queueMicrotask(() => this.onsignalingstatechange?.());
    this._maybeConnect();
  }
  async setRemoteDescription(desc) {
    if (desc.sdp.startsWith('sfu-offer:')) {
      // The SFU offers the pulled tracks: one recvonly m-line each.
      this.signalingState = 'have-remote-offer';
      this.remoteDescription = desc;
      for (const { mid, kind, muted } of sfuOffers.get(desc.sdp) ?? []) {
        const t = new FakeTransceiver(kind, 'recvonly');
        t.mid = mid;
        this._t.push(t);
        const track = new FakeTrack(kind, { muted });
        queueMicrotask(() => this.ontrack?.({ track, streams: [], transceiver: t }));
      }
      return;
    }
    if (this.signalingState === 'have-local-offer' && desc.type === 'offer') {
      this.signalingState = 'have-remote-offer';
    } else if (this.signalingState === 'stable' && desc.type === 'answer') {
      throw new Error('InvalidStateError: answer in stable');
    } else {
      this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
    this.remoteDescription = desc;
    if (desc.type === 'answer') queueMicrotask(() => this.onsignalingstatechange?.());
    this._maybeConnect();
  }
  async addIceCandidate() {}
  _maybeConnect() {
    if (this.isSfu) {
      if (this.connectionState !== 'connected' && this.remoteDescription) {
        this.connectionState = 'connected';
        queueMicrotask(() => this.onconnectionstatechange?.());
      }
      return;
    }
    if (!this.remoteDescription || !this.localDescription || this.signalingState !== 'stable') return;
    queueMicrotask(() => {
      if (this.connectionState !== 'connected') {
        this.connectionState = 'connected';
        this.onconnectionstatechange?.();
      }
      for (const other of pcs.values()) {
        if (other === this || other.isSfu || !other.remoteDescription || !other.localDescription) continue;
        this._deliverFrom(other);
        other._deliverFrom(this);
      }
    });
  }
  _deliverFrom(other) {
    this._delivered ??= new Set();
    for (const t of other._t) {
      const track = t.sender.track;
      if (track && !this._delivered.has(track)) {
        this._delivered.add(track);
        this.ontrack?.({ track, streams: [], transceiver: t });
      }
    }
  }
  close() {
    pcs.delete(this.id);
    this.connectionState = 'closed';
  }
  static getCapabilities() {
    return { codecs: [{ mimeType: 'video/VP8' }] };
  }
}

globalThis.MediaStream = FakeMediaStream;
globalThis.RTCPeerConnection = FakePeerConnection;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    mediaDevices: {
      getUserMedia: async (c) => {
        const tracks = [];
        if (c.audio) tracks.push(new FakeTrack('audio'));
        if (c.video) tracks.push(new FakeTrack('video'));
        return new FakeMediaStream(tracks);
      },
      enumerateDevices: async () => [],
      getDisplayMedia: async () => new FakeMediaStream([new FakeTrack('video')]),
    },
  },
});

// ---------- fake SFU (Cloudflare Realtime shapes) ----------

function createFakeSfu(calls) {
  let seq = 0;
  let offerSeq = 0;
  const sessions = new Map();
  return {
    async newSession() {
      const sessionId = `s${++seq}`;
      sessions.set(sessionId, { pcId: null, published: new Map() });
      calls.push(['newSession', sessionId]);
      return { sessionId };
    },
    async newTracks(sessionId, body) {
      const sess = sessions.get(sessionId);
      if (!sess) throw new Error(`unknown session ${sessionId}`);
      if (body.sessionDescription?.type === 'offer') {
        sess.pcId = Number(body.sessionDescription.sdp.split(':')[1]);
      }
      const local = body.tracks.filter((t) => t.location === 'local');
      if (local.length) {
        for (const t of local) sess.published.set(t.trackName, t.mid);
        calls.push(['publish', sessionId, local.map((t) => t.trackName)]);
        return { sessionDescription: { type: 'answer', sdp: 'sfu-answer' }, tracks: local };
      }
      const sub = pcs.get(sess.pcId);
      const offered = [];
      const tracks = body.tracks.map((t) => {
        const pub = sessions.get(t.sessionId);
        const pubPc = pcs.get(pub?.pcId);
        const sender = pubPc?._t.find((x) => x.mid === pub.published.get(t.trackName));
        if (!sender || !sub) return { ...t, errorCode: 'not_found' };
        const mid = `r${sub._mid++}`;
        offered.push({ mid, kind: sender.kind, muted: !sender.sender.track });
        return { ...t, mid };
      });
      calls.push(['pull', sessionId, body.tracks.map((t) => `${t.sessionId}/${t.trackName}`)]);
      const sdp = `sfu-offer:${++offerSeq}`;
      sfuOffers.set(sdp, offered);
      return { requiresImmediateRenegotiation: true, sessionDescription: { type: 'offer', sdp }, tracks };
    },
    async renegotiate(sessionId) {
      calls.push(['renegotiate', sessionId]);
      return {};
    },
    async updateTracks(sessionId, body) {
      calls.push(['update', sessionId, body.tracks.map((t) => t.simulcast?.preferredRid)]);
      return {};
    },
    async closeTracks(sessionId, body) {
      calls.push(['close', sessionId, body.tracks.map((t) => t.mid)]);
      return {};
    },
  };
}

// ---------- relay (what a production signaling server does) ----------

function createRelay({ meshMax }) {
  const clients = new Map();
  let mode = 'mesh';
  const deliver = (to, msg) =>
    queueMicrotask(() => clients.get(to)?.handlers.forEach((fn) => fn(clone(msg))));
  const others = (id) => [...clients].filter(([pid, c]) => pid !== id && c.joined).map(([pid]) => pid);
  return {
    adapter(peerId) {
      const c = { handlers: new Set(), joined: false, caps: undefined, sfu: undefined, name: '' };
      clients.set(peerId, c);
      return {
        send(msg) {
          if (msg.type === 'join') {
            const peers = others(peerId);
            if (peers.length === 0) mode = 'mesh';
            if (mode === 'mesh' && peers.length + 1 > meshMax) {
              const all = !!msg.caps?.sfu && peers.every((p) => clients.get(p).caps?.sfu);
              if (!all) {
                deliver(peerId, { type: 'full', reason: 'unsupported-client' });
                return;
              }
              mode = 'sfu';
              for (const p of peers) deliver(p, { type: 'mode', mode: 'sfu' });
            }
            Object.assign(c, { joined: true, caps: msg.caps, name: msg.displayName });
            deliver(peerId, {
              type: 'peers',
              mode,
              peers: peers.map((p) => ({
                peerId: p,
                displayName: clients.get(p).name,
                ...(clients.get(p).sfu ? { sfu: clients.get(p).sfu } : {}),
              })),
            });
            for (const p of peers) deliver(p, msg);
            return;
          }
          if (!c.joined) return;
          if (msg.type === 'leave') {
            c.joined = false;
            c.sfu = undefined;
            for (const p of others(peerId)) deliver(p, msg);
            return;
          }
          if (msg.type === 'path') return;
          if (msg.type === 'sfu-tracks') c.sfu = { sessionId: msg.sessionId, tracks: msg.tracks };
          for (const p of msg.to ? [msg.to] : others(peerId)) deliver(p, { ...msg, from: peerId });
        },
        onMessage(fn) {
          c.handlers.add(fn);
          return () => c.handlers.delete(fn);
        },
      };
    },
  };
}

// ---------- test body ----------

const { KapiRoom } = await import('../dist/index.js');

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, msg, timeout = 4000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fn()) return;
    await sleep(20);
  }
  console.error(`FAIL (timeout): ${msg}`);
  process.exit(1);
};

const calls = [];
const sfu = createFakeSfu(calls);

async function join(relay, peerId, withSfu = true) {
  const ev = { joined: [], left: [], tracks: [], resets: [], modes: [], full: [], errors: [] };
  const room = await KapiRoom.join({
    roomId: 'r',
    peerId,
    displayName: peerId.toUpperCase(),
    signal: relay.adapter(peerId),
    ...(withSfu ? { sfu } : {}),
    media: { startMic: true, startCam: true },
  });
  room.on('peer-joined', (e) => ev.joined.push(e.peerId));
  room.on('peer-left', (e) => ev.left.push(e.peerId));
  room.on('track', (e) => ev.tracks.push(e.peerId));
  room.on('tracks-reset', (e) => ev.resets.push(e.peerId));
  room.on('mode', (e) => ev.modes.push(e.mode));
  room.on('room-full', (e) => ev.full.push(e.reason));
  room.on('error', (e) => ev.errors.push(e.error.message));
  return { room, ev };
}
const count = (list, id) => list.filter((x) => x === id).length;

const relay = createRelay({ meshMax: 2 });
const a = await join(relay, 'a');
const b = await join(relay, 'b');
await waitFor(() => count(a.ev.tracks, 'b') >= 2 && count(b.ev.tracks, 'a') >= 2, 'A and B meet over P2P');
assert(a.room.mode === 'mesh' && b.room.mode === 'mesh', 'two peers stay on the mesh');
assert(!calls.some((c) => c[0] === 'newSession'), 'no SFU session while the mesh is enough');

// Third person outgrows the mesh (cap 2): the relay upgrades the room.
const c = await join(relay, 'c');
await waitFor(
  () => [a, b, c].every((p) => p.room.mode === 'sfu'),
  'every peer follows the relay into the SFU',
);
await waitFor(() => c.ev.joined.includes('a') && c.ev.joined.includes('b'), 'C sees A and B');
await waitFor(
  () => count(c.ev.tracks, 'a') >= 2 && count(c.ev.tracks, 'b') >= 2,
  'C receives A and B over the SFU',
);
await waitFor(
  () => count(a.ev.tracks, 'c') >= 2 && count(b.ev.tracks, 'c') >= 2,
  'A and B receive C over the SFU',
);
await waitFor(
  () => a.ev.resets.includes('b') && b.ev.resets.includes('a'),
  'A and B swap each other from P2P to SFU tracks',
);
assert(a.room.peers.size === 0 && b.room.peers.size === 0, 'P2P links are closed after the swap');
assert(a.ev.left.length === 0 && b.ev.left.length === 0, 'the swap is not a departure');
assert(calls.filter((x) => x[0] === 'newSession').length === 3, 'one SFU session per peer');
assert(
  calls.filter((x) => x[0] === 'publish').every((x) => x[2].join() === 'audio,video,share-audio'),
  'each peer publishes its three slots',
);

// Receiver-driven quality: a thumbnail asks for the quarter layer.
a.room.sendVideoHint('c', 160, 90);
await waitFor(
  () => calls.some((x) => x[0] === 'update' && x[2][0] === 'q'),
  'small tile picks the q simulcast layer',
);

// C leaves: A and B stop pulling C's tracks (egress), C closes its own.
const closesBefore = calls.filter((x) => x[0] === 'close').length;
await c.room.hangup();
await waitFor(() => a.ev.left.includes('c') && b.ev.left.includes('c'), 'A and B see C leave');
await waitFor(
  () => calls.filter((x) => x[0] === 'close').length >= closesBefore + 3,
  'subscriptions and publications are closed',
);
assert(a.room.mode === 'sfu', 'the upgrade is one-way');

// An old client (no SFU) at the mesh cap is refused, not half-connected.
const relay2 = createRelay({ meshMax: 1 });
const d = await join(relay2, 'd', false);
const e = await join(relay2, 'e');
await waitFor(() => e.ev.full.length === 1, 'joiner beyond the mesh cap gets room-full');
assert(e.ev.full[0] === 'unsupported-client', 'full carries the relay reason');
assert(d.ev.joined.length === 0, 'the refused joiner never appears');

for (const p of [a, b, d, e]) await p.room.hangup();
for (const p of [a, b, c, d, e]) {
  assert(p.ev.errors.length === 0, `no errors (got ${p.ev.errors.join('; ')})`);
}
console.log('ok: mesh → SFU upgrade, swap, joiner, layer pick, leave cleanup, room-full');
process.exit(0);
