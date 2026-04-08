/**
 * SPEC-42: Fast-fail Bloom Filter for Search Optimization
 * Probabilistic data structure to test if an element is a member of a set.
 */

(function(root) {
  // Simple FNV-1a hash function for strings
  function fnv1a(str, seed) {
    let hval = 0x811c9dc5 ^ seed;
    for (let i = 0, l = str.length; i < l; i++) {
      hval ^= str.charCodeAt(i);
      hval += (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
    }
    return hval >>> 0;
  }

  class BloomFilter {
    /**
     * Initialize a new Bloom Filter or restore an existing one
     */
    constructor(options = {}) {
      if (options.buffer) {
        this.buffer = new Uint8Array(options.buffer);
        this.numBits = this.buffer.length * 8;
        this.numHashes = 7; 
      } else {
        const { expectedItems = 50000, falsePositiveRate = 0.01 } = options;
        this.numBits = Math.ceil(-(expectedItems * Math.log(falsePositiveRate)) / (Math.log(2) ** 2));
        this.numHashes = Math.ceil((this.numBits / expectedItems) * Math.log(2));
        const numBytes = Math.ceil(this.numBits / 8);
        this.buffer = new Uint8Array(numBytes);
        this.numBits = numBytes * 8;
      }
    }

    _getLocations(item) {
      const locations = [];
      const hash1 = fnv1a(item, 0);
      const hash2 = fnv1a(item, 1540483477);
      for (let i = 0; i < this.numHashes; i++) {
        const hash = (hash1 + i * hash2) % this.numBits;
        locations.push(hash);
      }
      return locations;
    }

    add(item) {
      const locations = this._getLocations(item);
      for (const bitIndex of locations) {
        const byteIndex = Math.floor(bitIndex / 8);
        const bitOffset = bitIndex % 8;
        this.buffer[byteIndex] |= (1 << bitOffset);
      }
    }

    has(item) {
      const locations = this._getLocations(item);
      for (const bitIndex of locations) {
        const byteIndex = Math.floor(bitIndex / 8);
        const bitOffset = bitIndex % 8;
        if ((this.buffer[byteIndex] & (1 << bitOffset)) === 0) {
          return false;
        }
      }
      return true;
    }

    addText(text) {
      if (!text) return;
      const tokens = text.toLowerCase().split(/[\W_]+/).filter(t => t.length > 1);
      for (const token of tokens) {
        this.add(token);
        // SPEC-42: Index prefixes (from 3 chars) to support fuzzy/partial searches
        if (token.length > 3) {
          for (let i = 3; i < token.length; i++) {
            this.add(token.substring(0, i));
          }
        }
      }
    }

    hasText(text) {
      if (!text) return true;
      const tokens = text.toLowerCase().split(/[\W_]+/).filter(t => t.length > 1);
      if (tokens.length === 0) return true;
      for (const token of tokens) {
        if (!this.has(token)) return false;
      }
      return true;
    }

    export() {
      return this.buffer;
    }
  }

  // Export to the correct scope
  if (typeof exports !== 'undefined') {
    if (typeof module !== 'undefined' && module.exports) {
      exports = module.exports = BloomFilter;
    }
    exports.BloomFilter = BloomFilter;
  } else if (typeof define === 'function' && define.amd) {
    define([], function() { return BloomFilter; });
  } else {
    root.BloomFilter = BloomFilter;
  }
})(typeof self !== 'undefined' ? self : this);
