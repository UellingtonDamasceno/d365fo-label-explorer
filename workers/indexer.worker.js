/**
 * Indexer Worker - SPEC-23: Smart Batching Architecture
 * SPEC-42: Bloom Filter & FlexSearch Export
 */

// SPEC-42: Use importScripts for global libraries (more compatible than ESM in workers)
importScripts('../libs/flexsearch.bundle.min.js');
importScripts('../utils/bloom-filter.js');
importScripts('./utils/label-parser.js');

let runtimeDbName = null;
let runtimeDbVersion = null;

// Smart Batching Constants
const BATCH_SIZE = 5000;          // Write every 5000 labels
const FILE_CONCURRENCY = 3;       // Reduced to lower contention
const PROGRESS_INTERVAL = 10;     // Report every N files

let db = null;
let pendingWrites = [];           // Track fire-and-forget promises

/**
 * Initialize IndexedDB connection in worker
 */
async function initDB() {
  if (db) return db;
  if (!runtimeDbName || typeof runtimeDbVersion !== 'number') {
    throw new Error('Worker DB configuration missing. Pass dbName and dbVersion from app.js.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(runtimeDbName, runtimeDbVersion);

    request.onerror = () => reject(new Error('Worker: Failed to open IndexedDB'));
    
    request.onsuccess = () => {
      db = request.result;
      db.onversionchange = () => {
        db.close();
        db = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      console.warn('[Indexer Worker] DB open blocked by another tab/upgrade.');
    };
  });
}

/**
 * SPEC-23: Fire-and-forget batch save (non-blocking)
 * Returns promise but caller doesn't await it during parsing
 */
function saveBatchFireAndForget(labels, affectedPairs = null) {
  if (!labels.length) return Promise.resolve(0);
  
  const writeStart = performance.now();
  const promise = new Promise((resolve) => {
    const tx = db.transaction('labels', 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore('labels');

    for (let i = 0; i < labels.length; i++) {
      store.put(labels[i]);
    }

    tx.oncomplete = () => {
      const duration = performance.now() - writeStart;
      // If we have pair stats, distribute the write time
      if (affectedPairs) {
        const share = duration / affectedPairs.length;
        for (const pair of affectedPairs) {
          pair.totalProcessingMs += share;
        }
      }
      resolve(labels.length);
    };
    tx.onerror = () => {
      const err = tx.error;
      const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22;
      self.postMessage({
        type: 'DB_ERROR',
        error: err?.message || 'Unknown DB error',
        isQuota,
        labelsLost: labels.length
      });
      resolve(0); // Keep fire-and-forget behavior
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
 * SPEC-42: Save exported FlexSearch data to IndexedDB
 */
function saveSearchIndexExport(model, culture, key, data) {
  const promise = new Promise((resolve) => {
    const tx = db.transaction('search_indices', 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore('search_indices');
    store.put({
      id: `${model}|||${culture}|||${key}`,
      model,
      culture,
      key,
      data
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // Fire and forget
  });
  pendingWrites.push(promise);
}

/**
 * SPEC-42: Save Bloom Filter buffer to IndexedDB
 */
function saveBloomFilter(model, culture, buffer) {
  const promise = new Promise((resolve) => {
    const tx = db.transaction('bloom_filters', 'readwrite', { durability: 'relaxed' });
    const store = tx.objectStore('bloom_filters');
    store.put({
      id: `${model}|||${culture}`,
      model,
      culture,
      buffer
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve(); // Fire and forget
  });
  pendingWrites.push(promise);
}

/**
 * Parse a single file and return labels array (pure CPU, no I/O blocking)
 */
function parseFileContent(content, metadata) {
  const labels = self.SharedLabelParser.parseLabelFile(content, metadata);
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const normalizedText = (label.text || '').toLowerCase();
    const normalizedId = (label.labelId || '').toLowerCase();
    const searchTarget = `${normalizedId} ${normalizedText}`.trim();
    label.s = searchTarget;
    label.tokens = [...new Set(searchTarget.split(/[\W_]+/).filter((t) => t.length > 2))];
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
  
  // SPEC-42: Global Bloom Filter for cross-model searches
  const globalBloomFilter = new BloomFilter({ expectedItems: 1000000, falsePositiveRate: 0.01 });
  
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
        // SPEC-42: Initialize Bloom Filter and FlexSearch for this pair
        const flexIndex = new self.FlexSearch.Document({
          document: { id: 'id', index: ['searchTarget'], store: true },
          tokenize: 'forward', resolution: 9, cache: true
        });
        
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
          lastEndedAt: null,
          bloomFilter: new BloomFilter({ expectedItems: 50000, falsePositiveRate: 0.01 }),
          flexIndex: flexIndex
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
      const pairKey = `${result.model}|||${result.culture}`;
      const pairEntry = pairStats.get(pairKey);
      
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

        // Add to batch buffer and populate Search Structures
        for (const label of result.labels) {
          batchBuffer.push(label);
          
          // SPEC-42: Populate Global Bloom Filter
          globalBloomFilter.addText(label.text);
          globalBloomFilter.addText(label.labelId);
          globalBloomFilter.addText(label.help);

          if (pairEntry) {
            // SPEC-42: Populate Local Bloom Filter
            pairEntry.bloomFilter.addText(label.text);
            pairEntry.bloomFilter.addText(label.labelId);
            pairEntry.bloomFilter.addText(label.help);
            
            // SPEC-42: Populate FlexSearch
            pairEntry.flexIndex.add({
              ...label,
              searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
            });
          }
        }
        
        // SPEC-23: Fire-and-forget when batch is full
        if (batchBuffer.length >= BATCH_SIZE) {
          // Identify cultures in this batch to attribute write time
          const batchPairs = [...new Set(batchBuffer.map(l => `${l.model}|||${l.culture}`))]
            .map(key => pairStats.get(key))
            .filter(Boolean);
            
          saveBatchFireAndForget([...batchBuffer], batchPairs); // Clone and fire
          totalLabels += batchBuffer.length;
          batchBuffer = []; // Reset immediately (non-blocking)
        }
      } else if (!result.success) {
        errors.push({ file: result.file, error: result.error });
      }

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
        // SPEC-42: Don't send complex objects over postMessage
        pairProgress: [...pairStats.values()].map(({bloomFilter, flexIndex, ...rest}) => rest),
        isPriority,
        phase: 'indexing'
      });
    }
  }
  
  // Flush remaining batch
  if (batchBuffer.length > 0) {
    const finalBatchPairs = [...new Set(batchBuffer.map(l => `${l.model}|||${l.culture}`))]
      .map(key => pairStats.get(key))
      .filter(Boolean);
      
    saveBatchFireAndForget([...batchBuffer], finalBatchPairs);
    totalLabels += batchBuffer.length;
    batchBuffer = [];
  }
  
  // SPEC-42: Export FlexSearch indices and save Bloom Filters
  console.time('⏱️ Export Search Indices');
  for (const pair of pairStats.values()) {
    if (pair.labelCount > 0) {
      // Export Local Bloom Filter
      saveBloomFilter(pair.model, pair.culture, pair.bloomFilter.export());
      
      // Export FlexSearch
      await new Promise((resolve) => {
        let exportCount = 0;
        pair.flexIndex.export((key, data) => {
          saveSearchIndexExport(pair.model, pair.culture, key, data);
          exportCount++;
        });
        setTimeout(resolve, 500); 
      });
    }
  }
  
  // SPEC-42: Save Global Bloom Filter
  if (totalLabels > 0) {
    console.log('🌍 Saving Global Bloom Filter...');
    saveBloomFilter('global', 'all', globalBloomFilter.export());
  }
  console.timeEnd('⏱️ Export Search Indices');

  // Wait for all pending writes to complete
  console.time('⏱️ Flush Pending Writes');
  await flushPendingWrites();
  console.timeEnd('⏱️ Flush Pending Writes');
  
  // Final update of lastEndedAt for all pairs to include flush time
  const now = Date.now();
  for (const pair of pairStats.values()) {
    if (pair.processedFiles > 0) {
      pair.lastEndedAt = now;
    }
  }
  
  const elapsed = performance.now() - startTime;
  console.log(`✅ Worker ${mode} done: ${totalLabels} labels in ${(elapsed/1000).toFixed(1)}s`);
  
  // Send completion
  self.postMessage({
    type: isPriority ? 'PRIORITY_DONE' : 'COMPLETE',
    totalLabels,
    processedFiles,
    pairProgress: [...pairStats.values()].map(({bloomFilter, flexIndex, ...rest}) => rest),
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
  const { type, files, handle, content, metadata, isPriority, streamLabels, streamLimit, dbName, dbVersion } = event.data;

  if (dbName && dbName !== runtimeDbName) {
    runtimeDbName = dbName;
    if (db) {
      db.close();
      db = null;
    }
  }
  if (typeof dbVersion === 'number' && dbVersion !== runtimeDbVersion) {
    runtimeDbVersion = dbVersion;
    if (db) {
      db.close();
      db = null;
    }
  }
  if (!runtimeDbName || typeof runtimeDbVersion !== 'number') {
    self.postMessage({
      type: 'DB_ERROR',
      error: 'Worker DB configuration missing. Pass dbName and dbVersion before processing.'
    });
    return;
  }

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
