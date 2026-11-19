# Signaling integration

Generic guide for wiring `@vn-thanh/kapi` into any host app.

Coding agents: start with [`llms.txt`](../llms.txt), then this file, then the Cursor skill [`.cursor/skills/integrate-kapi/SKILL.md`](../.cursor/skills/integrate-kapi/SKILL.md) (raw: `https://raw.githubusercontent.com/vn-thanh/kapi/main/.cursor/skills/integrate-kapi/SKILL.md`).

## Contract

Host implements `SignalAdapter` and relays `SignalMessage` between peers in a room. kapi never opens its own websocket.

```ts
type SignalMessage =
  | { type: 'join'; peerId: string; displayName?: string; avatarUrl?: string }
  | { type: 'leave'; peerId: string }
  | { type: 'offer' | 'answer'; sdp: string; to: string; from?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit; to: string; from?: string }
  | { type: 'reaction'; emoji: string; from?: string }
  | { type: 'peers'; peers: { peerId: string; displayName?: string; avatarUrl?: string }[] }
  | { type: 'peer-meta'; peerId: string; displayName?: string; avatarUrl?: string; to?: string }
  | {
      type: 'media-state'
      peerId: string
      sharing: boolean
      mic?: boolean
      cam?: boolean
      shareAudio?: boolean
      to?: string
    }
  | { type: 'video-hint'; to: string; width: number; height: number; from?: string }

interface SignalAdapter {
  send(msg: SignalMessage): void
  onMessage(fn: (msg: SignalMessage) => void): () => void
}
```

## Server relay rules

1. Auth + room membership check
2. Direct messages when `to` is set (`offer` / `answer` / `ice` / `video-hint` / targeted `media-state` / targeted `peer-meta`)
3. Broadcast `join` / `leave` / `reaction` / `media-state` / `peer-meta` (no `to`) to other members
4. **Send `peers` snapshot to the joiner** (required for mesh). kapi makes the
   joiner offer to each listed peer; existing peers treat `join` as presence only.
   Do not also have existing peers offer on `join` — that causes glare with 3+ peers.
5. **Synthesize `leave` when a member's transport dies** (WebSocket close, poll
   timeout). kapi sends `leave` on page unload (`leaveOnUnload`, default true),
   but unload is best-effort — the server-side fallback keeps rosters free of
   ghosts when it is lost.

`media-state` is a cosmetic hint (mic/camera toggles and screen share
started/stopped, plus optional `shareAudio` when the share includes tab/system
audio) that lets remote UIs show mute chips and give the sharer's
tile stage placement. Relays that drop unknown message types don't break media
— only the indicators are lost — but forwarding it (broadcast, or targeted
when `to` is set) keeps the UI correct. `mic` / `cam` / `shareAudio` are optional
(`true` = on) so older senders that only set `sharing` still parse.

`peer-meta` updates `displayName` / `avatarUrl` after join (`room.setIdentity`).
Forward it like `media-state`; dropping it only freezes the roster label/avatar.

`video-hint` is likewise cosmetic: it tells the sender how large its video
renders on the receiver's screen so it can downscale that connection
(receiver-driven quality). Always point-to-point via `to`; dropping it just
loses the optimization, and older receivers ignore it entirely.

> HTTP adapters: make `send` unload-safe — `fetch(url, { keepalive: true })` or
> `navigator.sendBeacon`. A plain `fetch`/`XMLHttpRequest` queued during
> `pagehide` is routinely cancelled, which recreates the "frozen tile after F5"
> bug the unload hook exists to fix.

## Client

Use `@vn-thanh/kapi` headless (`KapiRoom`) or `@vn-thanh/kapi/ui` (`mount`). Pass `iceServers` including TURN for production NAT.

Built-in helpers for demos only: `createBroadcastSignalAdapter`, `createLocalSignalBus`.

## SFU rooms (optional)

A mesh costs every peer one upload per other peer, so past ~5 people a room
should move to a selective forwarding unit. kapi follows the relay: pass
`sfu` (an `SfuAdapter`) and the relay decides when.

```ts
type SignalMessage =
  // …the mesh messages above, plus:
  | { type: 'join'; …; caps?: { sfu?: boolean } }          // client can do SFU
  | { type: 'peers'; peers: SignalPeer[]; mode?: 'mesh' | 'sfu' } // SignalPeer.sfu?: { sessionId, tracks }
  | { type: 'mode'; mode: 'sfu' }                          // relay → peers, one-way
  | { type: 'full'; reason?: string }                      // relay → refused joiner
  | { type: 'sfu-tracks'; peerId: string; sessionId: string; tracks: SfuTrackInfo[] }
  | { type: 'path'; relay: boolean }                       // peer → relay telemetry only
```

Relay rules on top of the mesh ones:

1. **Pick the moment.** When a `join` would push a mesh room past its cap and
   every peer (the joiner included) sent `caps.sfu`, store the room as `sfu`,
   send `{ type: 'mode', mode: 'sfu' }` to the current peers, and include
   `mode: 'sfu'` in the joiner's `peers`. Otherwise answer the joiner with
   `full` and do not admit it. Never go back to mesh while peers remain.
2. **Remember publications.** Keep each peer's latest `sfu-tracks` and put it
   in `peers[].sfu`, so a joiner pulls without waiting for a re-announce.
3. **Forward** `sfu-tracks` like `media-state`. `path` is for the relay
   (metering TURN use) — no need to forward it.

What peers do: on `mode: 'sfu'` each one publishes its three slots (`audio`,
`video` with `f`/`h`/`q` simulcast, `share-audio`) on one SFU connection and
announces them with `sfu-tracks`; everyone pulls everyone. Existing P2P links
stay up until that peer's SFU media arrives (or 5s), then close without a
`peer-left` — the UI gets `tracks-reset` and the new tracks. `video-hint`
picks a simulcast layer instead of a sender rung.

`SfuAdapter` mirrors the Cloudflare Realtime SFU HTTPS API
(`sessions/new`, `tracks/new`, `renegotiate`, `tracks/update`,
`tracks/close`), so a backend can forward bodies unchanged. **Keep the SFU
secret on your backend and authorize every call**: the session belongs to
the caller, and every `remote` track's `sessionId` belongs to the same room —
the SFU itself lets any session pull any track in the app.
