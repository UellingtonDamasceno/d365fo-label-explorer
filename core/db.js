/**
 * IndexedDB Wrapper for D365FO Label Explorer
 * Handles persistence of labels and metadata
 * 
 * SPEC-23: Added Catalog store for virtual catalog
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 3; // SPEC-23: Added catalog store

const STORES = {
  LABELS: 'labels',
  METADATA: 'metadata',
  HANDLES: 'handles',
  CATALOG: 'catalog'  // SPEC-23: Virtual catalog
};

let db = null;

/**
 * Initialize the database
 * SPEC-23: Added Catalog store for language/model status tracking
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

      // Labels store
      if (database.objectStoreNames.contains(STORES.LABELS)) {
        database.deleteObjectStore(STORES.LABELS);
      }
      const labelsStore = database.createObjectStore(STORES.LABELS, { keyPath: 'id' });
      labelsStore.createIndex('fullId', 'fullId', { unique: false });
      labelsStore.createIndex('culture', 'culture', { unique: false });
      labelsStore.createIndex('model', 'model', { unique: false });
      labelsStore.createIndex('prefix', 'prefix', { unique: false });

      // Metadata store
      if (!database.objectStoreNames.contains(STORES.METADATA)) {
        database.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }

      // Handles store
      if (!database.objectStoreNames.contains(STORES.HANDLES)) {
        database.createObjectStore(STORES.HANDLES, { keyPath: 'id' });
      }

      // SPEC-23: Catalog store for virtual catalog
      if (database.objectStoreNames.contains(STORES.CATALOG)) {
        database.deleteObjectStore(STORES.CATALOG);
      }
      const catalogStore = database.createObjectStore(STORES.CATALOG, { keyPath: 'id' });
      catalogStore.createIndex('culture', 'culture', { unique: false });
      catalogStore.createIndex('status', 'status', { unique: false });
      catalogStore.createIndex('model', 'model', { unique: false });
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

export { STORES, DB_NAME };
