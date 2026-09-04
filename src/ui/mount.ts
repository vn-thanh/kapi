import { KapiRoom } from '../core/room';
import { DEFAULT_LABELS, DEFAULT_THEME, DEFAULT_TOOLBAR } from '../options';
import type {
  BackgroundMode,
  KapiMountHandle,
  KapiMountOptions,
  ToolbarButton,
} from '../types';
import { injectStyles } from './styles';

export function mount(parent: HTMLElement, options: KapiMountOptions): KapiMountHandle {
  injectStyles();
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const toolbarBtns = options.toolbar?.length ? options.toolbar : DEFAULT_TOOLBAR;

  const root = document.createElement('div');
  root.className = 'kapi-root';
  root.style.setProperty('--kapi-bg', theme.bg);
  root.style.setProperty('--kapi-fg', theme.fg);
  root.style.setProperty('--kapi-accent', theme.accent);
  root.style.setProperty('--kapi-danger', theme.danger);
  root.style.setProperty('--kapi-tile', theme.tileBg);
  root.style.setProperty('--kapi-toolbar', theme.toolbarBg);

  const grid = document.createElement('div');
  grid.className = 'kapi-grid';
  const bar = document.createElement('div');
  bar.className = 'kapi-toolbar';
  const pane = document.createElement('div');
  pane.className = 'kapi-participants hidden';
  const settingsEl = document.createElement('div');
  settingsEl.className = 'kapi-settings hidden';
  root.append(grid, pane, settingsEl, bar);
  parent.appendChild(root);

  const tiles = new Map<string, HTMLVideoElement>();
  const remoteStreams = new Map<string, MediaStream>();
  let room: KapiRoom | null = null;
  let disposed = false;
  let bgMode: BackgroundMode = options.effects?.background ?? 'none';
  const unsubs: Array<() => void> = [];

  function layoutGrid() {
    const n = Math.max(1, tiles.size);
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  }

  function ensureTile(peerId: string, label: string, stream?: MediaStream | null) {
    let video = tiles.get(peerId);
    if (!video) {
      const wrap = document.createElement('div');
      wrap.className = 'kapi-tile';
      wrap.dataset.peerId = peerId;
      video = document.createElement('video');
      video.autoplay = true;
      video.playsInline = true;
      video.muted = peerId === options.peerId;
      const tag = document.createElement('span');
      tag.className = 'kapi-label';
      tag.textContent = label;
      wrap.append(video, tag);
      grid.appendChild(wrap);
      tiles.set(peerId, video);
    } else {
      const tag = video.parentElement?.querySelector('.kapi-label');
      if (tag) tag.textContent = label;
    }
    if (stream) video.srcObject = stream;
    layoutGrid();
    return video;
  }

  function removeTile(peerId: string) {
    tiles.get(peerId)?.parentElement?.remove();
    tiles.delete(peerId);
    remoteStreams.delete(peerId);
    layoutGrid();
  }

  function renderParticipants() {
    if (!room) return;
    pane.innerHTML = `<h3>${labels.participants}</h3>`;
    const ul = document.createElement('ul');
    for (const p of room.participants) {
      const li = document.createElement('li');
      li.textContent =
        p.peerId === options.peerId
          ? `${p.displayName ?? p.peerId} (${labels.you})`
          : (p.displayName ?? p.peerId);
      ul.appendChild(li);
    }
    pane.appendChild(ul);
  }

  function updateToolbarLabels() {
    if (!room) return;
    for (const b of bar.querySelectorAll('button')) {
      const id = b.getAttribute('data-id') as ToolbarButton | null;
      if (id === 'mic') b.textContent = room.micOn ? labels.micOn : labels.micOff;
      if (id === 'cam') b.textContent = room.camOn ? labels.camOn : labels.camOff;
      if (id === 'share') b.textContent = room.sharing ? labels.stopShare : labels.share;
    }
  }

  async function showSettings() {
    if (!room) return;
    settingsEl.classList.toggle('hidden');
    if (settingsEl.classList.contains('hidden')) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    settingsEl.innerHTML = `<h3>${labels.settings}</h3>`;

    const addSelect = (title: string, kind: MediaDeviceKind, onPick: (id: string) => void) => {
      const wrap = document.createElement('label');
      wrap.className = 'kapi-device';
      wrap.append(document.createTextNode(title));
      const sel = document.createElement('select');
      for (const d of devices.filter((x) => x.kind === kind)) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || d.deviceId.slice(0, 8);
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => onPick(sel.value));
      wrap.appendChild(sel);
      settingsEl.appendChild(wrap);
    };

    addSelect('Microphone', 'audioinput', (id) => void room?.switchDevice('audioinput', id));
    addSelect('Camera', 'videoinput', (id) => void room?.switchDevice('videoinput', id));
  }

  function makeButton(id: ToolbarButton, text: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = id;
    b.title = text;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubs.forEach((u) => u());
    unsubs.length = 0;
    void room?.hangup();
    room = null;
    root.remove();
  };

  const actions: Record<ToolbarButton, () => void> = {
    mic: () => {
      if (!room) return;
      room.setMic(!room.micOn);
      updateToolbarLabels();
    },
    cam: () => {
      if (!room) return;
      room.setCam(!room.camOn);
      updateToolbarLabels();
    },
    share: () => {
      if (!room) return;
      void room.shareScreen(!room.sharing).then(updateToolbarLabels);
    },
    participants: () => {
      pane.classList.toggle('hidden');
      renderParticipants();
    },
    background: () => {
      if (!room) return;
      const modes: Array<'none' | 'blur' | 'remove'> = ['none', 'blur', 'remove'];
      const cur = typeof bgMode === 'string' ? bgMode : 'none';
      const idx = Math.max(0, modes.indexOf(cur as 'none' | 'blur' | 'remove'));
      bgMode = modes[(idx + 1) % modes.length]!;
      void room.setBackground(bgMode);
    },
    settings: () => void showSettings(),
    hangup: () => {
      options.onHangup?.();
      dispose();
    },
  };

  for (const id of toolbarBtns) {
    const text =
      id === 'mic'
        ? labels.micOn
        : id === 'cam'
          ? labels.camOn
          : id === 'share'
            ? labels.share
            : labels[id];
    bar.appendChild(makeButton(id, text, actions[id]));
  }

  void KapiRoom.join(options)
    .then((r) => {
      if (disposed) {
        void r.hangup();
        return;
      }
      room = r;
      options.onReady?.(r);
      updateToolbarLabels();
      if (r.localMedia) ensureTile(options.peerId, labels.you, r.localMedia);

      unsubs.push(
        r.on('local-stream', ({ stream }) => ensureTile(options.peerId, labels.you, stream)),
        r.on('peer-joined', ({ peerId, displayName }) => {
          ensureTile(peerId, displayName ?? peerId, remoteStreams.get(peerId));
          renderParticipants();
        }),
        r.on('peer-left', ({ peerId }) => {
          removeTile(peerId);
          renderParticipants();
        }),
        r.on('track', ({ peerId, track, streams }) => {
          let stream = streams[0] ?? remoteStreams.get(peerId);
          if (!stream) {
            stream = new MediaStream();
            remoteStreams.set(peerId, stream);
          }
          if (!stream.getTracks().includes(track)) stream.addTrack(track);
          const meta = r.participants.find((p) => p.peerId === peerId);
          ensureTile(peerId, meta?.displayName ?? peerId, stream);
        }),
        r.on('error', ({ error }) => options.onError?.(error)),
        r.on('hangup', () => options.onHangup?.()),
      );
    })
    .catch((err) => {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

  return {
    get room() {
      return room;
    },
    dispose,
  };
}
