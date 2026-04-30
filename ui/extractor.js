export function createExtractorController(deps) {
  const {
    getElements,
    state,
    builderState,
    extractorState,
    createExtractorSessionId,
    db,
    fileAccess,
    closeToolsModal,
    t,
    showSuccess,
    showError,
    showInfo,
    escapeHtml,
    escapeAttr,
    isAiReadyAndEnabled,
    addLabelToBuilder
  } = deps;

  const elements = new Proxy({}, {
    get: (_, key) => getElements()?.[key]
  });

  function openExtractorWorkspace() {
    closeToolsModal();
    if (!extractorState.sessionId) {
      extractorState.sessionId = createExtractorSessionId(extractorState.projectModel);
    }
    elements.extractorWorkspace?.classList.remove('hidden');
    renderExtractorFileTree();
    renderExtractorSummary();
    renderExtractorResults();
    updateExtractorStatusBadge();
    tryAutoResumeExtractorSession();
  }

  function closeExtractorWorkspace() {
    if (elements.extractorAutoSave?.checked && extractorState.candidates.length > 0) {
      saveExtractorSession().catch(console.error);
    }
    elements.extractorWorkspace?.classList.add('hidden');
  }

  function updateExtractorStatusBadge(status = 'ready') {
    if (!elements.extractorStatusBadge) return;
    elements.extractorStatusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    elements.extractorStatusBadge.className = 'extractor-status-badge ' + status;
  }

  function renderExtractorFileTree() {
    if (!elements.extractorFileTree) return;

    if (extractorState.files.length === 0) {
      elements.extractorFileTree.innerHTML = `
      <div class="extractor-empty-files">
        <span class="empty-icon">📂</span>
        <p data-i18n="extractor_no_files">No files loaded</p>
        <p class="hint" data-i18n="extractor_select_hint">Select a .rnrproj file or individual .xml/.xpp files to begin.</p>
      </div>`;
      elements.extractorProjectInfo?.classList.add('hidden');
      if (elements.extractorFilesCount) elements.extractorFilesCount.textContent = '0 files';
      if (elements.extractorFilesScanned) elements.extractorFilesScanned.textContent = '0 scanned';
      return;
    }

    if (extractorState.projectName) {
      elements.extractorProjectInfo?.classList.remove('hidden');
      if (elements.extractorProjectName) elements.extractorProjectName.textContent = extractorState.projectName;
      if (elements.extractorProjectModel) elements.extractorProjectModel.textContent = extractorState.projectModel || '';
    } else {
      elements.extractorProjectInfo?.classList.add('hidden');
    }

    const fileListHtml = extractorState.files.map((file, index) => {
      const isScanned = file.scanned;
      const candidatesFound = extractorState.candidates.filter(
        (c) => c.contexts?.some((ctx) => ctx.file === file.name)
      ).length;
      const icon = file.name.endsWith('.xml') ? '📄' : file.name.endsWith('.xpp') ? '📝' : '📁';
      return `
      <div class="extractor-file-item ${isScanned ? 'scanned' : ''}" data-index="${index}">
        <span class="file-icon">${icon}</span>
        <span class="file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name.split('/').pop())}</span>
        ${candidatesFound > 0 ? `<span class="file-count">${candidatesFound}</span>` : ''}
      </div>`;
    }).join('');

    elements.extractorFileTree.innerHTML = fileListHtml;

    const scannedCount = extractorState.files.filter((f) => f.scanned).length;
    if (elements.extractorFilesCount) elements.extractorFilesCount.textContent = `${extractorState.files.length} files`;
    if (elements.extractorFilesScanned) elements.extractorFilesScanned.textContent = `${scannedCount} scanned`;
  }

  function renderExtractorSummary() {
    const candidates = extractorState.candidates.filter((item) => item.status === 'pending').length;
    const confirmed = extractorState.candidates.filter((item) => item.status === 'confirmed' || item.status === 'reused').length;
    const ignored = extractorState.candidates.filter((item) => item.status === 'ignored').length;
    const total = extractorState.candidates.length;

    if (total === 0) {
      elements.extractorSummary?.classList.add('hidden');
      return;
    }

    elements.extractorSummary?.classList.remove('hidden');
    if (elements.extractorTotalFound) elements.extractorTotalFound.textContent = total;
    if (elements.extractorResolvedCount) elements.extractorResolvedCount.textContent = confirmed;
    if (elements.extractorIgnoredCount) elements.extractorIgnoredCount.textContent = ignored;

    if (elements.btnExtractorAddAll) {
      elements.btnExtractorAddAll.disabled = confirmed === 0;
    }
    if (elements.btnExtractorApply) {
      elements.btnExtractorApply.disabled = confirmed === 0;
    }
  }

  function updateExtractorProgress(progress = 0, label = '') {
    if (elements.extractorProgressFill) {
      elements.extractorProgressFill.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    }
    if (elements.extractorProgressLabel) {
      elements.extractorProgressLabel.textContent = label || `${Math.round(progress)}%`;
    }
    elements.extractorProgress?.classList.toggle('hidden', !extractorState.running && progress === 0);
  }

  function normalizeFsPath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+|\/+$/g, '');
  }

  function parseRnrprojManifest(content) {
    const text = String(content || '');
    const modelMatch = text.match(/<Model>\s*([^<]+?)\s*<\/Model>/i);
    const includeRegex = /<Content[^>]*Include=["']([^"']+)["'][^>]*>/gi;
    const includes = [];
    const seen = new Set();
    let match;

    while ((match = includeRegex.exec(text)) !== null) {
      const includePath = normalizeFsPath(match[1]);
      if (!includePath || seen.has(includePath)) continue;
      seen.add(includePath);
      includes.push(includePath);
    }

    return {
      model: modelMatch?.[1]?.trim() || '',
      includes
    };
  }

  async function resolveFileFromRoot(relativePath) {
    if (!state.directoryHandle) return null;

    const normalized = normalizeFsPath(relativePath);
    if (!normalized) return null;

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    let currentDir = state.directoryHandle;
    for (let i = 0; i < segments.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(segments[i]);
    }

    const fileHandle = await currentDir.getFileHandle(segments[segments.length - 1]);
    const content = await fileAccess.readFileAsText(fileHandle);
    return {
      name: normalized,
      content
    };
  }

  async function resolveFileFromCandidates(paths) {
    for (const candidate of paths) {
      try {
        const resolved = await resolveFileFromRoot(candidate);
        if (resolved) return resolved;
      } catch (err) {}
    }
    return null;
  }

  async function loadProjectFirstFiles(manifest) {
    const files = [];
    let missingCount = 0;
    const model = manifest?.model || '';
    const includes = (manifest?.includes || []).filter((includePath) => {
      const lower = includePath.toLowerCase();
      return lower.endsWith('.xml') || lower.endsWith('.xpp');
    });

    for (const includePath of includes) {
      const candidates = [];
      const normalizedInclude = normalizeFsPath(includePath);
      if (model) {
        candidates.push(`${model}/${normalizedInclude}`);
        candidates.push(`PackagesLocalDirectory/${model}/${normalizedInclude}`);
      }
      candidates.push(normalizedInclude);

      const resolved = await resolveFileFromCandidates(candidates);
      if (!resolved) {
        missingCount++;
        continue;
      }

      files.push({
        name: resolved.name,
        content: resolved.content,
        sourceModel: model || '',
        sourcePath: normalizedInclude
      });
    }

    return { files, missingCount };
  }

  function detectSemanticSourceLanguage(text) {
    const sample = (text || '').toLowerCase();
    if (!sample) return 'en';

    if (/[ãõáàâéêíóôúç]/.test(sample) || /\b( de | do | da | para | pedido | cliente | status )\b/.test(` ${sample} `)) {
      return 'pt';
    }
    if (/[ñ]/.test(sample) || /\b( el | la | estado | pedido | cliente )\b/.test(` ${sample} `)) {
      return 'es';
    }
    if (/[äöüß]/.test(sample)) {
      return 'de';
    }
    if (/[àâçéèêîôû]/.test(sample)) {
      return 'fr';
    }
    return 'en';
  }

  function toSemanticLabelId(text) {
    return String(text || '')
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('');
  }

  function derivePrefixFromModelName(modelName) {
    const clean = String(modelName || '').replace(/[^A-Za-z0-9]/g, '');
    if (!clean) return '';
    return clean.slice(0, 3).toUpperCase();
  }

  async function translateExtractorTextsForIds(candidates) {
    if (!isAiReadyAndEnabled() || !state.ai.semanticIdSuggestion || candidates.length === 0) {
      return candidates.map((item) => item.text || '');
    }

    return new Promise((resolve) => {
      const worker = new Worker('./workers/translator.worker.js', { type: 'module' });
      let finished = false;

      function cleanup(result) {
        if (finished) return;
        finished = true;
        try {
          worker.terminate();
        } catch (err) {}
        resolve(result);
      }

      worker.onmessage = (event) => {
        const { type, payload } = event.data || {};

        if (type === 'INIT_PROGRESS') {
          updateExtractorProgress(100, payload?.message || t('extractor_ai_suggestions'));
          return;
        }

        if (type === 'READY') {
          const jobs = candidates.map((item, index) => ({
            key: String(index),
            labelId: `semantic-${index}`,
            text: item.text || '',
            sourceLanguage: detectSemanticSourceLanguage(item.text),
            targetLanguage: 'en',
            sourceCulture: 'auto',
            targetCulture: 'en-US'
          }));
          worker.postMessage({ type: 'TRANSLATE', payload: { jobs } });
          return;
        }

        if (type === 'TRANSLATE_COMPLETE') {
          const translations = payload?.translations || [];
          const byKey = new Map(translations.map((item) => [item.key, item.translatedText]));
          cleanup(candidates.map((item, index) => byKey.get(String(index)) || item.text || ''));
          return;
        }

        if (type === 'ERROR') {
          cleanup(candidates.map((item) => item.text || ''));
        }
      };

      worker.onerror = () => {
        cleanup(candidates.map((item) => item.text || ''));
      };

      worker.postMessage({ type: 'INIT' });
    });
  }

  async function handleExtractorSelectFiles() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.xml,.xpp,.rnrproj,.txt';

    input.onchange = async () => {
      const files = [...(input.files || [])];
      if (files.length === 0) return;

      const manuallySelected = [];
      const manifests = [];

      for (const file of files) {
        const content = await file.text();
        const lower = file.name.toLowerCase();

        if (lower.endsWith('.rnrproj')) {
          manifests.push({
            fileName: file.name,
            ...parseRnrprojManifest(content)
          });
          continue;
        }

        manuallySelected.push({
          name: normalizeFsPath(file.name),
          content,
          sourceModel: ''
        });
      }

      const loadedMap = new Map();
      manuallySelected.forEach((item) => {
        loadedMap.set(item.name.toLowerCase(), item);
      });

      let totalMissing = 0;
      let detectedModel = '';
      for (const manifest of manifests) {
        if (manifest.model && !detectedModel) {
          detectedModel = manifest.model;
        }
        const projectLoad = await loadProjectFirstFiles(manifest);
        totalMissing += projectLoad.missingCount;
        projectLoad.files.forEach((item) => {
          loadedMap.set(item.name.toLowerCase(), item);
        });
      }

      const loaded = [...loadedMap.values()];

      extractorState.files = loaded;
      extractorState.projectModel = detectedModel || '';
      extractorState.candidates = [];
      extractorState.sessionId = createExtractorSessionId(extractorState.projectModel);
      elements.extractorResults?.classList.add('hidden');
      elements.btnExtractorAddAll?.classList.add('hidden');
      renderExtractorSummary();

      if (loaded.length === 0) {
        showError(t('extractor_select_files_error'));
        return;
      }

      if (manifests.length > 0) {
        showSuccess(t('extractor_project_loaded', { count: loaded.length, missing: totalMissing }));
      } else {
        showSuccess(t('extractor_files_loaded', { count: loaded.length }));
      }
    };

    input.click();
  }

  async function buildSuggestedIds(candidates) {
    const existing = new Set(builderState.labels.map((item) => `${item.labelId}::${item.culture}`));
    const usedIds = new Set();
    const prefix = builderState.labels.find((item) => item.prefix)?.prefix || derivePrefixFromModelName(extractorState.projectModel) || 'LBL';
    let sequence = 1;
    const culture = elements.builderCultureSelect?.value || 'en-US';
    const semanticTexts = await translateExtractorTextsForIds(candidates);
    const existingMatches = await Promise.all(
      candidates.map((item) => db.findLabelsByExactText(item.text, 5).catch(() => []))
    );

    return candidates.map((item, index) => {
      const matches = existingMatches[index] || [];
      const reuse = matches.find((label) => label.culture === culture) || matches[0] || null;
      let suggestion = toSemanticLabelId(semanticTexts[index] || item.text);

      if (!suggestion || suggestion.length < 3) {
        suggestion = `${prefix}_${String(sequence).padStart(3, '0')}`;
        sequence++;
      }

      if (/^[0-9]/.test(suggestion)) {
        suggestion = `${prefix}_${suggestion}`;
      }

      while (usedIds.has(suggestion) || existing.has(`${suggestion}::${culture}`)) {
        suggestion = `${suggestion}1`;
      }
      usedIds.add(suggestion);

      return {
        ...item,
        suggestedId: suggestion,
        status: 'pending',
        prefix,
        sourceModel: item.sourceModel || item.contexts?.[0]?.model || extractorState.projectModel || '',
        existingLabel: reuse
          ? {
              fullId: reuse.fullId || `@${reuse.prefix}:${reuse.labelId}`,
              labelId: reuse.labelId,
              prefix: reuse.prefix,
              culture: reuse.culture,
              text: reuse.text
            }
          : null
      };
    });
  }

  function renderExtractorResults() {
    if (!elements.extractorResults) return;

    const rows = extractorState.candidates;
    if (rows.length === 0) {
      elements.extractorResults.innerHTML = `
      <div class="extractor-empty-results">
        <span class="empty-icon">🔍</span>
        <p data-i18n="extractor_no_candidates">No candidates yet</p>
        <p class="hint" data-i18n="extractor_scan_hint">Load files and click Scan to find hardcoded strings.</p>
      </div>`;
      if (elements.btnExtractorAddAll) elements.btnExtractorAddAll.disabled = true;
      if (elements.btnExtractorApply) elements.btnExtractorApply.disabled = true;
      return;
    }

    const hasPending = rows.some((item) => item.status === 'pending');
    const hasConfirmed = rows.some((item) =>
      item.status === 'confirmed' || item.status === 'reused' || item.status === 'write_error'
    );

    if (elements.btnExtractorAddAll) elements.btnExtractorAddAll.disabled = !hasPending;
    if (elements.btnExtractorApply) elements.btnExtractorApply.disabled = !hasConfirmed;

    elements.extractorResults.innerHTML = rows.map((item, index) => `
    <div class="extractor-candidate ${item.status}">
      <div class="extractor-candidate-main">
        <div class="extractor-candidate-text">${escapeHtml(item.text)}</div>
        ${item.existingLabel ? `<div class="extractor-candidate-existing">💡 ${escapeHtml(item.existingLabel.fullId)}</div>` : ''}
        <div class="extractor-candidate-context">${escapeHtml((item.contexts || []).slice(0, 2).map((ctx) => `${ctx.file}:${ctx.line}`).join(' • '))}</div>
        <input class="extractor-id-input form-input" data-index="${index}" placeholder="Label ID" value="${escapeAttr(item.suggestedId || '')}" ${item.status !== 'pending' ? 'disabled' : ''}>
      </div>
      <div class="extractor-candidate-actions">
        ${item.existingLabel ? `<button class="btn btn-xs btn-outline extractor-use-existing" data-index="${index}" ${item.status !== 'pending' ? 'disabled' : ''}>Use</button>` : ''}
        <button class="btn btn-xs btn-success extractor-confirm" data-index="${index}" ${item.status !== 'pending' ? 'disabled' : ''}>✓</button>
        <button class="btn btn-xs btn-outline extractor-ignore" data-index="${index}" ${item.status !== 'pending' ? 'disabled' : ''}>✕</button>
      </div>
    </div>
  `).join('');

    elements.extractorResults.querySelectorAll('.extractor-id-input').forEach((input) => {
      input.addEventListener('input', (event) => {
        const idx = parseInt(event.currentTarget.dataset.index, 10);
        if (Number.isFinite(idx) && extractorState.candidates[idx]) {
          extractorState.candidates[idx].suggestedId = event.currentTarget.value.trim();
          if (elements.extractorAutoSave?.checked) {
            saveExtractorSession().catch(() => {});
          }
        }
      });
    });

    elements.extractorResults.querySelectorAll('.extractor-use-existing').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = parseInt(button.dataset.index, 10);
        useExistingExtractorCandidate(idx);
      });
    });

    elements.extractorResults.querySelectorAll('.extractor-confirm').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = parseInt(button.dataset.index, 10);
        confirmExtractorCandidate(idx);
      });
    });

    elements.extractorResults.querySelectorAll('.extractor-ignore').forEach((button) => {
      button.addEventListener('click', () => {
        const idx = parseInt(button.dataset.index, 10);
        ignoreExtractorCandidate(idx);
      });
    });

    renderExtractorSummary();
  }

  async function confirmExtractorCandidate(index) {
    const candidate = extractorState.candidates[index];
    if (!candidate || candidate.status !== 'pending') return;

    const labelId = (candidate.suggestedId || '').trim();
    if (!labelId) {
      showError(t('builder_id_required'));
      return;
    }

    await addLabelToBuilder({
      labelId,
      text: candidate.text,
      helpText: '',
      culture: elements.builderCultureSelect?.value || 'en-US',
      prefix: candidate.prefix || builderState.labels.find((item) => item.prefix)?.prefix || 'LBL',
      model: candidate.sourceModel || extractorState.projectModel || 'Extractor',
      sourcePath: candidate.contexts?.[0]?.file || 'scan'
    });

    candidate.status = 'confirmed';
    renderExtractorResults();
  }

  function useExistingExtractorCandidate(index) {
    const candidate = extractorState.candidates[index];
    if (!candidate || candidate.status !== 'pending' || !candidate.existingLabel) return;
    candidate.status = 'reused';
    renderExtractorResults();
  }

  function ignoreExtractorCandidate(index) {
    const candidate = extractorState.candidates[index];
    if (!candidate || candidate.status !== 'pending') return;
    candidate.status = 'ignored';
    renderExtractorResults();
  }

  async function handleExtractorAddAllToBuilder() {
    const pending = extractorState.candidates
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.status === 'pending');

    for (const entry of pending) {
      await confirmExtractorCandidate(entry.index);
    }
  }

  function ensureExtractorWorker() {
    if (extractorState.worker) return extractorState.worker;

    extractorState.worker = new Worker('./workers/extractor.worker.js');
    extractorState.worker.onmessage = async (event) => {
      const { type, payload } = event.data || {};

      if (type === 'PROGRESS') {
        extractorState.running = true;
        updateExtractorProgress(payload?.progress || 0, `${payload?.processed || 0}/${payload?.total || 0}`);
        return;
      }

      if (type === 'COMPLETE') {
        extractorState.running = false;
        try {
          updateExtractorProgress(100, t('extractor_scan_complete'));
          extractorState.candidates = await buildSuggestedIds(payload?.candidates || []);
          renderExtractorResults();
          showSuccess(t('extractor_found_candidates', { count: extractorState.candidates.length }));
        } catch (err) {
          console.error('Failed to enrich extractor candidates:', err);
          showError(t('extractor_scan_error'));
        } finally {
          setTimeout(() => updateExtractorProgress(0, ''), 600);
        }
        return;
      }

      if (type === 'ERROR') {
        extractorState.running = false;
        updateExtractorProgress(0, '');
        showError(payload?.message || t('extractor_scan_error'));
      }
    };

    extractorState.worker.onerror = (event) => {
      console.error('Extractor worker error:', event);
      extractorState.running = false;
      updateExtractorProgress(0, '');
      showError(t('extractor_scan_error'));
    };

    return extractorState.worker;
  }

  async function handleExtractorStartScan() {
    const scanFiles = extractorState.files.filter((file) => {
      const lower = file.name.toLowerCase();
      return lower.endsWith('.xml') || lower.endsWith('.xpp');
    });

    if (scanFiles.length === 0) {
      showError(t('extractor_select_files_error'));
      return;
    }

    const worker = ensureExtractorWorker();
    extractorState.running = true;
    updateExtractorProgress(0, '0%');
    worker.postMessage({
      type: 'EXTRACT',
      payload: { files: scanFiles }
    });
  }

  async function processSelectedProject(fileName, content) {
    const manifest = parseRnrprojManifest(content);

    extractorState.projectName = String(fileName || '').replace(/\.rnrproj$/i, '');
    extractorState.projectModel = manifest.model || '';
    extractorState.sessionId = createExtractorSessionId(extractorState.projectModel);

    showSuccess(t('extractor_project_loaded', { name: extractorState.projectName, files: manifest.includes.length }));

    if (state.directoryHandle && manifest.includes.length > 0) {
      await loadProjectFilesFromManifest(manifest);
    }

    renderExtractorFileTree();
    renderExtractorSummary();
  }

  async function handleExtractorSelectProject() {
    if (!('showOpenFilePicker' in window)) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.rnrproj,application/xml,text/xml';
      input.multiple = false;
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          await processSelectedProject(file.name, await file.text());
        } catch (err) {
          console.error('Failed to load project (fallback picker):', err);
          showError(t('extractor_project_error') || 'Failed to load project file');
        }
      };
      input.click();
      return;
    }

    try {
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{
          description: 'D365FO Project Files',
          accept: { 'application/xml': ['.rnrproj'] }
        }],
        multiple: false
      });

      const file = await fileHandle.getFile();
      await processSelectedProject(file.name, await file.text());
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to load project:', err);
        showError(t('extractor_project_error') || 'Failed to load project file');
      }
    }
  }

  async function loadProjectFilesFromManifest(manifest) {
    if (!manifest?.includes?.length || !state.directoryHandle) return;

    updateExtractorStatusBadge('scanning');
    const loadedFiles = [];
    const model = manifest.model || extractorState.projectModel;

    for (const include of manifest.includes) {
      try {
        const normalizedPath = normalizeFsPath(include);
        const candidates = [
          `${model}/${model}/${normalizedPath}`,
          `${model}/${normalizedPath}`,
          normalizedPath
        ];

        const resolved = await resolveFileFromCandidates(candidates);

        if (resolved) {
          loadedFiles.push({
            name: include,
            content: resolved.content,
            sourceModel: model,
            scanned: false
          });
        }
      } catch (e) {
        console.warn('Failed to load file:', include, e);
      }
    }

    extractorState.files = loadedFiles;
    updateExtractorStatusBadge('ready');
    renderExtractorFileTree();
  }

  async function saveExtractorSession() {
    if (!extractorState.sessionId) {
      extractorState.sessionId = createExtractorSessionId(extractorState.projectModel);
    }

    try {
      await db.saveExtractionSession({
        sessionId: extractorState.sessionId,
        model: extractorState.projectModel || 'generic',
        projectName: extractorState.projectName || '',
        pendingStrings: extractorState.candidates,
        ignoredStrings: extractorState.candidates.filter((item) => item.status === 'ignored'),
        completedLabels: extractorState.candidates.filter((item) => item.status === 'confirmed' || item.status === 'reused'),
        files: extractorState.files.map((file) => ({ name: file.name, sourceModel: file.sourceModel || '', scanned: file.scanned })),
        lastFileProcessed: extractorState.files[0]?.name || ''
      });
    } catch (err) {
      console.error('Failed to auto-save extraction session:', err);
    }
  }

  async function tryAutoResumeExtractorSession() {
    try {
      const sessions = await db.getExtractionSessions();
      const session = sessions[0];

      if (!session || !session.pendingStrings?.length) return;

      const remaining = session.pendingStrings.filter((s) => s.status === 'pending').length;
      if (remaining === 0) return;

      const resume = confirm(t('extractor_resume_prompt', {
        name: session.projectName || session.model || 'Previous session',
        remaining
      }));

      if (resume) {
        extractorState.sessionId = session.sessionId;
        extractorState.projectModel = session.model || '';
        extractorState.projectName = session.projectName || '';
        extractorState.candidates = session.pendingStrings || [];
        extractorState.files = (session.files || []).map((f) => ({ ...f, content: '' }));
        renderExtractorFileTree();
        renderExtractorResults();
        renderExtractorSummary();
        showSuccess(t('extractor_session_resumed'));
      }
    } catch (err) {
      console.error('Failed to check for resumable session:', err);
    }
  }

  async function handleExtractorApplyChanges() {
    const confirmed = extractorState.candidates.filter(
      (item) => item.status === 'confirmed' || item.status === 'reused' || item.status === 'write_error'
    );

    if (confirmed.length === 0) {
      showInfo(t('extractor_no_confirmed') || 'No confirmed labels to apply');
      return;
    }

    if (!extractorState.projectModel) {
      showError(t('extractor_no_model') || 'Select a project (.rnrproj) first');
      return;
    }

    const proceed = confirm(t('extractor_apply_confirm', { count: confirmed.length }) ||
      `This will modify ${confirmed.length} strings in your project files. A backup will be created. Proceed?`);

    if (!proceed) return;

    try {
      updateExtractorProgress(5, t('extractor_creating_backup') || 'Creating backup...');

      const backupId = Date.now();
      const backupFiles = [];

      for (const file of extractorState.files) {
        if (file.content) {
          backupFiles.push({
            name: file.name,
            content: file.content
          });
        }
      }

      await db.saveExtractionBackup({
        id: backupId,
        timestamp: backupId,
        model: extractorState.projectModel,
        files: backupFiles
      });

      updateExtractorProgress(20, t('extractor_processing_replacements') || 'Processing replacements...');

      const modifiedFilesMap = new Map();
      const candidateFileMap = new Map();

      confirmed.forEach((candidate) => {
        const labelId = candidate.suggestedId;
        const labelRef = `@${extractorState.projectModel}:${labelId}`;
        const candidateOccurrences = Array.isArray(candidate.occurrences) && candidate.occurrences.length > 0
          ? candidate.occurrences
          : (candidate.contexts || []);
        const candidateFiles = new Set();

        candidateOccurrences.forEach((occ) => {
          const file = extractorState.files.find((f) => f.name === occ.file);
          if (!file) return;
          candidateFiles.add(file.name);

          let content = modifiedFilesMap.get(file.name) || file.content;

          if (file.name.endsWith('.xml')) {
            const tagPattern = new RegExp(`(<(Label|HelpText|Caption|Description|DeveloperDocumentation)>)${escapeRegExp(candidate.text)}(</\\2>)`, 'g');
            content = content.replace(tagPattern, (_match, openTag, _tagName, closeTag) => `${openTag}${labelRef}${closeTag}`);
          } else {
            const stringPattern = new RegExp(`"${escapeRegExp(candidate.text)}"`, 'g');
            content = content.replace(stringPattern, () => `"${labelRef}"`);
          }

          modifiedFilesMap.set(file.name, content);
        });

        candidateFileMap.set(candidate, candidateFiles);
      });

      updateExtractorProgress(50, t('extractor_writing_files') || 'Writing files to disk...');

      let writtenCount = 0;
      const failedFiles = new Set();
      for (const [fileName, content] of modifiedFilesMap.entries()) {
        try {
          const fileHandle = await resolveFileHandle(fileName);
          if (!fileHandle) {
            failedFiles.add(fileName);
            continue;
          }

          await fileAccess.writeFileAsText(fileHandle, content);
          writtenCount++;

          const fileObj = extractorState.files.find((f) => f.name === fileName);
          if (fileObj) fileObj.content = content;
        } catch (writeErr) {
          console.error(`Failed to write file ${fileName}:`, writeErr);
          failedFiles.add(fileName);
        }
      }

      const successfulCandidates = confirmed.filter((candidate) => {
        const candidateFiles = candidateFileMap.get(candidate);
        if (!candidateFiles || candidateFiles.size === 0) return false;
        for (const fileName of candidateFiles) {
          if (failedFiles.has(fileName)) {
            return false;
          }
        }
        return true;
      });

      updateExtractorProgress(80, t('extractor_adding_to_builder') || 'Adding to Builder...');
      for (const candidate of successfulCandidates) {
        const label = {
          labelId: candidate.suggestedId,
          text: candidate.text,
          culture: state.ai.sourceLanguage || 'en-US',
          prefix: extractorState.projectModel,
          source: `Extractor (${extractorState.projectName || 'Refactor'})`
        };
        await addLabelToBuilder(label);
      }

      const processedStatuses = new Set(['confirmed', 'reused', 'write_error']);
      if (failedFiles.size > 0) {
        showError(
          t('extractor_apply_partial_error', { count: failedFiles.size }) ||
          `Failed to write ${failedFiles.size} file(s). Related candidates were kept for retry.`
        );
      }

      extractorState.candidates = extractorState.candidates.flatMap((item) => {
        if (!processedStatuses.has(item.status)) {
          return [item];
        }

        const candidateFiles = candidateFileMap.get(item);
        const hasFailedWrite = !candidateFiles ||
          candidateFiles.size === 0 ||
          [...candidateFiles].some((fileName) => failedFiles.has(fileName));

        if (hasFailedWrite) {
          return [{ ...item, status: 'write_error' }];
        }
        return [];
      });

      updateExtractorProgress(100, t('extractor_apply_complete') || 'Refactoring complete!');
      showSuccess(t('extractor_apply_success', { count: successfulCandidates.length, files: writtenCount }) ||
        `Successfully refactored ${successfulCandidates.length} strings across ${writtenCount} files.`);

      renderExtractorResults();
      renderExtractorSummary();
      saveExtractorSession();
    } catch (err) {
      console.error('Extraction apply failed:', err);
      showError(t('extractor_apply_error') || 'Failed to apply changes');
    }
  }

  async function handleExtractorRollback() {
    try {
      const backups = await db.getExtractionBackups();
      if (!backups || backups.length === 0) {
        showInfo(t('extractor_no_backups') || 'No backups found to rollback');
        return;
      }

      const latest = backups[0];
      const confirmed = confirm(t('extractor_rollback_confirm', {
        date: new Date(latest.timestamp).toLocaleString(),
        count: latest.files.length
      }) || `Rollback to backup from ${new Date(latest.timestamp).toLocaleString()}? This will restore ${latest.files.length} files.`);

      if (!confirmed) return;

      updateExtractorProgress(10, t('extractor_rolling_back') || 'Restoring files...');

      let restoredCount = 0;
      for (const file of latest.files) {
        try {
          const fileHandle = await resolveFileHandle(file.name);
          if (fileHandle) {
            await fileAccess.writeFileAsText(fileHandle, file.content);
            restoredCount++;

            const currentFile = extractorState.files.find((f) => f.name === file.name);
            if (currentFile) currentFile.content = file.content;
          }
        } catch (err) {
          console.error(`Failed to restore ${file.name}:`, err);
        }
      }

      showSuccess(t('extractor_rollback_success', { count: restoredCount }) || `Successfully restored ${restoredCount} files.`);
      renderExtractorFileTree();
      renderExtractorResults();
    } catch (err) {
      console.error('Rollback failed:', err);
      showError(t('extractor_rollback_error') || 'Failed to perform rollback');
    }
  }

  async function resolveFileHandle(relativePath) {
    if (!state.directoryHandle) return null;

    const normalized = normalizeFsPath(relativePath);
    const segments = normalized.split('/').filter(Boolean);

    const roots = [
      [],
      [extractorState.projectModel, extractorState.projectModel],
      [extractorState.projectModel],
      ['PackagesLocalDirectory', extractorState.projectModel, extractorState.projectModel]
    ];

    for (const root of roots) {
      try {
        let handle = state.directoryHandle;
        for (const segment of root) {
          handle = await handle.getDirectoryHandle(segment, { create: false });
        }

        let fileDir = handle;
        for (let i = 0; i < segments.length - 1; i++) {
          fileDir = await fileDir.getDirectoryHandle(segments[i], { create: false });
        }

        return await fileDir.getFileHandle(segments[segments.length - 1], { create: false });
      } catch (e) {}
    }

    return null;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async function handleExtractorSaveSession() {
    await saveExtractorSession();
    showSuccess(t('extractor_session_saved'));
  }

  async function handleExtractorResumeLastSession() {
    try {
      const sessions = await db.getExtractionSessions();
      const session = sessions[0];
      if (!session) {
        showInfo(t('extractor_no_session'));
        return;
      }

      extractorState.sessionId = session.sessionId;
      extractorState.projectModel = session.model || '';
      extractorState.candidates = session.pendingStrings || [];
      renderExtractorResults();
      showSuccess(t('extractor_session_resumed'));
    } catch (err) {
      console.error('Failed to load extraction session:', err);
      showError(t('extractor_session_load_error'));
    }
  }

  return {
    openExtractorWorkspace,
    closeExtractorWorkspace,
    updateExtractorStatusBadge,
    renderExtractorFileTree,
    renderExtractorSummary,
    updateExtractorProgress,
    normalizeFsPath,
    parseRnrprojManifest,
    resolveFileFromRoot,
    resolveFileFromCandidates,
    loadProjectFirstFiles,
    detectSemanticSourceLanguage,
    toSemanticLabelId,
    derivePrefixFromModelName,
    translateExtractorTextsForIds,
    handleExtractorSelectFiles,
    buildSuggestedIds,
    renderExtractorResults,
    confirmExtractorCandidate,
    useExistingExtractorCandidate,
    ignoreExtractorCandidate,
    handleExtractorAddAllToBuilder,
    ensureExtractorWorker,
    handleExtractorStartScan,
    handleExtractorSelectProject,
    loadProjectFilesFromManifest,
    saveExtractorSession,
    tryAutoResumeExtractorSession,
    handleExtractorApplyChanges,
    handleExtractorRollback,
    resolveFileHandle,
    escapeRegExp,
    handleExtractorSaveSession,
    handleExtractorResumeLastSession
  };
}
