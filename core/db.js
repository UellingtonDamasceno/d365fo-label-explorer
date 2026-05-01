/**
 * Database Proxy - SPEC-11: SQLite WASM via Worker
 * Communicates with workers/db.worker.js to enable OPFS support.
 */
import { ManagedWorker } from '../utils/error-boundary.js';

const dbWorker = new ManagedWorker(new URL('../workers/db.worker.js', import.meta.url).href, { type: 'module' });

export async function initDB() {
    const res = await dbWorker.send('INIT');
    return res.payload;
}

export async function getRuntimeStorageMode() {
    const res = await dbWorker.send('INIT');
    return res.payload.mode;
}

export async function addLabels(labels) {
    const res = await dbWorker.send('ADD_LABELS', { labels });
    return res.payload.count;
}

export async function addLabelsWithLock(labels) {
    return addLabels(labels);
}

export async function getAllLabels() {
    const res = await dbWorker.send('EXEC', { sql: 'SELECT * FROM labels' });
    return res.payload;
}

export async function getLabels(filters = {}) {
    let sql = 'SELECT * FROM labels';
    let bind = [];
    if (filters.culture) {
        sql += ' WHERE culture = ?';
        bind.push(filters.culture);
    } else if (filters.model) {
        sql += ' WHERE model = ?';
        bind.push(filters.model);
    }
    const res = await dbWorker.send('EXEC', { sql, bind });
    return res.payload;
}

export async function getLabelById(id) {
    const res = await dbWorker.send('EXEC', { sql: 'SELECT * FROM labels WHERE id = ?', bind: [id] });
    return res.payload.length ? res.payload[0] : null;
}

export async function getLabelCount() {
    const res = await dbWorker.send('EXEC', { sql: 'SELECT COUNT(*) as c FROM labels' });
    return res.payload[0].c;
}

export async function getAllCultures() {
    const res = await dbWorker.send('EXEC', { sql: 'SELECT DISTINCT culture FROM labels ORDER BY culture' });
    return res.payload.map(r => r.culture).filter(Boolean);
}

export async function getAllModels() {
    const res = await dbWorker.send('EXEC', { sql: 'SELECT DISTINCT model FROM labels ORDER BY model' });
    return res.payload.map(r => r.model).filter(Boolean);
}

export async function clearLabels() {
    await dbWorker.send('EXEC', { sql: 'DELETE FROM labels_fts' });
    const res = await dbWorker.send('EXEC', { sql: 'DELETE FROM labels' });
    return res.payload;
}

export async function setMetadata(key, value) {
    const res = await dbWorker.send('KV_PUT', { store: 'metadata', key, value });
    return res.payload;
}
export const saveMetadata = setMetadata;

export async function getMetadata(key) {
    const res = await dbWorker.send('KV_GET', { store: 'metadata', key });
    return res.payload;
}

// Directory Handles (Uses a separate IDB for handles because they are not serializable for SQLite)
function initHandlesDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('d365fo-handles-db', 1);
        request.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains('handles')) {
                idb.createObjectStore('handles', { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function saveDirectoryHandle(handle) {
    const idb = await initHandlesDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction('handles', 'readwrite');
        const store = tx.objectStore('handles');
        const request = store.put({ id: 'rootDirectory', handle, savedAt: Date.now() });
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
    });
}

export async function getSavedDirectoryHandle() {
    const idb = await initHandlesDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction('handles', 'readonly');
        const store = tx.objectStore('handles');
        const request = store.get('rootDirectory');
        request.onsuccess = () => resolve(request.result?.handle || null);
        request.onerror = () => reject(request.error);
    });
}

// Catalog
export async function saveCatalog(entries) {
    for (const entry of entries) {
        await dbWorker.send('KV_PUT', { store: 'catalog', key: entry.id, value: entry });
    }
    return entries.length;
}

export async function updateCatalogStatus(id, status, labelCount = null) {
    const entryRes = await dbWorker.send('KV_GET', { store: 'catalog', key: id });
    const entry = entryRes.payload;
    if (entry) {
        entry.status = status;
        if (labelCount !== null) entry.labelCount = labelCount;
        entry.updatedAt = Date.now();
        await dbWorker.send('KV_PUT', { store: 'catalog', key: id, value: entry });
    }
}

export async function updateCatalogProgress(id, processedFiles, labelCount = null, metrics = null) {
    const entryRes = await dbWorker.send('KV_GET', { store: 'catalog', key: id });
    const entry = entryRes.payload;
    if (entry) {
        entry.processedFiles = processedFiles;
        if (typeof entry.fileCount === 'number') {
            if (processedFiles <= 0) entry.status = 'waiting';
            else if (processedFiles >= entry.fileCount) entry.status = 'ready';
            else entry.status = 'indexing';
        }
        if (labelCount !== null) entry.labelCount = labelCount;
        if (metrics) Object.assign(entry, metrics);
        entry.updatedAt = Date.now();
        await dbWorker.send('KV_PUT', { store: 'catalog', key: id, value: entry });
    }
}

export async function updateCatalogProgressBatch(updates = []) {
    if (!Array.isArray(updates) || updates.length === 0) return 0;
    let applied = 0;
    for (const update of updates) {
        const id = update?.id;
        if (!id) continue;
        await updateCatalogProgress(id, update.processedFiles, update.labelCount, update.metrics);
        applied++;
    }
    return applied;
}

export async function getCatalog() {
    const res = await dbWorker.send('KV_GET_ALL', { store: 'catalog' });
    return res.payload;
}

export async function clearCatalog() {
    const res = await dbWorker.send('KV_CLEAR', { store: 'catalog' });
    return res.payload;
}

// Builder & Sessions (Restoring required functions)
export async function getBuilderLabels() {
    const res = await dbWorker.send('KV_GET_ALL', { store: 'builder' });
    return res.payload;
}

export async function addBuilderLabel(label) {
    const id = Date.now() + Math.floor(Math.random()*1000);
    const entry = { ...label, id, createdAt: Date.now(), updatedAt: Date.now() };
    await dbWorker.send('KV_PUT', { store: 'builder', key: id.toString(), value: entry });
    return id;
}

export async function removeBuilderLabel(id) {
    await dbWorker.send('KV_DELETE', { store: 'builder', key: id.toString() });
}

export async function clearBuilderWorkspace() {
    await dbWorker.send('KV_CLEAR', { store: 'builder' });
}

export async function saveBuilderSession(session) {
    await dbWorker.send('KV_PUT', { store: 'sessions', key: session.id.toString(), value: { ...session, updatedAt: Date.now() } });
}

export async function getBuilderSessions() {
    const res = await dbWorker.send('KV_GET_ALL', { store: 'sessions' });
    return res.payload.sort((a,b) => b.updatedAt - a.updatedAt);
}

export async function hasData() {
    const count = await getLabelCount();
    return count > 0;
}

export async function searchFTS(query, limit = 50, offset = 0) {
    const sanitized = query.replace(/[^\w\s*]/g, '').trim();
    if (!sanitized) return [];
    const ftsQuery = sanitized.split(/\s+/).map(t => `${t}*`).join(' AND ');
    const res = await dbWorker.send('SEARCH_FTS', { query: ftsQuery, limit, offset });
    return res.payload;
}

export const STORES = {
    LABELS: 'labels',
    METADATA: 'metadata',
    CATALOG: 'catalog',
    BUILDER: 'builder',
    SESSIONS: 'sessions'
};
