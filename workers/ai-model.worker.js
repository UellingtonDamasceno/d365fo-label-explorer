/**
 * AI Model Worker - Real Transformers.js download with actual progress
 * This worker handles the REAL model download using Transformers.js library.
 */

let modelPipeline = null;
let downloadInProgress = false;

async function clearLikelyAiCaches() {
  if ('caches' in self) {
    const keys = await caches.keys();
    const candidates = keys.filter((key) =>
      /transformers|huggingface|xenova|onnx|model/i.test(key)
    );
    await Promise.all(candidates.map((key) => caches.delete(key)));
  }

  if (
    'indexedDB' in self &&
    self.indexedDB &&
    typeof self.indexedDB.databases === 'function'
  ) {
    try {
      const dbs = await self.indexedDB.databases();
      const aiDbs = (dbs || []).filter((dbInfo) =>
        /transformers|huggingface|xenova|onnx|hf[\-_]/i.test(dbInfo?.name || '')
      );

      await Promise.all(aiDbs.map((dbInfo) => new Promise((resolve) => {
        const req = self.indexedDB.deleteDatabase(dbInfo.name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      })));
    } catch (err) {
      console.warn('[AI] Could not clear IndexedDB caches:', err?.message || err);
    }
  }
}

async function downloadModel() {
  if (downloadInProgress || modelPipeline) {
    if (modelPipeline) {
      self.postMessage({ type: 'READY' });
    }
    return;
  }

  downloadInProgress = true;

  try {
    self.postMessage({
      type: 'PROGRESS',
      payload: { progress: 2, phase: 'downloading' }
    });

    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    let lastReportedProgress = 0;
    let lastStatus = '';

    modelPipeline = await pipeline(
      'translation',
      'Xenova/m2m100_418M',
      {
        quantized: true,
        progress_callback: (progressEvent) => {
          const status = progressEvent?.status || '';
          const file = progressEvent?.file || '';
          let progress = 0;

          if (progressEvent?.progress !== undefined) {
            progress = Math.round(progressEvent.progress);
          } else if (status === 'done') {
            progress = 100;
          }

          // Show real file info if available
          let message = status;
          if (progressEvent.loaded && progressEvent.total) {
            const loadedMB = (progressEvent.loaded / (1024 * 1024)).toFixed(1);
            const totalMB = (progressEvent.total / (1024 * 1024)).toFixed(1);
            message = `${status} (${loadedMB}MB / ${totalMB}MB)`;
          }

          // Only move to indexing when actually loading the model into ONNX
          const phase = (status === 'initiate' || status === 'downloading' || status === 'progress') 
            ? 'downloading' 
            : 'indexing';

          // Avoid spamming identical progress updates unless status changes
          if (progress > lastReportedProgress || status !== lastStatus) {
            lastReportedProgress = progress;
            lastStatus = status;

            self.postMessage({
              type: 'PROGRESS',
              payload: { 
                progress, 
                phase, 
                file, 
                status,
                message
              }
            });
          }
        }
      }
    );

    downloadInProgress = false;
    self.postMessage({ type: 'READY' });

  } catch (err) {
    downloadInProgress = false;
    modelPipeline = null;
    self.postMessage({
      type: 'ERROR',
      payload: { message: err?.message || 'Failed to download AI model' }
    });
  }
}

self.onmessage = async (event) => {
  const { type } = event.data || {};

  try {
    if (type === 'DOWNLOAD_MODEL') {
      await downloadModel();
      return;
    }

    if (type === 'CLEAR_CACHE') {
      modelPipeline = null;
      downloadInProgress = false;
      await clearLikelyAiCaches();
      self.postMessage({ type: 'CACHE_CLEARED' });
      return;
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err?.message || 'Unknown AI worker error' }
    });
  }
};
