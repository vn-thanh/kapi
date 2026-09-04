export async function getLocalStream(
  media: { audio?: boolean | MediaTrackConstraints; video?: boolean | MediaTrackConstraints },
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: media.audio ?? true,
    video: media.video ?? true,
  });
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
