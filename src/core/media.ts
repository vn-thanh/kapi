function isNotAllowed(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

function isDeviceMissing(err: unknown): boolean {
  if (!(err instanceof DOMException) && !(err instanceof Error)) return false;
  const name = 'name' in err ? String((err as DOMException).name) : '';
  const msg = err.message.toLowerCase();
  return (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError' ||
    msg.includes('requested device not found') ||
    msg.includes('device not found')
  );
}

/**
 * Request A/V with graceful fallbacks when a device is missing
 * (common NotFoundError: "Requested device not found").
 */
export async function getLocalStream(
  media: { audio?: boolean | MediaTrackConstraints; video?: boolean | MediaTrackConstraints },
): Promise<MediaStream> {
  const audio = media.audio === undefined ? true : media.audio;
  const video = media.video === undefined ? true : media.video;

  if (audio === false && video === false) {
    return new MediaStream();
  }

  const attempts: MediaStreamConstraints[] = [];
  const push = (a: boolean | MediaTrackConstraints, v: boolean | MediaTrackConstraints) => {
    if (a === false && v === false) return;
    attempts.push({ audio: a, video: v });
  };

  push(audio, video);
  if (audio !== false && video !== false) {
    push(audio, false);
    push(false, video);
    push(true, false);
    push(false, true);
  }

  let lastError: unknown;
  const seen = new Set<string>();
  for (const constraints of attempts) {
    const key = JSON.stringify(constraints);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      if (isNotAllowed(err)) throw err;
      if (!isDeviceMissing(err)) {
        // Unknown error — still try softer fallbacks once, then empty stream
        continue;
      }
    }
  }

  console.warn('[kapi] getUserMedia failed, joining without local A/V', lastError);
  return new MediaStream();
}

export async function getDisplayStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
}

export async function listDevices(): Promise<MediaDeviceInfo[]> {
  return navigator.mediaDevices.enumerateDevices();
}

export async function applyVideoCodecPreference(
  pc: RTCPeerConnection,
  mimeType: string,
): Promise<void> {
  const caps = RTCRtpSender.getCapabilities?.('video');
  if (!caps) return;
  const preferred = caps.codecs.filter((c) => c.mimeType.toLowerCase() === mimeType.toLowerCase());
  const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== mimeType.toLowerCase());
  if (!preferred.length) return;
  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind === 'video' || t.receiver.track?.kind === 'video') {
      try {
        t.setCodecPreferences([...preferred, ...rest]);
      } catch {
        /* unsupported */
      }
    }
  }
}

export async function applyMaxBitrate(pc: RTCPeerConnection, maxBitrate: number): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'video') continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    for (const enc of params.encodings) enc.maxBitrate = maxBitrate;
    try {
      await sender.setParameters(params);
    } catch {
      /* ignore */
    }
  }
}
