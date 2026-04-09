const CACHE_VERSION = '1';

function isOpfsAvailable() {
  return typeof navigator !== 'undefined'
    && 'storage' in navigator
    && navigator.storage
    && typeof navigator.storage.getDirectory === 'function'
    && typeof CompressionStream !== 'undefined'
    && typeof DecompressionStream !== 'undefined';
}

async function readAllBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return merged;
}

class LabelCache {
  async _getDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(`label-cache-v${CACHE_VERSION}`, { create: true });
  }

  async write(cacheKey, data) {
    if (!isOpfsAvailable()) return;

    try {
      const dir = await this._getDir();
      const fileHandle = await dir.getFileHandle(`${cacheKey}.json.gz`, { create: true });
      const writable = await fileHandle.createWritable();

      const rawBytes = new TextEncoder().encode(JSON.stringify(data));
      const compressedStream = new Blob([rawBytes]).stream().pipeThrough(new CompressionStream('gzip'));
      await compressedStream.pipeTo(writable);
    } catch (err) {
      console.warn('[OPFS] Cache write failed:', err?.message || err);
    }
  }

  async read(cacheKey) {
    if (!isOpfsAvailable()) return null;

    try {
      const dir = await this._getDir();
      const fileHandle = await dir.getFileHandle(`${cacheKey}.json.gz`);
      const file = await fileHandle.getFile();
      const decompressed = file.stream().pipeThrough(new DecompressionStream('gzip'));
      const bytes = await readAllBytes(decompressed);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        console.warn('[OPFS] Cache read failed:', err?.message || err);
      }
      return null;
    }
  }

  async invalidate(cacheKey) {
    if (!isOpfsAvailable()) return;

    try {
      const dir = await this._getDir();
      await dir.removeEntry(`${cacheKey}.json.gz`);
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        console.warn('[OPFS] Cache invalidate failed:', err?.message || err);
      }
    }
  }

  async clear() {
    if (!isOpfsAvailable()) return;

    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(`label-cache-v${CACHE_VERSION}`, { recursive: true });
    } catch (err) {
      if (err && err.name !== 'NotFoundError') {
        console.warn('[OPFS] Cache clear failed:', err?.message || err);
      }
    }
  }
}

export const labelCache = new LabelCache();
