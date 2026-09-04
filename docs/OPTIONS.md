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
