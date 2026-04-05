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

function lineNumberAt(content, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

function extractFromXml(content, fileName) {
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
          line: lineNumberAt(content, match.index),
          type: `xml:${tag}`
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

function extractFromXpp(content, fileName) {
  const clean = stripComments(content);
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
        line: lineNumberAt(clean, match.index),
        type: 'xpp:string'
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
        occurrences: 0
      });
    }
    const group = grouped.get(key);
    group.occurrences += 1;
    if (group.contexts.length < 8) {
      group.contexts.push(item.context);
    }
  });

  return [...grouped.values()].sort((a, b) => b.occurrences - a.occurrences);
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

      if (lower.endsWith('.xml')) {
        extracted.push(...extractFromXml(content, name));
      } else if (lower.endsWith('.xpp')) {
        extracted.push(...extractFromXpp(content, name));
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
