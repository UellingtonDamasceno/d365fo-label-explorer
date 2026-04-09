function buildFinalLabels(mergeResult, resolvedConflicts) {
  const finalLabels = [...(mergeResult?.sorted || [])];
  for (const conflict of mergeResult?.conflicts || []) {
    const resolution = resolvedConflicts.get(conflict.id) || 'keep_existing';
    if (resolution !== 'use_incoming') continue;

    const idx = finalLabels.findIndex((label) => label.id === conflict.id);
    if (idx === -1) continue;

    finalLabels[idx] = {
      ...finalLabels[idx],
      text: conflict.incoming.text,
      helpText: conflict.incoming.helpText
    };
  }
  return finalLabels;
}

export function createMergerController({
  getElements,
  t,
  showError,
  showSuccess,
  escapeHtml
}) {
  const state = {
    files: [], // Array of { name, content }
    parsedFiles: [], // Array of parsed file results
    mergeResult: null, // { sorted, conflicts, content, totalLabels, duplicatesRemoved }
    resolvedConflicts: new Map(), // conflictId -> resolution
    worker: null
  };

  function openToolsModal() {
    const elements = getElements();
    elements.toolsModal?.classList.remove('hidden');
  }

  function closeToolsModal() {
    const elements = getElements();
    elements.toolsModal?.classList.add('hidden');
  }

  function closeMergerWorker() {
    if (!state.worker) return;
    try {
      state.worker.terminate();
    } catch (_) {}
    state.worker = null;
  }

  function resetMergerState() {
    const elements = getElements();
    state.files = [];
    state.parsedFiles = [];
    state.mergeResult = null;
    state.resolvedConflicts = new Map();

    // Reset UI
    elements.mergerStepFiles?.classList.remove('hidden');
    elements.mergerStepResults?.classList.add('hidden');
    elements.mergerFileList?.classList.add('hidden');
    elements.mergerConflictsSection?.classList.add('hidden');
    elements.btnMergerBack?.classList.add('hidden');
    elements.btnMergerMerge?.classList.remove('hidden');
    elements.btnMergerDownload?.classList.add('hidden');

    if (elements.btnMergerMerge) {
      elements.btnMergerMerge.disabled = true;
      elements.btnMergerMerge.innerHTML = `<span data-i18n="btn_merge">${t('btn_merge') || 'Merge Files'}</span>`;
    }
    if (elements.mergerFilesContainer) {
      elements.mergerFilesContainer.innerHTML = '';
    }
    if (elements.mergerPreviewContent) {
      elements.mergerPreviewContent.textContent = '';
    }
  }

  function openMergerModal() {
    const elements = getElements();
    closeToolsModal();
    resetMergerState();
    elements.mergerModal?.classList.remove('hidden');
  }

  function closeMergerModal() {
    const elements = getElements();
    elements.mergerModal?.classList.add('hidden');
    closeMergerWorker();
  }

  function setMergerMergeButtonLoading(isLoading) {
    const elements = getElements();
    if (!elements.btnMergerMerge) return;
    if (isLoading) {
      elements.btnMergerMerge.disabled = true;
      elements.btnMergerMerge.innerHTML = `<span data-i18n="merging">${t('merging') || 'Merging...'}</span>`;
      return;
    }

    elements.btnMergerMerge.innerHTML = `<span data-i18n="btn_merge">${t('btn_merge') || 'Merge Files'}</span>`;
    elements.btnMergerMerge.disabled = state.files.length < 2;
  }

  function setupMergerDropzone() {
    const elements = getElements();
    const dropzone = elements.mergerDropzone;
    if (!dropzone || dropzone.dataset.bound === '1') return;
    dropzone.dataset.bound = '1';

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');

      const files = [...e.dataTransfer.files].filter((file) => file.name.endsWith('.label.txt'));
      if (files.length === 0) {
        showError(t('merger_error_no_label_files') || 'Please select .label.txt files');
        return;
      }

      await addMergerFiles(files);
    });
  }

  async function handleMergerSelectFiles(e) {
    e?.stopPropagation();

    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '.txt';

    input.onchange = async () => {
      const files = [...(input.files || [])].filter((file) => file.name.endsWith('.label.txt'));
      if (files.length === 0) {
        showError(t('merger_error_no_label_files') || 'Please select .label.txt files');
        return;
      }
      await addMergerFiles(files);
    };

    input.click();
  }

  async function addMergerFiles(files) {
    for (const file of files) {
      if (state.files.some((existing) => existing.name === file.name)) continue;
      const content = await file.text();
      state.files.push({ name: file.name, content });
    }

    updateMergerFileList();
  }

  function updateMergerFileList() {
    const elements = getElements();
    if (!elements.mergerFilesContainer) return;

    if (state.files.length === 0) {
      elements.mergerFileList?.classList.add('hidden');
      if (elements.btnMergerMerge) elements.btnMergerMerge.disabled = true;
      return;
    }

    elements.mergerFileList?.classList.remove('hidden');
    elements.mergerFilesContainer.innerHTML = state.files.map((file, idx) => `
      <div class="file-item" data-index="${idx}">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(file.name)}</span>
        <button class="file-remove" data-index="${idx}" title="Remove">✕</button>
      </div>
    `).join('');

    elements.mergerFilesContainer.querySelectorAll('.file-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number.parseInt(btn.dataset.index, 10);
        state.files.splice(idx, 1);
        updateMergerFileList();
      });
    });

    if (elements.btnMergerMerge) {
      elements.btnMergerMerge.disabled = state.files.length < 2;
    }
  }

  function handleMergerClearFiles() {
    state.files = [];
    updateMergerFileList();
  }

  function handleMergerBack() {
    const elements = getElements();
    elements.mergerStepFiles?.classList.remove('hidden');
    elements.mergerStepResults?.classList.add('hidden');
    elements.btnMergerBack?.classList.add('hidden');
    elements.btnMergerMerge?.classList.remove('hidden');
    elements.btnMergerDownload?.classList.add('hidden');

    state.mergeResult = null;
    state.resolvedConflicts.clear();
    setMergerMergeButtonLoading(false);
  }

  async function handleMergerMerge() {
    if (state.files.length < 2) {
      showError(t('merger_error_min_files') || 'Please select at least 2 files to merge');
      return;
    }

    if (!state.worker) {
      state.worker = new Worker(new URL('../workers/merger.worker.js', import.meta.url));
    }

    setMergerMergeButtonLoading(true);

    return new Promise((resolve, reject) => {
      state.worker.onmessage = (e) => {
        const { type, payload } = e.data || {};

        if (type === 'PARSE_COMPLETE') {
          state.parsedFiles = payload.parsed;
          const labelArrays = payload.parsed.map((parsed) => parsed.labels);

          state.worker.postMessage({
            type: 'MERGE_AND_SORT',
            payload: { labelArrays }
          });
          return;
        }

        if (type === 'MERGE_AND_SORT_COMPLETE') {
          state.mergeResult = payload;
          showMergeResults();
          resolve();
          return;
        }

        if (type === 'ERROR') {
          const message = payload?.message || t('merger_error_generic') || 'Failed to merge files';
          showError(message);
          closeMergerWorker();
          reject(new Error(message));
        }
      };

      state.worker.onerror = (err) => {
        console.error('Merger worker error:', err);
        closeMergerWorker();
        showError(t('merger_error_generic') || 'Failed to merge files');
        reject(err);
      };

      state.worker.postMessage({
        type: 'PARSE_FILES',
        payload: {
          files: state.files.map((file) => ({ name: file.name, content: file.content }))
        }
      });
    }).finally(() => {
      setMergerMergeButtonLoading(false);
    });
  }

  function showMergeResults() {
    const elements = getElements();
    const result = state.mergeResult;
    if (!result) return;

    elements.mergerStepFiles?.classList.add('hidden');
    elements.mergerStepResults?.classList.remove('hidden');
    elements.btnMergerBack?.classList.remove('hidden');
    elements.btnMergerMerge?.classList.add('hidden');

    if (elements.mergerTotalLabels) {
      elements.mergerTotalLabels.textContent = result.totalLabels.toLocaleString();
    }
    if (elements.mergerDuplicates) {
      elements.mergerDuplicates.textContent = result.duplicatesRemoved.toLocaleString();
    }
    if (elements.mergerConflicts) {
      elements.mergerConflicts.textContent = result.conflicts.length.toLocaleString();
    }

    if (result.conflicts.length > 0) {
      elements.mergerConflictsSection?.classList.remove('hidden');
      renderMergerConflicts();
    } else {
      elements.mergerConflictsSection?.classList.add('hidden');
      elements.btnMergerDownload?.classList.remove('hidden');
    }

    updateMergerPreview();
  }

  function renderMergerConflicts() {
    const elements = getElements();
    if (!elements.mergerConflictsList || !state.mergeResult) return;

    const conflicts = state.mergeResult.conflicts;
    elements.mergerConflictsList.innerHTML = conflicts.map((conflict, idx) => {
      const existingFile = state.parsedFiles[conflict.existing.sourceIndex]?.name || `File ${conflict.existing.sourceIndex + 1}`;
      const incomingFile = state.parsedFiles[conflict.incoming.sourceIndex]?.name || `File ${conflict.incoming.sourceIndex + 1}`;
      const resolution = state.resolvedConflicts.get(conflict.id) || 'keep_existing';

      return `
        <div class="conflict-item">
          <div class="conflict-id">${escapeHtml(conflict.id)}</div>
          <div class="conflict-versions">
            <div class="conflict-version">
              <input type="radio" name="conflict-${idx}" value="keep_existing" id="conflict-${idx}-existing" ${resolution === 'keep_existing' ? 'checked' : ''}>
              <label for="conflict-${idx}-existing">
                <span class="version-text">"${escapeHtml(conflict.existing.text)}"</span>
                <span class="version-source">From: ${escapeHtml(existingFile)}</span>
              </label>
            </div>
            <div class="conflict-version">
              <input type="radio" name="conflict-${idx}" value="use_incoming" id="conflict-${idx}-incoming" ${resolution === 'use_incoming' ? 'checked' : ''}>
              <label for="conflict-${idx}-incoming">
                <span class="version-text">"${escapeHtml(conflict.incoming.text)}"</span>
                <span class="version-source">From: ${escapeHtml(incomingFile)}</span>
              </label>
            </div>
          </div>
        </div>
      `;
    }).join('');

    elements.mergerConflictsList.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const name = e.target.name;
        const idx = Number.parseInt(name.split('-')[1], 10);
        const conflict = conflicts[idx];
        state.resolvedConflicts.set(conflict.id, e.target.value);

        updateMergerPreview();
        checkMergerReady();
      });
    });

    conflicts.forEach((conflict) => {
      if (!state.resolvedConflicts.has(conflict.id)) {
        state.resolvedConflicts.set(conflict.id, 'keep_existing');
      }
    });

    checkMergerReady();
  }

  function checkMergerReady() {
    const elements = getElements();
    const conflicts = state.mergeResult?.conflicts || [];
    const allResolved = conflicts.every((conflict) => state.resolvedConflicts.has(conflict.id));
    if (allResolved) {
      elements.btnMergerDownload?.classList.remove('hidden');
    }
  }

  function updateMergerPreview() {
    const elements = getElements();
    if (!elements.mergerPreviewContent || !state.mergeResult) return;

    const finalLabels = buildFinalLabels(state.mergeResult, state.resolvedConflicts);
    const previewLines = finalLabels.slice(0, 50).map((label) => {
      let line = `${label.id}=${String(label.text || '').replace(/;/g, ';;')}`;
      if (label.helpText) {
        line += `;${String(label.helpText).replace(/;/g, ';;')}`;
      }
      return line;
    });

    if (finalLabels.length > 50) {
      previewLines.push(`... and ${finalLabels.length - 50} more labels`);
    }

    elements.mergerPreviewContent.textContent = previewLines.join('\n');
  }

  function handleMergerDownload() {
    if (!state.mergeResult) return;

    const finalLabels = buildFinalLabels(state.mergeResult, state.resolvedConflicts);
    const lines = finalLabels.map((label) => {
      let line = `${label.id}=${String(label.text || '').replace(/;/g, ';;')}`;
      if (label.helpText) {
        line += `;${String(label.helpText).replace(/;/g, ';;')}`;
      }
      return line;
    });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'merged.label.txt';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);

    showSuccess(t('merger_download_complete') || `Downloaded merged file with ${finalLabels.length} labels`);
  }

  return {
    state,
    openToolsModal,
    closeToolsModal,
    openMergerModal,
    closeMergerModal,
    setupMergerDropzone,
    handleMergerSelectFiles,
    handleMergerClearFiles,
    handleMergerBack,
    handleMergerMerge,
    handleMergerDownload
  };
}
