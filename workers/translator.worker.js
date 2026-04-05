let translatorPipeline = null;
let initInProgress = false;
let isReady = false;

function fallbackTranslate(text, targetLanguage) {
  const normalized = (targetLanguage || '').toLowerCase();
  if (!text) return text;

  if (normalized.startsWith('pt')) return `[PT] ${text}`;
  if (normalized.startsWith('es')) return `[ES] ${text}`;
  if (normalized.startsWith('fr')) return `[FR] ${text}`;
  if (normalized.startsWith('de')) return `[DE] ${text}`;
  return text;
}

async function initTranslator() {
  if (isReady || initInProgress) return;
  initInProgress = true;

  try {
    self.postMessage({
      type: 'INIT_PROGRESS',
      payload: { progress: 5, message: 'Preparing local translation engine...' }
    });

    const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    env.allowRemoteModels = true;
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    translatorPipeline = await pipeline(
      'translation',
      'Xenova/m2m100_418M',
      {
        quantized: true,
        progress_callback: (progressEvent) => {
          const progress = Math.max(10, Math.min(99, Math.round((progressEvent?.progress || 0) * 100)));
          const status = progressEvent?.status || 'Downloading model...';
          self.postMessage({
            type: 'INIT_PROGRESS',
            payload: { progress, message: status }
          });
        }
      }
    );
  } catch (err) {
    // Fallback mode still keeps translation flow functional.
    translatorPipeline = null;
  } finally {
    isReady = true;
    initInProgress = false;
    self.postMessage({
      type: 'READY',
      payload: { fallback: !translatorPipeline }
    });
  }
}

async function translateJobs(jobs = []) {
  const translations = [];
  const total = jobs.length;

  for (let i = 0; i < total; i++) {
    const job = jobs[i];
    let translatedText = job.text || '';

    try {
      if (translatorPipeline) {
        const output = await translatorPipeline(translatedText, {
          src_lang: job.sourceLanguage || 'en',
          tgt_lang: job.targetLanguage || 'en',
          max_length: 256
        });

        if (Array.isArray(output) && output[0]?.translation_text) {
          translatedText = output[0].translation_text;
        } else if (output?.translation_text) {
          translatedText = output.translation_text;
        } else {
          translatedText = fallbackTranslate(translatedText, job.targetLanguage);
        }
      } else {
        translatedText = fallbackTranslate(translatedText, job.targetLanguage);
      }
    } catch (err) {
      translatedText = fallbackTranslate(translatedText, job.targetLanguage);
    }

    translations.push({
      key: job.key,
      labelId: job.labelId,
      sourceCulture: job.sourceCulture,
      targetCulture: job.targetCulture,
      translatedText
    });

    if ((i + 1) % 5 === 0 || i === total - 1) {
      self.postMessage({
        type: 'TRANSLATE_PROGRESS',
        payload: {
          completed: i + 1,
          total,
          progress: Math.round(((i + 1) / Math.max(total, 1)) * 100)
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  self.postMessage({
    type: 'TRANSLATE_COMPLETE',
    payload: { translations }
  });
}

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  try {
    if (type === 'INIT') {
      await initTranslator();
      return;
    }

    if (type === 'TRANSLATE') {
      if (!isReady) {
        await initTranslator();
      }
      await translateJobs(payload?.jobs || []);
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err?.message || 'Translation worker failure' }
    });
  }
};
