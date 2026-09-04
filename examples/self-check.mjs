/**
 * Headless signaling self-check (no getUserMedia).
 * Run after build: node examples/self-check.mjs
 */
import { createLocalSignalBus } from '../dist/index.js';

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
