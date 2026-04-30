export function createBackgroundProgressController({
  getElements,
  state,
  db,
  t,
  formatMs,
  formatLanguageDisplay,
  updateLabelCount
}) {
  let catalogFlushTimer = null;
  const catalogPendingUpdates = new Map();

  // --- UI Helpers ---

  const showLiveIndexLine = () => {
    const elements = getElements();
    elements.liveIndexLine?.classList.remove('hidden');
  };

  const hideLiveIndexLine = () => {
    const elements = getElements();
    elements.liveIndexLine?.classList.add('hidden');
    if (elements.liveIndexLineFill) {
      elements.liveIndexLineFill.style.width = '0%';
    }
  };

  const updateLiveIndexLine = (percent) => {
    const elements = getElements();
    const normalized = Math.max(0, Math.min(100, percent || 0));
    state.realtimeStreaming.linePercent = normalized;
    if (elements.liveIndexLineFill) {
      elements.liveIndexLineFill.style.width = `${normalized}%`;
    }
  };

  // --- Background Progress Logic ---

  function showBackgroundProgressIndicator() {
    const elements = getElements();
    if (elements.btnBackgroundProgress) {
      elements.btnBackgroundProgress.classList.remove('hidden');
    }
    if (elements.labelCountBadge) {
      elements.labelCountBadge.classList.add('hidden');
    }
    state.backgroundIndexing.completionSummary = null;
    renderBackgroundSummary();
  }

  function hideBackgroundProgressIndicator() {
    const elements = getElements();
    if (elements.btnBackgroundProgress) {
      elements.btnBackgroundProgress.classList.add('hidden');
      const textSpan = elements.btnBackgroundProgress.querySelector('.progress-text');
      if (textSpan) {
        textSpan.textContent = t('header_indexing_active', { percent: 0, count: '0' });
      }
    }
    if (elements.labelCountBadge) {
      elements.labelCountBadge.classList.remove('hidden');
    }
    if (state.indexingMode === 'idle') {
      hideLiveIndexLine();
    }
    updateLabelCount();
  }

  function updateBackgroundProgress(processedFiles, totalFiles, totalLabels) {
    state.backgroundIndexing.processedFiles = processedFiles;
    state.backgroundIndexing.totalFiles = totalFiles;
    state.backgroundIndexing.totalLabels = totalLabels;
    const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    updateLiveIndexLine(percent);
    scheduleBackgroundProgressUIUpdate();
  }

  function mergeBackgroundPairProgress(pairProgress, statusOverride = null) {
    if (!Array.isArray(pairProgress)) return;

    for (const pair of pairProgress) {
      const key = pair.key || `${pair.model}|||${pair.culture}`;
      if (!key) continue;
      const existing = state.backgroundIndexing.languageStatus.get(key) || {
        key,
        model: pair.model,
        culture: pair.culture,
        fileCount: pair.fileCount || 0,
        processedFiles: 0,
        labelCount: 0,
        status: 'waiting',
        isPriority: state.backgroundIndexing.priorityLanguages.includes(pair.culture)
      };

      existing.fileCount = pair.fileCount ?? existing.fileCount;
      existing.processedFiles = pair.processedFiles ?? existing.processedFiles;
      existing.labelCount = pair.labelCount ?? existing.labelCount;
      existing.totalProcessingMs = pair.totalProcessingMs ?? existing.totalProcessingMs ?? 0;
      existing.totalBytes = pair.totalBytes ?? existing.totalBytes ?? 0;
      existing.firstStartedAt = pair.firstStartedAt ?? existing.firstStartedAt ?? null;
      existing.lastEndedAt = pair.lastEndedAt ?? existing.lastEndedAt ?? null;
      
      if (statusOverride) {
        existing.status = statusOverride;
      } else if (existing.processedFiles > 0 && existing.status === 'waiting') {
        existing.status = 'indexing';
      }

      state.backgroundIndexing.languageStatus.set(key, existing);
    }
  }

  function queueCatalogProgressFlush() {
    if (state.indexingMode === 'idle') return;
    for (const entry of state.backgroundIndexing.languageStatus.values()) {
      catalogPendingUpdates.set(entry.key, {
        processedFiles: entry.processedFiles,
        labelCount: entry.labelCount,
        metrics: {
          totalProcessingMs: entry.totalProcessingMs || 0,
          totalBytes: entry.totalBytes || 0,
          firstStartedAt: entry.firstStartedAt || null,
          lastEndedAt: entry.lastEndedAt || null
        }
      });
    }

    if (catalogFlushTimer) return;
    catalogFlushTimer = setTimeout(async () => {
      await flushCatalogProgressNow();
    }, 500);
  }

  function resetProgressBuffers() {
    catalogPendingUpdates.clear();
    if (catalogFlushTimer) {
      clearTimeout(catalogFlushTimer);
      catalogFlushTimer = null;
    }
  }

  function flushCatalogProgressNow() {
    if (catalogFlushTimer) {
      clearTimeout(catalogFlushTimer);
      catalogFlushTimer = null;
    }

    return (async () => {
      const updates = [...catalogPendingUpdates.entries()];
      catalogPendingUpdates.clear();
      for (const [key, update] of updates) {
        try {
          await db.updateCatalogProgress(key, update.processedFiles, update.labelCount, update.metrics || null);
        } catch (err) {
          console.warn('Failed to flush catalog progress for', key, err);
        }
      }
    })();
  }

  function openBackgroundProgressModal() {
    const elements = getElements();
    if (!elements.backgroundProgressModal) return;
    renderBackgroundSummary();
    renderBackgroundLanguageList();
    elements.backgroundProgressModal.classList.remove('hidden');
  }

  function closeBackgroundProgressModal() {
    const elements = getElements();
    if (!elements.backgroundProgressModal) return;
    elements.backgroundProgressModal.classList.add('hidden');
  }

  function scheduleBackgroundProgressUIUpdate() {
    if (state.backgroundIndexing.updateScheduled) return;
    state.backgroundIndexing.updateScheduled = true;

    requestAnimationFrame(() => {
      state.backgroundIndexing.updateScheduled = false;
      renderBackgroundProgressUI();
    });
  }

  function renderBackgroundProgressUI() {
    const elements = getElements();
    const processedFiles = state.backgroundIndexing.processedFiles;
    const totalFiles = state.backgroundIndexing.totalFiles;
    const totalLabels = state.backgroundIndexing.totalLabels;
    const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    const elapsed = state.backgroundIndexing.startTime
      ? (performance.now() - state.backgroundIndexing.startTime) / 1000
      : 0;
    const labelsPerSec = elapsed > 0 ? Math.round(totalLabels / elapsed) : 0;
    state.backgroundIndexing.labelsPerSec = labelsPerSec;

    if (elements.btnBackgroundProgress) {
      const textSpan = elements.btnBackgroundProgress.querySelector('.progress-text');
      if (textSpan) {
        textSpan.textContent = t('header_indexing_active', {
          percent,
          count: totalLabels.toLocaleString()
        });
      }
    }

    if (elements.bgTotalLabels) {
      elements.bgTotalLabels.textContent = totalLabels.toLocaleString();
    }
    if (elements.bgTotalPercent) {
      elements.bgTotalPercent.textContent = `${percent}%`;
    }
    if (elements.bgProgressFill) {
      elements.bgProgressFill.style.width = `${percent}%`;
    }
    if (elements.bgSpeed) {
      elements.bgSpeed.textContent = t('labels_per_second', { count: labelsPerSec.toLocaleString() });
    }

    if (elements.bgEta) {
      if (processedFiles <= 0 || totalFiles <= 0 || labelsPerSec <= 0) {
        elements.bgEta.textContent = '--';
      } else {
        const filesPerSec = processedFiles / elapsed;
        const remaining = totalFiles - processedFiles;
        const etaSeconds = filesPerSec > 0 ? Math.round(remaining / filesPerSec) : 0;
        if (etaSeconds < 60) {
          elements.bgEta.textContent = `${etaSeconds}s`;
        } else {
          elements.bgEta.textContent = `${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`;
        }
      }
    }

    state.totalLabels = state.backgroundIndexing.baseLabelCount + totalLabels;
    if (state.totalLabels < state.backgroundIndexing.baseLabelCount) {
      state.totalLabels = state.backgroundIndexing.baseLabelCount;
    }
    updateLabelCount();

    if (!elements.backgroundProgressModal?.classList.contains('hidden')) {
      renderBackgroundSummary();
      renderBackgroundLanguageList();
    }
  }

  function renderBackgroundSummary() {
    const elements = getElements();
    if (!elements.bgSummary) return;
    const summary = state.backgroundIndexing.completionSummary;
    if (!summary) {
      elements.bgSummary.classList.add('hidden');
      elements.bgSummary.textContent = '';
      return;
    }

    elements.bgSummary.textContent = t('background_summary_complete', {
      labels: summary.labels.toLocaleString(),
      files: summary.files.toLocaleString(),
      speed: summary.speed.toLocaleString()
    });
    elements.bgSummary.classList.remove('hidden');
  }

  function renderBackgroundLanguageList() {
    const elements = getElements();
    if (!elements.bgLanguageList) return;
    const rows = aggregateBackgroundLanguageGroups();
    const existingItems = new Map();
    elements.bgLanguageList.querySelectorAll('.language-status-item[data-culture]').forEach((item) => {
      existingItems.set(item.dataset.culture, item);
    });

    const fragment = document.createDocumentFragment();
    const seenCultures = new Set();

    for (const group of rows) {
      seenCultures.add(group.culture);
      let item = existingItems.get(group.culture);

      if (!item) {
        item = createBackgroundLanguageStatusItem(group);
      } else {
        updateBackgroundLanguageStatusItem(item, group);
      }

      fragment.appendChild(item);
    }

    existingItems.forEach((item, culture) => {
      if (!seenCultures.has(culture)) {
        item.remove();
      }
    });

    if (fragment.childNodes.length > 0) {
      elements.bgLanguageList.appendChild(fragment);
    }
  }

  function aggregateBackgroundLanguageGroups() {
    const cultureGroups = new Map();

    for (const entry of state.backgroundIndexing.languageStatus.values()) {
      if (!cultureGroups.has(entry.culture)) {
        cultureGroups.set(entry.culture, {
          culture: entry.culture,
          models: [],
          totalFiles: 0,
          processedFiles: 0,
          totalLabels: 0,
          isPriority: false,
          firstStartedAt: null,
          lastEndedAt: null
        });
      }

      const group = cultureGroups.get(entry.culture);
      group.models.push(entry.model);
      group.totalFiles += entry.fileCount || 0;
      group.processedFiles += entry.processedFiles || 0;
      group.totalLabels += entry.labelCount || 0;
      if (entry.isPriority) group.isPriority = true;

      if (entry.firstStartedAt && (!group.firstStartedAt || entry.firstStartedAt < group.firstStartedAt)) {
        group.firstStartedAt = entry.firstStartedAt;
      }
      if (entry.lastEndedAt && (!group.lastEndedAt || entry.lastEndedAt > group.lastEndedAt)) {
        group.lastEndedAt = entry.lastEndedAt;
      }
    }

    return [...cultureGroups.values()]
      .map((group) => {
        const status = getLanguageAggregateStatus(group.culture);
        const statusClass = status === 'indexing' ? 'processing' : status;
        
        // Use standard text icons instead of complex characters if needed, or ensure UTF8
        const statusIcon = status === 'ready' ? '✓' : status === 'indexing' ? '⌛' : '💤';
        
        const statusTextKey = status === 'ready'
          ? 'status_ready'
          : status === 'indexing'
            ? 'status_processing'
            : 'status_waiting';
        const progressPercent = group.totalFiles > 0
          ? Math.min(100, Math.round((group.processedFiles / group.totalFiles) * 100))
          : (status === 'ready' ? 100 : 0);

        let processingTime = '';
        if (group.firstStartedAt && group.lastEndedAt) {
          processingTime = formatMs(group.lastEndedAt - group.firstStartedAt);
        }

        return {
          ...group,
          status,
          statusClass,
          statusIcon,
          statusTextKey,
          progressPercent,
          processingTime
        };
      })
      .sort((a, b) => {
        if (a.isPriority && !b.isPriority) return -1;
        if (!a.isPriority && b.isPriority) return 1;
        return a.culture.localeCompare(b.culture);
      });
  }

  function createBackgroundLanguageStatusItem(group) {
    const item = document.createElement('div');
    item.dataset.culture = group.culture;

    const languageName = document.createElement('span');
    languageName.className = 'language-name';

    const modelCount = document.createElement('span');
    modelCount.className = 'model-count';

    const labelCount = document.createElement('span');
    labelCount.className = 'label-count';

    const progressCell = document.createElement('div');
    progressCell.className = 'language-progress-cell';

    const progressBar = document.createElement('div');
    progressBar.className = 'language-progress-bar';

    const progressFill = document.createElement('div');
    progressFill.className = 'language-progress-fill';
    progressBar.appendChild(progressFill);

    const progressText = document.createElement('span');
    progressText.className = 'language-progress-text';

    progressCell.append(progressBar, progressText);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'language-status-badge';

    const processingTime = document.createElement('span');
    processingTime.className = 'processing-time hidden';

    item.append(languageName, modelCount, labelCount, progressCell, statusBadge, processingTime);
    updateBackgroundLanguageStatusItem(item, group);
    return item;
  }

  function updateBackgroundLanguageStatusItem(item, group) {
    item.dataset.culture = group.culture;
    item.className = `language-status-item ${group.statusClass}`;

    const languageName = item.querySelector('.language-name');
    if (languageName) {
      languageName.textContent = formatLanguageDisplay(group.culture);
      if (group.isPriority) {
        languageName.append(' ');
        const priorityBadge = document.createElement('span');
        priorityBadge.className = 'filter-status-indicator ready';
        priorityBadge.textContent = '★';
        languageName.appendChild(priorityBadge);
      }
    }

    const modelCount = item.querySelector('.model-count');
    if (modelCount) {
      modelCount.textContent = `${group.models.length} ${t('models_suffix') || 'models'}`;
    }

    const labelCount = item.querySelector('.label-count');
    if (labelCount) {
      labelCount.textContent = `${group.totalLabels.toLocaleString()} labels`;
    }

    const progressFill = item.querySelector('.language-progress-fill');
    if (progressFill) {
      const nextWidth = `${group.progressPercent}%`;
      if (progressFill.style.width !== nextWidth) {
        progressFill.style.width = nextWidth;
      }
    }

    const progressText = item.querySelector('.language-progress-text');
    if (progressText) {
      const nextText = `${group.progressPercent}%`;
      if (progressText.textContent !== nextText) {
        progressText.textContent = nextText;
      }
    }

    const statusBadge = item.querySelector('.language-status-badge');
    if (statusBadge) {
      const nextStatus = `${group.statusIcon} ${t(group.statusTextKey)}`;
      if (statusBadge.textContent !== nextStatus) {
        statusBadge.textContent = nextStatus;
      }
    }

    const processingTime = item.querySelector('.processing-time');
    if (processingTime) {
      if (group.processingTime) {
        processingTime.textContent = group.processingTime;
        processingTime.classList.remove('hidden');
      } else {
        processingTime.textContent = '';
        processingTime.classList.add('hidden');
      }
    }
  }

  function getLanguageAggregateStatus(culture) {
    const rows = [...state.backgroundIndexing.languageStatus.values()].filter((entry) => entry.culture === culture);
    if (rows.length === 0) return null;

    const hasProcessing = rows.some((entry) => entry.status === 'indexing');
    const hasWaiting = rows.some((entry) => entry.status === 'waiting');
    const allReady = rows.every((entry) => entry.status === 'ready');
    return allReady ? 'ready' : (hasProcessing ? 'indexing' : (hasWaiting ? 'waiting' : 'ready'));
  }

  return {
    showLiveIndexLine,
    hideLiveIndexLine,
    updateLiveIndexLine,
    showBackgroundProgressIndicator,
    hideBackgroundProgressIndicator,
    updateBackgroundProgress,
    mergeBackgroundPairProgress,
    queueCatalogProgressFlush,
    resetProgressBuffers,
    flushCatalogProgressNow,
    openBackgroundProgressModal,
    closeBackgroundProgressModal,
    scheduleBackgroundProgressUIUpdate,
    renderBackgroundSummary,
    renderBackgroundLanguageList,
    getLanguageAggregateStatus
  };
}
