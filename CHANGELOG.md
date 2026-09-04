# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project is maintained by [release-please](https://github.com/googleapis/release-please) — future entries are generated automatically from Conventional Commits.

## [1.1.0](https://github.com/vn-thanh/kapi/compare/v1.0.0...v1.1.0) (2026-09-04)


### Features

* **Toolbar overflow** — when the meeting chrome is too narrow for every control, extras collapse into a ⋯ More menu (mic, camera and leave stay on the bar) ([8a2b183](https://github.com/vn-thanh/kapi/commit/8a2b18352e818fff931143556e9edde9e167c7df))

### Bug Fixes

* **Remote mute indicator** — `setMic` / `setCam` now broadcast `media-state` (`mic`, `cam`, `sharing`) so other peers see a mute chip immediately. Inferring mute from the remote audio track's `muted` flag is unreliable (Chrome never fires it for audio). Late joiners get the current snapshot the same way they already learned about an in-progress screen share ([80fc833](https://github.com/vn-thanh/kapi/commit/80fc8336a7ac3cb7d1a15c72ae2a377256b58cdf))

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
