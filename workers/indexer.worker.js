/**
 * Indexer Worker - SPEC-23: Smart Batching Architecture
 * SPEC-42: Bloom Filter Export
 */

// SPEC-42: Use imports for module workers
import '../utils/bloom-filter.js';
import './utils/label-parser.js';

let runtimeDbName = null;
let runtimeDbVersion = null;

// Smart Batching Constants
const BATCH_SIZE = 250;           // Reduced from 1000 to prevent RAM spikes and lock OPFS less
const FILE_CONCURRENCY = 2;       // Reduced to 2 to limit concurrent stream overhead
const PROGRESS_INTERVAL = 10;     // Report every N files
const MAX_PENDING_WRITES = 20;    // Apply backpressure before promise lists grow too much

let pendingWrites = new Set();    // Track in-flight writes only

/**
 * Initialize SQLite connection in worker
 */
async function initDB() {
  const { initDB: initSQLite } = await import('../core/db.js');
  return await initSQLite();
}

function normalizeLabelForSearch(label) {
  const normalizedText = (label.text || '').toLowerCase();
  const normalizedId = (label.labelId || '').toLowerCase();
  label.s = `${normalizedId} ${normalizedText}`.trim();
  return label;
}

function enrichLabelsForSearch(labels) {
  for (const label of labels) {
    normalizeLabelForSearch(label);
  }
  return labels;
}

async function parseFileLabels(file, metadata, onLabel) {
  const canStream = typeof self.SharedLabelParser?.parseLabelStream === 'function'
    && typeof file.stream === 'function'
    && typeof TextDecoderStream !== 'undefined';

  if (canStream) {
    const decodedStream = file.stream().pipeThrough(new TextDecoderStream());
    await self.SharedLabelParser.parseLabelStream(decodedStream, metadata, (label) => {
      onLabel(normalizeLabelForSearch(label));
    });
    return;
  }

  const content = await file.text();
  const labels = self.SharedLabelParser.parseLabelFile(content, metadata);
  for (const label of labels) {
    onLabel(normalizeLabelForSearch(label));
  }
}

/**
 * SPEC-23: Fire-and-forget batch save (non-blocking)
 * Updated to use SQLite via db.js proxy
 */
function saveBatchFireAndForget(labels, affectedPairs = null) {
  if (!labels.length) return Promise.resolve(0);
  
  const writeStart = performance.now();
  const promise = (async () => {
    try {
      const { addLabels } = await import('../core/db.js');
      await addLabels(labels);
      
      const duration = performance.now() - writeStart;
      if (affectedPairs) {
        const share = duration / affectedPairs.length;
        for (const pair of affectedPairs) {
          pair.totalProcessingMs += share;
        }
      }
      return labels.length;
    } catch (err) {
      const isQuota = err?.name === 'QuotaExceededError' || err?.code === 22;
      self.postMessage({
        type: 'DB_ERROR',
        error: err?.message || 'Unknown SQLite error',
        isQuota,
        labelsLost: labels.length
      });
      return 0;
    }
  })();
  
  let trackedPromise = null;
  trackedPromise = promise.finally(() => {
    pendingWrites.delete(trackedPromise);
  });
  pendingWrites.add(trackedPromise);
  return trackedPromise;
}

/**
 * Wait for all pending writes to complete
 */
async function flushPendingWrites() {
  if (pendingWrites.size === 0) return;
  await Promise.all([...pendingWrites]);
  pendingWrites.clear();
}

/**
 * Process a single file (read + parse)
 * Reads stream line by line, generating labels directly without accumulating in memory
 */
async function processFile({ handle, metadata }, onLabel) {
  try {
    const startedAt = Date.now();
    const perfStart = performance.now();
    const file = await handle.getFile();
    const sizeBytes = file.size || 0;
    let fileLabelCount = 0;

    await parseFileLabels(file, metadata, (label) => {
      fileLabelCount++;
      onLabel(label);
    });
    
    const durationMs = Math.max(0, performance.now() - perfStart);
    const endedAt = Date.now();
    
    return {
      success: true,
      labelCount: fileLabelCount,
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
  
  // Smart batch buffer
  let batchBuffer = [];
  const pairStats = new Map();
  let streamRemaining = streamOptions?.enabled ? (streamOptions.limit || 0) : 0;
  
  // Initialize DB
  await initDB();
  
  const mode = isPriority ? '🚀 PRIORITY' : '📦 BACKGROUND';
  console.log(`👷 Worker ${mode}: ${files.length} files`);

  const flushBatch = () => {
    if (batchBuffer.length === 0) return;
    // Identify cultures in this batch to attribute write time
    const batchPairs = [...new Set(batchBuffer.map(l => `${l.model}|||${l.culture}`))]
      .map(key => pairStats.get(key))
      .filter(Boolean);

    const labelsToPersist = batchBuffer;
    totalLabels += labelsToPersist.length;
    batchBuffer = []; // Reset immediately (non-blocking)
    saveBatchFireAndForget(labelsToPersist, batchPairs);
  };

  // Pre-register model/culture totals for granular progress
  for (const fileTask of files) {
    const model = fileTask.metadata.model;
    const culture = fileTask.metadata.culture;
    const key = `${model}|||${culture}`;
    if (!pairStats.has(key)) {
        // SPEC-42: Initialize Bloom Filter for this pair
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
          bloomFilter: new BloomFilter({ expectedItems: 50000, falsePositiveRate: 0.01 })
        });
      }
      pairStats.get(key).fileCount += 1;
  }
  
  // Process files with controlled concurrency
  for (let i = 0; i < files.length; i += FILE_CONCURRENCY) {
    const chunk = files.slice(i, i + FILE_CONCURRENCY);
    const results = await Promise.all(chunk.map(task => 
      processFile(task, (label) => {
        // Streaming label callback
        batchBuffer.push(label);
        
        const pairKey = `${label.model}|||${label.culture}`;
        const pairEntry = pairStats.get(pairKey);
        if (pairEntry) {
          pairEntry.bloomFilter.addText(label.text);
          pairEntry.bloomFilter.addText(label.labelId);
          pairEntry.bloomFilter.addText(label.help);
        }

        if (streamRemaining > 0 && isPriority) {
          self.postMessage({ type: 'STREAM_LABELS', labels: [label] });
          streamRemaining--;
        }

        if (batchBuffer.length >= BATCH_SIZE) {
          flushBatch();
        }
      })
    ));
    
    for (const result of results) {
      processedFiles++;
      const pairKey = `${result.model}|||${result.culture}`;
      const pairEntry = pairStats.get(pairKey);
      
      if (!result.success) {
        errors.push({ file: result.file, error: result.error });
      }

      if (pairEntry) {
        pairEntry.processedFiles += 1;
        pairEntry.labelCount += result.success ? result.labelCount : 0;
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

    if (pendingWrites.size >= MAX_PENDING_WRITES) {
      await Promise.race([...pendingWrites]);
    }
    
    // Progress update
    if (processedFiles % PROGRESS_INTERVAL === 0 || processedFiles === files.length) {
      self.postMessage({
        type: 'PROGRESS',
        processedFiles,
        totalFiles: files.length,
        totalLabels: totalLabels + batchBuffer.length,
        pairProgress: [...pairStats.values()].map(({bloomFilter, ...rest}) => rest),
        isPriority,
        phase: 'indexing'
      });
    }
  }
  
  // Flush remaining batch
  flushBatch();
  
  // SPEC-42: Save Bloom Filters
  console.time('⏱️ Export Search Indices');
  const { saveBloomFilter } = await import('../core/db.js');
  for (const pair of pairStats.values()) {
    try {
      if (pair.labelCount > 0 && pair.bloomFilter) {
        // Export Local Bloom Filter
        await saveBloomFilter(pair.model, pair.culture, pair.bloomFilter.export());
      }
    } finally {
      pair.bloomFilter = null;
    }
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
    pairProgress: [...pairStats.values()].map(({bloomFilter, ...rest}) => rest),
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
  const labels = self.SharedLabelParser.parseLabelFile(content, metadata);
  enrichLabelsForSearch(labels);
  
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
    const labels = [];
    await parseFileLabels(file, metadata, (label) => {
      labels.push(label);
    });
    
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
  }
  if (typeof dbVersion === 'number' && dbVersion !== runtimeDbVersion) {
    runtimeDbVersion = dbVersion;
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
