const STYLE_ID = 'kapi-ui-styles';

export function injectStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.kapi-root {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 240px;
  background: var(--kapi-bg, #0d1117);
  color: var(--kapi-fg, #f5f5f5);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  overflow: hidden;
}

/* ---------- grid & tiles ---------- */
.kapi-grid {
  flex: 1;
  display: grid;
  gap: 10px;
  padding: 12px;
  grid-template-columns: 1fr;
  min-height: 0;
  align-content: center;
}
.kapi-tile {
  position: relative;
  background: var(--kapi-tile, #1c2128);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 14px;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
}
.kapi-tile video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* Fit the whole frame at its true aspect ratio — "cover" used to crop
     whatever overflowed the tile (screen share edges, faces near the frame
     border). Letterbox bars fall back to the tile background. */
  object-fit: contain;
  background: transparent;
  opacity: 1;
  transition: opacity 0.2s ease;
}
/* Opt back into edge-to-edge cropping (camera tiles only). */
.kapi-root.kapi-fit-cover .kapi-tile video {
  object-fit: cover;
}
/* ---------- screen-share stage ----------
   The sharer's tile (local preview and remote alike) is promoted to a stage:
   it is placed first, spans the full grid width, and takes the lion's share
   of the grid height via the row template mount() writes. */
.kapi-tile.screenshare {
  order: -1;
  grid-column: 1 / -1;
  border-color: color-mix(in srgb, var(--kapi-accent, #3b82f6) 38%, transparent);
}
.kapi-tile.screenshare video {
  /* Screen content must never be cropped — even under videoFit: 'cover'. */
  object-fit: contain;
}
.kapi-tile.video-off video {
  opacity: 0;
}
.kapi-tile.mirror video {
  transform: scaleX(-1);
}
.kapi-avatar {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: inherit;
  background:
    radial-gradient(600px 300px at 50% 120%, rgba(59, 130, 246, 0.16), transparent 60%),
    var(--kapi-tile, #1c2128);
}
.kapi-tile.video-off .kapi-avatar {
  display: flex;
}
.kapi-avatar-initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: clamp(56px, 8vw, 88px);
  height: clamp(56px, 8vw, 88px);
  border-radius: 999px;
  background: linear-gradient(135deg, var(--kapi-accent, #3b82f6), #7c3aed);
  font-size: clamp(20px, 3vw, 32px);
  font-weight: 650;
  letter-spacing: 0.04em;
  color: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  user-select: none;
}
.kapi-tile-meta {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 20px 12px 10px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
  font-size: 12px;
  pointer-events: none;
}
.kapi-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 550;
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
}
.kapi-conn {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #eab308;
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.35);
}
.kapi-conn[data-state='connected'] {
  background: #22c55e;
}
.kapi-conn[data-state='disconnected'] {
  background: #eab308;
  animation: kapi-pulse 1.2s ease-in-out infinite;
}
.kapi-conn[data-state='failed'] {
  background: var(--kapi-danger, #ef4444);
}
.kapi-tile.kapi-local .kapi-conn {
  display: none;
}
@keyframes kapi-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
.kapi-mic-state {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.9);
  color: #fff;
  line-height: 0;
}
.kapi-mic-state.hidden {
  display: none;
}

/* ---------- toolbar ---------- */
.kapi-toolbar {
  align-self: center;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 4px 12px 14px;
  padding: 8px 12px;
  border-radius: 999px;
  background: var(--kapi-toolbar, rgba(13, 17, 23, 0.78));
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.kapi-toolbar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
  line-height: 0;
  transition: background 0.15s ease, transform 0.1s ease, box-shadow 0.15s ease;
}
.kapi-toolbar button svg {
  display: block;
  flex-shrink: 0;
}
.kapi-toolbar button:hover {
  background: rgba(255, 255, 255, 0.16);
}
.kapi-toolbar button:active {
  transform: scale(0.94);
}
.kapi-toolbar button:focus-visible {
  outline: 2px solid var(--kapi-accent, #3b82f6);
  outline-offset: 2px;
}
.kapi-toolbar button.is-off {
  background: rgba(239, 68, 68, 0.92);
  color: #fff;
}
.kapi-toolbar button.is-off:hover {
  background: rgba(239, 68, 68, 1);
}
.kapi-toolbar button.is-active {
  background: var(--kapi-accent, #3b82f6);
  color: #fff;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--kapi-accent, #3b82f6) 30%, transparent);
}
.kapi-toolbar button[data-id='hangup'] {
  background: var(--kapi-danger, #ef4444);
}
.kapi-toolbar button[data-id='hangup']:hover {
  filter: brightness(1.12);
}

/* ---------- side panels ---------- */
.kapi-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  width: min(280px, 86%);
  max-height: calc(100% - 120px);
  overflow: auto;
  background: rgba(17, 22, 28, 0.92);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 14px;
  padding: 14px;
  z-index: 4;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.kapi-panel.hidden {
  display: none;
}
.kapi-panel h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.72);
}
.kapi-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 11px;
}
.kapi-participants ul {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
}
.kapi-participants li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-radius: 8px;
}
.kapi-participants li:hover {
  background: rgba(255, 255, 255, 0.05);
}
.kapi-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #22c55e;
}
.kapi-device {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
}
.kapi-device select {
  width: 100%;
  margin-top: 5px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(0, 0, 0, 0.4);
  color: inherit;
  font-size: 13px;
}
.kapi-device select:focus-visible {
  outline: 2px solid var(--kapi-accent, #3b82f6);
}

/* ---------- reactions (Jitsi-style) ---------- */
.kapi-reaction-picker {
  position: absolute;
  bottom: 74px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  gap: 2px;
  padding: 6px 8px;
  border-radius: 999px;
  background: var(--kapi-toolbar, rgba(13, 17, 23, 0.78));
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.kapi-reaction-picker.hidden {
  display: none;
}
.kapi-reaction-picker button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  padding: 0;
  cursor: pointer;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  transition: transform 0.12s ease, background 0.12s ease;
}
.kapi-reaction-picker button:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: scale(1.18);
}
.kapi-reaction-picker button:active {
  transform: scale(0.9);
}
.kapi-reaction-picker button:focus-visible {
  outline: 2px solid var(--kapi-accent, #3b82f6);
  outline-offset: 2px;
}
.kapi-reaction-float {
  position: absolute;
  bottom: 64px;
  z-index: 5;
  font-size: 30px;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.45));
  animation-name: kapi-reaction-rise;
  animation-timing-function: cubic-bezier(0.22, 0.75, 0.4, 1);
  animation-fill-mode: forwards;
}
@keyframes kapi-reaction-rise {
  0% {
    transform: translate(0, 0) scale(0.5) rotate(0deg);
    opacity: 0;
  }
  10% {
    transform: translate(calc(var(--kapi-drift, 0px) * 0.15), -14px)
      scale(1.25) rotate(calc(var(--kapi-spin, 0deg) * 0.2));
    opacity: 1;
  }
  22% {
    transform: translate(calc(var(--kapi-drift, 0px) * 0.2), -40px)
      scale(1) rotate(0deg);
  }
  70% {
    opacity: 1;
  }
  100% {
    transform: translate(var(--kapi-drift, 0px), var(--kapi-rise, -320px))
      scale(1) rotate(var(--kapi-spin, 0deg));
    opacity: 0;
  }
}

/* ---------- toast ---------- */
.kapi-toast {
  position: absolute;
  left: 50%;
  bottom: 86px;
  transform: translateX(-50%);
  z-index: 6;
  max-width: min(520px, 92%);
  padding: 10px 16px;
  border-radius: 999px;
  background: rgba(20, 26, 33, 0.95);
  border: 1px solid rgba(234, 179, 8, 0.45);
  color: #fde68a;
  font-size: 13px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  animation: kapi-toast-in 0.18s ease;
}
.kapi-toast.is-error {
  border-color: rgba(239, 68, 68, 0.5);
  color: #fecaca;
}
.kapi-toast.hidden {
  display: none;
}
@keyframes kapi-toast-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* ---------- sound gate ---------- */
.kapi-sound-gate {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  margin: 0;
  padding: 16px 20px;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.55);
  color: var(--kapi-fg, #f5f5f5);
  font: inherit;
  font-size: 1rem;
  font-weight: 600;
  backdrop-filter: blur(2px);
}
.kapi-sound-gate.hidden {
  display: none;
}
.kapi-sound-gate:hover {
  background: rgba(0, 0, 0, 0.65);
}
`;
  document.head.appendChild(style);
}
