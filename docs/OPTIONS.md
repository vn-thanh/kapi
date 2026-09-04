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
  toolbar?: Array<'mic'|'cam'|'share'|'react'|'participants'|'background'|'settings'|'hangup'>
  theme?: {
    bg?: string
    fg?: string
    accent?: string
    danger?: string
    tileBg?: string
    toolbarBg?: string
  }
  labels?: Record<string, string>  // see DEFAULT_LABELS
  videoFit?: 'contain' | 'cover'  // default 'contain' — full frame, true aspect
                                  // ratio. 'cover' fills the tile and crops
                                  // overflow. Screen shares always use
                                  // 'contain' so shared content stays readable.
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
| `track` | `{ peerId, track, streams }` | Remote media arrived; merge tracks into one stream per peer (browser `streams` identity is unreliable across renegotiation). To hide video, don't rely on remote track `mute` alone — browsers fire it late or never when a sender stops sending (e.g. screen share stopped, `replaceTrack(null)`, disabled camera, w3c/webrtc-pc#3077) and the `<video>` would freeze on the last decoded frame. Treat "no presented frame for ~2s" (via `video.requestVideoFrameCallback`) as video-off; the built-in UI does this |
| `peer-state` | `{ peerId, state }` | RTCPeerConnection state — drive connection badges |
| `local-stream` | `{ stream }` | Local preview source; re-emitted on screen share, background, device switch |
| `reaction` | `{ peerId, emoji }` | Emoji reaction — fired for remote arrivals AND for the local one sent via `room.sendReaction(emoji)`; the built-in UI floats it up the screen Jitsi-style |
| `media-state` | `{ peerId, sharing }` | Screen share started/stopped — fired locally by `shareScreen` and for remote peers via the `media-state` signal message. The built-in UI promotes the sharer's tile to a full-width stage with uncropped (`contain`) video |
| `error` | `{ error }` | Recoverable errors (ICE exhausted, maxPeers, …) |
| `hangup` | — | Room closed |
