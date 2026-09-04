# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project is maintained by [release-please](https://github.com/googleapis/release-please) — future entries are generated automatically from Conventional Commits.

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