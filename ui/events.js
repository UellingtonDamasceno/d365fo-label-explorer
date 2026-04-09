function createElementsProxy(getElements) {
  return new Proxy({}, {
    get(_target, prop) {
      return getElements()?.[prop];
    }
  });
}

export function createEventController(deps) {
  const {
    getElements,
    state,
    builderState,
    debounce,
    copyToClipboard,
    showSuccess,
    t,
    handleSelectFolder,
    handleChangeFolder,
    handleToggleSelection,
    openLanguageFilterModal,
    handleStartIndexing,
    handleCancelRescan,
    openAdvancedSelectionModal,
    closeAdvancedSelectionModal,
    handleQuickStart,
    closeLanguageFilterModal,
    toggleAllLanguagesFilter,
    applyLanguageFilter,
    renderLanguageFilterList,
    handleRescan,
    openShortcutsModal,
    openStatsDashboardModal,
    openBackgroundProgressModal,
    closeBackgroundProgressModal,
    closeStatsDashboardModal,
    handleSearch,
    scheduleLikelyPrefetch,
    saveSortPreferenceToDb,
    openAdvancedSearchModal,
    openSystemSettingsModal,
    closeAdvancedSearchModal,
    closeSystemSettingsModal,
    applyFilters,
    applySystemSettings,
    clearAllFilters,
    startAiModelDownload,
    clearAiCache,
    updateAiSettingsUI,
    saveAiSettingsToDb,
    openItemSelectorModal,
    closeItemSelectorModal,
    toggleAllInSelectorModal,
    renderItemSelectorModal,
    closeLabelDetailsModal,
    closeShortcutsModal,
    openToolsModal,
    closeToolsModal,
    openMergerModal,
    openExtractorWorkspace,
    closeMergerModal,
    handleMergerSelectFiles,
    handleMergerClearFiles,
    handleMergerBack,
    handleMergerMerge,
    handleMergerDownload,
    setupMergerDropzone,
    openBuilderModal,
    closeBuilderModal,
    openNewLabelModal,
    handleBuilderClear,
    handleBuilderFinish,
    openExportModal,
    handleBuilderAutoTranslate,
    switchBuilderTab,
    closeNewLabelModal,
    handleSaveNewLabel,
    closeConflictModal,
    resolveConflict,
    openManualConflictEditor,
    closeExportModal,
    handleExportGenerate,
    closeExtractorWorkspace,
    handleExtractorSelectProject,
    handleExtractorSelectFiles,
    handleExtractorStartScan,
    handleExtractorAddAllToBuilder,
    handleExtractorApplyChanges,
    handleExtractorRollback,
    handleScroll,
    handleResize,
    setupModalFilterListeners,
    setupSelectionListeners,
    removeBuilderItem,
    undoBuilderChange,
    handleUndoSelection,
    updateKeyboardSelection,
    showLabelDetailsModal,
    addLabelToBuilder
  } = deps;

  const elements = createElementsProxy(getElements);

  function setupEventListeners() {
    // Onboarding
    elements.btnSelectFolder?.addEventListener('click', handleSelectFolder);
    elements.btnChangeFolder?.addEventListener('click', handleSelectFolder);
    elements.btnHeaderChangeFolder?.addEventListener('click', handleChangeFolder);
    
    // Dashboard - Smart toggle selection button
    elements.btnToggleSelection?.addEventListener('click', handleToggleSelection);
    elements.btnOpenLanguageFilter?.addEventListener('click', openLanguageFilterModal);
    elements.btnStartIndexing?.addEventListener('click', handleStartIndexing);
    elements.btnCancelRescan?.addEventListener('click', handleCancelRescan);
    elements.btnOpenAdvancedSelection?.addEventListener('click', openAdvancedSelectionModal);
    elements.btnCloseAdvancedSelectionModal?.addEventListener('click', closeAdvancedSelectionModal);
    elements.btnCloseAdvancedSelection?.addEventListener('click', closeAdvancedSelectionModal);
    elements.btnStartIndexingModal?.addEventListener('click', () => {
      closeAdvancedSelectionModal();
      handleStartIndexing();
    });
    
    // SPEC-23: Quick Start (Priority Languages)
    elements.btnQuickStart?.addEventListener('click', handleQuickStart);
    
    // Language Filter Modal
    elements.btnCloseLanguageFilterModal?.addEventListener('click', closeLanguageFilterModal);
    elements.btnToggleAllLanguages?.addEventListener('click', toggleAllLanguagesFilter);
    elements.btnApplyLanguageFilter?.addEventListener('click', applyLanguageFilter);
    elements.languageFilterSearch?.addEventListener('input', debounce(renderLanguageFilterList, 150));
    
    // Header
    elements.btnRescan?.addEventListener('click', handleRescan);
    elements.btnShortcutsHelp?.addEventListener('click', openShortcutsModal);
    elements.labelCountBadge?.addEventListener('click', openStatsDashboardModal);
    
    // SPEC-23: Background Progress
    elements.btnBackgroundProgress?.addEventListener('click', openBackgroundProgressModal);
    elements.btnCloseBackgroundProgress?.addEventListener('click', closeBackgroundProgressModal);
    elements.btnCloseStatsDashboard?.addEventListener('click', closeStatsDashboardModal);
    
    // SPEC-41: Background Tasks button opens progress modal
    elements.btnBackgroundTasks?.addEventListener('click', openBackgroundProgressModal);
    
    // Search
    const debouncedSearch = debounce(handleSearch, 300);
    elements.searchInput?.addEventListener('input', (e) => {
      state.currentQuery = e.target.value;
      elements.clearSearch.classList.toggle('hidden', !state.currentQuery);
      state.keyboardNav.selectedIndex = -1; // Reset selection on new search
      scheduleLikelyPrefetch?.(state.currentQuery, {
        cultures: [...(state.filters?.cultures || [])],
        models: [...(state.filters?.models || [])]
      });
      debouncedSearch();
    });
    
    elements.clearSearch?.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.currentQuery = '';
      elements.clearSearch.classList.add('hidden');
      state.keyboardNav.selectedIndex = -1;
      handleSearch();
    });

    elements.sortSelect?.addEventListener('change', (e) => {
      state.sortPreference = e.target.value;
      saveSortPreferenceToDb();
      handleSearch();
    });
    
    // Advanced Search Modal
    elements.btnAdvancedSearch?.addEventListener('click', openAdvancedSearchModal);
    elements.btnSystemSettings?.addEventListener('click', openSystemSettingsModal);
    elements.btnCloseModal?.addEventListener('click', closeAdvancedSearchModal);
    elements.btnCloseSettingsModal?.addEventListener('click', closeSystemSettingsModal);
    elements.btnApplyFilters?.addEventListener('click', applyFilters);
    elements.btnApplySettings?.addEventListener('click', applySystemSettings);
    elements.btnClearFilters?.addEventListener('click', clearAllFilters);
    elements.btnAiDownloadModel?.addEventListener('click', startAiModelDownload);
    elements.btnAiClearCache?.addEventListener('click', clearAiCache);
    elements.settingAiEnabled?.addEventListener('change', (e) => {
      state.ai.enabled = e.target.checked;
      updateAiSettingsUI();
      saveAiSettingsToDb();
    });

    // SPEC-19: Fuzzy threshold slider live preview
    elements.settingFuzzyThreshold?.addEventListener('input', (e) => {
      if (elements.fuzzyThresholdValue) {
        elements.fuzzyThresholdValue.textContent = e.target.value;
      }
    });
    
    elements.btnOpenModelSelector?.addEventListener('click', () => openItemSelectorModal('models'));
    elements.btnOpenLanguageSelector?.addEventListener('click', () => openItemSelectorModal('cultures'));
    elements.btnOpenRequiredLanguageSelector?.addEventListener('click', () => openItemSelectorModal('requiredCultures'));
    elements.btnCloseSelectorModal?.addEventListener('click', closeItemSelectorModal);
    elements.btnCloseSelector?.addEventListener('click', closeItemSelectorModal);
    elements.btnToggleAllSelector?.addEventListener('click', toggleAllInSelectorModal);
    elements.itemSelectorSearch?.addEventListener('input', (e) => {
      state.selectorModal.search = e.target.value || '';
      renderItemSelectorModal();
    });
    
    // Label Details Modal
    elements.btnCloseDetailsModal?.addEventListener('click', closeLabelDetailsModal);
    elements.btnCloseDetails?.addEventListener('click', closeLabelDetailsModal);

    // Shortcuts Modal
    elements.btnCloseShortcutsModal?.addEventListener('click', closeShortcutsModal);
    elements.btnCloseShortcuts?.addEventListener('click', closeShortcutsModal);

    // SPEC-36: Tools Menu
    elements.btnToolsMenu?.addEventListener('click', openToolsModal);
    elements.btnCloseToolsModal?.addEventListener('click', closeToolsModal);
    elements.btnCloseTools?.addEventListener('click', closeToolsModal);
    
    elements.btnToolMerger?.addEventListener('click', openMergerModal);
    elements.btnToolExtractor?.addEventListener('click', openExtractorWorkspace);

    // SPEC-36: Merger Modal
    elements.btnCloseMergerModal?.addEventListener('click', closeMergerModal);
    
    elements.mergerDropzone?.addEventListener('click', () => elements.btnMergerSelectFiles?.click());
    elements.btnMergerSelectFiles?.addEventListener('click', handleMergerSelectFiles);
    elements.btnMergerAddMore?.addEventListener('click', handleMergerSelectFiles);
    elements.btnMergerClearFiles?.addEventListener('click', handleMergerClearFiles);
    elements.btnMergerBack?.addEventListener('click', handleMergerBack);
    elements.btnMergerMerge?.addEventListener('click', () => {
      handleMergerMerge().catch(() => {});
    });
    elements.btnMergerDownload?.addEventListener('click', handleMergerDownload);
    setupMergerDropzone();

    // SPEC-32: Builder Modal
    elements.btnToolBuilder?.addEventListener('click', openBuilderModal);
    elements.btnCloseBuilderModal?.addEventListener('click', closeBuilderModal);
    elements.btnBuilderNew?.addEventListener('click', openNewLabelModal);
    elements.btnBuilderClear?.addEventListener('click', handleBuilderClear);
    elements.btnBuilderFinish?.addEventListener('click', handleBuilderFinish);
    elements.btnBuilderDownload?.addEventListener('click', openExportModal);
    elements.btnBuilderAutoTranslate?.addEventListener('click', handleBuilderAutoTranslate);
    
    // SPEC-41: Builder Tabs
    document.getElementById('tab-workspace')?.addEventListener('click', () => switchBuilderTab('workspace'));
    document.getElementById('tab-history')?.addEventListener('click', () => switchBuilderTab('history'));
    
    // SPEC-32: New Label Modal
    elements.btnCloseNewLabelModal?.addEventListener('click', closeNewLabelModal);
    elements.btnCancelNewLabel?.addEventListener('click', closeNewLabelModal);
    elements.btnSaveNewLabel?.addEventListener('click', handleSaveNewLabel);
    
    // SPEC-32: Conflict Modal
    elements.btnCloseConflictModal?.addEventListener('click', closeConflictModal);
    elements.btnConflictSkip?.addEventListener('click', () => resolveConflict('skip'));
    elements.btnConflictRename?.addEventListener('click', () => resolveConflict('rename'));
    elements.btnConflictEdit?.addEventListener('click', openManualConflictEditor);
    elements.btnConflictOverwrite?.addEventListener('click', () => resolveConflict('overwrite'));

    // Export Modal
    elements.btnCloseExportModal?.addEventListener('click', closeExportModal);
    elements.btnExportCancel?.addEventListener('click', closeExportModal);
    elements.btnExportGenerate?.addEventListener('click', handleExportGenerate);

    // SPEC-34: Extractor Workspace
    elements.btnExtractorClose?.addEventListener('click', closeExtractorWorkspace);
    elements.btnExtractorSelectProject?.addEventListener('click', handleExtractorSelectProject);
    elements.btnExtractorSelectFiles?.addEventListener('click', handleExtractorSelectFiles);
    elements.btnExtractorStart?.addEventListener('click', handleExtractorStartScan);
    elements.btnExtractorAddAll?.addEventListener('click', handleExtractorAddAllToBuilder);
    elements.btnExtractorApply?.addEventListener('click', handleExtractorApplyChanges);
    elements.btnExtractorRollback?.addEventListener('click', handleExtractorRollback);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Virtual scroll
    elements.resultsViewport?.addEventListener('scroll', handleScroll);
    
    // Window resize
    window.addEventListener('resize', debounce(handleResize, 100));

    // SPEC-42: Setup one-time listeners
    setupModalFilterListeners();
    setupSelectionListeners();
  }

  function handleKeyboardShortcuts(e) {
    const isInputFocused = document.activeElement?.tagName === 'INPUT' || 
                           document.activeElement?.tagName === 'TEXTAREA';
    const builderModalOpen = !elements.builderModal?.classList.contains('hidden');
    const builderSubModalOpen = !elements.newLabelModal?.classList.contains('hidden') ||
                                !elements.conflictModal?.classList.contains('hidden');
    const hasOpenModal = !elements.advancedSearchModal?.classList.contains('hidden') ||
                         !elements.systemSettingsModal?.classList.contains('hidden') ||
                         !elements.itemSelectorModal?.classList.contains('hidden') ||
                         !elements.labelDetailsModal?.classList.contains('hidden') ||
                         !elements.shortcutsModal?.classList.contains('hidden') ||
                         !elements.advancedSelectionModal?.classList.contains('hidden') ||
                         !elements.backgroundProgressModal?.classList.contains('hidden') ||
                         !elements.statsDashboardModal?.classList.contains('hidden') ||
                         !elements.toolsModal?.classList.contains('hidden') ||
                         !elements.mergerModal?.classList.contains('hidden') ||
                         !elements.newLabelModal?.classList.contains('hidden') ||
                         !elements.conflictModal?.classList.contains('hidden') ||
                         !elements.extractorModal?.classList.contains('hidden');

    // Delete selected item inside Builder
    if (builderModalOpen && !builderSubModalOpen && !isInputFocused && e.key === 'Delete') {
      if (builderState.selectedLabelId !== null) {
        e.preventDefault();
        removeBuilderItem(builderState.selectedLabelId);
      }
      return;
    }

    // Alt+F to focus search
    if (e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      elements.searchInput?.focus();
      elements.searchInput?.select();
      return;
    }
    
    // Alt+S to open advanced search
    if (e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      openAdvancedSearchModal();
      return;
    }
    
    // Alt+P to open system settings
    if (e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      openSystemSettingsModal();
      return;
    }

    // Alt+B to open Builder
    if (e.altKey && e.key.toLowerCase() === 'b' && state.stage === 'READY') {
      e.preventDefault();
      if (!elements.builderModal?.classList.contains('hidden')) {
        closeBuilderModal();
      } else {
        openBuilderModal();
      }
      return;
    }

    // SPEC-41: Alt+N to open New Label modal (within Builder)
    if (e.altKey && e.key.toLowerCase() === 'n' && state.stage === 'READY') {
      e.preventDefault();
      // If Builder is closed, open it first then open New Label modal
      if (elements.builderModal?.classList.contains('hidden')) {
        openBuilderModal();
      }
      openNewLabelModal();
      return;
    }

    // Alt+R to re-scan
    if (e.altKey && e.key.toLowerCase() === 'r' && state.stage === 'READY') {
      e.preventDefault();
      handleRescan();
      return;
    }

    // Alt+I to open advanced stats
    if (e.altKey && e.key.toLowerCase() === 'i' && state.stage === 'READY') {
      e.preventDefault();
      openStatsDashboardModal();
      return;
    }

    // Alt+T to open tools menu
    if (e.altKey && e.key.toLowerCase() === 't' && state.stage === 'READY') {
      e.preventDefault();
      openToolsModal();
      return;
    }

    // Alt+E to select folder
    if (e.altKey && e.key.toLowerCase() === 'e' && state.stage === 'READY') {
      e.preventDefault();
      handleChangeFolder();
      return;
    }
    
    // Ctrl+Z to undo in Builder
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && builderModalOpen && !builderSubModalOpen && !isInputFocused) {
      e.preventDefault();
      undoBuilderChange();
      return;
    }

    // Ctrl+Z to undo selection (only when in dashboard)
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && state.stage === 'DASHBOARD') {
      e.preventDefault();
      handleUndoSelection();
      return;
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
      if (!elements.shortcutsModal?.classList.contains('hidden')) {
        closeShortcutsModal();
      } else if (!elements.advancedSearchModal?.classList.contains('hidden')) {
        closeAdvancedSearchModal();
      } else if (!elements.systemSettingsModal?.classList.contains('hidden')) {
        closeSystemSettingsModal();
      } else if (!elements.itemSelectorModal?.classList.contains('hidden')) {
        closeItemSelectorModal();
      } else if (!elements.labelDetailsModal?.classList.contains('hidden')) {
        closeLabelDetailsModal();
      } else if (!elements.advancedSelectionModal?.classList.contains('hidden')) {
        closeAdvancedSelectionModal();
      } else if (!elements.backgroundProgressModal?.classList.contains('hidden')) {
        closeBackgroundProgressModal();
      } else if (!elements.statsDashboardModal?.classList.contains('hidden')) {
        closeStatsDashboardModal();
      } else if (!elements.mergerModal?.classList.contains('hidden')) {
        closeMergerModal();
      } else if (!elements.toolsModal?.classList.contains('hidden')) {
        closeToolsModal();
      } else if (!elements.conflictModal?.classList.contains('hidden')) {
        closeConflictModal();
      } else if (!elements.newLabelModal?.classList.contains('hidden')) {
        closeNewLabelModal();
      } else if (!elements.exportModal?.classList.contains('hidden')) {
        closeExportModal();
      } else if (!elements.builderModal?.classList.contains('hidden')) {
        closeBuilderModal();
      } else if (state.extractorOpen) {
        closeExtractorWorkspace();
      }
      return;
    }

    // Arrow key navigation and actions for results (only when not in input and no modal open)
    if (!isInputFocused && !hasOpenModal && state.stage === 'READY') {
      const resultsCount = state.displaySettings.groupDuplicates 
        ? state.groupedResults.length 
        : state.results.length;

      if (resultsCount === 0) return;

      // Arrow Down - next result
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.keyboardNav.selectedIndex = Math.min(
          state.keyboardNav.selectedIndex + 1, 
          resultsCount - 1
        );
        updateKeyboardSelection();
        return;
      }

      // Arrow Up - previous result
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.keyboardNav.selectedIndex = Math.max(state.keyboardNav.selectedIndex - 1, 0);
        updateKeyboardSelection();
        return;
      }

      // Space - copy ID of selected result
      if (e.key === ' ' && state.keyboardNav.selectedIndex >= 0) {
        e.preventDefault();
        const selectedItem = state.displaySettings.groupDuplicates 
          ? state.groupedResults[state.keyboardNav.selectedIndex]
          : state.results[state.keyboardNav.selectedIndex];
        if (selectedItem) {
          copyToClipboard(selectedItem.fullId || `@${selectedItem.prefix}:${selectedItem.labelId}`);
          showSuccess(t('toast_copied_id'));
        }
        return;
      }

      // Enter - open details of selected result
      if (e.key === 'Enter' && state.keyboardNav.selectedIndex >= 0) {
        e.preventDefault();
        const selectedItem = state.displaySettings.groupDuplicates 
          ? state.groupedResults[state.keyboardNav.selectedIndex]
          : state.results[state.keyboardNav.selectedIndex];
        if (selectedItem && selectedItem.occurrences?.length > 1) {
          showLabelDetailsModal(selectedItem);
        }
        return;
      }

      // + or = - add selected label to builder
      if ((e.key === '+' || e.key === '=') && state.keyboardNav.selectedIndex >= 0) {
        e.preventDefault();
        const selectedItem = state.displaySettings.groupDuplicates 
          ? state.groupedResults[state.keyboardNav.selectedIndex]
          : state.results[state.keyboardNav.selectedIndex];
        if (selectedItem) {
          addLabelToBuilder(selectedItem);
        }
        return;
      }
    }
  }

  return {
    setupEventListeners,
    handleKeyboardShortcuts
  };
}
