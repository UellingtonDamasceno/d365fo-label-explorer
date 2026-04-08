/**
 * Shared label parser for workers.
 * Canonical format:
 *   LabelId=Text
 *    ;Optional help text
 */
(function (scope) {
  function normalizeLine(rawLine) {
    if (!rawLine) return '';
    const lastIdx = rawLine.length - 1;
    return rawLine.charCodeAt(lastIdx) === 13 ? rawLine.slice(0, -1) : rawLine;
  }

  function parseLabelFile(content, metadata) {
    const source = String(content || '');
    const lines = source.split('\n');
    const m = metadata || {};
    const model = m.model || '';
    const culture = m.culture || '';
    const prefix = m.prefix || '';
    const sourcePath = m.sourcePath || '';
    const labels = [];
    let currentLabel = null;

    for (let i = 0; i < lines.length; i++) {
      const line = normalizeLine(lines[i]);
      if (!line) continue;

      if (line.charCodeAt(0) === 32 && line.charCodeAt(1) === 59) {
        if (currentLabel) {
          const helpText = line.slice(2).trim();
          if (helpText) {
            currentLabel.help = currentLabel.help
              ? `${currentLabel.help} ${helpText}`
              : helpText;
          }
        }
        continue;
      }

      if (currentLabel) {
        labels.push(currentLabel);
        currentLabel = null;
      }

      const equalsIndex = line.indexOf('=');
      if (equalsIndex > 0 && line.charCodeAt(0) !== 32) {
        const labelId = line.slice(0, equalsIndex);
        const text = line.slice(equalsIndex + 1);
        if (!labelId.trim()) continue;

        const labelKey = model || culture || prefix
          ? `${model}|${culture}|${prefix}|${labelId}`
          : labelId;

        currentLabel = {
          id: labelKey,
          fullId: prefix ? `@${prefix}:${labelId}` : labelId,
          labelId,
          text,
          help: '',
          model,
          culture,
          prefix,
          sourcePath
        };
      }
    }

    if (currentLabel) {
      labels.push(currentLabel);
    }

    return labels;
  }

  function serializeLabelFile(labels) {
    const lines = [];
    for (const label of labels || []) {
      const labelId = label.labelId || label.id || '';
      lines.push(`${labelId}=${label.text || ''}`);
      const help = label.help || label.helpText || '';
      if (help && String(help).trim()) {
        lines.push(` ;${String(help).trim()}`);
      }
    }
    return lines.join('\n');
  }

  scope.SharedLabelParser = {
    parseLabelFile,
    serializeLabelFile
  };
})(typeof self !== 'undefined' ? self : globalThis);

