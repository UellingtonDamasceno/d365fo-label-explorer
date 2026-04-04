/**
 * IndexedDB Wrapper for D365FO Label Explorer
 * Handles persistence of labels and metadata
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 1;

const STORES = {
  LABELS: 'labels',
  METADATA: 'metadata',
  HANDLES: 'handles'
};

let db = null;

/**
 * Initialize the database
 * @returns {Promise<IDBDatabase>}
 */
export async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Labels store
      if (!database.objectStoreNames.contains(STORES.LABELS)) {
        const labelsStore = database.createObjectStore(STORES.LABELS, { keyPath: 'id' });
        labelsStore.createIndex('fullId', 'fullId', { unique: false });
        labelsStore.createIndex('culture', 'culture', { unique: false });
        labelsStore.createIndex('model', 'model', { unique: false });
        labelsStore.createIndex('prefix', 'prefix', { unique: false });
        labelsStore.createIndex('text', 'text', { unique: false });
      }

      // Metadata store (key-value)
      if (!database.objectStoreNames.contains(STORES.METADATA)) {
        database.createObjectStore(STORES.METADATA, { keyPath: 'key' });
      }

      // Handles store (for FileSystemDirectoryHandle)
      if (!database.objectStoreNames.contains(STORES.HANDLES)) {
        database.createObjectStore(STORES.HANDLES, { keyPath: 'id' });
      }
    };
  });
}

/**
 * Add labels in bulk
 * @param {Array<Object>} labels - Array of label objects
 * @returns {Promise<number>} Number of labels added
 */
export async function addLabels(labels) {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readwrite');
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
  
  const labels = await getAllLabels();
  const cultures = [...new Set(labels.map(l => l.culture))];
  return cultures.sort();
}

/**
 * Get unique models
 * @returns {Promise<Array<string>>}
 */
export async function getAllModels() {
  await initDB();
  
  const labels = await getAllLabels();
  const models = [...new Set(labels.map(l => l.model))];
  return models.sort();
}

/**
 * Clear all labels
 * @returns {Promise<void>}
 */
export async function clearLabels() {
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES.LABELS, 'readwrite');
    const store = tx.objectStore(STORES.LABELS);
    const request = store.clear();

    request.onsuccess = () => resolve();
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

export { STORES, DB_NAME };
