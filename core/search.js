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

import { DB_NAME, DB_VERSION } from './db-constants.js';
import { FLAGS } from '../utils/flags.js';
import { labelCache } from './opfs-cache.js';

// SPEC-42: Cache loaded Bloom Filters in memory
const bloomFiltersCache = new Map();
let globalBloomFilter = null;
const BloomFilter = window.BloomFilter;

// SPEC-42: Support for search cancellation
let currentSearchAbortController = null;

// FASE 8.1: Search L1 cache (query+filters)
const queryCache = new Map();
const QUERY_CACHE_SIZE = 50;
const QUERY_CACHE_TTL_MS = 30_000;

// FASE 8.2: Coverage tracking to avoid unnecessary IDB fallback
let idbTotalCount = 0;

// FASE 8.7: Debounced prefetch orchestration
let prefetchTimer = null;

/**
 * SPEC-42: Load Bloom Filter from IndexedDB
 */
async function loadBloomFilter(model, culture) {
  if (!model || !culture) return null;
  const key = `${model}|||${culture}`;
  
  if (bloomFiltersCache.has(key)) {
    return bloomFiltersCache.get(key);
  }
  
  const db = await openDB();
  const tx = db.transaction('bloom_filters', 'readonly');
  const store = tx.objectStore('bloom_filters');
  
  return new Promise((resolve) => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result && request.result.buffer) {
        const filter = new BloomFilter({ buffer: request.result.buffer });
        bloomFiltersCache.set(key, filter);
        resolve(filter);
      } else {
        bloomFiltersCache.set(key, null);
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

/**
 * SPEC-42: Load Global Bloom Filter
 */
async function loadGlobalBloomFilter() {
  if (globalBloomFilter) return globalBloomFilter;
  
  const db = await openDB();
  const tx = db.transaction('bloom_filters', 'readonly');
  const store = tx.objectStore('bloom_filters');
  
  return new Promise((resolve) => {
    const request = store.get('global|||all');
    request.onsuccess = () => {
      if (request.result && request.result.buffer) {
        globalBloomFilter = new BloomFilter({ buffer: request.result.buffer });
        console.log('🌍 Global Bloom Filter loaded');
        resolve(globalBloomFilter);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

/**
 * SPEC-42: Refresh Global Bloom Filter by triggering worker rebuild
 */
export async function refreshGlobalBloomFilter() {
  if (!searchWorker) return;
  
  console.log('🔄 Requesting Global Bloom Filter refresh...');
  return new Promise((resolve, reject) => {
    const id = Date.now();
    
    const handler = (e) => {
      if (e.data.id === id && e.data.type === 'FILTER_BUILT') {
        searchWorker.removeEventListener('message', handler);
        // Force reload of local cache
        globalBloomFilter = null;
        loadGlobalBloomFilter().then(() => {
          console.log('✅ Global Bloom Filter refreshed and reloaded');
          resolve();
        });
      } else if (e.data.id === id && e.data.type === 'ERROR') {
        searchWorker.removeEventListener('message', handler);
        reject(new Error(e.data.error));
      }
    };
    
    searchWorker.addEventListener('message', handler);
    searchWorker.postMessage({ type: 'BUILD_GLOBAL_FILTER', id, dbName: DB_NAME, dbVersion: DB_VERSION });
  });
}

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
const indexedIds = new Set(); // id set for de-duplication in FlexSearch
const MAX_MODELS_IN_MEMORY = 5; // Configurable via settings
const PRIORITY_LANGUAGES = ['en-US']; // Warm start languages

// BUG-24: Track indexed cultures for silent re-scan
const indexedCultures = new Set();

// Settings (stored in IndexedDB, loaded on init)
let searchSettings = {
  maxModelsInMemory: 5,
  priorityLanguages: ['en-US'],
  fuzzyThreshold: 0.2,
  enableHybridSearch: true,
  useSearchWorker: true // SPEC-37: Enable worker by default
};

// BUG-28: Keep only essential label fields in RAM-backed FlexSearch store.
const SEARCH_STORE_FIELDS = ['id', 'fullId', 'labelId', 'text', 'help', 'model', 'culture', 'prefix'];

// SPEC-42: Hot Content Cache (Flyweight) to avoid DB contention for priority labels
// Storing raw objects in a Map is 5x lighter than FlexSearch's internal Document store
const hotContentCache = new Map();
const MAX_HOT_CACHE_SIZE = 30000; // Limit to ~30k labels in RAM (approx 50-100MB)

// Stats tracking
let indexedLabelCount = 0;

function normalizeFilterArray(value) {
  const arr = Array.isArray(value) ? value : (value ? [value] : []);
  return [...new Set(arr.filter(Boolean))].sort();
}

function buildQueryCacheKey(query, options = {}) {
  const cultures = normalizeFilterArray(options.cultures || options.culture);
  const models = normalizeFilterArray(options.models || options.model);
  return JSON.stringify({
    q: query || '',
    cultures,
    models,
    exactMatch: !!options.exactMatch,
    useBloomFilter: options.useBloomFilter !== false,
    limit: options.limit || 100,
    offset: options.offset || 0
  });
}

function buildSearchTarget(label) {
  return `${label?.labelId || ''} ${label?.text || ''} ${label?.help || ''} ${label?.fullId || ''}`.trim();
}

function createSearchDoc(label) {
  return {
    id: label.id,
    fullId: label.fullId || '',
    labelId: label.labelId || '',
    text: label.text || '',
    help: label.help || '',
    model: label.model || '',
    culture: label.culture || '',
    prefix: label.prefix || '',
    searchTarget: buildSearchTarget(label)
  };
}

function getMaxModelsInMemory() {
  const configured = Number(searchSettings.maxModelsInMemory);
  if (!Number.isFinite(configured) || configured <= 0) {
    return MAX_MODELS_IN_MEMORY;
  }
  return Math.max(1, Math.floor(configured));
}

function trackIndexedLabelInModelCache(label) {
  const cacheKey = `${label.model}|${label.culture}`;
  let cacheEntry = modelCache.get(cacheKey);

  if (!cacheEntry) {
    const maxModels = getMaxModelsInMemory();
    while (modelCache.size >= maxModels) {
      const evicted = evictLRUSync();
      if (!evicted) break;
    }
    cacheEntry = { lastAccess: Date.now(), labelCount: 0, ids: [] };
    modelCache.set(cacheKey, cacheEntry);
  }

  cacheEntry.lastAccess = Date.now();
  cacheEntry.labelCount++;
  cacheEntry.ids.push(label.id);

  if (label.culture) {
    indexedCultures.add(label.culture);
  }
}

function setCachedQuery(key, results) {
  if (queryCache.size >= QUERY_CACHE_SIZE) {
    queryCache.delete(queryCache.keys().next().value);
  }
  queryCache.set(key, { results, timestamp: Date.now() });
}

function getCachedQuery(key) {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  // LRU touch
  queryCache.delete(key);
  queryCache.set(key, cached);
  return cached.results;
}

export function invalidateSearchCache() {
  queryCache.clear();
}

export function setIDBTotalCount(count) {
  idbTotalCount = Math.max(0, Number(count) || 0);
}

export function getFlexSearchCoverage() {
  if (idbTotalCount <= 0) return 0;
  return Math.min(1, indexedLabelCount / idbTotalCount);
}

export function scheduleLikelyPrefetch(partialQuery, options = {}) {
  if (!FLAGS.USE_SEARCH_PREFETCH) return;

  const query = (partialQuery || '').trim();
  if (query.length < 3) {
    if (prefetchTimer) {
      clearTimeout(prefetchTimer);
      prefetchTimer = null;
    }
    return;
  }

  if (prefetchTimer) clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    try {
      const cultures = normalizeFilterArray(options.cultures || options.culture).slice(0, 2);
      await preloadModelsByName(query, 2, cultures);

      if (cultures.length > 0) {
        await preloadPriorityLanguages(cultures);
      }
    } catch (err) {
      console.debug('[Search] Prefetch skipped:', err?.message || err);
    }
  }, 200);
}

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
    
    searchWorker.postMessage({ type, id, query, options, dbName: DB_NAME, dbVersion: DB_VERSION });
  });
}

/**
 * Initialize the search service
 * SPEC-42: High-efficiency mode (Pointer-only RAM)
 */
export async function initSearch() {
  searchIndex = new FlexSearch.Document({
    document: {
      id: 'id',
      index: ['searchTarget'],
      store: false // CRITICAL BUG-28: Do not mirror DB in RAM. Store only IDs.
    },
    tokenize: 'forward',
    resolution: 9,
    cache: true
  });
  
  modelCache.clear();
  indexedIds.clear();
  indexedLabelCount = 0;
  
  // SPEC-37: Initialize search worker
  initSearchWorker();
  
  // SPEC-42: Load Global Bloom Filter
  loadGlobalBloomFilter();
  
  // Load settings from IndexedDB
  await loadSettings();
}

/**
 * Fetch full documents from IndexedDB by their IDs (JIT Retrieval)
 * BUG-28: Efficient lookup for search results with cache and abort support
 */
async function fetchDocsFromDb(ids, signal = null) {
  if (!ids || ids.length === 0) return [];
  
  const results = [];
  const idsToFetch = [];

  // 1. First, check memory cache (instant)
  for (const id of ids) {
    if (hotContentCache.has(id)) {
      results.push(hotContentCache.get(id));
    } else {
      idsToFetch.push(id);
    }
  }

  // 2. If all found in cache, return immediately
  if (idsToFetch.length === 0) return results;

  // 3. Fetch remaining from DB (respecting signal)
  if (signal?.aborted) return results;

  try {
    const db = await openDB();
    const tx = db.transaction('labels', 'readonly');
    const store = tx.objectStore('labels');
    
    const dbResults = await Promise.all(idsToFetch.map(id => {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return resolve(null);
        
        const request = store.get(id);
        request.onsuccess = () => {
          const val = request.result;
          // Add to cache for next time
          if (val && hotContentCache.size < MAX_HOT_CACHE_SIZE) {
            hotContentCache.set(id, val);
          }
          resolve(val);
        };
        request.onerror = () => resolve(null);
      });
    }));

    return [...results, ...dbResults.filter(Boolean)];
  } catch (err) {
    console.warn('DB Fetch failed or aborted:', err.message);
    return results;
  }
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
    console.warn('[Search] indexLabels called before initSearch(). Call initSearch() first.');
    return;
  }
  if (labels.length > 0) {
    invalidateSearchCache();
  }

  const addUniqueDoc = (label) => {
    if (!label?.id || indexedIds.has(label.id)) {
      return false;
    }

    const doc = createSearchDoc(label);
    searchIndex.add(doc);
    indexedIds.add(label.id);

    // SPEC-42: Populate Hot Content Cache for instant JIT retrieval
    if (hotContentCache.size < MAX_HOT_CACHE_SIZE) {
      hotContentCache.set(label.id, label);
    }
    
    return true;
  };

  // SPEC-37: Process in micro-batches with yielding for large batches
  const CHUNK_SIZE = 500;
  
  if (labels.length <= CHUNK_SIZE) {
    // Small batch: process immediately
    let indexedInBatch = 0;
    for (const label of labels) {
      if (!addUniqueDoc(label)) {
        continue;
      }
      indexedInBatch++;
      trackIndexedLabelInModelCache(label);
    }
    indexedLabelCount += indexedInBatch;
    return;
  }

  // Large batch: process in chunks with yielding
  let processed = 0;
  
  const processChunk = async () => {
    // BUG-28: Memory Throttling
    // If JS Heap is dangerously high (> 1.5GB), wait for GC
    if (performance.memory && performance.memory.usedJSHeapSize > 1500000000) {
      console.warn(`⚠️ High Memory detected (${Math.round(performance.memory.usedJSHeapSize/1048576)}MB). Throttling ingestion...`);
      await new Promise(res => setTimeout(res, 500));
    }

    const end = Math.min(processed + CHUNK_SIZE, labels.length);
    let indexedInChunk = 0;
    
    for (let i = processed; i < end; i++) {
      const label = labels[i];
      if (!addUniqueDoc(label)) {
        continue;
      }
      indexedInChunk++;
      trackIndexedLabelInModelCache(label);
    }
    
    indexedLabelCount += indexedInChunk;
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
  // SPEC-42: Abort previous search if still running
  if (currentSearchAbortController) {
    currentSearchAbortController.abort();
  }
  currentSearchAbortController = new AbortController();
  const { signal } = currentSearchAbortController;

  // Support both single culture string and multiple cultures array
  const { exactMatch = false, model, limit = 100, offset = 0 } = options;
  const cultures = normalizeFilterArray(options.cultures || options.culture);
  const models = normalizeFilterArray(options.models || model);
  const singleModel = models.length === 1 ? models[0] : null;
  
  const startMark = performance.now();
  const queryDesc = query ? `"${query}"` : 'ALL';
  const cultureDesc = cultures.length > 0 ? cultures.join(',') : 'Any';
  const cacheKey = buildQueryCacheKey(query, { ...options, cultures, models, limit, offset, exactMatch });
  const canUseL1Cache = FLAGS.USE_L1_SEARCH_CACHE && !!query && !exactMatch;
  
  console.log(`[Search Start] Query: ${queryDesc} | Exact: ${exactMatch} | Cultures: ${cultureDesc} | Limit: ${limit}`);

  if (canUseL1Cache) {
    const cached = getCachedQuery(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // SPEC-42: Fast-fail using Bloom Filter (applied globally)
  // Guard: Skip bloom check for very short fuzzy queries (prefixes < 3 aren't indexed)
  const isShortFuzzy = !exactMatch && query && query.trim().length < 3;

  if (query && options.useBloomFilter !== false && !isShortFuzzy) {
    // If we have specific cultures, we can check their local filters
    if (cultures.length > 0 && singleModel) {
      // Check each selected culture
      let possiblyExists = false;
      for (const cult of cultures) {
        const filter = await loadBloomFilter(singleModel, cult);
        if (!filter || filter.hasText(query)) {
          possiblyExists = true;
          break;
        }
      }
      if (!possiblyExists) {
        console.log(`🚫 Local Bloom Filters rejected search for "${query}" in ${singleModel}|[${cultureDesc}]`);
        return [];
      }
    } else if (cultures.length === 0 && models.length === 0 && globalBloomFilter) {
      // Cross-model global search protection (only if NO filters are set)
      if (!globalBloomFilter.hasText(query)) {
        console.log(`🚫 Global Bloom Filter rejected search for "${query}" across all models`);
        return [];
      }
    }
  }

  let result = [];

  try {
    const isIndexing = window.appState?.indexingMode !== 'idle';
    const isBrowseMode = !query || query.trim() === '';

    // Level 1: Empty query or Exact Match -> Use IndexedDB cursor
    if (isBrowseMode || exactMatch) {
      if (isBrowseMode && isIndexing) {
        console.warn('🛡️ Ingestion Guard: Blocking disk browse during active ingestion. Returning RAM results only.');
        // Return only what is already in FlexSearch RAM
        result = await searchFlexSearch('', { cultures, models, limit, offset });
      } else {
        console.time(`[Search IDB] Level 1 (Cursor) for ${queryDesc}`);
        result = await searchIndexedDB(query, { ...options, cultures, models, exactMatch, signal });
        console.timeEnd(`[Search IDB] Level 1 (Cursor) for ${queryDesc}`);
      }
    } else if (!searchSettings.enableHybridSearch) {
      result = await searchIndexedDB(query, { ...options, cultures, models, exactMatch: false, signal });
    } else {
      // Level 2: Fuzzy search -> Use FlexSearch
      console.time(`[Search FlexSearch] Level 2 for ${queryDesc}`);
      result = await searchFlexSearch(query, { cultures, models, limit, offset });
      console.timeEnd(`[Search FlexSearch] Level 2 for ${queryDesc}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') return [];
    throw err;
  }

  const duration = (performance.now() - startMark).toFixed(2);
  console.log(`[Search End] Returned ${result.length} items in ${duration}ms`);
  if (canUseL1Cache) {
    setCachedQuery(cacheKey, result);
  }
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
  const { culture, model, limit = 100, offset = 0, exactMatch = false } = options;
  const cultures = normalizeFilterArray(options.cultures || culture);
  const models = normalizeFilterArray(options.models || model);
  const singleCulture = cultures.length === 1 ? cultures[0] : null;
  const singleModel = models.length === 1 ? models[0] : null;
  const lowerQuery = query?.toLowerCase() || '';
  
  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  
  return new Promise((resolve, reject) => {
    const results = [];
    let request;
    let skippedCount = 0;
    
    // Use index if filtering by culture or model
    if (singleCulture) {
      request = store.index('culture').openCursor(IDBKeyRange.only(singleCulture));
    } else if (singleModel) {
      request = store.index('model').openCursor(IDBKeyRange.only(singleModel));
    } else {
      request = store.openCursor();
    }
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor && results.length < limit) {
        const label = cursor.value;
        
        // Apply additional filters
        let matches = true;
        
        if (models.length > 0 && !models.includes(label.model)) matches = false;
        if (cultures.length > 0 && !cultures.includes(label.culture)) matches = false;
        
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
          if (skippedCount < offset) {
            skippedCount++;
          } else {
            results.push(label);
          }
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
  const cultures = normalizeFilterArray(options.cultures || culture);
  const models = normalizeFilterArray(options.models || model);
  const singleCulture = cultures.length === 1 ? cultures[0] : null;
  const singleModel = models.length === 1 ? models[0] : null;
  
  if (!searchIndex) {
    await initSearch();
  }
  
  // FIX: For global searches (no filters), ensure priority languages are loaded
  if (models.length === 0 && cultures.length === 0) {
    if (modelCache.size === 0) {
      await preloadPriorityLanguages();
    }
  } else {
    // Check if we need to load specific model/culture into FlexSearch
    if (singleModel && singleCulture) {
      await ensureModelLoaded(singleModel, singleCulture);
    } else if (singleModel && cultures.length === 0) {
      await ensureModelLoaded(singleModel, null);
    }
  }
  
  // Perform FlexSearch
  // BUG-28: When store is false, FlexSearch returns only IDs
  const searchResults = searchIndex.search(query, {
    limit: limit * 5, // Get extra because we haven't filtered by culture/model yet
    enrich: false // Set to false when store is disabled
  });
  
  // searchResults is now just an array of IDs (or array of field results with IDs)
  let resultIds = [];
  if (Array.isArray(searchResults)) {
    // If it's a Document search, it returns [{ field, result: [ids...] }]
    searchResults.forEach(fieldRes => {
      if (fieldRes.result) {
        resultIds = resultIds.concat(fieldRes.result);
      } else {
        // Fallback for simple index
        resultIds.push(fieldRes);
      }
    });
  }

  // Deduplicate result IDs
  const uniqueIds = [...new Set(resultIds)];
  
  // JIT Retrieval: Fetch ONLY the labels we need for this page
  // We fetch a bit more to allow for culture/model filtering
  const candidateLabels = await fetchDocsFromDb(uniqueIds);
  
  const matchedLabels = [];
  for (const label of candidateLabels) {
    let matches = true;
    if (models.length > 0 && !models.includes(label.model)) matches = false;
    if (cultures.length > 0 && !cultures.includes(label.culture)) matches = false;
    
    if (matches) {
      matchedLabels.push(label);
      if (matchedLabels.length >= limit) break;
    }
  }
  
  // Update LRU timestamps
  if (singleModel && singleCulture) {
    const cacheKey = `${singleModel}|${singleCulture}`;
    if (modelCache.has(cacheKey)) {
      modelCache.get(cacheKey).lastAccess = Date.now();
    }
  }
  
  // RAM Telemetry
  if (performance.memory) {
    const usage = Math.round(performance.memory.usedJSHeapSize / 1048576);
    console.log(`📊 RAM Usage: ${usage}MB | Indexed IDs: ${indexedIds.size} | Cache: ${modelCache.size} models`);
  }

  // FALLBACK: Smart fallback based on coverage and load state.
  // SAFETY: Do NOT fallback to disk if we are currently indexing to prevent DB lock.
  const isIndexing = window.appState?.indexingMode !== 'idle';

  if (matchedLabels.length === 0) {
    if (isIndexing) {
      console.warn('🕒 FlexSearch empty, but skipping disk fallback due to active indexing.');
      return [];
    }

    const isGlobalSearch = models.length === 0 && cultures.length === 0;
    if (isGlobalSearch) {
      const coverage = getFlexSearchCoverage();
      if (coverage >= 0.8) {
        return [];
      }
      console.log(`🔍 FlexSearch miss (coverage ${(coverage * 100).toFixed(0)}%), falling back to IndexedDB...`);
      return searchIndexedDB(query, options);
    }

    const filteredKeyNotLoaded = singleModel && singleCulture && !modelCache.has(`${singleModel}|${singleCulture}`);
    if (modelCache.size === 0 || filteredKeyNotLoaded) {
      return searchIndexedDB(query, options);
    }
  }
  
  return matchedLabels.slice(0, limit);
}

/**
 * Ensure model/culture is loaded in FlexSearch (LRU policy)
 * @param {string} model - Model name
 * @param {string} culture - Culture code
 */
async function ensureModelLoaded(model, culture) {
  if (!model) return;
  
  const cacheKey = `${model}|${culture || '*'}`;
  
  // Already loaded
  if (modelCache.has(cacheKey)) {
    modelCache.get(cacheKey).lastAccess = Date.now();
    return;
  }
  
  // Check if we need to evict (LRU)
  if (modelCache.size >= getMaxModelsInMemory()) {
    await evictLRU();
  }
  
  // Load from IndexedDB
  await loadModelIntoFlexSearch(model, culture);
}

/**
 * Evict least recently used model from FlexSearch
 */
function evictLRUSync() {
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
    let removedCount = 0;
    if (oldest && oldest.ids) {
      oldest.ids.forEach((id) => {
        if (indexedIds.delete(id)) {
          removedCount++;
        }
        searchIndex?.remove(id);
      });
    }
    if (removedCount > 0) {
      indexedLabelCount = Math.max(0, indexedLabelCount - removedCount);
    }
    modelCache.delete(oldestKey);
    return removedCount;
  }
  return 0;
}

async function evictLRU() {
  evictLRUSync();
}

/**
 * Load a specific model/culture into FlexSearch from IndexedDB
 * SPEC-42: Lazy Loading from serialized search_indices if available
 * @param {string} model - Model name
 * @param {string} culture - Culture code
 */
async function loadModelIntoFlexSearch(model, culture) {
  const cacheKey = `${model}|${culture || '*'}`;
  console.log(`📥 Loading ${cacheKey} into FlexSearch...`);
  const db = await openDB();

  // Try to load pre-built index first (SPEC-42)
  try {
    const tx = db.transaction('search_indices', 'readonly');
    const store = tx.objectStore('search_indices');
    
    // We don't know the exact keys FlexSearch exports (reg, cfg, etc), 
    // so we fetch all records that start with our prefix.
    const prefix = `${model}|||${culture}|||`;
    const request = store.getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'));
    
    const records = await new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });

    if (records.length > 0) {
      console.log(`⚡ Fast-Loading ${records.length} index segments for ${model}|${culture}`);
      
      // Import sequentially as FlexSearch export callbacks give us
      for (const record of records) {
        await new Promise((resolve) => {
          // Import takes the key and the stringified data
          searchIndex.import(record.key, record.data);
          // FlexSearch import is synchronous, but we wrap for safety
          resolve(); 
        });
      }
      
      // Calculate labelCount from catalog (since we bypassed label counting)
      const catalogTx = db.transaction('catalog', 'readonly');
      const catalogStore = catalogTx.objectStore('catalog');
      const catalogReq = catalogStore.get(`${model}|||${culture}`);
      const catalogEntry = await new Promise(res => {
        catalogReq.onsuccess = () => res(catalogReq.result);
        catalogReq.onerror = () => res(null);
      });
      const count = catalogEntry?.labelCount || 0;
      
      // We don't have the exact IDs for LRU eviction easily, but we can reconstruct them
      // or just rely on model/culture string removal.
      // FlexSearch document remove expects ID, but we can just let it stay 
      // or we can just fetch IDs if needed. For now, we'll store empty IDs 
      // and eviction will just clear the cache without removing from FlexSearch,
      // which is a memory leak.
      // FIX: Fetch just the IDs to support LRU eviction
      const idsReq = db.transaction('labels', 'readonly').objectStore('labels')
                       .index('model').getAllKeys(IDBKeyRange.only(model));
      const loadedIds = await new Promise(res => {
        idsReq.onsuccess = () => res(idsReq.result.filter(id => !culture || id.includes(`|${culture}|`)));
        idsReq.onerror = () => res([]);
      });

      modelCache.set(cacheKey, { 
        lastAccess: Date.now(), 
        labelCount: count,
        ids: loadedIds
      });
      console.log(`✅ Fast-Loaded ${cacheKey} via import()`);
      return;
    }
  } catch (err) {
    console.warn('Failed to fast-load index, falling back to manual rebuild:', err);
  }

  // Fallback: Manual rebuild from raw labels
  console.log(`🐌 Manual Index Rebuild for ${model}|${culture}`);
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
          if (!label?.id || indexedIds.has(label.id)) {
            cursor.continue();
            return;
          }
          const doc = createSearchDoc(label);
          searchIndex.add(doc);
          indexedIds.add(label.id);
          loadedIds.push(label.id);
          count++;
        }
        
        cursor.continue();
      } else {
        modelCache.set(cacheKey, { 
          lastAccess: Date.now(), 
          labelCount: count,
          ids: loadedIds
        });
        console.log(`✅ Loaded ${count} labels for ${cacheKey} (Manual)`);
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
export async function preloadModelsByName(query, limit = 3, preferredCultures = null) {
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
  const priorityCandidates = [
    ...normalizeFilterArray(preferredCultures),
    ...normalizeFilterArray(searchSettings.priorityLanguages)
  ];
  const priorityCulture = priorityCandidates.find((culture) => !!culture) || 'en-US';

  for (const model of targetModels) {
    const relatedKeys = [...modelCache.keys()].filter((cacheKey) => cacheKey.startsWith(`${model}|`));
    if (relatedKeys.length > 0) continue;
    if (modelCache.size >= getMaxModelsInMemory()) {
      await evictLRU();
    }
    await loadModelIntoFlexSearch(model, priorityCulture);
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
    flexCoverage: getFlexSearchCoverage(),
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
  indexedIds.clear();
  indexedLabelCount = 0;
  indexedCultures.clear(); // BUG-24: Reset tracked cultures
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }
  invalidateSearchCache();
}

/**
 * Check if search is ready
 * @returns {boolean}
 */
export function isReady() {
  return searchIndex !== null;
}

/**
 * BUG-24: Get list of cultures currently indexed in FlexSearch
 * @returns {Array<string>} Array of culture codes
 */
export function getIndexedCultures() {
  return [...indexedCultures];
}

export async function clearWarmStartCache() {
  if (!FLAGS.USE_OPFS_CACHE) return;
  await labelCache.clear();
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
    const cacheKey = `priority-${culture}`;
    if (FLAGS.USE_OPFS_CACHE) {
      const cached = await labelCache.read(cacheKey);
      if (cached && Array.isArray(cached) && cached.length > 0) {
        indexLabels(cached);
        console.log(`⚡ OPFS warm start: ${cached.length} labels for ${culture}`);
        continue;
      }
    }

    const request = index.openCursor(IDBKeyRange.only(culture));
    const loadedLabels = [];

    await new Promise((resolve) => {
      let count = 0;
      const maxPreload = 10000; // Limit preload

      request.onsuccess = (event) => {
        const cursor = event.target.result;

        if (cursor && count < maxPreload) {
          const label = cursor.value;
          if (!label?.id || indexedIds.has(label.id)) {
            cursor.continue();
            return;
          }

          loadedLabels.push(label);
          count++;
          cursor.continue();
        } else {
          if (loadedLabels.length > 0) {
            indexLabels(loadedLabels);
          }
          console.log(`🔥 Warm start: Pre-loaded ${count} labels for ${culture}`);
          resolve();
        }
      };

      request.onerror = () => resolve();
    });

    if (FLAGS.USE_OPFS_CACHE && loadedLabels.length > 0) {
      labelCache.write(cacheKey, loadedLabels).catch((err) => {
        console.debug('[OPFS] Warm cache write skipped:', err?.message || err);
      });
    }
  }

  console.timeEnd('⏳ Preload Priority Languages (FlexSearch)');
}

// Export for backwards compatibility
export { searchIndex };
