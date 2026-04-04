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
import { getLanguageFlag, formatLanguageDisplay, setDisplayLocale } from './utils/languages.js';
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
    uiLanguage: 'auto'
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
    updateSplashStatus('Loading saved labels from database...');
    const totalLabels = await db.getLabelCount();
    state.totalLabels = totalLabels;
    
    updateSplashStatus(`Building search index (${totalLabels.toLocaleString()} labels)...`);
    // Stream labels from IndexedDB to FlexSearch in chunks
    await buildSearchIndexStreamingWithSplash();
    
    updateSplashStatus('Loading preferences and filters...');
    const lastIndexed = await db.getMetadata('lastIndexed');
    
    // Hide splash and show main interface
    hideSplash();
    showMainInterface(lastIndexed);
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
    indexingProgress: document.getElementById('indexing-progress'),
    progressFill: document.getElementById('progress-fill'),
    indexingStatus: document.getElementById('indexing-status'),
    
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
    resultsContainer: document.getElementById('results-container'),
    resultsViewport: document.getElementById('results-viewport'),
    resultsInner: document.getElementById('results-inner'),
    emptyState: document.getElementById('empty-state'),
    loadingState: document.getElementById('loading-state')
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
  
  // Language Filter Modal
  elements.btnCloseLanguageFilterModal?.addEventListener('click', closeLanguageFilterModal);
  elements.btnToggleAllLanguages?.addEventListener('click', toggleAllLanguagesFilter);
  elements.btnApplyLanguageFilter?.addEventListener('click', applyLanguageFilter);
  elements.languageFilterSearch?.addEventListener('input', debounce(renderLanguageFilterList, 150));
  
  // Header
  elements.btnRescan?.addEventListener('click', handleRescan);
  elements.btnShortcutsHelp?.addEventListener('click', openShortcutsModal);
  
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
  const hasOpenModal = !elements.advancedSearchModal?.classList.contains('hidden') ||
                       !elements.systemSettingsModal?.classList.contains('hidden') ||
                       !elements.itemSelectorModal?.classList.contains('hidden') ||
                       !elements.labelDetailsModal?.classList.contains('hidden') ||
                       !elements.shortcutsModal?.classList.contains('hidden');

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

  // Alt+R to re-scan
  if (e.altKey && e.key.toLowerCase() === 'r' && state.stage === 'READY') {
    e.preventDefault();
    handleRescan();
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
    
    // Only clear data AFTER successfully selecting a new folder
    await db.clearLabels();
    searchService.clearSearch();
    
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
  elements.btnChangeFolder?.classList.remove('hidden');
  if (elements.progressFill) {
    elements.progressFill.style.width = '0%';
  }
  if (elements.indexingStatus) {
    elements.indexingStatus.textContent = t('indexing_labels');
  }
  
  // Show/hide cancel button based on whether we're coming from READY (re-scan)
  if (state.previousStage === 'READY') {
    elements.btnCancelRescan?.classList.remove('hidden');
  } else {
    elements.btnCancelRescan?.classList.add('hidden');
  }
  
  // Also hide main app in case we're coming from there
  elements.app?.classList.add('hidden');
  
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
  updateLanguageFilterCount();
  
  // Render models list with checkboxes
  renderModelsListWithSelection();
  
  // Update selection info
  updateSelectionInfo();
  
  // Show dashboard
  elements.onboardingOverlay?.classList.add('hidden');
  elements.discoveryDashboard?.classList.remove('hidden');
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
 * Handle start indexing - TURBO INGESTION (SPEC-16)
 * Uses parallel workers and batch processing for high performance
 */
async function handleStartIndexing() {
  state.stage = 'INDEXING';
  
  // Show progress
  elements.btnStartIndexing?.classList.add('hidden');
  elements.btnCancelRescan?.classList.add('hidden');
  elements.btnChangeFolder?.classList.add('hidden');
  elements.indexingProgress?.classList.remove('hidden');
  
  // Clear existing data
  await db.clearLabels();
  searchService.clearSearch();
  
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
  console.log(`📦 Architecture: Main Thread passes FileHandles → Workers read+parse+save to IndexedDB`);
  console.log(`🔒 Zero-Copy: Main Thread NEVER reads file content, NEVER receives label arrays`);
  
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
  
  // Create worker pool
  const workers = [];
  
  for (let i = 0; i < workerCount; i++) {
    const worker = new Worker(
      new URL('./workers/indexer.worker.js', import.meta.url),
      { type: 'module' }
    );
    workers.push(worker);
  }
  
  // Distribute files among workers evenly
  // Each worker gets a chunk of FileHandles to process
  const filesPerWorker = Math.ceil(fileTasks.length / workerCount);
  const workerPromises = [];
  
  for (let i = 0; i < workerCount; i++) {
    const workerFiles = fileTasks.slice(i * filesPerWorker, (i + 1) * filesPerWorker);
    
    if (workerFiles.length === 0) continue;
    
    const worker = workers[i];
    
    const workerPromise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const { type } = e.data;
        
        switch (type) {
          case 'FILE_COMPLETE':
            // Worker completed a file - update progress
            totalLabels += e.data.labels;
            processedFiles++;
            updateProgress();
            break;
            
          case 'BATCH_SAVED':
            // Large file progress (optional feedback)
            break;
            
          case 'COMPLETE':
            // Worker finished all its files
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
      
      // SPEC-18: Pass FileHandles to Worker - Main Thread NEVER reads file content!
      // Worker will: 1) Open file from handle, 2) Stream-parse, 3) Save to IndexedDB
      worker.postMessage({
        type: 'PROCESS_FILES_HANDLES',
        files: workerFiles
      });
    });
    
    workerPromises.push(workerPromise);
  }
  
  // Wait for all workers to complete
  try {
    await Promise.all(workerPromises);
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
  elements.indexingStatus.textContent = t('saving_database');
  await db.setMetadata('lastIndexed', Date.now());
  await db.setMetadata('totalLabels', totalLabels);
  
  // Build search index using streaming from IndexedDB
  // This loads labels in chunks to avoid memory spike
  elements.indexingStatus.textContent = t('building_index');
  await buildSearchIndexStreaming();
  
  state.totalLabels = totalLabels;
  state.previousStage = null;
  
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Full indexing pipeline complete: ${totalLabels} labels in ${elapsed}s`);
  
  // Show main interface
  showMainInterface();
  
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
  
  // Get last indexed time
  const lastIndexed = await db.getMetadata('lastIndexed');
  
  console.log(`✅ Loaded ${totalLabels} labels from database (streamed)`);
  
  // Show main interface
  showMainInterface(lastIndexed);
}

/**
 * Show main interface
 */
function showMainInterface(lastIndexed = null) {
  state.stage = 'READY';
  
  // Update header
  elements.labelCountBadge.textContent = `${state.totalLabels.toLocaleString()} labels indexed`;
  
  if (lastIndexed) {
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
  
  // Populate filters
  populateFilters();
  
  // Load saved filters and display settings, then render pills
  Promise.all([
    loadFiltersFromDb(),
    loadDisplaySettingsFromDb(),
    loadSortPreferenceFromDb()
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
function populateFilters() {
  const stats = searchService.getStats();
  
  // Store available filters
  state.availableFilters.cultures = stats.cultures.sort();
  state.availableFilters.models = stats.models.sort();
  
  // Render modal filters
  renderModalFilters();
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
 * Handle search
 */
function handleSearch() {
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
    exactMatch: state.filters.exactMatch
  };
  
  // If specific filters are selected, apply them
  let results = searchService.search(query, filterOptions);
  
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
}

/**
 * Show loading state
 */
function showLoading() {
  elements.emptyState?.classList.add('hidden');
  elements.loadingState?.classList.remove('hidden');
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
      const fullId = e.target.dataset.fullid;
      handleCopyId(fullId);
    });
  });
  
  elements.resultsInner.querySelectorAll('.btn-copy-text').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = e.target.dataset.text;
      handleCopyText(text);
    });
  });
  
  // Add event listeners to model count badges
  elements.resultsInner.querySelectorAll('.model-count-badge').forEach(badge => {
    badge.addEventListener('click', (e) => {
      const labelIndex = parseInt(e.target.dataset.index);
      showLabelDetailsModal(results[labelIndex]);
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
    <div class="label-card ${group.compliance && !group.compliance.isComplete ? 'compliance-missing' : ''}" style="top: ${top}px;">
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
function openAdvancedSearchModal() {
  if (!elements.advancedSearchModal) return;
  
  // Load saved filters from metadata
  loadFiltersFromDb();
  
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
  loadDisplaySettingsFromDb().then(() => {
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

/**
 * Apply system settings from modal
 */
function applySystemSettings() {
  const formatRadios = document.querySelectorAll('input[name="labelFormat"]');
  formatRadios.forEach(radio => {
    if (radio.checked) {
      state.displaySettings.labelFormat = radio.value;
    }
  });
  state.displaySettings.groupDuplicates = elements.modalGroupDuplicates?.checked || false;
  state.displaySettings.uiLanguage = elements.uiLanguageSelect?.value || 'auto';

  // Update language display locale (for flag and name formatting)
  if (state.displaySettings.uiLanguage === 'auto') {
    setDisplayLocale(null);
  } else {
    setDisplayLocale(state.displaySettings.uiLanguage);
  }

  // Update i18n interface language
  setLanguage(state.displaySettings.uiLanguage);
  updateInterfaceText();

  saveDisplaySettingsToDb();
  closeSystemSettingsModal();
  handleSearch();
  showInfo(t('toast_settings_applied'));
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
    return `
      <label class="selector-item">
        <input type="checkbox" data-item="${escapeAttr(item)}" ${checked ? 'checked' : ''}>
        <span>${label}</span>
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
        uiLanguage: savedSettings.uiLanguage || 'auto'
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
