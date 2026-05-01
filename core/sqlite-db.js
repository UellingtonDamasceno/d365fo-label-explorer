import { DB_NAME, DB_VERSION } from './db-constants.js';

export { DB_NAME, DB_VERSION };

const SQLITE_CDN = 'https://cdn.jsdelivr.net/npm/@sqlite.org/sqlite-wasm@3.45.1-build1/sqlite-wasm/jswasm/sqlite3.mjs';
let sqlite3 = null;
let db = null;
let initPromise = null;
let runtimeStorageMode = 'unknown';

// Minimal IndexedDB just for FileSystem handles (which SQLite can't store)
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

export async function initDB() {
  if (db) return db;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!self.sqlite3InitModule) {
        const m = await import(SQLITE_CDN);
        self.sqlite3InitModule = m.default;
      }

      sqlite3 = await self.sqlite3InitModule({
        print: () => {},
        printErr: () => {}
      });

      console.log('SQLite3 version', sqlite3.version.libVersion);

      const isMainThread = typeof window !== 'undefined' && self === window;
      let opfsReady = false;

      // Prefer the OPFS SAH Pool VFS: it works on the main thread because it
      // uses FileSystemSyncAccessHandle instead of Atomics.wait(). The classic
      // OpfsDb VFS is restricted to Workers and is only attempted as a fallback
      // when running off the main thread.
      if (typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
        try {
          const poolUtil = await sqlite3.installOpfsSAHPoolVfs({
            name: 'd365fo-sahpool',
            initialCapacity: 8,
            clearOnInit: false
          });
          db = new poolUtil.OpfsSAHPoolDb('/' + DB_NAME);
          runtimeStorageMode = 'opfs-sahpool';
          opfsReady = true;
          console.log('SQLite OPFS (SAH Pool) Database initialized:', db.filename);

          // Performance Pragmas for OPFS
          db.exec('PRAGMA synchronous = NORMAL;');
          db.exec('PRAGMA journal_mode = WAL;');
        } catch (sahErr) {
          console.warn('OPFS SAH Pool VFS unavailable:', sahErr);
        }
      }

      if (!opfsReady && !isMainThread && sqlite3.oo1.OpfsDb) {
        try {
          db = new sqlite3.oo1.OpfsDb('/' + DB_NAME, 'c');
          runtimeStorageMode = 'opfs';
          opfsReady = true;
          console.log('SQLite OPFS Database initialized:', db.filename);
          db.exec('PRAGMA synchronous = NORMAL;');
          db.exec('PRAGMA journal_mode = WAL;');
        } catch (opfsErr) {
          console.warn('OPFS VFS creation failed:', opfsErr);
        }
      }

      if (!opfsReady) {
        db = new sqlite3.oo1.DB('/' + DB_NAME, 'c');
        runtimeStorageMode = 'memory';
        console.warn('SQLite OPFS is NOT available, using transient memory database.');
        db.exec('PRAGMA synchronous = OFF;');
        db.exec('PRAGMA journal_mode = MEMORY;');
      }

      setupSchema();
      return db;
    } catch (err) {
      console.error('Failed to initialize SQLite WASM:', err);
      throw err;
    }
  })();

  return initPromise;
}

function setupSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      fullId TEXT,
      labelId TEXT,
      text TEXT,
      help TEXT,
      model TEXT,
      culture TEXT,
      prefix TEXT,
      sourcePath TEXT,
      s TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_labels_culture ON labels(culture);
    CREATE INDEX IF NOT EXISTS idx_labels_model ON labels(model);
    CREATE INDEX IF NOT EXISTS idx_labels_text ON labels(text);
    
    CREATE TABLE IF NOT EXISTS kv_store (
      store_name TEXT,
      key TEXT,
      value JSON,
      PRIMARY KEY (store_name, key)
    );
  `);
  ensureLabelsFtsSchema();
}

function labelsFtsCreateSql() {
  return `
    CREATE VIRTUAL TABLE labels_fts USING fts5(
      id UNINDEXED,
      s,
      tokenize='unicode61',
      prefix='2 3 4'
    );
  `;
}

function isExpectedLabelsFtsSchema(sql) {
  if (!sql) return false;
  const normalized = String(sql).toLowerCase().replace(/\s+/g, ' ');
  const hasUnicodeTokenizer = normalized.includes("tokenize='unicode61'");
  const hasExpectedPrefix = /prefix\s*=\s*'2(?:[\s,]+3)(?:[\s,]+4)'/.test(normalized);
  const hasCorrectPayloadColumn = /\bid\s+unindexed\s*,\s*s\s*,/.test(normalized);
  const isContentless = !normalized.includes("content='labels'") && !normalized.includes('content_rowid');
  return hasUnicodeTokenizer
    && hasExpectedPrefix
    && hasCorrectPayloadColumn
    && isContentless
    && !normalized.includes('searchtarget');
}

function rebuildLabelsFtsFromLabels() {
  db.exec('DROP TABLE IF EXISTS labels_fts;');
  db.exec(labelsFtsCreateSql());
  db.exec(`
    INSERT INTO labels_fts(id, s)
    SELECT id, s
    FROM labels
    WHERE s IS NOT NULL AND s <> '';
  `);
}

function isFtsCorruptionError(err) {
  const msg = String(err?.message || err || '');
  return msg.includes('SQLITE_CORRUPT_VTAB') || msg.includes('database disk image is malformed');
}

function ensureLabelsFtsSchema() {
  let existingSql = null;
  db.exec({
    sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'labels_fts'",
    rowMode: 'array',
    callback: function (row) { existingSql = row[0]; }
  });

  if (!existingSql) {
    db.exec(labelsFtsCreateSql());
    return;
  }

  if (isExpectedLabelsFtsSchema(existingSql)) {
    return;
  }

  db.exec('BEGIN TRANSACTION;');
  try {
    rebuildLabelsFtsFromLabels();
    db.exec('COMMIT;');
    console.log('🔁 Migrated labels_fts tokenizer to unicode61 + prefix.');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

export async function addLabels(labels, allowFtsRepair = true) {
  await initDB();
  db.exec('BEGIN TRANSACTION;');
  let repairAndRetry = false;
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO labels (id, fullId, labelId, text, help, model, culture, prefix, sourcePath, s)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ftsDeleteStmt = db.prepare(`
    DELETE FROM labels_fts WHERE id = ?
  `);
  
  const ftsStmt = db.prepare(`
    INSERT INTO labels_fts(id, s)
    VALUES (?, ?)
  `);

  try {
    for (const label of labels) {
      stmt.bind([
        label.id,
        label.fullId || null,
        label.labelId || null,
        label.text || null,
        label.help || null,
        label.model || null,
        label.culture || null,
        label.prefix || null,
        label.sourcePath || null,
        label.s || null
      ]);
      stmt.step();
      stmt.reset();

      ftsDeleteStmt.bind([label.id]);
      ftsDeleteStmt.step();
      ftsDeleteStmt.reset();

      if (label.s) {
        ftsStmt.bind([label.id, label.s]);
        ftsStmt.step();
        ftsStmt.reset();
      }
    }
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    if (allowFtsRepair && isFtsCorruptionError(err)) {
      repairAndRetry = true;
    } else {
      throw err;
    }
  } finally {
    stmt.finalize();
    ftsDeleteStmt.finalize();
    ftsStmt.finalize();
  }

  if (repairAndRetry) {
    console.warn('Detected FTS corruption. Rebuilding labels_fts and retrying batch once...');
    rebuildLabelsFtsFromLabels();
    return addLabels(labels, false);
  }

  return labels.length;
}

export async function addLabelsWithLock(labels) {
  return addLabels(labels);
}

export async function getAllLabels() {
  await initDB();
  const res = [];
  db.exec({
    sql: 'SELECT * FROM labels',
    rowMode: 'object',
    callback: function (row) { res.push(row); }
  });
  return res;
}

export async function getLabels(filters = {}) {
  await initDB();
  const res = [];
  let sql = 'SELECT * FROM labels';
  let bind = [];
  if (filters.culture) {
    sql += ' WHERE culture = ?';
    bind.push(filters.culture);
  } else if (filters.model) {
    sql += ' WHERE model = ?';
    bind.push(filters.model);
  }
  db.exec({
    sql, bind, rowMode: 'object',
    callback: function (row) { res.push(row); }
  });
  return res;
}

export async function getLabelById(id) {
  await initDB();
  let row = null;
  db.exec({
    sql: 'SELECT * FROM labels WHERE id = ?',
    bind: [id], rowMode: 'object',
    callback: function (r) { row = r; }
  });
  return row;
}

export async function findLabelsByExactText(text, limit = 10) {
  await initDB();
  const res = [];
  db.exec({
    sql: 'SELECT * FROM labels WHERE text = ? LIMIT ?',
    bind: [text, limit], rowMode: 'object',
    callback: function (row) { res.push(row); }
  });
  return res;
}

export async function getLabelCount() {
  await initDB();
  let count = 0;
  db.exec({
    sql: 'SELECT COUNT(*) as c FROM labels',
    rowMode: 'object',
    callback: function (row) { count = row.c; }
  });
  return count;
}

export async function getAllCultures() {
  await initDB();
  const res = [];
  db.exec({
    sql: 'SELECT DISTINCT culture FROM labels ORDER BY culture',
    rowMode: 'object',
    callback: function (row) { if (row.culture) res.push(row.culture); }
  });
  return res;
}

export async function getAllModels() {
  await initDB();
  const res = [];
  db.exec({
    sql: 'SELECT DISTINCT model FROM labels ORDER BY model',
    rowMode: 'object',
    callback: function (row) { if (row.model) res.push(row.model); }
  });
  return res;
}

export async function clearLabels() {
  await initDB();
  db.exec('BEGIN TRANSACTION;');
  try {
    db.exec('DELETE FROM labels_fts');
    db.exec('DELETE FROM labels');
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

// KV Store implementations
function kvPut(store, key, value) {
  db.exec({
    sql: 'INSERT OR REPLACE INTO kv_store (store_name, key, value) VALUES (?, ?, ?)',
    bind: [store, key, JSON.stringify(value)]
  });
}

function kvGet(store, key) {
  let val = null;
  db.exec({
    sql: 'SELECT value FROM kv_store WHERE store_name = ? AND key = ?',
    bind: [store, key], rowMode: 'array',
    callback: function (row) { val = JSON.parse(row[0]); }
  });
  return val;
}

function kvGetAll(store) {
  const res = [];
  db.exec({
    sql: 'SELECT value FROM kv_store WHERE store_name = ?',
    bind: [store], rowMode: 'array',
    callback: function (row) { res.push(JSON.parse(row[0])); }
  });
  return res;
}

function kvDelete(store, key) {
  db.exec({
    sql: 'DELETE FROM kv_store WHERE store_name = ? AND key = ?',
    bind: [store, key]
  });
}

function kvClear(store) {
  db.exec({
    sql: 'DELETE FROM kv_store WHERE store_name = ?',
    bind: [store]
  });
}

function kvCount(store) {
  let count = 0;
  db.exec({
    sql: 'SELECT COUNT(*) as c FROM kv_store WHERE store_name = ?',
    bind: [store], rowMode: 'object',
    callback: function (row) { count = row.c; }
  });
  return count;
}

export async function setMetadata(key, value) { await initDB(); kvPut('metadata', key, value); }
export const saveMetadata = setMetadata;
export async function getMetadata(key) { await initDB(); return kvGet('metadata', key); }

export async function saveCatalog(entries) {
  await initDB();
  db.exec('BEGIN TRANSACTION;');
  try {
    for (const entry of entries) {
      kvPut('catalog', entry.id, entry);
    }
    db.exec('COMMIT;');
    return entries.length;
  } catch(e) {
    db.exec('ROLLBACK;');
    throw e;
  }
}
export async function updateCatalogStatus(id, status, labelCount = null) {
  await initDB();
  const entry = kvGet('catalog', id);
  if (entry) {
    entry.status = status;
    if (labelCount !== null) entry.labelCount = labelCount;
    if (status === 'ready' && typeof entry.fileCount === 'number') entry.processedFiles = entry.fileCount;
    entry.updatedAt = Date.now();
    kvPut('catalog', id, entry);
  }
}
export async function updateCatalogProgress(id, processedFiles, labelCount = null, metrics = null) {
  await initDB();
  const entry = kvGet('catalog', id);
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
    kvPut('catalog', id, entry);
  }
}
export async function updateCatalogProgressBatch(updates = []) {
  await initDB();
  if (!Array.isArray(updates) || updates.length === 0) return 0;

  db.exec('BEGIN TRANSACTION;');
  let applied = 0;
  try {
    for (const update of updates) {
      const id = update?.id;
      if (!id) continue;

      const entry = kvGet('catalog', id);
      if (!entry) continue;

      const processedFiles = update.processedFiles ?? entry.processedFiles ?? 0;
      entry.processedFiles = processedFiles;
      if (typeof entry.fileCount === 'number') {
        if (processedFiles <= 0) entry.status = 'waiting';
        else if (processedFiles >= entry.fileCount) entry.status = 'ready';
        else entry.status = 'indexing';
      }

      if (update.labelCount !== null && update.labelCount !== undefined) {
        entry.labelCount = update.labelCount;
      }

      if (update.metrics) {
        Object.assign(entry, update.metrics);
      }

      entry.updatedAt = Date.now();
      kvPut('catalog', id, entry);
      applied += 1;
    }

    db.exec('COMMIT;');
    return applied;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}
export async function getCatalog() { await initDB(); return kvGetAll('catalog'); }
export async function getCatalogByStatus(status) {
  const all = await getCatalog();
  return all.filter(e => e.status === status);
}
export async function clearCatalog() { await initDB(); kvClear('catalog'); }

// Builder
export async function addBuilderLabel(label) {
  await initDB();
  const id = Date.now() + Math.floor(Math.random()*1000);
  const entry = { ...label, id, createdAt: Date.now(), updatedAt: Date.now() };
  kvPut('builder', id.toString(), entry);
  return id;
}
export async function updateBuilderLabel(id, updates) {
  await initDB();
  const entry = kvGet('builder', id.toString());
  if(entry) {
    kvPut('builder', id.toString(), { ...entry, ...updates, updatedAt: Date.now() });
  }
}
export async function removeBuilderLabel(id) { await initDB(); kvDelete('builder', id.toString()); }
export async function getBuilderLabels() { await initDB(); return kvGetAll('builder'); }
export async function clearBuilderWorkspace() { await initDB(); kvClear('builder'); }
export async function getBuilderCount() { await initDB(); return kvCount('builder'); }
export async function findBuilderLabelById(labelId, culture) {
  const all = await getBuilderLabels();
  return all.find(l => l.labelId === labelId && l.culture === culture) || null;
}

// Extraction Sessions
export async function saveExtractionSession(session) {
  await initDB();
  kvPut('extraction', session.sessionId, { ...session, updatedAt: Date.now() });
}
export async function getExtractionSession(sessionId) { await initDB(); return kvGet('extraction', sessionId); }
export async function getExtractionSessions() { await initDB(); return kvGetAll('extraction').sort((a,b)=>b.updatedAt - a.updatedAt); }
export async function removeExtractionSession(sessionId) { await initDB(); kvDelete('extraction', sessionId); }

// Builder Sessions
export async function saveBuilderSession(session) {
  await initDB();
  kvPut('sessions', session.id.toString(), { ...session, updatedAt: Date.now() });
}
export async function getBuilderSessions() { await initDB(); return kvGetAll('sessions').sort((a,b)=>b.updatedAt - a.updatedAt); }
export async function getBuilderSession(sessionId) { await initDB(); return kvGet('sessions', sessionId.toString()); }
export async function removeBuilderSession(sessionId) { await initDB(); kvDelete('sessions', sessionId.toString()); }

// Backups
export async function saveExtractionBackup(backup) {
  await initDB();
  kvPut('backups', backup.id.toString(), { ...backup, updatedAt: Date.now() });
}
export async function getExtractionBackups() { await initDB(); return kvGetAll('backups').sort((a,b)=>b.updatedAt - a.updatedAt); }
export async function pruneExtractionBackups(keepCount = 5) {
  const all = await getExtractionBackups();
  if (all.length > keepCount) {
    for (const b of all.slice(keepCount)) {
      kvDelete('backups', b.id.toString());
    }
  }
}

// Handles
export async function saveBloomFilter(model, culture, buffer) {
  await initDB();
  const id = `${model}|||${culture}`;
  kvPut('bloom_filters', id, { id, model, culture, buffer });
}

export async function getBloomFilter(model, culture) {
  await initDB();
  const id = `${model}|||${culture}`;
  return kvGet('bloom_filters', id);
}

export async function getLabelsByIds(ids) {
  await initDB();
  if (!ids || ids.length === 0) return [];
  
  const res = [];
  const placeholders = ids.map(() => '?').join(',');
  db.exec({
    sql: `SELECT * FROM labels WHERE id IN (${placeholders})`,
    bind: ids,
    rowMode: 'object',
    callback: function (row) { res.push(row); }
  });
  return res;
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

export async function hasData() {
  const count = await getLabelCount();
  return count > 0;
}

export async function getDB() {
  await initDB();
  return db;
}

export async function getRuntimeStorageMode() {
  await initDB();
  return runtimeStorageMode;
}

// Ensure the FTS search API exists for core/search.js
function sanitizeFtsToken(token) {
  const raw = String(token || '').toLowerCase();
  try {
    return raw.replace(/[^\p{L}\p{N}_]/gu, '');
  } catch (_err) {
    return raw.replace(/[^a-z0-9_]/g, '');
  }
}

function buildSearchTokens(query) {
  return String(query || '')
    .trim()
    .split(/\s+/)
    .map(sanitizeFtsToken)
    .filter(Boolean);
}

function buildFtsPrefixQuery(tokens) {
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((token) => `${token}*`).join(' AND ');
}

export async function searchFTS(query, limit = 50, offset = 0) {
  await initDB();
  const tokens = buildSearchTokens(query);
  const ftsQuery = buildFtsPrefixQuery(tokens);
  const res = [];

  if (ftsQuery) {
    db.exec({
      sql: 'SELECT labels.* FROM labels_fts JOIN labels ON labels.id = labels_fts.id WHERE labels_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?',
      bind: [ftsQuery, limit, offset],
      rowMode: 'object',
      callback: function (row) { res.push(row); }
    });
  }

  if (res.length === 0 && tokens.length > 0) {
    const likeClauses = tokens.map(() => 's LIKE ?').join(' AND ');
    const bind = [...tokens.map((token) => `%${token}%`), limit, offset];
    db.exec({
      sql: `SELECT * FROM labels WHERE ${likeClauses} LIMIT ? OFFSET ?`,
      bind,
      rowMode: 'object',
      callback: function (row) { res.push(row); }
    });
  }

  return res;
}

export const STORES = {
  LABELS: 'labels',
  METADATA: 'metadata',
  HANDLES: 'handles',
  CATALOG: 'catalog',
  BUILDER: 'builder_workspace',
  EXTRACTION: 'extraction_sessions',
  SESSIONS: 'builder_sessions',
  BACKUPS: 'extraction_backups',
  BLOOM_FILTERS: 'bloom_filters'
};

// Original DB constants for compatibility
export const DB_NAME_ORIG = DB_NAME;
export const DB_VERSION_ORIG = DB_VERSION;

