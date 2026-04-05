/**
 * Indexer Worker - SPEC-23: Smart Batching Architecture
 * 
 * STRATEGY: "Search-First, Index-Later"
 * 1. Process priority languages first (en-US, pt-BR, pt-PT, es-CO)
 * 2. Fire-and-forget batch writes of 5000 labels (non-blocking)
 * 3. Emit PRIORITY_DONE when priority languages complete
 * 4. Continue background indexing at lower priority
 * 
 * KEY: Never await DB writes during parsing - fire and continue
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 3; // SPEC-23: Added catalog store

// Smart Batching Constants
const BATCH_SIZE = 5000;          // Write every 5000 labels
const FILE_CONCURRENCY = 3;       // Reduced to lower contention
const PROGRESS_INTERVAL = 10;     // Report every N files

// Priority languages (fast path)
const PRIORITY_CULTURES = ['en-US', 'pt-BR', 'pt-PT', 'es-CO'];

let db = null;
let pendingWrites = [];           // Track fire-and-forget promises

/**
 * Initialize IndexedDB connection in worker
 */
async function initDB() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error('Worker: Failed to open IndexedDB'));
    
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Labels store
      if (database.objectStoreNames.contains('labels')) {
        database.deleteObjectStore('labels');
      }
      const labelsStore = database.createObjectStore('labels', { keyPath: 'id' });
      labelsStore.createIndex('fullId', 'fullId', { unique: false });
      labelsStore.createIndex('culture', 'culture', { unique: false });
      labelsStore.createIndex('model', 'model', { unique: false });
      labelsStore.createIndex('prefix', 'prefix', { unique: false });

      // Metadata store
      if (!database.objectStoreNames.contains('metadata')) {
        database.createObjectStore('metadata', { keyPath: 'key' });
      }

      // Handles store
      if (!database.objectStoreNames.contains('handles')) {
        database.createObjectStore('handles', { keyPath: 'id' });
      }

      // SPEC-23: Catalog store (for virtual catalog)
      if (!database.objectStoreNames.contains('catalog')) {
        const catalogStore = database.createObjectStore('catalog', { keyPath: 'id' });
        catalogStore.createIndex('culture', 'culture', { unique: false });
        catalogStore.createIndex('status', 'status', { unique: false });
      }
    };
  });
}

/**
 * SPEC-23: Fire-and-forget batch save (non-blocking)
 * Returns promise but caller doesn't await it during parsing
 */
function saveBatchFireAndForget(labels) {
  if (!labels.length) return Promise.resolve(0);
  
  const promise = new Promise((resolve, reject) => {
    const tx = db.transaction('labels', 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore('labels');

    for (let i = 0; i < labels.length; i++) {
      store.put(labels[i]);
    }

    tx.oncomplete = () => resolve(labels.length);
    tx.onerror = () => {
      console.error('Batch save error:', tx.error);
      resolve(0); // Don't reject - fire and forget
    };
  });
  
  pendingWrites.push(promise);
  return promise;
}

/**
 * Wait for all pending writes to complete
 */
async function flushPendingWrites() {
  if (pendingWrites.length === 0) return;
  await Promise.all(pendingWrites);
  pendingWrites = [];
}

/**
 * Parse a single file and return labels array (pure CPU, no I/O blocking)
 */
function parseFileContent(content, metadata) {
  const { model, culture, prefix, sourcePath } = metadata;
  const labels = [];
  
  const lines = content.split('\n');
  const lineCount = lines.length;
  
  let currentLabel = null;
  
  for (let i = 0; i < lineCount; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    
    if (!line) continue;
    
    // Help line check (starts with " ;")
    if (line.charCodeAt(0) === 32 && line.charCodeAt(1) === 59) {
      if (currentLabel) {
        const helpText = line.slice(2).trim();
        if (helpText) {
          currentLabel.help = currentLabel.help 
            ? currentLabel.help + ' ' + helpText 
            : helpText;
        }
      }
      continue;
    }
    
    if (currentLabel) {
      labels.push(currentLabel);
      currentLabel = null;
    }
    
    const equalsIndex = line.indexOf('=');
    if (equalsIndex > 0 && line.charCodeAt(0) !== 32) {
      const labelId = line.slice(0, equalsIndex);
      const text = line.slice(equalsIndex + 1);
      
      if (labelId && labelId.charCodeAt(0) !== 32) {
        currentLabel = {
          id: `${model}|${culture}|${prefix}|${labelId}`,
          fullId: `@${prefix}:${labelId}`,
          labelId,
          text,
          help: '',
          model,
          culture,
          prefix,
          sourcePath
        };
      }
    }
  }
  
  if (currentLabel) {
    labels.push(currentLabel);
  }
  
  return labels;
}

/**
 * Process a single file (read + parse)
 */
async function processFile({ handle, metadata }) {
  try {
    const startedAt = Date.now();
    const perfStart = performance.now();
    const file = await handle.getFile();
    const sizeBytes = file.size || 0;
    const content = await file.text();
    const labels = parseFileContent(content, metadata);
    const durationMs = Math.max(0, performance.now() - perfStart);
    const endedAt = Date.now();
    return {
      success: true,
      labels,
      file: metadata.sourcePath,
      model: metadata.model,
      culture: metadata.culture,
      timing: {
        startedAt,
        endedAt,
        durationMs,
        sizeBytes
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      file: metadata.sourcePath,
      model: metadata.model,
      culture: metadata.culture,
      timing: null
    };
  }
}

/**
 * SPEC-23: Main processing with Smart Batching & Priority Support
 */
async function processFilesWithHandles(files, isPriority = false, streamOptions = null) {
  const startTime = performance.now();
  let processedFiles = 0;
  let totalLabels = 0;
  let errors = [];
  
  // Smart batch buffer (max 5000 labels)
  let batchBuffer = [];
  const pairStats = new Map();
  let streamRemaining = streamOptions?.enabled ? (streamOptions.limit || 0) : 0;
  
  // Initialize DB
  await initDB();
  
  const mode = isPriority ? '🚀 PRIORITY' : '📦 BACKGROUND';
  console.log(`👷 Worker ${mode}: ${files.length} files`);

  // Pre-register model/culture totals for granular progress
  for (const fileTask of files) {
    const model = fileTask.metadata.model;
    const culture = fileTask.metadata.culture;
    const key = `${model}|||${culture}`;
    if (!pairStats.has(key)) {
        pairStats.set(key, {
          key,
          model,
          culture,
          fileCount: 0,
          processedFiles: 0,
          labelCount: 0,
          totalProcessingMs: 0,
          totalBytes: 0,
          firstStartedAt: null,
          lastEndedAt: null
        });
      }
      pairStats.get(key).fileCount += 1;
  }
  
  // Process files with controlled concurrency
  for (let i = 0; i < files.length; i += FILE_CONCURRENCY) {
    const chunk = files.slice(i, i + FILE_CONCURRENCY);
    const results = await Promise.all(chunk.map(processFile));
    
    for (const result of results) {
      processedFiles++;
      
      if (result.success && result.labels.length > 0) {
        if (streamRemaining > 0 && isPriority) {
          const streamBatch = result.labels.slice(0, streamRemaining);
          if (streamBatch.length > 0) {
            self.postMessage({
              type: 'STREAM_LABELS',
              labels: streamBatch
            });
            streamRemaining -= streamBatch.length;
          }
        }

        // Add to batch buffer
        for (const label of result.labels) {
          batchBuffer.push(label);
        }
        
        // SPEC-23: Fire-and-forget when batch is full
        if (batchBuffer.length >= BATCH_SIZE) {
          saveBatchFireAndForget([...batchBuffer]); // Clone and fire
          totalLabels += batchBuffer.length;
          batchBuffer = []; // Reset immediately (non-blocking)
        }
      } else if (!result.success) {
        errors.push({ file: result.file, error: result.error });
      }

      const pairKey = `${result.model}|||${result.culture}`;
      const pairEntry = pairStats.get(pairKey);
      if (pairEntry) {
        pairEntry.processedFiles += 1;
        pairEntry.labelCount += result.success ? result.labels.length : 0;
        if (result.timing) {
          pairEntry.totalProcessingMs += result.timing.durationMs || 0;
          pairEntry.totalBytes += result.timing.sizeBytes || 0;
          if (!pairEntry.firstStartedAt || result.timing.startedAt < pairEntry.firstStartedAt) {
            pairEntry.firstStartedAt = result.timing.startedAt;
          }
          if (!pairEntry.lastEndedAt || result.timing.endedAt > pairEntry.lastEndedAt) {
            pairEntry.lastEndedAt = result.timing.endedAt;
          }
        }
      }
    }
    
    // Progress update
    if (processedFiles % PROGRESS_INTERVAL === 0 || processedFiles === files.length) {
      self.postMessage({
        type: 'PROGRESS',
        processedFiles,
        totalFiles: files.length,
        totalLabels: totalLabels + batchBuffer.length,
        pairProgress: [...pairStats.values()],
        isPriority,
        phase: 'indexing'
      });
    }
  }
  
  // Flush remaining batch
  if (batchBuffer.length > 0) {
    saveBatchFireAndForget([...batchBuffer]);
    totalLabels += batchBuffer.length;
    batchBuffer = [];
  }
  
  // Wait for all pending writes to complete
  console.time('⏱️ Flush Pending Writes');
  await flushPendingWrites();
  console.timeEnd('⏱️ Flush Pending Writes');
  
  const elapsed = performance.now() - startTime;
  console.log(`✅ Worker ${mode} done: ${totalLabels} labels in ${(elapsed/1000).toFixed(1)}s`);
  
  // Send completion
  self.postMessage({
    type: isPriority ? 'PRIORITY_DONE' : 'COMPLETE',
    totalLabels,
    processedFiles,
    pairProgress: [...pairStats.values()],
    errors,
    elapsed,
    labelsPerSec: elapsed > 0 ? Math.round(totalLabels / (elapsed / 1000)) : 0
  });
}

/**
 * Legacy: Process file from content string
 */
async function processFileFromContent(content, metadata) {
  await initDB();
  const labels = parseFileContent(content, metadata);
  
  if (labels.length > 0) {
    await saveBatchFireAndForget(labels);
    await flushPendingWrites();
  }

  return { success: true, labels: labels.length };
}

/**
 * Process single file with handle
 */
async function processFileFast(fileHandle, metadata) {
  const startTime = performance.now();
  
  try {
    await initDB();
    
    const file = await fileHandle.getFile();
    const content = await file.text();
    const labels = parseFileContent(content, metadata);
    
    if (labels.length > 0) {
      await saveBatchFireAndForget(labels);
      await flushPendingWrites();
    }
    
    const elapsed = performance.now() - startTime;
    
    return {
      success: true,
      labels: labels.length,
      elapsed,
      labelsPerSec: elapsed > 0 ? Math.round(labels.length / (elapsed / 1000)) : 0
    };
  } catch (error) {
    return { success: false, error: error.message, file: metadata.sourcePath };
  }
}

// Worker message handler
self.onmessage = async function(event) {
  const { type, files, handle, content, metadata, isPriority, streamLabels, streamLimit } = event.data;

  switch (type) {
    case 'PROCESS_FILES_HANDLES':
      await processFilesWithHandles(files, isPriority || false, {
        enabled: Boolean(streamLabels),
        limit: streamLimit || 0
      });
      break;
    
    case 'PROCESS_PRIORITY_FILES':
      // SPEC-23: Explicit priority processing
      await processFilesWithHandles(files, true, {
        enabled: Boolean(streamLabels),
        limit: streamLimit || 0
      });
      break;
      
    case 'PROCESS_FILE_HANDLE':
      try {
        const result = await processFileFast(handle, metadata);
        self.postMessage({ type: 'FILE_RESULT', ...result, file: metadata.sourcePath });
      } catch (error) {
        self.postMessage({ type: 'FILE_RESULT', success: false, error: error.message, file: metadata.sourcePath });
      }
      break;
      
    case 'PROCESS_FILE':
      try {
        const result = await processFileFromContent(content, metadata);
        self.postMessage({ type: 'FILE_RESULT', ...result, file: metadata.sourcePath });
      } catch (error) {
        self.postMessage({ type: 'FILE_RESULT', success: false, error: error.message, file: metadata.sourcePath });
      }
      break;
      
    case 'INIT_DB':
      try {
        await initDB();
        self.postMessage({ type: 'DB_READY' });
      } catch (error) {
        self.postMessage({ type: 'DB_ERROR', error: error.message });
      }
      break;
  }
};
