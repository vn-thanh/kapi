import type { SignalAdapter, SignalMessage } from '../types';

/** Tiny in-process bus for demos / tests (same-page peers). */
export function createLocalSignalBus(): {
  createAdapter(peerId: string): SignalAdapter;
} {
  const listeners = new Map<string, Set<(msg: SignalMessage) => void>>();

  return {
    createAdapter(peerId: string): SignalAdapter {
      if (!listeners.has(peerId)) listeners.set(peerId, new Set());
      return {
        send(msg) {
          const withFrom =
            msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice'
              ? { ...msg, from: peerId }
              : msg;

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

  bc.onmessage = (ev) => {
    const msg = ev.data as SignalMessage & { _from?: string };
    if (msg._from === peerId) return;
    if ('to' in msg && msg.to && msg.to !== peerId) return;
    const { _from, ...rest } = msg as SignalMessage & { _from?: string };
    void _from;
    handlers.forEach((fn) => fn(rest));
  };

  return {
    send(msg) {
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
