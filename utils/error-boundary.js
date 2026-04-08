import { showError } from './toast.js';

/**
 * Wrap feature operations and normalize user-facing errors.
 */
export async function withFeatureError(featureName, fn, options = {}) {
  const {
    fallback = null,
    showToast = true,
    logToConsole = true
  } = options;

  try {
    return await fn();
  } catch (err) {
    if (logToConsole) {
      console.error(`[${featureName}] Error:`, err);
    }

    if (showToast) {
      const isQuota = err?.name === 'QuotaExceededError';
      const isAbort = err?.name === 'AbortError';
      const isCancelled = err?.message === 'USER_CANCELLED';

      if (isCancelled) {
        // Deliberate cancel: no toast.
      } else if (isQuota) {
        showError('Storage is full. Free space or clear old app data.');
      } else if (isAbort) {
        showError(`Operation canceled: ${featureName}`);
      } else if (err?.userMessage) {
        showError(err.userMessage);
      } else {
        showError(`Error in ${featureName}. Please try again.`);
      }
    }

    return fallback;
  }
}

/**
 * Managed worker helper with request/response lifecycle control.
 */
export class ManagedWorker {
  constructor(url, options = {}) {
    this._url = url;
    this._options = options;
    this._worker = null;
    this._pending = new Map();
    this._msgId = 0;
    this._onProgress = null;
  }

  get isActive() {
    return this._worker !== null;
  }

  start() {
    if (this._worker) return this;
    this._worker = new Worker(this._url, this._options);

    this._worker.onmessage = (e) => {
      const message = e.data || {};
      const { id, type } = message;
      const pending = id ? this._pending.get(id) : null;

      if (pending) {
        const isError = pending.errorTypes.includes(type);
        const isProgress = pending.progressTypes.includes(type);
        const isResolve = pending.resolveTypes
          ? pending.resolveTypes.includes(type)
          : (!isError && !isProgress);

        if (isProgress) {
          if (this._onProgress) this._onProgress(message);
          return;
        }

        if (isError) {
          this._pending.delete(id);
          pending.reject(
            Object.assign(
              new Error(message?.error || message?.payload?.message || 'Worker error'),
              { data: message }
            )
          );
          return;
        }

        if (isResolve) {
          this._pending.delete(id);
          pending.resolve(message);
          return;
        }

        if (this._onProgress) this._onProgress(message);
        return;
      }

      if (type === 'PROGRESS' && this._onProgress) {
        this._onProgress(message);
      }
    };

    this._worker.onerror = (e) => {
      const error = new Error(`Worker crashed: ${e.message}`);
      for (const { reject } of this._pending.values()) {
        reject(error);
      }
      this._pending.clear();
      this._worker = null;
    };

    return this;
  }

  onProgress(callback) {
    this._onProgress = callback;
    return this;
  }

  send(type, payload = {}, options = {}) {
    if (!this._worker) this.start();

    return new Promise((resolve, reject) => {
      const id = ++this._msgId;
      this._pending.set(id, {
        resolve,
        reject,
        resolveTypes: options.resolveTypes || null,
        progressTypes: options.progressTypes || ['PROGRESS'],
        errorTypes: options.errorTypes || ['ERROR']
      });
      this._worker.postMessage({ id, type, ...payload });
    });
  }

  terminate() {
    if (!this._worker) return;
    this._worker.terminate();
    const error = new Error('Worker terminated');
    for (const { reject } of this._pending.values()) {
      reject(error);
    }
    this._pending.clear();
    this._worker = null;
  }
}

