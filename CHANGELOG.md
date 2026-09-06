# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project is maintained by [release-please](https://github.com/googleapis/release-please) — future entries are generated automatically from Conventional Commits.

## [Unreleased]

### Added

- **Device adaptation** — proactive capture / effect presets from `deviceMemory`, CPU cores, Network Information (`saveData` / `effectiveType`), and mobile-like UA. Default on (`deviceAdaptation`); picks 720p / 540p / 360p capture ceilings, starting adaptive rungs, effect fps, and a soft `maxBitrate` on weak tiers before the first frame. Complements reactive `adaptive` encoder stepping. Helpers: `detectDeviceCapabilities`, `resolveDeviceAdaptation`; room exposes `deviceAdaptation`.
- **Demo invite link** — lobby **Copy invite link** copies a shareable URL with the current room id (recipient picks their own name).

### Changed

- **Settings Escape / `aria-modal`** — Escape closes the settings dialog and participants pane; settings uses `aria-modal="true"`.
- **Mobile safe-area** — toolbar and toast respect `env(safe-area-inset-*)` so home-indicator devices do not cover mute / hangup.
- **Screen-share UX** — Share dims when `getDisplayMedia` is missing; permission denials use a friendly toast; dismissing the share picker no longer surfaces an error.
- **Mobile layout** — sidebar view collapses to a bottom filmstrip under ~720px mount width (container query); demo uses `100dvh` + `visualViewport` height; touch hover sticky styles are neutralized; background effects stay off on `deviceAdaptation` tier `low`.
## [1.3.0](https://github.com/vn-thanh/kapi/compare/v1.2.0...v1.3.0) (2026-09-06)

### Added

- **Screen-share audio** — `getDisplayMedia` requests tab/system audio and sends it on a dedicated outbound track so mic mute never silences the shared tab. `media-state.shareAudio` is broadcast to peers; the UI shows a ♪ chip and toolbar tip when share audio is active. Falls back to video-only capture when the browser rejects audio in the display-media constraint.
- **`setIdentity({ displayName?, avatarUrl? })`** — mid-call name/avatar updates via `peer-meta` signaling; the built-in UI refreshes tile and roster labels live. Send `avatarUrl: ''` to clear a stored avatar.
- **Background image picker** — the background toolbar control opens a picker (None / Blur / Remove / Image…) instead of only cycling blur/remove; Image… applies a local file as a virtual background via `setBackground`.
- **Persisted preferences panel** — devices, layout, background effects, and keyboard shortcuts are remembered across sessions; settings move into a Zoom-style tabbed dialog, the default toolbar is decluttered, pinned grid tiles are larger, and empty filmstrips hide when you are alone.

### Changed

- **True camera-off** — `setCam(false)` uses `replaceTrack(null)` and stops the capture track (camera LED off / no black frames). Re-acquires the camera on `setCam(true)`.
- **Smoother reaction floats** — per-keyframe timing keeps the pop on the first segments and eases the flight as one segment; the float layer is promoted with `will-change`.

### Fixed

- **Cam-off during screen share** — `setCam(false)` no longer stops the display track that the local preview shares with outbound video.
- **Partial `peer-meta` merge** — name-only updates no longer clear a stored avatar; avatar-only updates keep the existing tile label instead of falling back to the raw peer id.
- **Background leak on hangup** — raced `BackgroundProcessor` starts are aborted after leave so effects cannot keep running after hangup.
- **Stale preferred devices** — when a remembered `deviceId` is gone, mic/cam fall back instead of sticking “on” without tracks; device picks persist only after `switchDevice` succeeds.
- **Background Worker stall** — the Worker acks dropped frames so the segmentation pipeline cannot wedge.

### Performance Improvements

- **MediaPipe in a Worker** — selfie segmentation prefers a module Worker off the main thread, with an automatic main-thread fallback if the Worker fails to load.

## [1.2.0](https://github.com/vn-thanh/kapi/compare/v1.1.0...v1.2.0) (2026-09-05)

### Features

* custom reaction emoji set via the reactions option ([5d785b8](https://github.com/vn-thanh/kapi/commit/5d785b8e55f46f988d1122ae605d082e0aed35d6))
* in-call keyboard shortcuts (M mute, V camera) with opt-out ([706943e](https://github.com/vn-thanh/kapi/commit/706943e117619ac2b56bb000be3d61b8ded3656a))
* join muted by default and show connection quality bars ([719c45c](https://github.com/vn-thanh/kapi/commit/719c45cdfd05744a3c118738880b907b94593a1c))
* overridable device/muted labels and a layout tooltip that tracks the view ([61db628](https://github.com/vn-thanh/kapi/commit/61db628920359196abab4eeb37fa19c12ab8e874))
* support custom peer avatars and clearer hang-up icon ([dd63314](https://github.com/vn-thanh/kapi/commit/dd6331498f9eadcfcbcfbde7dee62ba2205e224a))

### Bug Fixes

* a throwing signal adapter can no longer wedge negotiation or hangup ([82560ce](https://github.com/vn-thanh/kapi/commit/82560ce629467ce140a847da4a9e8a75858c1a1c))

### Performance Improvements

* reuse the segmentation mask raster instead of allocating one per frame ([f0653c2](https://github.com/vn-thanh/kapi/commit/f0653c20df412590174335ae903eb37772becb40))

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
