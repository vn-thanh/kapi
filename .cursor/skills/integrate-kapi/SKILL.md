---
name: integrate-kapi
description: >-
  Integrate @vn-thanh/kapi P2P mesh video/audio calls into a host web app
  with a signaling channel (e.g. Socket.IO). Use when the user asks to add
  kapi, wire WebRTC P2P meetings, or implement SignalAdapter signaling.
---

# Integrate @vn-thanh/kapi

Read this skill fully, then implement end-to-end in the **host** application. The library is host-agnostic; only the host owns rooms, auth, and signaling transport.

Package: `@vn-thanh/kapi`. Docs: package README + `docs/OPTIONS.md`. Local clone often at a path like `.../kapi` or `https://github.com/vn-thanh/kapi`.

## Hard rules

- Smallest host diff; do not fork kapi internals unless required.
- Do not publish npm unless asked.
- kapi needs a `SignalAdapter` + optional TURN; it is not a hosted media server.
- Keep host product flows (invite links, presence badges) outside kapi.

## Steps (do in order)

### 1. Dependency

```bash
npm install @vn-thanh/kapi
# unpublished:
# npm install /absolute/path/to/kapi
```

### 2. Signaling relay (server)

Relay JSON only — never media.

Suggested event: `kapi/signal` with `{ roomId, message }` where `message` is a kapi `SignalMessage` (`join` | `leave` | `offer` | `answer` | `ice` | `peers`).

1. Authenticate; authorize membership for `roomId`.
2. Map `peerId` → connection for the room.
3. If `message.to` is set: forward to that peer only.
4. Else: broadcast to other room members.
5. On `join`: send `{ type: 'peers', peers: [...] }` to the **joiner only**;
   broadcast `join` to others for presence. kapi: joiner offers on `peers`;
   existing peers do not offer on `join` (avoids mesh glare).

### 3. Client `SignalAdapter`

```ts
import type { SignalAdapter, SignalMessage } from '@vn-thanh/kapi'

export function createSocketSignal(roomId: string, peerId: string): SignalAdapter {
  return {
    send(message) {
      socket.emit('kapi/signal', { roomId, message: { ...message, from: peerId } })
    },
    onMessage(fn) {
      const handler = (payload: { roomId: string; message: SignalMessage }) => {
        if (payload.roomId !== roomId) return
        fn(payload.message)
      }
      socket.on('kapi/signal', handler)
      return () => socket.off('kapi/signal', handler)
    },
  }
}
```

Adapt to the host’s real socket/client API.

### 4. Mount UI or use headless

**UI:**

```ts
import { mount } from '@vn-thanh/kapi/ui'

const api = mount(containerEl, {
  roomId,
  peerId,
  displayName,
  avatarUrl, // optional image URL — shown when video is off
  signal: createSocketSignal(roomId, peerId),
  iceServers, // include TURN in production
  media: {
    startMic: false, // or pass lobby toggle
    startCam: false,
    acquire: 'on-enable', // optional: no getUserMedia until mic/cam on
  },
  connectionQuality: true, // default; false to disable
  connectionQualityUi: 'bars', // 'bars' | 'dot' | 'off'
  onHangup: () => api.dispose(),
})
```

**Headless:** `KapiRoom.join({ ... })` then bind `track` / `local-stream` /
`connection-quality` to your own UI.

### 5. ICE / TURN

Default STUN is often not enough. Pass host-configured `iceServers` (STUN + TURN) into `mount` / `KapiRoom.join`.

### 6. Verify

Two browsers, same `roomId`:

- A/V duplex, mute (others see the mute chip), camera, screen share, background, hangup
- Peer leave cleans up for others
- Strict NAT: works only with TURN

## Do not

- Bundle Socket.IO (or any transport) inside kapi
- Add a media SFU unless explicitly requested
- Expect recording, in-call chat, captions, or whiteboard from kapi
