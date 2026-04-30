function createElementsProxy(getElements) {
  return new Proxy({}, {
    get(_target, prop) {
      return getElements()?.[prop];
    }
  });
}

export function createEventController(deps) {
  const elements = createElementsProxy(deps.getElements);
  const { state, builderState, t, debounce } = deps;

  function setupEventListeners() {
    // Onboarding
    elements.btnSelectFolder?.addEventListener('click', deps.handleSelectFolder);
    elements.btnChangeFolder?.addEventListener('click', deps.handleSelectFolder);
    elements.btnHeaderChangeFolder?.addEventListener('click', deps.handleChangeFolder);
    
    // Dashboard - Smart toggle selection button
    elements.btnToggleSelection?.addEventListener('click', deps.handleToggleSelection);
    elements.btnOpenLanguageFilter?.addEventListener('click', deps.openLanguageFilterModal);
    elements.btnStartIndexing?.addEventListener('click', deps.handleStartIndexing);
    elements.btnCancelRescan?.addEventListener('click', deps.handleCancelRescan);
    elements.btnOpenAdvancedSelection?.addEventListener('click', deps.openAdvancedSelectionModal);
    elements.btnCloseAdvancedSelectionModal?.addEventListener('click', deps.closeAdvancedSelectionModal);
    elements.btnCloseAdvancedSelection?.addEventListener('click', deps.closeAdvancedSelectionModal);
    elements.btnStartIndexingModal?.addEventListener('click', () => {
      deps.closeAdvancedSelectionModal();
      deps.handleStartIndexing();
    });
    
    // SPEC-23: Quick Start (Priority Languages)
    elements.btnQuickStart?.addEventListener('click', deps.handleQuickStart);
    
    // Language Filter Modal
    elements.btnCloseLanguageFilterModal?.addEventListener('click', deps.closeLanguageFilterModal);
    elements.btnToggleAllLanguages?.addEventListener('click', deps.toggleAllLanguagesFilter);
    elements.btnApplyLanguageFilter?.addEventListener('click', deps.applyLanguageFilter);
    elements.languageFilterSearch?.addEventListener('input', debounce(deps.renderLanguageFilterList, 150));
    
    // Header
    elements.btnRescan?.addEventListener('click', deps.handleRescan);
    elements.btnShortcutsHelp?.addEventListener('click', deps.openShortcutsModal);
    elements.labelCountBadge?.addEventListener('click', deps.openStatsDashboardModal);
    
    // SPEC-23: Background Progress
    elements.btnBackgroundProgress?.addEventListener('click', deps.openBackgroundProgressModal);
    elements.btnCloseBackgroundProgress?.addEventListener('click', deps.closeBackgroundProgressModal);
    elements.btnCloseStatsDashboard?.addEventListener('click', deps.closeStatsDashboardModal);
    
    // SPEC-41: Background Tasks button opens progress modal
    elements.btnBackgroundTasks?.addEventListener('click', deps.openBackgroundProgressModal);
    
    // Search
    const debouncedSearch = debounce(deps.handleSearch, 300);
    elements.searchInput?.addEventListener('input', (e) => {
      state.currentQuery = e.target.value;
      elements.clearSearch.classList.toggle('hidden', !state.currentQuery);
      state.keyboardNav.selectedIndex = -1; // Reset selection on new search
      deps.scheduleLikelyPrefetch?.(state.currentQuery, {
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
      deps.handleSearch();
    });

    elements.sortSelect?.addEventListener('change', (e) => {
      state.sortPreference = e.target.value;
      deps.saveSortPreferenceToDb();
      deps.handleSearch();
    });
    
    // Advanced Search Modal
    elements.btnAdvancedSearch?.addEventListener('click', deps.openAdvancedSearchModal);
    elements.btnSystemSettings?.addEventListener('click', deps.openSystemSettingsModal);
    elements.btnCloseModal?.addEventListener('click', deps.closeAdvancedSearchModal);
    elements.btnCloseSettingsModal?.addEventListener('click', deps.closeSystemSettingsModal);
    elements.btnApplyFilters?.addEventListener('click', deps.applyFilters);
    elements.btnApplySettings?.addEventListener('click', deps.applySystemSettings);
    elements.btnClearFilters?.addEventListener('click', deps.clearAllFilters);
    elements.btnAiDownloadModel?.addEventListener('click', deps.startAiModelDownload);
    elements.btnAiClearCache?.addEventListener('click', deps.clearAiCache);
    elements.settingAiEnabled?.addEventListener('change', (e) => {
      state.ai.enabled = e.target.checked;
      deps.updateAiSettingsUI();
      deps.saveAiSettingsToDb();
    });

    // SPEC-19: Fuzzy threshold slider live preview
    elements.settingFuzzyThreshold?.addEventListener('input', (e) => {
      if (elements.fuzzyThresholdValue) {
        elements.fuzzyThresholdValue.textContent = e.target.value;
      }
    });
    
    elements.btnOpenModelSelector?.addEventListener('click', () => deps.openItemSelectorModal('models'));
    elements.btnOpenLanguageSelector?.addEventListener('click', () => deps.openItemSelectorModal('cultures'));
    elements.btnOpenRequiredLanguageSelector?.addEventListener('click', () => deps.openItemSelectorModal('requiredCultures'));
    elements.btnCloseSelectorModal?.addEventListener('click', deps.closeItemSelectorModal);
    elements.btnCloseSelector?.addEventListener('click', deps.closeItemSelectorModal);
    elements.btnToggleAllSelector?.addEventListener('click', deps.toggleAllInSelectorModal);
    elements.itemSelectorSearch?.addEventListener('input', (e) => {
      state.selectorModal.search = e.target.value || '';
      deps.renderItemSelectorModal();
    });
    
    // Label Details Modal
    elements.btnCloseDetailsModal?.addEventListener('click', deps.closeLabelDetailsModal);
    elements.btnCloseDetails?.addEventListener('click', deps.closeLabelDetailsModal);

    // Shortcuts Modal
    elements.btnCloseShortcutsModal?.addEventListener('click', deps.closeShortcutsModal);
    elements.btnCloseShortcuts?.addEventListener('click', deps.closeShortcutsModal);

    // SPEC-36: Tools Menu
    elements.btnToolsMenu?.addEventListener('click', deps.openToolsModal);
    elements.btnCloseToolsModal?.addEventListener('click', deps.closeToolsModal);
    elements.btnCloseTools?.addEventListener('click', deps.closeToolsModal);
    
    elements.btnToolMerger?.addEventListener('click', deps.openMergerModal);
    elements.btnToolExtractor?.addEventListener('click', deps.openExtractorWorkspace);

    // SPEC-36: Merger Modal
    elements.btnCloseMergerModal?.addEventListener('click', deps.closeMergerModal);
    
    elements.mergerDropzone?.addEventListener('click', () => elements.btnMergerSelectFiles?.click());
    elements.btnMergerSelectFiles?.addEventListener('click', deps.handleMergerSelectFiles);
    elements.btnMergerAddMore?.addEventListener('click', deps.handleMergerSelectFiles);
    elements.btnMergerClearFiles?.addEventListener('click', deps.handleMergerClearFiles);
    elements.btnMergerBack?.addEventListener('click', deps.handleMergerBack);
    elements.btnMergerMerge?.addEventListener('click', () => {
      deps.handleMergerMerge().catch(() => {});
    });
    elements.btnMergerDownload?.addEventListener('click', deps.handleMergerDownload);
    deps.setupMergerDropzone();

    // SPEC-32: Builder Modal
    elements.btnToolBuilder?.addEventListener('click', deps.openBuilderModal);
    elements.btnCloseBuilderModal?.addEventListener('click', deps.closeBuilderModal);
    elements.btnBuilderNew?.addEventListener('click', deps.openNewLabelModal);
    elements.btnBuilderClear?.addEventListener('click', deps.handleBuilderClear);
    elements.btnBuilderFinish?.addEventListener('click', deps.handleBuilderFinish);
    elements.btnBuilderDownload?.addEventListener('click', deps.openExportModal);
    elements.btnBuilderAutoTranslate?.addEventListener('click', deps.handleBuilderAutoTranslate);
    
    // SPEC-41: Builder Tabs
    document.getElementById('tab-workspace')?.addEventListener('click', () => deps.switchBuilderTab('workspace'));
    document.getElementById('tab-history')?.addEventListener('click', () => deps.switchBuilderTab('history'));
    
    // SPEC-32: New Label Modal
    elements.btnCloseNewLabelModal?.addEventListener('click', deps.closeNewLabelModal);
    elements.btnCancelNewLabel?.addEventListener('click', deps.closeNewLabelModal);
    elements.btnSaveNewLabel?.addEventListener('click', deps.handleSaveNewLabel);
    
    // SPEC-32: Conflict Modal
    elements.btnCloseConflictModal?.addEventListener('click', deps.closeConflictModal);
    elements.btnConflictSkip?.addEventListener('click', () => deps.resolveConflict('skip'));
    elements.btnConflictRename?.addEventListener('click', () => deps.resolveConflict('rename'));
    elements.btnConflictEdit?.addEventListener('click', deps.openManualConflictEditor);
    elements.btnConflictOverwrite?.addEventListener('click', () => deps.resolveConflict('overwrite'));

    // Export Modal
    elements.btnCloseExportModal?.addEventListener('click', deps.closeExportModal);
    elements.btnExportCancel?.addEventListener('click', deps.closeExportModal);
    elements.btnExportGenerate?.addEventListener('click', deps.handleExportGenerate);

    // SPEC-34: Extractor Workspace
    elements.btnExtractorClose?.addEventListener('click', deps.closeExtractorWorkspace);
    elements.btnExtractorSelectProject?.addEventListener('click', deps.handleExtractorSelectProject);
    elements.btnExtractorSelectFiles?.addEventListener('click', deps.handleExtractorSelectFiles);
    elements.btnExtractorStart?.addEventListener('click', deps.handleExtractorStartScan);
    elements.btnExtractorAddAll?.addEventListener('click', deps.handleExtractorAddAllToBuilder);
    elements.btnExtractorApply?.addEventListener('click', deps.handleExtractorApplyChanges);
    elements.btnExtractorRollback?.addEventListener('click', deps.handleExtractorRollback);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => handleKeyboardShortcuts(e));
    
    // Virtual scroll
    elements.resultsViewport?.addEventListener('scroll', deps.handleScroll);
    
    // Window resize
    window.addEventListener('resize', debounce(deps.handleResize, 100));

    // SPEC-42: Setup one-time listeners
    deps.setupModalFilterListeners();
    deps.setupSelectionListeners();
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
        deps.removeBuilderItem(builderState.selectedLabelId);
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
      deps.openAdvancedSearchModal();
      return;
    }
    
    // Alt+P to open system settings
    if (e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      deps.openSystemSettingsModal();
      return;
    }

    // Alt+B to open Builder
    if (e.altKey && e.key.toLowerCase() === 'b' && state.stage === 'READY') {
      e.preventDefault();
      if (!elements.builderModal?.classList.contains('hidden')) {
        deps.closeBuilderModal();
      } else {
        deps.openBuilderModal();
      }
      return;
    }

    // SPEC-41: Alt+N to open New Label modal (within Builder)
    if (e.altKey && e.key.toLowerCase() === 'n' && state.stage === 'READY') {
      e.preventDefault();
      if (elements.builderModal?.classList.contains('hidden')) {
        deps.openBuilderModal();
      }
      deps.openNewLabelModal();
      return;
    }

    // Alt+R to re-scan
    if (e.altKey && e.key.toLowerCase() === 'r' && state.stage === 'READY') {
      e.preventDefault();
      deps.handleRescan();
      return;
    }

    // Alt+I to open advanced stats
    if (e.altKey && e.key.toLowerCase() === 'i' && state.stage === 'READY') {
      e.preventDefault();
      deps.openStatsDashboardModal();
      return;
    }

    // Alt+T to open tools menu
    if (e.altKey && e.key.toLowerCase() === 't' && state.stage === 'READY') {
      e.preventDefault();
      deps.openToolsModal();
      return;
    }

    // Alt+E to select folder
    if (e.altKey && e.key.toLowerCase() === 'e' && state.stage === 'READY') {
      e.preventDefault();
      deps.handleChangeFolder();
      return;
    }
    
    // Ctrl+Z to undo in Builder
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && builderModalOpen && !builderSubModalOpen && !isInputFocused) {
      e.preventDefault();
      deps.undoBuilderChange();
      return;
    }

    // Ctrl+Z to undo selection (only when in dashboard)
    if (e.ctrlKey && e.key.toLowerCase() === 'z' && state.stage === 'DASHBOARD') {
      e.preventDefault();
      deps.handleUndoSelection();
      return;
    }
    
    // Escape to close modals
    if (e.key === 'Escape') {
      if (!elements.shortcutsModal?.classList.contains('hidden')) {
        deps.closeShortcutsModal();
      } else if (!elements.advancedSearchModal?.classList.contains('hidden')) {
        deps.closeAdvancedSearchModal();
      } else if (!elements.systemSettingsModal?.classList.contains('hidden')) {
        deps.closeSystemSettingsModal();
      } else if (!elements.itemSelectorModal?.classList.contains('hidden')) {
        deps.closeItemSelectorModal();
      } else if (!elements.labelDetailsModal?.classList.contains('hidden')) {
        deps.closeLabelDetailsModal();
      } else if (!elements.advancedSelectionModal?.classList.contains('hidden')) {
        deps.closeAdvancedSelectionModal();
      } else if (!elements.backgroundProgressModal?.classList.contains('hidden')) {
        deps.closeBackgroundProgressModal();
      } else if (!elements.statsDashboardModal?.classList.contains('hidden')) {
        deps.closeStatsDashboardModal();
      } else if (!elements.mergerModal?.classList.contains('hidden')) {
        deps.closeMergerModal();
      } else if (!elements.toolsModal?.classList.contains('hidden')) {
        deps.closeToolsModal();
      } else if (!elements.conflictModal?.classList.contains('hidden')) {
        deps.closeConflictModal();
      } else if (!elements.newLabelModal?.classList.contains('hidden')) {
        deps.closeNewLabelModal();
      } else if (!elements.exportModal?.classList.contains('hidden')) {
        deps.closeExportModal();
      } else if (!elements.builderModal?.classList.contains('hidden')) {
        deps.closeBuilderModal();
      } else if (state.extractorOpen) {
        deps.closeExtractorWorkspace();
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
        deps.updateKeyboardSelection();
        return;
      }

      // Arrow Up - previous result
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.keyboardNav.selectedIndex = Math.max(state.keyboardNav.selectedIndex - 1, 0);
        deps.updateKeyboardSelection();
        return;
      }

      // Space - copy ID of selected result
      if (e.key === ' ' && state.keyboardNav.selectedIndex >= 0) {
        e.preventDefault();
        const selectedItem = state.displaySettings.groupDuplicates 
          ? state.groupedResults[state.keyboardNav.selectedIndex]
          : state.results[state.keyboardNav.selectedIndex];
        if (selectedItem) {
          deps.copyToClipboard(selectedItem.fullId || `@${selectedItem.prefix}:${selectedItem.labelId}`);
          deps.showSuccess(t('toast_copied_id'));
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
          deps.showLabelDetailsModal(selectedItem);
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
          deps.addLabelToBuilder(selectedItem);
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
