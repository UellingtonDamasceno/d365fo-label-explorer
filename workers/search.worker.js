/**
 * Search Worker for D365FO Label Explorer
 * SPEC-37: Offloads IndexedDB cursor operations from Main Thread
 * 
 * This worker handles heavy search operations to prevent UI jank
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 8;

let db = null;

/**
 * Open IndexedDB connection
 */
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }
    
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search IndexedDB with cursor (heavy operation moved off main thread)
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>}
 */
async function searchIndexedDB(query, options = {}) {
  const { culture, model, limit = 100, exactMatch = false } = options;
  const lowerQuery = query?.toLowerCase() || '';
  
  const database = await openDB();
  const tx = database.transaction('labels', 'readonly');
  const store = tx.objectStore('labels');
  
  return new Promise((resolve, reject) => {
    const results = [];
    let request;
    let scannedCount = 0;
    
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
      scannedCount++;
      
      // Report progress every 5000 items
      if (scannedCount % 5000 === 0) {
        self.postMessage({ type: 'PROGRESS', scanned: scannedCount });
      }
      
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
  const { type, id, query, options } = e.data;
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
