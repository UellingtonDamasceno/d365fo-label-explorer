/**
 * Search Worker for D365FO Label Explorer
 * SPEC-37: Offloads IndexedDB cursor operations from Main Thread
 * SPEC-42: Bloom Filter Integration
 */

import '../utils/bloom-filter.js';

let runtimeDbName = null;
let runtimeDbVersion = null;

// SPEC-42: Cache loaded Bloom Filters in worker memory
const bloomFiltersCache = new Map();

/**
 * Load Bloom Filter from SQLite
 */
async function loadBloomFilter(model, culture) {
  if (!model || !culture) return null; // Needs specific pair
  const key = `${model}|||${culture}`;
  
  if (bloomFiltersCache.has(key)) {
    return bloomFiltersCache.get(key);
  }
  
  try {
    const { getBloomFilter } = await import('../core/db.js');
    const result = await getBloomFilter(model, culture);
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
 * Search SQLite with FTS or cursor-like scanning
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Promise<Array>}
 */
async function searchIndexedDB(query, options = {}) {
  const { culture, model, limit = 5000, exactMatch = false, offset = 0 } = options;
  const lowerQuery = query?.toLowerCase() || '';
  
  // SPEC-42: Fast-fail using Bloom Filter
  if (lowerQuery && culture && model) {
    const filter = await loadBloomFilter(model, culture);
    if (filter) {
      const passesFilter = filter.hasText(lowerQuery);
      if (!passesFilter) {
        console.log(`🚫 Bloom Filter rejected search for "${lowerQuery}" in ${model}|${culture}`);
        return []; 
      }
    }
  }
  
  const { getLabels, searchFTS } = await import('../core/db.js');
  
  // Use FTS if possible for performance
  if (lowerQuery && !exactMatch && lowerQuery.length > 2) {
    try {
      let results = await searchFTS(lowerQuery, limit, offset);
      // Post-filter by model/culture if needed
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

  // Fallback to scanning via getLabels (which handles simple filters)
  const results = await getLabels({ model, culture });
  
  // Apply additional query filters
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

/**
 * Get all unique values from an index (for model/culture lists)
 */
async function getUniqueIndexValues(indexName) {
  const { getAllModels, getAllCultures } = await import('../core/db.js');
  if (indexName === 'model') return await getAllModels();
  if (indexName === 'culture') return await getAllCultures();
  return [];
}

/**
 * Get label count for a specific culture or model
 */
async function getIndexCount(indexName, value) {
  const { getLabels } = await import('../core/db.js');
  const labels = await getLabels({ [indexName]: value });
  return labels.length;
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
  }
  if (typeof dbVersion === 'number' && dbVersion !== runtimeDbVersion) {
    runtimeDbVersion = dbVersion;
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
  
  try {
    const { getAllLabels, saveBloomFilter } = await import('../core/db.js');
    const labels = await getAllLabels();
    let count = 0;
    
    for (const label of labels) {
      filter.addText(label.text);
      filter.addText(label.labelId);
      filter.addText(label.help);
      
      count++;
      if (count % 50000 === 0) {
        self.postMessage({ type: 'PROGRESS', phase: 'rebuilding_filter', scanned: count });
      }
    }
    
    // Save the finished filter
    await saveBloomFilter('global', 'all', filter.export());
    
    const elapsed = performance.now() - startTime;
    console.log(`✅ Global Bloom Filter rebuilt: ${count} labels in ${elapsed.toFixed(0)}ms`);
    return count;
  } catch (err) {
    console.error('[Search Worker] Failed to rebuild global bloom filter:', err);
    throw err;
  }
}
