let translatorPipeline = null;
let initInProgress = false;
let isReady = false;

/**
 * Map D365FO culture codes to M2M100 language codes.
 * M2M100 uses ISO 639-1 codes, not full locales.
 */
const LOCALE_TO_M2M100 = {
  'en-us': 'en',
  'en-gb': 'en',
  'pt-br': 'pt',
  'pt-pt': 'pt',
  'es-es': 'es',
  'es-mx': 'es',
  'fr-fr': 'fr',
  'fr-ca': 'fr',
  'de-de': 'de',
  'de-at': 'de',
  'it-it': 'it',
  'nl-nl': 'nl',
  'ru-ru': 'ru',
  'zh-cn': 'zh',
  'zh-hans': 'zh',
  'zh-tw': 'zh',
  'zh-hant': 'zh',
  'ja-jp': 'ja',
  'ko-kr': 'ko',
  'ar-sa': 'ar',
  'pl-pl': 'pl',
  'tr-tr': 'tr',
  'sv-se': 'sv',
  'da-dk': 'da',
  'fi-fi': 'fi',
  'nb-no': 'no',
  'nn-no': 'no'
};

function mapLocaleToM2M100(locale) {
  if (!locale) return 'en';
  const normalized = locale.toLowerCase().trim();

  // Direct match
  if (LOCALE_TO_M2M100[normalized]) {
    return LOCALE_TO_M2M100[normalized];
  }

  // Try first part only (e.g., 'en' from 'en-US')
  const shortCode = normalized.split('-')[0];
  if (shortCode && shortCode.length === 2) {
    return shortCode;
  }

  return 'en';
}

async function initTranslator(requestId = null) {
  if (isReady) {
    self.postMessage({
      type: 'READY',
      ...(requestId != null ? { id: requestId } : {}),
      payload: { fallback: !translatorPipeline }
    });
    return;
  }

  if (initInProgress) {
    while (initInProgress) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    self.postMessage({
      type: 'READY',
      ...(requestId != null ? { id: requestId } : {}),
      payload: { fallback: !translatorPipeline }
    });
    return;
  }

  initInProgress = true;

  try {
    self.postMessage({
      type: 'INIT_PROGRESS',
      ...(requestId != null ? { id: requestId } : {}),
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
            ...(requestId != null ? { id: requestId } : {}),
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
      ...(requestId != null ? { id: requestId } : {}),
      payload: { fallback: !translatorPipeline }
    });
  }
}

async function translateJobs(jobs = [], requestId = null) {
  const translations = [];
  const total = jobs.length;

  for (let i = 0; i < total; i++) {
    const job = jobs[i];
    let translatedText = job.text || '';
    let error = null;

    // Map locales to M2M100 codes
    const srcLang = mapLocaleToM2M100(job.sourceLanguage || job.sourceCulture);
    const tgtLang = mapLocaleToM2M100(job.targetLanguage || job.targetCulture);

    try {
      if (translatorPipeline && srcLang !== tgtLang) {
        const output = await translatorPipeline(translatedText, {
          src_lang: srcLang,
          tgt_lang: tgtLang,
          max_length: 256
        });

        if (Array.isArray(output) && output[0]?.translation_text) {
          translatedText = output[0].translation_text;
        } else if (output?.translation_text) {
          translatedText = output.translation_text;
        } else {
          // No output - mark as error, keep original
          error = 'no_output';
        }
      } else if (!translatorPipeline) {
        // Model not loaded - honest error
        error = 'model_not_ready';
      }
      // If srcLang === tgtLang, keep original text (no error)
    } catch (err) {
      // Real translation error - honest error reporting
      error = err?.message || 'translation_failed';
    }

    translations.push({
      key: job.key,
      labelId: job.labelId,
      sourceCulture: job.sourceCulture,
      targetCulture: job.targetCulture,
      translatedText,
      error
    });

    if ((i + 1) % 5 === 0 || i === total - 1) {
      self.postMessage({
        type: 'TRANSLATE_PROGRESS',
        ...(requestId != null ? { id: requestId } : {}),
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
    ...(requestId != null ? { id: requestId } : {}),
    payload: { translations }
  });
}

self.onmessage = async (event) => {
  const { type, payload, id } = event.data || {};

  try {
    if (type === 'INIT') {
      await initTranslator(id);
      return;
    }

    if (type === 'TRANSLATE') {
      if (!isReady) {
        await initTranslator(id);
      }
      await translateJobs(payload?.jobs || [], id);
    }
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      ...(id != null ? { id } : {}),
      payload: { message: err?.message || 'Translation worker failure' }
    });
  }
};
