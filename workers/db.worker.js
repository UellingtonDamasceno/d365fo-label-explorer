/**
 * Centralized Database Worker - SPEC-11 Extension
 * Handles all SQLite operations (OPFS) in a dedicated background thread.
 */
console.log('[DB Worker] Starting bootstrap...');

// SPEC-11: We MUST set this state BEFORE the sqlite3 module loads.
// Since static imports are hoisted, we use a dynamic import below.
const BASE_URL = new URL('../libs/sqlite/', import.meta.url).href;
globalThis.sqlite3InitModuleState = {
    sqlite3Dir: BASE_URL,
    debugModule: (...args) => console.debug('[SQLite Debug]', ...args)
};

const DB_NAME = 'd365fo-labels';
let sqlite3 = null;
let db = null;

/**
 * Initialize SQLite within the Worker
 */
async function initSQLite() {
    if (db) return;
    
    console.log('[DB Worker] Initializing SQLite WASM...');
    try {
        // Dynamic import to ensure global state is ready
        const { default: sqlite3InitModule } = await import('../libs/sqlite/sqlite3.mjs');

        sqlite3 = await sqlite3InitModule({
            print: (...args) => console.log('[SQLite]', ...args),
            printErr: (...args) => console.error('[SQLite Error]', ...args),
            locateFile: (file) => new URL(file, BASE_URL).href
        });

        if (sqlite3.oo1.OpfsDb) {
            let retryCount = 0;
            const maxRetries = 3;
            
            while (retryCount < maxRetries) {
                try {
                    db = new sqlite3.oo1.OpfsDb('/' + DB_NAME, 'c');
                    console.log('[DB Worker] OPFS Database initialized:', db.filename);
                    db.exec('PRAGMA synchronous = NORMAL; PRAGMA journal_mode = WAL;');
                    break; 
                } catch (opfsErr) {
                    retryCount++;
                    if (opfsErr.message.includes('locked') || opfsErr.message.includes('NoModificationAllowedError')) {
                        console.warn(`[DB Worker] OPFS locked, retry ${retryCount}/${maxRetries}...`);
                        await new Promise(r => setTimeout(r, 200)); 
                        continue;
                    }
                    console.warn('[DB Worker] OPFS creation failed, falling back to memory:', opfsErr);
                    db = new sqlite3.oo1.DB('/' + DB_NAME, 'c');
                    break;
                }
            }
            if (!db) db = new sqlite3.oo1.DB('/' + DB_NAME, 'c');
        } else {
            db = new sqlite3.oo1.DB('/' + DB_NAME, 'c');
            console.warn('[DB Worker] OPFS NOT available (library limitation), using memory.');
        }

        setupSchema();
        return true;
    } catch (err) {
        console.error('[DB Worker] CRITICAL initialization failure:', err);
        throw err;
    }
}

function setupSchema() {
    let rebuildFTS = false;
    
    try {
        // Check FTS integrity - SPEC-11 Repair Logic
        db.exec("INSERT INTO labels_fts(labels_fts) VALUES('integrity-check');");
    } catch (e) {
        console.warn('[DB Worker] FTS corrupted or missing, marked for rebuild:', e.message);
        rebuildFTS = true;
    }

    if (rebuildFTS) {
        try {
            console.log('[DB Worker] Rebuilding FTS system...');
            db.exec(`
                DROP TRIGGER IF EXISTS labels_ai;
                DROP TRIGGER IF EXISTS labels_ad;
                DROP TRIGGER IF EXISTS labels_au;
                DROP TABLE IF EXISTS labels_fts;
            `);
        } catch (e) {
            console.error('[DB Worker] Critical failure during FTS drop:', e);
            // If we can't even drop FTS, the whole DB might be toast
            // But we try to proceed
        }
    }

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
        CREATE INDEX IF NOT EXISTS idx_labels_labelId_nocase ON labels(labelId COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_labels_text_nocase ON labels(text COLLATE NOCASE);
        
        CREATE TABLE IF NOT EXISTS kv_store (
            store_name TEXT,
            key TEXT,
            value JSON,
            PRIMARY KEY (store_name, key)
        );

        CREATE TABLE IF NOT EXISTS kv_blobs (
            store_name TEXT,
            key TEXT,
            value BLOB,
            PRIMARY KEY (store_name, key)
        );
        
        -- Contentless-delete FTS5
        CREATE VIRTUAL TABLE IF NOT EXISTS labels_fts USING fts5(
            id UNINDEXED,
            s,
            content='labels',
            tokenize='unicode61',
            prefix='2 3 4'
        );

        -- Triggers to keep FTS in sync
        CREATE TRIGGER IF NOT EXISTS labels_ai AFTER INSERT ON labels BEGIN
            INSERT INTO labels_fts(rowid, id, s) VALUES (new.rowid, new.id, new.s);
        END;
        CREATE TRIGGER IF NOT EXISTS labels_ad AFTER DELETE ON labels BEGIN
            INSERT INTO labels_fts(labels_fts, rowid, id, s) VALUES ('delete', old.rowid, old.id, old.s);
        END;
        CREATE TRIGGER IF NOT EXISTS labels_au AFTER UPDATE ON labels BEGIN
            INSERT INTO labels_fts(labels_fts, rowid, id, s) VALUES ('delete', old.rowid, old.id, old.s);
            INSERT INTO labels_fts(rowid, id, s) VALUES (new.rowid, new.id, new.s);
        END;
    `);

    // If we just recreated the FTS table, repopulate it from the labels table
    if (rebuildFTS) {
        try {
            console.log('[DB Worker] Repopulating FTS index...');
            db.exec(`
                INSERT INTO labels_fts(rowid, id, s)
                SELECT rowid, id, s FROM labels;
            `);
            console.log('[DB Worker] FTS repopulation complete.');
        } catch (e) {
            console.error('[DB Worker] FTS repopulation failed:', e);
        }
    }
}

function toDistinctStringList(value) {
    const arr = Array.isArray(value) ? value : (value ? [value] : []);
    return [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))];
}

function buildInClause(column, values, bind) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const placeholders = values.map(() => '?').join(', ');
    bind.push(...values);
    return `${column} IN (${placeholders})`;
}

function buildSearchLabelsQuery(payload = {}) {
    const rawQuery = String(payload.query || '').trim();
    const lowerQuery = rawQuery.toLowerCase();
    const exactMatch = !!payload.exactMatch;
    const limit = Math.min(500, Math.max(1, Number(payload.limit) || 100));
    const offset = Math.max(0, Number(payload.offset) || 0);
    const cultures = toDistinctStringList(payload.cultures);
    const models = toDistinctStringList(payload.models);

    let mode = !lowerQuery ? 'all' : (exactMatch ? 'exact' : (lowerQuery.length > 2 ? 'fts' : 'like'));
    let ftsQuery = '';

    if (mode === 'fts') {
        const sanitized = lowerQuery.replace(/[^\w\s*]/g, ' ').trim();
        const tokens = sanitized.split(/\s+/).filter(Boolean);
        if (tokens.length === 0) {
            mode = 'like';
        } else {
            ftsQuery = tokens.map(t => `${t}*`).join(' AND ');
        }
    }

    const bind = [];
    const where = [];
    let sql = mode === 'fts'
        ? `SELECT labels.* FROM labels_fts
           JOIN labels ON labels.rowid = labels_fts.rowid`
        : 'SELECT labels.* FROM labels';

    if (mode === 'fts' && ftsQuery) {
        where.push('labels_fts MATCH ?');
        bind.push(ftsQuery);
    } else if (mode === 'exact' && lowerQuery) {
        where.push('(labels.labelId = ? COLLATE NOCASE OR labels.text = ? COLLATE NOCASE)');
        bind.push(rawQuery, rawQuery);
    } else if (mode === 'like' && lowerQuery) {
        const prefix = `${lowerQuery}%`;
        where.push('(labels.labelId LIKE ? COLLATE NOCASE OR labels.text LIKE ? COLLATE NOCASE)');
        bind.push(prefix, prefix);
    }

    const cultureClause = buildInClause('labels.culture', cultures, bind);
    if (cultureClause) where.push(cultureClause);

    const modelClause = buildInClause('labels.model', models, bind);
    if (modelClause) where.push(modelClause);

    if (where.length > 0) {
        sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += mode === 'fts' ? ' ORDER BY rank' : ' ORDER BY labels.rowid DESC';
    sql += ' LIMIT ? OFFSET ?';
    bind.push(limit, offset);

    return { sql, bind };
}

/**
 * Message Handler
 */
self.onmessage = async (e) => {
    const { id, type, ...payload } = e.data;
    
    try {
        if (!db && type !== 'INIT') {
            await initSQLite();
        }

        let result;
        switch (type) {
            case 'CONNECT_PIPE':
                const port = payload.port;
                port.onmessage = async (pe) => {
                    const { type: pType, labels, batchId } = pe.data;
                    if (pType === 'ADD_LABELS') {
                        try {
                            db.exec('BEGIN TRANSACTION;');
                            const stmt = db.prepare(`INSERT OR REPLACE INTO labels VALUES (?,?,?,?,?,?,?,?,?,?)`);
                            for (const l of labels) {
                                stmt.bind([l.id, l.fullId, l.labelId, l.text, l.help, l.model, l.culture, l.prefix, l.sourcePath, l.s]);
                                stmt.step();
                                stmt.reset();
                            }
                            stmt.finalize();
                            db.exec('COMMIT;');
                            port.postMessage({ type: 'DB_WRITE_ACK', batchId });
                        } catch (err) {
                            db.exec('ROLLBACK;');
                            console.error('[DB Worker] Pipe error:', err);
                        }
                    }
                };
                return; // No result message needed for pipe connection

            case 'INIT':
                await initSQLite();
                result = { status: 'ready', mode: sqlite3.oo1.OpfsDb ? 'opfs' : 'memory' };
                break;

            case 'EXEC':
                result = db.exec({
                    sql: payload.sql,
                    bind: payload.bind,
                    rowMode: payload.rowMode || 'object',
                    returnValue: 'resultRows'
                });
                break;

            case 'CLEAR_LABELS':
                db.exec('BEGIN TRANSACTION;');
                try {
                    // Use a more robust way to clear everything
                    // Drop triggers first to avoid overhead during bulk delete
                    db.exec(`
                        DROP TRIGGER IF EXISTS labels_ai;
                        DROP TRIGGER IF EXISTS labels_ad;
                        DROP TRIGGER IF EXISTS labels_au;
                        
                        -- FTS5 'delete-all' is the fastest and safest way to purge the index
                        INSERT INTO labels_fts(labels_fts) VALUES('delete-all');
                        
                        -- Clear the main table
                        DELETE FROM labels;
                        
                        -- Recreate triggers
                        CREATE TRIGGER IF NOT EXISTS labels_ai AFTER INSERT ON labels BEGIN
                            INSERT INTO labels_fts(rowid, id, s) VALUES (new.rowid, new.id, new.s);
                        END;
                        CREATE TRIGGER IF NOT EXISTS labels_ad AFTER DELETE ON labels BEGIN
                            INSERT INTO labels_fts(labels_fts, rowid, id, s) VALUES ('delete', old.rowid, old.id, old.s);
                        END;
                        CREATE TRIGGER IF NOT EXISTS labels_au AFTER UPDATE ON labels BEGIN
                            INSERT INTO labels_fts(labels_fts, rowid, id, s) VALUES ('delete', old.rowid, old.id, old.s);
                            INSERT INTO labels_fts(rowid, id, s) VALUES (new.rowid, new.id, new.s);
                        END;
                    `);
                    db.exec('COMMIT;');
                    result = { success: true };
                } catch (err) {
                    db.exec('ROLLBACK;');
                    // If everything fails, try the nuclear option: DROP and CREATE
                    console.warn('[DB Worker] CLEAR_LABELS failed, trying DROP recovery...', err.message);
                    try {
                        db.exec(`
                            DROP TABLE IF EXISTS labels_fts;
                            DROP TABLE IF EXISTS labels;
                        `);
                        setupSchema();
                        result = { success: true, recovered: true };
                    } catch (fatal) {
                        console.error('[DB Worker] CLEAR_LABELS fatal recovery failure:', fatal);
                        throw fatal;
                    }
                }
                break;

            case 'ADD_LABELS':
                db.exec('BEGIN TRANSACTION;');
                try {
                    // With triggers, we only need to insert into the labels table.
                    // SQLite handles the FTS indexing automatically and efficiently.
                    const stmt = db.prepare(`INSERT OR REPLACE INTO labels VALUES (?,?,?,?,?,?,?,?,?,?)`);

                    for (const l of payload.labels) {
                        stmt.bind([l.id, l.fullId, l.labelId, l.text, l.help, l.model, l.culture, l.prefix, l.sourcePath, l.s]);
                        stmt.step();
                        stmt.reset();
                    }
                    stmt.finalize(); 
                    db.exec('COMMIT;');
                    result = { count: payload.labels.length };
                } catch (err) {
                    db.exec('ROLLBACK;');
                    throw err;
                }
                break;

            case 'SEARCH_LABELS':
                {
                    const { sql, bind } = buildSearchLabelsQuery(payload);
                    result = db.exec({
                        sql,
                        bind,
                        rowMode: 'object',
                        returnValue: 'resultRows'
                    });
                }
                break;

            case 'SEARCH_FTS':
                // Join is required for contentless-delete tables to get original columns
                // FIXED: Join on rowid instead of id (which is TEXT)
                result = db.exec({
                    sql: `SELECT labels.* FROM labels_fts 
                          JOIN labels ON labels.rowid = labels_fts.rowid 
                          WHERE labels_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
                    bind: [payload.query, payload.limit || 50, payload.offset || 0],
                    rowMode: 'object',
                    returnValue: 'resultRows'
                });
                break;

            case 'KV_GET_BLOB':
                const blobRows = db.exec({
                    sql: 'SELECT value FROM kv_blobs WHERE store_name = ? AND key = ?',
                    bind: [payload.store, payload.key],
                    rowMode: 'array',
                    returnValue: 'resultRows'
                });
                result = blobRows.length ? blobRows[0][0] : null;
                break;

            case 'KV_PUT_BLOB':
                db.exec({
                    sql: 'INSERT OR REPLACE INTO kv_blobs (store_name, key, value) VALUES (?, ?, ?)',
                    bind: [payload.store, payload.key, payload.value]
                });
                result = { success: true };
                break;

            case 'CATALOG_BULK_PROGRESS':
                {
                    const updates = Array.isArray(payload.updates) ? payload.updates : [];
                    if (updates.length === 0) {
                        result = { applied: 0 };
                        break;
                    }

                    let applied = 0;
                    db.exec('BEGIN TRANSACTION;');
                    try {
                        for (const update of updates) {
                            const id = update?.id;
                            if (!id) continue;
                            const key = String(id);

                            try {
                                const existingRows = db.exec({
                                    sql: 'SELECT value FROM kv_store WHERE store_name = ? AND key = ?',
                                    bind: ['catalog', key],
                                    rowMode: 'array',
                                    returnValue: 'resultRows'
                                });
                                if (existingRows.length === 0) continue;

                                const entry = JSON.parse(existingRows[0][0]);
                                entry.processedFiles = update.processedFiles;
                                if (typeof entry.fileCount === 'number') {
                                    if (update.processedFiles <= 0) entry.status = 'waiting';
                                    else if (update.processedFiles >= entry.fileCount) entry.status = 'ready';
                                    else entry.status = 'indexing';
                                }
                                if (update.labelCount !== null && update.labelCount !== undefined) entry.labelCount = update.labelCount;
                                if (update.metrics && typeof update.metrics === 'object') Object.assign(entry, update.metrics);
                                entry.updatedAt = Date.now();

                                db.exec({
                                    sql: 'INSERT OR REPLACE INTO kv_store (store_name, key, value) VALUES (?, ?, ?)',
                                    bind: ['catalog', key, JSON.stringify(entry)]
                                });
                                applied++;
                            } catch (entryErr) {
                                console.warn('[DB Worker] CATALOG_BULK_PROGRESS skipped entry:', key, entryErr);
                            }
                        }

                        db.exec('COMMIT;');
                        result = { applied };
                    } catch (err) {
                        db.exec('ROLLBACK;');
                        throw err;
                    }
                }
                break;

            case 'KV_GET':
                const rows = db.exec({
                    sql: 'SELECT value FROM kv_store WHERE store_name = ? AND key = ?',
                    bind: [payload.store, payload.key],
                    rowMode: 'array',
                    returnValue: 'resultRows'
                });
                result = rows.length ? JSON.parse(rows[0][0]) : null;
                break;

            case 'KV_GET_ALL':
                const allRows = db.exec({
                    sql: 'SELECT value FROM kv_store WHERE store_name = ?',
                    bind: [payload.store],
                    rowMode: 'array',
                    returnValue: 'resultRows'
                });
                result = allRows.map(r => JSON.parse(r[0]));
                break;

            case 'KV_PUT':
                db.exec({
                    sql: 'INSERT OR REPLACE INTO kv_store (store_name, key, value) VALUES (?, ?, ?)',
                    bind: [payload.store, payload.key, JSON.stringify(payload.value)]
                });
                result = { success: true };
                break;

            case 'KV_DELETE':
                db.exec({
                    sql: 'DELETE FROM kv_store WHERE store_name = ? AND key = ?',
                    bind: [payload.store, payload.key]
                });
                result = { success: true };
                break;

            case 'KV_CLEAR':
                db.exec({
                    sql: 'DELETE FROM kv_store WHERE store_name = ?',
                    bind: [payload.store]
                });
                result = { success: true };
                break;

            default:
                throw new Error(`Unknown type: ${type}`);
        }

        self.postMessage({ id, type: 'RESULT', payload: result });
    } catch (err) {
        self.postMessage({ id, type: 'ERROR', error: err.message });
    }
};
