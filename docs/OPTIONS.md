# Options reference

All options for `KapiRoom.join` and `mount` (UI extends room options).

## Room

```ts
{
  roomId: string
  peerId: string
  displayName?: string
  signal: SignalAdapter
  iceServers?: RTCIceServer[]
  maxPeers?: number          // default 6
  media?: {
    audio?: boolean | MediaTrackConstraints
    video?: boolean | MediaTrackConstraints
  }
  effects?: {
    background?: 'none' | 'blur' | 'remove' | { image: string }
    modelUrl?: string
    blurAmount?: number      // default 12
  }
  polite?: boolean           // default true
  maxBitrate?: number
  videoCodec?: string        // e.g. 'video/VP8'
  autoJoin?: boolean         // default true
  leaveOnUnload?: boolean    // default true — send `leave` on pagehide/beforeunload
                             // (F5, tab close) so peers drop you instantly instead
                             // of after ICE timeouts. Adapter send must be
                             // unload-safe (keepalive fetch / BroadcastChannel / WS).
}
```

## UI (`mount`)

```ts
{
  ...roomOptions
  toolbar?: Array<'mic'|'cam'|'share'|'participants'|'background'|'settings'|'hangup'>
  theme?: {
    bg?: string
    fg?: string
    accent?: string
    danger?: string
    tileBg?: string
    toolbarBg?: string
  }
  labels?: Record<string, string>  // see DEFAULT_LABELS
  onHangup?: () => void
  onReady?: (room: KapiRoom) => void
  onError?: (error: Error) => void
}
```

## Room events (`room.on(event, handler)`)

| Event | Payload | Notes |
|-------|---------|-------|
| `peer-joined` | `{ peerId, displayName? }` | Presence + peer connection created |
| `peer-left` | `{ peerId }` | Link torn down / `leave` received |
| `track` | `{ peerId, track, streams }` | Remote media arrived; merge tracks into one stream per peer (browser `streams` identity is unreliable across renegotiation) |
| `peer-state` | `{ peerId, state }` | RTCPeerConnection state — drive connection badges |
| `local-stream` | `{ stream }` | Local preview source; re-emitted on screen share, background, device switch |
| `error` | `{ error }` | Recoverable errors (ICE exhausted, maxPeers, …) |
| `hangup` | — | Room closed |
