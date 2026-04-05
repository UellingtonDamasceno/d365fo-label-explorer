let downloadTimer = null;

function stopDownloadTimer() {
  if (downloadTimer) {
    clearInterval(downloadTimer);
    downloadTimer = null;
  }
}

async function clearLikelyAiCaches() {
  if (!('caches' in self)) return;

  const keys = await caches.keys();
  const candidates = keys.filter((key) =>
    /transformers|huggingface|xenova|onnx|model/i.test(key)
  );

  await Promise.all(candidates.map((key) => caches.delete(key)));
}

function runBackgroundModelPreparation() {
  stopDownloadTimer();

  let progress = 0;
  downloadTimer = setInterval(() => {
    // Faster progress at beginning, slower near the end to emulate indexing.
    const step = progress < 70 ? 6 : progress < 90 ? 3 : 1;
    progress = Math.min(100, progress + step);

    self.postMessage({
      type: 'PROGRESS',
      payload: {
        progress,
        phase: progress >= 90 ? 'indexing' : 'downloading'
      }
    });

    if (progress >= 100) {
      stopDownloadTimer();
      self.postMessage({ type: 'READY' });
    }
  }, 220);
}

self.onmessage = async (event) => {
  const { type } = event.data || {};

  try {
    if (type === 'DOWNLOAD_MODEL') {
      runBackgroundModelPreparation();
      return;
    }

    if (type === 'CLEAR_CACHE') {
      stopDownloadTimer();
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
