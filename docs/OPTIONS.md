# Options reference

All options for `KapiRoom.join` and `mount` (UI extends room options).

## Room

```ts
{
  roomId: string
  peerId: string
  displayName?: string
  avatarUrl?: string        // image URL for tile/roster when video is off
  signal: SignalAdapter
  iceServers?: RTCIceServer[]
  maxPeers?: number          // default 6
  media?: {
    audio?: boolean | MediaTrackConstraints
    video?: boolean | MediaTrackConstraints  // bare true/omitted defaults to
                                             // a device-tier capture ceiling
                                             // (720p / 540p / 360p via
                                             // deviceAdaptation; see below)
    startMic?: boolean       // default false — mic off until user unmutes
    startCam?: boolean       // default false — camera off until user starts it
    acquire?: 'join' | 'on-enable'
      // 'join' (default): getUserMedia on join for allowed kinds; startMic uses
      //   track.enabled. Camera off stops the track + replaceTrack(null) so the
      //   LED goes dark (re-acquires on setCam(true)).
      // 'on-enable': only acquire kinds that start on; acquire the rest when
      //   setMic(true)/setCam(true) — best privacy (no LED until cam is on).
      // Hosts with a pre-join lobby should pass lobby toggles as startMic/startCam.
  }
  effects?: {
    background?: 'none' | 'blur' | 'remove' | { image: string }
    modelUrl?: string
    blurAmount?: number      // default from device tier (8–12) when omitted
  }
  polite?: boolean           // default true
  maxBitrate?: number        // with adaptive on (default), a hard cap over the rung bitrate;
                             // weak device tiers also apply a soft default cap when omitted
  adaptive?: boolean         // default true — per-connection video quality engine:
                             // steps resolution/bitrate/fps down while the link reports
                             // bandwidth/CPU limitation (Zoom/Jitsi-style), back up when
                             // it recovers, never sends more resolution than the receiver's
                             // tile renders ('video-hint' message), keeps screen shares
                             // full-res at low fps. Set false for pre-1.x static behavior.
  deviceAdaptation?: boolean | {
    enabled?: boolean        // default true
    tier?: 'auto' | 'low' | 'medium' | 'high'
                             // auto (default): score from deviceMemory /
                             // hardwareConcurrency / Network Information
                             // (saveData, effectiveType) / mobile-like UA
  }
  // Proactive capture + effect presets (default on). Complements adaptive:
  // picks 720p/540p/360p capture, starting rungs, effect fps, and optional
  // soft maxBitrate *before* the first frame. Pass false for static 720p.
  // Built-in UI also keeps background effects off on the `low` tier.
  connectionQuality?: boolean | {
    enabled?: boolean        // default true
    intervalMs?: number      // default 3000 (min 500)
    thresholds?: {           // optional loss/RTT cutoffs
      excellentLoss?: number // default 0.02
      goodLoss?: number      // default 0.08
      excellentRtt?: number  // default 0.15 (seconds)
      goodRtt?: number       // default 0.4
    }
  }
  // Pass false to disable sampling + `connection-quality` events.
  videoCodec?: string        // e.g. 'video/VP8'
  autoJoin?: boolean         // default true
  leaveOnUnload?: boolean    // default true — send `leave` on pagehide/beforeunload
                             // (F5, tab close) so peers drop you instantly instead
                             // of after ICE timeouts. Adapter send must be
                             // unload-safe (keepalive fetch / BroadcastChannel / WS).
}
```

### Media start examples

```ts
// Privacy-first: join silent/dark, acquire devices only when toggled on
await KapiRoom.join({
  /* … */
  media: { startMic: false, startCam: false, acquire: 'on-enable' },
})

// Pre-join lobby chose mic on, cam off — acquire both on join for instant unmute
await KapiRoom.join({
  /* … */
  media: { startMic: true, startCam: false, acquire: 'join' },
})

// Legacy “always live” behaviour
await KapiRoom.join({
  /* … */
  media: { startMic: true, startCam: true },
})
```

`setMic` / `setCam` are async — they acquire missing tracks when needed and
may renegotiate peers.

## UI (`mount`)

```ts
{
  ...roomOptions
  toolbar?: Array<'mic'|'cam'|'share'|'react'|'participants'|'layout'|'background'|'settings'|'hangup'>
    // Default omits layout/background — those live in Settings.
    // Pass them here for one-tap toolbar shortcuts.
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
  labels?: Record<string, string>  // see DEFAULT_LABELS — incl. layout /
                                   // layoutGrid|Spotlight|Sidebar (tooltip tracks
                                   // the current view) / pin / unpin / more /
                                   // microphone / camera / muted /
                                   // connectionExcellent|Good|Poor|Lost|Unknown
  videoFit?: 'contain' | 'cover'  // default 'contain' — full frame, true aspect
                                  // ratio. 'cover' fills the tile and crops
                                  // overflow. Screen shares always use
                                  // 'contain' so shared content stays readable.
  mirror?: boolean         // default true — mirror the local camera preview
                           // (Zoom/Meet style). Does not flip screen shares
                           // or remote tiles. Remembered in preferences;
                           // host value wins when set. Toggle in Settings → Video.
  connectionQualityUi?: 'bars' | 'dot' | 'off'
    // default 'bars' when room connectionQuality is on, else 'dot'.
    // 'bars' = Zoom/Meet-style signal strength; 'dot' = PC-state only;
    // 'off' hides the indicator.
  shortcuts?: boolean      // default true — in-call keyboard shortcuts,
                           // Jitsi-style: M toggles mic, V toggles camera.
                           // Scoped to the mounted UI and ignored while a
                           // form control has focus.
  reactions?: string[]     // emoji choices in the reaction picker (default:
                           // 👍 ❤️ 😂 😮 😢 🎉 👏 👎). Trimmed; empties and
                           // entries over 24 chars are dropped (matching the
                           // sendReaction wire cap); max 16 shown.
  preferences?: {
    enabled?: boolean      // default true — remember devices / layout /
                           // background mode / video fit / mirror /
                           // shortcuts / mic processing (noise suppression,
                           // echo cancellation, auto gain) in localStorage
                           // (key default 'kapi.prefs.v1').
                           // Explicit host options still win when set.
                           // Custom image backgrounds are session-only.
    key?: string
    onChange?: (prefs: KapiUserPreferences) => void
  }
  onHangup?: () => void
  onReady?: (room: KapiRoom) => void
  onError?: (error: Error) => void
}
```

### Settings UI

The built-in **Settings** panel is a Zoom/Meet-style dialog with tabs:

| Tab | Controls |
|-----|----------|
| Audio | Microphone, speaker (`setSinkId` when supported), noise suppression, echo cancellation, auto gain |
| Video | Camera, video fit (contain / cover), mirror my video |
| Effects | Background (none / blur / remove / image), blur strength |
| General | Default layout, keyboard shortcuts toggle |

Choices persist across reloads when `preferences.enabled` is on (the default).
Mic processing prefs are merged into `getUserMedia` constraints when the host
has not already pinned those keys on `media.audio`. The toolbar background
picker remains a quick shortcut and writes the same store.

### Built-in layout interactions

- **View** — switch `grid → spotlight → sidebar` from Settings → General (or add toolbar `'layout'` to cycle with one tap).
- **Background** — Settings → Effects (or toolbar `'background'` for a quick picker).
- **Click / pin a tile** — in grid, enlarges that peer (stage + filmstrip);
  in spotlight/sidebar, wins the stage over the active speaker. Click again to unpin.
  Screen shares always take the stage.
- **Active speaker** — spotlight/sidebar follow the loudest peer when nothing
  is pinned (Zoom Speaker view). Grid stays equal-tiles and only rings the
  speaking tile — auto-jumping Gallery would feel jumpy.
- **Alone** — spotlight/sidebar/focus hide the empty filmstrip so your tile fills
  the area.
- **Keyboard shortcuts** (`shortcuts`, default on): `M` toggles the mic, `V`
  toggles the camera — Jitsi-style, scoped to the mounted UI.
- **Narrow toolbar**: controls that don't fit move into a ⋯ More menu
  (mic, camera and hangup stay on the bar). Override the label with
  `labels.more`.
- **Connection quality bars** on remote tiles (and the participant roster)
  when `connectionQualityUi` is `'bars'`.

## Room events (`room.on(event, handler)`)

| Event | Payload | Notes |
|-------|---------|-------|
| `peer-joined` | `{ peerId, displayName?, avatarUrl? }` | Presence + peer connection created |
| `peer-left` | `{ peerId }` | Link torn down / `leave` received |
| `peer-meta` | `{ peerId, displayName?, avatarUrl? }` | Live identity update from `room.setIdentity()` / remote `peer-meta` signal |
| `track` | `{ peerId, track, streams }` | Remote media arrived; merge tracks into one stream per peer (browser `streams` identity is unreliable across renegotiation). To hide video, don't rely on remote track `mute` alone — browsers fire it late or never when a sender stops sending (e.g. screen share stopped, `replaceTrack(null)`, disabled camera, w3c/webrtc-pc#3077) and the `<video>` would freeze on the last decoded frame. Treat "no presented frame for ~2s" (via `video.requestVideoFrameCallback`) as video-off; the built-in UI does this |
| `peer-state` | `{ peerId, state }` | RTCPeerConnection state — drive connection badges |
| `connection-quality` | `{ peerId, quality }` | `quality`: `'excellent'` \| `'good'` \| `'poor'` \| `'lost'` \| `'unknown'` — inbound packet loss + RTT (and PC state). Fires on the quality timer; jumps to `'lost'` on disconnect/fail. Disable with `connectionQuality: false`. Helpers: `scoreConnectionQuality` / `readQualitySample` |
| `local-stream` | `{ stream }` | Local preview source; re-emitted on screen share, background, device switch |
| `reaction` | `{ peerId, emoji }` | Emoji reaction — fired for remote arrivals AND for the local one sent via `room.sendReaction(emoji)`; the built-in UI floats it up the screen Jitsi-style |
| `media-state` | `{ peerId, sharing, mic?, cam?, shareAudio? }` | Mic / camera / screen-share toggled — fired locally by `setMic` / `setCam` / `shareScreen` and for remote peers via the `media-state` signal message. `shareAudio` is true when the active share includes tab/system audio. `mic` / `cam` / `shareAudio` may be omitted by older senders (`true` = on). The built-in UI shows a mute chip on the tile (and in the participant list), a ♪ chip when share audio is on, and promotes the sharer's tile to a full-width stage with uncropped (`contain`) video |
| `error` | `{ error }` | Recoverable errors (ICE exhausted, maxPeers, …) |
| `hangup` | — | Room closed |

### Notable methods

- `shareScreen(true|false)` — `getDisplayMedia` requests tab/system audio when the browser allows it; audio is sent on a separate outbound track so muting the mic never silences the share.
- `setIdentity({ displayName?, avatarUrl? })` — update name/avatar mid-call and broadcast `peer-meta`.
- `setCam(false)` — stops sending camera video (`replaceTrack(null)`) and releases the capture track (LED off).
