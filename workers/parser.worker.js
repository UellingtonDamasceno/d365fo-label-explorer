/**
 * Label Parser Worker
 * Uses shared parser implementation from workers/utils/label-parser.js
 */
importScripts('./utils/label-parser.js');

function parseLabels(content, metadata) {
  const labels = self.SharedLabelParser.parseLabelFile(content, metadata);
  return {
    labels,
    stats: {
      totalLines: String(content || '').split('\n').length,
      parsedLabels: labels.length,
      skippedLines: 0
    }
  };
}

self.onmessage = function (event) {
  const { type, content, metadata, id } = event.data || {};

  if (type !== 'PARSE') return;

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
      error: error?.message || 'Failed to parse labels'
    });
  }
};

