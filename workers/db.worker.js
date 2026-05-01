/**
 * Centralized Database Worker - SPEC-11 Extension
 * Handles all SQLite operations (OPFS) in a dedicated background thread.
 */
console.log('[DB Worker] Script starting...');

import sqlite3InitModule from '../libs/sqlite/sqlite3.mjs';

// SPEC-11: Resolve paths relative to the worker location
const BASE_URL = new URL('../libs/sqlite/', import.meta.url).href;
globalThis.sqlite3InitModuleState = {
    sqlite3Dir: BASE_URL,
    debugModule: () => {} // Required by the library to avoid TypeError
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
        sqlite3 = await sqlite3InitModule({
            print: (...args) => console.log('[SQLite]', ...args),
            printErr: (...args) => console.error('[SQLite Error]', ...args),
            locateFile: (file) => new URL(file, BASE_URL).href
        });

        if (sqlite3.oo1.OpfsDb) {
            try {
                db = new sqlite3.oo1.OpfsDb('/' + DB_NAME, 'c');
                console.log('[DB Worker] OPFS Database initialized:', db.filename);
                db.exec('PRAGMA synchronous = NORMAL; PRAGMA journal_mode = WAL;');
            } catch (opfsErr) {
                console.warn('[DB Worker] OPFS creation failed, falling back to memory:', opfsErr);
                db = new sqlite3.oo1.DB('/' + DB_NAME, 'c');
            }
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
        
        CREATE TABLE IF NOT EXISTS kv_store (
            store_name TEXT,
            key TEXT,
            value JSON,
            PRIMARY KEY (store_name, key)
        );
        
        CREATE VIRTUAL TABLE IF NOT EXISTS labels_fts USING fts5(
            id UNINDEXED,
            s,
            tokenize='unicode61',
            prefix='2 3 4'
        );
    `);
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

            case 'ADD_LABELS':
                db.exec('BEGIN TRANSACTION;');
                try {
                    const stmt = db.prepare(`INSERT OR REPLACE INTO labels VALUES (?,?,?,?,?,?,?,?,?,?)`);
                    const ftsStmt = db.prepare(`INSERT INTO labels_fts(id, s) VALUES (?,?)`);
                    const ftsDelStmt = db.prepare(`DELETE FROM labels_fts WHERE id = ?`);

                    for (const l of payload.labels) {
                        stmt.bind([l.id, l.fullId, l.labelId, l.text, l.help, l.model, l.culture, l.prefix, l.sourcePath, l.s]);
                        stmt.step();
                        stmt.reset();

                        ftsDelStmt.bind([l.id]);
                        ftsDelStmt.step();
                        ftsDelStmt.reset();

                        if (l.s) {
                            ftsStmt.bind([l.id, l.s]);
                            ftsStmt.step();
                            ftsStmt.reset();
                        }
                    }
                    stmt.finalize(); 
                    ftsStmt.finalize(); 
                    ftsDelStmt.finalize();
                    db.exec('COMMIT;');
                    result = { count: payload.labels.length };
                } catch (err) {
                    db.exec('ROLLBACK;');
                    throw err;
                }
                break;

            case 'SEARCH_FTS':
                result = db.exec({
                    sql: `SELECT labels.* FROM labels_fts JOIN labels ON labels.id = labels_fts.id 
                          WHERE labels_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?`,
                    bind: [payload.query, payload.limit || 50, payload.offset || 0],
                    rowMode: 'object',
                    returnValue: 'resultRows'
                });
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
