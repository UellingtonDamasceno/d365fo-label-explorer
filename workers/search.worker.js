/**
 * Search Worker for D365FO Label Explorer
 * Centralized Architecture: Requests data from main thread to avoid DB locks.
 */

const pendingRequests = new Map();
let requestIdCounter = 0;

/**
 * Request data from main thread (which proxy to db.worker.js)
 */
async function requestFromDB(type, payload = {}) {
    const id = ++requestIdCounter;
    return new Promise((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
        self.postMessage({ type: 'DB_REQUEST', id, requestType: type, payload });
    });
}

/**
 * Search Logic
 */
function normalizeFilterArray(value) {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
}

async function searchIndexedDB(query, options = {}) {
  const { limit = 50, exactMatch = false, offset = 0 } = options;
  const lowerQuery = query?.toLowerCase() || '';
  const cultures = normalizeFilterArray(options.cultures || options.culture);
  const models = normalizeFilterArray(options.models || options.model);

  return await requestFromDB('searchLabels', {
    query: lowerQuery,
    exactMatch,
    limit,
    offset,
    cultures,
    models
  });
}

self.onmessage = async (e) => {
  const { type, id, query, options, payload } = e.data;

  // Handle DB response from main thread
  if (type === 'DB_RESPONSE') {
      const pending = pendingRequests.get(id);
      if (pending) {
          pendingRequests.delete(id);
          if (e.data.error) pending.reject(new Error(e.data.error));
          else pending.resolve(payload);
      }
      return;
  }

  const startTime = performance.now();
  try {
    let result;
    switch (type) {
      case 'SEARCH':
        result = await searchIndexedDB(query, options);
        break;
      case 'BATCH_SEARCH':
        result = await searchIndexedDB(query, options);
        break;
      case 'GET_MODELS':
        result = await requestFromDB('getAllModels');
        break;
      case 'GET_CULTURES':
        result = await requestFromDB('getAllCultures');
        break;
      default:
        throw new Error(`Unknown search type: ${type}`);
    }
    
    self.postMessage({
      type: 'RESULT',
      id,
      result,
      duration: (performance.now() - startTime).toFixed(2)
    });
  } catch (error) {
    self.postMessage({ type: 'ERROR', id, error: error.message });
  }
};
