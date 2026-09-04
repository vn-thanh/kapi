/**
 * Headless signaling self-check (no getUserMedia).
 * Run after build: node examples/self-check.mjs
 */
import { createLocalSignalBus, createBroadcastSignalAdapter } from '../dist/index.js';

const bus = createLocalSignalBus();
const a = bus.createAdapter('a');
const b = bus.createAdapter('b');

let got = false;
const off = b.onMessage((msg) => {
  if (msg.type === 'join' && msg.peerId === 'a') got = true;
});

a.send({ type: 'join', peerId: 'a', displayName: 'A' });
off();

if (!got) {
  console.error('FAIL: join not delivered');
  process.exit(1);
}
console.log('ok: local signal bus');

// BroadcastChannel adapter: a tab whose room hung up (or never joined) must
// not answer a join with `peers` — joiners would offer into the void and keep
// a ghost tile eating a maxPeers slot.
{
  const chan = `kapi-selfcheck-${process.pid}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const ghost = createBroadcastSignalAdapter(chan, 'ghost'); // never joins
  void ghost;
  const alive = createBroadcastSignalAdapter(chan, 'alive');
  alive.send({ type: 'join', peerId: 'alive' });

  const joiner = createBroadcastSignalAdapter(chan, 'joiner');
  const replies = [];
  joiner.onMessage((m) => replies.push(m));
  joiner.send({ type: 'join', peerId: 'joiner' });
  await sleep(100);

  const names = (m) => m.type === 'peers' && m.peers.map((p) => p.peerId);
  if (replies.some((m) => names(m) && names(m).includes('ghost'))) {
    console.error('FAIL: hung-up/never-joined tab introduced itself to joiner');
    process.exit(1);
  }
  if (!replies.some((m) => names(m) && names(m).includes('alive'))) {
    console.error('FAIL: joined tab did not introduce itself to joiner');
    process.exit(1);
  }
  console.log('ok: broadcast adapter ghost guard');
  // BroadcastChannel keeps Node's event loop alive — exit explicitly.
  process.exit(0);
}
