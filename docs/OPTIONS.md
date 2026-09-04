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
    video?: boolean | MediaTrackConstraints  // bare true/omitted defaults to
                                             // 720p-ideal (caps 1080p/4K webcams,
                                             // never blocks lower-default cams)
  }
  effects?: {
    background?: 'none' | 'blur' | 'remove' | { image: string }
    modelUrl?: string
    blurAmount?: number      // default 12
  }
  polite?: boolean           // default true
  maxBitrate?: number        // with adaptive on (default), a hard cap over the rung bitrate
  adaptive?: boolean         // default true — per-connection video quality engine:
                             // steps resolution/bitrate/fps down while the link reports
                             // bandwidth/CPU limitation (Zoom/Jitsi-style), back up when
                             // it recovers, never sends more resolution than the receiver's
                             // tile renders ('video-hint' message), keeps screen shares
                             // full-res at low fps. Set false for pre-1.x static behavior.
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
  toolbar?: Array<'mic'|'cam'|'share'|'react'|'participants'|'layout'|'background'|'settings'|'hangup'>
  layout?: 'grid' | 'spotlight' | 'sidebar'  // default 'grid' — initial tile layout.
                                             // Switch at runtime via the 'layout'
                                             // toolbar button (cycles) or
                                             // handle.setLayout(). Spotlight/sidebar
                                             // feature one tile on a stage: screen
                                             // share > pinned > active speaker > you.
                                             // Everyone else sits in a filmstrip
                                             // (bottom strip / right column).
  theme?: {
    bg?: string
    fg?: string
    accent?: string
    danger?: string
    tileBg?: string
    toolbarBg?: string
  }
  labels?: Record<string, string>  // see DEFAULT_LABELS — incl. layout / pin / unpin / more
  videoFit?: 'contain' | 'cover'  // default 'contain' — full frame, true aspect
                                  // ratio. 'cover' fills the tile and crops
                                  // overflow. Screen shares always use
                                  // 'contain' so shared content stays readable.
  onHangup?: () => void
  onReady?: (room: KapiRoom) => void
  onError?: (error: Error) => void
}
```

### Built-in layout interactions

- **View button** (toolbar `'layout'`) cycles `grid → spotlight → sidebar`.
- **Narrow toolbar**: controls that don't fit move into a ⋯ More menu
  (mic, camera and hangup stay on the bar). Override the label with
  `labels.more`.
- **Click a tile** (or focus it and press Enter/Space) to **pin** that peer —
  the pinned tile takes the spotlight/sidebar stage. Click again to unpin.
- **Active speaker**: the built-in UI listens to audio levels (WebAudio RMS)
  and rings the speaking tile; in spotlight/sidebar the stage follows the
  dominant speaker while nothing is pinned.
- **Screen share always wins the stage** in every layout.

## Room events (`room.on(event, handler)`)

| Event | Payload | Notes |
|-------|---------|-------|
| `peer-joined` | `{ peerId, displayName? }` | Presence + peer connection created |
| `peer-left` | `{ peerId }` | Link torn down / `leave` received |
| `track` | `{ peerId, track, streams }` | Remote media arrived; merge tracks into one stream per peer (browser `streams` identity is unreliable across renegotiation). To hide video, don't rely on remote track `mute` alone — browsers fire it late or never when a sender stops sending (e.g. screen share stopped, `replaceTrack(null)`, disabled camera, w3c/webrtc-pc#3077) and the `<video>` would freeze on the last decoded frame. Treat "no presented frame for ~2s" (via `video.requestVideoFrameCallback`) as video-off; the built-in UI does this |
| `peer-state` | `{ peerId, state }` | RTCPeerConnection state — drive connection badges |
| `local-stream` | `{ stream }` | Local preview source; re-emitted on screen share, background, device switch |
| `reaction` | `{ peerId, emoji }` | Emoji reaction — fired for remote arrivals AND for the local one sent via `room.sendReaction(emoji)`; the built-in UI floats it up the screen Jitsi-style |
| `media-state` | `{ peerId, sharing, mic?, cam? }` | Mic / camera / screen-share toggled — fired locally by `setMic` / `setCam` / `shareScreen` and for remote peers via the `media-state` signal message. `mic` / `cam` may be omitted by older senders (`true` = on). The built-in UI shows a mute chip on the tile (and in the participant list) and promotes the sharer's tile to a full-width stage with uncropped (`contain`) video |
| `error` | `{ error }` | Recoverable errors (ICE exhausted, maxPeers, …) |
| `hangup` | — | Room closed |
