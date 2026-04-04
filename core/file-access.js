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
 * Uses O(1) probing and skips heavy D365FO metadata folders for instant discovery
 * @param {FileSystemDirectoryHandle} rootHandle 
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} - Array of { model, labelResources }
 */
export async function discoverLabelFiles(rootHandle, onProgress = () => {}) {
  let scannedDirs = 0;
  let foundModels = 0;
  
  console.log(`🔍 Turbo Discovery: scanning from root ${rootHandle.name}`);

  async function searchForModels(dirHandle, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return [];
    
    const modelsFound = [];
    scannedDirs++;
    
    // 1. Fast O(1) probe: Does this directory have 'AxLabelFile'?
    try {
      const axLabelFileHandle = await dirHandle.getDirectoryHandle('AxLabelFile');
      // If we didn't throw, we found it!
      const labelResourcesHandle = await findLabelResources(axLabelFileHandle);
      if (labelResourcesHandle) {
        const cultures = await discoverCultures(labelResourcesHandle);
        if (cultures.length > 0) {
          foundModels++;
          modelsFound.push({
            model: dirHandle.name,
            axLabelFileHandle,
            labelResourcesHandle,
            cultures,
            fileCount: cultures.reduce((sum, c) => sum + c.files.length, 0)
          });
          onProgress({ scannedDirs, foundModels });
          // We found a model here, no need to recurse deeper inside this model folder
          return modelsFound;
        }
      }
    } catch (e) {
      // AxLabelFile not found here, continue searching children
    }

    // 2. It doesn't have AxLabelFile. Let's check its children.
    try {
      const promises = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
          // Skip known heavy metadata folders that definitely don't contain AxLabelFile
          // This avoids iterating through thousands of XML files in AxClass, AxTable, etc.
          if (entry.name.startsWith('Ax') || 
              ['bin', 'Descriptor', 'XppMetadata', 'Resources', 'Reports', 'BuildProject'].includes(entry.name)) {
            continue;
          }
          
          promises.push(searchForModels(entry, currentDepth + 1, maxDepth));
        }
      }
      
      const results = await Promise.all(promises);
      for (const res of results) {
        modelsFound.push(...res);
      }
    } catch (err) {
      console.warn(`Skipping iteration for ${dirHandle.name}:`, err.message);
    }
    
    return modelsFound;
  }
  
  // Search up to 4 levels deep to support PackagesLocalDirectory/Package/Model/
  const models = await searchForModels(rootHandle, 0, 4);
  
  console.log(`✅ Turbo Discovery complete: ${models.length} models found`);
  return models;
}

/**
 * Find LabelResources folder inside AxLabelFile using O(1) probe
 * @param {FileSystemDirectoryHandle} axLabelFileHandle 
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function findLabelResources(axLabelFileHandle) {
  try {
    return await axLabelFileHandle.getDirectoryHandle('LabelResources');
  } catch (e) {
    return null;
  }
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
