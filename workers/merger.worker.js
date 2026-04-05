/**
 * Label File Merger Worker
 * SPEC-36: Merge multiple .label.txt files, deduplicate, detect conflicts, and sort alphabetically
 */

/**
 * Parse a single .label.txt file content
 * @param {string} content - File content
 * @returns {Array<{id: string, text: string, helpText: string|null}>}
 */
function parseLabelFile(content) {
  const labels = [];
  const lines = content.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('//')) continue;
    
    // Format: LabelId=Text [;Comment/HelpText]
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    
    const id = trimmed.substring(0, eqIndex).trim();
    let rest = trimmed.substring(eqIndex + 1);
    
    // Extract HelpText (after semicolon, if present)
    let text = rest;
    let helpText = null;
    
    // Check for ;; (escaped semicolon) vs ; (help text separator)
    const helpSeparatorIndex = rest.search(/(?<!;);(?!;)/);
    if (helpSeparatorIndex !== -1) {
      text = rest.substring(0, helpSeparatorIndex);
      helpText = rest.substring(helpSeparatorIndex + 1).trim() || null;
    }
    
    // Unescape semicolons
    text = text.replace(/;;/g, ';').trim();
    if (helpText) {
      helpText = helpText.replace(/;;/g, ';').trim();
    }
    
    if (id) {
      labels.push({ id, text, helpText });
    }
  }
  
  return labels;
}

/**
 * Serialize labels back to .label.txt format
 * @param {Array} labels - Labels array
 * @returns {string}
 */
function serializeLabelFile(labels) {
  const lines = [];
  
  for (const label of labels) {
    // Escape semicolons in text
    let text = (label.text || '').replace(/;/g, ';;');
    let line = `${label.id}=${text}`;
    
    // Add help text if present
    if (label.helpText) {
      const escapedHelp = label.helpText.replace(/;/g, ';;');
      line += `;${escapedHelp}`;
    }
    
    lines.push(line);
  }
  
  return lines.join('\n');
}

/**
 * Merge multiple parsed label arrays
 * @param {Array<Array>} labelArrays - Array of parsed label arrays
 * @returns {{merged: Array, conflicts: Array}}
 */
function mergeLabels(labelArrays) {
  const merged = new Map(); // id -> label
  const conflicts = []; // Array of { id, existing, incoming, sourceIndex }
  
  for (let sourceIndex = 0; sourceIndex < labelArrays.length; sourceIndex++) {
    const labels = labelArrays[sourceIndex];
    
    for (const label of labels) {
      if (!merged.has(label.id)) {
        merged.set(label.id, { ...label, sourceIndex });
      } else {
        const existing = merged.get(label.id);
        
        // Check if it's an exact duplicate (same text and helpText)
        if (existing.text === label.text && existing.helpText === label.helpText) {
          // Exact duplicate - skip silently
          continue;
        }
        
        // Conflict: same ID but different content
        conflicts.push({
          id: label.id,
          existing: { text: existing.text, helpText: existing.helpText, sourceIndex: existing.sourceIndex },
          incoming: { text: label.text, helpText: label.helpText, sourceIndex }
        });
      }
    }
  }
  
  return {
    merged: Array.from(merged.values()),
    conflicts
  };
}

/**
 * Sort labels alphabetically by ID (case-insensitive)
 * @param {Array} labels 
 * @returns {Array}
 */
function sortLabels(labels) {
  return [...labels].sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
}

// Worker message handler
self.onmessage = async function(e) {
  const { type, payload } = e.data;
  
  switch (type) {
    case 'PARSE_FILES': {
      // payload: { files: Array<{name: string, content: string}> }
      const { files } = payload;
      const parsed = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const labels = parseLabelFile(file.content);
        parsed.push({
          name: file.name,
          labels,
          count: labels.length
        });
        
        self.postMessage({
          type: 'PROGRESS',
          payload: {
            current: i + 1,
            total: files.length,
            fileName: file.name,
            labelCount: labels.length
          }
        });
      }
      
      self.postMessage({
        type: 'PARSE_COMPLETE',
        payload: { parsed }
      });
      break;
    }
    
    case 'MERGE': {
      // payload: { labelArrays: Array<Array> }
      const { labelArrays } = payload;
      const result = mergeLabels(labelArrays);
      
      self.postMessage({
        type: 'MERGE_COMPLETE',
        payload: result
      });
      break;
    }
    
    case 'SORT': {
      // payload: { labels: Array }
      const { labels } = payload;
      const sorted = sortLabels(labels);
      
      self.postMessage({
        type: 'SORT_COMPLETE',
        payload: { sorted }
      });
      break;
    }
    
    case 'RESOLVE_CONFLICT': {
      // payload: { id: string, resolution: 'keep_existing' | 'use_incoming' | 'rename_incoming', newId?: string }
      // Handled by main thread
      break;
    }
    
    case 'SERIALIZE': {
      // payload: { labels: Array }
      const { labels } = payload;
      const content = serializeLabelFile(labels);
      
      self.postMessage({
        type: 'SERIALIZE_COMPLETE',
        payload: { content, count: labels.length }
      });
      break;
    }
    
    case 'MERGE_AND_SORT': {
      // Combined operation: merge all, sort, and serialize
      // payload: { labelArrays: Array<Array> }
      const { labelArrays } = payload;
      
      // Step 1: Merge
      const mergeResult = mergeLabels(labelArrays);
      
      // Step 2: Sort
      const sorted = sortLabels(mergeResult.merged);
      
      // Step 3: Serialize
      const content = serializeLabelFile(sorted);
      
      self.postMessage({
        type: 'MERGE_AND_SORT_COMPLETE',
        payload: {
          sorted,
          conflicts: mergeResult.conflicts,
          content,
          totalLabels: sorted.length,
          duplicatesRemoved: labelArrays.reduce((acc, arr) => acc + arr.length, 0) - sorted.length - mergeResult.conflicts.length
        }
      });
      break;
    }
  }
};
