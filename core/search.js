/**
 * Search Service for D365FO Label Explorer
 * SPEC-19: Hybrid Search with Memory Management
 * 
 * Architecture:
 * - Level 1 (Disk): IndexedDB cursor search for empty/exact queries
 * - Level 2 (Memory): FlexSearch with LRU cache per model/language
 * 
 * The global labelsData array is PROHIBITED - all data comes from IndexedDB
 */

// FlexSearch is loaded globally via script tag
const FlexSearch = window.FlexSearch;

// FlexSearch index instance (lazy loaded)
let searchIndex = null;

// LRU Cache for loaded models/languages
const modelCache = new Map(); // key: "model|culture" -> { lastAccess, labelCount }
const MAX_MODELS_IN_MEMORY = 5; // Configurable via settings
const PRIORITY_LANGUAGES = ['en-US']; // Warm start languages

// Settings (stored in IndexedDB, loaded on init)
let searchSettings = {
  maxModelsInMemory: 5,
  priorityLanguages: ['en-US'],
  fuzzyThreshold: 0.2,
  enableHybridSearch: true
};

// Stats tracking
let indexedLabelCount = 0;

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
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('d365fo-labels', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add labels to the search index (called during streaming load)
 * @param {Array<Object>} labels - Chunk of labels
 */
export function indexLabels(labels) {
  if (!searchIndex) {
    initSearch();
  }

  labels.forEach(label => {
    const doc = {
      ...label,
      searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
    };
    searchIndex.add(doc);
    
    // Track in LRU cache
    const cacheKey = `${label.model}|${label.culture}`;
    if (!modelCache.has(cacheKey)) {
      modelCache.set(cacheKey, { lastAccess: Date.now(), labelCount: 0 });
    }
    modelCache.get(cacheKey).labelCount++;
  });
  
  indexedLabelCount += labels.length;
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
  
  // Level 1: Empty query or Exact Match -> Use IndexedDB cursor
  if (!query || query.trim() === '' || exactMatch) {
    return searchIndexedDB(query, { culture, model, limit, exactMatch });
  }
  
  // Level 2: Fuzzy search -> Use FlexSearch (if enabled)
  if (!searchSettings.enableHybridSearch) {
    // Fallback to IndexedDB if hybrid disabled
    return searchIndexedDB(query, { culture, model, limit, exactMatch: false });
  }
  
  return searchFlexSearch(query, { culture, model, limit });
}

/**
 * Level 1 Search: IndexedDB cursor with pagination
 * @param {string} query - Search query (can be empty for listing)
 * @param {Object} options - Search options
 * @returns {Promise<Array<Object>>}
 */
async function searchIndexedDB(query, options = {}) {
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
  
  // Check if we need to load more data into FlexSearch
  await ensureModelLoaded(model, culture);
  
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
        
        if (label.culture === culture) {
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
  const languagesToLoad = cultures || searchSettings.priorityLanguages;
  
  // Get list of models from IndexedDB
  const db = await openDB();
  const tx = db.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index('culture');
  
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
}

// Export for backwards compatibility
export { searchIndex };
