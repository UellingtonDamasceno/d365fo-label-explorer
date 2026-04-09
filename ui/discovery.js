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
  hideLiveIndexLine,
  progressController
}) {
  const elements = createElementsProxy(getElements);

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

  function handleUndoSelection() {
    if (state.selectionHistory.length === 0) {
      showInfo(t('toast_nothing_to_undo'));
      return;
    }
    
    // Restore previous state
    state.selectionState = state.selectionHistory.pop();
    
    renderModelsListWithSelection();
    updateSelectionInfo();
    showInfo(t('toast_selection_restored'));
  }

  return {
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
    handleUndoSelection
  };
}
