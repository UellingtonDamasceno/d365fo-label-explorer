const CHANNEL_NAME = 'd365fo-label-explorer-sync';

function createTabId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

class TabSync {
  constructor() {
    this._channel = null;
    this._handlers = new Map();
    this._tabId = createTabId();
    this._initChannel();
  }

  _initChannel() {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }

    try {
      this._channel = new BroadcastChannel(CHANNEL_NAME);
      this._channel.onmessage = (event) => {
        const payload = event?.data || {};
        const { type, sourceTabId } = payload;
        if (!type || sourceTabId === this._tabId) return;

        const handlers = this._handlers.get(type);
        if (!handlers || handlers.size === 0) return;
        handlers.forEach((handler) => handler(payload));
      };
    } catch (err) {
      console.warn('[TabSync] BroadcastChannel initialization failed:', err?.message || err);
      this._channel = null;
    }
  }

  on(type, handler) {
    if (!this._handlers.has(type)) {
      this._handlers.set(type, new Set());
    }
    this._handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this._handlers.get(type)?.delete(handler);
  }

  emit(type, data = {}) {
    if (!this._channel) return;
    this._channel.postMessage({
      type,
      sourceTabId: this._tabId,
      timestamp: Date.now(),
      ...data
    });
  }
}

export const tabSync = new TabSync();
