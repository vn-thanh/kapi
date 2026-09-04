import type { ConnectionQuality, KapiConnectionQualityThresholds } from '../types';

export const DEFAULT_QUALITY_THRESHOLDS: Required<KapiConnectionQualityThresholds> = {
  excellentLoss: 0.02,
  goodLoss: 0.08,
  excellentRtt: 0.15,
  goodRtt: 0.4,
};

export type QualitySample = {
  loss: number | null;
  rtt: number | null;
  connectionState: RTCPeerConnectionState;
};

/**
 * Map inbound loss + RTT (+ PC state) to a Zoom/Meet-style quality level.
 * Missing stats while connected → `'unknown'` (not `'lost'`).
 */
export function scoreConnectionQuality(
  sample: QualitySample,
  thresholds: Required<KapiConnectionQualityThresholds> = DEFAULT_QUALITY_THRESHOLDS,
): ConnectionQuality {
  const { connectionState: state, loss, rtt } = sample;
  if (state === 'failed' || state === 'closed' || state === 'disconnected') return 'lost';
  if (state !== 'connected') return 'unknown';
  if (loss === null && rtt === null) return 'unknown';

  const lossBad =
    loss !== null && loss >= thresholds.goodLoss
      ? 'poor'
      : loss !== null && loss >= thresholds.excellentLoss
        ? 'good'
        : 'excellent';
  const rttBad =
    rtt !== null && rtt >= thresholds.goodRtt
      ? 'poor'
      : rtt !== null && rtt >= thresholds.excellentRtt
        ? 'good'
        : 'excellent';

  const rank = { excellent: 0, good: 1, poor: 2, lost: 3, unknown: 1 } as const;
  const a = loss === null ? 'excellent' : lossBad;
  const b = rtt === null ? 'excellent' : rttBad;
  return rank[a] >= rank[b] ? a : b;
}

/** Read loss / RTT from a peer connection's getStats report. */
export async function readQualitySample(pc: RTCPeerConnection): Promise<QualitySample> {
  const connectionState = pc.connectionState;
  let packetsReceived = 0;
  let packetsLost = 0;
  let rtt: number | null = null;

  try {
    const stats = await pc.getStats();
    stats.forEach((r) => {
      const rep = r as {
        type?: string;
        packetsReceived?: number;
        packetsLost?: number;
        currentRoundTripTime?: number;
        nominated?: boolean;
        state?: string;
      };
      if (rep.type === 'inbound-rtp') {
        if (typeof rep.packetsReceived === 'number') packetsReceived += rep.packetsReceived;
        if (typeof rep.packetsLost === 'number') packetsLost += Math.max(0, rep.packetsLost);
      }
      if (
        rep.type === 'candidate-pair' &&
        (rep.nominated === true || rep.state === 'succeeded') &&
        typeof rep.currentRoundTripTime === 'number'
      ) {
        rtt =
          rtt === null
            ? rep.currentRoundTripTime
            : Math.min(rtt, rep.currentRoundTripTime);
      }
    });
  } catch {
    return { loss: null, rtt: null, connectionState };
  }

  const total = packetsReceived + packetsLost;
  const loss = total > 0 ? packetsLost / total : null;
  return { loss, rtt, connectionState };
}
