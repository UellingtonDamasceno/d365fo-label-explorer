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
const BATCH_SIZE = 1000;          // Increased from 250 to improve write throughput
const FILE_CONCURRENCY = 3;       // Slightly increased concurrency
const PROGRESS_INTERVAL = 20;     // Report less frequently to save UI thread time

/**
 * SPEC-23: Request main thread to save batch and await acknowledgement
 */
async function saveBatchRequest(labels) {
  if (!labels.length) return;
  const batchId = Date.now() + Math.random();
  
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.data.type === 'DB_WRITE_ACK' && e.data.batchId === batchId) {
        self.removeEventListener('message', handler);
        resolve();
      }
    };
    self.addEventListener('message', handler);
    self.postMessage({ type: 'REQUEST_DB_WRITE', labels, batchId });
  });
}

/**
 * SPEC-42: Request main thread to save bloom filter
 */
function saveBloomFilterRequest(model, culture, buffer) {
  // buffer is a Uint8Array, we must transfer its underlying ArrayBuffer
  self.postMessage({ type: 'REQUEST_BLOOM_SAVE', model, culture, buffer }, [buffer.buffer]);
}

function normalizeLabelForSearch(label) {
  const normalizedText = (label.text || '').toLowerCase();
  const normalizedId = (label.labelId || '').toLowerCase();
  label.s = `${normalizedId} ${normalizedText}`.trim();
  return label;
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
 * Process a single file (read + parse)
 */
async function processFile({ handle, metadata }, onLabel, updatePhase) {
  try {
    const perfStart = performance.now();
    
    // Phase: Reading
    updatePhase('reading');
    const readStart = performance.now();
    const file = await handle.getFile();
    const readTime = performance.now() - readStart;

    // Phase: Parsing
    updatePhase('parsing');
    const parseStart = performance.now();
    let fileLabelCount = 0;
    await parseFileLabels(file, metadata, (label) => {
      fileLabelCount++;
      onLabel(label);
    });
    const parseTime = performance.now() - parseStart;
    
    const durationMs = performance.now() - perfStart;
    
    return {
      success: true,
      labelCount: fileLabelCount,
      file: metadata.sourcePath,
      model: metadata.model,
      culture: metadata.culture,
      metrics: {
        readTimeMs: readTime,
        parseTimeMs: parseTime,
        durationMs
      },
      sizeBytes: file.size || 0
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      file: metadata.sourcePath,
      model: metadata.model,
      culture: metadata.culture,
      metrics: null
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
  
  let batchBuffer = [];
  const pairStats = new Map();
  let streamRemaining = streamOptions?.enabled ? (streamOptions.limit || 0) : 0;
  
  const mode = isPriority ? '🚀 PRIORITY' : '📦 BACKGROUND';
  console.log(`👷 Worker ${mode}: ${files.length} files`);

  const flushBatch = async (entriesToUpdate = []) => {
    if (batchBuffer.length === 0) return;
    const labelsToPersist = batchBuffer;
    totalLabels += labelsToPersist.length;
    batchBuffer = [];
    
    for (const entry of entriesToUpdate) {
      if (entry) entry.status = 'persisting';
    }
    
    const dbStart = performance.now();
    await saveBatchRequest(labelsToPersist);
    return performance.now() - dbStart;
  };

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
          status: 'waiting',
          metrics: {
            readTimeMs: 0,
            parseTimeMs: 0,
            persistTimeMs: 0,
            totalBytes: 0
          },
          bloomFilter: new BloomFilter({ expectedItems: 50000, falsePositiveRate: 0.01 })
        });
      }
      pairStats.get(key).fileCount += 1;
  }
  
  for (let i = 0; i < files.length; i += FILE_CONCURRENCY) {
    const chunk = files.slice(i, i + FILE_CONCURRENCY);
    const chunkEntries = chunk.map(task => pairStats.get(`${task.metadata.model}|||${task.metadata.culture}`));

    const results = await Promise.all(chunk.map((task, idx) => {
      const pairEntry = chunkEntries[idx];
      
      return processFile(task, (label) => {
        batchBuffer.push(label);
        
        if (pairEntry) {
          pairEntry.bloomFilter.addText(label.text);
          pairEntry.bloomFilter.addText(label.labelId);
          pairEntry.bloomFilter.addText(label.help);
        }

        if (streamRemaining > 0 && isPriority) {
          self.postMessage({ type: 'STREAM_LABELS', labels: [label] });
          streamRemaining--;
        }
      }, (phase) => {
        if (pairEntry) pairEntry.status = phase;
      });
    }));
    
    let dbWaitTime = 0;
    if (batchBuffer.length >= BATCH_SIZE) {
      dbWaitTime = await flushBatch(chunkEntries);
    }

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
        if (result.metrics) {
          pairEntry.metrics.readTimeMs += result.metrics.readTimeMs;
          pairEntry.metrics.parseTimeMs += result.metrics.parseTimeMs;
          pairEntry.metrics.persistTimeMs += dbWaitTime; // Best effort attribution
          pairEntry.metrics.totalBytes += result.sizeBytes || 0;
        }
      }
    }
    
    if (processedFiles % PROGRESS_INTERVAL === 0 || processedFiles === files.length) {
      self.postMessage({
        type: 'PROGRESS',
        processedFiles,
        totalFiles: files.length,
        totalLabels: totalLabels + batchBuffer.length,
        pairProgress: [...pairStats.values()].map(({bloomFilter, ...rest}) => rest),
        isPriority
      });
    }
  }
  
  await flushBatch([...pairStats.values()]);
  
  console.time('⏱️ Export Search Indices');
  for (const pair of pairStats.values()) {
    try {
      if (pair.labelCount > 0 && pair.bloomFilter) {
        saveBloomFilterRequest(pair.model, pair.culture, pair.bloomFilter.export());
      }
    } finally {
      pair.bloomFilter = null;
    }
  }
  console.timeEnd('⏱️ Export Search Indices');

  const now = Date.now();
  for (const pair of pairStats.values()) {
    if (pair.processedFiles > 0) {
      pair.lastEndedAt = now;
    }
  }
  
  const elapsed = performance.now() - startTime;
  console.log(`✅ Worker ${mode} done: ${totalLabels} labels in ${(elapsed/1000).toFixed(1)}s`);
  
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

self.onmessage = async function(event) {
  const { type, files, isPriority, streamLabels, streamLimit, dbName, dbVersion } = event.data;

  if (dbName && dbName !== runtimeDbName) runtimeDbName = dbName;
  if (typeof dbVersion === 'number' && dbVersion !== runtimeDbVersion) runtimeDbVersion = dbVersion;

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
      await processFilesWithHandles(files, true, {
        enabled: Boolean(streamLabels),
        limit: streamLimit || 0
      });
      break;
      
    case 'INIT_DB':
      self.postMessage({ type: 'DB_READY' });
      break;
  }
};
