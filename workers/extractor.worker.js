const XML_TAGS = ['Label', 'HelpText', 'Caption', 'DeveloperDocumentation', 'Description'];
const SQL_PATTERN = /\b(select|from|join|where|insert|update|delete|group by|order by)\b/i;
const TECHNICAL_PATTERN = /\b(find|exists|checkexist|initial|bin)\b/i;

function shouldIgnoreCandidate(text) {
  const value = (text || '').trim();
  if (!value) return true;
  if (value.length < 3) return true;
  if (value.startsWith('@')) return true;
  if (/^[\d\W_]+$/.test(value)) return true;
  if (SQL_PATTERN.test(value)) return true;
  if (TECHNICAL_PATTERN.test(value) && value.length < 16) return true;
  return false;
}

function buildLineIndex(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineNumberAt(lineIndex, charIndex) {
  let lo = 0;
  let hi = lineIndex.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineIndex[mid] <= charIndex) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hi + 1;
}

function extractFromXml(content, fileName, sourceModel = '') {
  const lineIndex = buildLineIndex(content);
  const results = [];
  for (const tag of XML_TAGS) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match;
    while ((match = regex.exec(content)) !== null) {
      const text = (match[1] || '').trim();
      if (shouldIgnoreCandidate(text)) continue;
      results.push({
        text,
        context: {
          file: fileName,
          line: lineNumberAt(lineIndex, match.index),
          type: `xml:${tag}`,
          model: sourceModel
        }
      });
    }
  }
  return results;
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function extractFromXpp(content, fileName, sourceModel = '') {
  const clean = stripComments(content);
  const lineIndex = buildLineIndex(clean);
  const results = [];
  const regex = /"([^"\n]{3,})"|'([^'\n]{3,})'/g;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    const text = (match[1] || match[2] || '').trim();
    if (shouldIgnoreCandidate(text)) continue;

    results.push({
      text,
      context: {
        file: fileName,
        line: lineNumberAt(lineIndex, match.index),
        type: 'xpp:string',
        model: sourceModel
      }
    });
  }

  return results;
}

function dedupeResults(rawResults) {
  const grouped = new Map();

  rawResults.forEach((item) => {
    const key = item.text;
    if (!grouped.has(key)) {
      grouped.set(key, {
        text: item.text,
        contexts: [],
        occurrences: [],
        occurrenceCount: 0
      });
    }
    const group = grouped.get(key);
    group.occurrenceCount += 1;
    group.occurrences.push(item.context);
    if (group.contexts.length < 8) {
      group.contexts.push(item.context);
    }
  });

  return [...grouped.values()].sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  if (type !== 'EXTRACT') return;

  try {
    const files = payload?.files || [];
    const extracted = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const name = file.name || '';
      const lower = name.toLowerCase();
      const content = file.content || '';
      const sourceModel = file.sourceModel || '';

      if (lower.endsWith('.xml')) {
        extracted.push(...extractFromXml(content, name, sourceModel));
      } else if (lower.endsWith('.xpp')) {
        extracted.push(...extractFromXpp(content, name, sourceModel));
      }

      self.postMessage({
        type: 'PROGRESS',
        payload: {
          processed: i + 1,
          total: files.length,
          progress: Math.round(((i + 1) / Math.max(files.length, 1)) * 100)
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    self.postMessage({
      type: 'COMPLETE',
      payload: {
        candidates: dedupeResults(extracted),
        filesScanned: files.length
      }
    });
  } catch (err) {
    self.postMessage({
      type: 'ERROR',
      payload: { message: err?.message || 'Extractor worker failure' }
    });
  }
};
