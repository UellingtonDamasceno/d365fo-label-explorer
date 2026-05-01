import { DB_NAME, DB_VERSION } from '../core/db-constants.js';

function createElementsProxy(getElements) {
  return new Proxy({}, {
    get(_target, prop) {
      return getElements()?.[prop];
    },
    set(_target, prop, value) {
      const elements = getElements();
      if (!elements) return false;
      elements[prop] = value;
      return true;
    }
  });
}

export function createDiscoveryController({
  getElements,
  state,
  setState,
  getState,
  t,
  showInfo,
  showError,
  showSuccess,
  showOnboarding,
  hideSplash,
  getLanguageFlag,
  formatLanguageDisplay,
  buildPriorityLanguages,
  pickAvailablePriorityLanguages,
  escapeHtml,
  escapeAttr,
  modalController,
  stopRealtimeStreaming,
  hideBackgroundProgressIndicator,
  renderBackgroundSummary,
  showLiveIndexLine,
  hideLiveIndexLine,
  updateLiveIndexLine,
  progressController,
  fileAccess,
  db,
  searchService,
  showMainInterface,
  emitIndexingCompleteSync,
  renderFilterPills,
  updateLabelCount,
  updateLastIndexedDisplay,
  scheduleStreamingSearchRefresh
}) {
  const elements = createElementsProxy(getElements);

  // Extract progress methods to fix ReferenceErrors
  const {
    showBackgroundProgressIndicator,
    updateBackgroundProgress,
    mergeBackgroundPairProgress,
    queueCatalogProgressFlush,
    flushCatalogProgressNow,
    scheduleBackgroundProgressUIUpdate,
    renderBackgroundLanguageList,
    renderBackgroundSummary: renderBackgroundSummaryLocal
  } = progressController;

  const MAX_TOTAL_INDEXER_WORKERS = 4;
  let activeIndexerWorkers = 0;
  let parserLoadPromise = null;

  function reserveIndexerWorkerSlot() {
    activeIndexerWorkers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeIndexerWorkers = Math.max(0, activeIndexerWorkers - 1);
    };
  }

  function resolveWorkerCount(mode, totalFiles) {
    if (!totalFiles || totalFiles <= 0) return 0;
    const hardware = navigator.hardwareConcurrency || 4;
    const preferred = mode === 'priority'
      ? Math.min(hardware, 3)
      : mode === 'background'
        ? 2
        : Math.min(hardware, 4);
    const availableSlots = Math.max(1, MAX_TOTAL_INDEXER_WORKERS - activeIndexerWorkers);
    return Math.max(1, Math.min(preferred, availableSlots, totalFiles));
  }

  function releaseIndexedFileHandlesIfPossible() {
    if (state.displaySettings.builderDirectSaveMode) return;

    for (const model of state.discoveryData) {
      for (const culture of model.cultures || []) {
        for (const file of culture.files || []) {
          if (file?.handle) {
            file.handle = null;
          }
        }
      }
    }
  }

  async function ensureSharedLabelParser() {
    if (globalThis.SharedLabelParser?.parseLabelFile) return;
    if (!parserLoadPromise) {
      parserLoadPromise = import('../workers/utils/label-parser.js');
    }
    await parserLoadPromise;
    if (!globalThis.SharedLabelParser?.parseLabelFile) {
      throw new Error('SharedLabelParser not available on main thread.');
    }
  }

  function normalizeLabelForSearch(label) {
    const normalizedText = (label.text || '').toLowerCase();
    const normalizedId = (label.labelId || '').toLowerCase();
    label.s = `${normalizedId} ${normalizedText}`.trim();
    return label;
  }

  /**
   * Handle folder selection
   */
  async function handleSelectFolder() {
    try {
      setState('directoryHandle', await fileAccess.selectDirectory());
      console.log('📁 Selected folder:', state.directoryHandle.name);
      
      // Save handle for future sessions
      await db.saveDirectoryHandle(state.directoryHandle);
      
      // Start discovery
      await startDiscovery();
    } catch (err) {
      if (err.message === 'USER_CANCELLED') {
        showInfo(t('toast_select_folder') || 'Please select a folder to continue.');
        return;
      }
      console.error('Folder selection error:', err);
      showError(t('toast_folder_access_error') || 'Failed to access folder. Please try again.');
    }
  }

  /**
   * Handle folder change from main interface
   */
  async function handleChangeFolder() {
    try {
      // IMPORTANT: showDirectoryPicker MUST be the first async call to maintain user gesture context
      const newHandle = await fileAccess.selectDirectory();

      // Show feedback immediately after folder picker returns
      elements.discoveryDashboard?.classList.add('hidden');
      elements.app?.classList.add('hidden');
      elements.onboardingOverlay?.classList.remove('hidden');
      elements.btnSelectFolder?.classList.add('hidden');
      elements.scanProgress?.classList.remove('hidden');
      if (elements.scanStatus) {
        elements.scanStatus.textContent = t('clearing_previous_index') || 'Clearing previous index...';
      }
      
      // Only clear data AFTER successfully selecting a new folder
      searchService.invalidateSearchCache();
      await searchService.clearWarmStartCache();
      await db.clearLabels();
      await db.clearCatalog();
      searchService.clearSearch();
      await searchService.initSearch();
      if (elements.scanStatus) {
        elements.scanStatus.textContent = t('preparing_new_scan') || 'Preparing new scan...';
      }
      
      // Save new handle
      setState('directoryHandle', newHandle);
      await db.saveDirectoryHandle(state.directoryHandle);
      console.log('📁 Changed to folder:', state.directoryHandle.name);
      
      // Start discovery with new folder
      await startDiscovery();
    } catch (err) {
      if (err.message === 'USER_CANCELLED') {
        showInfo(t('toast_folder_change_cancelled') || 'Folder change cancelled. Keeping existing data.');
        return;
      }
      console.error('Folder change error:', err);
      showError(t('toast_folder_access_error') || 'Failed to access folder. Please try again.');
    }
  }

  /**
   * Start discovery scan
   */
  async function startDiscovery() {
    setState('stage', 'DISCOVERING');
    
    // Ensure correct overlays are visible for scanning feedback
    elements.discoveryDashboard?.classList.add('hidden');
    elements.app?.classList.add('hidden');
    elements.onboardingOverlay?.classList.remove('hidden');
    
    // Show progress
    elements.btnSelectFolder?.classList.add('hidden');
    elements.scanProgress?.classList.remove('hidden');
    
    try {
      // Discover label files
      setState('discoveryData', await fileAccess.discoverLabelFiles(
        state.directoryHandle,
        (progress) => {
          if (elements.scanStatus) {
            elements.scanStatus.textContent = t('scanning_status', { 
              models: progress.foundModels, 
              dirs: progress.scannedDirs 
            }) || `Scanning... Found ${progress.foundModels} models (${progress.scannedDirs} directories scanned)`;
          }
        }
      ));
      
      console.log('📊 Discovery complete:', state.discoveryData);
      
      if (state.discoveryData.length === 0) {
        showError(t('error_no_labels') || 'No D365FO label files found. Make sure you selected the correct folder.');
        elements.btnSelectFolder?.classList.remove('hidden');
        elements.scanProgress?.classList.add('hidden');
        return;
      }
      
      // Show dashboard
      showDiscoveryDashboard();
    } catch (err) {
      console.error('Discovery error:', err);
      showError(t('error_scan_failed') || 'Failed to scan folder. Please try again.');
      elements.btnSelectFolder?.classList.remove('hidden');
      elements.scanProgress?.classList.add('hidden');
    }
  }

  function showDiscoveryDashboard() {
    setState('stage', 'DASHBOARD');
    
    // Reset UI elements to initial state
    elements.indexingProgress?.classList.add('hidden');
    elements.btnStartIndexing?.classList.remove('hidden');
    elements.btnStartIndexing?.classList.remove('disabled');
    elements.btnQuickStart?.classList.remove('hidden');
    elements.btnQuickStart?.classList.remove('disabled');
    elements.btnChangeFolder?.classList.remove('hidden');
    
    // Reset progress bars and status text
    if (elements.progressFill) {
      elements.progressFill.style.width = '0%';
    }
    if (elements.indexingStatus) {
      elements.indexingStatus.textContent = t('indexing_labels');
    }
    
    // Reset background indexing state on re-scan
    state.backgroundIndexing.enabled = false;
    state.backgroundIndexing.totalFiles = 0;
    state.backgroundIndexing.processedFiles = 0;
    state.backgroundIndexing.totalLabels = 0;
    state.backgroundIndexing.baseLabelCount = 0;
    state.backgroundIndexing.labelsPerSec = 0;
    state.backgroundIndexing.languageStatus.clear();
    state.backgroundIndexing.updateScheduled = false;
    state.backgroundIndexing.completionSummary = null;
    stopRealtimeStreaming();
    state.realtimeStreaming.streamedLabels = 0;
    progressController.resetProgressBuffers();
    state.indexingMode = 'idle';
    
    // Hide background progress header button on re-scan
    hideBackgroundProgressIndicator();
    if (elements.btnBackgroundProgress) {
      const textSpan = elements.btnBackgroundProgress.querySelector('.progress-text');
      if (textSpan) {
        textSpan.textContent = t('header_indexing_active', { percent: 0, count: '0' });
      }
    }
    if (elements.bgProgressFill) {
      elements.bgProgressFill.style.width = '0%';
    }
    if (elements.bgTotalPercent) {
      elements.bgTotalPercent.textContent = '0%';
    }
    if (elements.bgTotalLabels) {
      elements.bgTotalLabels.textContent = '0';
    }
    if (elements.bgEta) {
      elements.bgEta.textContent = '--';
    }
    if (elements.bgSpeed) {
      elements.bgSpeed.textContent = t('labels_per_second', { count: '0' });
    }
    renderBackgroundSummary();
    hideLiveIndexLine();
    
    // Reset model list (clear any previous rendered content)
    if (elements.modelsListContainer) {
      elements.modelsListContainer.innerHTML = '';
    }
    
    // Show/hide cancel button based on whether we're coming from READY (re-scan)
    if (state.previousStage === 'READY') {
      elements.btnCancelRescan?.classList.remove('hidden');
    } else {
      elements.btnCancelRescan?.classList.add('hidden');
    }
    
    // Also hide main app in case we're coming from there
    elements.app?.classList.add('hidden');
    closeAdvancedSelectionModal();
    
    // Calculate totals
    const totalModels = state.discoveryData.length;
    const totalFiles = state.discoveryData.reduce((sum, m) => sum + m.fileCount, 0);
    
    // Initialize selection state (all selected by default)
    state.selectionState.clear();
    state.selectionHistory = [];
    state.discoveryData.forEach(model => {
      model.cultures.forEach(culture => {
        const key = `${model.model}|||${culture.culture}`;
        state.selectionState.set(key, true);
      });
    });
    
    // Update summary using i18n
    elements.discoverySummary.innerHTML = t('discovery_summary', { models: totalModels, files: totalFiles });

    // Initialize language filter with all languages selected
    state.languageFilter.selectedLanguages.clear();
    const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))];
    uniqueCultures.forEach(c => state.languageFilter.selectedLanguages.add(c));
    state.backgroundIndexing.priorityLanguages = pickAvailablePriorityLanguages(uniqueCultures, navigator.language, 3);
    if (state.backgroundIndexing.priorityLanguages.length === 0) {
      state.backgroundIndexing.priorityLanguages = buildPriorityLanguages().slice(0, 3);
    }
    updateLanguageFilterCount();
    
    // SPEC-23: Render priority language chips
    renderPriorityLanguageChips();
    
    // Render models list with checkboxes
    renderModelsListWithSelection();
    
    // Update selection info
    updateSelectionInfo();
    
    // Show dashboard
    elements.onboardingOverlay?.classList.add('hidden');
    elements.discoveryDashboard?.classList.remove('hidden');
  }

  function renderPriorityLanguageChips() {
    const priorityLangs = state.backgroundIndexing.priorityLanguages;
    const availableCultures = new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)));
    
    let totalPriorityFiles = 0;
    const chips = priorityLangs.map(lang => {
      const isAvailable = availableCultures.has(lang);
      let fileCount = 0;
      
      if (isAvailable) {
        state.discoveryData.forEach(model => {
          const culture = model.cultures.find(c => c.culture === lang);
          if (culture) fileCount += culture.files.length;
        });
        totalPriorityFiles += fileCount;
      }
      
      const flag = getLanguageFlag(lang);
      return `
        <div class="priority-chip ${isAvailable ? 'available' : 'unavailable'}">
          <span>${flag} ${lang}</span>
          ${isAvailable ? `<span class="chip-count">${fileCount} files</span>` : ''}
        </div>
      `;
    }).join('');
    
    if (elements.priorityLanguageChips) {
      elements.priorityLanguageChips.innerHTML = chips;
    }
    
    // Estimate labels (avg ~180 labels per file based on typical D365 data)
    const estimatedLabels = totalPriorityFiles * 180;
    if (elements.priorityFilesCount) {
      elements.priorityFilesCount.textContent = `${totalPriorityFiles} files • ~${estimatedLabels.toLocaleString()} labels estimated`;
    }
  }

  function openAdvancedSelectionModal() {
    modalController.openAdvancedSelectionModal();
  }

  function closeAdvancedSelectionModal() {
    modalController.closeAdvancedSelectionModal();
  }

  function openLanguageFilterModal() {
    // Collect all unique cultures from discovery data
    const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))].sort();
    
    // Initialize selected languages if empty (select all by default)
    if (state.languageFilter.selectedLanguages.size === 0) {
      uniqueCultures.forEach(c => state.languageFilter.selectedLanguages.add(c));
    }
    
    state.languageFilter.search = '';
    elements.languageFilterSearch.value = '';
    
    renderLanguageFilterList();
    updateLanguageFilterCount();
    modalController.openLanguageFilterModal();
  }

  function closeLanguageFilterModal() {
    modalController.closeLanguageFilterModal();
  }

  function renderLanguageFilterList() {
    const search = (elements.languageFilterSearch?.value || '').toLowerCase();
    const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))].sort();
    
    const filtered = uniqueCultures.filter(c => 
      c.toLowerCase().includes(search) ||
      formatLanguageDisplay(c).toLowerCase().includes(search)
    );
    
    elements.languageFilterList.innerHTML = filtered.map(culture => {
      const isSelected = state.languageFilter.selectedLanguages.has(culture);
      return `
        <label class="selector-item">
          <input type="checkbox" value="${escapeAttr(culture)}" ${isSelected ? 'checked' : ''}>
          <span>${formatLanguageDisplay(culture)}</span>
        </label>
      `;
    }).join('');
    
    // Add change listeners
    elements.languageFilterList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.languageFilter.selectedLanguages.add(e.target.value);
        } else {
          state.languageFilter.selectedLanguages.delete(e.target.value);
        }
        updateToggleAllLanguagesButton();
        updateLanguageFilterCount();
      });
    });
    
    updateToggleAllLanguagesButton();
  }

  function toggleAllLanguagesFilter() {
    const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))];
    const allSelected = uniqueCultures.every(c => state.languageFilter.selectedLanguages.has(c));
    
    if (allSelected) {
      state.languageFilter.selectedLanguages.clear();
    } else {
      uniqueCultures.forEach(c => state.languageFilter.selectedLanguages.add(c));
    }
    
    renderLanguageFilterList();
    updateLanguageFilterCount();
  }

  function updateToggleAllLanguagesButton() {
    const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))];
    const allSelected = uniqueCultures.every(c => state.languageFilter.selectedLanguages.has(c));
    
    if (elements.btnToggleAllLanguages) {
      elements.btnToggleAllLanguages.innerHTML = allSelected ? 
        `<span data-i18n="btn_deselect_all">${t('btn_deselect_all')}</span>` : 
        `<span data-i18n="btn_select_all">${t('btn_select_all')}</span>`;
    }
  }

  function updateLanguageFilterCount() {
    if (elements.languageFilterCount) {
      elements.languageFilterCount.textContent = state.languageFilter.selectedLanguages.size;
    }
  }

  function applyLanguageFilter() {
    if (state.languageFilter.selectedLanguages.size === 0) {
      showInfo(t('toast_select_language_first'));
      return;
    }
    
    saveSelectionHistory();
    
    // Update selection state based on selected languages
    state.discoveryData.forEach(model => {
      let hasAnySelectedLanguage = false;
      
      model.cultures.forEach(culture => {
        const key = `${model.model}|||${culture.culture}`;
        const isLanguageSelected = state.languageFilter.selectedLanguages.has(culture.culture);
        state.selectionState.set(key, isLanguageSelected);
        if (isLanguageSelected) hasAnySelectedLanguage = true;
      });
      
      // If model has no selected languages, ensure all are unselected (already done above)
    });
    
    renderModelsListWithSelection();
    updateSelectionInfo();
    updateToggleSelectionButton();
    closeLanguageFilterModal();
    
    showInfo(t('toast_language_filter_applied', { count: state.languageFilter.selectedLanguages.size }));
  }

  function renderModelsListWithSelection() {
    elements.modelsList.innerHTML = state.discoveryData.map((model, modelIndex) => {
      // Check if all cultures in this model are selected
      const allSelected = model.cultures.every(c => {
        const key = `${model.model}|||${c.culture}`;
        return state.selectionState.get(key) === true;
      });
      
      // Check if some cultures in this model are selected
      const someSelected = model.cultures.some(c => {
        const key = `${model.model}|||${c.culture}`;
        return state.selectionState.get(key) === true;
      });
      
      const indeterminate = someSelected && !allSelected;
      
      return `
        <div class="model-item" data-model="${escapeAttr(model.model)}">
          <div class="model-header">
            <input type="checkbox" 
              class="model-checkbox" 
              data-model="${escapeAttr(model.model)}"
              ${allSelected ? 'checked' : ''}
              ${indeterminate ? 'data-indeterminate="true"' : ''}>
            <div class="model-info">
              <span class="model-name">${escapeHtml(model.model)}</span>
              <span class="model-expand-icon">▶</span>
            </div>
          </div>
          <div class="model-languages">
            ${model.cultures.map(culture => {
              const key = `${model.model}|||${culture.culture}`;
              const isSelected = state.selectionState.get(key) === true;
              return `
                <div class="language-item">
                  <input type="checkbox" 
                    class="language-checkbox"
                    data-model="${escapeAttr(model.model)}"
                    data-culture="${escapeAttr(culture.culture)}"
                    ${isSelected ? 'checked' : ''}>
                  <label class="language-label">
                    ${formatLanguageDisplay(culture.culture)}
                    <span class="language-file-count">${culture.files.length} files</span>
                  </label>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');
    
    // Setup checkbox listeners
    setupSelectionListeners();
    
    // Set indeterminate state for partial selections
    elements.modelsList.querySelectorAll('.model-checkbox[data-indeterminate="true"]').forEach(cb => {
      cb.indeterminate = true;
    });
  }

  function getSelectedDiscoveryData() {
    const selectedData = [];
    let totalFiles = 0;

    state.discoveryData.forEach(model => {
      const selectedCultures = [];
      model.cultures.forEach(culture => {
        const key = `${model.model}|||${culture.culture}`;
        if (state.selectionState.get(key) === true) {
          selectedCultures.push(culture);
          totalFiles += culture.files.length;
        }
      });
      if (selectedCultures.length > 0) {
        selectedData.push({
          ...model,
          cultures: selectedCultures,
          fileCount: selectedCultures.reduce((sum, c) => sum + c.files.length, 0)
        });
      }
    });

    return { selectedData, totalFiles };
  }

  function setupSelectionListeners() {
    if (state.ui.selectionListenersAttached) return;

    elements.modelsList?.addEventListener('click', (e) => {
      // 1. Model header click to expand/collapse
      const header = e.target.closest('.model-header');
      if (header && !e.target.classList.contains('model-checkbox')) {
        const modelItem = header.closest('.model-item');
        modelItem?.classList.toggle('expanded');
        return;
      }
    });

    elements.modelsList?.addEventListener('change', (e) => {
      // 2. Model checkbox change
      if (e.target.classList.contains('model-checkbox')) {
        const modelName = e.target.dataset.model;
        const isChecked = e.target.checked;
        
        saveSelectionHistory();
        
        state.discoveryData.forEach(model => {
          if (model.model === modelName) {
            model.cultures.forEach(culture => {
              const key = `${model.model}|||${culture.culture}`;
              state.selectionState.set(key, isChecked);
            });
          }
        });
        
        updateLanguageCheckboxes(modelName);
        updateSelectionInfo();
        return;
      }
      
      // 3. Language checkbox change
      if (e.target.classList.contains('language-checkbox')) {
        const modelName = e.target.dataset.model;
        const cultureName = e.target.dataset.culture;
        const isChecked = e.target.checked;
        
        saveSelectionHistory();
        
        const key = `${modelName}|||${cultureName}`;
        state.selectionState.set(key, isChecked);
        
        updateModelCheckbox(modelName);
        updateSelectionInfo();
        return;
      }
    });

    state.ui.selectionListenersAttached = true;
  }

  function updateLanguageCheckboxes(modelName) {
    elements.modelsList.querySelectorAll(`.language-checkbox[data-model="${modelName}"]`).forEach(cb => {
      const key = `${modelName}|||${cb.dataset.culture}`;
      cb.checked = state.selectionState.get(key) === true;
    });
  }

  function updateModelCheckbox(modelName) {
    const model = state.discoveryData.find(m => m.model === modelName);
    if (!model) return;
    
    const allSelected = model.cultures.every(c => {
      const key = `${model.model}|||${c.culture}`;
      return state.selectionState.get(key) === true;
    });
    
    const someSelected = model.cultures.some(c => {
      const key = `${model.model}|||${c.culture}`;
      return state.selectionState.get(key) === true;
    });
    
    const checkbox = elements.modelsList.querySelector(`.model-checkbox[data-model="${modelName}"]`);
    if (checkbox) {
      checkbox.checked = allSelected;
      checkbox.indeterminate = someSelected && !allSelected;
    }
  }

  function updateSelectionInfo() {
    const totalFiles = state.discoveryData.reduce((sum, model) => sum + model.cultures.reduce((s, c) => s + c.files.length, 0), 0);
    let selectedFiles = 0;
    state.discoveryData.forEach(model => {
      model.cultures.forEach(culture => {
        const key = `${model.model}|||${culture.culture}`;
        if (state.selectionState.get(key) === true) {
          selectedFiles += culture.files.length;
        }
      });
    });
    
    if (elements.selectionInfo) {
      elements.selectionInfo.textContent = `${selectedFiles} of ${totalFiles} files selected`;
    }
    
    // Update button state
    if (elements.btnStartIndexing) {
      elements.btnStartIndexing.disabled = selectedFiles === 0;
      if (selectedFiles === 0) {
        elements.btnStartIndexing.classList.add('disabled');
      } else {
        elements.btnStartIndexing.classList.remove('disabled');
      }
    }

    // Update toggle button label
    updateToggleSelectionButton();
  }

  function areAllSelected() {
    for (const model of state.discoveryData) {
      for (const culture of model.cultures) {
        const key = `${model.model}|||${culture.culture}`;
        if (state.selectionState.get(key) !== true) {
          return false;
        }
      }
    }
    return true;
  }

  function updateToggleSelectionButton() {
    if (!elements.btnToggleSelection) return;
    
    const allSelected = areAllSelected();
    const textSpan = elements.btnToggleSelection.querySelector('[data-i18n]');
    
    if (allSelected) {
      elements.btnToggleSelection.innerHTML = `✗ <span data-i18n="btn_deselect_all">${t('btn_deselect_all')}</span>`;
    } else {
      elements.btnToggleSelection.innerHTML = `✓ <span data-i18n="btn_select_all">${t('btn_select_all')}</span>`;
    }
  }

  function handleToggleSelection() {
    saveSelectionHistory();
    
    const allSelected = areAllSelected();
    const newValue = !allSelected; // If all selected, deselect; otherwise select
    
    state.discoveryData.forEach(model => {
      model.cultures.forEach(culture => {
        const key = `${model.model}|||${culture.culture}`;
        state.selectionState.set(key, newValue);
      });
    });
    
    renderModelsListWithSelection();
    updateSelectionInfo();
    showInfo(newValue ? t('toast_all_selected') : t('toast_all_deselected'));
  }

  function handleCancelRescan() {
    if (getState('previousStage') === 'READY') {
      // Hide dashboard and show main app
      elements.discoveryDashboard?.classList.add('hidden');
      elements.app?.classList.remove('hidden');
      setState('stage', 'READY');
      showInfo(t('toast_selection_restored'));
    }
  }

  function saveSelectionHistory() {
    // Clone current state
    const snapshot = new Map(state.selectionState);
    state.selectionHistory.push(snapshot);
    
    // Limit history size
    if (state.selectionHistory.length > 50) {
      state.selectionHistory.shift();
    }
  }

  /**
   * SPEC-23: Handle Quick Start - Index priority languages first, then background
   */
  async function handleQuickStart() {
    const priorityLangs = state.backgroundIndexing.priorityLanguages;
    const enableBackground = elements.chkBackgroundIndexing?.checked ?? true;
    
    // Collect files for priority languages
    const priorityFiles = [];
    const backgroundFiles = [];
    
    state.discoveryData.forEach(model => {
      model.cultures.forEach(culture => {
        const isPriority = priorityLangs.includes(culture.culture);
        const files = culture.files.map(f => ({
          handle: f.handle,
          metadata: {
            model: model.model,
            culture: culture.culture,
            prefix: f.prefix,
            sourcePath: f.name
          }
        }));
        
        if (isPriority) {
          priorityFiles.push(...files);
        } else {
          backgroundFiles.push(...files);
        }
      });
    });
    
    if (priorityFiles.length === 0) {
      showError(t('no_priority_languages_found') || 'No priority languages found in this folder');
      return;
    }

    setState('stage', 'INDEXING');
    state.indexingMode = 'priority';
    closeAdvancedSelectionModal();
    state.backgroundIndexing.completionSummary = null;
    state.backgroundIndexing.languageStatus.clear();
    
    // Show progress
    elements.btnQuickStart?.classList.add('hidden');
    elements.btnStartIndexing?.classList.add('hidden');
    elements.btnCancelRescan?.classList.add('hidden');
    elements.btnChangeFolder?.classList.add('hidden');
    elements.indexingProgress?.classList.remove('hidden');
    
    // Clear existing data
    console.time('⏳ Database & Search Clear');
    searchService.invalidateSearchCache();
    await searchService.clearWarmStartCache();
    await db.clearLabels();
    await db.clearCatalog();
    searchService.clearSearch();
    await searchService.initSearch();
    console.timeEnd('⏳ Database & Search Clear');
    
    // Initialize catalog with language status
    const catalogEntries = [];
    state.discoveryData.forEach((model) => {
      model.cultures.forEach((cultureData) => {
        const key = `${model.model}|||${cultureData.culture}`;
        const fileCount = cultureData.files.length;
        const isPriority = priorityLangs.includes(cultureData.culture);
        const status = isPriority ? 'indexing' : 'waiting';
        catalogEntries.push({
          id: key,
          model: model.model,
          culture: cultureData.culture,
          fileCount,
          processedFiles: 0,
          labelCount: 0,
          totalProcessingMs: 0,
          totalBytes: 0,
          firstStartedAt: null,
          lastEndedAt: null,
          status,
          isPriority
        });

        state.backgroundIndexing.languageStatus.set(key, {
          key,
          model: model.model,
          culture: cultureData.culture,
          fileCount,
          processedFiles: 0,
          labelCount: 0,
          totalProcessingMs: 0,
          totalBytes: 0,
          firstStartedAt: null,
          lastEndedAt: null,
          status,
          isPriority
        });
      });
    });
    await db.saveCatalog(catalogEntries);
    
    // SPEC-42: Set initial filters to priority languages
    state.filters.cultures = [...priorityLangs];
    renderFilterPills();

    // Start indexing priority files
    console.log(`🚀 SPEC-23 Quick Start: ${priorityFiles.length} priority files`);
    state.backgroundIndexing.startTime = performance.now();
    state.backgroundIndexing.baseLabelCount = 0;
    state.backgroundIndexing.totalFiles = priorityFiles.length;
    state.backgroundIndexing.processedFiles = 0;
    state.backgroundIndexing.totalLabels = 0;
    state.realtimeStreaming.enabled = true;
    state.realtimeStreaming.streamedLabels = 0;
    showLiveIndexLine();

    const priorityPromise = indexFilesWithWorkers(priorityFiles, true, {
      streamLabels: true,
      streamLimit: state.realtimeStreaming.maxLabels
    });

    // Release UI
    await new Promise((resolve) => setTimeout(resolve, 700));
    showMainInterface();

    try {
      await priorityPromise;
      queueCatalogProgressFlush();
      await flushCatalogProgressNow();

      // Persist priority entries as ready
      const priorityEntries = [...state.backgroundIndexing.languageStatus.values()].filter((entry) => entry.isPriority);
      for (const entry of priorityEntries) {
        entry.status = 'ready';
        entry.processedFiles = entry.fileCount;
        await db.updateCatalogStatus(entry.key, 'ready', entry.labelCount);
      }

      // Start background indexing if enabled
      if (enableBackground && backgroundFiles.length > 0) {
        console.log(`📦 SPEC-23 Background: ${backgroundFiles.length} files queued`);
        state.indexingMode = 'background';
        stopRealtimeStreaming();
        state.backgroundIndexing.baseLabelCount = state.totalLabels;
        state.backgroundIndexing.startTime = performance.now();
        showBackgroundProgressIndicator();
        startBackgroundIndexing(backgroundFiles);
      } else {
        state.indexingMode = 'idle';
        stopRealtimeStreaming();
        hideLiveIndexLine();
        releaseIndexedFileHandlesIfPossible();
        emitIndexingCompleteSync(state.totalLabels, Date.now());
      }
    } catch (err) {
      console.error('Priority indexing error:', err);
      state.indexingMode = 'idle';
      stopRealtimeStreaming();
      hideLiveIndexLine();
      showError(t('toast_indexing_error') || 'Indexing failed');
    }
  }

  /**
   * SPEC-23: Index files with worker pool
   */
  async function indexFilesOnMainThread(fileTasks, isPriority = false, options = {}) {
    const startTime = performance.now();
    const totalFiles = fileTasks.length;
    const streamLabels = Boolean(options.streamLabels);
    const BATCH_SIZE_MAIN = 1000;
    let streamRemaining = streamLabels
      ? (options.streamLimit || state.realtimeStreaming.maxLabels)
      : 0;

    let totalLabels = 0;
    let processedFiles = 0;
    const errors = [];
    const pairStats = new Map();
    let batchBuffer = [];

    await ensureSharedLabelParser();
    await db.initDB();

    for (const task of fileTasks) {
      const key = `${task.metadata.model}|||${task.metadata.culture}`;
      if (!pairStats.has(key)) {
        pairStats.set(key, {
          key,
          model: task.metadata.model,
          culture: task.metadata.culture,
          fileCount: 0,
          processedFiles: 0,
          labelCount: 0,
          totalProcessingMs: 0,
          totalBytes: 0,
          firstStartedAt: null,
          lastEndedAt: null
        });
      }
      pairStats.get(key).fileCount += 1;
    }

    const updateProgress = () => {
      const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
      if (elements.progressFill) {
        elements.progressFill.style.width = `${percent}%`;
      }
      if (elements.indexingStatus) {
        elements.indexingStatus.textContent = `${isPriority ? '🚀' : '📦'} ${processedFiles}/${totalFiles} files • ${totalLabels.toLocaleString()} labels`;
      }

      if (!isPriority && state.indexingMode === 'background') {
        updateBackgroundProgress(processedFiles, totalFiles, totalLabels);
      }

      if (isPriority) {
        const priorityEntries = [...state.backgroundIndexing.languageStatus.values()].filter((entry) => entry.isPriority);
        const priorityProcessed = priorityEntries.reduce((sum, entry) => sum + entry.processedFiles, 0);
        const priorityTotal = priorityEntries.reduce((sum, entry) => sum + entry.fileCount, 0);
        updateBackgroundProgress(priorityProcessed, priorityTotal || totalFiles, totalLabels);
      }
    };

    const flushBatch = async () => {
      if (batchBuffer.length === 0) return;
      const labelsToPersist = batchBuffer;
      batchBuffer = [];
      await db.addLabels(labelsToPersist);
      totalLabels += labelsToPersist.length;
    };

    for (let i = 0; i < fileTasks.length; i += 1) {
      const task = fileTasks[i];
      const pairKey = `${task.metadata.model}|||${task.metadata.culture}`;
      const pairEntry = pairStats.get(pairKey);
      const startedAt = Date.now();

      try {
        const file = await task.handle.getFile();
        let fileLabelCount = 0;

        if (typeof globalThis.SharedLabelParser?.parseLabelStream === 'function'
          && typeof TextDecoderStream !== 'undefined'
          && typeof file.stream === 'function') {
          const decodedStream = file.stream().pipeThrough(new TextDecoderStream());
          await globalThis.SharedLabelParser.parseLabelStream(decodedStream, task.metadata, (label) => {
            normalizeLabelForSearch(label);
            batchBuffer.push(label);
            fileLabelCount += 1;

            if (streamRemaining > 0 && isPriority) {
              searchService.indexLabels([label]);
              state.realtimeStreaming.streamedLabels += 1;
              state.totalLabels = state.backgroundIndexing.baseLabelCount + state.realtimeStreaming.streamedLabels;
              updateLabelCount();
              scheduleStreamingSearchRefresh();
              streamRemaining -= 1;
            }
          });
        } else {
          const content = await file.text();
          const labels = globalThis.SharedLabelParser.parseLabelFile(content, task.metadata);
          for (const label of labels) {
            normalizeLabelForSearch(label);
            batchBuffer.push(label);
            fileLabelCount += 1;

            if (streamRemaining > 0 && isPriority) {
              searchService.indexLabels([label]);
              state.realtimeStreaming.streamedLabels += 1;
              state.totalLabels = state.backgroundIndexing.baseLabelCount + state.realtimeStreaming.streamedLabels;
              updateLabelCount();
              scheduleStreamingSearchRefresh();
              streamRemaining -= 1;
            }
          }
        }

        const endedAt = Date.now();

        pairEntry.processedFiles += 1;
        pairEntry.labelCount += fileLabelCount;
        pairEntry.totalBytes += file.size || 0;
        pairEntry.totalProcessingMs += Math.max(0, endedAt - startedAt);
        if (!pairEntry.firstStartedAt || startedAt < pairEntry.firstStartedAt) {
          pairEntry.firstStartedAt = startedAt;
        }
        if (!pairEntry.lastEndedAt || endedAt > pairEntry.lastEndedAt) {
          pairEntry.lastEndedAt = endedAt;
        }

        if (batchBuffer.length >= BATCH_SIZE_MAIN) {
          await flushBatch();
        }
      } catch (err) {
        pairEntry.processedFiles += 1;
        errors.push({
          file: task.metadata.sourcePath,
          error: err?.message || String(err)
        });
      }

      processedFiles += 1;
      if (processedFiles % 10 === 0 || processedFiles === totalFiles) {
        mergeBackgroundPairProgress([...pairStats.values()], isPriority ? null : 'indexing');
        queueCatalogProgressFlush();
        updateProgress();
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    await flushBatch();
    mergeBackgroundPairProgress([...pairStats.values()], isPriority ? 'ready' : null);
    queueCatalogProgressFlush();

    const elapsed = (performance.now() - startTime) / 1000;
    console.log(`✅ ${isPriority ? 'PRIORITY' : 'BACKGROUND'} (main thread) complete: ${totalLabels} labels in ${elapsed.toFixed(1)}s`);

    await flushCatalogProgressNow();
    await db.setMetadata('lastIndexed', Date.now());
    state.totalLabels = await db.getLabelCount();
    searchService.setIDBTotalCount(state.totalLabels);
    updateLabelCount();

    return { totalLabels: state.totalLabels, processedFiles, errors };
  }

  async function indexFilesWithWorkers(fileTasks, isPriority = false, options = {}) {
    const storageMode = typeof db.getRuntimeStorageMode === 'function'
      ? await db.getRuntimeStorageMode()
      : 'unknown';

    if (storageMode !== 'opfs') {
      console.warn('SQLite transient mode detected; using main-thread indexing to keep a shared database context.');
      return indexFilesOnMainThread(fileTasks, isPriority, options);
    }

    const startTime = performance.now();
    const totalFiles = fileTasks.length;
    const streamLabels = Boolean(options.streamLabels);
    
    const workerCount = resolveWorkerCount(isPriority ? 'priority' : 'background', totalFiles);
    if (workerCount <= 0) {
      return { totalLabels: 0, processedFiles: 0, errors: [] };
    }
    
    console.log(`🚀 ${isPriority ? 'PRIORITY' : 'BACKGROUND'} INDEXING: ${workerCount} workers for ${totalFiles} files`);
    
    const filesPerWorker = Math.ceil(totalFiles / workerCount);
    const streamLimitPerWorker = streamLabels
      ? Math.max(0, Math.floor((options.streamLimit || state.realtimeStreaming.maxLabels) / Math.max(1, workerCount)))
      : 0;
    const workers = [];
    const workerPromises = [];
    const workerStats = new Map();
    
    let totalLabels = 0;
    let processedFiles = 0;
    let errors = [];
    
    const updateProgress = () => {
      const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
      if (elements.progressFill) {
        elements.progressFill.style.width = `${percent}%`;
      }
      if (elements.indexingStatus) {
        elements.indexingStatus.textContent = `${isPriority ? '🚀' : '📦'} ${processedFiles}/${totalFiles} files • ${totalLabels.toLocaleString()} labels`;
      }
      
      if (!isPriority && state.indexingMode === 'background') {
        updateBackgroundProgress(processedFiles, totalFiles, totalLabels);
      }
      
      if (isPriority) {
        const priorityEntries = [...state.backgroundIndexing.languageStatus.values()].filter((entry) => entry.isPriority);
        const priorityProcessed = priorityEntries.reduce((sum, entry) => sum + entry.processedFiles, 0);
        const priorityTotal = priorityEntries.reduce((sum, entry) => sum + entry.fileCount, 0);
        updateBackgroundProgress(priorityProcessed, priorityTotal || totalFiles, totalLabels);
      }
    };
    
    for (let i = 0; i < workerCount; i++) {
      const startIdx = i * filesPerWorker;
      const endIdx = Math.min(startIdx + filesPerWorker, totalFiles);
      const workerFiles = fileTasks.slice(startIdx, endIdx);
      
      if (workerFiles.length === 0) continue;
      
      const worker = new Worker(
        new URL('../workers/indexer.worker.js', import.meta.url),
        { type: 'module' }
      );

      // Pass DB config first
      worker.postMessage({
        type: 'INIT_DB',
        dbName: DB_NAME,
        dbVersion: DB_VERSION
      });

      const releaseWorkerSlot = reserveIndexerWorkerSlot();
      const terminateWorker = () => {
        try { worker.terminate(); } catch (_err) {}
        releaseWorkerSlot();
      };
      workers.push({ worker, terminateWorker });
      workerStats.set(i, { labels: 0, files: 0 });
      
      const workerPromise = new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const { type } = e.data;
          
          switch (type) {
            case 'REQUEST_DB_WRITE':
              db.addLabels(e.data.labels);
              break;

            case 'REQUEST_BLOOM_SAVE':
              db.saveBloomFilter(e.data.model, e.data.culture, e.data.buffer);
              break;

            case 'STREAM_LABELS':
              if (state.realtimeStreaming.enabled && Array.isArray(e.data.labels) && e.data.labels.length > 0) {
                searchService.indexLabels(e.data.labels);
                state.realtimeStreaming.streamedLabels += e.data.labels.length;
                state.totalLabels = state.backgroundIndexing.baseLabelCount + state.realtimeStreaming.streamedLabels;
                updateLabelCount();
                scheduleStreamingSearchRefresh();
              }
              break;

            case 'PROGRESS':
              mergeBackgroundPairProgress(e.data.pairProgress, isPriority ? null : 'indexing');
              queueCatalogProgressFlush();
              workerStats.set(i, { 
                labels: e.data.totalLabels, 
                files: e.data.processedFiles 
              });
              totalLabels = 0;
              processedFiles = 0;
              for (const stats of workerStats.values()) {
                totalLabels += stats.labels;
                processedFiles += stats.files;
              }
              updateProgress();
              break;

            case 'DB_ERROR':
              if (e.data?.isQuota) {
                showError('Browser storage is full. Part of the indexed data was not saved.');
              } else {
                console.error('Worker DB error:', e.data?.error, `(${e.data?.labelsLost || 0} labels lost)`);
              }
              break;
              
            case 'PRIORITY_DONE':
            case 'COMPLETE':
              mergeBackgroundPairProgress(
                e.data.pairProgress,
                type === 'PRIORITY_DONE' ? 'ready' : (isPriority ? 'ready' : null)
              );
              queueCatalogProgressFlush();
              workerStats.set(i, { 
                labels: e.data.totalLabels, 
                files: e.data.processedFiles 
              });
              if (e.data.errors?.length > 0) {
                errors.push(...e.data.errors);
              }
              terminateWorker();
              resolve({
                labels: e.data.totalLabels,
                files: e.data.processedFiles
              });
              break;
          }
        };
        
        worker.onerror = (e) => {
          console.error('Worker error:', e);
          terminateWorker();
          reject(e);
        };
        
        worker.postMessage({
          type: 'PROCESS_FILES_HANDLES',
          files: workerFiles,
          isPriority,
          streamLabels,
          streamLimit: streamLimitPerWorker,
          dbName: DB_NAME,
          dbVersion: DB_VERSION
        });
      });
      
      workerPromises.push(workerPromise);
    }
    
    try {
      await Promise.all(workerPromises);
      totalLabels = 0;
      processedFiles = 0;
      for (const stats of workerStats.values()) {
        totalLabels += stats.labels;
        processedFiles += stats.files;
      }
    } catch (err) {
      console.error('Indexing error:', err);
      showError(t('toast_indexing_error') || 'Indexing failed');
      workers.forEach(({ terminateWorker }) => terminateWorker());
      return { totalLabels: 0, processedFiles: 0, errors };
    }
    
    const elapsed = (performance.now() - startTime) / 1000;
    console.log(`✅ ${isPriority ? 'PRIORITY' : 'BACKGROUND'} complete: ${totalLabels} labels in ${elapsed.toFixed(1)}s`);

    await flushCatalogProgressNow();
    await db.setMetadata('lastIndexed', Date.now());
    state.totalLabels = await db.getLabelCount();
    searchService.setIDBTotalCount(state.totalLabels);
    updateLabelCount();
    
    return { totalLabels, processedFiles, errors };
  }

  /**
   * Handle start indexing - TURBO INGESTION (SPEC-16)
   */
  async function handleStartIndexing() {
    setState('stage', 'INDEXING');
    closeAdvancedSelectionModal();
    
    // Show progress
    elements.btnStartIndexing?.classList.add('hidden');
    elements.btnCancelRescan?.classList.add('hidden');
    elements.btnChangeFolder?.classList.add('hidden');
    elements.indexingProgress?.classList.remove('hidden');
    
    // Clear existing data
    console.time('⏳ Database & Search Clear');
    searchService.invalidateSearchCache();
    await searchService.clearWarmStartCache();
    await db.clearLabels();
    searchService.clearSearch();
    await searchService.initSearch();
    console.timeEnd('⏳ Database & Search Clear');
    
    const { selectedData, totalFiles } = getSelectedDiscoveryData();
    
    if (totalFiles === 0) {
      showError(t('toast_no_files_selected'));
      elements.btnStartIndexing?.classList.remove('hidden');
      elements.btnChangeFolder?.classList.remove('hidden');
      elements.indexingProgress?.classList.add('hidden');
      return;
    }
    
    const startTime = performance.now();
    let processedFiles = 0;
    let totalLabels = 0;
    let errors = [];
    
    const workerCount = resolveWorkerCount('full', totalFiles);
    console.log(`🚀 SPEC-18 TURBO INGESTION: ${workerCount} workers for ${totalFiles} files`);
    
    function updateProgress() {
      const progress = Math.round((processedFiles / totalFiles) * 100);
      const elapsed = (performance.now() - startTime) / 1000;
      const labelsPerSec = elapsed > 0 ? Math.round(totalLabels / elapsed) : 0;
      
      elements.progressFill.style.width = `${progress}%`;
      elements.indexingStatus.innerHTML = `
        Indexing... ${processedFiles}/${totalFiles} files | ${totalLabels.toLocaleString()} labels
        <br><small style="color: var(--text-dark)">${labelsPerSec.toLocaleString()} labels/sec</small>
      `;
    }
    
    const fileTasks = [];
    for (const model of selectedData) {
      for (const culture of model.cultures) {
        for (const file of culture.files) {
          fileTasks.push({
            handle: file.handle,
            metadata: {
              model: model.model,
              culture: culture.culture,
              prefix: file.prefix,
              sourcePath: `${model.model}/${culture.culture}/${file.name}`
            }
          });
        }
      }
    }
    
    const workers = [];
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('../workers/indexer.worker.js', import.meta.url),
        { type: 'module' }
      );

      // Pass DB config first
      worker.postMessage({
        type: 'INIT_DB',
        dbName: DB_NAME,
        dbVersion: DB_VERSION
      });

      const releaseWorkerSlot = reserveIndexerWorkerSlot();
      const terminateWorker = () => {
        try { worker.terminate(); } catch (_err) {}
        releaseWorkerSlot();
      };
      workers.push({ worker, terminateWorker });
    }
    
    const filesPerWorker = Math.ceil(fileTasks.length / workerCount);
    const workerPromises = [];
    const workerStats = new Map();
    
    for (let i = 0; i < workerCount; i++) {
      const workerFiles = fileTasks.slice(i * filesPerWorker, (i + 1) * filesPerWorker);
      if (workerFiles.length === 0) continue;
      
      const workerEntry = workers[i];
      const worker = workerEntry.worker;
      const workerId = i;
      workerStats.set(workerId, { labels: 0, files: 0 });
      
      const workerPromise = new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
          const { type } = e.data;
          switch (type) {
            case 'REQUEST_DB_WRITE':
              db.addLabels(e.data.labels);
              break;
            case 'REQUEST_BLOOM_SAVE':
              db.saveBloomFilter(e.data.model, e.data.culture, e.data.buffer);
              break;
            case 'PROGRESS':
            case 'FILE_COMPLETE':
              workerStats.set(workerId, { labels: e.data.totalLabels, files: e.data.processedFiles });
              totalLabels = 0;
              processedFiles = 0;
              for (const stats of workerStats.values()) {
                totalLabels += stats.labels;
                processedFiles += stats.files;
              }
              updateProgress();
              break;
            case 'DB_ERROR':
              if (e.data?.isQuota) showError('Browser storage is full.');
              break;
            case 'COMPLETE':
              workerStats.set(workerId, { labels: e.data.totalLabels, files: e.data.processedFiles });
              if (e.data.errors?.length > 0) errors.push(...e.data.errors);
              workerEntry.terminateWorker();
              resolve();
              break;
          }
        };
        worker.onerror = (e) => { workerEntry.terminateWorker(); reject(e); };
        worker.postMessage({
          type: 'PROCESS_FILES_HANDLES',
          files: workerFiles,
          dbName: DB_NAME,
          dbVersion: DB_VERSION
        });
      });
      workerPromises.push(workerPromise);
    }
    
    try {
      await Promise.all(workerPromises);
    } catch (err) {
      console.error('Indexing error:', err);
      showError(t('toast_indexing_error') || 'Indexing failed');
      workers.forEach(({ terminateWorker }) => terminateWorker());
      return;
    }
    
    const indexedAt = Date.now();
    await db.setMetadata('lastIndexed', indexedAt);
    await db.setMetadata('totalLabels', totalLabels);
    
    await searchService.preloadPriorityLanguages(state.backgroundIndexing.priorityLanguages);
    
    state.totalLabels = totalLabels;
    searchService.setIDBTotalCount(totalLabels);
    setState('previousStage', null);
    
    await showMainInterface(indexedAt);
    searchService.invalidateSearchCache();
    emitIndexingCompleteSync(totalLabels, indexedAt);
    releaseIndexedFileHandlesIfPossible();
    
    if (errors.length > 0) {
      showInfo(t('toast_indexing_skipped', { count: errors.length }));
    } else {
      showSuccess(t('toast_indexing_complete', { count: totalLabels }));
    }
  }

  /**
   * Build search index using streaming from IndexedDB
   */
  async function buildSearchIndexStreaming(onProgress = null) {
    const CHUNK_SIZE = 10000;
    const dbInstance = await db.initDB();

    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction('labels', 'readonly');
      const store = tx.objectStore('labels');
      const request = store.openCursor();
      let chunk = [];
      let totalIndexed = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          if (chunk.length > 0) {
            searchService.indexAll(chunk);
            totalIndexed += chunk.length;
          }
          if (onProgress) onProgress(totalIndexed);
          resolve(totalIndexed);
          return;
        }

        chunk.push(cursor.value);
        if (chunk.length >= CHUNK_SIZE) {
          searchService.indexAll(chunk);
          totalIndexed += chunk.length;
          chunk = [];
          if (onProgress) onProgress(totalIndexed);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Handle rescan
   */
  async function handleRescan() {
    const wasReady = state.stage === 'READY';
    setState('previousStage', getState('stage'));
    
    const savedHandle = await db.getSavedDirectoryHandle();
    if (savedHandle) {
      const hasPermission = await fileAccess.requestPermission(savedHandle);
      if (hasPermission) {
        setState('directoryHandle', savedHandle);
        if (wasReady) {
          await startSilentRescan();
        } else {
          await startDiscovery();
        }
        return;
      }
    }
    showInfo(t('toast_select_folder'));
    showOnboarding();
  }

  /**
   * BUG-24: Generic parallel indexing with worker pool
   */
  async function startParallelIndexing(files, isPriority = false) {
    if (files.length === 0) return { totalLabels: 0, processedFiles: 0 };
    
    const fileTasks = files.map(f => ({
      handle: f.file.handle,
      metadata: {
        model: f.model,
        culture: f.culture,
        prefix: f.file.prefix,
        sourcePath: `${f.model}/${f.culture}/${f.file.name}`
      }
    }));

    const result = await indexFilesWithWorkers(fileTasks, isPriority);
    
    const entryKeys = new Set(fileTasks.map(f => `${f.metadata.model}|||${f.metadata.culture}`));
    for (const key of entryKeys) {
      const entry = state.backgroundIndexing.languageStatus.get(key);
      if (entry) {
        entry.status = 'ready';
        entry.processedFiles = entry.fileCount;
        await db.updateCatalogStatus(key, 'ready', entry.labelCount);
      }
    }
    
    state.totalLabels = await db.getLabelCount();
    searchService.setIDBTotalCount(state.totalLabels);
    searchService.invalidateSearchCache();
    updateLabelCount();
    const now = Date.now();
    await db.setMetadata('lastIndexed', now);
    updateLastIndexedDisplay(now);
    emitIndexingCompleteSync(state.totalLabels, now);
    
    if (!isPriority) {
      renderBackgroundSummary();
      renderBackgroundLanguageList();
      releaseIndexedFileHandlesIfPossible();
    }
    
    return result;
  }

  /**
   * BUG-24: Silent Re-scan
   */
  async function startSilentRescan() {
    showInfo(t('toast_rescan_background') || 'Re-scanning folder in background...');
    setState('stage', 'READY');
    
    try {
      const newDiscoveryData = await fileAccess.discoverLabelFiles(state.directoryHandle, () => {});
      if (newDiscoveryData.length === 0) {
        showError(t('error_no_labels'));
        return;
      }
      
      setState('discoveryData', newDiscoveryData);
      
      const currentCultures = await searchService.getIndexedCultures();
      const priorityCultures = currentCultures.length > 0 ? currentCultures : ['en-US', 'pt-BR'];
      
      state.filters.cultures = [...priorityCultures];
      renderFilterPills();
      
      const priorityFiles = [];
      const backgroundFiles = [];
      for (const model of newDiscoveryData) {
        for (const culture of model.cultures) {
          const isPriorityCulture = priorityCultures.includes(culture.culture);
          for (const file of culture.files) {
            (isPriorityCulture ? priorityFiles : backgroundFiles).push({ model: model.model, culture: culture.culture, file });
          }
        }
      }
      
      if (priorityFiles.length > 0) {
        searchService.invalidateSearchCache();
        await searchService.clearWarmStartCache();
        await db.clearLabels();
        await searchService.clearSearch();
        await searchService.initSearch();
        
        state.indexingMode = 'background';
        state.backgroundIndexing.baseLabelCount = 0;
        state.backgroundIndexing.totalFiles = priorityFiles.length + backgroundFiles.length;
        state.backgroundIndexing.processedFiles = 0;
        state.backgroundIndexing.totalLabels = 0;
        state.backgroundIndexing.startTime = performance.now();
        showBackgroundProgressIndicator();
        
        await startParallelIndexing(priorityFiles, true);      
        showSuccess(t('toast_rescan_complete') || 'Re-scan complete');

        if (backgroundFiles.length > 0) {
          setTimeout(async () => {
            if (state.indexingMode !== 'background') {
              state.indexingMode = 'background';
              showBackgroundProgressIndicator();
            }
            await startParallelIndexing(backgroundFiles, false);
            state.indexingMode = 'idle';
            hideBackgroundProgressIndicator();
            await searchService.refreshGlobalBloomFilter();
          }, 100);
        } else {
          state.indexingMode = 'idle';
          hideBackgroundProgressIndicator();
          releaseIndexedFileHandlesIfPossible();
          await searchService.refreshGlobalBloomFilter();
        }
      }
    } catch (err) {
      console.error('Silent re-scan error:', err);
      showError(t('error_rescan_failed') || 'Re-scan failed');
    }
  }

  /**
   * Handle Undo Selection (Ctrl+Z)
   */
  function handleUndoSelection() {
    if (state.selectionHistory.length === 0) {
      showInfo(t('toast_nothing_to_undo') || 'Nothing to undo');
      return;
    }
    
    // Restore previous state
    state.selectionState = state.selectionHistory.pop();
    
    renderModelsListWithSelection();
    updateSelectionInfo();
    showInfo(t('toast_selection_restored') || 'Selection restored');
  }

  /**
   * Start background indexing for non-priority languages
   */
  async function startBackgroundIndexing(backgroundFiles) {
    if (backgroundFiles.length === 0) {
      state.indexingMode = 'idle';
      hideBackgroundProgressIndicator();
      return;
    }
    showLiveIndexLine();
    
    state.backgroundIndexing.totalFiles = backgroundFiles.length;
    state.backgroundIndexing.processedFiles = 0;
    state.backgroundIndexing.totalLabels = 0;
    
    const scheduleWork = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
    
    scheduleWork(async () => {
      try {
        const entryKeys = new Set(backgroundFiles.map(f => `${f.metadata.model}|||${f.metadata.culture}`));
        for (const key of entryKeys) {
          const entry = state.backgroundIndexing.languageStatus.get(key);
          if (entry && entry.status !== 'ready') entry.status = 'indexing';
        }
        scheduleBackgroundProgressUIUpdate();

        const result = await indexFilesWithWorkers(backgroundFiles, false);
        const finalLabelCount = await db.getLabelCount();
        searchService.setIDBTotalCount(finalLabelCount);
        
        for (const key of entryKeys) {
          const status = state.backgroundIndexing.languageStatus.get(key);
          if (status) { status.status = 'ready'; status.processedFiles = status.fileCount; }
        }

        queueCatalogProgressFlush();
        await flushCatalogProgressNow();
        
        state.indexingMode = 'idle';
        hideBackgroundProgressIndicator();
        releaseIndexedFileHandlesIfPossible();
        await searchService.refreshGlobalBloomFilter();
        
        state.totalLabels = finalLabelCount;
        searchService.invalidateSearchCache();
        updateLabelCount();
        const completedAt = Date.now();
        await db.setMetadata('lastIndexed', completedAt);
        updateLastIndexedDisplay(completedAt);
        emitIndexingCompleteSync(finalLabelCount, completedAt);
        renderBackgroundSummary();
        renderBackgroundLanguageList();
        
        showSuccess(t('background_indexing_complete'));
      } catch (err) {
        console.error('Background indexing error:', err);
        state.indexingMode = 'idle';
        hideBackgroundProgressIndicator();
      }
    });
  }

  return {
    handleSelectFolder,
    handleChangeFolder,
    startDiscovery,
    showDiscoveryDashboard,
    renderPriorityLanguageChips,
    openAdvancedSelectionModal,
    closeAdvancedSelectionModal,
    openLanguageFilterModal,
    closeLanguageFilterModal,
    renderLanguageFilterList,
    toggleAllLanguagesFilter,
    updateToggleAllLanguagesButton,
    updateLanguageFilterCount,
    applyLanguageFilter,
    renderModelsListWithSelection,
    getSelectedDiscoveryData,
    setupSelectionListeners,
    updateLanguageCheckboxes,
    updateModelCheckbox,
    updateSelectionInfo,
    areAllSelected,
    updateToggleSelectionButton,
    handleToggleSelection,
    handleCancelRescan,
    saveSelectionHistory,
    handleUndoSelection,
    handleQuickStart,
    handleStartIndexing,
    handleRescan,
    buildSearchIndexStreaming
  };
}
