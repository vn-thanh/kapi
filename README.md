# @vn-thanh/kapi

Browser **WebRTC P2P mesh** calls — no media SFU/MCU. You supply signaling (Socket.IO, BroadcastChannel, …). Optional client-side background blur/remove via MediaPipe.

## Try the demo

```bash
git clone https://github.com/vn-thanh/kapi.git
cd kapi
npm install
npm run demo
```

Open [http://localhost:5179](http://localhost:5179), join a room, then open a second tab (or share via `ngrok http 5179`) with the same room id. Details: [demo/README.md](demo/README.md).

## Install

```bash
npm install @vn-thanh/kapi
# or local path while unpublished:
# npm install /path/to/kapi
```

## Headless

```ts
import { KapiRoom, createBroadcastSignalAdapter } from '@vn-thanh/kapi'

const peerId = crypto.randomUUID()
const signal = createBroadcastSignalAdapter('demo-room', peerId)

const room = await KapiRoom.join({
  roomId: 'demo',
  peerId,
  displayName: 'Ada',
  signal,
  // iceServers: [...], // default: Google STUN; add TURN for strict NATs
  maxPeers: 6,
  effects: { background: 'none' }, // 'blur' | 'remove' | { image: url }
})

room.on('track', ({ peerId, streams }) => {
  videoEl.srcObject = streams[0]
})

room.setMic(false)
room.setCam(true)
await room.shareScreen(true)
await room.setBackground('blur')
room.sendReaction('👍') // Jitsi-style floating emoji, broadcast to everyone
await room.hangup()
```

## UI mount

```ts
import { mount } from '@vn-thanh/kapi/ui'

const api = mount(document.getElementById('meet')!, {
  roomId: 'demo',
  peerId: crypto.randomUUID(),
  displayName: 'Ada',
  signal,
  toolbar: ['mic', 'cam', 'share', 'react', 'participants', 'layout', 'background', 'settings', 'hangup'],
  layout: 'spotlight', // 'grid' (default) | 'spotlight' | 'sidebar'
  onHangup: () => api.dispose(),
})
```

## Signaling contract

Host implements `SignalAdapter`:

```ts
type SignalMessage =
  | { type: 'join'; peerId: string; displayName?: string }
  | { type: 'leave'; peerId: string }
  | { type: 'offer' | 'answer'; sdp: string; to: string; from?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; to: string; from?: string }
  | { type: 'reaction'; emoji: string; from?: string }
  | { type: 'peers'; peers: { peerId: string; displayName?: string }[] }
  | { type: 'media-state'; peerId: string; sharing: boolean; to?: string }

interface SignalAdapter {
  send(msg: SignalMessage): void
  onMessage(fn: (msg: SignalMessage) => void): () => void
}
```

Relay `offer` / `answer` / `ice` / targeted `media-state` to `to`. Broadcast `join` / `leave` / `media-state`. Optionally send `peers` snapshot on join.

Helpers: `createBroadcastSignalAdapter`, `createLocalSignalBus`.

## Options

| Option | Default | Notes |
|--------|---------|--------|
| `iceServers` | Google STUN | Add TURN for corporate NAT |
| `maxPeers` | `6` | Mesh cost is O(n²) |
| `media.audio` / `media.video` | `true` | `getUserMedia` constraints |
| `effects.background` | `'none'` | `'blur'` \| `'remove'` \| `{ image }` |
| `effects.modelUrl` | MediaPipe selfie CDN | Override model path |
| `effects.blurAmount` | `12` | CSS blur px |
| `polite` | `true` | Perfect negotiation |
| `maxBitrate` | — | Video sender max bps |
| `videoCodec` | — | e.g. `video/VP8` |
| `autoJoin` | `true` | Emit `join` on start |

UI: `toolbar`, `layout` (`'grid'` default | `'spotlight'` | `'sidebar'` — switch at runtime via the toolbar view button or `handle.setLayout()`), `theme` (CSS vars), `labels`, `videoFit` (`'contain'` default — full frame at true aspect ratio; `'cover'` crops to fill; screen shares always `'contain'`), `onHangup`, `onReady`, `onError`. Screen-share tiles are promoted to a full-width stage so shared content stays readable. Spotlight/sidebar put one tile on a stage (screen share > pinned > active speaker > you); click any tile to pin it, click again to unpin; the speaking tile gets an active-speaker ring.

## Limits

- No media server → each peer uploads to every other peer.
- Keep rooms small (`maxPeers`).
- HTTPS (or localhost) required for camera/mic.
- Background effects need WebGL/GPU; first load downloads the model.

## Scripts

```bash
npm run typecheck
npm run build
npm run check
npm run demo        # build + local demo server
npm run demo:serve  # serve only (dist must exist)
```

## Repository

Repository: https://github.com/vn-thanh/kapi

## Docs

- [OPTIONS.md](docs/OPTIONS.md) — full option reference
- [SIGNALING.md](docs/SIGNALING.md) — host signaling contract
- Cursor skill: `.cursor/skills/integrate-kapi/SKILL.md`
