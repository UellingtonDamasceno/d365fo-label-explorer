/**
 * Search Service for D365FO Label Explorer
 * SPEC-19: Hybrid Search with Memory Management
 * SPEC-37: Search Worker for Main Thread offloading
 * 
 * Architecture:
 * - Level 1 (Disk): SQLite FTS via Search Worker
 * - Level 2 (Memory Cache): Hot Content Cache (Flyweight) for instant retrieval
 * 
 * Architecture was migrated from FlexSearch to SQLite FTS to prevent OOM in large environments.
 */

import { DB_NAME, DB_VERSION } from './db-constants.js';
import { FLAGS } from '../utils/flags.js';
import { labelCache } from './opfs-cache.js';
import * as db from './db.js';

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
 * SPEC-42: Load Bloom Filter from Metadata (SQLite)
 */
async function loadBloomFilter(model, culture) {
  if (!model || !culture) return null;
  const key = `${model}|||${culture}`;
  
  if (bloomFiltersCache.has(key)) {
    return bloomFiltersCache.get(key);
  }
  
  try {
    const result = await db.getBloomFilter(model, culture);
    if (result && result.buffer) {
      const filter = new BloomFilter({ buffer: result.buffer });
      bloomFiltersCache.set(key, filter);
      return filter;
    }
  } catch (e) {
    // Silent fail for bloom filter
  }
  
  bloomFiltersCache.set(key, null);
  return null;
}

/**
 * SPEC-42: Load Global Bloom Filter
 */
async function loadGlobalBloomFilter() {
  if (globalBloomFilter) return globalBloomFilter;
  
  try {
    const result = await db.getBloomFilter('global', 'all');
    if (result && result.buffer) {
      globalBloomFilter = new BloomFilter({ buffer: result.buffer });
      console.log('🌍 Global Bloom Filter loaded');
      return globalBloomFilter;
    }
  } catch (e) {
    // Silent fail
  }
  return null;
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

// FlexSearch is REMOVED to prevent OOM in large production scenarios.
// All search operations are now handled by SQLite FTS via Search Worker.

// SPEC-37: Search Worker instance
let searchWorker = null;
let searchRequestId = 0;
const pendingSearches = new Map();

// LRU Cache for loaded models/languages (REMOVED - using SQLite directly)
const modelCache = new Map(); 
const MAX_MODELS_IN_MEMORY = 0; 

// BUG-24: Track indexed cultures
const indexedCultures = new Set();

// SPEC-42: Hot Content Cache (Flyweight) to avoid DB contention for priority labels
// Storing raw objects in a Map is much lighter than full search indices.
const MAX_HOT_CACHE_SIZE = 30000; // Limit to ~30k labels in RAM

class LRUCache {
  constructor(maxSize) {
    this.maxSize = Math.max(1, maxSize || 1);
    this.map = new Map();
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

const hotContentCache = new LRUCache(MAX_HOT_CACHE_SIZE);

function getCachedQuery(key) {
  const cached = queryCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > QUERY_CACHE_TTL_MS) {
    queryCache.delete(key);
    return null;
  }
  return cached.results;
}

function setCachedQuery(key, results) {
  if (queryCache.size >= QUERY_CACHE_SIZE) {
    queryCache.delete(queryCache.keys().next().value);
  }
  queryCache.set(key, { results, timestamp: Date.now() });
}

// Settings
let searchSettings = {
  maxModelsInMemory: 0,
  priorityLanguages: ['en-US'],
  fuzzyThreshold: 0.2,
  enableHybridSearch: true,
  useSearchWorker: true 
};

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

export function invalidateSearchCache() {
  queryCache.clear();
}

export function setIDBTotalCount(count) {
  idbTotalCount = Math.max(0, Number(count) || 0);
}

export function scheduleLikelyPrefetch(partialQuery, options = {}) {
  // Prefetching models is still useful to warm up Bloom Filters or OS cache
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
      if (cultures.length > 0) {
        await preloadPriorityLanguages(cultures);
      }
    } catch (err) {
      console.debug('[Search] Prefetch skipped:', err?.message || err);
    }
  }, 500);
}

/**
 * SPEC-37: Initialize the search worker
 */
function initSearchWorker() {
  if (searchWorker) return;
  
  try {
    searchWorker = new Worker('./workers/search.worker.js', { type: 'module' });
    
    searchWorker.onmessage = (e) => {
      const { type, id, result, duration, error, scanned } = e.data;
      
      if (type === 'PROGRESS') {
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
      searchWorker = null;
    };
    
    console.log('✅ Search Worker initialized');
  } catch (err) {
    console.warn('Could not initialize Search Worker:', err);
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
 * FlexSearch is no longer initialized to save RAM.
 */
export async function initSearch() {
  modelCache.clear();
  indexedLabelCount = 0;

  let storageMode = 'unknown';
  if (typeof db.getRuntimeStorageMode === 'function') {
    try {
      storageMode = await db.getRuntimeStorageMode();
    } catch (_err) {
      storageMode = 'unknown';
    }
  }

  if (storageMode === 'opfs') {
    // SPEC-37: Worker mode is safe with shared persistent storage
    initSearchWorker();
  } else if (searchWorker) {
    // In transient in-memory mode each worker gets its own isolated DB
    searchWorker.terminate();
    searchWorker = null;
  }
  
  // SPEC-42: Load Global Bloom Filter
  loadGlobalBloomFilter();
  
  // Load settings from IndexedDB
  await loadSettings();
}

/**
 * Fetch full documents from IndexedDB by their IDs (JIT Retrieval)
 */
async function fetchDocsFromDb(ids, signal = null) {
  if (!ids || ids.length === 0) return [];
  
  const results = [];
  const idsToFetch = [];

  for (const id of ids) {
    if (hotContentCache.has(id)) {
      results.push(hotContentCache.get(id));
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length === 0) return results;
  if (signal?.aborted) return results;

  try {
    const dbResults = await db.getLabelsByIds(idsToFetch);
    for (const val of dbResults) {
      if (val) {
        hotContentCache.set(val.id, val);
      }
    }
    return [...results, ...dbResults];
  } catch (err) {
    console.warn('DB Fetch failed or aborted:', err.message);
    return results;
  }
}

/**
 * Load search settings from Metadata (SQLite)
 */
async function loadSettings() {
  try {
    const settings = await db.getMetadata('searchSettings');
    if (settings) {
      searchSettings = { ...searchSettings, ...settings };
    }
  } catch (e) {
    console.warn('Could not load search settings:', e);
  }
}

/**
 * Save search settings to Metadata (SQLite)
 */
export async function saveSettings(newSettings) {
  searchSettings = { ...searchSettings, ...newSettings };
  try {
    await db.setMetadata('searchSettings', searchSettings);
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
 * Index labels (REMOVED FlexSearch indexing)
 * Now only populates hotContentCache for priority labels.
 */
export function indexLabels(labels) {
  if (labels.length > 0) {
    invalidateSearchCache();
  }

  for (const label of labels) {
    if (label.id) {
      hotContentCache.set(label.id, label);
      indexedLabelCount += 1;
      if (label.culture) indexedCultures.add(label.culture);
    }
  }
}

/**
 * Index all labels (append to existing)
 */
export function indexAll(labels) {
  indexLabels(labels);
}

/**
 * Search for labels - 100% SQLite FTS (No RAM index)
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>} - Matching labels
 */
export async function search(query, options = {}) {
  if (currentSearchAbortController) {
    currentSearchAbortController.abort();
  }
  currentSearchAbortController = new AbortController();
  const { signal } = currentSearchAbortController;

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
    if (cached) return cached;
  }

  // Bloom Filter check
  if (query && options.useBloomFilter !== false && query.trim().length >= 3) {
    if (cultures.length > 0 && singleModel) {
      let possiblyExists = false;
      for (const cult of cultures) {
        const filter = await loadBloomFilter(singleModel, cult);
        if (!filter || filter.hasText(query)) {
          possiblyExists = true;
          break;
        }
      }
      if (!possiblyExists) return [];
    }
  }

  let result = [];
  try {
    // Always use searchIndexedDB (FTS) for all levels
    result = await searchIndexedDB(query, { ...options, cultures, models, exactMatch });
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
 * Level 1 Search: SQLite FTS via Search Worker
 */
async function searchIndexedDB(query, options = {}) {
  if (searchWorker) {
    try {
      return await workerSearch('SEARCH', query, options);
    } catch (err) {
      console.warn('[Search] Worker failed, falling back to main thread:', err.message);
    }
  }
  return searchIndexedDBMainThread(query, options);
}

/**
 * Main thread SQLite search (fallback)
 */
async function searchIndexedDBMainThread(query, options = {}) {
  const { culture, model, limit = 100, offset = 0, exactMatch = false } = options;
  const cultures = normalizeFilterArray(options.cultures || culture);
  const models = normalizeFilterArray(options.models || model);
  const lowerQuery = query?.toLowerCase() || '';
  
  try {
    if (lowerQuery && !exactMatch && lowerQuery.length > 2) {
      let results = await db.searchFTS(lowerQuery, limit, offset);
      if (models.length > 0 || cultures.length > 0) {
        results = results.filter(l => {
          if (models.length > 0 && !models.includes(l.model)) return false;
          if (cultures.length > 0 && !cultures.includes(l.culture)) return false;
          return true;
        });
      }
      return results;
    }

    const filter = {};
    if (cultures.length === 1) filter.culture = cultures[0];
    else if (models.length === 1) filter.model = models[0];
    
    let results = await db.getLabels(filter);
    results = results.filter(label => {
      if (models.length > 1 && !models.includes(label.model)) return false;
      if (cultures.length > 1 && !cultures.includes(label.culture)) return false;
      if (lowerQuery) {
        if (exactMatch) {
          return label.text?.toLowerCase() === lowerQuery || label.labelId?.toLowerCase() === lowerQuery;
        } else {
          return label.text?.toLowerCase().includes(lowerQuery) || label.labelId?.toLowerCase().includes(lowerQuery);
        }
      }
      return true;
    });

    return results.slice(offset, offset + limit);
  } catch (err) {
    console.error('[Search] Main thread search failed:', err);
    return [];
  }
}

/**
 * Preload Priority Languages (REMOVED FlexSearch loading)
 * Now only handles OPFS warming if enabled.
 */
export async function preloadPriorityLanguages(cultures = null) {
  const requestedLanguages = cultures || searchSettings.priorityLanguages;
  if (cultures && Array.isArray(cultures)) {
    searchSettings.priorityLanguages = [...cultures];
  }

  if (!requestedLanguages || requestedLanguages.length === 0) return;

  console.time('⏳ Preload Priority Languages (OPFS)');

  try {
    const allCultures = await db.getAllCultures();
    const languagesToLoad = requestedLanguages.filter(c => allCultures.includes(c)).slice(0, 3);

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
      // No longer pre-loading all labels into RAM
    }
  } catch (err) {
    console.warn('[Search] Priority preload failed:', err);
  }

  console.timeEnd('⏳ Preload Priority Languages (OPFS)');
}

/**
 * Get all labels (filtered)
 */
export async function getAllLabels(options = {}) {
  return searchIndexedDB('', options);
}

/**
 * Get search stats
 */
export function getStats() {
  return {
    totalIndexedInCache: hotContentCache.size,
    flexCoverage: 0,
    modelsInMemory: 0
  };
}

/**
 * Clear the search index
 */
export function clearSearch() {
  modelCache.clear();
  indexedLabelCount = 0;
  indexedCultures.clear(); 
  hotContentCache.clear();
  if (prefetchTimer) {
    clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }
  invalidateSearchCache();
}

/**
 * Check if search is ready
 */
export function isReady() {
  return true; 
}

/**
 * Get list of cultures currently indexed
 */
export function getIndexedCultures() {
  return [...indexedCultures];
}

export async function clearWarmStartCache() {
  if (!FLAGS.USE_OPFS_CACHE) return;
  await labelCache.clear();
}
