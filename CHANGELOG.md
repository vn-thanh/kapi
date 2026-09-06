# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project is maintained by [release-please](https://github.com/googleapis/release-please) — future entries are generated automatically from Conventional Commits.

## [1.4.0](https://github.com/vn-thanh/kapi/compare/v1.3.0...v1.4.0) (2026-09-06)


### Features

* adaptive per-connection video quality and Zoom-style layout geometry ([fa42e7d](https://github.com/vn-thanh/kapi/commit/fa42e7d5cf241ca9aec054f9dd708aee12d30282))
* add local demo, toolbar icons, and media fallbacks ([986b42e](https://github.com/vn-thanh/kapi/commit/986b42e5613ba495bc7c2368a4c693287c45af14))
* collapse overflowing toolbar controls into a More menu ([8a2b183](https://github.com/vn-thanh/kapi/commit/8a2b18352e818fff931143556e9edde9e167c7df))
* custom reaction emoji set via the reactions option ([5d785b8](https://github.com/vn-thanh/kapi/commit/5d785b8e55f46f988d1122ae605d082e0aed35d6))
* emoji reactions ([258e716](https://github.com/vn-thanh/kapi/commit/258e716fdc728fabbacf3b094cb4c8bd6f4e1566))
* grid/spotlight/sidebar layouts with dominant-speaker spotlight ([6f7a454](https://github.com/vn-thanh/kapi/commit/6f7a454d9d2a9c9c701792b518bd7cdb2c391ca9))
* in-call keyboard shortcuts (M mute, V camera) with opt-out ([706943e](https://github.com/vn-thanh/kapi/commit/706943e117619ac2b56bb000be3d61b8ded3656a))
* initial @vn-thanh/kapi P2P mesh WebRTC library ([905da5f](https://github.com/vn-thanh/kapi/commit/905da5fba12e85b249c8014b87a2b1aa3cb5d422))
* join muted by default and show connection quality bars ([719c45c](https://github.com/vn-thanh/kapi/commit/719c45cdfd05744a3c118738880b907b94593a1c))
* mark mic/cam unavailable when the machine has no such device ([39a2cf7](https://github.com/vn-thanh/kapi/commit/39a2cf7206e0035152e87da8fdc34158fab11814))
* overridable device/muted labels and a layout tooltip that tracks the view ([61db628](https://github.com/vn-thanh/kapi/commit/61db628920359196abab4eeb37fa19c12ab8e874))
* screen-share with tab/system audio ([c43c6d1](https://github.com/vn-thanh/kapi/commit/c43c6d1d4d42ecbcb6d6768517466b168dffc24d))
* shareable ngrok demo and harden P2P mesh negotiation. ([b76a6a5](https://github.com/vn-thanh/kapi/commit/b76a6a536a013014960f1f2337b88625cd2db887))
* support custom peer avatars and clearer hang-up icon ([dd63314](https://github.com/vn-thanh/kapi/commit/dd6331498f9eadcfcbcfbde7dee62ba2205e224a))
* true cam-off and live setIdentity API ([5d18ad0](https://github.com/vn-thanh/kapi/commit/5d18ad04ed764d1658811924900827ab5ab44cd6))
* **ui:** background picker with image support; smooth reaction floats ([b5fa2cb](https://github.com/vn-thanh/kapi/commit/b5fa2cb82ef4163f59f60f1892cde887d11ebef6))
* **ui:** persist settings and centralize preferences panel ([7c7229f](https://github.com/vn-thanh/kapi/commit/7c7229f79444b4bb29fde86bfb2521184d985bda))
* **ui:** share-audio chip and live peer identity ([c4bef27](https://github.com/vn-thanh/kapi/commit/c4bef276fe0cf43d1f9cadcedbd9e8a64e1b1479))


### Bug Fixes

* a throwing signal adapter can no longer wedge negotiation or hangup ([82560ce](https://github.com/vn-thanh/kapi/commit/82560ce629467ce140a847da4a9e8a75858c1a1c))
* background blur composited the person instead of the background ([69970af](https://github.com/vn-thanh/kapi/commit/69970afe5686c23abc2fc74e903685b85bf18265))
* background button unavailable without a camera, null videoWidth race ([1032223](https://github.com/vn-thanh/kapi/commit/1032223f825ded19bb6956d4ebf4bd82df7026d7))
* broadcast mic/cam state so remotes see the mute chip ([80fc833](https://github.com/vn-thanh/kapi/commit/80fc8336a7ac3cb7d1a15c72ae2a377256b58cdf))
* display video fully at true aspect ratio, stage layout for screen share ([6eace7c](https://github.com/vn-thanh/kapi/commit/6eace7ce8944e8801a8f5d1eade7f08734ed2ec9))
* hide frozen last frame when remote stops sending ([9e1bcac](https://github.com/vn-thanh/kapi/commit/9e1bcac15f8f7763eeeb331b8f25a956b6d4bbc4))
* keep screen share alive on cam-off and preserve peer-meta names ([3a1905a](https://github.com/vn-thanh/kapi/commit/3a1905a2b526d00a75fb959c003418eb706eba3b))
* lifecycle leaks and races around hangup and failed joins ([f43483d](https://github.com/vn-thanh/kapi/commit/f43483df6da180ed2b17b4159a7188377e3f4fb1))
* media robustness, negotiation state, and revamped tile UI ([d0156ef](https://github.com/vn-thanh/kapi/commit/d0156efdf9c2669de4606b2ab46cb0effc65a2a8))
* one-way media for late joiners — attach tracks via addTrack, not pre-created sendrecv transceivers ([f3cc0ae](https://github.com/vn-thanh/kapi/commit/f3cc0ae5e2232ac5ed19c31263b3136ff68e8c50))
* preserve avatar on partial peer-meta and unblock background Worker ([c10dcd4](https://github.com/vn-thanh/kapi/commit/c10dcd4d377d51e022d5fcfc3b6bdea8be695788))
* screen share for remotes and demo MediaPipe loading. ([6aba7ea](https://github.com/vn-thanh/kapi/commit/6aba7ea6b5f1b12f154b11d93b2d81c3e67e1a7d))
* stop background leak on hangup and recover stale preferred devices ([1ebd935](https://github.com/vn-thanh/kapi/commit/1ebd935e65c62012dc5b6239d796fb9b801d9754))


### Performance Improvements

* reuse the segmentation mask raster instead of allocating one per frame ([f0653c2](https://github.com/vn-thanh/kapi/commit/f0653c20df412590174335ae903eb37772becb40))
* run MediaPipe background effects in a Worker ([9a827b8](https://github.com/vn-thanh/kapi/commit/9a827b872d1be6c51008ed35b288286d6906adfe))

## [Unreleased]

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
