/**
 * File System Access Service for D365FO Label Explorer
 * Handles reading directories and files from local filesystem
 */

/**
 * Check if File System Access API is supported
 * @returns {boolean}
 */
export function isSupported() {
  return 'showDirectoryPicker' in window;
}

/**
 * Select a directory using the File System Access API
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function selectDirectory() {
  if (!isSupported()) {
    throw new Error('File System Access API not supported');
  }

  try {
    const handle = await window.showDirectoryPicker({
      mode: 'read',
      startIn: 'documents'
    });
    return handle;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('USER_CANCELLED');
    }
    throw err;
  }
}

/**
 * Request permission for a directory handle
 * @param {FileSystemDirectoryHandle} handle 
 * @returns {Promise<boolean>} - true if permission granted
 */
export async function requestPermission(handle) {
  try {
    const options = { mode: 'read' };
    
    // Check current permission state
    if ((await handle.queryPermission(options)) === 'granted') {
      return true;
    }
    
    // Request permission
    if ((await handle.requestPermission(options)) === 'granted') {
      return true;
    }
    
    return false;
  } catch (err) {
    console.error('Permission request failed:', err);
    return false;
  }
}

/**
 * Read a file as text
 * @param {FileSystemFileHandle} fileHandle 
 * @returns {Promise<string>}
 */
export async function readFileAsText(fileHandle) {
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * Read a file using streams for large files
 * @param {FileSystemFileHandle} fileHandle 
 * @param {Function} onChunk - Callback for each chunk
 * @returns {Promise<void>}
 */
export async function readFileStream(fileHandle, onChunk) {
  const file = await fileHandle.getFile();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8');
  
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    
    if (done) {
      if (buffer) {
        onChunk(buffer);
      }
      break;
    }
    
    buffer += decoder.decode(value, { stream: true });
    
    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer
    
    if (lines.length > 0) {
      onChunk(lines.join('\n'));
    }
  }
}

/**
 * Recursively iterate through directory entries
 * @param {FileSystemDirectoryHandle} dirHandle 
 * @param {Function} onEntry - Callback for each entry { handle, path, kind }
 * @param {string} basePath - Current path
 */
export async function walkDirectory(dirHandle, onEntry, basePath = '') {
  for await (const entry of dirHandle.values()) {
    const entryPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    
    await onEntry({
      handle: entry,
      path: entryPath,
      name: entry.name,
      kind: entry.kind
    });
    
    if (entry.kind === 'directory') {
      await walkDirectory(entry, onEntry, entryPath);
    }
  }
}

/**
 * Find all AxLabelFile directories - TURBO DISCOVERY (SPEC-16)
 * Uses parallel processing for first-level directories
 * @param {FileSystemDirectoryHandle} rootHandle 
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} - Array of { model, labelResources }
 */
export async function discoverLabelFiles(rootHandle, onProgress = () => {}) {
  const models = [];
  let scannedDirs = 0;
  let foundModels = 0;
  
  // First pass: collect all first-level directories (model candidates)
  const firstLevelDirs = [];
  for await (const entry of rootHandle.values()) {
    if (entry.kind === 'directory') {
      firstLevelDirs.push(entry);
    }
  }
  
  console.log(`🔍 Turbo Discovery: scanning ${firstLevelDirs.length} top-level directories`);
  
  // Process directories in parallel batches
  const BATCH_SIZE = 10; // Process 10 directories at a time
  
  async function scanModelDir(modelDir) {
    // Look specifically for AxLabelFile subdirectory
    try {
      for await (const entry of modelDir.values()) {
        scannedDirs++;
        
        if (entry.kind === 'directory' && entry.name === 'AxLabelFile') {
          const labelResourcesHandle = await findLabelResources(entry);
          if (labelResourcesHandle) {
            const cultures = await discoverCultures(labelResourcesHandle);
            if (cultures.length > 0) {
              foundModels++;
              return {
                model: modelDir.name,
                axLabelFileHandle: entry,
                labelResourcesHandle,
                cultures,
                fileCount: cultures.reduce((sum, c) => sum + c.files.length, 0)
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn(`Skipping ${modelDir.name}:`, err.message);
    }
    return null;
  }
  
  // Process in parallel batches
  for (let i = 0; i < firstLevelDirs.length; i += BATCH_SIZE) {
    const batch = firstLevelDirs.slice(i, i + BATCH_SIZE);
    
    const results = await Promise.all(batch.map(dir => scanModelDir(dir)));
    
    // Collect valid models
    for (const result of results) {
      if (result) {
        models.push(result);
      }
    }
    
    // Update progress
    onProgress({ scannedDirs, foundModels: models.length });
  }
  
  console.log(`✅ Turbo Discovery complete: ${models.length} models found`);
  return models;
}

/**
 * Find LabelResources folder inside AxLabelFile
 * @param {FileSystemDirectoryHandle} axLabelFileHandle 
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function findLabelResources(axLabelFileHandle) {
  for await (const entry of axLabelFileHandle.values()) {
    if (entry.kind === 'directory' && entry.name === 'LabelResources') {
      return entry;
    }
  }
  return null;
}

/**
 * Discover cultures (language folders) inside LabelResources
 * @param {FileSystemDirectoryHandle} labelResourcesHandle 
 * @returns {Promise<Array>} - Array of { culture, handle, files }
 */
async function discoverCultures(labelResourcesHandle) {
  const cultures = [];
  
  for await (const entry of labelResourcesHandle.values()) {
    if (entry.kind === 'directory') {
      // Each folder is a culture (e.g., pt-BR, en-US)
      const files = await discoverLabelFilesInCulture(entry);
      if (files.length > 0) {
        cultures.push({
          culture: entry.name,
          handle: entry,
          files
        });
      }
    }
  }
  
  return cultures;
}

/**
 * Discover .label.txt files in a culture folder
 * @param {FileSystemDirectoryHandle} cultureHandle 
 * @returns {Promise<Array>} - Array of file info
 */
async function discoverLabelFilesInCulture(cultureHandle) {
  const files = [];
  
  for await (const entry of cultureHandle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.label.txt')) {
      // Extract prefix from filename: {Prefix}.{Culture}.label.txt
      const parts = entry.name.split('.');
      const prefix = parts[0];
      
      files.push({
        name: entry.name,
        handle: entry,
        prefix
      });
    }
  }
  
  return files;
}

/**
 * Get file metadata (size, last modified)
 * @param {FileSystemFileHandle} fileHandle 
 * @returns {Promise<Object>}
 */
export async function getFileMetadata(fileHandle) {
  const file = await fileHandle.getFile();
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type
  };
}
