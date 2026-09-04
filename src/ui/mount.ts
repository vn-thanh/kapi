import { KapiRoom } from '../core/room';
import { DEFAULT_LABELS, DEFAULT_THEME, DEFAULT_TOOLBAR } from '../options';
import type {
  BackgroundMode,
  KapiLayout,
  KapiMountHandle,
  KapiMountOptions,
  ToolbarButton,
} from '../types';
import { toolbarIconHtml, statusIconHtml } from './icons';
import { createSpeakerWatcher } from './speaker';
import { injectStyles } from './styles';

type Tile = {
  wrap: HTMLDivElement;
  video: HTMLVideoElement;
  label: HTMLSpanElement;
  avatar: HTMLDivElement;
  conn: HTMLSpanElement;
  micChip: HTMLSpanElement;
  /** performance.now() when this video last presented a frame. */
  lastFrameAt: number;
  /** A frame was presented at least once on the current source. */
  presentedFrame: boolean;
  /** Pending requestVideoFrameCallback handle; null when none is armed. */
  frameHandle: number | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0]![0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1]![0] : '';
  return (a + b).toUpperCase();
}

/**
 * A tile whose video track still *looks* live (unmuted, enabled) but has
 * presented no frame for this long is treated as video-off. When a sender
 * stops a screen share (camera off or missing), frames stop flowing and the
 * receiver's <video> keeps displaying the LAST DECODED FRAME — the frozen
 * screen image — because remote `mute` events are unreliable and tardy across
 * browsers (Chrome mutes video late and audio never; Safari never fires
 * unmute; w3c/webrtc-pc#3077). Frame presence itself is the reliable signal.
 */
const FRAME_STALL_MS = 2000;

function supportsFrameCallback(): boolean {
  return (
    typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype
  );
}

export function mount(parent: HTMLElement, options: KapiMountOptions): KapiMountHandle {
  injectStyles();
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const toolbarBtns = options.toolbar?.length ? options.toolbar : DEFAULT_TOOLBAR;
  const selfId = options.peerId;
  const selfName = options.displayName?.trim() || labels.you;

  const root = document.createElement('div');
  root.className = 'kapi-root';
  // 'contain' (default) keeps every frame fully visible at its true aspect
  // ratio; 'cover' restores edge-to-edge cropping for camera tiles.
  if (options.videoFit === 'cover') root.classList.add('kapi-fit-cover');
  for (const [key, value] of Object.entries({
    bg: theme.bg,
    fg: theme.fg,
    accent: theme.accent,
    danger: theme.danger,
    tile: theme.tileBg,
    toolbar: theme.toolbarBg,
  })) {
    root.style.setProperty(`--kapi-${key}`, value);
  }

  const grid = document.createElement('div');
  grid.className = 'kapi-grid';
  // spotlight/sidebar hosts: the featured tile goes to the stage, everyone
  // else to the strip (grid mode hides both and uses .kapi-grid alone).
  const main = document.createElement('div');
  main.className = 'kapi-main';
  const stage = document.createElement('div');
  stage.className = 'kapi-stage';
  const strip = document.createElement('div');
  strip.className = 'kapi-strip';
  main.append(grid, stage, strip);
  const bar = document.createElement('div');
  bar.className = 'kapi-toolbar';
  const pane = document.createElement('div');
  pane.className = 'kapi-panel kapi-participants hidden';
  const settingsEl = document.createElement('div');
  settingsEl.className = 'kapi-panel kapi-settings hidden';
  const reactPanel = document.createElement('div');
  reactPanel.className = 'kapi-reaction-picker hidden';
  const toast = document.createElement('div');
  toast.className = 'kapi-toast hidden';
  toast.setAttribute('role', 'alert');

  const soundGate = document.createElement('button');
  soundGate.type = 'button';
  soundGate.className = 'kapi-sound-gate hidden';
  soundGate.textContent = labels.enableSound;

  root.append(main, pane, settingsEl, reactPanel, bar, toast, soundGate);
  parent.appendChild(root);

  const tiles = new Map<string, Tile>();
  /** Screen-share state that arrived before the peer's tile existed (share
   *  broadcast raced ahead of presence) — applied in ensureTile. */
  const pendingShareState = new Map<string, boolean>();
  /** One managed stream per remote peer — never trust `ontrack` stream
   *  identity: with replaceTrack/renegotiation browsers may report audio and
   *  video on *different* MediaStream objects (or none at all), which used to
   *  break remote audio. We merge tracks ourselves. */
  const remoteStreams = new Map<string, MediaStream>();
  /** Separate <audio> for remotes — muted <video> satisfies autoplay, audio needs a gesture. */
  const remoteAudio = new Map<string, HTMLAudioElement>();
  let soundUnlocked = false;
  let room: KapiRoom | null = null;
  let disposed = false;
  let bgMode: BackgroundMode = options.effects?.background ?? 'none';
  const unsubs: Array<() => void> = [];
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------- layout modes (grid / spotlight / sidebar) ----------

  const LAYOUTS: readonly KapiLayout[] = ['grid', 'spotlight', 'sidebar'];
  let layoutMode: KapiLayout =
    options.layout && LAYOUTS.includes(options.layout) ? options.layout : 'grid';
  /** Click-pinned peer — wins the spotlight/sidebar stage (after screen shares). */
  let pinnedPeer: string | null = null;
  /** Last audible peer — the auto-featured candidate when nothing is pinned. */
  let dominant: string | null = null;
  const speakers = createSpeakerWatcher();
  unsubs.push(speakers.dispose);
  unsubs.push(
    speakers.onspeaking((peerId) => {
      dominant = peerId;
      for (const t of tiles.values()) t.wrap.classList.toggle('speaking', t.wrap.dataset.peerId === peerId);
      applyLayout();
    }),
  );

  // ---------- frozen-frame watchdog ----------

  // Re-evaluate every tile once a second: if a video element still holds a
  // "live-looking" track but no frame has been presented recently (screen
  // share just stopped, camera turned off mid-call), syncVideoVisibility
  // flips it to video-off so the stale last frame is hidden behind the
  // avatar. document.hidden pauses presentation (no rVFC callbacks) and
  // would cause false positives.
  const frameWatchdog = setInterval(() => {
    if (disposed || document.hidden) return;
    for (const tile of tiles.values()) {
      syncVideoVisibility(tile, tile.video.srcObject as MediaStream | null);
    }
  }, 1000);

  // ---------- device availability ----------

  /** A missing device flips its toolbar button into an "unavailable" state
   *  (dimmed, explanatory tooltip, click → toast) instead of leaving a
   *  toggle that silently does nothing. Re-checked on `devicechange` so
   *  hot-plugging a camera/mic restores the button live. */
  const deviceMissing: Record<'mic' | 'cam', boolean> = { mic: false, cam: false };

  async function refreshDeviceAvailability() {
    if (disposed || !room) return;
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      // Insecure context or ancient browser — nothing can ever be captured.
      deviceMissing.mic = true;
      deviceMissing.cam = true;
      updateToolbarLabels();
      return;
    }
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await md.enumerateDevices();
    } catch {
      return; // unknown state — leave the buttons as they are
    }
    deviceMissing.mic = !devices.some((d) => d.kind === 'audioinput');
    deviceMissing.cam = !devices.some((d) => d.kind === 'videoinput');
    updateToolbarLabels();
  }

  // ---------- toast / errors ----------

  function showToast(text: string, isError = true) {
    if (disposed) return;
    toast.textContent = text;
    toast.classList.toggle('is-error', isError);
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 4500);
  }

  function reportError(err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[kapi]', error);
    showToast(error.message || String(err));
    options.onError?.(error);
  }

  // ---------- sound gate ----------

  function showSoundGate() {
    if (soundUnlocked || disposed) return;
    soundGate.classList.remove('hidden');
  }

  function unlockSound() {
    if (disposed || soundUnlocked) return;
    soundUnlocked = true;
    speakers.wake();
    soundGate.classList.add('hidden');
    for (const audio of remoteAudio.values()) {
      audio.muted = false;
      void audio.play().catch(() => undefined);
    }
  }

  soundGate.addEventListener('click', unlockSound);
  // Any in-call click also counts as the autoplay gesture.
  root.addEventListener(
    'pointerdown',
    () => {
      if (!soundUnlocked && remoteAudio.size > 0) unlockSound();
    },
    { passive: true },
  );

  // ---------- tiles ----------

  /** Column/row math for grid mode only. */
  function sizeGrid() {
    let shares = 0;
    let cams = 0;
    for (const tile of tiles.values()) {
      if (tile.wrap.classList.contains('screenshare')) shares++;
      else cams++;
    }
    // Stage tiles span the full grid width, so columns only need to fit the
    // remaining (camera) tiles.
    const cols = cams <= 1 ? 1 : cams <= 4 ? 2 : 3;
    const camRows = Math.ceil(cams / cols);
    // Size rows explicitly: auto rows sized themselves to the video's
    // intrinsic resolution (e.g. 1280×720) and blew out of the grid. Stage
    // rows take ~2.5× a camera row so shared screens stay readable.
    const rows: string[] = [];
    if (shares > 0) rows.push(`repeat(${shares}, minmax(0, 2.5fr))`);
    if (camRows > 0) rows.push(`repeat(${camRows}, minmax(0, 1fr))`);
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = rows.join(' ') || 'none';
  }

  /** Spotlight/sidebar featured tile priority: screen share > pinned >
   *  dominant speaker > local tile. */
  function pickFeatured(): Tile | null {
    for (const t of tiles.values()) {
      if (t.wrap.classList.contains('screenshare')) return t;
    }
    if (pinnedPeer) return tiles.get(pinnedPeer) ?? null;
    if (dominant) return tiles.get(dominant) ?? null;
    return tiles.get(selfId) ?? tiles.values().next().value ?? null;
  }

  /** Re-home tiles for the current layout mode and re-apply grid sizing.
   *  The single entry point every tile/peer/share change funnels through. */
  function applyLayout() {
    root.classList.toggle('layout-spotlight', layoutMode === 'spotlight');
    root.classList.toggle('layout-sidebar', layoutMode === 'sidebar');
    for (const t of tiles.values()) t.wrap.classList.toggle('featured', false);
    if (layoutMode === 'grid') {
      grid.append(...[...tiles.values()].map((t) => t.wrap));
      sizeGrid();
      return;
    }
    const featured = pickFeatured();
    for (const t of tiles.values()) t.wrap.classList.toggle('featured', t === featured);
    if (featured) stage.append(featured.wrap);
    const rest = [...tiles.values()].filter((t) => t !== featured).map((t) => t.wrap);
    if (rest.length) strip.append(...rest);
  }

  function setLayout(mode: KapiLayout) {
    if (mode === layoutMode || !LAYOUTS.includes(mode)) return;
    layoutMode = mode;
    const b = bar.querySelector<HTMLButtonElement>('button[data-id="layout"]');
    if (b) b.title = `${labels.layout}: ${mode}`;
    applyLayout();
  }

  function setPinned(peerId: string | null) {
    if (pinnedPeer === peerId) return;
    pinnedPeer = peerId;
    for (const t of tiles.values()) {
      const on = t.wrap.dataset.peerId === peerId;
      t.wrap.classList.toggle('pinned', on);
      t.wrap.setAttribute('aria-pressed', on ? 'true' : 'false');
      t.wrap.title = on ? labels.unpin : labels.pin;
    }
    applyLayout();
  }

  function togglePin(peerId: string) {
    setPinned(pinnedPeer === peerId ? null : peerId);
  }

  function ensureTile(peerId: string, label: string): Tile {
    let tile = tiles.get(peerId);
    if (tile) {
      tile.label.textContent = label;
      const chip = tile.avatar.querySelector('.kapi-avatar-initials');
      if (chip) chip.textContent = initials(label);
      return tile;
    }
    const wrap = document.createElement('div');
    wrap.className = 'kapi-tile video-off';
    wrap.dataset.peerId = peerId;
    if (peerId === selfId) wrap.classList.add('kapi-local');
    // Click / Enter / Space pins the peer — pinned wins the spotlight and
    // sidebar stage. Clicking the pinned tile unpins it.
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('aria-pressed', 'false');
    wrap.title = labels.pin;
    wrap.addEventListener('click', () => togglePin(peerId));
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      togglePin(peerId);
    });

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    // Always muted on <video> to satisfy autoplay; remote audio uses <audio>.
    video.muted = true;

    const avatar = document.createElement('div');
    avatar.className = 'kapi-avatar';
    const avatarInitials = document.createElement('span');
    avatarInitials.className = 'kapi-avatar-initials';
    avatarInitials.textContent = initials(nameFor(peerId, label));
    avatar.appendChild(avatarInitials);

    const meta = document.createElement('div');
    meta.className = 'kapi-tile-meta';
    const conn = document.createElement('span');
    conn.className = 'kapi-conn';
    conn.title = 'connecting';
    const tag = document.createElement('span');
    tag.className = 'kapi-label';
    tag.textContent = label;
    const micChip = document.createElement('span');
    micChip.className = 'kapi-mic-state hidden';
    micChip.innerHTML = statusIconHtml('micOff');
    meta.append(conn, tag, micChip);

    wrap.append(video, avatar, meta);
    grid.appendChild(wrap);
    tile = {
      wrap,
      video,
      label: tag,
      avatar,
      conn,
      micChip,
      lastFrameAt: performance.now(),
      presentedFrame: false,
      frameHandle: null,
    };
    tiles.set(peerId, tile);
    const pending = pendingShareState.get(peerId);
    if (pending !== undefined) {
      tile.wrap.classList.toggle('screenshare', pending);
      pendingShareState.delete(peerId);
    }
    armFrameWatch(tile);
    applyLayout();
    return tile;
  }

  function nameFor(peerId: string, fallback: string): string {
    if (peerId === selfId) return fallback;
    return fallback || peerId;
  }

  /** Reflect "no live video" (muted/disabled/no track, or frames stopped
   *  arriving while the track still looks live) with an avatar overlay. */
  function syncVideoVisibility(tile: Tile, stream: MediaStream | null) {
    const tracks = stream?.getVideoTracks() ?? [];
    const enabledLive = tracks.some((t) => t.enabled && t.readyState === 'live');
    const looksLive = enabledLive && tracks.some((t) => !t.muted && t.enabled && t.readyState === 'live');
    const framesFlowing =
      enabledLive && tile.presentedFrame && performance.now() - tile.lastFrameAt <= FRAME_STALL_MS;
    // Show video when frames are actually being presented (this also rescues
    // browsers whose muted flag sticks while media flows), or when a
    // live-looking track has yet to present its first frame (startup decode —
    // the historical behavior). presentedFrame is only ever set by
    // requestVideoFrameCallback, so browsers without it keep the pure
    // track-state logic.
    const videoOn = framesFlowing || (looksLive && !tile.presentedFrame);
    tile.wrap.classList.toggle('video-off', !videoOn);
  }

  /** Track real frame presentation per tile — the trustworthy replacement for
   *  the unreliable remote track `mute`/`unmute` events (w3c/webrtc-pc#3077).
   *  Re-armed after every srcObject swap so the callback chain cannot die
   *  with the old source. */
  function armFrameWatch(tile: Tile) {
    if (!supportsFrameCallback()) return;
    const video = tile.video;
    if (tile.frameHandle !== null) video.cancelVideoFrameCallback(tile.frameHandle);
    const onFrame = () => {
      if (disposed) return;
      tile.presentedFrame = true;
      tile.lastFrameAt = performance.now();
      // Frames resumed (camera back, connection recovered) — clear the
      // video-off state at once instead of waiting for the watchdog tick.
      if (tile.wrap.classList.contains('video-off')) {
        syncVideoVisibility(tile, video.srcObject as MediaStream | null);
      }
      tile.frameHandle = video.requestVideoFrameCallback(onFrame);
    };
    tile.frameHandle = video.requestVideoFrameCallback(onFrame);
  }

  function attachLocalStream(stream: MediaStream) {
    speakers.watch(selfId, stream);
    const tile = ensureTile(selfId, selfName === labels.you ? labels.you : `${selfName} (${labels.you})`);
    const chip = tile.avatar.querySelector('.kapi-avatar-initials');
    if (chip) chip.textContent = initials(selfName);
    if (tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      // New source: old frames no longer count as "flowing".
      tile.presentedFrame = false;
      armFrameWatch(tile);
    }
    void tile.video.play().catch(() => undefined);
    // Mirror the camera preview, but never a screen share (text would flip).
    // The share preview also promotes the tile to stage layout.
    tile.wrap.classList.toggle('mirror', !(room?.sharing ?? false));
    tile.wrap.classList.toggle('screenshare', room?.sharing ?? false);
    syncVideoVisibility(tile, stream);
    applyLayout();
  }

  function mergeRemoteTrack(peerId: string, track: MediaStreamTrack): MediaStream {
    let stream = remoteStreams.get(peerId);
    if (!stream) {
      stream = new MediaStream();
      remoteStreams.set(peerId, stream);
    }
    if (!stream.getTracks().includes(track)) stream.addTrack(track);
    return stream;
  }

  function attachRemoteTrack(peerId: string, track: MediaStreamTrack) {
    const stream = mergeRemoteTrack(peerId, track);
    speakers.watch(peerId, stream);
    const meta = room?.participants.find((p) => p.peerId === peerId);
    const tile = ensureTile(peerId, meta?.displayName ?? peerId);
    if (tile.video.srcObject !== stream) {
      tile.video.srcObject = stream;
      // New source: old frames no longer count as "flowing".
      tile.presentedFrame = false;
      armFrameWatch(tile);
    }

    const refresh = () => {
      if (disposed) return;
      syncVideoVisibility(tile, stream);
      void tile.video.play().catch(() => undefined);
      if (stream.getAudioTracks().length) bindRemoteAudio(peerId, stream);
      updateMicChip(tile, stream);
    };
    // Sender-side track.enabled=false stops RTP → remote onmute fires;
    // onunmute marks recovery / replaceTrack content swaps (screen share).
    track.addEventListener('mute', refresh);
    track.addEventListener('unmute', refresh);
    track.addEventListener('ended', refresh);
    refresh();
  }

  function updateMicChip(tile: Tile, stream: MediaStream) {
    const aud = stream.getAudioTracks()[0];
    const micOff = !!aud && (aud.muted || !aud.enabled) && aud.readyState === 'live';
    tile.micChip.classList.toggle('hidden', !micOff);
  }

  function bindRemoteAudio(peerId: string, stream: MediaStream) {
    if (!stream.getAudioTracks().length) return;
    let audio = remoteAudio.get(peerId);
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.style.display = 'none';
      root.appendChild(audio);
      remoteAudio.set(peerId, audio);
    }
    if (audio.srcObject !== stream) audio.srcObject = stream;
    if (soundUnlocked) {
      audio.muted = false;
      void audio.play().catch(() => undefined);
      return;
    }
    // Try unmuted playback first — joining is usually a click, and browsers
    // often allow audio near that activation. Fall back to muted + the
    // "Tap to enable sound" gate only if autoplay is blocked.
    audio.muted = false;
    void audio
      .play()
      .then(() => unlockSound())
      .catch(() => {
        if (soundUnlocked || disposed) return;
        audio!.muted = true;
        void audio!.play().catch(() => undefined);
        showSoundGate();
      });
  }

  function removeTile(peerId: string) {
    const tile = tiles.get(peerId);
    if (!tile) return;
    if (tile.frameHandle !== null) tile.video.cancelVideoFrameCallback(tile.frameHandle);
    tile.video.srcObject = null;
    tile.wrap.remove();
    tiles.delete(peerId);
    pendingShareState.delete(peerId);
    speakers.forget(peerId);
    if (pinnedPeer === peerId) pinnedPeer = null;
    remoteStreams.get(peerId)?.getTracks().forEach((t) => t.stop());
    remoteStreams.delete(peerId);
    const audio = remoteAudio.get(peerId);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
      remoteAudio.delete(peerId);
    }
    applyLayout();
  }

  // ---------- panels ----------

  function showPanel(which: 'participants' | 'settings', show: boolean) {
    const el = which === 'participants' ? pane : settingsEl;
    const other = which === 'participants' ? settingsEl : pane;
    if (show) other.classList.add('hidden');
    el.classList.toggle('hidden', !show);
  }

  // ---------- reactions (Jitsi-style floating emojis) ----------

  const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '👏', '👎'];
  /** Cap concurrent floats so a reaction storm cannot flood the DOM. */
  const MAX_FLOATS = 24;

  function closeReactions() {
    reactPanel.classList.add('hidden');
  }

  function toggleReactions() {
    reactPanel.classList.toggle('hidden');
  }

  // Click-away closes the picker (pointerdown fires before click, so the
  // react button and the picker itself are excluded to keep the toggle sane).
  const onDocPointerForReactions = (e: Event) => {
    if (reactPanel.classList.contains('hidden')) return;
    const target = e.target;
    if (target instanceof Element && (target.closest('.kapi-reaction-picker') || target.closest('button[data-id="react"]'))) {
      return;
    }
    closeReactions();
  };
  document.addEventListener('pointerdown', onDocPointerForReactions);
  unsubs.push(() => document.removeEventListener('pointerdown', onDocPointerForReactions));

  // Hot-plug: plugging in a camera/mic mid-call restores its toolbar button
  // (and unplugging dims it) without a reload.
  const onDeviceChange = () => void refreshDeviceAvailability();
  const md = navigator.mediaDevices;
  if (md?.addEventListener) {
    md.addEventListener('devicechange', onDeviceChange);
    unsubs.push(() => md.removeEventListener('devicechange', onDeviceChange));
  }

  for (const emoji of REACTIONS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.title = emoji;
    b.setAttribute('aria-label', emoji);
    b.addEventListener('click', () => {
      closeReactions();
      if (room) room.sendReaction(emoji);
      else spawnReactionFloat(emoji); // join still in flight — local feedback only
    });
    reactPanel.appendChild(b);
  }

  /** Rise-and-fade emoji, like Jitsi's reactions. Called for local picks (via
   *  the room's own `reaction` emit) and for remote arrivals alike. */
  function spawnReactionFloat(emoji: string) {
    if (disposed) return;
    const floats = root.querySelectorAll('.kapi-reaction-float');
    if (floats.length >= MAX_FLOATS) floats[0]?.remove();
    const el = document.createElement('span');
    el.className = 'kapi-reaction-float';
    el.textContent = emoji;
    // Rise across (almost) the whole root from just above the toolbar.
    el.style.left = `${(8 + Math.random() * 74).toFixed(1)}%`;
    el.style.setProperty('--kapi-rise', `-${Math.max(160, root.clientHeight - 140)}px`);
    el.style.setProperty('--kapi-drift', `${Math.round(Math.random() * 120 - 60)}px`);
    el.style.setProperty('--kapi-spin', `${(Math.random() * 48 - 24).toFixed(0)}deg`);
    el.style.animationDuration = `${(3.4 + Math.random() * 1.2).toFixed(2)}s`;
    el.addEventListener('animationend', () => el.remove());
    root.appendChild(el);
  }

  function renderParticipants() {
    if (!room) return;
    pane.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = labels.participants;
    const count = document.createElement('span');
    count.className = 'kapi-count';
    count.textContent = String(room.participants.length);
    h.appendChild(count);
    pane.appendChild(h);
    const ul = document.createElement('ul');
    for (const p of room.participants) {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'kapi-dot';
      const name = document.createElement('span');
      name.textContent =
        p.peerId === selfId
          ? `${p.displayName ?? p.peerId} (${labels.you})`
          : (p.displayName ?? p.peerId);
      li.append(dot, name);
      ul.appendChild(li);
    }
    pane.appendChild(ul);
  }

  function paintButton(b: HTMLButtonElement, id: ToolbarButton, text: string, mode: 'on' | 'off' | 'active' = 'on') {
    const unavailable =
      (id === 'background' && deviceMissing.cam) ||
      ((id === 'mic' || id === 'cam') && deviceMissing[id]);
    // An unavailable device replaces the toggle label ("Mute"/"Unmute") — a
    // mute tooltip on a button that cannot capture anything would be a lie.
    const label = unavailable ? (id === 'mic' ? labels.noMic : labels.noCam) : text;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', mode === 'off' ? 'false' : 'true');
    b.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
    b.innerHTML = toolbarIconHtml(id, mode === 'off');
    // The unavailable look wins over the on/off/accent paints, so the button
    // reads as "not usable here" rather than as another toggle state.
    b.classList.toggle('is-off', mode === 'off' && !unavailable);
    b.classList.toggle('is-active', mode === 'active' && !unavailable);
    b.classList.toggle('is-unavailable', unavailable);
  }

  function updateToolbarLabels() {
    if (!room) return;
    for (const el of bar.querySelectorAll('button')) {
      const b = el as HTMLButtonElement;
      const id = b.getAttribute('data-id') as ToolbarButton | null;
      if (!id) continue;
      if (id === 'mic') {
        paintButton(b, id, room.micOn ? labels.micOn : labels.micOff, room.micOn ? 'on' : 'off');
      } else if (id === 'cam') {
        paintButton(b, id, room.camOn ? labels.camOn : labels.camOff, room.camOn ? 'on' : 'off');
      } else if (id === 'share') {
        // Active while sharing (accent) — previously the button greyed out,
        // which read as "disabled" instead of "in progress".
        paintButton(b, id, room.sharing ? labels.stopShare : labels.share, room.sharing ? 'active' : 'on');
      } else if (id === 'background') {
        // Repaint on device re-check so a missing camera flips the button
        // into the unavailable state live (hot-plug included).
        paintButton(b, id, labels.background);
      }
    }
    const selfTile = tiles.get(selfId);
    if (selfTile && room.localMedia) syncVideoVisibility(selfTile, room.localMedia);
  }

  async function showSettings() {
    if (!room) return;
    const opening = settingsEl.classList.contains('hidden');
    showPanel('settings', opening);
    if (!opening) return;
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      reportError(err);
      return;
    }
    settingsEl.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = labels.settings;
    settingsEl.appendChild(h);

    const currentDevice = (kind: 'audio' | 'video'): string | undefined =>
      room?.localMedia
        ?.getTracks()
        .find((t) => t.kind === kind && t.readyState === 'live')
        ?.getSettings().deviceId;

    const addSelect = (title: string, kind: MediaDeviceKind, active: 'audio' | 'video', onPick: (id: string) => void) => {
      const wrap = document.createElement('label');
      wrap.className = 'kapi-device';
      wrap.append(document.createTextNode(title));
      const sel = document.createElement('select');
      const current = currentDevice(active);
      let foundCurrent = false;
      for (const d of devices.filter((x) => x.kind === kind)) {
        const opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || `${title} ${sel.options.length + 1}`;
        if (d.deviceId === current) {
          opt.selected = true;
          foundCurrent = true;
        }
        sel.appendChild(opt);
      }
      if (!foundCurrent && sel.options.length) sel.selectedIndex = 0;
      // Nothing to pick — name the absence instead of rendering a dead dropdown.
      if (!sel.options.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.disabled = true;
        opt.selected = true;
        opt.textContent = kind === 'audioinput' ? labels.noMic : labels.noCam;
        sel.appendChild(opt);
      }
      sel.addEventListener('change', () => onPick(sel.value));
      wrap.appendChild(sel);
      settingsEl.appendChild(wrap);
    };

    addSelect('Microphone', 'audioinput', 'audio', (id) => {
      room?.switchDevice('audioinput', id).catch(reportError);
    });
    addSelect('Camera', 'videoinput', 'video', (id) => {
      room?.switchDevice('videoinput', id).catch(reportError);
    });
  }

  function makeButton(id: ToolbarButton, text: string, onClick: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.id = id;
    paintButton(b, id, text, 'on');
    b.addEventListener('click', () => {
      unlockSound();
      onClick();
    });
    return b;
  }

  // ---------- lifecycle ----------

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(toastTimer);
    clearInterval(frameWatchdog);
    for (const tile of tiles.values()) {
      if (tile.frameHandle !== null) tile.video.cancelVideoFrameCallback(tile.frameHandle);
    }
    unsubs.forEach((u) => u());
    unsubs.length = 0;
    for (const audio of remoteAudio.values()) {
      audio.srcObject = null;
      audio.remove();
    }
    remoteAudio.clear();
    remoteStreams.clear();
    pendingShareState.clear();
    tiles.clear();
    const r = room;
    room = null;
    void r?.hangup();
    root.remove();
    // Single dispatch point: the toolbar button and an external room.hangup()
    // (via the 'hangup' listener below) both funnel through dispose().
    options.onHangup?.();
  };

  const actions: Record<ToolbarButton, () => void> = {
    mic: () => {
      if (!room) return;
      // No hardware → say so instead of flipping a state that changes nothing.
      if (deviceMissing.mic) {
        showToast(labels.noMic);
        return;
      }
      room.setMic(!room.micOn);
      updateToolbarLabels();
    },
    cam: () => {
      if (!room) return;
      if (deviceMissing.cam) {
        showToast(labels.noCam);
        return;
      }
      room.setCam(!room.camOn);
      updateToolbarLabels();
    },
    share: () => {
      if (!room) return;
      room
        .shareScreen(!room.sharing)
        .catch(reportError)
        .finally(updateToolbarLabels);
    },
    react: () => toggleReactions(),
    participants: () => {
      const opening = pane.classList.contains('hidden');
      if (opening) renderParticipants();
      showPanel('participants', opening);
    },
    layout: () => {
      setLayout(LAYOUTS[(LAYOUTS.indexOf(layoutMode) + 1) % LAYOUTS.length]!);
    },
    background: () => {
      if (!room) return;
      // Compositing needs camera frames — with no camera, say so like mic/cam
      // instead of spinning up a segmenter on an audio-only fallback stream.
      if (deviceMissing.cam) {
        showToast(labels.noCam);
        return;
      }
      const modes: Array<'none' | 'blur' | 'remove'> = ['none', 'blur', 'remove'];
      const cur = typeof bgMode === 'string' ? bgMode : 'none';
      const idx = Math.max(0, modes.indexOf(cur as 'none' | 'blur' | 'remove'));
      bgMode = modes[(idx + 1) % modes.length]!;
      room.setBackground(bgMode).catch(reportError);
    },
    settings: () => void showSettings(),
    hangup: () => dispose(),
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

  // Wire UI events before announce so a sync `peers` roster is not missed.
  void KapiRoom.join({ ...options, autoJoin: false })
    .then((r) => {
      if (disposed) {
        void r.hangup();
        return;
      }
      room = r;
      options.onReady?.(r);
      updateToolbarLabels();
      void refreshDeviceAvailability();
      if (r.localMedia) attachLocalStream(r.localMedia);

      unsubs.push(
        r.on('local-stream', ({ stream }) => attachLocalStream(stream)),
        r.on('peer-joined', ({ peerId, displayName }) => {
          ensureTile(peerId, displayName ?? peerId);
          renderParticipants();
        }),
        r.on('peer-left', ({ peerId }) => {
          removeTile(peerId);
          renderParticipants();
        }),
        r.on('track', ({ peerId, track }) => attachRemoteTrack(peerId, track)),
        r.on('reaction', ({ emoji }) => spawnReactionFloat(emoji)),
        r.on('media-state', ({ peerId, sharing }) => {
          const tile = tiles.get(peerId);
          if (!tile) {
            // Share state raced ahead of presence (e.g. targeted resend for a
            // late joiner landed before its tile was built) — stash it;
            // ensureTile applies it as soon as the tile exists.
            pendingShareState.set(peerId, sharing);
            return;
          }
          if (tile.wrap.classList.contains('screenshare') === sharing) return;
          tile.wrap.classList.toggle('screenshare', sharing);
          applyLayout();
        }),
        r.on('peer-state', ({ peerId, state }) => {
          const tile = tiles.get(peerId);
          if (!tile) return;
          tile.conn.dataset.state = state;
          tile.conn.title = state;
        }),
        r.on('error', ({ error }) => reportError(error)),
        // External hangup (API, unload hook) also tears the UI down;
        // dispose() is the single onHangup dispatch point.
        r.on('hangup', () => dispose()),
      );

      if (options.autoJoin !== false) r.announce();
    })
    .catch((err) => {
      reportError(err);
    });

  return {
    get room() {
      return room;
    },
    get layout() {
      return layoutMode;
    },
    setLayout,
    dispose,
  };
}
