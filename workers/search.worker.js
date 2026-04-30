/**
 * Search Worker for D365FO Label Explorer
 * SPEC-37: Offloads IndexedDB cursor operations from Main Thread
 * SPEC-42: Bloom Filter Integration
 */

importScripts('../utils/bloom-filter.js');

let runtimeDbName = null;
let runtimeDbVersion = null;
let openWorkerDBBridge = null;

let db = null;

/**
 * Open IndexedDB connection
 */
async function resolveOpenWorkerDB() {
  if (openWorkerDBBridge) return openWorkerDBBridge;
  const mod = await import('../core/db-connection.js');
  if (typeof mod.openWorkerDB !== 'function') {
    throw new Error('openWorkerDB is not available in core/db-connection.js');
  }
  openWorkerDBBridge = mod.openWorkerDB;
  return openWorkerDBBridge;
}

async function openDB() {
  if (db) return db;
  if (!runtimeDbName || typeof runtimeDbVersion !== 'number') {
    throw new Error('Worker DB configuration missing. Pass dbName and dbVersion from core/search.js.');
  }

  const openWorkerDB = await resolveOpenWorkerDB();
  db = await openWorkerDB({ dbName: runtimeDbName, dbVersion: runtimeDbVersion });
  db.onversionchange = () => {
    db.close();
    db = null;
  };
  return db;
}

// SPEC-42: Cache loaded Bloom Filters in worker memory
const bloomFiltersCache = new Map();

/**
 * Load Bloom Filter from IndexedDB
 */
async function loadBloomFilter(model, culture) {
  if (!model || !culture) return null; // Needs specific pair
  const key = `${model}|||${culture}`;
  
  if (bloomFiltersCache.has(key)) {
    return bloomFiltersCache.get(key);
  }
  
  const database = await openDB();
  const tx = database.transaction('bloom_filters', 'readonly');
  const store = tx.objectStore('bloom_filters');
  
  return new Promise((resolve) => {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result && request.result.buffer) {
        const filter = new BloomFilter({ buffer: request.result.buffer });
        bloomFiltersCache.set(key, filter);
        resolve(filter);
      } else {
        bloomFiltersCache.set(key, null); // Mark as not found to avoid retries
        resolve(null);
      }
    };
    request.onerror = () => resolve(null);
  });
}

/**
 * Search IndexedDB with cursor (heavy operation moved off main thread)
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>}
 */
async function searchIndexedDB(query, options = {}) {
  const { culture, model, limit = 5000, exactMatch = false, offset = 0 } = options; // SPEC-42: Pagination & Limit
  const lowerQuery = query?.toLowerCase() || '';
  
  // SPEC-42: Fast-fail using Bloom Filter
  if (lowerQuery && culture && model) {
    const filter = await loadBloomFilter(model, culture);
    if (filter) {
      const passesFilter = filter.hasText(lowerQuery);
      if (!passesFilter) {
        console.log(`🚫 Bloom Filter rejected search for "${lowerQuery}" in ${model}|${culture}`);
        return []; // Fast-fail!
      }
    }
  }
  
  const database = await openDB();
  const tx = database.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  
  return new Promise((resolve, reject) => {
    const results = [];
    let request;
    let scannedCount = 0;
    let skippedCount = 0;
    
    // SPEC-42: Optimized Search
    const isSingleWord = lowerQuery && !lowerQuery.includes(' ') && lowerQuery.length > 2;
    
    if (isSingleWord && !exactMatch) {
      request = store.index('tokens').openCursor(IDBKeyRange.only(lowerQuery));
    } else if (culture) {
      request = store.index('culture').openCursor(IDBKeyRange.only(culture));
    } else if (model) {
      request = store.index('model').openCursor(IDBKeyRange.only(model));
    } else {
      request = store.openCursor();
    }
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      scannedCount++;
      
      if (scannedCount % 5000 === 0) {
        self.postMessage({ type: 'PROGRESS', scanned: scannedCount });
      }
      
      if (cursor && results.length < limit) {
        const label = cursor.value;
        let matches = true;
        
        if (model && label.model !== model) matches = false;
        if (culture && label.culture !== culture) matches = false;
        
        if (matches && lowerQuery) {
          if (exactMatch) {
            matches = label.text?.toLowerCase() === lowerQuery || 
                      label.labelId?.toLowerCase() === lowerQuery;
          } else if (isSingleWord) {
            // Already matched by the 'tokens' index
            matches = true; 
          } else {
            // Optimized phrase search using pre-normalized field 's'
            matches = label.s?.includes(lowerQuery);
          }
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
 * Get all unique values from an index (for model/culture lists)
 * @param {string} indexName - Index name ('model' or 'culture')
 * @returns {Promise<Array<string>>}
 */
async function getUniqueIndexValues(indexName) {
  const database = await openDB();
  const tx = database.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index(indexName);
  
  return new Promise((resolve, reject) => {
    const values = [];
    const request = index.openCursor(null, 'nextunique');
    
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
}

/**
 * Get label count for a specific culture or model
 * @param {string} indexName - Index name
 * @param {string} value - Value to count
 * @returns {Promise<number>}
 */
async function getIndexCount(indexName, value) {
  const database = await openDB();
  const tx = database.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  const index = store.index(indexName);
  
  return new Promise((resolve, reject) => {
    const request = index.count(IDBKeyRange.only(value));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Batch search: search multiple cultures in parallel
 * @param {string} query - Search query
 * @param {Array<string>} cultures - Cultures to search
 * @param {Object} options - Search options
 * @returns {Promise<Array>}
 */
async function batchSearch(query, cultures, options = {}) {
  const { limit = 100 } = options;
  const limitPerCulture = Math.ceil(limit / cultures.length);
  
  const promises = cultures.map(culture => 
    searchIndexedDB(query, { ...options, culture, limit: limitPerCulture })
  );
  
  const results = await Promise.all(promises);
  return results.flat().slice(0, limit);
}

// Message handler
self.onmessage = async (e) => {
  const { type, id, query, options, dbName, dbVersion } = e.data;
  if (dbName && dbName !== runtimeDbName) {
    runtimeDbName = dbName;
    if (db) {
      db.close();
      db = null;
    }
  }
  if (typeof dbVersion === 'number' && dbVersion !== runtimeDbVersion) {
    runtimeDbVersion = dbVersion;
    if (db) {
      db.close();
      db = null;
    }
  }
  if (!runtimeDbName || typeof runtimeDbVersion !== 'number') {
    self.postMessage({
      type: 'ERROR',
      id,
      error: 'Worker DB configuration missing. Pass dbName and dbVersion before search.'
    });
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
        result = await batchSearch(query, options.cultures, options);
        break;
        
      case 'GET_MODELS':
        result = await getUniqueIndexValues('model');
        break;
        
      case 'GET_CULTURES':
        result = await getUniqueIndexValues('culture');
        break;
        
      case 'COUNT':
        result = await getIndexCount(options.indexName, options.value);
        break;

      case 'BUILD_GLOBAL_FILTER':
        const count = await rebuildGlobalBloomFilter();
        self.postMessage({
          type: 'FILTER_BUILT',
          id,
          count
        });
        return; // Message already sent
        
      default:
        throw new Error(`Unknown search type: ${type}`);
    }
    
    const duration = performance.now() - startTime;
    
    self.postMessage({
      type: 'RESULT',
      id,
      result,
      duration: duration.toFixed(2)
    });
    
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      id,
      error: error.message
    });
  }
};

/**
 * SPEC-42: Reconstruct Global Bloom Filter from all labels
 */
async function rebuildGlobalBloomFilter() {
  console.log('🌍 Rebuilding Global Bloom Filter (2M items capacity)...');
  const startTime = performance.now();
  
  const filter = new BloomFilter({ expectedItems: 2000000, falsePositiveRate: 0.01 });
  const database = await openDB();
  const tx = database.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    let count = 0;
    
    request.onsuccess = async (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const label = cursor.value;
        filter.addText(label.text);
        filter.addText(label.labelId);
        filter.addText(label.help);
        
        count++;
        if (count % 50000 === 0) {
          self.postMessage({ type: 'PROGRESS', phase: 'rebuilding_filter', scanned: count });
        }
        cursor.continue();
      } else {
        // Save the finished filter
        const saveTx = database.transaction('bloom_filters', 'readwrite');
        const saveStore = saveTx.objectStore('bloom_filters');
        
        saveStore.put({
          id: 'global|||all',
          model: 'global',
          culture: 'all',
          buffer: filter.export()
        });
        
        saveTx.oncomplete = () => {
          const elapsed = performance.now() - startTime;
          console.log(`✅ Global Bloom Filter rebuilt: ${count} labels in ${elapsed.toFixed(0)}ms`);
          resolve(count);
        };
      }
    };
    request.onerror = () => reject(request.error);
  });
}
