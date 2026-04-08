/**
 * IndexedDB Wrapper for D365FO Label Explorer
 * Handles persistence of labels and metadata
 * 
 * SPEC-23: Added Catalog store for virtual catalog
 * SPEC-32: Added Builder workspace store
 */

export const DB_NAME = 'd365fo-labels';
export const DB_VERSION = 10; // Added multi-entry 'tokens' index for native inverted index

const STORES = {
  LABELS: 'labels',
  METADATA: 'metadata',
  HANDLES: 'handles',
  CATALOG: 'catalog',  // SPEC-23: Virtual catalog
  BUILDER: 'builder_workspace',  // SPEC-32: Builder workspace
  EXTRACTION: 'extraction_sessions', // SPEC-34: Extractor pause/resume sessions
  SESSIONS: 'builder_sessions', // SPEC-32: Builder session history
  BACKUPS: 'extraction_backups', // SPEC-34: Extractor rollback backups
  SEARCH_INDICES: 'search_indices', // SPEC-42: Persisted FlexSearch indices
  BLOOM_FILTERS: 'bloom_filters' // SPEC-42: Fast-fail bloom filters
};

let db = null;

/**
 * Initialize the database
 * SPEC-23: Added Catalog store for language/model status tracking
 * SPEC-32: Added Builder workspace store
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB open error:', request.error);
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      db = request.result;
      
      // Handle version changes (prevents 'connection is closing' error)
      db.onversionchange = () => {
        db.close();
        db = null;
        console.warn('Database version changed. Connection closed.');
      };

      resolve(db);
    };

    request.onblocked = () => {
      console.warn('Database upgrade blocked. Please close other tabs.');
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      console.log(`🚀 Upgrading database from ${event.oldVersion} to ${event.newVersion}`);

      const upgradeTx = event.target.transaction;

      // Labels store (preserve existing data on upgrades)
      let labelsStore;
      if (!database.objectStoreNames.contains(STORES.LABELS)) {
        labelsStore = database.createObjectStore(STORES.LABELS, { keyPath: 'id' });
      } else {
        labelsStore = upgradeTx.objectStore(STORES.LABELS);
      }
      if (!labelsStore.indexNames.contains('fullId')) {
        labelsStore.createIndex('fullId', 'fullId', { unique: false });
      }
      if (!labelsStore.indexNames.contains('culture')) {
        labelsStore.createIndex('culture', 'culture', { unique: false });
      }
      if (!labelsStore.indexNames.contains('model')) {
        labelsStore.createIndex('model', 'model', { unique: false });
      }
      if (!labelsStore.indexNames.contains('prefix')) {
        labelsStore.createIndex('prefix', 'prefix', { unique: false });
      }
      if (!labelsStore.indexNames.contains('text')) {
        labelsStore.createIndex('text', 'text', { unique: false });
      }
      if (!labelsStore.indexNames.contains('tokens')) {
        labelsStore.createIndex('tokens', 'tokens', { multiEntry: true, unique: false });
      }

      // Metadata store
      if (!database.objectStoreNames.contains(STORES.METADATA)) {
        database.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }

      // Handles store
      if (!database.objectStoreNames.contains(STORES.HANDLES)) {
        database.createObjectStore(STORES.HANDLES, { keyPath: 'id' });
      }

      // SPEC-23: Catalog store for virtual catalog (preserve existing data)
      let catalogStore;
      if (!database.objectStoreNames.contains(STORES.CATALOG)) {
        catalogStore = database.createObjectStore(STORES.CATALOG, { keyPath: 'id' });
      } else {
        catalogStore = upgradeTx.objectStore(STORES.CATALOG);
      }
      if (!catalogStore.indexNames.contains('culture')) {
        catalogStore.createIndex('culture', 'culture', { unique: false });
      }
      if (!catalogStore.indexNames.contains('status')) {
        catalogStore.createIndex('status', 'status', { unique: false });
      }
      if (!catalogStore.indexNames.contains('model')) {
        catalogStore.createIndex('model', 'model', { unique: false });
      }

      // SPEC-32: Builder workspace store
      if (!database.objectStoreNames.contains(STORES.BUILDER)) {
        const builderStore = database.createObjectStore(STORES.BUILDER, { keyPath: 'id', autoIncrement: true });
        builderStore.createIndex('labelId', 'labelId', { unique: false });
        builderStore.createIndex('culture', 'culture', { unique: false });
      }

      // SPEC-34: Extraction sessions store
      if (!database.objectStoreNames.contains(STORES.EXTRACTION)) {
        const extractionStore = database.createObjectStore(STORES.EXTRACTION, { keyPath: 'sessionId' });
        extractionStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        extractionStore.createIndex('model', 'model', { unique: false });
      }

      // SPEC-32: Builder history sessions store
      if (!database.objectStoreNames.contains(STORES.SESSIONS)) {
        const sessionsStore = database.createObjectStore(STORES.SESSIONS, { keyPath: 'id' });
        sessionsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        sessionsStore.createIndex('status', 'status', { unique: false });
      }

      // SPEC-34: Refactoring Backups store
      if (!database.objectStoreNames.contains(STORES.BACKUPS)) {
        const backupsStore = database.createObjectStore(STORES.BACKUPS, { keyPath: 'id' });
        backupsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        backupsStore.createIndex('model', 'model', { unique: false });
      }

      // SPEC-42: Search Indices store (FlexSearch exported data)
      if (!database.objectStoreNames.contains(STORES.SEARCH_INDICES)) {
        database.createObjectStore(STORES.SEARCH_INDICES, { keyPath: 'id' }); // id: model|||culture|||flexSearchKey
      }

      // SPEC-42: Bloom Filters store
      if (!database.objectStoreNames.contains(STORES.BLOOM_FILTERS)) {
        database.createObjectStore(STORES.BLOOM_FILTERS, { keyPath: 'id' }); // id: model|||culture
      }
    };
  });
}

/**
 * Add labels in bulk
 * SPEC-22: Uses relaxed durability for faster bulk writes
 * @param {Array<Object>} labels - Array of label objects
 * @returns {Promise<number>} Number of labels added
 */
export async function addLabels(labels) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    // SPEC-22: Relaxed durability - browser batches writes, no SSD fsync wait
    const tx = db.transaction(STORES.LABELS, 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore(STORES.LABELS);
    let count = 0;

    labels.forEach(label => {
      const request = store.put(label);
      request.onsuccess = () => count++;
    });

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all labels
 * @returns {Promise<Array<Object>>}
 */
export async function getAllLabels() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get labels by filter
 * @param {Object} filters - Filter criteria
 * @returns {Promise<Array<Object>>}
 */
export async function getLabels(filters = {}) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    
    if (filters.culture) {
      const index = store.index('culture');
      const request = index.getAll(filters.culture);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else if (filters.model) {
      const index = store.index('model');
      const request = index.getAll(filters.model);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });
}

/**
 * Get label by ID
 * @param {string} id - Label ID
 * @returns {Promise<Object|null>}
 */
export async function getLabelById(id) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Find existing labels by exact text (for extractor reuse workflow)
 * @param {string} text
 * @param {number} limit
 * @returns {Promise<Array<Object>>}
 */
export async function findLabelsByExactText(text, limit = 10) {
  const normalizedText = (text || '').trim();
  if (!normalizedText) return [];

  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const results = [];

    // Fast path: indexed exact lookup
    if (store.indexNames.contains('text')) {
      const request = store.index('text').getAll(normalizedText);
      request.onsuccess = () => resolve((request.result || []).slice(0, limit));
      request.onerror = () => reject(request.error);
      return;
    }

    // Backward compatibility path for old stores without text index
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || results.length >= limit) {
        resolve(results);
        return;
      }

      const value = cursor.value;
      if ((value?.text || '').trim() === normalizedText) {
        results.push(value);
      }
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
}

/**
 * Get count of labels
 * @returns {Promise<number>}
 */
export async function getLabelCount() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get unique cultures
 * @returns {Promise<Array<string>>}
 */
export async function getAllCultures() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const index = store.index('culture');
    const request = index.openCursor(null, 'nextunique');
    const cultures = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cultures.push(cursor.key);
        cursor.continue();
      } else {
        resolve(cultures.sort());
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get unique models
 * @returns {Promise<Array<string>>}
 */
export async function getAllModels() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readonly');
    const store = tx.objectStore(STORES.LABELS);
    const index = store.index('model');
    const request = index.openCursor(null, 'nextunique');
    const models = [];

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        models.push(cursor.key);
        cursor.continue();
      } else {
        resolve(models.sort());
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all labels
 * @returns {Promise<void>}
 */
export async function clearLabels() {
  await initDB();
  
  console.time('⏳ DB Clear labels');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readwrite');
    const store = tx.objectStore(STORES.LABELS);
    const request = store.clear();

    request.onsuccess = () => {
      console.timeEnd('⏳ DB Clear labels');
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Set metadata value
 * @param {string} key 
 * @param {any} value 
 */
export async function setMetadata(key, value) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.METADATA, 'readwrite');
    const store = tx.objectStore(STORES.METADATA);
    const request = store.put({ key, value });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Alias for backwards compatibility
export const saveMetadata = setMetadata;

/**
 * Get metadata value
 * @param {string} key 
 * @returns {Promise<any>}
 */
export async function getMetadata(key) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.METADATA, 'readonly');
    const store = tx.objectStore(STORES.METADATA);
    const request = store.get(key);

    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save directory handle for later use
 * @param {FileSystemDirectoryHandle} handle 
 */
export async function saveDirectoryHandle(handle) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.HANDLES, 'readwrite');
    const store = tx.objectStore(STORES.HANDLES);
    const request = store.put({ id: 'rootDirectory', handle, savedAt: Date.now() });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get saved directory handle
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function getSavedDirectoryHandle() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.HANDLES, 'readonly');
    const store = tx.objectStore(STORES.HANDLES);
    const request = store.get('rootDirectory');

    request.onsuccess = () => resolve(request.result?.handle || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if database has data
 * @returns {Promise<boolean>}
 */
export async function hasData() {
  const count = await getLabelCount();
  return count > 0;
}

/**
 * Get the raw database instance (for advanced operations)
 * @returns {Promise<IDBDatabase>}
 */
export async function getDB() {
  return initDB();
}

// ============================================
// SPEC-23: Catalog Store Functions
// ============================================

/**
 * Save catalog entries (discovered models/cultures)
 * @param {Array} entries - Array of { id, model, culture, fileCount, status }
 */
export async function saveCatalog(entries) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore(STORES.CATALOG);
    
    for (const entry of entries) {
      store.put(entry);
    }
    
    tx.oncomplete = () => resolve(entries.length);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update catalog entry status
 * @param {string} id - Catalog entry ID (e.g., "model|culture")
 * @param {string} status - 'waiting' | 'indexing' | 'ready'
 * @param {number} labelCount - Optional label count when ready
 */
export async function updateCatalogStatus(id, status, labelCount = null) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readwrite');
    const store = tx.objectStore(STORES.CATALOG);
    const request = store.get(id);
    
    request.onsuccess = () => {
      const entry = request.result;
      if (entry) {
        entry.status = status;
        if (labelCount !== null) {
          entry.labelCount = labelCount;
        }
        if (status === 'ready' && typeof entry.fileCount === 'number') {
          entry.processedFiles = entry.fileCount;
        }
        entry.updatedAt = Date.now();
        store.put(entry);
        return;
      }

      // Backward compatibility: if id is a culture, update all matching model|culture entries
      const index = store.index('culture');
      const cultureRequest = index.getAll(id);
      cultureRequest.onsuccess = () => {
        const rows = cultureRequest.result || [];
        if (rows.length === 0) return;

        let aggregateLabelCount = 0;
        rows.forEach((row) => {
          row.status = status;
          if (status === 'ready' && typeof row.fileCount === 'number') {
            row.processedFiles = row.fileCount;
          } else if (typeof row.processedFiles !== 'number') {
            row.processedFiles = 0;
          }
          row.updatedAt = Date.now();
          aggregateLabelCount += row.labelCount || 0;
        });

        rows.forEach((row) => {
          if (labelCount !== null) {
            const denominator = aggregateLabelCount > 0 ? aggregateLabelCount : rows.length;
            const ratio = aggregateLabelCount > 0 ? (row.labelCount || 0) / denominator : 1 / rows.length;
            row.labelCount = Math.round(labelCount * ratio);
          }
          store.put(row);
        });
      };
      cultureRequest.onerror = () => reject(cultureRequest.error);
    };
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Update catalog entry progress (processed files + optional label count)
 * @param {string} id - Catalog entry ID
 * @param {number} processedFiles
 * @param {number|null} labelCount
 * @param {Object|null} metrics
 */
export async function updateCatalogProgress(id, processedFiles, labelCount = null, metrics = null) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore(STORES.CATALOG);
    const request = store.get(id);
    
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry) return;
      entry.processedFiles = processedFiles;
      if (typeof entry.fileCount === 'number') {
        if (processedFiles <= 0) {
          entry.status = 'waiting';
        } else if (processedFiles >= entry.fileCount) {
          entry.status = 'ready';
        } else {
          entry.status = 'indexing';
        }
      }
      if (labelCount !== null) {
        entry.labelCount = labelCount;
      }
      if (metrics && typeof metrics === 'object') {
        if (typeof metrics.totalProcessingMs === 'number') {
          entry.totalProcessingMs = metrics.totalProcessingMs;
        }
        if (typeof metrics.totalBytes === 'number') {
          entry.totalBytes = metrics.totalBytes;
        }
        if (typeof metrics.firstStartedAt === 'number') {
          entry.firstStartedAt = metrics.firstStartedAt;
        }
        if (typeof metrics.lastEndedAt === 'number') {
          entry.lastEndedAt = metrics.lastEndedAt;
        }
      }
      entry.updatedAt = Date.now();
      store.put(entry);
    };
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all catalog entries
 * @returns {Promise<Array>}
 */
export async function getCatalog() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readonly');
    const store = tx.objectStore(STORES.CATALOG);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get catalog entries by status
 * @param {string} status - 'waiting' | 'indexing' | 'ready'
 * @returns {Promise<Array>}
 */
export async function getCatalogByStatus(status) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readonly');
    const store = tx.objectStore(STORES.CATALOG);
    const index = store.index('status');
    const request = index.getAll(status);
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear catalog store
 */
export async function clearCatalog() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.CATALOG, 'readwrite');
    const store = tx.objectStore(STORES.CATALOG);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// SPEC-32: Builder Workspace Functions
// ============================================

/**
 * Add a label to the builder workspace
 * @param {Object} label - { labelId, text, helpText, culture, prefix, sourceModel }
 * @returns {Promise<number>} The auto-generated ID
 */
export async function addBuilderLabel(label) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore(STORES.BUILDER);
    
    const entry = {
      ...label,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    const request = store.add(entry);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Update a builder workspace entry
 * @param {number} id - Entry ID
 * @param {Object} updates - Fields to update
 */
export async function updateBuilderLabel(id, updates) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readwrite');
    const store = tx.objectStore(STORES.BUILDER);
    const request = store.get(id);
    
    request.onsuccess = () => {
      const entry = request.result;
      if (!entry) {
        reject(new Error('Builder entry not found'));
        return;
      }
      
      const updated = {
        ...entry,
        ...updates,
        updatedAt: Date.now()
      };
      
      store.put(updated);
    };
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Remove a builder workspace entry
 * @param {number} id - Entry ID
 */
export async function removeBuilderLabel(id) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readwrite');
    const store = tx.objectStore(STORES.BUILDER);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all builder workspace entries
 * @returns {Promise<Array>}
 */
export async function getBuilderLabels() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readonly');
    const store = tx.objectStore(STORES.BUILDER);
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear all builder workspace entries
 */
export async function clearBuilderWorkspace() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readwrite');
    const store = tx.objectStore(STORES.BUILDER);
    const request = store.clear();
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get builder workspace count
 * @returns {Promise<number>}
 */
export async function getBuilderCount() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readonly');
    const store = tx.objectStore(STORES.BUILDER);
    const request = store.count();
    
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if a labelId already exists in the builder (for conflict detection)
 * @param {string} labelId 
 * @param {string} culture 
 * @returns {Promise<Object|null>}
 */
export async function findBuilderLabelById(labelId, culture) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BUILDER, 'readonly');
    const store = tx.objectStore(STORES.BUILDER);
    const index = store.index('labelId');
    const request = index.getAll(labelId);
    
    request.onsuccess = () => {
      const results = request.result || [];
      const match = results.find(r => r.culture === culture);
      resolve(match || null);
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// SPEC-34: Extraction Sessions Functions
// ============================================

/**
 * Save or update extraction session snapshot
 * @param {Object} session
 */
export async function saveExtractionSession(session) {
  await initDB();

  const entry = {
    ...session,
    updatedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTION, 'readwrite');
    const store = tx.objectStore(STORES.EXTRACTION);
    const request = store.put(entry);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Load extraction session by id
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getExtractionSession(sessionId) {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTION, 'readonly');
    const store = tx.objectStore(STORES.EXTRACTION);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * List all extraction sessions
 * @returns {Promise<Array>}
 */
export async function getExtractionSessions() {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTION, 'readonly');
    const store = tx.objectStore(STORES.EXTRACTION);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete extraction session
 * @param {string} sessionId
 */
export async function removeExtractionSession(sessionId) {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.EXTRACTION, 'readwrite');
    const store = tx.objectStore(STORES.EXTRACTION);
    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// SPEC-32: Builder Session History Functions
// ============================================

/**
 * Save a builder session snapshot
 * @param {Object} session - { id, timestamp, model, labelCount, status, labels, targetCultures, zipBlob? }
 */
export async function saveBuilderSession(session) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SESSIONS, 'readwrite');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.put({
      ...session,
      updatedAt: Date.now()
    });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all builder sessions
 * @returns {Promise<Array>}
 */
export async function getBuilderSessions() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SESSIONS, 'readonly');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get a specific builder session by ID
 * @param {string|number} sessionId
 * @returns {Promise<Object>}
 */
export async function getBuilderSession(sessionId) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SESSIONS, 'readonly');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.get(sessionId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a builder session
 * @param {string|number} sessionId 
 */
export async function removeBuilderSession(sessionId) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.SESSIONS, 'readwrite');
    const store = tx.objectStore(STORES.SESSIONS);
    const request = store.delete(sessionId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// SPEC-34: Extraction Rollback Functions
// ============================================

/**
 * Save a backup of project files before refactoring
 * @param {Object} backup - { id, timestamp, model, files: [{name, content}] }
 */
export async function saveExtractionBackup(backup) {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BACKUPS, 'readwrite');
    const store = tx.objectStore(STORES.BACKUPS);
    const request = store.put({
      ...backup,
      updatedAt: Date.now()
    });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get all extraction backups
 * @returns {Promise<Array>}
 */
export async function getExtractionBackups() {
  await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BACKUPS, 'readonly');
    const store = tx.objectStore(STORES.BACKUPS);
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result || []).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}

/**
 * Delete old backups (maintain only last 5)
 */
export async function pruneExtractionBackups(keepCount = 5) {
  const backups = await getExtractionBackups();
  if (backups.length <= keepCount) return;

  const toDelete = backups.slice(keepCount);
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.BACKUPS, 'readwrite');
    const store = tx.objectStore(STORES.BACKUPS);
    toDelete.forEach(b => store.delete(b.id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export { STORES };
