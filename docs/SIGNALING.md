# Signaling integration

Generic guide for wiring `@vn-thanh/kapi` into any host app. Cursor agents: prefer `.cursor/skills/integrate-kapi/SKILL.md`.

## Contract

Host implements `SignalAdapter` and relays `SignalMessage` between peers in a room. kapi never opens its own websocket.

```ts
type SignalMessage =
  | { type: 'join'; peerId: string; displayName?: string }
  | { type: 'leave'; peerId: string }
  | { type: 'offer' | 'answer'; sdp: string; to: string; from?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; to: string; from?: string }
  | { type: 'peers'; peers: { peerId: string; displayName?: string }[] }

interface SignalAdapter {
  send(msg: SignalMessage): void
  onMessage(fn: (msg: SignalMessage) => void): () => void
}
```

## Server relay rules

1. Auth + room membership check
2. Direct messages when `to` is set (`offer` / `answer` / `ice`)
3. Broadcast `join` / `leave` to other members
4. Optional `peers` snapshot for late joiners

## Client

Use `@vn-thanh/kapi` headless (`KapiRoom`) or `@vn-thanh/kapi/ui` (`mount`). Pass `iceServers` including TURN for production NAT.

Built-in helpers for demos only: `createBroadcastSignalAdapter`, `createLocalSignalBus`.
