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
  | { type: 'media-state'; peerId: string; sharing: boolean; mic?: boolean; cam?: boolean; to?: string }

interface SignalAdapter {
  send(msg: SignalMessage): void
  onMessage(fn: (msg: SignalMessage) => void): () => void
}
```

## Server relay rules

1. Auth + room membership check
2. Direct messages when `to` is set (`offer` / `answer` / `ice` / targeted `media-state`)
3. Broadcast `join` / `leave` / `media-state` (no `to`) to other members
4. **Send `peers` snapshot to the joiner** (required for mesh). kapi makes the
   joiner offer to each listed peer; existing peers treat `join` as presence only.
   Do not also have existing peers offer on `join` — that causes glare with 3+ peers.
5. **Synthesize `leave` when a member's transport dies** (WebSocket close, poll
   timeout). kapi sends `leave` on page unload (`leaveOnUnload`, default true),
   but unload is best-effort — the server-side fallback keeps rosters free of
   ghosts when it is lost.

`media-state` is a cosmetic hint (mic/camera toggles and screen share
started/stopped) that lets remote UIs show mute chips and give the sharer's
tile stage placement. Relays that drop unknown message types don't break media
— only the indicators are lost — but forwarding it (broadcast, or targeted
when `to` is set) keeps the UI correct. `mic` / `cam` are optional (`true` =
on) so older senders that only set `sharing` still parse.

> HTTP adapters: make `send` unload-safe — `fetch(url, { keepalive: true })` or
> `navigator.sendBeacon`. A plain `fetch`/`XMLHttpRequest` queued during
> `pagehide` is routinely cancelled, which recreates the "frozen tile after F5"
> bug the unload hook exists to fix.

## Client

Use `@vn-thanh/kapi` headless (`KapiRoom`) or `@vn-thanh/kapi/ui` (`mount`). Pass `iceServers` including TURN for production NAT.

Built-in helpers for demos only: `createBroadcastSignalAdapter`, `createLocalSignalBus`.
