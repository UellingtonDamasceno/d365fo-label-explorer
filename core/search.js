/**
 * Search Service for D365FO Label Explorer
 * SPEC-19: Hybrid Search with Memory Management
 * SPEC-37: Search Worker for Main Thread offloading
 * 
 * Architecture:
 * - Level 1 (Disk): IndexedDB cursor search via Web Worker
 * - Level 2 (Memory): FlexSearch with LRU cache per model/language
 * 
 * The global labelsData array is PROHIBITED - all data comes from IndexedDB
 */

import { DB_NAME, DB_VERSION } from './db.js';

// FlexSearch is loaded globally via script tag
const FlexSearch = window.FlexSearch;

// FlexSearch index instance (lazy loaded)
let searchIndex = null;

// SPEC-37: Search Worker instance
let searchWorker = null;
let searchRequestId = 0;
const pendingSearches = new Map();

// LRU Cache for loaded models/languages
const modelCache = new Map(); // key: "model|culture" -> { lastAccess, labelCount }
const MAX_MODELS_IN_MEMORY = 5; // Configurable via settings
const PRIORITY_LANGUAGES = ['en-US']; // Warm start languages

// Settings (stored in IndexedDB, loaded on init)
let searchSettings = {
  maxModelsInMemory: 5,
  priorityLanguages: ['en-US'],
  fuzzyThreshold: 0.2,
  enableHybridSearch: true,
  useSearchWorker: true // SPEC-37: Enable worker by default
};

// Stats tracking
let indexedLabelCount = 0;

/**
 * SPEC-37: Initialize the search worker
 */
function initSearchWorker() {
  if (searchWorker) return;
  
  try {
    searchWorker = new Worker('./workers/search.worker.js');
    
    searchWorker.onmessage = (e) => {
      const { type, id, result, duration, error, scanned } = e.data;
      
      if (type === 'PROGRESS') {
        // Optional: emit progress events for long searches
        console.log(`[Search Worker] Scanned ${scanned} items...`);
        return;
      }
      
      const pending = pendingSearches.get(id);
      if (!pending) return;
      
      pendingSearches.delete(id);
      
      if (type === 'ERROR') {
        pending.reject(new Error(error));
      } else {
        console.log(`[Search Worker] Completed in ${duration}ms, returned ${result.length} items`);
        pending.resolve(result);
      }
    };
    
    searchWorker.onerror = (e) => {
      console.error('[Search Worker] Error:', e.message);
      // Fallback: disable worker on error
      searchSettings.useSearchWorker = false;
      searchWorker = null;
    };
    
    console.log('✅ Search Worker initialized');
  } catch (err) {
    console.warn('Could not initialize Search Worker:', err);
    searchSettings.useSearchWorker = false;
  }
}

/**
 * SPEC-37: Send search request to worker
 */
function workerSearch(type, query, options) {
  return new Promise((resolve, reject) => {
    if (!searchWorker) {
      initSearchWorker();
      if (!searchWorker) {
        reject(new Error('Search Worker not available'));
        return;
      }
    }
    
    const id = ++searchRequestId;
    pendingSearches.set(id, { resolve, reject });
    
    searchWorker.postMessage({ type, id, query, options });
  });
}

/**
 * Initialize the search service
 */
export async function initSearch() {
  searchIndex = new FlexSearch.Document({
    document: {
      id: 'id',
      index: ['searchTarget'],
      store: true
    },
    tokenize: 'forward',
    resolution: 9,
    cache: true
  });
  
  modelCache.clear();
  indexedLabelCount = 0;
  
  // SPEC-37: Initialize search worker
  initSearchWorker();
  
  // Load settings from IndexedDB
  await loadSettings();
}

/**
 * Load search settings from IndexedDB
 */
async function loadSettings() {
  try {
    const db = await openDB();
    const tx = db.transaction('metadata', 'readonly');
    const store = tx.objectStore('metadata');
    const request = store.get('searchSettings');
    
    return new Promise((resolve) => {
      request.onsuccess = () => {
        if (request.result?.value) {
          searchSettings = { ...searchSettings, ...request.result.value };
        }
        resolve();
      };
      request.onerror = () => resolve();
    });
  } catch (e) {
    console.warn('Could not load search settings:', e);
  }
}

/**
 * Save search settings to IndexedDB
 */
export async function saveSettings(newSettings) {
  searchSettings = { ...searchSettings, ...newSettings };
  
  try {
    const db = await openDB();
    const tx = db.transaction('metadata', 'readwrite');
    const store = tx.objectStore('metadata');
    store.put({ key: 'searchSettings', value: searchSettings });
  } catch (e) {
    console.warn('Could not save search settings:', e);
  }
}

/**
 * Get current settings
 */
export function getSettings() {
  return { ...searchSettings };
}

/**
 * Open IndexedDB connection
 * Uses shared DB constants to avoid version mismatch across modules/workers
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add labels to the search index (called during streaming load)
 * SPEC-37: Uses chunked yielding to prevent UI freezing
 * @param {Array<Object>} labels - Chunk of labels
 */
export function indexLabels(labels) {
  if (!searchIndex) {
    initSearch();
  }

  // SPEC-37: Process in micro-batches with yielding for large batches
  const CHUNK_SIZE = 500;
  
  if (labels.length <= CHUNK_SIZE) {
    // Small batch: process immediately
    for (const label of labels) {
      const doc = {
        ...label,
        searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
      };
      searchIndex.add(doc);
      
      const cacheKey = `${label.model}|${label.culture}`;
      if (!modelCache.has(cacheKey)) {
        modelCache.set(cacheKey, { lastAccess: Date.now(), labelCount: 0 });
      }
      modelCache.get(cacheKey).labelCount++;
    }
    indexedLabelCount += labels.length;
    return;
  }

  // Large batch: process in chunks with yielding
  let processed = 0;
  
  const processChunk = () => {
    const end = Math.min(processed + CHUNK_SIZE, labels.length);
    
    for (let i = processed; i < end; i++) {
      const label = labels[i];
      const doc = {
        ...label,
        searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
      };
      searchIndex.add(doc);
      
      const cacheKey = `${label.model}|${label.culture}`;
      if (!modelCache.has(cacheKey)) {
        modelCache.set(cacheKey, { lastAccess: Date.now(), labelCount: 0 });
      }
      modelCache.get(cacheKey).labelCount++;
    }
    
    const chunkSize = end - processed;
    indexedLabelCount += chunkSize;
    processed = end;
    
    // Yield to allow UI updates if more chunks remain
    if (processed < labels.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processChunk, { timeout: 100 });
      } else {
        setTimeout(processChunk, 0);
      }
    }
  };
  
  processChunk();
}

/**
 * Index all labels (append to existing) - SPEC-19 compliant
 * @param {Array<Object>} labels - Chunk of labels from IndexedDB streaming
 */
export function indexAll(labels) {
  indexLabels(labels);
}

/**
 * Search for labels - SPEC-19 Hybrid Search
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>} - Matching labels
 */
export async function search(query, options = {}) {
  const { exactMatch = false, culture, model, limit = 100 } = options;
  const startMark = performance.now();
  const queryDesc = query ? `"${query}"` : 'ALL';
  console.log(`[Search Start] Query: ${queryDesc} | Exact: ${exactMatch} | Culture: ${culture || 'Any'} | Limit: ${limit}`);

  let result;
  // Level 1: Empty query or Exact Match -> Use IndexedDB cursor
  if (!query || query.trim() === '' || exactMatch) {
    console.time(`[Search IDB] Level 1 (Cursor) for ${queryDesc}`);
    result = await searchIndexedDB(query, { culture, model, limit, exactMatch });
    console.timeEnd(`[Search IDB] Level 1 (Cursor) for ${queryDesc}`);
  } else if (!searchSettings.enableHybridSearch) {
    // Fallback to IndexedDB if hybrid disabled
    console.time(`[Search IDB Fallback] Level 2 for ${queryDesc}`);
    result = await searchIndexedDB(query, { culture, model, limit, exactMatch: false });
    console.timeEnd(`[Search IDB Fallback] Level 2 for ${queryDesc}`);
  } else {
    // Level 2: Fuzzy search -> Use FlexSearch
    console.time(`[Search FlexSearch] Level 2 for ${queryDesc}`);
    result = await searchFlexSearch(query, { culture, model, limit });
    console.timeEnd(`[Search FlexSearch] Level 2 for ${queryDesc}`);
  }

  const duration = (performance.now() - startMark).toFixed(2);
  console.log(`[Search End] Returned ${result.length} items in ${duration}ms`);
  return result;
}
/**
 * Level 1 Search: IndexedDB cursor with pagination
 * SPEC-37: Offloads to Search Worker when available
 * @param {string} query - Search query (can be empty for listing)
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>}
 */
async function searchIndexedDB(query, options = {}) {
  // SPEC-37: Use worker for heavy searches (no filter or large result sets)
  if (searchSettings.useSearchWorker && searchWorker) {
    try {
      return await workerSearch('SEARCH', query, options);
    } catch (err) {
      console.warn('[Search] Worker failed, falling back to main thread:', err.message);
    }
  }
  
  // Fallback: Main thread search
  return searchIndexedDBMainThread(query, options);
}

/**
 * Main thread IndexedDB search (fallback)
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>}
 */
async function searchIndexedDBMainThread(query, options = {}) {
  const { culture, model, limit = 100, exactMatch = false } = options;
  const lowerQuery = query?.toLowerCase() || '';
  
  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  
  return new Promise((resolve, reject) => {
    const results = [];
    let request;
    
    // Use index if filtering by culture or model
    if (culture) {
      request = store.index('culture').openCursor(IDBKeyRange.only(culture));
    } else if (model) {
      request = store.index('model').openCursor(IDBKeyRange.only(model));
    } else {
      request = store.openCursor();
    }
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor && results.length < limit) {
        const label = cursor.value;
        
        // Apply additional filters
        let matches = true;
        
        if (model && label.model !== model) matches = false;
        if (culture && label.culture !== culture) matches = false;
        
        // Apply text search if query provided
        if (matches && lowerQuery) {
          const textMatch = 
            label.text?.toLowerCase().includes(lowerQuery) ||
            label.fullId?.toLowerCase().includes(lowerQuery) ||
            label.labelId?.toLowerCase().includes(lowerQuery) ||
            label.help?.toLowerCase().includes(lowerQuery);
          
          matches = textMatch;
        }
        
        if (matches) {
          results.push(label);
        }
        
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Level 2 Search: FlexSearch with LRU cache
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>}
 */
async function searchFlexSearch(query, options = {}) {
  const { culture, model, limit = 100 } = options;
  
  if (!searchIndex) {
    await initSearch();
  }
  
  // FIX: For global searches (no filters), ensure priority languages are loaded
  if (!model && !culture) {
    if (modelCache.size === 0) {
      await preloadPriorityLanguages();
    }
  } else {
    // Check if we need to load specific model/culture into FlexSearch
    await ensureModelLoaded(model, culture);
  }
  
  // Perform FlexSearch
  const searchResults = searchIndex.search(query, {
    limit: limit * 2, // Get extra for filtering
    enrich: true
  });
  
  // Collect unique results
  const idSet = new Set();
  const matchedLabels = [];
  
  searchResults.forEach(fieldResult => {
    if (fieldResult.result) {
      fieldResult.result.forEach(item => {
        if (!idSet.has(item.id)) {
          const label = item.doc;
          
          // Apply filters
          let matches = true;
          if (model && label.model !== model) matches = false;
          if (culture && label.culture !== culture) matches = false;
          
          if (matches) {
            idSet.add(item.id);
            matchedLabels.push(label);
          }
        }
      });
    }
  });
  
  // Update LRU timestamps
  if (model && culture) {
    const cacheKey = `${model}|${culture}`;
    if (modelCache.has(cacheKey)) {
      modelCache.get(cacheKey).lastAccess = Date.now();
    }
  }
  
  // FALLBACK: If FlexSearch returned nothing in a global search, try Level 1 (IndexedDB)
  if (matchedLabels.length === 0 && !model && !culture) {
    console.log('🔍 FlexSearch returned no results, falling back to IndexedDB scan...');
    return searchIndexedDB(query, options);
  }
  
  return matchedLabels.slice(0, limit);
}

/**
 * Ensure model/culture is loaded in FlexSearch (LRU policy)
 * @param {string} model - Model name
 * @param {string} culture - Culture code
 */
async function ensureModelLoaded(model, culture) {
  if (!model || !culture) return;
  
  const cacheKey = `${model}|${culture}`;
  
  // Already loaded
  if (modelCache.has(cacheKey)) {
    modelCache.get(cacheKey).lastAccess = Date.now();
    return;
  }
  
  // Check if we need to evict (LRU)
  if (modelCache.size >= searchSettings.maxModelsInMemory) {
    await evictLRU();
  }
  
  // Load from IndexedDB
  await loadModelIntoFlexSearch(model, culture);
}

/**
 * Evict least recently used model from FlexSearch
 */
async function evictLRU() {
  let oldest = null;
  let oldestKey = null;
  
  for (const [key, value] of modelCache.entries()) {
    if (!oldest || value.lastAccess < oldest.lastAccess) {
      oldest = value;
      oldestKey = key;
    }
  }
  
  if (oldestKey) {
    console.log(`🗑️ LRU Eviction: Removing ${oldestKey} from FlexSearch`);
    
    // Remove labels from this model from FlexSearch
    if (oldest && oldest.ids) {
      oldest.ids.forEach(id => searchIndex.remove(id));
    }
    modelCache.delete(oldestKey);
  }
}

/**
 * Load a specific model/culture into FlexSearch from IndexedDB
 * @param {string} model - Model name
 * @param {string} culture - Culture code
 */
async function loadModelIntoFlexSearch(model, culture) {
  console.log(`📥 Loading ${model}|${culture} into FlexSearch...`);
  
  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index('model');
  
  return new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.only(model));
    let count = 0;
    const loadedIds = [];
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor) {
        const label = cursor.value;
        
        if (!culture || label.culture === culture) {
          const doc = {
            ...label,
            searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
          };
          searchIndex.add(doc);
          loadedIds.push(label.id);
          count++;
        }
        
        cursor.continue();
      } else {
        modelCache.set(`${model}|${culture}`, { 
          lastAccess: Date.now(), 
          labelCount: count,
          ids: loadedIds
        });
        console.log(`✅ Loaded ${count} labels for ${model}|${culture}`);
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * JIT preload: load up to N models whose names match the query
 * @param {string} query
 * @param {number} limit
 */
export async function preloadModelsByName(query, limit = 3) {
  const normalized = (query || '').trim().toLowerCase();
  if (!normalized) return;
  if (!searchIndex) {
    await initSearch();
  }

  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index('model');

  const models = await new Promise((resolve, reject) => {
    const request = index.openCursor(null, 'nextunique');
    const values = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        values.push(cursor.key);
        cursor.continue();
      } else {
        resolve(values);
      }
    };
    request.onerror = () => reject(request.error);
  });

  const targetModels = models
    .filter((model) => model.toLowerCase().includes(normalized))
    .slice(0, limit);

  for (const model of targetModels) {
    const relatedKeys = [...modelCache.keys()].filter((cacheKey) => cacheKey.startsWith(`${model}|`));
    if (relatedKeys.length > 0) continue;
    if (modelCache.size >= searchSettings.maxModelsInMemory) {
      await evictLRU();
    }
    await loadModelIntoFlexSearch(model, null);
  }
}

/**
 * Get all labels (filtered) - SPEC-19 compliant (uses IndexedDB)
 * @param {Object} options 
 * @returns {Promise<Array<Object>>}
 */
export async function getAllLabels(options = {}) {
  return searchIndexedDB('', options);
}

/**
 * Get search stats
 * @returns {Object}
 */
export function getStats() {
  return {
    totalIndexed: indexedLabelCount,
    modelsInMemory: modelCache.size,
    maxModels: searchSettings.maxModelsInMemory,
    cacheEntries: Array.from(modelCache.keys())
  };
}

/**
 * Clear the search index
 */
export function clearSearch() {
  if (searchIndex) {
    searchIndex = null;
  }
  modelCache.clear();
  indexedLabelCount = 0;
}

/**
 * Check if search is ready
 * @returns {boolean}
 */
export function isReady() {
  return searchIndex !== null;
}

/**
 * Pre-load priority languages (warm start)
 * @param {Array<string>} cultures - Culture codes to pre-load
 */
export async function preloadPriorityLanguages(cultures = null) {
  const requestedLanguages = cultures || searchSettings.priorityLanguages;
  if (cultures && Array.isArray(cultures)) {
    searchSettings.priorityLanguages = [...cultures];
  }

  if (!requestedLanguages || requestedLanguages.length === 0) return;

  if (!searchIndex) {
    await initSearch();
  }

  console.time('⏳ Preload Priority Languages (FlexSearch)');

  // Get list of models from IndexedDB
  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index('culture');
  const languagesToLoad = [];

  for (const culture of requestedLanguages) {
    const count = await new Promise((resolve) => {
      const countRequest = index.count(IDBKeyRange.only(culture));
      countRequest.onsuccess = () => resolve(countRequest.result || 0);
      countRequest.onerror = () => resolve(0);
    });
    if (count > 0) {
      languagesToLoad.push(culture);
      if (languagesToLoad.length >= 3) break;
    }
  }

  for (const culture of languagesToLoad) {
    // Load a sample to prime the cache
    const request = index.openCursor(IDBKeyRange.only(culture));

    await new Promise((resolve) => {
      let count = 0;
      const maxPreload = 10000; // Limit preload

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor && count < maxPreload) {
          const label = cursor.value;
          const doc = {
            ...label,
            searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
          };
          searchIndex.add(doc);

          const cacheKey = `${label.model}|${label.culture}`;
          if (!modelCache.has(cacheKey)) {
            modelCache.set(cacheKey, { lastAccess: Date.now(), labelCount: 0, ids: [] });
          }
          modelCache.get(cacheKey).labelCount++;
          modelCache.get(cacheKey).ids.push(label.id);

          count++;
          cursor.continue();
        } else {
          console.log(`🔥 Warm start: Pre-loaded ${count} labels for ${culture}`);
          resolve();
        }
      };

      request.onerror = () => resolve();
    });
  }

  console.timeEnd('⏳ Preload Priority Languages (FlexSearch)');
}// Export for backwards compatibility
export { searchIndex };
