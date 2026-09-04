# kapi demo

Pull-and-try P2P call UI using **BroadcastChannel** signaling (no Socket.IO server).

## Quick start

From the repo root:

```bash
npm install
npm run demo
```

Then open [http://localhost:5179](http://localhost:5179) — join, open a **second tab**, same room id.

## What it uses

| Piece | Source |
|-------|--------|
| UI | `@vn-thanh/kapi/ui` (`mount`) |
| Signaling | `createBroadcastSignalAdapter` (same-origin tabs only) |
| Media | Browser `getUserMedia` (falls back if cam/mic missing) |

## Notes

- Needs **localhost** or HTTPS for camera/mic.
- BroadcastChannel does **not** work across machines — for that, wire a host `SignalAdapter` (see [docs/SIGNALING.md](../docs/SIGNALING.md)).
- Optional query: `?room=my-room&name=Ada&autostart=1`
