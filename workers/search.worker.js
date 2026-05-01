/**
 * Search Worker for D365FO Label Explorer
 * SPEC-42: Bloom Filter Integration
 * Centralized Architecture: Requests data from main thread to avoid DB locks.
 */

import '../utils/bloom-filter.js';

const bloomFiltersCache = new Map();
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
 * Load Bloom Filter
 */
async function loadBloomFilter(model, culture) {
  if (!model || !culture) return null;
  const key = `${model}|||${culture}`;
  
  if (bloomFiltersCache.has(key)) return bloomFiltersCache.get(key);
  
  try {
    const result = await requestFromDB('getBloomFilter', { model, culture });
    if (result && result.buffer) {
      const filter = new BloomFilter({ buffer: result.buffer });
      bloomFiltersCache.set(key, filter);
      return filter;
    }
  } catch (e) {
    console.warn(`[Search Worker] Bloom Filter load failed for ${key}:`, e.message);
  }
  
  bloomFiltersCache.set(key, null);
  return null;
}

/**
 * Search Logic
 */
async function searchIndexedDB(query, options = {}) {
  const { culture, model, limit = 50, exactMatch = false, offset = 0 } = options;
  const lowerQuery = query?.toLowerCase() || '';
  
  // Fast-fail using Bloom Filter
  if (lowerQuery && culture && model) {
    const filter = await loadBloomFilter(model, culture);
    if (filter && !filter.hasText(lowerQuery)) return [];
  }
  
  // Try FTS first via main thread
  if (lowerQuery && !exactMatch && lowerQuery.length > 2) {
    try {
      let results = await requestFromDB('searchFTS', { query: lowerQuery, limit, offset });
      if (model || culture) {
        results = results.filter(l => {
          if (model && l.model !== model) return false;
          if (culture && l.culture !== culture) return false;
          return true;
        });
      }
      return results;
    } catch (e) {
      console.warn('[Search Worker] FTS failed, falling back to scanning', e);
    }
  }

  // Fallback to scanning
  const results = await requestFromDB('getLabels', { filters: { model, culture } });
  
  if (!lowerQuery) return results.slice(offset, offset + limit);
  
  const filtered = results.filter(label => {
    if (exactMatch) {
      return label.text?.toLowerCase() === lowerQuery || 
             label.labelId?.toLowerCase() === lowerQuery;
    } else {
      return label.s?.includes(lowerQuery) || 
             label.text?.toLowerCase().includes(lowerQuery) ||
             label.labelId?.toLowerCase().includes(lowerQuery);
    }
  });

  return filtered.slice(offset, offset + limit);
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
        const promises = options.cultures.map(culture => 
          searchIndexedDB(query, { ...options, culture, limit: Math.ceil((options.limit || 100) / options.cultures.length) })
        );
        result = (await Promise.all(promises)).flat().slice(0, options.limit || 100);
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
