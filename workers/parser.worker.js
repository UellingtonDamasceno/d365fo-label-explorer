/**
 * Label Parser Worker
 * Parses .labeltxt files into structured label objects
 * Uses state machine approach for multiline support
 */

// Parser states
const State = {
  SEARCHING_LABEL: 'SEARCHING',
  CAPTURING_METADATA: 'CAPTURING'
};

/**
 * Parse a label file content
 * @param {string} content - File content
 * @param {Object} metadata - File metadata (model, culture, prefix, sourcePath)
 * @returns {Object} - { labels: Array, stats: Object }
 */
function parseLabels(content, metadata) {
  const { model, culture, prefix, sourcePath } = metadata;
  const labels = [];
  const lines = content.split('\n');
  
  let currentState = State.SEARCHING_LABEL;
  let currentLabel = null;
  let totalLines = lines.length;
  let parsedLabels = 0;
  let skippedLines = 0;

  for (let i = 0; i < lines.length; i++) {
    // Remove \r if present
    const line = lines[i].replace(/\r$/, '');
    const trimmedLine = line.trimEnd();

    // Skip empty lines
    if (!trimmedLine) {
      continue;
    }

    if (currentState === State.SEARCHING_LABEL) {
      // Look for label definition: LabelID=Text
      const equalsIndex = trimmedLine.indexOf('=');
      
      if (equalsIndex > 0) {
        // Found a label definition
        const labelId = trimmedLine.substring(0, equalsIndex).trim();
        const text = trimmedLine.substring(equalsIndex + 1);
        
        // Validate labelId (should not start with space or special chars)
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
          parsedLabels++;
        } else {
          skippedLines++;
        }
      } else {
        skippedLines++;
      }
    } else if (currentState === State.CAPTURING_METADATA) {
      // Check if this is a metadata/help line (starts with " ;")
      if (line.startsWith(' ;')) {
        // Extract help text (remove " ;" prefix)
        const helpText = line.substring(2).trimEnd();
        if (currentLabel.help) {
          currentLabel.help += ' ' + helpText;
        } else {
          currentLabel.help = helpText;
        }
      } else {
        // Not a metadata line, save current label and process this line as new label
        if (currentLabel) {
          labels.push(currentLabel);
        }
        
        // Check if this is a new label definition
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
            parsedLabels++;
          } else {
            currentLabel = null;
            currentState = State.SEARCHING_LABEL;
            skippedLines++;
          }
        } else {
          currentLabel = null;
          currentState = State.SEARCHING_LABEL;
          skippedLines++;
        }
      }
    }
  }

  // Don't forget the last label
  if (currentLabel) {
    labels.push(currentLabel);
  }

  return {
    labels,
    stats: {
      totalLines,
      parsedLabels,
      skippedLines
    }
  };
}

// Worker message handler
self.onmessage = function(event) {
  const { type, content, metadata, id } = event.data;

  if (type === 'PARSE') {
    try {
      const result = parseLabels(content, metadata);
      
      self.postMessage({
        type: 'RESULT',
        id,
        labels: result.labels,
        stats: result.stats
      });
    } catch (error) {
      self.postMessage({
        type: 'ERROR',
        id,
        error: error.message
      });
    }
  }
};
