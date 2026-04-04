/**
 * Indexer Worker - SPEC-20 Fast Synchronous Parsing
 * 
 * ARCHITECTURE (Worker-Buffered Synchronous Parsing):
 * 1. Main Thread passes FileSystemFileHandle (no file reading!)
 * 2. Worker opens file via handle.getFile()
 * 3. Worker reads ENTIRE file as string (file.text()) - fast O/S level read
 * 4. Worker splits into lines synchronously and parses in tight loop
 * 5. Worker saves to IndexedDB in batches of 5000
 * 6. Worker sends only progress counts back (never label arrays!)
 * 
 * Why not Web Streams?
 * - Streams API creates millions of micro-promises for large files
 * - The V8 Promise overhead was slower than just loading 1-3MB into RAM
 * - Each Worker has its own heap, so this doesn't affect Main Thread
 * - GC cleans up the string quickly after each file
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 1;
const DB_BATCH_SIZE = 5000; // Bulk commit every 5000 labels

let db = null;

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

      if (!database.objectStoreNames.contains('labels')) {
        const labelsStore = database.createObjectStore('labels', { keyPath: 'id' });
        labelsStore.createIndex('fullId', 'fullId', { unique: false });
        labelsStore.createIndex('culture', 'culture', { unique: false });
        labelsStore.createIndex('model', 'model', { unique: false });
        labelsStore.createIndex('prefix', 'prefix', { unique: false });
        labelsStore.createIndex('text', 'text', { unique: false });
      }

      if (!database.objectStoreNames.contains('metadata')) {
        database.createObjectStore('metadata', { keyPath: 'key' });
      }

      if (!database.objectStoreNames.contains('handles')) {
        database.createObjectStore('handles', { keyPath: 'id' });
      }
    };
  });
}

/**
 * Save labels batch to IndexedDB
 * @param {Array} labels - Labels to save
 * @returns {Promise<number>} - Count saved
 */
async function saveLabelsBatch(labels) {
  if (!labels.length) return 0;
  
  await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction('labels', 'readwrite');
    const store = tx.objectStore('labels');
    let count = 0;

    // Use single put per label (IndexedDB handles batching internally)
    for (let i = 0; i < labels.length; i++) {
      const request = store.put(labels[i]);
      request.onsuccess = () => count++;
    }

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * SPEC-20: Fast synchronous file parsing
 * Reads entire file as string then parses synchronously (no Promise overhead)
 * @param {FileSystemFileHandle} fileHandle - File handle from Main Thread
 * @param {Object} metadata - File metadata
 * @returns {Promise<Object>} - Processing stats
 */
async function processFileFast(fileHandle, metadata) {
  const startTime = performance.now();
  const { model, culture, prefix, sourcePath } = metadata;
  
  let batch = [];
  let totalLabels = 0;
  let totalBatches = 0;

  try {
    // Initialize DB
    await initDB();
    
    // Single async read - O/S level, very fast
    const file = await fileHandle.getFile();
    const content = await file.text();
    
    // Synchronous split - hyper-fast in V8
    const lines = content.split('\n');
    const lineCount = lines.length;
    
    // State machine variables (inline for speed)
    let currentLabel = null;
    let isCapturingHelp = false;
    
    // TIGHT SYNCHRONOUS LOOP - no Promises, no await, maximum speed
    for (let i = 0; i < lineCount; i++) {
      const rawLine = lines[i];
      
      // Fast trim of \r (Windows line endings)
      const line = rawLine.endsWith('\r') 
        ? rawLine.slice(0, -1) 
        : rawLine;
      
      // Skip empty lines
      if (!line) continue;
      
      // Check for help/comment line (starts with " ;")
      if (line.charCodeAt(0) === 32 && line.charCodeAt(1) === 59) { // ' ' and ';'
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
      
      // If we were capturing and hit a non-help line, save previous label
      if (currentLabel) {
        batch.push(currentLabel);
        currentLabel = null;
        
        // Batch save when full
        if (batch.length >= DB_BATCH_SIZE) {
          await saveLabelsBatch(batch);
          totalLabels += batch.length;
          totalBatches++;
          batch = [];
          
          // Progress update for large files
          self.postMessage({
            type: 'BATCH_SAVED',
            labels: totalLabels,
            file: sourcePath
          });
        }
      }
      
      // Try to parse as label line (ID=Text format)
      const equalsIndex = line.indexOf('=');
      if (equalsIndex > 0) {
        // Fast check: first char shouldn't be space
        if (line.charCodeAt(0) !== 32) {
          const labelId = line.slice(0, equalsIndex);
          const text = line.slice(equalsIndex + 1);
          
          // Only create label if ID is valid (not empty, no leading space)
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
    }
    
    // Don't forget the last label
    if (currentLabel) {
      batch.push(currentLabel);
    }
    
    // Save remaining batch
    if (batch.length > 0) {
      await saveLabelsBatch(batch);
      totalLabels += batch.length;
      totalBatches++;
    }

    const elapsed = performance.now() - startTime;
    
    return {
      success: true,
      labels: totalLabels,
      batches: totalBatches,
      elapsed,
      labelsPerSec: elapsed > 0 ? Math.round(totalLabels / (elapsed / 1000)) : 0
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      file: sourcePath
    };
  }
}

/**
 * Process multiple files using FileHandles
 * @param {Array} files - Array of {handle: FileSystemFileHandle, metadata}
 */
async function processFilesWithHandles(files) {
  const startTime = performance.now();
  let totalLabels = 0;
  let processedFiles = 0;
  let errors = [];

  // Initialize DB once
  await initDB();

  // CONCURRENCY LIMIT: Process multiple files in parallel per worker
  // This unleashes the NVMe SSD I/O while keeping memory footprint low
  const CONCURRENCY_LIMIT = 10;
  
  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    const chunk = files.slice(i, i + CONCURRENCY_LIMIT);
    
    await Promise.all(chunk.map(async ({ handle, metadata }) => {
      try {
        const result = await processFileFast(handle, metadata);
        
        if (result.success) {
          totalLabels += result.labels;
          processedFiles++;
          
          // Send progress update (only counts, never label data!)
          self.postMessage({
            type: 'FILE_COMPLETE',
            file: metadata.sourcePath,
            labels: result.labels,
            totalLabels,
            processedFiles,
            totalFiles: files.length
          });
        } else {
          errors.push({ file: metadata.sourcePath, error: result.error });
          processedFiles++;
        }
      } catch (error) {
        errors.push({ file: metadata.sourcePath, error: error.message });
        processedFiles++;
      }
    }));
  }

  const elapsed = performance.now() - startTime;

  // Send completion (only stats, no label arrays!)
  self.postMessage({
    type: 'COMPLETE',
    totalLabels,
    processedFiles,
    errors,
    elapsed,
    labelsPerSec: elapsed > 0 ? Math.round(totalLabels / (elapsed / 1000)) : 0
  });
}

/**
 * Legacy: Process file from content string (fallback if FileHandle not supported)
 */
async function processFileFromContent(content, metadata) {
  const startTime = performance.now();
  const { model, culture, prefix, sourcePath } = metadata;
  
  let batch = [];
  let totalLabels = 0;
  let totalBatches = 0;

  await initDB();
  
  // Synchronous split
  const lines = content.split('\n');
  const lineCount = lines.length;
  
  let currentLabel = null;

  for (let i = 0; i < lineCount; i++) {
    const rawLine = lines[i];
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    
    if (!line) continue;
    
    // Help line check
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
    
    // Save previous label
    if (currentLabel) {
      batch.push(currentLabel);
      currentLabel = null;
      
      if (batch.length >= DB_BATCH_SIZE) {
        await saveLabelsBatch(batch);
        totalLabels += batch.length;
        totalBatches++;
        batch = [];
      }
    }
    
    // Parse label line
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

  if (currentLabel) batch.push(currentLabel);
  if (batch.length > 0) {
    await saveLabelsBatch(batch);
    totalLabels += batch.length;
    totalBatches++;
  }

  const elapsed = performance.now() - startTime;
  return {
    success: true,
    labels: totalLabels,
    batches: totalBatches,
    elapsed,
    labelsPerSec: elapsed > 0 ? Math.round(totalLabels / (elapsed / 1000)) : 0
  };
}

// Worker message handler
self.onmessage = async function(event) {
  const { type, files, handle, content, metadata } = event.data;

  switch (type) {
    case 'PROCESS_FILES_HANDLES':
      // SPEC-20: Process files using FileSystemFileHandles with fast sync parsing
      await processFilesWithHandles(files);
      break;
      
    case 'PROCESS_FILE_HANDLE':
      // SPEC-20: Process single file with FileHandle + Fast parsing
      try {
        const result = await processFileFast(handle, metadata);
        self.postMessage({
          type: 'FILE_RESULT',
          ...result,
          file: metadata.sourcePath
        });
      } catch (error) {
        self.postMessage({
          type: 'FILE_RESULT',
          success: false,
          error: error.message,
          file: metadata.sourcePath
        });
      }
      break;
      
    case 'PROCESS_FILE':
      // Legacy: Process single file from content string
      try {
        const result = await processFileFromContent(content, metadata);
        self.postMessage({
          type: 'FILE_RESULT',
          ...result,
          file: metadata.sourcePath
        });
      } catch (error) {
        self.postMessage({
          type: 'FILE_RESULT',
          success: false,
          error: error.message,
          file: metadata.sourcePath
        });
      }
      break;
      
    case 'INIT_DB':
      // Pre-initialize DB connection
      try {
        await initDB();
        self.postMessage({ type: 'DB_READY' });
      } catch (error) {
        self.postMessage({ type: 'DB_ERROR', error: error.message });
      }
      break;
  }
};
