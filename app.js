/**
 * D365FO Label Explorer - Main Application
 * Entry point and application orchestration
 */

import * as db from './core/db.js';
import * as fileAccess from './core/file-access.js';
import * as searchService from './core/search.js';
import { debounce } from './utils/debounce.js';
import { highlight } from './utils/highlight.js';
import { copyToClipboard } from './utils/clipboard.js';
import { showSuccess, showError, showInfo } from './utils/toast.js';
import { getLanguageFlag, formatLanguageDisplay, setDisplayLocale, buildPriorityLanguages, pickAvailablePriorityLanguages } from './utils/languages.js';
import { setLanguage, t, updateInterfaceText, getCurrentLanguage } from './utils/translations.js';

// Application state
const state = {
  stage: 'INITIAL', // INITIAL, ONBOARDING, DISCOVERING, DASHBOARD, INDEXING, READY
  previousStage: null, // For cancel re-scan logic
  directoryHandle: null,
  discoveryData: [],
  selectionState: new Map(), // Map<modelName-culture, boolean>
  selectionHistory: [], // For undo functionality
  totalLabels: 0,
  currentQuery: '',
  filters: {
    cultures: [], // Multiple cultures
    models: [],   // Multiple models
    exactMatch: false,
    requiredCultures: [],
    hideIncomplete: false
  },
  displaySettings: {
    labelFormat: 'full', // 'full', 'simple', 'hybrid'
    groupDuplicates: true,
    uiLanguage: 'auto',
    builderDirectSaveMode: false
  },
  sortPreference: 'relevance',
  selectorModal: {
    type: null, // models, cultures, requiredCultures
    search: ''
  },
  languageFilter: {
    selectedLanguages: new Set(), // Set of selected cultures for global filtering
    search: ''
  },
  availableFilters: {
    cultures: [],
    models: []
  },
  results: [],
  groupedResults: [], // For deduplicated display
  virtualScroll: {
    itemHeight: 160, // Calculated dynamically from CSS var(--card-height) + gap
    bufferSize: 5,
    scrollTop: 0,
    visibleCount: 0
  },
  keyboardNav: {
    selectedIndex: -1 // Currently selected card index for keyboard navigation
  },
  // SPEC-23: Background indexing state
  indexingMode: 'idle', // 'idle', 'priority', 'background'
  backgroundIndexing: {
    enabled: true,
    priorityLanguages: buildPriorityLanguages().slice(0, 3),
    totalFiles: 0,
    processedFiles: 0,
    totalLabels: 0,
    baseLabelCount: 0,
    labelsPerSec: 0,
    languageStatus: new Map(), // model|||culture -> { model, culture, status, labelCount, fileCount, processedFiles, isPriority }
    workers: [],
    startTime: null,
    updateScheduled: false,
    completionSummary: null
  },
  realtimeStreaming: {
    enabled: false,
    maxLabels: 50000,
    streamedLabels: 0,
    pendingUiRefresh: false,
    uiRefreshTimer: null,
    linePercent: 0
  },
  ai: {
    enabled: false,
    status: 'inactive', // inactive | downloading | ready
    progress: 0,
    progressPhase: 'downloading',
    semanticIdSuggestion: false,
    autoTranslateOnDiscovery: false,
    sourceLanguage: 'auto',
    targetLanguage: 'en-US',
    worker: null
  }
};

// DOM Elements cache
let elements = {};

/**
 * Initialize the application
 */
async function init() {
  console.log('🏷️ D365FO Label Explorer initializing...');
  
  // Cache DOM elements
  cacheElements();
  
  // Update splash status
  updateSplashStatus('Checking browser compatibility...');
  
  // Check browser compatibility
  if (!fileAccess.isSupported()) {
    hideSplash();
    showBrowserWarning();
    return;
  }
  
  // Initialize database
  updateSplashStatus('Initializing database...');
  try {
    await db.initDB();
    console.log('✅ IndexedDB initialized');
  } catch (err) {
    console.error('❌ Failed to initialize IndexedDB:', err);
    hideSplash();
    showError('Failed to initialize database. Please check your browser settings.');
    return;
  }
  
  // Check for existing data
  updateSplashStatus('Checking for saved labels...');
  const hasExistingData = await db.hasData();
  
  if (hasExistingData) {
    // Load existing data with splash feedback (streaming to avoid OOM)
    console.time('⏳ Total App Initialization');
    updateSplashStatus('Loading saved labels from database...');
    const totalLabels = await db.getLabelCount();
    state.totalLabels = totalLabels;
    
    updateSplashStatus(`Building search index (${totalLabels.toLocaleString()} labels)...`);
    // SPEC-19: Pre-load only priority languages instead of indexing everything
    const warmStartLanguages = await resolveWarmStartLanguages();
    state.backgroundIndexing.priorityLanguages = warmStartLanguages;
    await searchService.preloadPriorityLanguages(warmStartLanguages);
    
    updateSplashStatus('Loading preferences and filters...');
    const lastIndexed = await db.getMetadata('lastIndexed');
    
    // Hide splash and show main interface
    hideSplash();
    await showMainInterface(lastIndexed);
    console.timeEnd('⏳ Total App Initialization');
  } else {
    // No data - show onboarding
    hideSplash();
    showOnboarding();
  }
  
  // Setup event listeners
  setupEventListeners();
}

/**
 * Update splash screen status
 */
function updateSplashStatus(message) {
  if (elements.splashStatus) {
    elements.splashStatus.textContent = message;
  }
}

/**
 * Hide splash screen
 */
function hideSplash() {
  if (elements.splashScreen) {
    elements.splashScreen.classList.add('hidden');
  }
}

/**
 * Cache DOM elements
 */
function cacheElements() {
  elements = {
    // Splash
    splashScreen: document.getElementById('splash-screen'),
    splashStatus: document.querySelector('.splash-status'),
    
    // Overlays
    onboardingOverlay: document.getElementById('onboarding-overlay'),
    discoveryDashboard: document.getElementById('discovery-dashboard'),
    app: document.getElementById('app'),
    
    // Onboarding
    btnSelectFolder: document.getElementById('btn-select-folder'),
    scanProgress: document.getElementById('scan-progress'),
    scanStatus: document.querySelector('.scan-status'),
    browserWarning: document.getElementById('browser-warning'),
    
    // Dashboard
    discoverySummary: document.getElementById('discovery-summary'),
    modelsList: document.getElementById('models-list'),
    btnToggleSelection: document.getElementById('btn-toggle-selection'),
    btnOpenLanguageFilter: document.getElementById('btn-open-language-filter'),
    languageFilterCount: document.getElementById('language-filter-count'),
    selectionInfo: document.getElementById('selection-info'),
    btnStartIndexing: document.getElementById('btn-start-indexing'),
    btnCancelRescan: document.getElementById('btn-cancel-rescan'),
    btnChangeFolder: document.getElementById('btn-change-folder'),
    btnOpenAdvancedSelection: document.getElementById('btn-open-advanced-selection'),
    indexingProgress: document.getElementById('indexing-progress'),
    progressFill: document.getElementById('progress-fill'),
    indexingStatus: document.getElementById('indexing-status'),
    advancedSelectionModal: document.getElementById('advanced-selection-modal'),
    btnCloseAdvancedSelectionModal: document.getElementById('btn-close-advanced-selection-modal'),
    btnCloseAdvancedSelection: document.getElementById('btn-close-advanced-selection'),
    btnStartIndexingModal: document.getElementById('btn-start-indexing-modal'),
    
    // Language Filter Modal
    languageFilterModal: document.getElementById('language-filter-modal'),
    btnCloseLanguageFilterModal: document.getElementById('btn-close-language-filter-modal'),
    languageFilterSearch: document.getElementById('language-filter-search'),
    btnToggleAllLanguages: document.getElementById('btn-toggle-all-languages'),
    languageFilterList: document.getElementById('language-filter-list'),
    btnApplyLanguageFilter: document.getElementById('btn-apply-language-filter'),
    
    // Header
    labelCountBadge: document.getElementById('label-count-badge'),
    lastIndexed: document.getElementById('last-indexed'),
    btnRescan: document.getElementById('btn-rescan'),
    btnHeaderChangeFolder: document.getElementById('btn-header-change-folder'),
    btnAiTranslationStatus: document.getElementById('btn-ai-translation-status'),
    aiTranslationStatusText: document.getElementById('ai-translation-status-text'),
    btnShortcutsHelp: document.getElementById('btn-shortcuts-help'),
    
    // Search
    searchInput: document.getElementById('search-input'),
    clearSearch: document.getElementById('clear-search'),
    searchInfo: document.getElementById('search-info'),
    btnAdvancedSearch: document.getElementById('btn-advanced-search'),
    btnSystemSettings: document.getElementById('btn-system-settings'),
    activeFilters: document.getElementById('active-filters'),
    resultsCount: document.getElementById('results-count'),
    sortSelect: document.getElementById('sort-select'),
    
    // Advanced Search Modal
    advancedSearchModal: document.getElementById('advanced-search-modal'),
    btnCloseModal: document.getElementById('btn-close-modal'),
    modalModels: document.getElementById('modal-models'),
    modalLanguages: document.getElementById('modal-languages'),
    modalExactMatch: document.getElementById('modal-exact-match'),
    modalHideIncomplete: document.getElementById('modal-hide-incomplete'),
    selectedModelsSummary: document.getElementById('selected-models-summary'),
    selectedLanguagesSummary: document.getElementById('selected-languages-summary'),
    requiredLanguagesSummary: document.getElementById('required-languages-summary'),
    btnOpenModelSelector: document.getElementById('btn-open-model-selector'),
    btnOpenLanguageSelector: document.getElementById('btn-open-language-selector'),
    btnOpenRequiredLanguageSelector: document.getElementById('btn-open-required-language-selector'),
    modalGroupDuplicates: document.getElementById('modal-group-duplicates'),
    formatFull: document.getElementById('format-full'),
    formatSimple: document.getElementById('format-simple'),
    formatHybrid: document.getElementById('format-hybrid'),
    btnClearFilters: document.getElementById('btn-clear-filters'),
    btnApplyFilters: document.getElementById('btn-apply-filters'),

    // System Settings Modal
    systemSettingsModal: document.getElementById('system-settings-modal'),
    btnCloseSettingsModal: document.getElementById('btn-close-settings-modal'),
    btnApplySettings: document.getElementById('btn-apply-settings'),
    uiLanguageSelect: document.getElementById('ui-language-select'),
    settingDirectSaveMode: document.getElementById('setting-direct-save-mode'),
    // SPEC-35: AI & Intelligence settings
    settingAiEnabled: document.getElementById('setting-ai-enabled'),
    btnAiDownloadModel: document.getElementById('btn-ai-download-model'),
    aiStatusBadge: document.getElementById('ai-status-badge'),
    aiDownloadProgress: document.getElementById('ai-download-progress'),
    aiDownloadFill: document.getElementById('ai-download-fill'),
    aiDownloadLabel: document.getElementById('ai-download-label'),
    aiUnlockedOptions: document.getElementById('ai-unlocked-options'),
    aiLockedHint: document.getElementById('ai-locked-hint'),
    settingAiSemanticId: document.getElementById('setting-ai-semantic-id'),
    settingAiAutoTranslate: document.getElementById('setting-ai-auto-translate'),
    settingAiSourceLanguage: document.getElementById('setting-ai-source-language'),
    settingAiTargetLanguage: document.getElementById('setting-ai-target-language'),
    btnAiClearCache: document.getElementById('btn-ai-clear-cache'),
    // SPEC-19: Hybrid Search Settings
    settingHybridSearch: document.getElementById('setting-hybrid-search'),
    settingMaxModels: document.getElementById('setting-max-models'),
    settingFuzzyThreshold: document.getElementById('setting-fuzzy-threshold'),
    fuzzyThresholdValue: document.getElementById('fuzzy-threshold-value'),

    // Generic Selector Modal
    itemSelectorModal: document.getElementById('item-selector-modal'),
    itemSelectorTitle: document.getElementById('item-selector-title'),
    itemSelectorSearch: document.getElementById('item-selector-search'),
    itemSelectorList: document.getElementById('item-selector-list'),
    btnToggleAllSelector: document.getElementById('btn-toggle-all-selector'),
    btnCloseSelectorModal: document.getElementById('btn-close-selector-modal'),
    btnCloseSelector: document.getElementById('btn-close-selector'),
    
    // Label Details Modal
    labelDetailsModal: document.getElementById('label-details-modal'),
    btnCloseDetailsModal: document.getElementById('btn-close-details-modal'),
    btnCloseDetails: document.getElementById('btn-close-details'),
    labelDetailsContent: document.getElementById('label-details-content'),

    // Shortcuts Modal
    shortcutsModal: document.getElementById('shortcuts-modal'),
    btnCloseShortcutsModal: document.getElementById('btn-close-shortcuts-modal'),
    btnCloseShortcuts: document.getElementById('btn-close-shortcuts'),
    
    // Results
    resultsToolbar: document.getElementById('results-toolbar'),
    liveIndexLine: document.getElementById('live-index-line'),
    liveIndexLineFill: document.getElementById('live-index-line-fill'),
    resultsContainer: document.getElementById('results-container'),
    resultsViewport: document.getElementById('results-viewport'),
    resultsInner: document.getElementById('results-inner'),
    emptyState: document.getElementById('empty-state'),
    loadingState: document.getElementById('loading-state'),
    
    // SPEC-23: Tiered Discovery
    priorityLanguageChips: document.getElementById('priority-language-chips'),
    priorityFilesCount: document.getElementById('priority-files-count'),
    btnQuickStart: document.getElementById('btn-quick-start'),
    chkBackgroundIndexing: document.getElementById('chk-background-indexing'),
    
    // SPEC-23: Background Progress
    btnBackgroundProgress: document.getElementById('btn-background-progress'),
    backgroundProgressModal: document.getElementById('background-progress-modal'),
    btnCloseBackgroundProgress: document.getElementById('btn-close-background-progress'),
    bgTotalLabels: document.getElementById('bg-total-labels'),
    bgTotalPercent: document.getElementById('bg-total-percent'),
    bgEta: document.getElementById('bg-eta'),
    bgSpeed: document.getElementById('bg-speed'),
    bgProgressFill: document.getElementById('bg-progress-fill'),
    bgLanguageList: document.getElementById('bg-language-list'),
    bgSummary: document.getElementById('bg-summary'),

    // SPEC-29: Advanced Stats Dashboard
    statsDashboardModal: document.getElementById('stats-dashboard-modal'),
    btnCloseStatsDashboard: document.getElementById('btn-close-stats-dashboard'),
    statsTotalModels: document.getElementById('stats-total-models'),
    statsTotalFiles: document.getElementById('stats-total-files'),
    statsTotalSize: document.getElementById('stats-total-size'),
    statsGlobalSpeed: document.getElementById('stats-global-speed'),
    statsModelList: document.getElementById('stats-model-list'),
    statsPairList: document.getElementById('stats-pair-list'),

    // SPEC-36: Tools Menu
    btnToolsMenu: document.getElementById('btn-tools-menu'),
    toolsModal: document.getElementById('tools-modal'),
    btnCloseToolsModal: document.getElementById('btn-close-tools-modal'),
    btnCloseTools: document.getElementById('btn-close-tools'),
    btnToolMerger: document.getElementById('btn-tool-merger'),
    btnToolBuilder: document.getElementById('btn-tool-builder'),
    btnToolExtractor: document.getElementById('btn-tool-extractor'),

    // SPEC-36: Merger Modal
    mergerModal: document.getElementById('merger-modal'),
    btnCloseMergerModal: document.getElementById('btn-close-merger-modal'),
    mergerDropzone: document.getElementById('merger-dropzone'),
    btnMergerSelectFiles: document.getElementById('btn-merger-select-files'),
    mergerFileList: document.getElementById('merger-file-list'),
    mergerFilesContainer: document.getElementById('merger-files-container'),
    btnMergerAddMore: document.getElementById('btn-merger-add-more'),
    btnMergerClearFiles: document.getElementById('btn-merger-clear-files'),
    mergerStepFiles: document.getElementById('merger-step-files'),
    mergerStepResults: document.getElementById('merger-step-results'),
    mergerTotalLabels: document.getElementById('merger-total-labels'),
    mergerDuplicates: document.getElementById('merger-duplicates'),
    mergerConflicts: document.getElementById('merger-conflicts'),
    mergerConflictsSection: document.getElementById('merger-conflicts-section'),
    mergerConflictsList: document.getElementById('merger-conflicts-list'),
    mergerPreviewContent: document.getElementById('merger-preview-content'),
    btnMergerBack: document.getElementById('btn-merger-back'),
    btnMergerMerge: document.getElementById('btn-merger-merge'),
    btnMergerDownload: document.getElementById('btn-merger-download'),

    // SPEC-32: Builder Modal
    builderModal: document.getElementById('builder-modal'),
    btnCloseBuilderModal: document.getElementById('btn-close-builder-modal'),
    builderCountBadge: document.getElementById('builder-count-badge'),
    builderDirectSaveWarning: document.getElementById('builder-direct-save-warning'),
    btnBuilderNew: document.getElementById('btn-builder-new'),
    btnBuilderClear: document.getElementById('btn-builder-clear'),
    builderCultureSelect: document.getElementById('builder-culture-select'),
    builderSourceLanguage: document.getElementById('builder-source-language'),
    builderTargetLanguages: document.getElementById('builder-target-languages'),
    btnBuilderAutoTranslate: document.getElementById('btn-builder-auto-translate'),
    builderTranslateProgress: document.getElementById('builder-translate-progress'),
    builderTranslateFill: document.getElementById('builder-translate-fill'),
    builderTranslateLabel: document.getElementById('builder-translate-label'),
    builderWorkspace: document.getElementById('builder-workspace'),
    builderEmptyState: document.getElementById('builder-empty-state'),
    builderItemsContainer: document.getElementById('builder-items-list'),
    btnBuilderDownload: document.getElementById('btn-builder-download'),
    
    // SPEC-32: New Label Modal
    newLabelModal: document.getElementById('new-label-modal'),
    btnCloseNewLabelModal: document.getElementById('btn-close-new-label-modal'),
    inputNewLabelId: document.getElementById('new-label-id'),
    inputNewLabelText: document.getElementById('new-label-text'),
    inputNewLabelHelp: document.getElementById('new-label-help'),
    inputNewLabelPrefix: document.getElementById('new-label-prefix'),
    btnCancelNewLabel: document.getElementById('btn-cancel-new-label'),
    btnSaveNewLabel: document.getElementById('btn-save-new-label'),
    
    // SPEC-32: Conflict Modal
    conflictModal: document.getElementById('conflict-modal'),
    btnCloseConflictModal: document.getElementById('btn-close-conflict-modal'),
    conflictMessage: document.getElementById('conflict-message'),
    conflictExistingId: document.getElementById('conflict-existing-id'),
    conflictExistingText: document.getElementById('conflict-existing-text'),
    conflictExistingHelp: document.getElementById('conflict-existing-help'),
    conflictIncomingId: document.getElementById('conflict-incoming-id'),
    conflictIncomingText: document.getElementById('conflict-incoming-text'),
    conflictIncomingHelp: document.getElementById('conflict-incoming-help'),
    btnConflictRename: document.getElementById('btn-conflict-rename'),
    btnConflictEdit: document.getElementById('btn-conflict-edit'),
    btnConflictOverwrite: document.getElementById('btn-conflict-overwrite'),
    btnConflictSkip: document.getElementById('btn-conflict-skip'),

    // SPEC-34: Hardcoded String Extractor
    extractorModal: document.getElementById('extractor-modal'),
    btnCloseExtractorModal: document.getElementById('btn-close-extractor-modal'),
    btnExtractorSelectFiles: document.getElementById('btn-extractor-select-files'),
    btnExtractorStart: document.getElementById('btn-extractor-start'),
    btnExtractorSaveSession: document.getElementById('btn-extractor-save-session'),
    btnExtractorResumeSession: document.getElementById('btn-extractor-resume-session'),
    extractorProgress: document.getElementById('extractor-progress'),
    extractorProgressFill: document.getElementById('extractor-progress-fill'),
    extractorProgressLabel: document.getElementById('extractor-progress-label'),
    extractorSummary: document.getElementById('extractor-summary'),
    extractorResults: document.getElementById('extractor-results'),
    btnExtractorAddAll: document.getElementById('btn-extractor-add-all')
  };
}

/**
 * Setup event listeners
 */
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
  elements.btnAiTranslationStatus?.addEventListener('click', openBuilderModal);
  elements.btnShortcutsHelp?.addEventListener('click', openShortcutsModal);
  elements.labelCountBadge?.addEventListener('click', openStatsDashboardModal);
  
  // SPEC-23: Background Progress
  elements.btnBackgroundProgress?.addEventListener('click', openBackgroundProgressModal);
  elements.btnCloseBackgroundProgress?.addEventListener('click', closeBackgroundProgressModal);
  elements.btnCloseStatsDashboard?.addEventListener('click', closeStatsDashboardModal);
  
  // Search
  const debouncedSearch = debounce(handleSearch, 300);
  elements.searchInput?.addEventListener('input', (e) => {
    state.currentQuery = e.target.value;
    elements.clearSearch.classList.toggle('hidden', !state.currentQuery);
    state.keyboardNav.selectedIndex = -1; // Reset selection on new search
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
  elements.settingAiEnabled?.addEventListener('change', updateAiSettingsUI);
  
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
  
  // Close modals on overlay click
  elements.advancedSearchModal?.addEventListener('click', (e) => {
    if (e.target === elements.advancedSearchModal) {
      closeAdvancedSearchModal();
    }
  });

  elements.systemSettingsModal?.addEventListener('click', (e) => {
    if (e.target === elements.systemSettingsModal) {
      closeSystemSettingsModal();
    }
  });

  elements.itemSelectorModal?.addEventListener('click', (e) => {
    if (e.target === elements.itemSelectorModal) {
      closeItemSelectorModal();
    }
  });
  
  elements.labelDetailsModal?.addEventListener('click', (e) => {
    if (e.target === elements.labelDetailsModal) {
      closeLabelDetailsModal();
    }
  });

  elements.shortcutsModal?.addEventListener('click', (e) => {
    if (e.target === elements.shortcutsModal) {
      closeShortcutsModal();
    }
  });

  elements.backgroundProgressModal?.addEventListener('click', (e) => {
    if (e.target === elements.backgroundProgressModal) {
      closeBackgroundProgressModal();
    }
  });

  elements.statsDashboardModal?.addEventListener('click', (e) => {
    if (e.target === elements.statsDashboardModal) {
      closeStatsDashboardModal();
    }
  });

  elements.advancedSelectionModal?.addEventListener('click', (e) => {
    if (e.target === elements.advancedSelectionModal) {
      closeAdvancedSelectionModal();
    }
  });

  // SPEC-36: Tools Menu
  elements.btnToolsMenu?.addEventListener('click', openToolsModal);
  elements.btnCloseToolsModal?.addEventListener('click', closeToolsModal);
  elements.btnCloseTools?.addEventListener('click', closeToolsModal);
  elements.toolsModal?.addEventListener('click', (e) => {
    if (e.target === elements.toolsModal) closeToolsModal();
  });
  elements.btnToolMerger?.addEventListener('click', openMergerModal);
  elements.btnToolExtractor?.addEventListener('click', openExtractorModal);

  // SPEC-36: Merger Modal
  elements.btnCloseMergerModal?.addEventListener('click', closeMergerModal);
  elements.mergerModal?.addEventListener('click', (e) => {
    if (e.target === elements.mergerModal) closeMergerModal();
  });
  elements.mergerDropzone?.addEventListener('click', () => elements.btnMergerSelectFiles?.click());
  elements.btnMergerSelectFiles?.addEventListener('click', handleMergerSelectFiles);
  elements.btnMergerAddMore?.addEventListener('click', handleMergerSelectFiles);
  elements.btnMergerClearFiles?.addEventListener('click', handleMergerClearFiles);
  elements.btnMergerBack?.addEventListener('click', handleMergerBack);
  elements.btnMergerMerge?.addEventListener('click', handleMergerMerge);
  elements.btnMergerDownload?.addEventListener('click', handleMergerDownload);
  setupMergerDropzone();

  // SPEC-32: Builder Modal
  elements.btnToolBuilder?.addEventListener('click', openBuilderModal);
  elements.btnCloseBuilderModal?.addEventListener('click', closeBuilderModal);
  elements.builderModal?.addEventListener('click', (e) => {
    if (e.target === elements.builderModal) closeBuilderModal();
  });
  elements.btnBuilderNew?.addEventListener('click', openNewLabelModal);
  elements.btnBuilderClear?.addEventListener('click', handleBuilderClear);
  elements.btnBuilderDownload?.addEventListener('click', handleBuilderDownload);
  elements.btnBuilderAutoTranslate?.addEventListener('click', handleBuilderAutoTranslate);
  
  // SPEC-32: New Label Modal
  elements.btnCloseNewLabelModal?.addEventListener('click', closeNewLabelModal);
  elements.btnCancelNewLabel?.addEventListener('click', closeNewLabelModal);
  elements.btnSaveNewLabel?.addEventListener('click', handleSaveNewLabel);
  elements.newLabelModal?.addEventListener('click', (e) => {
    if (e.target === elements.newLabelModal) closeNewLabelModal();
  });
  
  // SPEC-32: Conflict Modal
  elements.btnCloseConflictModal?.addEventListener('click', closeConflictModal);
  elements.btnConflictSkip?.addEventListener('click', () => resolveConflict('skip'));
  elements.btnConflictRename?.addEventListener('click', () => resolveConflict('rename'));
  elements.btnConflictEdit?.addEventListener('click', openManualConflictEditor);
  elements.btnConflictOverwrite?.addEventListener('click', () => resolveConflict('overwrite'));
  elements.conflictModal?.addEventListener('click', (e) => {
    if (e.target === elements.conflictModal) closeConflictModal();
  });

  // SPEC-34: Extractor Modal
  elements.btnCloseExtractorModal?.addEventListener('click', closeExtractorModal);
  elements.extractorModal?.addEventListener('click', (e) => {
    if (e.target === elements.extractorModal) closeExtractorModal();
  });
  elements.btnExtractorSelectFiles?.addEventListener('click', handleExtractorSelectFiles);
  elements.btnExtractorStart?.addEventListener('click', handleExtractorStartScan);
  elements.btnExtractorAddAll?.addEventListener('click', handleExtractorAddAllToBuilder);
  elements.btnExtractorSaveSession?.addEventListener('click', handleExtractorSaveSession);
  elements.btnExtractorResumeSession?.addEventListener('click', handleExtractorResumeLastSession);
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboardShortcuts);
  
  // Virtual scroll
  elements.resultsViewport?.addEventListener('scroll', handleScroll);
  
  // Window resize
  window.addEventListener('resize', debounce(handleResize, 100));
}

/**
 * Handle keyboard shortcuts
 */
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
                       !elements.builderModal?.classList.contains('hidden') ||
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
  
  // Ctrl+Z to undo selection (only when in dashboard)
  if (e.ctrlKey && e.key === 'z' && state.stage === 'DASHBOARD') {
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
    } else if (!elements.builderModal?.classList.contains('hidden')) {
      closeBuilderModal();
    } else if (!elements.extractorModal?.classList.contains('hidden')) {
      closeExtractorModal();
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

/**
 * Update keyboard selection visual feedback
 */
function updateKeyboardSelection() {
  // Remove previous selection
  elements.resultsInner?.querySelectorAll('.label-card.keyboard-selected').forEach(card => {
    card.classList.remove('keyboard-selected');
  });

  // Add selection to current card
  if (state.keyboardNav.selectedIndex >= 0) {
    const cards = elements.resultsInner?.querySelectorAll('.label-card');
    const selectedCard = [...(cards || [])].find(card => {
      const idx = parseInt(card.dataset.index, 10);
      return idx === state.keyboardNav.selectedIndex;
    });
    
    if (selectedCard) {
      selectedCard.classList.add('keyboard-selected');
      selectedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      // Card not rendered yet, scroll to it
      const top = state.keyboardNav.selectedIndex * state.virtualScroll.itemHeight;
      elements.resultsViewport?.scrollTo({ top, behavior: 'smooth' });
    }
  }
}

/**
 * Show browser warning
 */
function showBrowserWarning() {
  elements.btnSelectFolder?.classList.add('hidden');
  elements.browserWarning?.classList.remove('hidden');
}

/**
 * Show onboarding screen
 */
function showOnboarding() {
  state.stage = 'ONBOARDING';
  elements.onboardingOverlay?.classList.remove('hidden');
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.add('hidden');
}

/**
 * Handle folder selection
 */
async function handleSelectFolder() {
  try {
    state.directoryHandle = await fileAccess.selectDirectory();
    console.log('📁 Selected folder:', state.directoryHandle.name);
    
    // Save handle for future sessions
    await db.saveDirectoryHandle(state.directoryHandle);
    
    // Start discovery
    await startDiscovery();
  } catch (err) {
    if (err.message === 'USER_CANCELLED') {
      showInfo('Please select a folder to continue.');
      return;
    }
    console.error('Folder selection error:', err);
    showError('Failed to access folder. Please try again.');
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
      elements.scanStatus.textContent = 'Clearing previous index...';
    }
    
    // Only clear data AFTER successfully selecting a new folder
    await db.clearLabels();
    await db.clearCatalog();
    searchService.clearSearch();
    if (elements.scanStatus) {
      elements.scanStatus.textContent = 'Preparing new scan...';
    }
    
    // Save new handle
    state.directoryHandle = newHandle;
    await db.saveDirectoryHandle(state.directoryHandle);
    console.log('📁 Changed to folder:', state.directoryHandle.name);
    
    // Start discovery with new folder
    await startDiscovery();
  } catch (err) {
    if (err.message === 'USER_CANCELLED') {
      showInfo('Folder change cancelled. Keeping existing data.');
      return;
    }
    console.error('Folder change error:', err);
    showError('Failed to access folder. Please try again.');
  }
}

/**
 * Start discovery scan
 */
async function startDiscovery() {
  state.stage = 'DISCOVERING';
  
  // Ensure correct overlays are visible for scanning feedback
  // Hide discovery dashboard and main app, show onboarding with scan progress
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.add('hidden');
  elements.onboardingOverlay?.classList.remove('hidden');
  
  // Show progress
  elements.btnSelectFolder?.classList.add('hidden');
  elements.scanProgress?.classList.remove('hidden');
  
  try {
    // Discover label files
    state.discoveryData = await fileAccess.discoverLabelFiles(
      state.directoryHandle,
      (progress) => {
        elements.scanStatus.textContent = 
          `Scanning... Found ${progress.foundModels} models (${progress.scannedDirs} directories scanned)`;
      }
    );
    
    console.log('📊 Discovery complete:', state.discoveryData);
    
    if (state.discoveryData.length === 0) {
      showError('No D365FO label files found. Make sure you selected the correct folder.');
      elements.btnSelectFolder?.classList.remove('hidden');
      elements.scanProgress?.classList.add('hidden');
      return;
    }
    
    // Show dashboard
    showDiscoveryDashboard();
  } catch (err) {
    console.error('Discovery error:', err);
    showError('Failed to scan folder. Please try again.');
    elements.btnSelectFolder?.classList.remove('hidden');
    elements.scanProgress?.classList.add('hidden');
  }
}

/**
 * Show discovery dashboard
 */
function showDiscoveryDashboard() {
  state.stage = 'DASHBOARD';
  
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
  catalogPendingUpdates.clear();
  if (catalogFlushTimer) {
    clearTimeout(catalogFlushTimer);
    catalogFlushTimer = null;
  }
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

/**
 * SPEC-23: Render priority language chips in Quick Start panel
 */
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
  elements.advancedSelectionModal?.classList.remove('hidden');
}

function closeAdvancedSelectionModal() {
  elements.advancedSelectionModal?.classList.add('hidden');
}

/**
 * Open language filter modal for multi-select
 */
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
  elements.languageFilterModal?.classList.remove('hidden');
}

/**
 * Close language filter modal
 */
function closeLanguageFilterModal() {
  elements.languageFilterModal?.classList.add('hidden');
}

/**
 * Render the language filter list with search
 */
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

/**
 * Toggle all languages in filter
 */
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

/**
 * Update the toggle all languages button text
 */
function updateToggleAllLanguagesButton() {
  const uniqueCultures = [...new Set(state.discoveryData.flatMap(m => m.cultures.map(c => c.culture)))];
  const allSelected = uniqueCultures.every(c => state.languageFilter.selectedLanguages.has(c));
  
  if (elements.btnToggleAllLanguages) {
    elements.btnToggleAllLanguages.innerHTML = allSelected ? 
      `<span data-i18n="btn_deselect_all">${t('btn_deselect_all')}</span>` : 
      `<span data-i18n="btn_select_all">${t('btn_select_all')}</span>`;
  }
}

/**
 * Update the language filter count badge
 */
function updateLanguageFilterCount() {
  if (elements.languageFilterCount) {
    elements.languageFilterCount.textContent = state.languageFilter.selectedLanguages.size;
  }
}

/**
 * Apply language filter - keep only selected languages
 */
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

/**
 * Render models list with selection checkboxes
 */
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

/**
 * Build selected discovery data based on selection state
 */
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

/**
 * Setup selection event listeners
 */
function setupSelectionListeners() {
  // Model header click to expand/collapse
  elements.modelsList.querySelectorAll('.model-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking checkbox
      if (e.target.classList.contains('model-checkbox')) return;
      
      const modelItem = header.closest('.model-item');
      modelItem.classList.toggle('expanded');
    });
  });
  
  // Model checkbox change
  elements.modelsList.querySelectorAll('.model-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const modelName = e.target.dataset.model;
      const isChecked = e.target.checked;
      
      // Save history for undo
      saveSelectionHistory();
      
      // Update all cultures in this model
      state.discoveryData.forEach(model => {
        if (model.model === modelName) {
          model.cultures.forEach(culture => {
            const key = `${model.model}|||${culture.culture}`;
            state.selectionState.set(key, isChecked);
          });
        }
      });
      
      // Update UI
      updateLanguageCheckboxes(modelName);
      updateSelectionInfo();
    });
  });
  
  // Language checkbox change
  elements.modelsList.querySelectorAll('.language-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const modelName = e.target.dataset.model;
      const cultureName = e.target.dataset.culture;
      const isChecked = e.target.checked;
      
      // Save history for undo
      saveSelectionHistory();
      
      // Update selection state
      const key = `${modelName}|||${cultureName}`;
      state.selectionState.set(key, isChecked);
      
      // Update model checkbox state
      updateModelCheckbox(modelName);
      updateSelectionInfo();
    });
  });
}

/**
 * Update language checkboxes for a model
 */
function updateLanguageCheckboxes(modelName) {
  elements.modelsList.querySelectorAll(`.language-checkbox[data-model="${modelName}"]`).forEach(cb => {
    const key = `${modelName}|||${cb.dataset.culture}`;
    cb.checked = state.selectionState.get(key) === true;
  });
}

/**
 * Update model checkbox state based on language selections
 */
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

/**
 * Update selection info display
 */
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

/**
 * Check if all items are selected
 */
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

/**
 * Update toggle selection button label based on current state
 */
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

/**
 * Handle toggle selection (smart button: Select All / Deselect All)
 */
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

/**
 * Handle cancel re-scan (return to main interface without changes)
 */
function handleCancelRescan() {
  if (state.previousStage === 'READY') {
    // Hide dashboard and show main app
    elements.discoveryDashboard?.classList.add('hidden');
    elements.app?.classList.remove('hidden');
    state.stage = 'READY';
    showInfo(t('toast_selection_restored'));
  }
}

/**
 * Save selection history for undo
 */
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
 * Handle Undo Selection (Ctrl+Z)
 */
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

  state.stage = 'INDEXING';
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
  await db.clearLabels();
  await db.clearCatalog();
  searchService.clearSearch();
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
  
  // Start indexing priority files (non-blocking UI release - Spec 26)
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

  // Keep discovery context briefly so user sees in-panel indexing feedback
  await new Promise((resolve) => setTimeout(resolve, 700));
  await showMainInterface();

  try {
    await priorityPromise;
    queueCatalogProgressFlush();
    await flushCatalogProgressNow();

    // Persist priority entries as ready in catalog
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
async function indexFilesWithWorkers(fileTasks, isPriority = false, options = {}) {
  const startTime = performance.now();
  const totalFiles = fileTasks.length;
  const streamLabels = Boolean(options.streamLabels);
  
  // Determine worker count (fewer for background to reduce contention)
  const workerCount = isPriority 
    ? Math.min(navigator.hardwareConcurrency || 4, 4)
    : 2; // Reduced for background
  
  console.log(`🚀 ${isPriority ? 'PRIORITY' : 'BACKGROUND'} INDEXING: ${workerCount} workers for ${totalFiles} files`);
  
  // Split files among workers
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
  
  // Progress update function
  const updateProgress = () => {
    const percent = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0;
    if (elements.progressFill) {
      elements.progressFill.style.width = `${percent}%`;
    }
    if (elements.indexingStatus) {
      elements.indexingStatus.textContent = `${isPriority ? '🚀' : '📦'} ${processedFiles}/${totalFiles} files • ${totalLabels.toLocaleString()} labels`;
    }
    
    // Update background progress if in background mode
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
  
  // Create workers and assign files
  for (let i = 0; i < workerCount; i++) {
    const startIdx = i * filesPerWorker;
    const endIdx = Math.min(startIdx + filesPerWorker, totalFiles);
    const workerFiles = fileTasks.slice(startIdx, endIdx);
    
    if (workerFiles.length === 0) continue;
    
    const worker = new Worker('./workers/indexer.worker.js');
    workers.push(worker);
    workerStats.set(i, { labels: 0, files: 0 });
    
    const workerPromise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const { type } = e.data;
        
        switch (type) {
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
            // Recalculate totals
            totalLabels = 0;
            processedFiles = 0;
            for (const stats of workerStats.values()) {
              totalLabels += stats.labels;
              processedFiles += stats.files;
            }
            updateProgress();
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
            worker.terminate();
            resolve({
              labels: e.data.totalLabels,
              files: e.data.processedFiles
            });
            break;
        }
      };
      
      worker.onerror = (e) => {
        console.error('Worker error:', e);
        worker.terminate();
        reject(e);
      };
      
      worker.postMessage({
        type: 'PROCESS_FILES_HANDLES',
        files: workerFiles,
        isPriority,
        streamLabels,
        streamLimit: streamLimitPerWorker
      });
    });
    
    workerPromises.push(workerPromise);
  }
  
  // Wait for all workers
  try {
    await Promise.all(workerPromises);
    
    // Final tally
    totalLabels = 0;
    processedFiles = 0;
    for (const stats of workerStats.values()) {
      totalLabels += stats.labels;
      processedFiles += stats.files;
    }
  } catch (err) {
    console.error('Indexing error:', err);
    showError(t('toast_indexing_error') || 'Indexing failed');
    workers.forEach(w => { try { w.terminate(); } catch (e) {} });
    return { totalLabels: 0, processedFiles: 0, errors };
  }
  
  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`✅ ${isPriority ? 'PRIORITY' : 'BACKGROUND'} complete: ${totalLabels} labels in ${elapsed.toFixed(1)}s`);

  await flushCatalogProgressNow();
  
  // Update metadata
  await db.setMetadata('lastIndexed', Date.now());
  state.totalLabels = await db.getLabelCount();
  
  return { totalLabels, processedFiles, errors };
}

/**
 * Handle start indexing - TURBO INGESTION (SPEC-16)
 * Uses parallel workers and batch processing for high performance
 */
async function handleStartIndexing() {
  state.stage = 'INDEXING';
  closeAdvancedSelectionModal();
  
  // Show progress
  elements.btnStartIndexing?.classList.add('hidden');
  elements.btnCancelRescan?.classList.add('hidden');
  elements.btnChangeFolder?.classList.add('hidden');
  elements.indexingProgress?.classList.remove('hidden');
  
  // Clear existing data
  console.time('⏳ Database & Search Clear');
  await db.clearLabels();
  searchService.clearSearch();
  console.timeEnd('⏳ Database & Search Clear');
  
  // Filter selected files only
  const { selectedData, totalFiles } = getSelectedDiscoveryData();
  
  if (totalFiles === 0) {
    showError(t('toast_no_files_selected'));
    elements.btnStartIndexing?.classList.remove('hidden');
    elements.btnChangeFolder?.classList.remove('hidden');
    elements.indexingProgress?.classList.add('hidden');
    return;
  }
  
  // Performance tracking
  const startTime = performance.now();
  let processedFiles = 0;
  let totalLabels = 0;
  let errors = [];
  
  // Determine optimal worker count based on CPU cores (max 6 for stability)
  const workerCount = Math.min(navigator.hardwareConcurrency || 4, 6);
  console.log(`🚀 SPEC-18 TURBO INGESTION: ${workerCount} workers for ${totalFiles} files`);
  
  // Update UI function (called only with progress data, never label data)
  function updateProgress() {
    const progress = Math.round((processedFiles / totalFiles) * 100);
    const elapsed = (performance.now() - startTime) / 1000;
    const labelsPerSec = elapsed > 0 ? Math.round(totalLabels / elapsed) : 0;
    const memoryInfo = performance.memory ? 
      `| RAM: ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '';
    
    elements.progressFill.style.width = `${progress}%`;
    elements.indexingStatus.innerHTML = `
      Indexing... ${processedFiles}/${totalFiles} files | ${totalLabels.toLocaleString()} labels
      <br><small style="color: var(--text-dark)">${labelsPerSec.toLocaleString()} labels/sec ${memoryInfo}</small>
    `;
  }
  
  // Collect all file tasks with FileHandles
  console.time('⏳ File Tasks Collection');
  const fileTasks = [];
  for (const model of selectedData) {
    for (const culture of model.cultures) {
      for (const file of culture.files) {
        fileTasks.push({
          handle: file.handle, // FileSystemFileHandle - passed to Worker!
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
  console.timeEnd('⏳ File Tasks Collection');
  
  // Create worker pool
  console.time('⏳ Worker Pool Initialization');
  const workers = [];
  
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(
      new URL('./workers/indexer.worker.js', import.meta.url),
      { type: 'module' }
    );
    workers.push(worker);
  }
  console.timeEnd('⏳ Worker Pool Initialization');
  
  // Distribute files among workers evenly
  const filesPerWorker = Math.ceil(fileTasks.length / workerCount);
  const workerPromises = [];
  
  // Track per-worker progress for accurate totals
  const workerStats = new Map();
  
  console.time('⏳ Total Worker Processing Time');
  for (let i = 0; i < workerCount; i++) {
    const workerFiles = fileTasks.slice(i * filesPerWorker, (i + 1) * filesPerWorker);
    
    if (workerFiles.length === 0) continue;
    
    const worker = workers[i];
    const workerId = i;
    workerStats.set(workerId, { labels: 0, files: 0 });
    
    const workerPromise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const { type } = e.data;
        
        switch (type) {
          case 'PROGRESS':
            // SPEC-21: Batched progress updates (every 50 files)
            workerStats.set(workerId, { 
              labels: e.data.totalLabels, 
              files: e.data.processedFiles 
            });
            // Recalculate totals from all workers
            totalLabels = 0;
            processedFiles = 0;
            for (const stats of workerStats.values()) {
              totalLabels += stats.labels;
              processedFiles += stats.files;
            }
            updateProgress();
            break;
            
          case 'FILE_COMPLETE':
            // Legacy: Per-file progress (kept for compatibility)
            workerStats.set(workerId, { 
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
            
          case 'BATCH_SAVED':
            // Large file progress (optional feedback)
            break;
            
          case 'COMPLETE':
            // Worker finished all its files
            workerStats.set(workerId, { 
              labels: e.data.totalLabels, 
              files: e.data.processedFiles 
            });
            if (e.data.errors?.length > 0) {
              errors.push(...e.data.errors);
            }
            worker.terminate();
            resolve({
              labels: e.data.totalLabels,
              files: e.data.processedFiles,
              labelsPerSec: e.data.labelsPerSec
            });
            break;
        }
      };
      
      worker.onerror = (e) => {
        console.error('Worker error:', e);
        worker.terminate();
        reject(e);
      };
      
      // SPEC-21: Pass FileHandles to Worker with macro-batching
      worker.postMessage({
        type: 'PROCESS_FILES_HANDLES',
        files: workerFiles
      });
    });
    
    workerPromises.push(workerPromise);
  }
  
  // Wait for all workers to complete
  try {
    const results = await Promise.all(workerPromises);
    // Final tally from worker completion messages
    totalLabels = 0;
    processedFiles = 0;
    for (const stats of workerStats.values()) {
      totalLabels += stats.labels;
      processedFiles += stats.files;
    }
  } catch (err) {
    console.error('Indexing error:', err);
    showError(t('toast_indexing_error') || 'Indexing failed');
    workers.forEach(w => { try { w.terminate(); } catch (e) {} });
    elements.btnStartIndexing?.classList.remove('hidden');
    elements.btnChangeFolder?.classList.remove('hidden');
    elements.indexingProgress?.classList.add('hidden');
    return;
  }
  
  // Calculate final stats
  const totalElapsed = (performance.now() - startTime) / 1000;
  const finalLabelsPerSec = Math.round(totalLabels / totalElapsed);
  
  console.log(`✅ TURBO INGESTION complete:`, {
    totalLabels,
    totalFiles: processedFiles,
    elapsed: `${totalElapsed.toFixed(1)}s`,
    labelsPerSec: finalLabelsPerSec,
    workersUsed: workerCount,
    errors: errors.length
  });
  
  // Update metadata (no label data needed - workers already saved to DB)
  elements.indexingStatus.textContent = t('saving_database') || 'Saving metadata...';
  console.time('⏳ 5. Save Metadata');
  const indexedAt = Date.now();
  await db.setMetadata('lastIndexed', indexedAt);
  await db.setMetadata('totalLabels', totalLabels);
  console.timeEnd('⏳ 5. Save Metadata');
  
  // Pre-load only priority languages into FlexSearch (Lazy Indexing - SPEC-19)
  elements.indexingStatus.textContent = t('building_index') || 'Building index...';
  await searchService.preloadPriorityLanguages(state.backgroundIndexing.priorityLanguages);
  
  state.totalLabels = totalLabels;
  state.previousStage = null;
  
  const elapsedFinal = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Full indexing pipeline complete: ${totalLabels} labels in ${elapsedFinal}s`);
  
  // Show main interface
  await showMainInterface(indexedAt);
  
  // Show summary
  if (errors.length > 0) {
    showInfo(t('toast_indexing_skipped', { count: errors.length }));
  } else {
    showSuccess(t('toast_indexing_complete', { count: totalLabels }));
  }
}

/**
 * Build search index using streaming from IndexedDB
 * Avoids loading all labels into memory at once
 */
async function buildSearchIndexStreaming() {
  const CHUNK_SIZE = 10000;
  let offset = 0;
  let hasMore = true;
  
  // Use cursor-based streaming from IndexedDB
  const dbInstance = await db.initDB();
  
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('labels', 'readonly');
    const store = tx.objectStore('labels');
    const request = store.openCursor();
    let chunk = [];
    let totalIndexed = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor) {
        chunk.push(cursor.value);
        
        // Index in chunks to avoid memory pressure
        if (chunk.length >= CHUNK_SIZE) {
          searchService.indexAll(chunk);
          totalIndexed += chunk.length;
          chunk = [];
          
          // Update progress
          elements.indexingStatus.textContent = `${t('building_index')} (${totalIndexed.toLocaleString()})`;
        }
        
        cursor.continue();
      } else {
        // Final chunk
        if (chunk.length > 0) {
          searchService.indexAll(chunk);
          totalIndexed += chunk.length;
        }
        
        console.log(`📊 Search index built: ${totalIndexed} labels indexed`);
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Build search index with splash screen updates
 * Same as buildSearchIndexStreaming but updates splash instead of indexingStatus
 */
async function buildSearchIndexStreamingWithSplash() {
  const CHUNK_SIZE = 10000;
  
  // Use cursor-based streaming from IndexedDB
  const dbInstance = await db.initDB();
  
  return new Promise((resolve, reject) => {
    const tx = dbInstance.transaction('labels', 'readonly');
    const store = tx.objectStore('labels');
    const request = store.openCursor();
    let chunk = [];
    let totalIndexed = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor) {
        chunk.push(cursor.value);
        
        // Index in chunks to avoid memory pressure
        if (chunk.length >= CHUNK_SIZE) {
          searchService.indexAll(chunk);
          totalIndexed += chunk.length;
          chunk = [];
          
          // Update splash progress
          updateSplashStatus(`Building search index (${totalIndexed.toLocaleString()} indexed)...`);
        }
        
        cursor.continue();
      } else {
        // Final chunk
        if (chunk.length > 0) {
          searchService.indexAll(chunk);
          totalIndexed += chunk.length;
        }
        
        console.log(`📊 Search index built: ${totalIndexed} labels indexed (streaming)`);
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

/**
 * Handle rescan
 */
async function handleRescan() {
  // Save previous stage for cancel logic
  state.previousStage = state.stage;
  
  // Check if we have a saved handle
  const savedHandle = await db.getSavedDirectoryHandle();
  
  if (savedHandle) {
    // Request permission - this also requires user gesture but returns boolean
    const hasPermission = await fileAccess.requestPermission(savedHandle);
    
    if (hasPermission) {
      state.directoryHandle = savedHandle;
      await startDiscovery();
      return;
    }
  }
  
  // Need to reselect folder - but we need user gesture
  // Show message and let user click the button again
  showInfo(t('toast_select_folder'));
  showOnboarding();
}

/**
 * Load existing data
 */
async function loadExistingData() {
  console.log('📦 Loading existing data (streaming)...');
  
  // Get total count without loading all labels
  const totalLabels = await db.getLabelCount();
  state.totalLabels = totalLabels;
  
  // Build search index using streaming to avoid memory spike
  await buildSearchIndexStreaming();
  await rehydrateBackgroundStatusFromCatalog();
  
  // Get last indexed time
  const lastIndexed = await db.getMetadata('lastIndexed');
  
  console.log(`✅ Loaded ${totalLabels} labels from database (streamed)`);
  
  // Show main interface
  await showMainInterface(lastIndexed);
}

async function rehydrateBackgroundStatusFromCatalog() {
  try {
    const catalog = await db.getCatalog();
    if (!catalog.length) return;

    state.backgroundIndexing.languageStatus.clear();
    let totalFiles = 0;
    let processedFiles = 0;
    let totalLabels = 0;
    let hasInProgress = false;

    for (const entry of catalog) {
      const key = entry.id || `${entry.model || 'Unknown'}|||${entry.culture}`;
      const fileCount = entry.fileCount || 0;
      const entryProcessed = entry.processedFiles ?? (entry.status === 'ready' ? fileCount : 0);
      const entryLabels = entry.labelCount || 0;

      state.backgroundIndexing.languageStatus.set(key, {
        key,
        model: entry.model || 'Unknown',
        culture: entry.culture,
        fileCount,
        processedFiles: entryProcessed,
        labelCount: entryLabels,
        totalProcessingMs: entry.totalProcessingMs || 0,
        totalBytes: entry.totalBytes || 0,
        firstStartedAt: entry.firstStartedAt || null,
        lastEndedAt: entry.lastEndedAt || null,
        status: entry.status || 'waiting',
        isPriority: Boolean(entry.isPriority)
      });

      totalFiles += fileCount;
      processedFiles += entryProcessed;
      totalLabels += entryLabels;
      if (entry.status === 'indexing' || entry.status === 'waiting') {
        hasInProgress = true;
      }
    }

    state.backgroundIndexing.totalFiles = totalFiles;
    state.backgroundIndexing.processedFiles = Math.min(processedFiles, totalFiles);
    state.backgroundIndexing.totalLabels = totalLabels;
    state.backgroundIndexing.baseLabelCount = Math.max(0, state.totalLabels - totalLabels);
    state.backgroundIndexing.startTime = performance.now();
    state.backgroundIndexing.labelsPerSec = 0;
    state.backgroundIndexing.completionSummary = null;

    if (hasInProgress && processedFiles < totalFiles) {
      state.indexingMode = 'background';
      showBackgroundProgressIndicator();
      scheduleBackgroundProgressUIUpdate();
    } else {
      state.indexingMode = 'idle';
      hideBackgroundProgressIndicator();
    }
  } catch (err) {
    console.warn('Failed to rehydrate background status from catalog:', err);
  }
}

/**
 * Update label count badge in header
 * Called after background indexing completes or data changes
 */
function updateLabelCount() {
  if (elements.labelCountBadge) {
    if (state.indexingMode === 'background') {
      const processed = Math.max(0, state.totalLabels - (state.backgroundIndexing.baseLabelCount || 0));
      const percent = state.backgroundIndexing.totalFiles > 0
        ? Math.round((state.backgroundIndexing.processedFiles / state.backgroundIndexing.totalFiles) * 100)
        : 0;
      elements.labelCountBadge.textContent = t('header_indexing_active', {
        percent,
        count: processed.toLocaleString()
      });
    } else {
      elements.labelCountBadge.textContent = t('labels_indexed_count', { count: state.totalLabels.toLocaleString() });
    }
  }
}

function updateLastIndexedDisplay(lastIndexed) {
  if (!elements.lastIndexed) return;
  if (!lastIndexed) {
    elements.lastIndexed.textContent = '';
    return;
  }

  const date = new Date(lastIndexed);
  const formattedDate = date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  elements.lastIndexed.textContent = t('last_indexed', { date: formattedDate });
}

/**
 * Show main interface
 */
async function showMainInterface(lastIndexed = null) {
  state.stage = 'READY';
  if (state.indexingMode !== 'background') {
    state.backgroundIndexing.baseLabelCount = state.totalLabels;
  }
  
  // Update header
  updateLabelCount();
  updateLastIndexedDisplay(lastIndexed);
  if (state.indexingMode === 'idle') {
    hideLiveIndexLine();
  } else {
    showLiveIndexLine();
  }
  
  // Populate filters
  await populateFilters();
  
  // Load saved filters and display settings, then render pills
  Promise.all([
    loadFiltersFromDb(),
    loadDisplaySettingsFromDb(),
    loadSortPreferenceFromDb(),
    loadAiSettingsFromDb()
  ]).then(() => {
    renderFilterPills();
    updateModalSelectionSummaries();
    if (elements.sortSelect) {
      elements.sortSelect.value = state.sortPreference;
    }
  });
  
  // Calculate virtual scroll params
  calculateVirtualScrollParams();
  
  // Show app
  elements.onboardingOverlay?.classList.add('hidden');
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.remove('hidden');
  
  // Show empty state
  showEmptyState();
  
  // Focus search
  elements.searchInput?.focus();
}

/**
 * Populate filter options for modal
 */
async function populateFilters() {
  try {
    const catalog = await db.getCatalog();
    let cultures = [...new Set(catalog.map(entry => entry.culture).filter(Boolean))].sort();
    let models = [...new Set(catalog.map(entry => entry.model).filter(Boolean))].sort();

    if (cultures.length === 0 || models.length === 0) {
      const [labelCultures, labelModels] = await Promise.all([
        db.getAllCultures(),
        db.getAllModels()
      ]);
      if (cultures.length === 0) cultures = labelCultures;
      if (models.length === 0) models = labelModels;
    }

    // Store available filters
    state.availableFilters.cultures = cultures;
    state.availableFilters.models = models;

    // Render modal filters
    renderModalFilters();
  } catch (err) {
    console.error('Error populating filters:', err);
  }
}
/**
 * Render filters in the modal
 */
function renderModalFilters() {
  // Exact match
  if (elements.modalExactMatch) {
    elements.modalExactMatch.checked = state.filters.exactMatch;
  }
  if (elements.modalHideIncomplete) {
    elements.modalHideIncomplete.checked = state.filters.hideIncomplete;
  }

  updateModalSelectionSummaries();
}

/**
 * Update text summaries in advanced search modal
 */
function updateModalSelectionSummaries() {
  if (elements.selectedModelsSummary) {
    elements.selectedModelsSummary.textContent = state.filters.models.length === 0
      ? 'All models'
      : `${state.filters.models.length} selected`;
  }
  if (elements.selectedLanguagesSummary) {
    elements.selectedLanguagesSummary.textContent = state.filters.cultures.length === 0
      ? 'All languages'
      : `${state.filters.cultures.length} selected`;
  }
  if (elements.requiredLanguagesSummary) {
    elements.requiredLanguagesSummary.textContent = state.filters.requiredCultures.length === 0
      ? 'No required languages'
      : state.filters.requiredCultures.map(c => c.toUpperCase()).join(', ');
  }
}

/**
 * Render active filter pills
 */
function renderFilterPills() {
  if (!elements.activeFilters) return;
  
  const pills = [];
  
  // Model pills
  state.filters.models.forEach(model => {
    pills.push(`
      <span class="filter-pill" data-type="model" data-value="${escapeHtml(model)}">
        📦 ${escapeHtml(model)}
        <button class="pill-remove" title="Remove">×</button>
      </span>
    `);
  });
  
  // Culture pills
  state.filters.cultures.forEach(culture => {
    pills.push(`
      <span class="filter-pill" data-type="culture" data-value="${escapeHtml(culture)}">
        ${formatLanguageDisplay(culture, { shortName: true })}
        <button class="pill-remove" title="Remove">×</button>
      </span>
    `);
  });
  
  // Exact match pill
  if (state.filters.exactMatch) {
    pills.push(`
      <span class="filter-pill" data-type="exactMatch" data-value="true">
        🎯 Exact Match
        <button class="pill-remove" title="Remove">×</button>
      </span>
    `);
  }

  // Compliance pills
  state.filters.requiredCultures.forEach(culture => {
    pills.push(`
      <span class="filter-pill" data-type="requiredCulture" data-value="${escapeHtml(culture)}">
        ✅ Required: ${escapeHtml(culture.toUpperCase())}
        <button class="pill-remove" title="Remove">×</button>
      </span>
    `);
  });
  if (state.filters.hideIncomplete) {
    pills.push(`
      <span class="filter-pill" data-type="hideIncomplete" data-value="true">
        🚫 Hide Incomplete
        <button class="pill-remove" title="Remove">×</button>
      </span>
    `);
  }
  
  elements.activeFilters.innerHTML = pills.join('');
  elements.activeFilters.classList.toggle('hidden', pills.length === 0);
  
  // Add click handlers for remove buttons
  elements.activeFilters.querySelectorAll('.pill-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const pill = e.target.closest('.filter-pill');
      const type = pill.dataset.type;
      const value = pill.dataset.value;
      
      if (type === 'model') {
        state.filters.models = state.filters.models.filter(m => m !== value);
      } else if (type === 'culture') {
        state.filters.cultures = state.filters.cultures.filter(c => c !== value);
      } else if (type === 'exactMatch') {
        state.filters.exactMatch = false;
      } else if (type === 'requiredCulture') {
        state.filters.requiredCultures = state.filters.requiredCultures.filter(c => c !== value);
      } else if (type === 'hideIncomplete') {
        state.filters.hideIncomplete = false;
      }
      
      saveFiltersToDb();
      renderFilterPills();
      handleSearch();
    });
  });
}

/**
 * Normalize filters to arrays with unique values
 */
function normalizeFilterState() {
  state.filters.models = [...new Set(state.filters.models || [])];
  state.filters.cultures = [...new Set(state.filters.cultures || [])];
  state.filters.requiredCultures = [...new Set(state.filters.requiredCultures || [])];
}

/**
 * Handle search - SPEC-19 Hybrid Search (async)
 */
async function handleSearch() {
  const query = state.currentQuery.trim();
  normalizeFilterState();
  
  // Show loading
  if (query) {
    showLoading();
  }
  
  // Perform search with new filter structure
  const startTime = performance.now();
  
  // Build filter options - support multiple cultures/models
  const filterOptions = {
    exactMatch: state.filters.exactMatch,
    limit: 500 // Limit results for performance
  };

  if (query.length >= 2 && searchService.getStats().totalIndexed === 0 && state.indexingMode !== 'idle') {
    await searchService.preloadModelsByName(query, 3);
  }
  
  // If specific filters are selected, apply them
  let results = await searchService.search(query, filterOptions);
  
  // Apply multi-select filters manually
  if (state.filters.cultures.length > 0) {
    results = results.filter(l => state.filters.cultures.includes(l.culture));
  }
  if (state.filters.models.length > 0) {
    results = results.filter(l => state.filters.models.includes(l.model));
  }
  
  state.results = results;
  
  const searchTime = performance.now() - startTime;
  console.log(`🔍 Search "${query}" returned ${state.results.length} results in ${searchTime.toFixed(2)}ms`);
  
  // Group duplicates if enabled
  if (state.displaySettings.groupDuplicates) {
    state.groupedResults = groupDuplicateLabels(state.results);
  } else {
    state.groupedResults = state.results.map(label => ({
      ...label,
      occurrences: [label],
      count: 1
    }));
  }

  // Compliance filter/check
  applyComplianceFilters();

  applySorting();
  
  // Update UI
  elements.resultsCount.textContent = state.groupedResults.length.toLocaleString();
  if (query) {
    const pendingCount = state.groupedResults.filter(g => g.compliance && !g.compliance.isComplete).length;
    elements.searchInfo.textContent =
      state.filters.requiredCultures.length > 0
        ? `Found ${state.groupedResults.length} labels (${pendingCount} with missing translations) in ${searchTime.toFixed(0)}ms`
        : `Found ${state.groupedResults.length} unique labels in ${searchTime.toFixed(0)}ms`;
  } else {
    elements.searchInfo.textContent = '';
  }
  
  // Render results
  if (state.groupedResults.length === 0 && !query) {
    showEmptyState();
  } else if (state.groupedResults.length === 0) {
    showNoResults();
  } else {
    renderVirtualScroll();
  }
}

/**
 * Apply compliance filter/check against required cultures
 */
function applyComplianceFilters() {
  if (!state.filters.requiredCultures || state.filters.requiredCultures.length === 0) {
    state.groupedResults = state.groupedResults.map(g => ({ ...g, compliance: null }));
    return;
  }

  const requiredSet = new Set(state.filters.requiredCultures);
  const checked = [];
  for (const group of state.groupedResults) {
    const occurrences = group.occurrences || [group];
    const groupCultures = new Set(occurrences.map(o => o.culture));
    const presentRequired = state.filters.requiredCultures.filter(c => groupCultures.has(c));
    if (presentRequired.length === 0) {
      continue; // hide groups with zero required cultures
    }
    const missing = state.filters.requiredCultures.filter(c => !groupCultures.has(c));
    const isComplete = missing.length === 0 && requiredSet.size > 0;
    if (state.filters.hideIncomplete && !isComplete) {
      continue;
    }
    checked.push({
      ...group,
      compliance: {
        isComplete,
        missing
      }
    });
  }
  state.groupedResults = checked;
}

/**
 * Group duplicate labels by labelId, text, and help
 */
function groupDuplicateLabels(labels) {
  const groupMap = new Map();
  
  labels.forEach(label => {
    // Create unique key based on labelId, text, and help
    const key = `${label.labelId}|||${label.text}|||${label.help || ''}`;
    
    if (groupMap.has(key)) {
      groupMap.get(key).occurrences.push(label);
    } else {
      groupMap.set(key, {
        ...label,
        occurrences: [label],
        count: 1
      });
    }
  });
  
  // Update counts
  const grouped = Array.from(groupMap.values());
  grouped.forEach(group => {
    group.count = group.occurrences.length;
  });
  
  return grouped;
}

/**
 * Sort grouped results according to user preference
 */
function applySorting() {
  if (!state.groupedResults || state.groupedResults.length <= 1) {
    return;
  }

  if (state.sortPreference === 'relevance') {
    return; // Keep FlexSearch ranking order
  }

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const getPrimary = (group) => (group?.occurrences?.[0] || group || {});

  state.groupedResults.sort((a, b) => {
    const aPrimary = getPrimary(a);
    const bPrimary = getPrimary(b);

    switch (state.sortPreference) {
      case 'labelId-asc':
        return collator.compare(aPrimary.labelId || '', bPrimary.labelId || '');
      case 'labelId-desc':
        return collator.compare(bPrimary.labelId || '', aPrimary.labelId || '');
      case 'text-asc':
        return collator.compare(aPrimary.text || '', bPrimary.text || '');
      case 'text-desc':
        return collator.compare(bPrimary.text || '', aPrimary.text || '');
      case 'model-asc': {
        const modelCompare = collator.compare(aPrimary.model || '', bPrimary.model || '');
        if (modelCompare !== 0) {
          return modelCompare;
        }
        const aPrefix = (aPrimary.fullId || '').split(':')[0];
        const bPrefix = (bPrimary.fullId || '').split(':')[0];
        return collator.compare(aPrefix, bPrefix);
      }
      default:
        return 0;
    }
  });
}

/**
 * Show empty state
 */
function showEmptyState() {
  elements.emptyState?.classList.remove('hidden');
  elements.loadingState?.classList.add('hidden');
  elements.resultsInner.innerHTML = '';
  elements.resultsInner.style.height = '0';
  updateResultsToolbarVisibility(false);
}

/**
 * Show loading state
 */
function showLoading() {
  elements.emptyState?.classList.add('hidden');
  elements.loadingState?.classList.remove('hidden');
  updateResultsToolbarVisibility(false);
}

/**
 * Show no results state
 */
function showNoResults() {
  elements.emptyState?.classList.add('hidden');
  elements.loadingState?.classList.add('hidden');
  elements.resultsInner.innerHTML = `
    <div class="no-results">
      <div class="welcome-icon">🔍</div>
      <h3>No Results Found</h3>
      <p>Try different search terms or adjust your filters.</p>
    </div>
  `;
  elements.resultsInner.style.height = 'auto';
  updateResultsToolbarVisibility(false);
}

function updateResultsToolbarVisibility(visible) {
  elements.resultsToolbar?.classList.toggle('hidden', !visible);
}

function showLiveIndexLine() {
  elements.liveIndexLine?.classList.remove('hidden');
}

function hideLiveIndexLine() {
  elements.liveIndexLine?.classList.add('hidden');
  if (elements.liveIndexLineFill) {
    elements.liveIndexLineFill.style.width = '0%';
  }
}

function updateLiveIndexLine(percent) {
  const normalized = Math.max(0, Math.min(100, percent || 0));
  state.realtimeStreaming.linePercent = normalized;
  if (elements.liveIndexLineFill) {
    elements.liveIndexLineFill.style.width = `${normalized}%`;
  }
}

function scheduleStreamingSearchRefresh() {
  if (state.realtimeStreaming.pendingUiRefresh) return;
  state.realtimeStreaming.pendingUiRefresh = true;
  state.realtimeStreaming.uiRefreshTimer = setTimeout(() => {
    state.realtimeStreaming.pendingUiRefresh = false;
    if (state.stage === 'READY' && state.currentQuery.trim()) {
      handleSearch();
    }
  }, 500);
}

function stopRealtimeStreaming() {
  state.realtimeStreaming.enabled = false;
  state.realtimeStreaming.pendingUiRefresh = false;
  if (state.realtimeStreaming.uiRefreshTimer) {
    clearTimeout(state.realtimeStreaming.uiRefreshTimer);
    state.realtimeStreaming.uiRefreshTimer = null;
  }
}

/**
 * Calculate virtual scroll parameters dynamically from CSS
 */
function calculateVirtualScrollParams() {
  const viewportHeight = elements.resultsViewport?.clientHeight || 600;
  
  // Get computed CSS variables for accurate height calculation
  const rootStyles = getComputedStyle(document.documentElement);
  const cardHeight = parseFloat(rootStyles.getPropertyValue('--card-height')) || 9.375; // rem
  const cardGap = parseFloat(rootStyles.getPropertyValue('--card-gap')) || 0.625; // rem
  const fontSize = parseFloat(rootStyles.fontSize) || 16; // px
  
  // Convert rem to px
  state.virtualScroll.itemHeight = Math.ceil((cardHeight + cardGap) * fontSize);
  
  state.virtualScroll.visibleCount = Math.ceil(viewportHeight / state.virtualScroll.itemHeight) + 
    (state.virtualScroll.bufferSize * 2);
}

/**
 * Handle scroll event
 */
function handleScroll() {
  state.virtualScroll.scrollTop = elements.resultsViewport.scrollTop;
  renderVirtualScroll();
}

/**
 * Handle window resize
 */
function handleResize() {
  calculateVirtualScrollParams();
  renderVirtualScroll();
}

/**
 * Render virtual scroll
 */
function renderVirtualScroll() {
  const { itemHeight, bufferSize, scrollTop, visibleCount } = state.virtualScroll;
  const results = state.groupedResults;
  
  if (results.length === 0) {
    return;
  }
  
  elements.emptyState?.classList.add('hidden');
  elements.loadingState?.classList.add('hidden');
  updateResultsToolbarVisibility(true);
  
  // Calculate visible range
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - bufferSize);
  const endIndex = Math.min(results.length, startIndex + visibleCount);
  
  // Set container height
  const totalHeight = results.length * itemHeight;
  elements.resultsInner.style.height = `${totalHeight}px`;
  
  // Render visible items
  const visibleItems = results.slice(startIndex, endIndex);
  
  elements.resultsInner.innerHTML = visibleItems.map((group, i) => {
    const index = startIndex + i;
    const top = index * itemHeight;
    
    return renderLabelCard(group, top, index);
  }).join('');
  
  // Add event listeners to action buttons
  elements.resultsInner.querySelectorAll('.btn-copy-id').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const fullId = e.currentTarget.dataset.fullid;
      handleCopyId(fullId);
    });
  });
  
  elements.resultsInner.querySelectorAll('.btn-copy-text').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = e.currentTarget.dataset.text;
      handleCopyText(text);
    });
  });
  
  // Add event listeners to model count badges
  elements.resultsInner.querySelectorAll('.model-count-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      const labelIndex = parseInt(e.currentTarget.dataset.index, 10);
      showLabelDetailsModal(results[labelIndex]);
    });
  });
  
  // Add event listeners to add-to-builder buttons (SPEC-32)
  elements.resultsInner.querySelectorAll('.btn-add-builder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const labelIndex = parseInt(e.currentTarget.dataset.index, 10);
      const item = results[labelIndex];
      if (item) {
        addLabelToBuilder(item);
      }
    });
  });
}

/**
 * Render a label card
 */
function renderLabelCard(group, top, index) {
  const label = group.occurrences[0]; // Use first occurrence for display
  const highlightedText = state.currentQuery 
    ? highlight(label.text, state.currentQuery)
    : escapeHtml(label.text);
  
  // Format label ID based on display settings
  let labelIdHtml = '';
  const format = state.displaySettings.labelFormat;
  
  if (format === 'full') {
    labelIdHtml = `<span class="label-id">${escapeHtml(label.fullId)}</span>`;
  } else if (format === 'simple') {
    labelIdHtml = `<span class="label-id">${escapeHtml(label.labelId)}</span>`;
  } else if (format === 'hybrid') {
    const prefix = label.fullId.split(':')[0]; // Extract @PREFIX
    labelIdHtml = `
      <div class="label-id-hybrid">
        <span class="label-id-main">${escapeHtml(label.labelId)}</span>
        <span class="label-id-prefix">${escapeHtml(prefix)}</span>
      </div>
    `;
  }
  
  // Model badge or count badge
  let modelBadgeHtml = '';
  if (group.count > 1) {
    modelBadgeHtml = `
      <span class="model-count-badge" data-index="${index}">
        📄 ${group.count} files
      </span>
    `;
  } else {
    modelBadgeHtml = `<span class="model-badge">${escapeHtml(label.model)}</span>`;
  }
  
  return `
    <div class="label-card ${group.compliance && !group.compliance.isComplete ? 'compliance-missing' : ''}" data-index="${index}" style="top: ${top}px;">
      <div class="card-header">
        ${labelIdHtml}
        ${modelBadgeHtml}
        <span class="culture-tag">${getLanguageFlag(label.culture)} ${escapeHtml(label.culture)}</span>
      </div>
      <div class="card-body">${highlightedText}</div>
      ${label.help ? `<div class="card-footer">${escapeHtml(label.help)}</div>` : ''}
      ${group.compliance && !group.compliance.isComplete
        ? `<div class="compliance-badge">⚠️ MISSING: ${group.compliance.missing.map(c => c.toUpperCase()).join(', ')}</div>`
        : ''}
      <div class="card-actions">
        <button class="btn btn-outline btn-sm btn-copy-id" data-fullid="${escapeHtml(label.fullId)}">
          📋 Copy ID
        </button>
        <button class="btn btn-outline btn-sm btn-copy-text" data-text="${escapeAttr(label.text)}">
          📝 Copy Text
        </button>
        <button class="btn btn-outline btn-sm btn-add-builder" data-index="${index}" data-label-id="${escapeHtml(label.labelId)}" data-text="${escapeAttr(label.text)}" data-help="${escapeAttr(label.help || '')}" data-prefix="${escapeHtml(label.prefix)}" data-culture="${escapeHtml(label.culture)}" data-model="${escapeHtml(label.model)}" title="Add to Builder">
          ➕
        </button>
      </div>
    </div>
  `;
}

/**
 * Handle copy ID
 */
async function handleCopyId(fullId) {
  const success = await copyToClipboard(fullId);
  if (success) {
    showSuccess(`Copied: ${fullId}`);
  } else {
    showError('Failed to copy to clipboard');
  }
}

/**
 * Handle copy text
 */
async function handleCopyText(text) {
  const success = await copyToClipboard(text);
  if (success) {
    showSuccess('Text copied to clipboard');
  } else {
    showError('Failed to copy to clipboard');
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape for HTML attributes
 */
function escapeAttr(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Open advanced search modal
 */
async function openAdvancedSearchModal() {
  if (!elements.advancedSearchModal) return;
  
  // Load saved filters and available options
  await Promise.all([
    loadFiltersFromDb(),
    populateFilters()
  ]);
  
  // Render modal content and summaries
  renderModalFilters();
  
  // Show modal
  elements.advancedSearchModal.classList.remove('hidden');
  
  // Setup modal filter listeners
  setupModalFilterListeners();
}

/**
 * Close advanced search modal
 */
function closeAdvancedSearchModal() {
  if (!elements.advancedSearchModal) return;
  elements.advancedSearchModal.classList.add('hidden');
}

/**
 * Open system settings modal
 */
function openSystemSettingsModal() {
  if (!elements.systemSettingsModal) return;
  loadDisplaySettingsFromDb().then(async () => {
    await loadAiSettingsFromDb();

    const formatRadio = document.getElementById(`format-${state.displaySettings.labelFormat}`);
    if (formatRadio) {
      formatRadio.checked = true;
    }
    if (elements.modalGroupDuplicates) {
      elements.modalGroupDuplicates.checked = state.displaySettings.groupDuplicates;
    }
    if (elements.uiLanguageSelect) {
      elements.uiLanguageSelect.value = state.displaySettings.uiLanguage || 'auto';
    }
    if (elements.settingDirectSaveMode) {
      elements.settingDirectSaveMode.checked = !!state.displaySettings.builderDirectSaveMode;
    }
    if (elements.settingAiEnabled) {
      elements.settingAiEnabled.checked = !!state.ai.enabled;
    }
    if (elements.settingAiSemanticId) {
      elements.settingAiSemanticId.checked = !!state.ai.semanticIdSuggestion;
    }
    if (elements.settingAiAutoTranslate) {
      elements.settingAiAutoTranslate.checked = !!state.ai.autoTranslateOnDiscovery;
    }
    if (elements.settingAiSourceLanguage) {
      elements.settingAiSourceLanguage.value = state.ai.sourceLanguage || 'auto';
    }
    if (elements.settingAiTargetLanguage) {
      elements.settingAiTargetLanguage.value = state.ai.targetLanguage || 'en-US';
    }
    updateAiSettingsUI();
    
    // SPEC-19: Load hybrid search settings
    const searchSettings = searchService.getSettings();
    if (elements.settingHybridSearch) {
      elements.settingHybridSearch.checked = searchSettings.enableHybridSearch;
    }
    if (elements.settingMaxModels) {
      elements.settingMaxModels.value = searchSettings.maxModelsInMemory;
    }
    if (elements.settingFuzzyThreshold) {
      elements.settingFuzzyThreshold.value = searchSettings.fuzzyThreshold;
      if (elements.fuzzyThresholdValue) {
        elements.fuzzyThresholdValue.textContent = searchSettings.fuzzyThreshold;
      }
    }
    
    elements.systemSettingsModal.classList.remove('hidden');
  });
}

/**
 * Close system settings modal
 */
function closeSystemSettingsModal() {
  if (!elements.systemSettingsModal) return;
  elements.systemSettingsModal.classList.add('hidden');
}

/**
 * Open shortcuts help modal
 */
function openShortcutsModal() {
  if (!elements.shortcutsModal) return;
  elements.shortcutsModal.classList.remove('hidden');
}

/**
 * Close shortcuts help modal
 */
function closeShortcutsModal() {
  if (!elements.shortcutsModal) return;
  elements.shortcutsModal.classList.add('hidden');
}

async function resolveWarmStartLanguages() {
  try {
    const catalog = await db.getCatalog();
    const availableCultures = [...new Set(catalog.map(entry => entry.culture).filter(Boolean))];
    const selected = pickAvailablePriorityLanguages(availableCultures, navigator.language, 3);
    return selected.length ? selected : buildPriorityLanguages().slice(0, 3);
  } catch (err) {
    console.warn('Failed to resolve warm-start languages from catalog:', err);
    return buildPriorityLanguages().slice(0, 3);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatMs(ms) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

async function openStatsDashboardModal() {
  if (!elements.statsDashboardModal) return;

  const catalog = await db.getCatalog();
  if (!catalog.length) {
    showInfo('No indexed dataset statistics available yet.');
    return;
  }

  const modelMap = new Map();
  let totalFiles = 0;
  let totalLabels = 0;
  let totalBytes = 0;
  let totalProcessingMs = 0;

  for (const entry of catalog) {
    totalFiles += entry.fileCount || 0;
    totalLabels += entry.labelCount || 0;
    totalBytes += entry.totalBytes || 0;
    totalProcessingMs += entry.totalProcessingMs || 0;

    const modelAgg = modelMap.get(entry.model) || {
      model: entry.model,
      files: 0,
      labels: 0,
      bytes: 0,
      processingMs: 0
    };
    modelAgg.files += entry.fileCount || 0;
    modelAgg.labels += entry.labelCount || 0;
    modelAgg.bytes += entry.totalBytes || 0;
    modelAgg.processingMs += entry.totalProcessingMs || 0;
    modelMap.set(entry.model, modelAgg);
  }

  const globalSpeed = totalProcessingMs > 0
    ? Math.round(totalLabels / (totalProcessingMs / 1000))
    : 0;

  if (elements.statsTotalModels) {
    elements.statsTotalModels.textContent = modelMap.size.toLocaleString();
  }
  if (elements.statsTotalFiles) {
    elements.statsTotalFiles.textContent = totalFiles.toLocaleString();
  }
  if (elements.statsTotalSize) {
    elements.statsTotalSize.textContent = formatBytes(totalBytes);
  }
  if (elements.statsGlobalSpeed) {
    elements.statsGlobalSpeed.textContent = `${globalSpeed.toLocaleString()}/s`;
  }

  const modelRows = [...modelMap.values()].sort((a, b) => b.labels - a.labels).map((entry) => `
    <div class="language-status-item ready">
      <span class="model-name">${escapeHtml(entry.model)}</span>
      <span class="language-name">${entry.files.toLocaleString()} files</span>
      <div class="language-progress-cell">
        <span class="language-progress-text">${entry.labels.toLocaleString()} labels</span>
      </div>
      <span class="language-status-badge">⏱️ ${formatMs(entry.processingMs)}</span>
    </div>
  `);
  if (elements.statsModelList) {
    elements.statsModelList.innerHTML = modelRows.join('');
  }

  const pairRows = catalog
    .slice()
    .sort((a, b) => (b.totalProcessingMs || 0) - (a.totalProcessingMs || 0))
    .map((entry) => `
      <div class="language-status-item ${entry.status === 'ready' ? 'ready' : 'indexing'}">
        <span class="model-name">${escapeHtml(entry.model)}</span>
        <span class="language-name">${formatLanguageDisplay(entry.culture)}</span>
        <div class="language-progress-cell">
          <span class="language-progress-text">${(entry.labelCount || 0).toLocaleString()} • ${formatBytes(entry.totalBytes || 0)}</span>
        </div>
        <span class="language-status-badge">⏱️ ${formatMs(entry.totalProcessingMs || 0)}</span>
      </div>
    `);
  if (elements.statsPairList) {
    elements.statsPairList.innerHTML = pairRows.join('');
  }

  elements.statsDashboardModal.classList.remove('hidden');
}

function closeStatsDashboardModal() {
  elements.statsDashboardModal?.classList.add('hidden');
}

// ============================================
// SPEC-36: Tools Menu & Label File Merger
// ============================================

// Merger State
const mergerState = {
  files: [], // Array of { name, content, labels }
  parsedFiles: [], // Array of parsed file results
  mergeResult: null, // { sorted, conflicts, content, totalLabels, duplicatesRemoved }
  resolvedConflicts: new Map(), // conflictId -> resolution
  worker: null
};

function openToolsModal() {
  elements.toolsModal?.classList.remove('hidden');
}

function closeToolsModal() {
  elements.toolsModal?.classList.add('hidden');
}

function openMergerModal() {
  closeToolsModal();
  resetMergerState();
  elements.mergerModal?.classList.remove('hidden');
}

function closeMergerModal() {
  elements.mergerModal?.classList.add('hidden');
  if (mergerState.worker) {
    mergerState.worker.terminate();
    mergerState.worker = null;
  }
}

function resetMergerState() {
  mergerState.files = [];
  mergerState.parsedFiles = [];
  mergerState.mergeResult = null;
  mergerState.resolvedConflicts = new Map();
  
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
  }
  if (elements.mergerFilesContainer) {
    elements.mergerFilesContainer.innerHTML = '';
  }
  if (elements.mergerPreviewContent) {
    elements.mergerPreviewContent.textContent = '';
  }
}

function setupMergerDropzone() {
  const dropzone = elements.mergerDropzone;
  if (!dropzone) return;
  
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
    
    const files = [...e.dataTransfer.files].filter(f => f.name.endsWith('.label.txt'));
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
    const files = [...input.files].filter(f => f.name.endsWith('.label.txt'));
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
    // Skip duplicates
    if (mergerState.files.some(f => f.name === file.name)) continue;
    
    const content = await file.text();
    mergerState.files.push({ name: file.name, content });
  }
  
  updateMergerFileList();
}

function updateMergerFileList() {
  if (!elements.mergerFilesContainer) return;
  
  if (mergerState.files.length === 0) {
    elements.mergerFileList?.classList.add('hidden');
    if (elements.btnMergerMerge) elements.btnMergerMerge.disabled = true;
    return;
  }
  
  elements.mergerFileList?.classList.remove('hidden');
  elements.mergerFilesContainer.innerHTML = mergerState.files.map((file, idx) => `
    <div class="file-item" data-index="${idx}">
      <span class="file-icon">📄</span>
      <span class="file-name">${escapeHtml(file.name)}</span>
      <button class="file-remove" data-index="${idx}" title="Remove">✕</button>
    </div>
  `).join('');
  
  // Add remove listeners
  elements.mergerFilesContainer.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.index);
      mergerState.files.splice(idx, 1);
      updateMergerFileList();
    });
  });
  
  if (elements.btnMergerMerge) {
    elements.btnMergerMerge.disabled = mergerState.files.length < 2;
  }
}

function handleMergerClearFiles() {
  mergerState.files = [];
  updateMergerFileList();
}

function handleMergerBack() {
  elements.mergerStepFiles?.classList.remove('hidden');
  elements.mergerStepResults?.classList.add('hidden');
  elements.btnMergerBack?.classList.add('hidden');
  elements.btnMergerMerge?.classList.remove('hidden');
  elements.btnMergerDownload?.classList.add('hidden');
  
  mergerState.mergeResult = null;
  mergerState.resolvedConflicts.clear();
}

async function handleMergerMerge() {
  if (mergerState.files.length < 2) {
    showError(t('merger_error_min_files') || 'Please select at least 2 files to merge');
    return;
  }
  
  // Initialize worker
  if (!mergerState.worker) {
    mergerState.worker = new Worker('./workers/merger.worker.js');
  }
  
  // Show loading
  if (elements.btnMergerMerge) {
    elements.btnMergerMerge.disabled = true;
    elements.btnMergerMerge.textContent = t('merging') || 'Merging...';
  }
  
  return new Promise((resolve) => {
    mergerState.worker.onmessage = (e) => {
      const { type, payload } = e.data;
      
      if (type === 'PARSE_COMPLETE') {
        // Files parsed, now merge
        mergerState.parsedFiles = payload.parsed;
        const labelArrays = payload.parsed.map(p => p.labels);
        
        mergerState.worker.postMessage({
          type: 'MERGE_AND_SORT',
          payload: { labelArrays }
        });
      }
      
      if (type === 'MERGE_AND_SORT_COMPLETE') {
        mergerState.mergeResult = payload;
        showMergeResults();
        resolve();
      }
    };
    
    // Start parsing
    mergerState.worker.postMessage({
      type: 'PARSE_FILES',
      payload: {
        files: mergerState.files.map(f => ({ name: f.name, content: f.content }))
      }
    });
  });
}

function showMergeResults() {
  const result = mergerState.mergeResult;
  if (!result) return;
  
  // Switch to results step
  elements.mergerStepFiles?.classList.add('hidden');
  elements.mergerStepResults?.classList.remove('hidden');
  elements.btnMergerBack?.classList.remove('hidden');
  elements.btnMergerMerge?.classList.add('hidden');
  
  // Update stats
  if (elements.mergerTotalLabels) {
    elements.mergerTotalLabels.textContent = result.totalLabels.toLocaleString();
  }
  if (elements.mergerDuplicates) {
    elements.mergerDuplicates.textContent = result.duplicatesRemoved.toLocaleString();
  }
  if (elements.mergerConflicts) {
    elements.mergerConflicts.textContent = result.conflicts.length.toLocaleString();
  }
  
  // Show conflicts if any
  if (result.conflicts.length > 0) {
    elements.mergerConflictsSection?.classList.remove('hidden');
    renderMergerConflicts();
  } else {
    elements.mergerConflictsSection?.classList.add('hidden');
    elements.btnMergerDownload?.classList.remove('hidden');
  }
  
  // Show preview
  updateMergerPreview();
}

function renderMergerConflicts() {
  if (!elements.mergerConflictsList || !mergerState.mergeResult) return;
  
  const conflicts = mergerState.mergeResult.conflicts;
  
  elements.mergerConflictsList.innerHTML = conflicts.map((conflict, idx) => {
    const existingFile = mergerState.parsedFiles[conflict.existing.sourceIndex]?.name || `File ${conflict.existing.sourceIndex + 1}`;
    const incomingFile = mergerState.parsedFiles[conflict.incoming.sourceIndex]?.name || `File ${conflict.incoming.sourceIndex + 1}`;
    const resolution = mergerState.resolvedConflicts.get(conflict.id) || 'keep_existing';
    
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
  
  // Add change listeners
  elements.mergerConflictsList.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const name = e.target.name;
      const idx = parseInt(name.split('-')[1]);
      const conflict = conflicts[idx];
      mergerState.resolvedConflicts.set(conflict.id, e.target.value);
      
      updateMergerPreview();
      checkMergerReady();
    });
  });
  
  // Initialize default resolutions
  conflicts.forEach(c => {
    if (!mergerState.resolvedConflicts.has(c.id)) {
      mergerState.resolvedConflicts.set(c.id, 'keep_existing');
    }
  });
  
  checkMergerReady();
}

function checkMergerReady() {
  const conflicts = mergerState.mergeResult?.conflicts || [];
  const allResolved = conflicts.every(c => mergerState.resolvedConflicts.has(c.id));
  
  if (allResolved) {
    elements.btnMergerDownload?.classList.remove('hidden');
  }
}

function updateMergerPreview() {
  if (!elements.mergerPreviewContent || !mergerState.mergeResult) return;
  
  // Build final labels list with conflict resolutions
  const finalLabels = [...mergerState.mergeResult.sorted];
  
  // Apply conflict resolutions
  for (const conflict of mergerState.mergeResult.conflicts) {
    const resolution = mergerState.resolvedConflicts.get(conflict.id) || 'keep_existing';
    
    if (resolution === 'use_incoming') {
      // Find and update the label
      const idx = finalLabels.findIndex(l => l.id === conflict.id);
      if (idx !== -1) {
        finalLabels[idx] = {
          ...finalLabels[idx],
          text: conflict.incoming.text,
          helpText: conflict.incoming.helpText
        };
      }
    }
    // 'keep_existing' is already the default
  }
  
  // Generate preview (show first 50 lines)
  const previewLines = finalLabels.slice(0, 50).map(label => {
    let line = `${label.id}=${label.text.replace(/;/g, ';;')}`;
    if (label.helpText) {
      line += `;${label.helpText.replace(/;/g, ';;')}`;
    }
    return line;
  });
  
  if (finalLabels.length > 50) {
    previewLines.push(`... and ${finalLabels.length - 50} more labels`);
  }
  
  elements.mergerPreviewContent.textContent = previewLines.join('\n');
}

function handleMergerDownload() {
  if (!mergerState.mergeResult) return;
  
  // Build final content with conflict resolutions
  const finalLabels = [...mergerState.mergeResult.sorted];
  
  // Apply conflict resolutions
  for (const conflict of mergerState.mergeResult.conflicts) {
    const resolution = mergerState.resolvedConflicts.get(conflict.id) || 'keep_existing';
    
    if (resolution === 'use_incoming') {
      const idx = finalLabels.findIndex(l => l.id === conflict.id);
      if (idx !== -1) {
        finalLabels[idx] = {
          ...finalLabels[idx],
          text: conflict.incoming.text,
          helpText: conflict.incoming.helpText
        };
      }
    }
  }
  
  // Generate content
  const lines = finalLabels.map(label => {
    let line = `${label.id}=${label.text.replace(/;/g, ';;')}`;
    if (label.helpText) {
      line += `;${label.helpText.replace(/;/g, ';;')}`;
    }
    return line;
  });
  
  const content = lines.join('\n');
  
  // Download
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'merged.label.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showSuccess(t('merger_download_complete') || `Downloaded merged file with ${finalLabels.length} labels`);
}

// ============================================
// SPEC-32: Label Builder IDE
// ============================================

// Builder State
const builderState = {
  labels: [], // Array of { id (db), labelId, culture, text, helpText, prefix, source }
  pendingConflict: null, // { existingLabel, newLabel }
  conflictResolveCallback: null, // Function to call after conflict resolution
  selectedLabelId: null,
  translatorWorker: null,
  translatorReady: false,
  translating: false,
  translateProgress: 0,
  pendingInit: null,
  pendingTranslate: null
};

function applyBuilderDirectSaveVisualState() {
  const modalContent = elements.builderModal?.querySelector('.builder-modal-content');
  const directSaveActive = !!state.displaySettings.builderDirectSaveMode;

  elements.builderDirectSaveWarning?.classList.toggle('hidden', !directSaveActive);
  modalContent?.classList.toggle('direct-save-active', directSaveActive);
}

function openBuilderModal() {
  closeToolsModal();
  applyBuilderDirectSaveVisualState();
  if (elements.builderSourceLanguage) {
    elements.builderSourceLanguage.value = state.ai.sourceLanguage || 'auto';
  }
  if (elements.builderTargetLanguages) {
    const targets = new Set([state.ai.targetLanguage || 'en-US']);
    [...elements.builderTargetLanguages.options].forEach((opt) => {
      opt.selected = targets.has(opt.value);
    });
  }
  updateBuilderTranslateProgress(0, t('ai_translation_idle'));
  loadBuilderWorkspace();
  elements.builderModal?.classList.remove('hidden');
}

function closeBuilderModal() {
  elements.builderModal?.classList.add('hidden');
}

async function loadBuilderWorkspace() {
  try {
    builderState.labels = await db.getBuilderLabels();
    if (!builderState.labels.some(l => l.id === builderState.selectedLabelId)) {
      builderState.selectedLabelId = builderState.labels.length > 0 ? builderState.labels[0].id : null;
    }
    renderBuilderItems();
    updateBuilderFooter();
  } catch (err) {
    console.error('Error loading builder workspace:', err);
    builderState.labels = [];
    builderState.selectedLabelId = null;
    renderBuilderItems();
  }
}

function renderBuilderItems() {
  const container = elements.builderItemsContainer;
  const emptyState = elements.builderEmptyState;
  
  if (!container) return;
  
  if (builderState.labels.length === 0) {
    container.classList.add('hidden');
    emptyState?.classList.remove('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  emptyState?.classList.add('hidden');
  
  container.innerHTML = builderState.labels.map((label, idx) => `
    <div class="builder-item ${builderState.selectedLabelId === label.id ? 'selected' : ''}" data-id="${label.id}" data-index="${idx}" tabindex="0">
      <div class="builder-item-content">
        <div class="builder-item-header">
          <span class="builder-label-id">${escapeHtml(label.labelId)}</span>
          ${label.prefix ? `<span class="builder-prefix">${escapeHtml(label.prefix)}</span>` : ''}
          ${label.culture ? `<span class="builder-culture">${escapeHtml(label.culture)}</span>` : ''}
          ${label.isAiTranslated ? `<span class="builder-ai-badge" title="${escapeHtml(t('ai_generated_badge'))}">✨ AI</span>` : ''}
        </div>
        <div class="builder-item-text">${escapeHtml(label.text)}</div>
        ${label.helpText ? `<div class="builder-item-help">${escapeHtml(label.helpText)}</div>` : ''}
        ${label.source ? `<div class="builder-item-source">${escapeHtml(label.source)}</div>` : ''}
      </div>
      <div class="builder-item-actions">
        <button class="btn-icon btn-edit-builder" title="${t('edit')}" data-id="${label.id}">✏️</button>
        <button class="btn-icon btn-remove-builder" title="${t('delete')}" data-id="${label.id}">🗑️</button>
      </div>
    </div>
  `).join('');
  
  // Attach event listeners
  container.querySelectorAll('.builder-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id, 10);
      if (Number.isFinite(id)) {
        builderState.selectedLabelId = id;
        renderBuilderItems();
      }
    });
  });

  container.querySelectorAll('.btn-edit-builder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(e.currentTarget.dataset.id, 10);
      editBuilderItem(id);
    });
  });
  
  container.querySelectorAll('.btn-remove-builder').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(e.currentTarget.dataset.id, 10);
      removeBuilderItem(id);
    });
  });
}

function updateBuilderFooter() {
  const count = builderState.labels.length;
  if (elements.builderCountBadge) {
    elements.builderCountBadge.textContent = t('builder_count', { count });
  }
  
  // Enable/disable buttons based on count
  if (elements.btnBuilderClear) {
    elements.btnBuilderClear.disabled = count === 0;
  }
  if (elements.btnBuilderDownload) {
    elements.btnBuilderDownload.disabled = count === 0;
  }
}

async function addLabelToBuilder(labelData) {
  const sourceLabel = labelData?.occurrences?.[0] || labelData || {};

  // Prepare label for builder
  const newLabel = {
    labelId: sourceLabel.labelId || sourceLabel.fullId?.split(':')[1] || '',
    culture: sourceLabel.culture || elements.builderCultureSelect?.value || 'en-US',
    text: sourceLabel.text || '',
    helpText: sourceLabel.helpText || sourceLabel.help || '',
    prefix: sourceLabel.prefix || sourceLabel.fullId?.split(':')[0]?.replace('@', '') || '',
    source: sourceLabel.model ? `${sourceLabel.model}/${sourceLabel.fileName || 'unknown'}` : 'Search Result'
  };

  if (!newLabel.labelId || !newLabel.text) {
    showError(t('builder_add_error') || 'Failed to add label');
    return;
  }
  
  // Check for conflicts
  const existingLabel = builderState.labels.find(
    l => l.labelId === newLabel.labelId && l.culture === newLabel.culture
  );
  
  if (existingLabel) {
    // Check if it's a total identity conflict (same content)
    if (existingLabel.text === newLabel.text && existingLabel.helpText === newLabel.helpText) {
      // Silent deduplication
      showSuccess(t('builder_duplicate_skipped') || 'Label already exists in workspace');
      return;
    }
    
    // ID collision - show conflict modal
    builderState.pendingConflict = { existingLabel, newLabel };
    openConflictModal(existingLabel, newLabel);
    return;
  }
  
  // No conflict, add directly
  try {
    const id = await db.addBuilderLabel(newLabel);
    newLabel.id = id;
    builderState.labels.push(newLabel);
    builderState.selectedLabelId = id;
    renderBuilderItems();
    updateBuilderFooter();
    showSuccess(t('builder_label_added') || `Added "${newLabel.labelId}" to builder`);
  } catch (err) {
    console.error('Error adding label to builder:', err);
    showError(t('builder_add_error') || 'Failed to add label');
  }
}

async function removeBuilderItem(id) {
  try {
    await db.removeBuilderLabel(id);
    builderState.labels = builderState.labels.filter(l => l.id !== id);
    if (builderState.selectedLabelId === id) {
      builderState.selectedLabelId = builderState.labels.length > 0 ? builderState.labels[0].id : null;
    }
    renderBuilderItems();
    updateBuilderFooter();
    showSuccess(t('builder_label_removed') || 'Label removed from workspace');
  } catch (err) {
    console.error('Error removing builder item:', err);
    showError(t('builder_remove_error') || 'Failed to remove label');
  }
}

function editBuilderItem(id) {
  const label = builderState.labels.find(l => l.id === id);
  if (!label) return;
  
  // Pre-fill the new label form with existing data
  if (elements.inputNewLabelId) elements.inputNewLabelId.value = label.labelId;
  if (elements.inputNewLabelText) elements.inputNewLabelText.value = label.text;
  if (elements.inputNewLabelHelp) elements.inputNewLabelHelp.value = label.helpText || '';
  if (elements.inputNewLabelPrefix) elements.inputNewLabelPrefix.value = label.prefix || '';
  if (elements.builderCultureSelect && label.culture) {
    elements.builderCultureSelect.value = label.culture;
  }
  
  // Store the editing ID
  elements.newLabelModal?.setAttribute('data-editing-id', id.toString());
  
  openNewLabelModal();
}

function openNewLabelModal() {
  // Clear form if not editing
  if (!elements.newLabelModal?.hasAttribute('data-editing-id')) {
    if (elements.inputNewLabelId) elements.inputNewLabelId.value = '';
    if (elements.inputNewLabelText) elements.inputNewLabelText.value = '';
    if (elements.inputNewLabelHelp) elements.inputNewLabelHelp.value = '';
    if (elements.inputNewLabelPrefix) elements.inputNewLabelPrefix.value = '';
  }
  
  elements.newLabelModal?.classList.remove('hidden');
  elements.inputNewLabelId?.focus();
}

function closeNewLabelModal() {
  elements.newLabelModal?.classList.add('hidden');
  elements.newLabelModal?.removeAttribute('data-editing-id');
}

async function handleSaveNewLabel() {
  const labelId = elements.inputNewLabelId?.value?.trim();
  const text = elements.inputNewLabelText?.value?.trim();
  const helpText = elements.inputNewLabelHelp?.value?.trim() || '';
  const prefix = elements.inputNewLabelPrefix?.value?.trim() || '';
  const culture = elements.builderCultureSelect?.value || 'en-US';
  
  // Validation
  if (!labelId) {
    showError(t('builder_id_required') || 'Label ID is required');
    elements.inputNewLabelId?.focus();
    return;
  }
  
  // Validate ID format: ^[A-Za-z_][A-Za-z0-9_]*$
  const idPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!idPattern.test(labelId)) {
    showError(t('builder_invalid_id') || 'Invalid Label ID. Use only letters, numbers, and underscores. Must start with letter or underscore.');
    elements.inputNewLabelId?.focus();
    return;
  }
  
  if (!text) {
    showError(t('builder_text_required') || 'Label text is required');
    elements.inputNewLabelText?.focus();
    return;
  }
  
  const editingId = elements.newLabelModal?.getAttribute('data-editing-id');
  
  if (editingId) {
    // Update existing label
    const id = parseInt(editingId);
    try {
      await db.updateBuilderLabel(id, { labelId, text, helpText, prefix });
      const idx = builderState.labels.findIndex(l => l.id === id);
      if (idx !== -1) {
        builderState.labels[idx] = { ...builderState.labels[idx], labelId, text, helpText, prefix };
      }
      renderBuilderItems();
      closeNewLabelModal();
      showSuccess(t('builder_label_updated') || 'Label updated');
    } catch (err) {
      console.error('Error updating builder label:', err);
      showError(t('builder_update_error') || 'Failed to update label');
    }
  } else {
    // Create new label
    const newLabel = {
      labelId,
      text,
      helpText,
      prefix,
      culture,
      source: 'Manual Entry'
    };
    
    // Check for conflicts
    const existingLabel = builderState.labels.find(
      l => l.labelId === newLabel.labelId && l.culture === newLabel.culture
    );
    
    if (existingLabel) {
      // ID collision
      builderState.pendingConflict = { existingLabel, newLabel };
      closeNewLabelModal();
      openConflictModal(existingLabel, newLabel);
      return;
    }
    
    try {
      const id = await db.addBuilderLabel(newLabel);
      newLabel.id = id;
      builderState.labels.push(newLabel);
      builderState.selectedLabelId = id;
      renderBuilderItems();
      updateBuilderFooter();
      closeNewLabelModal();
      showSuccess(t('builder_label_added') || `Added "${newLabel.labelId}" to builder`);
    } catch (err) {
      console.error('Error adding builder label:', err);
      showError(t('builder_add_error') || 'Failed to add label');
    }
  }
}

function openConflictModal(existingLabel, newLabel) {
  if (elements.conflictMessage) {
    elements.conflictMessage.textContent = t('conflict_description');
  }

  // Populate conflict comparison
  if (elements.conflictExistingId) {
    elements.conflictExistingId.textContent = existingLabel.labelId;
  }
  if (elements.conflictExistingText) {
    elements.conflictExistingText.textContent = existingLabel.text;
  }
  if (elements.conflictExistingHelp) {
    elements.conflictExistingHelp.textContent = existingLabel.helpText || '-';
  }
  if (elements.conflictIncomingId) {
    elements.conflictIncomingId.textContent = newLabel.labelId;
  }
  if (elements.conflictIncomingText) {
    elements.conflictIncomingText.textContent = newLabel.text;
  }
  if (elements.conflictIncomingHelp) {
    elements.conflictIncomingHelp.textContent = newLabel.helpText || '-';
  }
  
  elements.conflictModal?.classList.remove('hidden');
}

function openManualConflictEditor() {
  const pending = builderState.pendingConflict;
  if (!pending?.newLabel) {
    closeConflictModal();
    return;
  }

  if (elements.inputNewLabelId) elements.inputNewLabelId.value = pending.newLabel.labelId;
  if (elements.inputNewLabelText) elements.inputNewLabelText.value = pending.newLabel.text || '';
  if (elements.inputNewLabelHelp) elements.inputNewLabelHelp.value = pending.newLabel.helpText || '';
  if (elements.inputNewLabelPrefix) elements.inputNewLabelPrefix.value = pending.newLabel.prefix || '';
  if (elements.builderCultureSelect) elements.builderCultureSelect.value = pending.newLabel.culture || 'en-US';

  closeConflictModal();
  openNewLabelModal();
}

function closeConflictModal() {
  elements.conflictModal?.classList.add('hidden');
  builderState.pendingConflict = null;
}

async function resolveConflict(action) {
  const { existingLabel, newLabel } = builderState.pendingConflict || {};
  
  if (!existingLabel || !newLabel) {
    closeConflictModal();
    return;
  }
  
  try {
    switch (action) {
      case 'skip':
        // Keep existing, discard new
        showSuccess(t('builder_conflict_skipped') || 'Kept existing label');
        break;
        
      case 'overwrite':
        // Replace existing with new
        await db.updateBuilderLabel(existingLabel.id, {
          text: newLabel.text,
          helpText: newLabel.helpText,
          prefix: newLabel.prefix,
          source: newLabel.source
        });
        const idx = builderState.labels.findIndex(l => l.id === existingLabel.id);
        if (idx !== -1) {
          builderState.labels[idx] = {
            ...builderState.labels[idx],
            text: newLabel.text,
            helpText: newLabel.helpText,
            prefix: newLabel.prefix,
            source: newLabel.source
          };
        }
        renderBuilderItems();
        showSuccess(t('builder_conflict_overwritten') || 'Label overwritten');
        break;
        
      case 'rename':
        // Add with auto-renamed ID
        let suffix = 1;
        let renamedId = `${newLabel.labelId}${suffix}`;
        while (builderState.labels.some(l => l.labelId === renamedId && l.culture === newLabel.culture)) {
          suffix++;
          renamedId = `${newLabel.labelId}${suffix}`;
        }
        const renamedLabel = { ...newLabel, labelId: renamedId };
        const id = await db.addBuilderLabel(renamedLabel);
        renamedLabel.id = id;
        builderState.labels.push(renamedLabel);
        builderState.selectedLabelId = id;
        renderBuilderItems();
        updateBuilderFooter();
        showSuccess(t('builder_conflict_renamed') || `Added as "${renamedId}"`);
        break;
    }
  } catch (err) {
    console.error('Error resolving conflict:', err);
    showError(t('builder_conflict_error') || 'Failed to resolve conflict');
  }
  
  closeConflictModal();
}

async function handleBuilderClear() {
  if (builderState.labels.length === 0) return;
  
  if (!confirm(t('builder_clear_confirm') || 'Clear all labels from workspace?')) {
    return;
  }
  
  try {
    await db.clearBuilderWorkspace();
    builderState.labels = [];
    builderState.selectedLabelId = null;
    renderBuilderItems();
    updateBuilderFooter();
    showSuccess(t('builder_cleared') || 'Workspace cleared');
  } catch (err) {
    console.error('Error clearing builder workspace:', err);
    showError(t('builder_clear_error') || 'Failed to clear workspace');
  }
}

function handleBuilderDownload() {
  if (builderState.labels.length === 0) {
    showError(t('builder_empty') || 'No labels to download');
    return;
  }
  
  // Sort labels alphabetically by labelId
  const sortedLabels = [...builderState.labels].sort((a, b) => 
    a.labelId.localeCompare(b.labelId)
  );
  
  // Generate label file content
  const lines = sortedLabels.map(label => {
    // Escape semicolons by doubling them
    const escapedText = label.text.replace(/;/g, ';;');
    let line = `${label.labelId}=${escapedText}`;
    
    if (label.helpText) {
      const escapedHelp = label.helpText.replace(/;/g, ';;');
      line += `;${escapedHelp}`;
    }
    
    return line;
  });
  
  const content = lines.join('\n');
  
  // Determine filename based on prefix if all labels share same prefix
  const prefixes = [...new Set(sortedLabels.map(l => l.prefix).filter(Boolean))];
  let filename = 'custom.label.txt';
  if (prefixes.length === 1) {
    filename = `${prefixes[0]}.label.txt`;
  }
  
  // Download
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showSuccess(t('builder_download_complete') || `Downloaded ${sortedLabels.length} labels as ${filename}`);
}

function getBuilderTargetLanguages() {
  if (!elements.builderTargetLanguages) return [];
  return [...elements.builderTargetLanguages.options]
    .filter((option) => option.selected)
    .map((option) => option.value);
}

function setAiTranslationHeaderStatus(visible, message = '') {
  elements.btnAiTranslationStatus?.classList.toggle('hidden', !visible);
  if (elements.aiTranslationStatusText) {
    elements.aiTranslationStatusText.textContent = message || t('ai_translation_idle');
  }
}

function updateBuilderTranslateProgress(progress = 0, message = '') {
  const normalized = Math.max(0, Math.min(100, Math.round(progress)));
  builderState.translateProgress = normalized;

  if (elements.builderTranslateFill) {
    elements.builderTranslateFill.style.width = `${normalized}%`;
  }
  if (elements.builderTranslateLabel) {
    elements.builderTranslateLabel.textContent = message || `${normalized}%`;
  }
  elements.builderTranslateProgress?.classList.toggle('hidden', !builderState.translating && normalized === 0);

  if (builderState.translating) {
    setAiTranslationHeaderStatus(true, `${t('ai_translation_running')} ${normalized}%`);
  } else if (normalized === 100) {
    setAiTranslationHeaderStatus(false, t('ai_translation_idle'));
  }
}

function toWorkerLang(culture) {
  const value = (culture || '').toLowerCase();
  if (!value) return 'en';
  if (value.startsWith('pt')) return 'pt';
  if (value.startsWith('es')) return 'es';
  if (value.startsWith('fr')) return 'fr';
  if (value.startsWith('de')) return 'de';
  return 'en';
}

function ensureTranslatorWorker() {
  if (builderState.translatorWorker) return builderState.translatorWorker;

  builderState.translatorWorker = new Worker('./workers/translator.worker.js', { type: 'module' });
  builderState.translatorWorker.onmessage = (event) => {
    const { type, payload } = event.data || {};

    if (type === 'INIT_PROGRESS') {
      builderState.translating = true;
      updateBuilderTranslateProgress(payload?.progress || 0, payload?.message || t('ai_status_downloading'));
      return;
    }

    if (type === 'READY') {
      builderState.translatorReady = true;
      if (builderState.pendingInit) {
        builderState.pendingInit.resolve(payload);
        builderState.pendingInit = null;
      }
      return;
    }

    if (type === 'TRANSLATE_PROGRESS') {
      const progress = payload?.progress || 0;
      const message = t('ai_translation_progress', {
        current: payload?.completed || 0,
        total: payload?.total || 0
      });
      updateBuilderTranslateProgress(progress, message);
      return;
    }

    if (type === 'TRANSLATE_COMPLETE') {
      if (builderState.pendingTranslate) {
        builderState.pendingTranslate.resolve(payload);
        builderState.pendingTranslate = null;
      }
      return;
    }

    if (type === 'ERROR') {
      const error = new Error(payload?.message || 'Translator worker error');
      if (builderState.pendingInit) {
        builderState.pendingInit.reject(error);
        builderState.pendingInit = null;
      }
      if (builderState.pendingTranslate) {
        builderState.pendingTranslate.reject(error);
        builderState.pendingTranslate = null;
      }
      builderState.translating = false;
      updateBuilderTranslateProgress(0, '');
      showError(error.message);
    }
  };

  builderState.translatorWorker.onerror = (event) => {
    console.error('Translator worker error:', event);
    builderState.translating = false;
    if (builderState.pendingInit) {
      builderState.pendingInit.reject(new Error('Translator worker failed'));
      builderState.pendingInit = null;
    }
    if (builderState.pendingTranslate) {
      builderState.pendingTranslate.reject(new Error('Translator worker failed'));
      builderState.pendingTranslate = null;
    }
    updateBuilderTranslateProgress(0, '');
    showError(t('ai_translation_error'));
  };

  return builderState.translatorWorker;
}

function initializeTranslatorWorker() {
  if (builderState.translatorReady) {
    return Promise.resolve();
  }
  if (builderState.pendingInit) {
    return builderState.pendingInit.promise;
  }

  const worker = ensureTranslatorWorker();
  let resolveInit;
  let rejectInit;
  const promise = new Promise((resolve, reject) => {
    resolveInit = resolve;
    rejectInit = reject;
  });
  builderState.pendingInit = { promise, resolve: resolveInit, reject: rejectInit };
  worker.postMessage({ type: 'INIT' });
  return promise;
}

function requestTranslations(jobs) {
  if (builderState.pendingTranslate) {
    return Promise.reject(new Error('Translation already in progress'));
  }

  const worker = ensureTranslatorWorker();
  let resolveTranslate;
  let rejectTranslate;
  const promise = new Promise((resolve, reject) => {
    resolveTranslate = resolve;
    rejectTranslate = reject;
  });
  builderState.pendingTranslate = { promise, resolve: resolveTranslate, reject: rejectTranslate };
  worker.postMessage({ type: 'TRANSLATE', payload: { jobs } });
  return promise;
}

async function applyTranslatedLabel(baseLabel, targetCulture, translatedText) {
  const existing = builderState.labels.find(
    (label) => label.labelId === baseLabel.labelId && label.culture === targetCulture
  );

  if (existing) {
    await db.updateBuilderLabel(existing.id, {
      text: translatedText,
      helpText: existing.helpText || baseLabel.helpText || '',
      isAiTranslated: true,
      translatedFrom: baseLabel.culture
    });
    Object.assign(existing, {
      text: translatedText,
      isAiTranslated: true,
      translatedFrom: baseLabel.culture
    });
    return;
  }

  const entry = {
    labelId: baseLabel.labelId,
    culture: targetCulture,
    text: translatedText,
    helpText: baseLabel.helpText || '',
    prefix: baseLabel.prefix || '',
    source: `AI Translation (${baseLabel.culture} -> ${targetCulture})`,
    isAiTranslated: true,
    translatedFrom: baseLabel.culture
  };
  const id = await db.addBuilderLabel(entry);
  entry.id = id;
  builderState.labels.push(entry);
}

async function handleBuilderAutoTranslate() {
  if (!isAiReadyAndEnabled()) {
    showInfo(t('ai_translation_requires_ready'));
    return;
  }
  if (builderState.labels.length === 0) {
    showInfo(t('builder_empty'));
    return;
  }
  if (builderState.translating) return;

  const sourceLanguage = elements.builderSourceLanguage?.value || 'auto';
  const targetCultures = getBuilderTargetLanguages();
  if (targetCultures.length === 0) {
    showInfo(t('ai_translation_select_target'));
    return;
  }

  state.ai.sourceLanguage = sourceLanguage;
  state.ai.targetLanguage = targetCultures[0] || state.ai.targetLanguage;
  saveAiSettingsToDb();

  const sourceLabels = sourceLanguage === 'auto'
    ? [...builderState.labels]
    : builderState.labels.filter((label) => label.culture === sourceLanguage);

  if (sourceLabels.length === 0) {
    showInfo(t('ai_translation_no_source_labels'));
    return;
  }

  const jobs = [];
  sourceLabels.forEach((label) => {
    targetCultures.forEach((targetCulture) => {
      if (targetCulture !== label.culture) {
        jobs.push({
          key: `${label.id || 'new'}::${targetCulture}`,
          text: label.text,
          sourceLanguage: toWorkerLang(label.culture),
          targetLanguage: toWorkerLang(targetCulture),
          targetCulture,
          labelId: label.labelId,
          sourceCulture: label.culture
        });
      }
    });
  });

  if (jobs.length === 0) {
    showInfo(t('ai_translation_nothing_to_do'));
    return;
  }

  builderState.translating = true;
  updateBuilderTranslateProgress(0, t('ai_translation_initializing'));

  try {
    await initializeTranslatorWorker();
    const result = await requestTranslations(jobs);
    const translatedItems = result?.translations || [];

    const labelByKey = new Map(
      sourceLabels.map((label) => [`${label.labelId}::${label.culture}`, label])
    );

    for (const item of translatedItems) {
      const base = labelByKey.get(`${item.labelId}::${item.sourceCulture}`);
      if (!base) continue;
      await applyTranslatedLabel(base, item.targetCulture, item.translatedText);
    }

    renderBuilderItems();
    updateBuilderFooter();
    updateBuilderTranslateProgress(100, t('ai_translation_complete'));
    showSuccess(t('ai_translation_done_toast', { count: translatedItems.length }));
  } catch (err) {
    console.error('AI translation failed:', err);
    showError(err.message || t('ai_translation_error'));
    updateBuilderTranslateProgress(0, '');
  } finally {
    builderState.translating = false;
    setTimeout(() => {
      updateBuilderTranslateProgress(0, t('ai_translation_idle'));
      setAiTranslationHeaderStatus(false, t('ai_translation_idle'));
    }, 800);
  }
}

// ============================================
// SPEC-34: Hardcoded String Extractor
// ============================================

const extractorState = {
  files: [],
  candidates: [],
  worker: null,
  running: false,
  sessionId: null
};

function createExtractorSessionId() {
  return `extractor_${Date.now()}`;
}

function openExtractorModal() {
  closeToolsModal();
  if (!extractorState.sessionId) {
    extractorState.sessionId = createExtractorSessionId();
  }
  elements.extractorModal?.classList.remove('hidden');
  renderExtractorSummary();
}

function closeExtractorModal() {
  elements.extractorModal?.classList.add('hidden');
}

function renderExtractorSummary() {
  if (!elements.extractorSummary) return;

  const files = extractorState.files.length;
  const candidates = extractorState.candidates.filter((item) => item.status === 'pending').length;
  const confirmed = extractorState.candidates.filter((item) => item.status === 'confirmed').length;
  const ignored = extractorState.candidates.filter((item) => item.status === 'ignored').length;

  if (files === 0 && extractorState.candidates.length === 0) {
    elements.extractorSummary.classList.add('hidden');
    return;
  }

  elements.extractorSummary.classList.remove('hidden');
  elements.extractorSummary.textContent = t('extractor_summary', {
    files,
    candidates,
    confirmed,
    ignored
  });
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

async function handleExtractorSelectFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = '.xml,.xpp,.rnrproj,.txt';

  input.onchange = async () => {
    const files = [...(input.files || [])];
    if (files.length === 0) return;

    const loaded = [];
    for (const file of files) {
      const content = await file.text();
      loaded.push({
        name: file.name,
        content
      });
    }

    extractorState.files = loaded;
    extractorState.candidates = [];
    extractorState.sessionId = createExtractorSessionId();
    elements.extractorResults?.classList.add('hidden');
    elements.btnExtractorAddAll?.classList.add('hidden');
    renderExtractorSummary();
    showSuccess(t('extractor_files_loaded', { count: loaded.length }));
  };

  input.click();
}

function buildSuggestedIds(candidates) {
  const existing = new Set(builderState.labels.map((item) => `${item.labelId}::${item.culture}`));
  const usedIds = new Set();
  const prefix = builderState.labels.find((item) => item.prefix)?.prefix || 'LBL';
  let sequence = 1;

  return candidates.map((item) => {
    let suggestion = '';
    if (isAiReadyAndEnabled() && state.ai.semanticIdSuggestion) {
      suggestion = item.text
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
    }

    if (!suggestion || suggestion.length < 3) {
      suggestion = `${prefix}_${String(sequence).padStart(3, '0')}`;
      sequence++;
    }

    const culture = elements.builderCultureSelect?.value || 'en-US';
    while (usedIds.has(suggestion) || existing.has(`${suggestion}::${culture}`)) {
      suggestion = `${suggestion}1`;
    }
    usedIds.add(suggestion);

    return {
      ...item,
      suggestedId: suggestion,
      status: 'pending'
    };
  });
}

function renderExtractorResults() {
  if (!elements.extractorResults) return;

  const rows = extractorState.candidates;
  if (rows.length === 0) {
    elements.extractorResults.classList.add('hidden');
    elements.btnExtractorAddAll?.classList.add('hidden');
    return;
  }

  elements.extractorResults.classList.remove('hidden');
  elements.btnExtractorAddAll?.classList.toggle('hidden', !rows.some((item) => item.status === 'pending'));

  elements.extractorResults.innerHTML = rows.map((item, index) => `
    <div class="extractor-row extractor-${item.status}">
      <div class="extractor-main">
        <div class="extractor-text">${escapeHtml(item.text)}</div>
        <div class="extractor-context">${escapeHtml((item.contexts || []).map((ctx) => `${ctx.file}:${ctx.line}`).join(', '))}</div>
      </div>
      <input class="extractor-id-input" data-index="${index}" value="${escapeAttr(item.suggestedId || '')}" ${item.status !== 'pending' ? 'disabled' : ''}>
      <div class="extractor-row-actions">
        <button class="btn btn-outline btn-sm extractor-confirm" data-index="${index}" ${item.status !== 'pending' ? 'disabled' : ''}>${t('extractor_confirm_new')}</button>
        <button class="btn btn-outline btn-sm extractor-ignore" data-index="${index}" ${item.status !== 'pending' ? 'disabled' : ''}>${t('extractor_ignore')}</button>
      </div>
    </div>
  `).join('');

  elements.extractorResults.querySelectorAll('.extractor-id-input').forEach((input) => {
    input.addEventListener('input', (event) => {
      const idx = parseInt(event.currentTarget.dataset.index, 10);
      if (Number.isFinite(idx) && extractorState.candidates[idx]) {
        extractorState.candidates[idx].suggestedId = event.currentTarget.value.trim();
      }
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
    prefix: builderState.labels.find((item) => item.prefix)?.prefix || 'LBL',
    model: 'Extractor',
    fileName: candidate.contexts?.[0]?.file || 'scan'
  });

  candidate.status = 'confirmed';
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
  extractorState.worker.onmessage = (event) => {
    const { type, payload } = event.data || {};

    if (type === 'PROGRESS') {
      extractorState.running = true;
      updateExtractorProgress(payload?.progress || 0, `${payload?.processed || 0}/${payload?.total || 0}`);
      return;
    }

    if (type === 'COMPLETE') {
      extractorState.running = false;
      updateExtractorProgress(100, t('extractor_scan_complete'));
      extractorState.candidates = buildSuggestedIds(payload?.candidates || []);
      renderExtractorResults();
      showSuccess(t('extractor_found_candidates', { count: extractorState.candidates.length }));
      setTimeout(() => updateExtractorProgress(0, ''), 600);
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

async function handleExtractorSaveSession() {
  if (!extractorState.sessionId) {
    extractorState.sessionId = createExtractorSessionId();
  }

  try {
    await db.saveExtractionSession({
      sessionId: extractorState.sessionId,
      model: 'generic',
      pendingStrings: extractorState.candidates,
      ignoredStrings: extractorState.candidates.filter((item) => item.status === 'ignored'),
      completedLabels: extractorState.candidates.filter((item) => item.status === 'confirmed'),
      files: extractorState.files.map((file) => ({ name: file.name })),
      lastFileProcessed: extractorState.files[0]?.name || ''
    });
    showSuccess(t('extractor_session_saved'));
  } catch (err) {
    console.error('Failed to save extraction session:', err);
    showError(t('extractor_session_save_error'));
  }
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
    extractorState.candidates = session.pendingStrings || [];
    renderExtractorResults();
    showSuccess(t('extractor_session_resumed'));
  } catch (err) {
    console.error('Failed to load extraction session:', err);
    showError(t('extractor_session_load_error'));
  }
}

// ============================================
// SPEC-23: Background Indexing Functions
// ============================================

/**
 * Show background progress indicator in header
 */
function showBackgroundProgressIndicator() {
  if (elements.btnBackgroundProgress) {
    elements.btnBackgroundProgress.classList.remove('hidden');
  }
  state.backgroundIndexing.completionSummary = null;
  renderBackgroundSummary();
  updateLabelCount();
}

/**
 * Hide background progress indicator
 */
function hideBackgroundProgressIndicator() {
  if (elements.btnBackgroundProgress) {
    elements.btnBackgroundProgress.classList.add('hidden');
    const textSpan = elements.btnBackgroundProgress.querySelector('.progress-text');
    if (textSpan) {
      textSpan.textContent = t('header_indexing_active', { percent: 0, count: '0' });
    }
  }
  if (state.indexingMode === 'idle') {
    hideLiveIndexLine();
  }
}

/**
 * Update background progress in header button
 */
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

let catalogFlushTimer = null;
const catalogPendingUpdates = new Map();

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

/**
 * Open background progress modal
 */
function openBackgroundProgressModal() {
  if (!elements.backgroundProgressModal) return;
  renderBackgroundSummary();
  renderBackgroundLanguageList();
  elements.backgroundProgressModal.classList.remove('hidden');
}

/**
 * Close background progress modal
 */
function closeBackgroundProgressModal() {
  if (!elements.backgroundProgressModal) return;
  elements.backgroundProgressModal.classList.add('hidden');
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

function scheduleBackgroundProgressUIUpdate() {
  if (state.backgroundIndexing.updateScheduled) return;
  state.backgroundIndexing.updateScheduled = true;

  requestAnimationFrame(() => {
    state.backgroundIndexing.updateScheduled = false;
    renderBackgroundProgressUI();
  });
}

function renderBackgroundProgressUI() {
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

/**
 * Render language status list in progress modal
 */
function renderBackgroundLanguageList() {
  if (!elements.bgLanguageList) return;

  const rows = [...state.backgroundIndexing.languageStatus.values()];
  rows.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1;
    if (!a.isPriority && b.isPriority) return 1;
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.culture.localeCompare(b.culture);
  });

  const items = rows.map((entry) => {
    const statusClass = entry.status === 'indexing' ? 'processing' : entry.status;
    const statusIcon = entry.status === 'ready' ? '✅' : entry.status === 'indexing' ? '⏳' : '💤';
    const statusTextKey = entry.status === 'ready'
      ? 'status_ready'
      : entry.status === 'indexing'
        ? 'status_processing'
        : 'status_waiting';
    const progressPercent = entry.fileCount > 0
      ? Math.min(100, Math.round((entry.processedFiles / entry.fileCount) * 100))
      : (entry.status === 'ready' ? 100 : 0);
    const priorityBadge = entry.isPriority ? ` <span class="filter-status-indicator ready">⭐</span>` : '';

    return `
      <div class="language-status-item ${statusClass}">
        <span class="model-name">${escapeHtml(entry.model)}${priorityBadge}</span>
        <span class="language-name">${formatLanguageDisplay(entry.culture)}</span>
        <div class="language-progress-cell">
          <div class="language-progress-bar">
            <div class="language-progress-fill" style="width:${progressPercent}%"></div>
          </div>
          <span class="language-progress-text">${progressPercent}%</span>
        </div>
        <span class="language-status-badge">${statusIcon} ${t(statusTextKey)}</span>
      </div>
    `;
  });

  elements.bgLanguageList.innerHTML = items.join('');
}

function getLanguageAggregateStatus(culture) {
  const rows = [...state.backgroundIndexing.languageStatus.values()].filter((entry) => entry.culture === culture);
  if (rows.length === 0) return null;

  const hasProcessing = rows.some((entry) => entry.status === 'indexing');
  const hasWaiting = rows.some((entry) => entry.status === 'waiting');
  const allReady = rows.every((entry) => entry.status === 'ready');
  return allReady ? 'ready' : (hasProcessing ? 'indexing' : (hasWaiting ? 'waiting' : 'ready'));
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
  state.backgroundIndexing.completionSummary = null;
  
  // Use requestIdleCallback for low-priority processing (or setTimeout fallback)
  const scheduleWork = window.requestIdleCallback || ((cb) => setTimeout(cb, 100));
  
  scheduleWork(async () => {
    try {
      const entryKeys = new Set(backgroundFiles.map(f => `${f.metadata.model}|||${f.metadata.culture}`));
      for (const key of entryKeys) {
        const entry = state.backgroundIndexing.languageStatus.get(key);
        if (entry && entry.status !== 'ready') {
          entry.status = 'indexing';
        }
      }
      scheduleBackgroundProgressUIUpdate();

      const result = await indexFilesWithWorkers(backgroundFiles, false);
      const finalLabelCount = await db.getLabelCount();
      
      // Update language statuses to ready
      for (const key of entryKeys) {
        const status = state.backgroundIndexing.languageStatus.get(key);
        if (status) {
          status.status = 'ready';
          status.processedFiles = status.fileCount;
        }
      }

      state.backgroundIndexing.completionSummary = {
        labels: result.totalLabels,
        files: result.processedFiles,
        speed: state.backgroundIndexing.labelsPerSec || 0
      };
      queueCatalogProgressFlush();
      await flushCatalogProgressNow();
      
      state.indexingMode = 'idle';
      hideBackgroundProgressIndicator();
      
      // Refresh label count
      state.totalLabels = finalLabelCount;
      updateLabelCount();
      const completedAt = Date.now();
      await db.setMetadata('lastIndexed', completedAt);
      updateLastIndexedDisplay(completedAt);
      renderBackgroundSummary();
      renderBackgroundLanguageList();
      
      showSuccess(t('background_indexing_complete') || `Background indexing complete! ${result.totalLabels.toLocaleString()} additional labels indexed.`);
      
    } catch (err) {
      console.error('Background indexing error:', err);
      state.indexingMode = 'idle';
      hideBackgroundProgressIndicator();
    }
  });
}

/**
 * Apply system settings from modal
 */
async function applySystemSettings() {
  const formatRadios = document.querySelectorAll('input[name="labelFormat"]');
  formatRadios.forEach(radio => {
    if (radio.checked) {
      state.displaySettings.labelFormat = radio.value;
    }
  });
  state.displaySettings.groupDuplicates = elements.modalGroupDuplicates?.checked || false;
  state.displaySettings.uiLanguage = elements.uiLanguageSelect?.value || 'auto';
  state.displaySettings.builderDirectSaveMode = elements.settingDirectSaveMode?.checked || false;
  state.ai.enabled = elements.settingAiEnabled?.checked || false;
  state.ai.semanticIdSuggestion = elements.settingAiSemanticId?.checked || false;
  state.ai.autoTranslateOnDiscovery = elements.settingAiAutoTranslate?.checked || false;
  state.ai.sourceLanguage = elements.settingAiSourceLanguage?.value || 'auto';
  state.ai.targetLanguage = elements.settingAiTargetLanguage?.value || 'en-US';

  // Update language display locale (for flag and name formatting)
  if (state.displaySettings.uiLanguage === 'auto') {
    setDisplayLocale(null);
  } else {
    setDisplayLocale(state.displaySettings.uiLanguage);
  }

  // Update i18n interface language
  setLanguage(state.displaySettings.uiLanguage);
  updateInterfaceText();
  applyBuilderDirectSaveVisualState();
  updateAiSettingsUI();

  // SPEC-19: Save hybrid search settings
  const searchSettings = {
    enableHybridSearch: elements.settingHybridSearch?.checked ?? true,
    maxModelsInMemory: parseInt(elements.settingMaxModels?.value) || 5,
    fuzzyThreshold: parseFloat(elements.settingFuzzyThreshold?.value) || 0.2
  };
  await searchService.saveSettings(searchSettings);
  console.log('🔍 Search settings updated:', searchSettings);

  await Promise.all([
    saveDisplaySettingsToDb(),
    saveAiSettingsToDb()
  ]);

  if (state.ai.enabled && state.ai.status === 'inactive') {
    showInfo(t('ai_download_required'));
  }

  closeSystemSettingsModal();
  handleSearch();
  showInfo(t('toast_settings_applied'));
}

function isAiReadyAndEnabled() {
  return state.ai.enabled && state.ai.status === 'ready';
}

function updateAiStatusBadge() {
  if (!elements.aiStatusBadge) return;

  let key = 'ai_status_inactive';
  if (state.ai.status === 'downloading') key = 'ai_status_downloading';
  if (state.ai.status === 'ready') key = 'ai_status_ready';

  elements.aiStatusBadge.setAttribute('data-status', state.ai.status);
  elements.aiStatusBadge.textContent = t(key);
}

function updateAiSettingsUI() {
  const enabled = elements.settingAiEnabled?.checked ?? state.ai.enabled;
  const unlocked = enabled && state.ai.status === 'ready';
  const downloading = state.ai.status === 'downloading';

  state.ai.enabled = enabled;

  updateAiStatusBadge();

  if (elements.aiDownloadFill) {
    elements.aiDownloadFill.style.width = `${Math.max(0, Math.min(100, state.ai.progress))}%`;
  }
  if (elements.aiDownloadLabel) {
    const phaseKey = state.ai.progressPhase === 'indexing' ? 'ai_phase_indexing' : 'ai_phase_downloading';
    const label = state.ai.status === 'ready'
      ? t('ai_progress_ready')
      : `${t(phaseKey)} ${Math.round(state.ai.progress)}%`;
    elements.aiDownloadLabel.textContent = label;
  }
  elements.aiDownloadProgress?.classList.toggle('hidden', !downloading && state.ai.progress <= 0);

  if (elements.btnAiDownloadModel) {
    elements.btnAiDownloadModel.disabled = !enabled || downloading || state.ai.status === 'ready';
  }
  if (elements.btnAiClearCache) {
    elements.btnAiClearCache.disabled = downloading || state.ai.status === 'inactive';
  }

  elements.aiUnlockedOptions?.classList.toggle('ai-disabled', !unlocked);
  elements.aiLockedHint?.classList.toggle('hidden', unlocked);

  if (elements.settingAiSemanticId) elements.settingAiSemanticId.disabled = !unlocked;
  if (elements.settingAiAutoTranslate) elements.settingAiAutoTranslate.disabled = !unlocked;
  if (elements.settingAiSourceLanguage) elements.settingAiSourceLanguage.disabled = !unlocked;
  if (elements.settingAiTargetLanguage) elements.settingAiTargetLanguage.disabled = !unlocked;
}

async function loadAiSettingsFromDb() {
  try {
    const [aiStatus, aiSettings] = await Promise.all([
      db.getMetadata('aiStatus'),
      db.getMetadata('aiSettings')
    ]);

    const validStatus = aiStatus === 'ready' || aiStatus === 'downloading' || aiStatus === 'inactive'
      ? aiStatus
      : 'inactive';

    state.ai.status = validStatus === 'downloading' ? 'inactive' : validStatus;
    state.ai.progress = state.ai.status === 'ready' ? 100 : 0;
    state.ai.progressPhase = 'downloading';
    state.ai.enabled = !!aiSettings?.enabled;
    state.ai.semanticIdSuggestion = !!aiSettings?.semanticIdSuggestion;
    state.ai.autoTranslateOnDiscovery = !!aiSettings?.autoTranslateOnDiscovery;
    state.ai.sourceLanguage = aiSettings?.sourceLanguage || 'auto';
    state.ai.targetLanguage = aiSettings?.targetLanguage || 'en-US';

    if (validStatus === 'downloading') {
      await db.setMetadata('aiStatus', 'inactive');
    }
  } catch (err) {
    console.error('Failed to load AI settings:', err);
    state.ai.status = 'inactive';
    state.ai.progress = 0;
  }
}

async function saveAiSettingsToDb() {
  try {
    await Promise.all([
      db.setMetadata('aiStatus', state.ai.status),
      db.setMetadata('aiSettings', {
        enabled: state.ai.enabled,
        semanticIdSuggestion: state.ai.semanticIdSuggestion,
        autoTranslateOnDiscovery: state.ai.autoTranslateOnDiscovery,
        sourceLanguage: state.ai.sourceLanguage,
        targetLanguage: state.ai.targetLanguage
      })
    ]);
  } catch (err) {
    console.error('Failed to save AI settings:', err);
  }
}

function ensureAiWorker() {
  if (state.ai.worker) return state.ai.worker;

  state.ai.worker = new Worker('./workers/ai-model.worker.js', { type: 'module' });
  state.ai.worker.onmessage = async (event) => {
    const { type, payload } = event.data || {};
    if (type === 'PROGRESS') {
      state.ai.status = 'downloading';
      state.ai.progress = payload?.progress ?? 0;
      state.ai.progressPhase = payload?.phase === 'indexing' ? 'indexing' : 'downloading';
      updateAiSettingsUI();
      return;
    }

    if (type === 'READY') {
      state.ai.status = 'ready';
      state.ai.progress = 100;
      state.ai.progressPhase = 'indexing';
      updateAiSettingsUI();
      await saveAiSettingsToDb();
      showSuccess(t('ai_ready_toast'));
      return;
    }

    if (type === 'CACHE_CLEARED') {
      state.ai.status = 'inactive';
      state.ai.progress = 0;
      state.ai.progressPhase = 'downloading';
      state.ai.enabled = false;
      state.ai.semanticIdSuggestion = false;
      state.ai.autoTranslateOnDiscovery = false;
      updateAiSettingsUI();
      await saveAiSettingsToDb();
      showInfo(t('ai_cache_cleared'));
      return;
    }

    if (type === 'ERROR') {
      state.ai.status = 'inactive';
      state.ai.progress = 0;
      state.ai.progressPhase = 'downloading';
      updateAiSettingsUI();
      await saveAiSettingsToDb();
      showError(payload?.message || t('ai_error_generic'));
    }
  };

  state.ai.worker.onerror = async (err) => {
    console.error('AI worker error:', err);
    state.ai.status = 'inactive';
    state.ai.progress = 0;
    state.ai.progressPhase = 'downloading';
    updateAiSettingsUI();
    await saveAiSettingsToDb();
    showError(t('ai_error_generic'));
  };

  return state.ai.worker;
}

async function startAiModelDownload() {
  if (!elements.settingAiEnabled?.checked) {
    showInfo(t('ai_enable_first'));
    return;
  }
  if (state.ai.status === 'downloading' || state.ai.status === 'ready') return;

  state.ai.status = 'downloading';
  state.ai.progress = 0;
  state.ai.progressPhase = 'downloading';
  updateAiSettingsUI();
  await saveAiSettingsToDb();

  const worker = ensureAiWorker();
  worker.postMessage({
    type: 'DOWNLOAD_MODEL',
    payload: {
      modelName: 'Xenova/m2m100_418M',
      sourceLanguage: state.ai.sourceLanguage,
      targetLanguage: state.ai.targetLanguage
    }
  });
}

async function clearAiCache() {
  if (state.ai.status === 'downloading') return;
  const confirmed = confirm(t('ai_clear_confirm'));
  if (!confirmed) return;

  const worker = ensureAiWorker();
  worker.postMessage({ type: 'CLEAR_CACHE' });
}

/**
 * Setup modal filter listeners
 */
function setupModalFilterListeners() {
  // Exact match toggle
  elements.modalExactMatch?.addEventListener('change', (e) => {
    state.filters.exactMatch = e.target.checked;
  });

  // Compliance toggle
  elements.modalHideIncomplete?.addEventListener('change', (e) => {
    state.filters.hideIncomplete = e.target.checked;
  });
}

/**
 * Apply filters from modal
 */
function applyFilters() {
  // Save search filters to DB and refresh
  normalizeFilterState();
  saveFiltersToDb();
  renderFilterPills();
  
  // Close modal
  closeAdvancedSearchModal();
  
  // Trigger search with new settings
  handleSearch();
  
  showInfo('Advanced search filters applied');
}

/**
 * Clear all filters
 */
function clearAllFilters() {
  state.filters.models = [];
  state.filters.cultures = [];
  state.filters.exactMatch = false;
  state.filters.requiredCultures = [];
  state.filters.hideIncomplete = false;
  
  // Update modal
  renderModalFilters();
  
  // Save to DB
  saveFiltersToDb();
  
  // Update pills
  renderFilterPills();
  
  // Trigger search
  handleSearch();
  
  showInfo('All filters cleared');
}

/**
 * Open generic selector modal for models/languages/required languages
 */
function openItemSelectorModal(type) {
  state.selectorModal.type = type;
  state.selectorModal.search = '';
  if (elements.itemSelectorSearch) {
    elements.itemSelectorSearch.value = '';
  }
  if (elements.itemSelectorTitle) {
    const titleMap = {
      models: 'Select Models',
      cultures: 'Select Languages',
      requiredCultures: 'Select Required Languages'
    };
    elements.itemSelectorTitle.textContent = titleMap[type] || 'Select Items';
  }
  renderItemSelectorModal();
  elements.itemSelectorModal?.classList.remove('hidden');
}

/**
 * Close generic selector modal
 */
function closeItemSelectorModal() {
  elements.itemSelectorModal?.classList.add('hidden');
  updateModalSelectionSummaries();
  commitFilterChangesAndSearch();
}

/**
 * Render selector modal list
 * SPEC-23: Added status indicators for languages
 */
function renderItemSelectorModal() {
  if (!elements.itemSelectorList) return;
  const type = state.selectorModal.type;
  if (!type) return;

  const allItems = type === 'models' ? state.availableFilters.models : state.availableFilters.cultures;
  const selected = type === 'models'
    ? state.filters.models
    : (type === 'cultures' ? state.filters.cultures : state.filters.requiredCultures);
  const search = state.selectorModal.search.trim().toLowerCase();
  const filtered = search
    ? allItems.filter(item => item.toLowerCase().includes(search))
    : allItems;

  elements.itemSelectorList.innerHTML = filtered.map(item => {
    const checked = selected.includes(item);
    const label = type === 'models' ? escapeHtml(item) : formatLanguageDisplay(item);
    
    // SPEC-23: Add status indicator for languages
    let statusIndicator = '';
    if (type === 'cultures' || type === 'requiredCultures') {
      const aggregateStatus = getLanguageAggregateStatus(item);
      if (aggregateStatus) {
        const statusIcon = aggregateStatus === 'ready' ? '✅' : aggregateStatus === 'indexing' ? '⏳' : '💤';
        const statusClass = aggregateStatus;
        statusIndicator = `<span class="filter-status-indicator ${statusClass}">${statusIcon}</span>`;
      }
    }
    
    return `
      <label class="selector-item">
        <input type="checkbox" data-item="${escapeAttr(item)}" ${checked ? 'checked' : ''}>
        <span>${label}${statusIndicator}</span>
      </label>
    `;
  }).join('');

  const actuallyAllSelected = filtered.length > 0 && filtered.every(i => selected.includes(i));
  if (elements.btnToggleAllSelector) {
    elements.btnToggleAllSelector.textContent = actuallyAllSelected ? 'Deselect All' : 'Select All';
  }

  elements.itemSelectorList.querySelectorAll('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', (e) => {
      const item = e.target.dataset.item;
      const targetArr = type === 'models'
        ? state.filters.models
        : (type === 'cultures' ? state.filters.cultures : state.filters.requiredCultures);
      if (e.target.checked) {
        if (!targetArr.includes(item)) targetArr.push(item);
      } else {
        const idx = targetArr.indexOf(item);
        if (idx >= 0) targetArr.splice(idx, 1);
      }
      renderItemSelectorModal();
      updateModalSelectionSummaries();
    });
  });
}

/**
 * Toggle all visible items in selector modal
 */
function toggleAllInSelectorModal() {
  const type = state.selectorModal.type;
  if (!type) return;
  const allItems = type === 'models' ? state.availableFilters.models : state.availableFilters.cultures;
  const targetArr = type === 'models'
    ? state.filters.models
    : (type === 'cultures' ? state.filters.cultures : state.filters.requiredCultures);
  const search = state.selectorModal.search.trim().toLowerCase();
  const filtered = search
    ? allItems.filter(item => item.toLowerCase().includes(search))
    : allItems;

  const allSelected = filtered.length > 0 && filtered.every(i => targetArr.includes(i));
  if (allSelected) {
    filtered.forEach(item => {
      const idx = targetArr.indexOf(item);
      if (idx >= 0) targetArr.splice(idx, 1);
    });
  } else {
    filtered.forEach(item => {
      if (!targetArr.includes(item)) targetArr.push(item);
    });
  }
  renderItemSelectorModal();
  updateModalSelectionSummaries();
}

/**
 * Persist current filter state (including compliance) and refresh UI
 */
function commitFilterChangesAndSearch() {
  normalizeFilterState();
  saveFiltersToDb();
  renderFilterPills();
  handleSearch();
}

/**
 * Save filters to IndexedDB
 */
async function saveFiltersToDb() {
  try {
    await db.saveMetadata('filters', state.filters);
  } catch (err) {
    console.error('Failed to save filters:', err);
  }
}

/**
 * Load filters from IndexedDB
 */
async function loadFiltersFromDb() {
  try {
    const savedFilters = await db.getMetadata('filters');
    if (savedFilters) {
      state.filters = {
        models: savedFilters.models || [],
        cultures: savedFilters.cultures || [],
        exactMatch: savedFilters.exactMatch || false,
        requiredCultures: savedFilters.requiredCultures || [],
        hideIncomplete: savedFilters.hideIncomplete || false
      };
    }
  } catch (err) {
    console.error('Failed to load filters:', err);
  }
}

/**
 * Save display settings to IndexedDB
 */
async function saveDisplaySettingsToDb() {
  try {
    await db.saveMetadata('displaySettings', state.displaySettings);
  } catch (err) {
    console.error('Failed to save display settings:', err);
  }
}

/**
 * Load display settings from IndexedDB
 */
async function loadDisplaySettingsFromDb() {
  try {
    const savedSettings = await db.getMetadata('displaySettings');
    if (savedSettings) {
      state.displaySettings = {
        labelFormat: savedSettings.labelFormat || 'full',
        groupDuplicates: savedSettings.groupDuplicates !== undefined 
          ? savedSettings.groupDuplicates 
          : true,
        uiLanguage: savedSettings.uiLanguage || 'auto',
        builderDirectSaveMode: !!savedSettings.builderDirectSaveMode
      };
      // Set language display locale
      if (state.displaySettings.uiLanguage === 'auto') {
        setDisplayLocale(null);
      } else {
        setDisplayLocale(state.displaySettings.uiLanguage);
      }
      // Set i18n interface language
      setLanguage(state.displaySettings.uiLanguage);
      updateInterfaceText();
      applyBuilderDirectSaveVisualState();
    }
  } catch (err) {
    console.error('Failed to load display settings:', err);
  }
}

/**
 * Save sorting preference to IndexedDB
 */
async function saveSortPreferenceToDb() {
  try {
    await db.saveMetadata('sortPreference', state.sortPreference);
  } catch (err) {
    console.error('Failed to save sort preference:', err);
  }
}

/**
 * Load sorting preference from IndexedDB
 */
async function loadSortPreferenceFromDb() {
  try {
    const savedSort = await db.getMetadata('sortPreference');
    if (typeof savedSort === 'string' && savedSort.length > 0) {
      state.sortPreference = savedSort;
    }
  } catch (err) {
    console.error('Failed to load sort preference:', err);
  }
}

/**
 * Show label details modal
 */
function showLabelDetailsModal(group) {
  if (!elements.labelDetailsModal || !elements.labelDetailsContent) return;
  
  const occurrences = group.occurrences || [group];
  
  let html = `
    <div class="label-details-header">
      <h4>${escapeHtml(group.labelId)}</h4>
      <p class="label-details-text">${escapeHtml(group.text)}</p>
      ${group.help ? `<p class="label-details-help">${escapeHtml(group.help)}</p>` : ''}
    </div>
    <div class="label-details-list">
      <h5>Found in ${occurrences.length} ${occurrences.length === 1 ? 'model' : 'models'}:</h5>
  `;
  
  occurrences.forEach(occurrence => {
    html += `
      <div class="occurrence-item">
        <div class="occurrence-header">
          <span class="occurrence-model">📦 ${escapeHtml(occurrence.model)}</span>
          <span class="occurrence-culture">${formatLanguageDisplay(occurrence.culture)}</span>
        </div>
        <div class="occurrence-path">
          <code>${escapeHtml(occurrence.filePath)}</code>
        </div>
        <div class="occurrence-id">
          <strong>Full ID:</strong> <code>${escapeHtml(occurrence.fullId)}</code>
        </div>
      </div>
    `;
  });
  
  html += `</div>`;
  
  elements.labelDetailsContent.innerHTML = html;
  elements.labelDetailsModal.classList.remove('hidden');
}

/**
 * Close label details modal
 */
function closeLabelDetailsModal() {
  if (!elements.labelDetailsModal) return;
  elements.labelDetailsModal.classList.add('hidden');
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
