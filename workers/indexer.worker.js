/**
 * Indexer Worker - SPEC-18 State of the Art Mass Processing
 * 
 * ARCHITECTURE (Zero-Copy Pipeline & Streaming):
 * 1. Main Thread passes FileSystemFileHandle (no file reading!)
 * 2. Worker opens file via handle.getFile()
 * 3. Worker uses Web Streams API to read line-by-line (never loads entire file)
 * 4. Worker parses and saves to IndexedDB in batches of 5000
 * 5. Worker sends only progress counts back (never label arrays!)
 * 
 * Memory: Labels are parsed and saved immediately, never accumulated.
 * The only arrays in memory are the current batch (max 5000 labels).
 */

const DB_NAME = 'd365fo-labels';
const DB_VERSION = 1;
const DB_BATCH_SIZE = 5000; // Bulk commit every 5000 labels

// Parser states
const State = {
  SEARCHING_LABEL: 'SEARCHING',
  CAPTURING_METADATA: 'CAPTURING'
};

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

    labels.forEach(label => {
      const request = store.put(label);
      request.onsuccess = () => count++;
    });

    tx.oncomplete = () => resolve(count);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Line splitter TransformStream for streaming parsing
 * Converts byte chunks to lines
 */
function createLineSplitter() {
  let buffer = '';
  
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split('\n');
      // Keep the last incomplete line in buffer
      buffer = lines.pop() || '';
      
      for (let line of lines) {
        controller.enqueue(line.replace(/\r$/, ''));
      }
    },
    flush(controller) {
      // Emit any remaining content as the final line
      if (buffer) {
        controller.enqueue(buffer.replace(/\r$/, ''));
      }
    }
  });
}

/**
 * Process file using Web Streams API for memory-efficient parsing
 * @param {FileSystemFileHandle} fileHandle - File handle from Main Thread
 * @param {Object} metadata - File metadata
 * @returns {Promise<Object>} - Processing stats
 */
async function processFileWithStreaming(fileHandle, metadata) {
  const startTime = performance.now();
  const { model, culture, prefix, sourcePath } = metadata;
  
  let currentState = State.SEARCHING_LABEL;
  let currentLabel = null;
  let batch = [];
  let totalLabels = 0;
  let totalBatches = 0;

  try {
    // Initialize DB
    await initDB();
    
    // Open file from handle (Worker does the I/O, not Main Thread!)
    const file = await fileHandle.getFile();
    
    // Create streaming pipeline: File → TextDecoder → LineSplitter
    const stream = file.stream()
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(createLineSplitter());
    
    const reader = stream.getReader();
    
    // Process lines one by one - memory efficient!
    while (true) {
      const { done, value: line } = await reader.read();
      
      if (done) break;
      
      const trimmedLine = line.trimEnd();
      if (!trimmedLine) continue;

      if (currentState === State.SEARCHING_LABEL) {
        const equalsIndex = trimmedLine.indexOf('=');
        
        if (equalsIndex > 0) {
          const labelId = trimmedLine.substring(0, equalsIndex).trim();
          const text = trimmedLine.substring(equalsIndex + 1);
          
          if (labelId && !labelId.startsWith(' ')) {
            currentLabel = {
              id: `${model}|${culture}|${prefix}|${labelId}`,
              fullId: `@${prefix}:${labelId}`,
              labelId: labelId,
              text: text,
              help: '',
              model: model,
              culture: culture,
              prefix: prefix,
              sourcePath: sourcePath
            };
            currentState = State.CAPTURING_METADATA;
          }
        }
      } else if (currentState === State.CAPTURING_METADATA) {
        if (line.startsWith(' ;')) {
          const helpText = line.substring(2).trim();
          if (currentLabel.help) {
            currentLabel.help += ' ' + helpText;
          } else {
            currentLabel.help = helpText;
          }
        } else {
          if (currentLabel) {
            batch.push(currentLabel);
            
            // Save batch when it reaches size limit
            if (batch.length >= DB_BATCH_SIZE) {
              await saveLabelsBatch(batch);
              totalLabels += batch.length;
              totalBatches++;
              batch = []; // Clear batch - memory is freed immediately
              
              // Send progress for large files
              self.postMessage({
                type: 'BATCH_SAVED',
                labels: totalLabels,
                file: sourcePath
              });
            }
          }
          
          const equalsIndex = trimmedLine.indexOf('=');
          
          if (equalsIndex > 0) {
            const labelId = trimmedLine.substring(0, equalsIndex).trim();
            const text = trimmedLine.substring(equalsIndex + 1);
            
            if (labelId && !labelId.startsWith(' ')) {
              currentLabel = {
                id: `${model}|${culture}|${prefix}|${labelId}`,
                fullId: `@${prefix}:${labelId}`,
                labelId: labelId,
                text: text,
                help: '',
                model: model,
                culture: culture,
                prefix: prefix,
                sourcePath: sourcePath
              };
            } else {
              currentLabel = null;
              currentState = State.SEARCHING_LABEL;
            }
          } else {
            currentLabel = null;
            currentState = State.SEARCHING_LABEL;
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

  for (const { handle, metadata } of files) {
    try {
      const result = await processFileWithStreaming(handle, metadata);
      
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
  const lines = content.split('\n');
  
  let currentState = State.SEARCHING_LABEL;
  let currentLabel = null;
  let batch = [];
  let totalLabels = 0;
  let totalBatches = 0;

  await initDB();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trimEnd();

    if (!trimmedLine) continue;

    if (currentState === State.SEARCHING_LABEL) {
      const equalsIndex = trimmedLine.indexOf('=');
      
      if (equalsIndex > 0) {
        const labelId = trimmedLine.substring(0, equalsIndex).trim();
        const text = trimmedLine.substring(equalsIndex + 1);
        
        if (labelId && !labelId.startsWith(' ')) {
          currentLabel = {
            id: `${model}|${culture}|${prefix}|${labelId}`,
            fullId: `@${prefix}:${labelId}`,
            labelId: labelId,
            text: text,
            help: '',
            model, culture, prefix, sourcePath
          };
          currentState = State.CAPTURING_METADATA;
        }
      }
    } else if (currentState === State.CAPTURING_METADATA) {
      if (line.startsWith(' ;')) {
        const helpText = line.substring(2).trim();
        currentLabel.help = currentLabel.help ? currentLabel.help + ' ' + helpText : helpText;
      } else {
        if (currentLabel) {
          batch.push(currentLabel);
          if (batch.length >= DB_BATCH_SIZE) {
            await saveLabelsBatch(batch);
            totalLabels += batch.length;
            totalBatches++;
            batch = [];
          }
        }
        
        const equalsIndex = trimmedLine.indexOf('=');
        if (equalsIndex > 0) {
          const labelId = trimmedLine.substring(0, equalsIndex).trim();
          const text = trimmedLine.substring(equalsIndex + 1);
          if (labelId && !labelId.startsWith(' ')) {
            currentLabel = {
              id: `${model}|${culture}|${prefix}|${labelId}`,
              fullId: `@${prefix}:${labelId}`,
              labelId, text, help: '', model, culture, prefix, sourcePath
            };
          } else {
            currentLabel = null;
            currentState = State.SEARCHING_LABEL;
          }
        } else {
          currentLabel = null;
          currentState = State.SEARCHING_LABEL;
        }
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
      // SPEC-18: Process files using FileSystemFileHandles (preferred)
      await processFilesWithHandles(files);
      break;
      
    case 'PROCESS_FILE_HANDLE':
      // SPEC-18: Process single file with FileHandle + Streaming
      try {
        const result = await processFileWithStreaming(handle, metadata);
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
