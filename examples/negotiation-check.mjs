/**
 * Headless negotiation smoke test: two KapiRoom instances over the in-process
 * signal bus, driven by minimal fake WebRTC globals. Verifies join → peers →
 * offer/answer → connected → tracks both ways → hangup/leave, and that a
 * re-join with the same peerId replaces the stale link.
 *
 * Run after build: node examples/negotiation-check.mjs
 */

// ---------- fake WebRTC/DOM globals (Node has none) ----------

class FakeTrack {
  constructor(kind) {
    this.kind = kind;
    this.id = `${kind}-${Math.random().toString(36).slice(2, 8)}`;
    this.enabled = true;
    this.muted = false;
    this.readyState = 'live';
  }
  stop() {
    this.readyState = 'ended';
  }
  getSettings() {
    return {};
  }
  addEventListener() {}
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

class FakeTransceiver {
  constructor(kind, direction) {
    this.kind = kind;
    this.direction = direction;
    this.stopped = false;
    this.sender = {
      track: null,
      replaceTrack: async (t) => {
        this.sender.track = t;
      },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {},
    };
    this.receiver = { track: null };
  }
  setCodecPreferences() {}
}

/** All pcs in the process form one fully-wired mesh for simplicity. */
const allPcs = new Set();

class FakePeerConnection {
  constructor() {
    this.signalingState = 'stable';
    this.connectionState = 'new';
    this.remoteDescription = null;
    this.localDescription = null;
    this._transceivers = [];
    this._candidates = [];
    allPcs.add(this);
  }
  addTransceiver(kind, init) {
    const t = new FakeTransceiver(kind, init?.direction ?? 'sendrecv');
    this._transceivers.push(t);
    return t;
  }
  addTrack(track) {
    // Spec-ish addTrack: reuse a compatible transceiver (same kind, free
    // sender) and upgrade its direction, else create a new sendrecv one.
    let t = this._transceivers.find(
      (x) => x.kind === track.kind && !x.sender.track && !x.stopped,
    );
    if (t) {
      t.sender.track = track;
      if (t.direction === 'recvonly' || t.direction === 'inactive') t.direction = 'sendrecv';
    } else {
      t = new FakeTransceiver(track.kind, 'sendrecv');
      t.sender.track = track;
      this._transceivers.push(t);
    }
    return t.sender;
  }
  getTransceivers() {
    return this._transceivers;
  }
  getSenders() {
    return this._transceivers.map((t) => t.sender);
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: `fake-offer-${Math.random()}` });
  }
  createAnswer() {
    return Promise.resolve({ type: 'answer', sdp: `fake-answer-${Math.random()}` });
  }
  setLocalDescription(desc) {
    if (desc.type === 'rollback') {
      this.signalingState = 'stable';
      this._signal();
      return Promise.resolve();
    }
    this.localDescription = desc;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
    if (desc.type === 'answer') this._signal();
    this._maybeConnect();
    return Promise.resolve();
  }
  setRemoteDescription(desc) {
    if (this.signalingState === 'have-local-offer' && desc.type === 'offer') {
      // Fake implicit rollback, like modern browsers.
      this.signalingState = 'have-remote-offer';
    } else if (this.signalingState === 'stable' && desc.type === 'answer') {
      return Promise.reject(new Error('InvalidStateError: answer in stable'));
    } else {
      this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
    }
    this.remoteDescription = desc;
    if (desc.type === 'answer') this._signal();
    this._maybeConnect();
    return Promise.resolve();
  }
  addIceCandidate(c) {
    this._candidates.push(c);
    return Promise.resolve();
  }
  _signal() {
    queueMicrotask(() => this.onsignalingstatechange?.());
  }
  _maybeConnect() {
    if (!this.remoteDescription || !this.localDescription) return;
    if (this.signalingState !== 'stable') return;
    if (this.connectionState === 'connected') {
      // A counterpart may have become ready after us — re-run delivery.
      queueMicrotask(() => this._deliverAll());
      return;
    }
    queueMicrotask(() => {
      this.connectionState = 'connected';
      this.onconnectionstatechange?.();
      this._deliverAll();
    });
  }
  _deliverAll() {
    // Symmetric both-ways delivery with per-track dedupe: the answerer
    // reaches `stable` before the offerer has the answer, so whoever is
    // ready first must not skip tracks for the peer that connects later.
    for (const other of allPcs) {
      if (other === this) continue;
      if (!other.remoteDescription || !other.localDescription) continue;
      this._deliverFrom(other);
      other._deliverFrom(this);
    }
  }
  _deliverFrom(other) {
    this._delivered ??= new Set();
    for (const t of other._transceivers) {
      const track = t.sender.track;
      if (track && !this._delivered.has(track)) {
        this._delivered.add(track);
        this.ontrack?.({ track, streams: [] });
      }
    }
  }
  close() {
    allPcs.delete(this);
    this.connectionState = 'closed';
  }
  static getCapabilities() {
    return { codecs: [{ mimeType: 'video/VP8' }, { mimeType: 'video/H264' }] };
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

// ---------- test body ----------

const { KapiRoom, createLocalSignalBus } = await import('../dist/index.js');

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
    await sleep(25);
  }
  console.error(`FAIL (timeout): ${msg}`);
  process.exit(1);
};

const bus = createLocalSignalBus();

const eventsA = { joined: 0, left: 0, tracks: 0, states: [], errors: [] };
const eventsB = { joined: 0, left: 0, tracks: 0, states: [], errors: [] };

const roomA = await KapiRoom.join({
  roomId: 't',
  peerId: 'a-first',
  displayName: 'A',
  signal: bus.createAdapter('a-first'),
});
roomA.on('peer-joined', () => eventsA.joined++);
roomA.on('peer-left', () => eventsA.left++);
roomA.on('track', () => eventsA.tracks++);
roomA.on('peer-state', ({ state }) => eventsA.states.push(state));
roomA.on('error', ({ error }) => eventsA.errors.push(error.message));

const roomB = await KapiRoom.join({
  roomId: 't',
  peerId: 'b-second',
  displayName: 'B',
  signal: bus.createAdapter('b-second'),
});
roomB.on('peer-joined', () => eventsB.joined++);
roomB.on('peer-left', () => eventsB.left++);
roomB.on('track', () => eventsB.tracks++);
roomB.on('peer-state', ({ state }) => eventsB.states.push(state));
roomB.on('error', ({ error }) => eventsB.errors.push(error.message));

await waitFor(() => eventsA.states.includes('connected'), 'A connects to B');
await waitFor(() => eventsB.states.includes('connected'), 'B connects to A');
assert(eventsA.joined === 1, 'A saw B join');
assert(eventsB.joined === 1, 'B saw A join');
await waitFor(() => eventsA.tracks >= 2, 'A received remote tracks');
await waitFor(() => eventsB.tracks >= 2, 'B received remote tracks');
assert(eventsA.errors.length === 0, `A error-free (got ${eventsA.errors.join('; ')})`);
assert(eventsB.errors.length === 0, `B error-free (got ${eventsB.errors.join('; ')})`);

// Rejoin with B's id (simulated F5): A should drop the stale link and re-add.
const roomB2 = await KapiRoom.join({
  roomId: 't',
  peerId: 'b-second',
  displayName: 'B2',
  signal: bus.createAdapter('b-second'),
});
roomB2.on('peer-state', ({ state }) => eventsB.states.push(state));
await waitFor(() => eventsA.joined === 2, 'A sees re-join as fresh peer');
assert(eventsA.left === 1, 'A dropped stale link first');

await roomB2.hangup();
await roomB.hangup();
await waitFor(() => eventsA.left >= 2, 'A sees B leave');
await roomA.hangup();

assert(eventsA.errors.length === 0, 'A stayed error-free');
console.log('ok: negotiation, tracks, rejoin, hangup');
