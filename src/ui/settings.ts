import type { BackgroundMode, KapiLayout, KapiUiLabels } from '../types';
import type { PersistedBackgroundMode } from '../preferences/types';

export type SettingsTab = 'audio' | 'video' | 'effects' | 'general';

export type SettingsPanelCallbacks = {
  labels: Required<KapiUiLabels>;
  getRoom: () => {
    localMedia: MediaStream | null;
    switchDevice: (kind: 'audioinput' | 'videoinput', deviceId: string) => Promise<void>;
    setBackground: (mode: BackgroundMode) => Promise<void>;
    setBlurAmount?: (amount: number) => void;
  } | null;
  getBackground: () => BackgroundMode;
  getBlurAmount: () => number;
  getLayout: () => KapiLayout;
  getVideoFit: () => 'contain' | 'cover';
  getShortcuts: () => boolean;
  getAudioOutputId: () => string | undefined;
  /** When false, blur/remove/image controls are disabled (low-tier devices). */
  getBackgroundEffectsAllowed?: () => boolean;
  onDevicePick: (kind: 'audioinput' | 'videoinput', deviceId: string) => void;
  onAudioOutputPick: (deviceId: string) => void;
  onBackground: (mode: PersistedBackgroundMode) => void;
  onBackgroundImage: (file: File) => void;
  onBlurAmount: (amount: number) => void;
  onLayout: (layout: KapiLayout) => void;
  onVideoFit: (fit: 'contain' | 'cover') => void;
  onShortcuts: (on: boolean) => void;
  onError: (err: unknown) => void;
  onClose?: () => void;
};

export type SettingsPanel = {
  el: HTMLDivElement;
  toggle: () => Promise<void>;
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  /** Rebuild if the panel is currently visible (e.g. devicechange). */
  refreshIfOpen: () => Promise<void>;
};

function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

function currentTrackDevice(stream: MediaStream | null, kind: 'audio' | 'video'): string | undefined {
  return stream
    ?.getTracks()
    .find((t) => t.kind === kind && t.readyState === 'live')
    ?.getSettings().deviceId;
}

function setChipActive(el: Element, on: boolean) {
  el.classList.toggle('is-active', on);
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function markChipGroup(row: HTMLElement, active: Element | null, match?: (el: HTMLElement) => boolean) {
  for (const x of row.querySelectorAll('.kapi-settings-chip')) {
    const on = match ? match(x as HTMLElement) : x === active;
    setChipActive(x, on);
  }
}

/**
 * Zoom/Meet-style settings: tabbed Audio / Video / Effects / General.
 * Built once into `el`; content is rebuilt when opened so device lists stay fresh.
 */
export function createSettingsPanel(cb: SettingsPanelCallbacks): SettingsPanel {
  const el = document.createElement('div');
  el.className = 'kapi-panel kapi-settings hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', cb.labels.settings);
  el.setAttribute('aria-modal', 'true');

  let activeTab: SettingsTab = 'audio';
  let rendering = false;

  function isOpen() {
    return !el.classList.contains('hidden');
  }

  function close() {
    el.classList.add('hidden');
  }

  async function render() {
    if (rendering) return;
    rendering = true;
    try {
      let devices: MediaDeviceInfo[] = [];
      try {
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (err) {
        cb.onError(err);
        return;
      }

      const room = cb.getRoom();
      el.replaceChildren();

      // ---- header ----
      const header = document.createElement('div');
      header.className = 'kapi-settings-header';
      const title = document.createElement('h3');
      title.id = 'kapi-settings-title';
      title.textContent = cb.labels.settings;
      el.setAttribute('aria-labelledby', title.id);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'kapi-settings-close';
      closeBtn.setAttribute('aria-label', cb.labels.settingsClose);
      closeBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      closeBtn.addEventListener('click', () => {
        close();
        cb.onClose?.();
      });
      header.append(title, closeBtn);
      el.appendChild(header);

      // ---- tabs ----
      const tabs = document.createElement('div');
      tabs.className = 'kapi-settings-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', cb.labels.settings);

      const body = document.createElement('div');
      body.className = 'kapi-settings-body';

      const tabDefs: { id: SettingsTab; label: string }[] = [
        { id: 'audio', label: cb.labels.settingsAudio },
        { id: 'video', label: cb.labels.settingsVideo },
        { id: 'effects', label: cb.labels.settingsEffects },
        { id: 'general', label: cb.labels.settingsGeneral },
      ];

      const panels = new Map<SettingsTab, HTMLDivElement>();

      for (const def of tabDefs) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'kapi-settings-tab';
        tab.setAttribute('role', 'tab');
        tab.dataset.tab = def.id;
        tab.id = `kapi-tab-${def.id}`;
        tab.textContent = def.label;
        tab.setAttribute('aria-selected', def.id === activeTab ? 'true' : 'false');
        tab.tabIndex = def.id === activeTab ? 0 : -1;
        tab.addEventListener('click', () => {
          activeTab = def.id;
          for (const t of tabs.querySelectorAll<HTMLButtonElement>('.kapi-settings-tab')) {
            const on = t.dataset.tab === activeTab;
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
          }
          for (const [id, panel] of panels) {
            panel.hidden = id !== activeTab;
          }
        });
        tabs.appendChild(tab);

        const panel = document.createElement('div');
        panel.className = 'kapi-settings-pane';
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        panel.hidden = def.id !== activeTab;
        panels.set(def.id, panel);
        body.appendChild(panel);
      }

      el.append(tabs, body);

      const addSelect = (
        panel: HTMLElement,
        title: string,
        kind: MediaDeviceKind,
        selectedId: string | undefined,
        emptyLabel: string,
        onPick: (id: string) => void,
      ) => {
        const wrap = document.createElement('label');
        wrap.className = 'kapi-device';
        const caption = document.createElement('span');
        caption.className = 'kapi-device-label';
        caption.textContent = title;
        const sel = document.createElement('select');
        let found = false;
        for (const d of devices.filter((x) => x.kind === kind)) {
          const opt = document.createElement('option');
          opt.value = d.deviceId;
          opt.textContent = d.label || `${title} ${sel.options.length + 1}`;
          if (d.deviceId === selectedId) {
            opt.selected = true;
            found = true;
          }
          sel.appendChild(opt);
        }
        if (!found && sel.options.length) sel.selectedIndex = 0;
        if (!sel.options.length) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.disabled = true;
          opt.selected = true;
          opt.textContent = emptyLabel;
          sel.appendChild(opt);
          sel.disabled = true;
        }
        sel.addEventListener('change', () => {
          if (sel.value) onPick(sel.value);
        });
        wrap.append(caption, sel);
        panel.appendChild(wrap);
      };

      const addHint = (panel: HTMLElement, text: string) => {
        const p = document.createElement('p');
        p.className = 'kapi-settings-hint';
        p.textContent = text;
        panel.appendChild(p);
      };

      const addSegment = <T extends string>(
        panel: HTMLElement,
        label: string,
        choices: { id: T; label: string }[],
        selected: T,
        onPick: (id: T) => void,
      ) => {
        const wrap = document.createElement('div');
        wrap.className = 'kapi-settings-field';
        const caption = document.createElement('span');
        caption.className = 'kapi-device-label';
        caption.textContent = label;
        const row = document.createElement('div');
        row.className = 'kapi-settings-segment';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', label);
        for (const choice of choices) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'kapi-settings-chip';
          b.textContent = choice.label;
          setChipActive(b, selected === choice.id);
          b.addEventListener('click', () => {
            onPick(choice.id);
            markChipGroup(row, b);
          });
          row.appendChild(b);
        }
        wrap.append(caption, row);
        panel.appendChild(wrap);
      };

      // ---- Audio ----
      const audioPane = panels.get('audio')!;
      addSelect(
        audioPane,
        cb.labels.microphone,
        'audioinput',
        currentTrackDevice(room?.localMedia ?? null, 'audio'),
        cb.labels.noMic,
        (id) => {
          cb.onDevicePick('audioinput', id);
        },
      );
      if (supportsSinkId()) {
        addSelect(
          audioPane,
          cb.labels.speaker,
          'audiooutput',
          cb.getAudioOutputId(),
          cb.labels.noSpeaker,
          (id) => cb.onAudioOutputPick(id),
        );
      } else {
        addHint(audioPane, cb.labels.speakerUnsupported);
      }

      // ---- Video ----
      const videoPane = panels.get('video')!;
      addSelect(
        videoPane,
        cb.labels.camera,
        'videoinput',
        currentTrackDevice(room?.localMedia ?? null, 'video'),
        cb.labels.noCam,
        (id) => {
          cb.onDevicePick('videoinput', id);
        },
      );
      addSegment(
        videoPane,
        cb.labels.videoFit,
        [
          { id: 'contain' as const, label: cb.labels.videoFitContain },
          { id: 'cover' as const, label: cb.labels.videoFitCover },
        ],
        cb.getVideoFit(),
        (fit) => cb.onVideoFit(fit),
      );

      // ---- Effects ----
      const effectsPane = panels.get('effects')!;
      const bgLabel = document.createElement('span');
      bgLabel.className = 'kapi-device-label';
      bgLabel.textContent = cb.labels.background;
      effectsPane.appendChild(bgLabel);

      const bgRow = document.createElement('div');
      bgRow.className = 'kapi-settings-segment';
      bgRow.setAttribute('role', 'group');
      bgRow.setAttribute('aria-label', cb.labels.background);

      const bgMode = cb.getBackground();
      const activeBg = typeof bgMode === 'string' ? bgMode : 'image';
      const effectsAllowed = cb.getBackgroundEffectsAllowed?.() ?? true;

      const blurField = document.createElement('label');
      blurField.className = 'kapi-settings-field kapi-device';
      blurField.hidden = activeBg !== 'blur' || !effectsAllowed;

      const paintBgChips = (id: string) => {
        markChipGroup(bgRow, null, (x) => x.dataset.bg === id);
        blurField.hidden = id !== 'blur' || !effectsAllowed;
      };

      const addBgChip = (
        id: string,
        label: string,
        onClick: () => void,
        opts?: { paintOnClick?: boolean },
      ) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kapi-settings-chip';
        b.dataset.bg = id;
        b.textContent = label;
        setChipActive(b, activeBg === id);
        const heavy = id !== 'none';
        if (heavy && !effectsAllowed) {
          b.disabled = true;
          b.title = cb.labels.bgUnsupported;
        }
        b.addEventListener('click', () => {
          if (heavy && !effectsAllowed) return;
          onClick();
          if (opts?.paintOnClick !== false) paintBgChips(id);
        });
        bgRow.appendChild(b);
        return b;
      };

      addBgChip('none', cb.labels.bgNone, () => cb.onBackground('none'));
      addBgChip('blur', cb.labels.bgBlur, () => cb.onBackground('blur'));
      addBgChip('remove', cb.labels.bgRemove, () => cb.onBackground('remove'));

      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      // Activate only after a file is chosen (cancel leaves the prior mode).
      addBgChip('image', cb.labels.bgImage, () => file.click(), { paintOnClick: false });
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        cb.onBackgroundImage(f);
        paintBgChips('image');
      });
      bgRow.append(file);
      effectsPane.appendChild(bgRow);
      if (!effectsAllowed) {
        addHint(effectsPane, cb.labels.bgUnsupported);
      }

      const blurCaption = document.createElement('span');
      blurCaption.className = 'kapi-device-label';
      const blurValue = document.createElement('span');
      blurValue.className = 'kapi-settings-value';
      const amount = cb.getBlurAmount();
      blurValue.textContent = String(amount);
      blurCaption.append(document.createTextNode(cb.labels.blurAmount + ' '), blurValue);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '4';
      range.max = '32';
      range.step = '1';
      range.value = String(amount);
      range.addEventListener('input', () => {
        blurValue.textContent = range.value;
      });
      range.addEventListener('change', () => {
        cb.onBlurAmount(Number(range.value));
      });
      blurField.append(blurCaption, range);
      effectsPane.appendChild(blurField);

      // ---- General ----
      const generalPane = panels.get('general')!;
      addSegment(
        generalPane,
        cb.labels.defaultLayout,
        [
          { id: 'grid' as const, label: cb.labels.layoutGridShort },
          { id: 'spotlight' as const, label: cb.labels.layoutSpotlightShort },
          { id: 'sidebar' as const, label: cb.labels.layoutSidebarShort },
        ],
        cb.getLayout(),
        (layout) => cb.onLayout(layout),
      );

      const shortcutsRow = document.createElement('label');
      shortcutsRow.className = 'kapi-settings-toggle';
      const shortcutsCheck = document.createElement('input');
      shortcutsCheck.type = 'checkbox';
      shortcutsCheck.checked = cb.getShortcuts();
      shortcutsCheck.addEventListener('change', () => {
        cb.onShortcuts(shortcutsCheck.checked);
      });
      const shortcutsText = document.createElement('span');
      shortcutsText.textContent = cb.labels.shortcutsToggle;
      shortcutsRow.append(shortcutsCheck, shortcutsText);
      generalPane.appendChild(shortcutsRow);
      addHint(generalPane, cb.labels.shortcutsHint);
    } finally {
      rendering = false;
    }
  }

  async function open() {
    el.classList.remove('hidden');
    await render();
  }

  async function toggle() {
    if (isOpen()) {
      close();
      cb.onClose?.();
      return;
    }
    await open();
  }

  async function refreshIfOpen() {
    if (isOpen()) await render();
  }

  return { el, toggle, open, close, isOpen, refreshIfOpen };
}
