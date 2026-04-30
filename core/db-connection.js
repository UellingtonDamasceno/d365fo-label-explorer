import { DB_NAME, DB_VERSION } from './db-constants.js';

/**
 * Worker-safe DB open helper.
 * This module does not define schema; schema remains owned by core/db.js.
 */
export function openWorkerDB(options = {}) {
  const dbName = options.dbName || DB_NAME;
  const dbVersion = typeof options.dbVersion === 'number' ? options.dbVersion : DB_VERSION;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(new Error(`Worker DB open failed: ${request.error?.message || 'unknown'}`));
    };
    request.onblocked = () => {
      console.warn('[Worker] DB upgrade blocked. Waiting for schema update to complete...');
    };
  });
}

export { DB_NAME, DB_VERSION };

