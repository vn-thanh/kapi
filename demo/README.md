# kapi demo

Pull-and-try P2P call UI with an HTTP long-poll signaling relay (works across machines / ngrok).

## Quick start

From the repo root:

```bash
npm install
npm run demo
```

Then open [http://localhost:5179](http://localhost:5179) — join, open a **second tab** (or another device), same room id.

## Share with someone else (ngrok)

```bash
npm run demo
ngrok http 5179
```

Send the `https://….ngrok-free.app` link. Both people join the **same room id**.

## What it uses

| Piece | Source |
|-------|--------|
| UI | `@vn-thanh/kapi/ui` (`mount`) |
| Signaling | Demo HTTP long-poll relay at `/kapi-signal` (see `serve.mjs`) |
| Media | Browser `getUserMedia` (falls back if cam/mic missing) |

## Notes

- Needs **localhost** or HTTPS for camera/mic (ngrok HTTPS is fine).
- Older BroadcastChannel-only demos only worked across tabs on the **same** browser — that is why sharing a link alone used to fail.
- Default demo `iceServers` include a public TURN (Open Relay) so media works across NATs when sharing via ngrok. For production, use your own TURN credentials.
- Optional query: `?room=my-room&name=Ada&avatar=https://…/photo.jpg&autostart=1`
