# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project is maintained by [release-please](https://github.com/googleapis/release-please) — future entries are generated automatically from Conventional Commits.

## [1.1.0](https://github.com/vn-thanh/kapi/releases/tag/v1.1.0) (2026-09-05)

### Added

- **Adaptive video quality** (`adaptive`, default on) — Zoom/Jitsi-style per-connection engine: resolution/bitrate/framerate step down while the link reports sustained bandwidth/CPU limitation (`outbound-rtp` stats with hysteresis) and back up when it recovers; each receiver's rendered tile size caps what it is sent (`video-hint` receiver-constraint messages), so filmstrip thumbnails stop receiving full resolution. Screen shares keep full resolution at low fps. Camera capture defaults to a 720p-ideal ceiling. Set `adaptive: false` for static behavior.
- **Toolbar overflow** — when the meeting chrome is too narrow for every control, extras collapse into a ⋯ More menu (mic, camera and leave stay on the bar).
- **`npm run release`** — build + headless checks + `npm publish` from the local machine, as a fallback when the CI release path is unavailable.

### Fixed

- **Filmstrip & grid geometry** — spotlight/sidebar filmstrip thumbs keep a 16:9 aspect (Zoom/Meet-style) instead of stretching to fill the strip; the grid picks the column count whose 16:9 cells cover the most area for the container aspect and re-fits on window resize.
- **Remote mute indicator** — `setMic` / `setCam` now broadcast `media-state` (`mic`, `cam`, `sharing`) so other peers see a mute chip immediately. Inferring mute from the remote audio track's `muted` flag is unreliable (Chrome never fires it for audio). Late joiners get the current snapshot the same way they already learned about an in-progress screen share.

### Changed

- `maxBitrate` is now a hard cap over the adaptive rung bitrate (previously applied once after negotiation only).

## [1.0.0](https://github.com/vn-thanh/kapi/releases/tag/v1.0.0) (2026-09-04)

First public release. 🎉

### Added

- **P2P mesh rooms** (`KapiRoom`) — browser-to-browser WebRTC with perfect negotiation, late-joiner support, and instant leave on page unload
- **Pluggable signaling** — one `SignalAdapter` interface; helpers for `BroadcastChannel` (`createBroadcastSignalAdapter`) and in-page testing (`createLocalSignalBus`)
- **Drop-in meeting UI** (`mount` from `@vn-thanh/kapi/ui`) — toolbar, participant panel, settings, emoji reactions, sound gate, theming via CSS variables, overridable labels
- **Three tile layouts** — `grid`, `spotlight`, `sidebar`; click-to-pin, active-speaker ring, screen-share stage with uncropped `contain` video; runtime switching via toolbar or `handle.setLayout()`
- **Background effects** — blur, removal, and image swap via MediaPipe selfie segmentation, processed client-side with live `setBackground()` switching
- **Screen sharing** with `media-state` broadcast so late joiners see the current sharer
- **Device management** — `switchDevice()` for mic/camera, unavailable-device detection, true-aspect-ratio video (`contain`) with optional `cover` fit
- **Demo app** — HTTP long-poll signaling relay, ngrok-friendly, deep-linkable via query params
- **Headless self-checks** — negotiation, media, and UI-layout checks runnable without a browser