/**
 * D365FO Label Explorer - Main Application
 * Entry point and application orchestration
 */

import * as db from './core/db.js';
import * as fileAccess from './core/file-access.js';
import * as searchService from './core/search.js';
import { debounce } from './utils/debounce.js';
import { highlight, escapeHtml, escapeAttr } from './utils/highlight.js';
import { copyToClipboard } from './utils/clipboard.js';
import { showSuccess, showError, showInfo } from './utils/toast.js';
import { getLanguageFlag, formatLanguageDisplay, setDisplayLocale, buildPriorityLanguages, pickAvailablePriorityLanguages } from './utils/languages.js';
import { setLanguage, t, updateInterfaceText } from './utils/translations.js';
import { FLAGS } from './utils/flags.js';
import { withFeatureError, ManagedWorker } from './utils/error-boundary.js';
import { cacheDomElements } from './ui/dom-cache.js';
import { state, setState, getState } from './store/store.js';
import { builderState } from './store/builder-store.js';
import { extractorState, createExtractorSessionId } from './store/extractor-store.js';
import { createMergerController } from './ui/merger.js';
import { createStatsController } from './ui/stats.js';
import { createModalController } from './ui/modals.js';
import { createSettingsController } from './ui/settings.js';
import { createBackgroundProgressController } from './ui/progress.js';
import { createBuilderController } from './ui/builder.js';
import { createExtractorController } from './ui/extractor.js';
import { createDiscoveryController } from './ui/discovery.js';
import { createSearchUIController } from './ui/search-ui.js';
import { createEventController } from './ui/events.js';
import { formatBytes, formatMs } from './utils/formatters.js';
import { tabSync } from './core/tab-sync.js';

// DOM Elements cache
let elements = {};

// --- Controller Initializations ---

const mergerController = createMergerController({
  getElements: () => elements,
  t,
  showError,
  showSuccess,
  escapeHtml
});

const statsController = createStatsController({
  getElements: () => elements,
  db,
  showInfo,
  formatBytes,
  formatMs,
  escapeHtml,
  formatLanguageDisplay
});

const modalController = createModalController({
  getElements: () => elements
});

const progressController = createBackgroundProgressController({
  getElements: () => elements,
  state,
  db,
  t,
  formatMs,
  formatLanguageDisplay,
  updateLabelCount: () => updateLabelCount()
});

const settingsController = createSettingsController({
  getElements: () => elements,
  state,
  db,
  t,
  showInfo,
  showSuccess,
  showError,
  searchService,
  setDisplayLocale,
  setLanguage,
  updateInterfaceText,
  applyBuilderDirectSaveVisualState: (...args) => builderController.applyBuilderDirectSaveVisualState(...args),
  handleSearch: (...args) => searchUIController.handleSearch(...args),
  saveDisplaySettingsToDb: () => saveDisplaySettingsToDb()
});

const builderController = createBuilderController({
  getElements: () => elements,
  state,
  builderState,
  db,
  fileAccess,
  closeToolsModal: () => mergerController.closeToolsModal(),
  t,
  showSuccess,
  showError,
  showInfo,
  escapeHtml,
  saveDisplaySettingsToDb: () => saveDisplaySettingsToDb(),
  saveAiSettingsToDb: () => settingsController.saveAiSettingsToDb(),
  isAiReadyAndEnabled: () => state.ai.enabled && state.ai.status === 'ready',
  FLAGS,
  withFeatureError,
  ManagedWorker
});

const extractorController = createExtractorController({
  getElements: () => elements,
  state,
  builderState,
  extractorState,
  createExtractorSessionId,
  db,
  fileAccess,
  closeToolsModal: () => mergerController.closeToolsModal(),
  t,
  showSuccess,
  showError,
  showInfo,
  escapeHtml,
  escapeAttr,
  isAiReadyAndEnabled: () => state.ai.enabled && state.ai.status === 'ready',
  addLabelToBuilder: (...args) => builderController.addLabelToBuilder(...args)
});

const discoveryController = createDiscoveryController({
  getElements: () => elements,
  state,
  setState,
  getState,
  t,
  showInfo,
  showError,
  showOnboarding,
  hideSplash,
  getLanguageFlag,
  formatLanguageDisplay,
  buildPriorityLanguages,
  pickAvailablePriorityLanguages,
  escapeHtml,
  escapeAttr,
  modalController,
  stopRealtimeStreaming: () => stopRealtimeStreaming(),
  hideBackgroundProgressIndicator: () => progressController.hideBackgroundProgressIndicator(),
  renderBackgroundSummary: () => progressController.renderBackgroundSummary(),
  showLiveIndexLine: () => progressController.showLiveIndexLine(),
  hideLiveIndexLine: () => progressController.hideLiveIndexLine(),
  updateLiveIndexLine: (p) => progressController.updateLiveIndexLine(p),
  progressController,
  fileAccess,
  db,
  searchService,
  showMainInterface: (lastIndexed) => showMainInterface(lastIndexed),
  emitIndexingCompleteSync,
  renderFilterPills: () => searchUIController.renderFilterPills(),
  updateLabelCount,
  updateLastIndexedDisplay,
  scheduleStreamingSearchRefresh: () => scheduleStreamingSearchRefresh()
});

const searchUIController = createSearchUIController({
  getElements: () => elements,
  state,
  searchService,
  t,
  showError,
  highlight,
  escapeHtml,
  escapeAttr,
  getLanguageFlag,
  formatLanguageDisplay,
  showInfo,
  saveFiltersToDb,
  closeAdvancedSearchModal: () => modalController.closeAdvancedSearchModal(),
  getLanguageAggregateStatus: (culture) => progressController.getLanguageAggregateStatus(culture),
  showLabelDetailsModal: (...args) => searchUIController.showLabelDetailsModal(...args),
  addLabelToBuilder: (...args) => builderController.addLabelToBuilder(...args),
  handleCopyId: (fullId) => copyToClipboard(fullId).then(s => s ? showSuccess(`Copied: ${fullId}`) : showError('Failed to copy')),
  handleCopyText: (text) => copyToClipboard(text).then(s => s ? showSuccess('Text copied') : showError('Failed to copy'))
});

const eventController = createEventController({
  getElements: () => elements,
  state,
  builderState,
  debounce,
  copyToClipboard,
  showSuccess,
  t,
  handleSelectFolder: (...args) => discoveryController.handleSelectFolder(...args),
  handleChangeFolder: (...args) => discoveryController.handleChangeFolder(...args),
  handleToggleSelection: (...args) => discoveryController.handleToggleSelection(...args),
  openLanguageFilterModal: (...args) => discoveryController.openLanguageFilterModal(...args),
  handleStartIndexing: (...args) => discoveryController.handleStartIndexing(...args),
  handleCancelRescan: (...args) => discoveryController.handleCancelRescan(...args),
  openAdvancedSelectionModal: (...args) => discoveryController.openAdvancedSelectionModal(...args),
  closeAdvancedSelectionModal: (...args) => discoveryController.closeAdvancedSelectionModal(...args),
  handleQuickStart: (...args) => discoveryController.handleQuickStart(...args),
  closeLanguageFilterModal: (...args) => discoveryController.closeLanguageFilterModal(...args),
  toggleAllLanguagesFilter: (...args) => discoveryController.toggleAllLanguagesFilter(...args),
  applyLanguageFilter: (...args) => discoveryController.applyLanguageFilter(...args),
  renderLanguageFilterList: (...args) => discoveryController.renderLanguageFilterList(...args),
  handleRescan: (...args) => discoveryController.handleRescan(...args),
  openShortcutsModal: () => modalController.openShortcutsModal(),
  openStatsDashboardModal: () => statsController.openStatsDashboardModal(),
  openBackgroundProgressModal: () => progressController.openBackgroundProgressModal(),
  closeBackgroundProgressModal: () => progressController.closeBackgroundProgressModal(),
  closeStatsDashboardModal: () => statsController.closeStatsDashboardModal(),
  handleSearch: (...args) => searchUIController.handleSearch(...args),
  scheduleLikelyPrefetch: searchService.scheduleLikelyPrefetch,
  saveSortPreferenceToDb,
  openAdvancedSearchModal: () => openAdvancedSearchModal(),
  openSystemSettingsModal: () => settingsController.openSystemSettingsModal(),
  closeAdvancedSearchModal: () => modalController.closeAdvancedSearchModal(),
  closeSystemSettingsModal: () => settingsController.closeSystemSettingsModal(),
  applyFilters: (...args) => searchUIController.applyFilters(...args),
  applySystemSettings: (...args) => settingsController.applySystemSettings(...args),
  clearAllFilters: (...args) => searchUIController.clearAllFilters(...args),
  startAiModelDownload: (...args) => settingsController.startAiModelDownload(...args),
  clearAiCache: (...args) => settingsController.clearAiCache(...args),
  updateAiSettingsUI: (...args) => settingsController.updateAiSettingsUI(...args),
  saveAiSettingsToDb: (...args) => settingsController.saveAiSettingsToDb(...args),
  openItemSelectorModal: (...args) => searchUIController.openItemSelectorModal(...args),
  closeItemSelectorModal: (...args) => searchUIController.closeItemSelectorModal(...args),
  toggleAllInSelectorModal: (...args) => searchUIController.toggleAllInSelectorModal(...args),
  renderItemSelectorModal: (...args) => searchUIController.renderItemSelectorModal(...args),
  closeLabelDetailsModal: () => searchUIController.closeLabelDetailsModal(),
  closeShortcutsModal: () => modalController.closeShortcutsModal(),
  openToolsModal: () => mergerController.openToolsModal(),
  closeToolsModal: () => mergerController.closeToolsModal(),
  openMergerModal: () => mergerController.openMergerModal(),
  openExtractorWorkspace: (...args) => extractorController.openExtractorWorkspace(...args),
  closeMergerModal: () => mergerController.closeMergerModal(),
  handleMergerSelectFiles: (...args) => mergerController.handleMergerSelectFiles(...args),
  handleMergerClearFiles: (...args) => mergerController.handleMergerClearFiles(...args),
  handleMergerBack: (...args) => mergerController.handleMergerBack(...args),
  handleMergerMerge: (...args) => mergerController.handleMergerMerge(...args),
  handleMergerDownload: (...args) => mergerController.handleMergerDownload(...args),
  setupMergerDropzone: (...args) => mergerController.setupMergerDropzone(...args),
  openBuilderModal: (...args) => builderController.openBuilderModal(...args),
  closeBuilderModal: (...args) => builderController.closeBuilderModal(...args),
  openNewLabelModal: (...args) => builderController.openNewLabelModal(...args),
  handleBuilderClear: (...args) => builderController.handleBuilderClear(...args),
  handleBuilderFinish: (...args) => builderController.handleBuilderFinish(...args),
  openExportModal: (...args) => builderController.openExportModal(...args),
  handleBuilderAutoTranslate: (...args) => builderController.handleBuilderAutoTranslate(...args),
  switchBuilderTab: (...args) => builderController.switchBuilderTab(...args),
  closeNewLabelModal: (...args) => builderController.closeNewLabelModal(...args),
  handleSaveNewLabel: (...args) => builderController.handleSaveNewLabel(...args),
  closeConflictModal: (...args) => builderController.closeConflictModal(...args),
  resolveConflict: (...args) => builderController.resolveConflict(...args),
  openManualConflictEditor: (...args) => builderController.openManualConflictEditor(...args),
  closeExportModal: (...args) => builderController.closeExportModal(...args),
  handleExportGenerate: (...args) => builderController.handleExportGenerate(...args),
  closeExtractorWorkspace: (...args) => extractorController.closeExtractorWorkspace(...args),
  handleExtractorSelectProject: (...args) => extractorController.handleExtractorSelectProject(...args),
  handleExtractorSelectFiles: (...args) => extractorController.handleExtractorSelectFiles(...args),
  handleExtractorStartScan: (...args) => extractorController.handleExtractorStartScan(...args),
  handleExtractorAddAllToBuilder: (...args) => extractorController.handleExtractorAddAllToBuilder(...args),
  handleExtractorApplyChanges: (...args) => extractorController.handleExtractorApplyChanges(...args),
  handleExtractorRollback: (...args) => extractorController.handleExtractorRollback(...args),
  handleScroll: (...args) => searchUIController.handleScroll(...args),
  handleResize: (...args) => searchUIController.handleResize(...args),
  setupModalFilterListeners: (...args) => searchUIController.setupModalFilterListeners(...args),
  setupSelectionListeners: (...args) => discoveryController.setupSelectionListeners(...args),
  removeBuilderItem: (...args) => builderController.removeBuilderItem(...args),
  undoBuilderChange: (...args) => builderController.undoBuilderChange(...args),
  handleUndoSelection: (...args) => discoveryController.handleUndoSelection(...args),
  updateKeyboardSelection: (...args) => searchUIController.updateKeyboardSelection(...args),
  showLabelDetailsModal: (...args) => searchUIController.showLabelDetailsModal(...args),
  addLabelToBuilder: (...args) => builderController.addLabelToBuilder(...args)
});

// --- Orchestration Logic ---

let tabSyncInitialized = false;

function setupTabSyncListeners() {
  if (tabSyncInitialized || !FLAGS.USE_TAB_SYNC) return;
  tabSyncInitialized = true;

  tabSync.on('INDEXING_COMPLETE', async ({ totalLabels, timestamp }) => {
    try {
      const freshCount = await db.getLabelCount();
      state.totalLabels = freshCount;
      searchService.setIDBTotalCount(freshCount);
      updateLabelCount();
      updateLastIndexedDisplay(timestamp || Date.now());

      if (state.stage === 'READY' && state.indexingMode === 'idle') {
        showInfo(t('background_indexing_complete') || 'Data updated in another tab.');
      }
    } catch (err) {
      console.warn('Tab sync refresh failed:', err);
    }
  });
}

function emitIndexingCompleteSync(totalLabels, timestamp = Date.now()) {
  if (!FLAGS.USE_TAB_SYNC) return;
  tabSync.emit('INDEXING_COMPLETE', { totalLabels, timestamp });
}

export async function initApp() {
  console.log('🏷️ D365FO Label Explorer initializing...');
  elements = cacheDomElements();
  updateSplashStatus(t('splash_checking_compatibility') || 'Checking compatibility...');
  
  if (!fileAccess.isSupported()) {
    hideSplash();
    elements.btnSelectFolder?.classList.add('hidden');
    elements.browserWarning?.classList.remove('hidden');
    return;
  }
  
  updateSplashStatus(t('splash_initializing_db') || 'Initializing database...');
  try {
    await db.initDB();
    await searchService.initSearch();
    setupTabSyncListeners();
  } catch (err) {
    console.error('❌ Failed to initialize IndexedDB:', err);
    hideSplash();
    showError('Failed to initialize database.');
    return;
  }
  
  const hasExistingData = await db.hasData();
  if (hasExistingData) {
    updateSplashStatus(t('splash_loading_labels') || 'Loading labels...');
    const totalLabels = await db.getLabelCount();
    state.totalLabels = totalLabels;
    searchService.setIDBTotalCount(totalLabels);
    
    const warmStartLanguages = await resolveWarmStartLanguages();
    state.backgroundIndexing.priorityLanguages = warmStartLanguages;
    await searchService.preloadPriorityLanguages(warmStartLanguages);
    
    const lastIndexed = await db.getMetadata('lastIndexed');
    hideSplash();
    await showMainInterface(lastIndexed);
  } else {
    hideSplash();
    showOnboarding();
  }
  
  eventController.setupEventListeners();
}

function updateSplashStatus(message) {
  if (elements.splashStatus) elements.splashStatus.textContent = message;
}

function hideSplash() {
  if (elements.splashScreen) elements.splashScreen.classList.add('hidden');
}

function showOnboarding() {
  setState('stage', 'ONBOARDING');
  elements.onboardingOverlay?.classList.remove('hidden');
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.add('hidden');
}

async function showMainInterface(lastIndexed = null) {
  setState('stage', 'READY');
  updateLabelCount();
  updateLastIndexedDisplay(lastIndexed);
  
  if (state.indexingMode === 'idle') progressController.hideLiveIndexLine();
  else progressController.showLiveIndexLine();
  
  await populateFilters();
  
  await Promise.all([
    loadFiltersFromDb(),
    loadDisplaySettingsFromDb(),
    loadSortPreferenceFromDb(),
    settingsController.loadAiSettingsFromDb()
  ]);
  
  searchUIController.renderFilterPills();
  searchUIController.updateModalSelectionSummaries();
  if (elements.sortSelect) elements.sortSelect.value = state.sortPreference;
  
  searchUIController.calculateVirtualScrollParams();
  elements.onboardingOverlay?.classList.add('hidden');
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.remove('hidden');
  searchUIController.showEmptyState();
  elements.searchInput?.focus();
}

function updateLabelCount() {
  if (elements.labelCountBadge) {
    elements.labelCountBadge.textContent = t('labels_indexed_count', { count: state.totalLabels.toLocaleString() });
  }
}

function updateLastIndexedDisplay(lastIndexed) {
  if (!elements.lastIndexed || !lastIndexed) return;
  const date = new Date(lastIndexed);
  elements.lastIndexed.textContent = t('last_indexed', { date: date.toLocaleString() });
}

async function populateFilters() {
  if (state.ui.isPopulatingFilters) return;
  if (state.ui.catalogCache) {
    state.availableFilters.cultures = state.ui.catalogCache.cultures;
    state.availableFilters.models = state.ui.catalogCache.models;
    searchUIController.renderModalFilters();
    return;
  }
  state.ui.isPopulatingFilters = true;
  try {
    const catalog = await db.getCatalog();
    let cultures = [...new Set(catalog.map(entry => entry.culture).filter(Boolean))].sort();
    let models = [...new Set(catalog.map(entry => entry.model).filter(Boolean))].sort();
    state.ui.catalogCache = { cultures, models };
    state.availableFilters.cultures = cultures;
    state.availableFilters.models = models;
    searchUIController.renderModalFilters();
  } finally {
    state.ui.isPopulatingFilters = false;
  }
}

function openAdvancedSearchModal() {
  searchUIController.renderModalFilters();
  modalController.openAdvancedSearchModal();
}

async function saveFiltersToDb() {
  await db.saveMetadata('filters', state.filters);
}

async function loadFiltersFromDb() {
  const saved = await db.getMetadata('filters');
  if (saved) {
    state.filters = { ...state.filters, ...saved };
    searchUIController.normalizeFilterState();
  }
}

async function saveDisplaySettingsToDb() {
  await db.saveMetadata('displaySettings', state.displaySettings);
}

async function loadDisplaySettingsFromDb() {
  const saved = await db.getMetadata('displaySettings');
  if (saved) {
    state.displaySettings = { ...state.displaySettings, ...saved };
    if (state.displaySettings.uiLanguage === 'auto') setDisplayLocale(null);
    else setDisplayLocale(state.displaySettings.uiLanguage);
    setLanguage(state.displaySettings.uiLanguage);
    updateInterfaceText();
    builderController.applyBuilderDirectSaveVisualState();
  }
}

async function saveSortPreferenceToDb() {
  await db.saveMetadata('sortPreference', state.sortPreference);
}

async function loadSortPreferenceFromDb() {
  const saved = await db.getMetadata('sortPreference');
  if (saved) state.sortPreference = saved;
}

async function resolveWarmStartLanguages() {
  try {
    const catalog = await db.getCatalog();
    const available = [...new Set(catalog.map(e => e.culture).filter(Boolean))];
    const selected = pickAvailablePriorityLanguages(available, navigator.language, 3);
    return selected.length ? selected : buildPriorityLanguages().slice(0, 3);
  } catch {
    return buildPriorityLanguages().slice(0, 3);
  }
}

function stopRealtimeStreaming() {
  state.realtimeStreaming.enabled = false;
  if (state.realtimeStreaming.uiRefreshTimer) {
    clearTimeout(state.realtimeStreaming.uiRefreshTimer);
    state.realtimeStreaming.uiRefreshTimer = null;
  }
}

function scheduleStreamingSearchRefresh() {
  if (state.realtimeStreaming.pendingUiRefresh) return;
  state.realtimeStreaming.pendingUiRefresh = true;
  state.realtimeStreaming.uiRefreshTimer = setTimeout(() => {
    state.realtimeStreaming.pendingUiRefresh = false;
    if (state.stage === 'READY' && state.currentQuery.trim()) searchUIController.handleSearch();
  }, 500);
}
