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
  background: var(--kapi-bg, #141414);
  color: var(--kapi-fg, #f5f5f5);
  font-family: system-ui, sans-serif;
  overflow: hidden;
}
.kapi-grid {
  flex: 1;
  display: grid;
  gap: 8px;
  padding: 8px;
  grid-template-columns: 1fr;
  min-height: 0;
}
.kapi-tile {
  position: relative;
  background: var(--kapi-tile, #1f1f1f);
  border-radius: 8px;
  overflow: hidden;
  min-height: 0;
}
.kapi-tile video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}
.kapi-label {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.55);
  font-size: 12px;
}
.kapi-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  padding: 10px;
  background: var(--kapi-toolbar, rgba(0,0,0,0.72));
}
.kapi-toolbar button {
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  background: #2a2a2a;
  color: inherit;
  font-size: 13px;
}
.kapi-toolbar button[data-id="hangup"] {
  background: var(--kapi-danger, #ef4444);
}
.kapi-toolbar button:hover {
  filter: brightness(1.1);
}
.kapi-participants,
.kapi-settings {
  position: absolute;
  top: 8px;
  right: 8px;
  width: min(260px, 80%);
  max-height: 60%;
  overflow: auto;
  background: rgba(20,20,20,0.95);
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px;
  z-index: 2;
}
.kapi-participants.hidden,
.kapi-settings.hidden {
  display: none;
}
.kapi-participants h3,
.kapi-settings h3 {
  margin: 0 0 8px;
  font-size: 14px;
}
.kapi-participants ul {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
}
.kapi-device {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
}
.kapi-device select {
  width: 100%;
  margin-top: 4px;
}
`;
  document.head.appendChild(style);
}
