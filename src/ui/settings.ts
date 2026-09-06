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
  onDevicePick: (kind: 'audioinput' | 'videoinput', deviceId: string) => void;
  onAudioOutputPick: (deviceId: string) => void;
  onBackground: (mode: PersistedBackgroundMode) => void;
  onBackgroundImage: (file: File) => void;
  onBlurAmount: (amount: number) => void;
  onLayout: (layout: KapiLayout) => void;
  onVideoFit: (fit: 'contain' | 'cover') => void;
  onShortcuts: (on: boolean) => void;
  onError: (err: unknown) => void;
  onClose: () => void;
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

/**
 * Zoom/Meet-style settings: tabbed Audio / Video / Effects / General.
 * Built once into `el`; content is rebuilt when opened so device lists stay fresh.
 */
export function createSettingsPanel(cb: SettingsPanelCallbacks): SettingsPanel {
  const el = document.createElement('div');
  el.className = 'kapi-panel kapi-settings hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', cb.labels.settings);
  el.setAttribute('aria-modal', 'false');

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
        cb.onClose();
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

      const fitWrap = document.createElement('div');
      fitWrap.className = 'kapi-settings-field';
      const fitLabel = document.createElement('span');
      fitLabel.className = 'kapi-device-label';
      fitLabel.textContent = cb.labels.videoFit;
      const fitRow = document.createElement('div');
      fitRow.className = 'kapi-settings-segment';
      fitRow.setAttribute('role', 'group');
      fitRow.setAttribute('aria-label', cb.labels.videoFit);
      for (const fit of [
        { id: 'contain' as const, label: cb.labels.videoFitContain },
        { id: 'cover' as const, label: cb.labels.videoFitCover },
      ]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kapi-settings-chip';
        b.textContent = fit.label;
        b.setAttribute('aria-pressed', cb.getVideoFit() === fit.id ? 'true' : 'false');
        b.classList.toggle('is-active', cb.getVideoFit() === fit.id);
        b.addEventListener('click', () => {
          cb.onVideoFit(fit.id);
          for (const x of fitRow.querySelectorAll('.kapi-settings-chip')) {
            const on = x === b;
            x.classList.toggle('is-active', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        });
        fitRow.appendChild(b);
      }
      fitWrap.append(fitLabel, fitRow);
      videoPane.appendChild(fitWrap);

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

      const bgChoices: { id: string; label: string; apply: () => void }[] = [
        { id: 'none', label: cb.labels.bgNone, apply: () => cb.onBackground('none') },
        { id: 'blur', label: cb.labels.bgBlur, apply: () => cb.onBackground('blur') },
        { id: 'remove', label: cb.labels.bgRemove, apply: () => cb.onBackground('remove') },
      ];

      for (const choice of bgChoices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kapi-settings-chip';
        b.dataset.bg = choice.id;
        b.textContent = choice.label;
        b.classList.toggle('is-active', activeBg === choice.id);
        b.setAttribute('aria-pressed', activeBg === choice.id ? 'true' : 'false');
        b.addEventListener('click', () => {
          choice.apply();
          for (const x of bgRow.querySelectorAll('.kapi-settings-chip')) {
            const on = (x as HTMLElement).dataset.bg === choice.id;
            x.classList.toggle('is-active', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
          blurField.hidden = choice.id !== 'blur';
        });
        bgRow.appendChild(b);
      }

      const imgBtn = document.createElement('button');
      imgBtn.type = 'button';
      imgBtn.className = 'kapi-settings-chip';
      imgBtn.dataset.bg = 'image';
      imgBtn.textContent = cb.labels.bgImage;
      imgBtn.classList.toggle('is-active', activeBg === 'image');
      imgBtn.setAttribute('aria-pressed', activeBg === 'image' ? 'true' : 'false');
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      imgBtn.addEventListener('click', () => file.click());
      file.addEventListener('change', () => {
        const f = file.files?.[0];
        file.value = '';
        if (!f) return;
        cb.onBackgroundImage(f);
        for (const x of bgRow.querySelectorAll('.kapi-settings-chip')) {
          const on = (x as HTMLElement).dataset.bg === 'image';
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        blurField.hidden = true;
      });
      bgRow.append(imgBtn, file);
      effectsPane.appendChild(bgRow);

      const blurField = document.createElement('label');
      blurField.className = 'kapi-settings-field kapi-device';
      blurField.hidden = activeBg !== 'blur';
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
      const layoutField = document.createElement('div');
      layoutField.className = 'kapi-settings-field';
      const layoutCaption = document.createElement('span');
      layoutCaption.className = 'kapi-device-label';
      layoutCaption.textContent = cb.labels.defaultLayout;
      const layoutRow = document.createElement('div');
      layoutRow.className = 'kapi-settings-segment';
      layoutRow.setAttribute('role', 'group');
      const layouts: { id: KapiLayout; label: string }[] = [
        { id: 'grid', label: cb.labels.layoutGridShort },
        { id: 'spotlight', label: cb.labels.layoutSpotlightShort },
        { id: 'sidebar', label: cb.labels.layoutSidebarShort },
      ];
      for (const layout of layouts) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'kapi-settings-chip';
        b.textContent = layout.label;
        b.classList.toggle('is-active', cb.getLayout() === layout.id);
        b.setAttribute('aria-pressed', cb.getLayout() === layout.id ? 'true' : 'false');
        b.addEventListener('click', () => {
          cb.onLayout(layout.id);
          for (const x of layoutRow.querySelectorAll('.kapi-settings-chip')) {
            const on = x === b;
            x.classList.toggle('is-active', on);
            x.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        });
        layoutRow.appendChild(b);
      }
      layoutField.append(layoutCaption, layoutRow);
      generalPane.appendChild(layoutField);

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
      cb.onClose();
      return;
    }
    await open();
  }

  async function refreshIfOpen() {
    if (isOpen()) await render();
  }

  return { el, toggle, open, close, isOpen, refreshIfOpen };
}
