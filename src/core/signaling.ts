import type { SignalAdapter, SignalMessage } from '../types';

/** Tiny in-process bus for demos / tests (same-page peers). */
export function createLocalSignalBus(): {
  createAdapter(peerId: string): SignalAdapter;
} {
  const listeners = new Map<string, Set<(msg: SignalMessage) => void>>();
  const roster = new Map<string, string | undefined>();

  return {
    createAdapter(peerId: string): SignalAdapter {
      if (!listeners.has(peerId)) listeners.set(peerId, new Set());
      return {
        send(msg) {
          const withFrom =
            msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice'
              ? { ...msg, from: peerId }
              : msg;

          if (msg.type === 'join') {
            roster.set(peerId, msg.displayName);
            // Snapshot for the joiner (full mesh: joiner offers to existing).
            const peers = [...roster.entries()]
              .filter(([id]) => id !== msg.peerId)
              .map(([id, displayName]) => ({ peerId: id, displayName }));
            if (peers.length) {
              listeners.get(msg.peerId)?.forEach((fn) => fn({ type: 'peers', peers }));
            }
          }
          if (msg.type === 'leave') roster.delete(msg.peerId);

          if ('to' in withFrom && withFrom.to) {
            listeners.get(withFrom.to)?.forEach((fn) => fn(withFrom));
            return;
          }

          for (const [id, set] of listeners) {
            if (id === peerId) continue;
            set.forEach((fn) => fn(withFrom));
          }
        },
        onMessage(fn) {
          listeners.get(peerId)!.add(fn);
          return () => listeners.get(peerId)?.delete(fn);
        },
      };
    },
  };
}

/** Cross-tab signaling via BroadcastChannel (examples). */
export function createBroadcastSignalAdapter(
  channelName: string,
  peerId: string,
): SignalAdapter {
  const bc = new BroadcastChannel(channelName);
  const handlers = new Set<(msg: SignalMessage) => void>();
  /** Other peers we have seen in this channel. */
  const roster = new Map<string, string | undefined>();
  let myDisplayName: string | undefined;

  const deliver = (msg: SignalMessage) => {
    handlers.forEach((fn) => fn(msg));
  };

  bc.onmessage = (ev) => {
    const msg = ev.data as SignalMessage & { _from?: string; _to?: string };
    if (msg._from === peerId) return;
    if (msg._to && msg._to !== peerId) return;
    if ('to' in msg && msg.to && msg.to !== peerId) return;

    if (msg.type === 'join') {
      roster.set(msg.peerId, msg.displayName);
      // Each live tab introduces ITSELF to the joiner, who then offers.
      // Previously every tab forwarded its whole cached roster — crashed tabs
      // never send `leave` on BroadcastChannel, so ghosts accumulated and each
      // new joiner wasted offer/ICE attempts on dead peer ids.
      bc.postMessage({
        type: 'peers',
        peers: [{ peerId, displayName: myDisplayName }],
        _from: peerId,
        _to: msg.peerId,
      });
    } else if (msg.type === 'leave') {
      roster.delete(msg.peerId);
    }

    const { _from, _to, ...rest } = msg as SignalMessage & { _from?: string; _to?: string };
    void _from;
    void _to;
    deliver(rest);
  };

  return {
    send(msg) {
      if (msg.type === 'join') myDisplayName = msg.displayName;
      const withFrom =
        msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice'
          ? { ...msg, from: peerId, _from: peerId }
          : { ...msg, _from: peerId };
      bc.postMessage(withFrom);
    },
    onMessage(fn) {
      handlers.add(fn);
      return () => handlers.delete(fn);
    },
  };
}
