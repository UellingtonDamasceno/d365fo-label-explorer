/**
 * D365FO Label Explorer - Main Application
 * Entry point and application orchestration
 */

import * as db from './core/db.js';
import * as fileAccess from './core/file-access.js';
import * as searchService from './core/search.js';
import { debounce } from './utils/debounce.js';
import { highlight, escapeHtml } from './utils/highlight.js';
import { copyToClipboard } from './utils/clipboard.js';
import { showSuccess, showError, showInfo } from './utils/toast.js';
import { getLanguageFlag, formatLanguageDisplay, setDisplayLocale, buildPriorityLanguages, pickAvailablePriorityLanguages } from './utils/languages.js';
import { setLanguage, t, updateInterfaceText, getCurrentLanguage } from './utils/translations.js';
import { FLAGS } from './utils/flags.js';
import { withFeatureError, ManagedWorker } from './utils/error-boundary.js';
import { cacheDomElements } from './ui/dom-cache.js';
import { state, getState, setState } from './store/store.js';
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
import { tabSync } from './core/tab-sync.js';

// DOM Elements cache
let elements = {};
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
const settingsController = createSettingsController({
  getElements: () => elements,
  state,
  searchService,
  loadDisplaySettingsFromDb,
  loadAiSettingsFromDb,
  updateAiSettingsUI
});
const progressController = createBackgroundProgressController({
  getElements: () => elements,
  state,
  db,
  t,
  formatMs,
  formatLanguageDisplay,
  updateLabelCount,
  hideLiveIndexLine,
  updateLiveIndexLine
});
const builderController = createBuilderController({
  getElements: () => elements,
  state,
  builderState,
  db,
  fileAccess,
  closeToolsModal,
  t,
  showSuccess,
  showError,
  showInfo,
  escapeHtml,
  saveDisplaySettingsToDb,
  saveAiSettingsToDb,
  isAiReadyAndEnabled,
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
  closeToolsModal,
  t,
  showSuccess,
  showError,
  showInfo,
  escapeHtml,
  escapeAttr,
  isAiReadyAndEnabled,
  addLabelToBuilder
});
const discoveryController = createDiscoveryController({
  getElements: () => elements,
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
});
const searchUIController = createSearchUIController({
  getElements: () => elements,
  state,
  highlight,
  escapeHtml,
  escapeAttr,
  getLanguageFlag,
  formatLanguageDisplay,
  showInfo,
  saveFiltersToDb,
  invalidateSearchCache: searchService.invalidateSearchCache,
  handleSearch,
  closeAdvancedSearchModal,
  getLanguageAggregateStatus,
  showLabelDetailsModal,
  addLabelToBuilder,
  handleCopyId,
  handleCopyText
});
const eventController = createEventController({
  getElements: () => elements,
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
  scheduleLikelyPrefetch: searchService.scheduleLikelyPrefetch,
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
});

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
        showInfo(
          t('background_indexing_complete')
            || `Data updated in another tab (${(totalLabels || freshCount).toLocaleString()} labels).`
        );
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

/**
 * Initialize the application
 */
export async function initApp() {
  console.log('🏷️ D365FO Label Explorer initializing...');
  
  // Cache DOM elements
  elements = cacheDomElements();
  
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
    setupTabSyncListeners();
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
    searchService.setIDBTotalCount(totalLabels);
    
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
 * Setup event listeners
 */
function setupEventListeners(...args) {
  return eventController.setupEventListeners(...args);
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(...args) {
  return eventController.handleKeyboardShortcuts(...args);
}

/**
 * Update keyboard selection visual feedback
 */
function updateKeyboardSelection(...args) {
  return searchUIController.updateKeyboardSelection(...args);
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
  setState('stage', 'ONBOARDING');
  elements.onboardingOverlay?.classList.remove('hidden');
  elements.discoveryDashboard?.classList.add('hidden');
  elements.app?.classList.add('hidden');
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
    searchService.invalidateSearchCache();
    await searchService.clearWarmStartCache();
    await db.clearLabels();
    await db.clearCatalog();
    searchService.clearSearch();
    if (elements.scanStatus) {
      elements.scanStatus.textContent = 'Preparing new scan...';
    }
    
    // Save new handle
    setState('directoryHandle', newHandle);
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
  setState('stage', 'DISCOVERING');
  
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
    setState('discoveryData', await fileAccess.discoverLabelFiles(
      state.directoryHandle,
      (progress) => {
        elements.scanStatus.textContent = 
          `Scanning... Found ${progress.foundModels} models (${progress.scannedDirs} directories scanned)`;
      }
    ));
    
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
function showDiscoveryDashboard(...args) {
  return discoveryController.showDiscoveryDashboard(...args);
}

/**
 * SPEC-23: Render priority language chips in Quick Start panel
 */
function renderPriorityLanguageChips(...args) {
  return discoveryController.renderPriorityLanguageChips(...args);
}

function openAdvancedSelectionModal(...args) {
  return discoveryController.openAdvancedSelectionModal(...args);
}

function closeAdvancedSelectionModal(...args) {
  return discoveryController.closeAdvancedSelectionModal(...args);
}

/**
 * Open language filter modal for multi-select
 */
function openLanguageFilterModal(...args) {
  return discoveryController.openLanguageFilterModal(...args);
}

/**
 * Close language filter modal
 */
function closeLanguageFilterModal(...args) {
  return discoveryController.closeLanguageFilterModal(...args);
}

/**
 * Render the language filter list with search
 */
function renderLanguageFilterList(...args) {
  return discoveryController.renderLanguageFilterList(...args);
}

/**
 * Toggle all languages in filter
 */
function toggleAllLanguagesFilter(...args) {
  return discoveryController.toggleAllLanguagesFilter(...args);
}

/**
 * Update the toggle all languages button text
 */
function updateToggleAllLanguagesButton(...args) {
  return discoveryController.updateToggleAllLanguagesButton(...args);
}

/**
 * Update the language filter count badge
 */
function updateLanguageFilterCount(...args) {
  return discoveryController.updateLanguageFilterCount(...args);
}

/**
 * Apply language filter - keep only selected languages
 */
function applyLanguageFilter(...args) {
  return discoveryController.applyLanguageFilter(...args);
}

/**
 * Render models list with selection checkboxes
 */
function renderModelsListWithSelection(...args) {
  return discoveryController.renderModelsListWithSelection(...args);
}

/**
 * Build selected discovery data based on selection state
 */
function getSelectedDiscoveryData(...args) {
  return discoveryController.getSelectedDiscoveryData(...args);
}

/**
 * Setup selection event listeners
 */
/**
 * Setup selection event listeners using Event Delegation
 * SPEC-42: Improved performance by avoiding thousands of listeners
 */
function setupSelectionListeners(...args) {
  return discoveryController.setupSelectionListeners(...args);
}

/**
 * Update language checkboxes for a model
 */
function updateLanguageCheckboxes(...args) {
  return discoveryController.updateLanguageCheckboxes(...args);
}

/**
 * Update model checkbox state based on language selections
 */
function updateModelCheckbox(...args) {
  return discoveryController.updateModelCheckbox(...args);
}

/**
 * Update selection info display
 */
function updateSelectionInfo(...args) {
  return discoveryController.updateSelectionInfo(...args);
}

/**
 * Check if all items are selected
 */
function areAllSelected(...args) {
  return discoveryController.areAllSelected(...args);
}

/**
 * Update toggle selection button label based on current state
 */
function updateToggleSelectionButton(...args) {
  return discoveryController.updateToggleSelectionButton(...args);
}

/**
 * Handle toggle selection (smart button: Select All / Deselect All)
 */
function handleToggleSelection(...args) {
  return discoveryController.handleToggleSelection(...args);
}

/**
 * Handle cancel re-scan (return to main interface without changes)
 */
function handleCancelRescan(...args) {
  return discoveryController.handleCancelRescan(...args);
}

/**
 * Save selection history for undo
 */
function saveSelectionHistory(...args) {
  return discoveryController.saveSelectionHistory(...args);
}

/**
 * Handle Undo Selection (Ctrl+Z)
 */
function handleUndoSelection(...args) {
  return discoveryController.handleUndoSelection(...args);
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
  
  // SPEC-42: Set initial filters to priority languages so the first search is fast (RAM-based)
  state.filters.cultures = [...priorityLangs];
  renderFilterPills();

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
    
    const worker = new Worker(
      new URL('./workers/indexer.worker.js', import.meta.url)
    );
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
        streamLimit: streamLimitPerWorker,
        dbName: db.DB_NAME,
        dbVersion: db.DB_VERSION
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
  searchService.setIDBTotalCount(state.totalLabels);
  
  return { totalLabels, processedFiles, errors };
}

/**
 * Handle start indexing - TURBO INGESTION (SPEC-16)
 * Uses parallel workers and batch processing for high performance
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
      new URL('./workers/indexer.worker.js', import.meta.url)
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

          case 'DB_ERROR':
            if (e.data?.isQuota) {
              showError('Browser storage is full. Part of the indexed data was not saved.');
            } else {
              console.error('Worker DB error:', e.data?.error, `(${e.data?.labelsLost || 0} labels lost)`);
            }
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
        files: workerFiles,
        dbName: db.DB_NAME,
        dbVersion: db.DB_VERSION
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
  searchService.setIDBTotalCount(totalLabels);
  setState('previousStage', null);
  
  const elapsedFinal = ((performance.now() - startTime) / 1000).toFixed(1);
  console.log(`✅ Full indexing pipeline complete: ${totalLabels} labels in ${elapsedFinal}s`);
  
  // Show main interface
  await showMainInterface(indexedAt);
  searchService.invalidateSearchCache();
  emitIndexingCompleteSync(totalLabels, indexedAt);
  
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
        if (onProgress) {
          onProgress(totalIndexed);
        } else if (elements.indexingStatus) {
          elements.indexingStatus.textContent = `${t('building_index')} (${totalIndexed.toLocaleString()})`;
        }
        console.log(`📊 Search index built: ${totalIndexed} labels indexed`);
        resolve(totalIndexed);
        return;
      }

      chunk.push(cursor.value);
      if (chunk.length >= CHUNK_SIZE) {
        searchService.indexAll(chunk);
        totalIndexed += chunk.length;
        chunk = [];

        if (onProgress) {
          onProgress(totalIndexed);
        } else if (elements.indexingStatus) {
          elements.indexingStatus.textContent = `${t('building_index')} (${totalIndexed.toLocaleString()})`;
        }
      }

      cursor.continue();
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Build search index with splash screen updates
 * Same as buildSearchIndexStreaming but updates splash instead of indexingStatus
 */
async function buildSearchIndexStreamingWithSplash() {
  return buildSearchIndexStreaming((totalIndexed) => {
    updateSplashStatus(`Building search index (${totalIndexed.toLocaleString()} indexed)...`);
  });
}

/**
 * Handle rescan
 */
async function handleRescan() {
  // BUG-24: Silent Re-scan - Don't block UI with Dashboard
  const wasReady = state.stage === 'READY';
  setState('previousStage', getState('stage'));
  
  // Check if we have a saved handle
  const savedHandle = await db.getSavedDirectoryHandle();
  
  if (savedHandle) {
    // Request permission - this also requires user gesture but returns boolean
    const hasPermission = await fileAccess.requestPermission(savedHandle);
    
    if (hasPermission) {
      setState('directoryHandle', savedHandle);
      
      // BUG-24: If we were in READY state, do silent re-scan
      if (wasReady) {
        await startSilentRescan();
      } else {
        await startDiscovery();
      }
      return;
    }
  }
  
  // Need to reselect folder - but we need user gesture
  // Show message and let user click the button again
  showInfo(t('toast_select_folder'));
  showOnboarding();
}

/**
 * BUG-24: Generic parallel indexing with worker pool
 * Handles priority and background indexing with task transformation and state updates
 */
async function startParallelIndexing(files, isPriority = false) {
  if (files.length === 0) return { totalLabels: 0, processedFiles: 0 };
  
  // Transform files to fileTasks structure expected by indexFilesWithWorkers
  // Input: { model, culture, file: { handle, prefix, name } }
  const fileTasks = files.map(f => ({
    handle: f.file.handle,
    metadata: {
      model: f.model,
      culture: f.culture,
      prefix: f.file.prefix,
      sourcePath: `${f.model}/${f.culture}/${f.file.name}`
    }
  }));

  // Use core indexing logic (SPEC-23)
  const result = await indexFilesWithWorkers(fileTasks, isPriority);
  
  // Update status for each model/culture pair in this task set
  const entryKeys = new Set(fileTasks.map(f => `${f.metadata.model}|||${f.metadata.culture}`));
  for (const key of entryKeys) {
    const entry = state.backgroundIndexing.languageStatus.get(key);
    if (entry) {
      entry.status = 'ready';
      entry.processedFiles = entry.fileCount;
      // Persist status to catalog store
      await db.updateCatalogStatus(key, 'ready', entry.labelCount);
    }
  }
  
  // Final state sync
  state.totalLabels = await db.getLabelCount();
  searchService.setIDBTotalCount(state.totalLabels);
  searchService.invalidateSearchCache();
  updateLabelCount();
  const now = Date.now();
  await db.setMetadata('lastIndexed', now);
  updateLastIndexedDisplay(now);
  emitIndexingCompleteSync(state.totalLabels, now);
  
  // Refresh UI if needed
  if (!isPriority) {
    renderBackgroundSummary();
    renderBackgroundLanguageList();
  }
  
  return result;
}

/**
 * BUG-24: Silent Re-scan - Update files in background without blocking UI
 */
async function startSilentRescan() {
  console.log('🔄 Starting silent re-scan...');
  
  // Show toast indicating re-scan started
  showInfo(t('toast_rescan_background') || 'Re-scanning folder in background...');
  
  // Keep UI in READY state while we scan in background
  setState('stage', 'READY');
  
  try {
    // Discover label files in background
    const newDiscoveryData = await fileAccess.discoverLabelFiles(
      state.directoryHandle,
      () => {} // No UI updates during silent scan
    );
    
    if (newDiscoveryData.length === 0) {
      showError(t('error_no_labels'));
      return;
    }
    
    // Update discovery data
    setState('discoveryData', newDiscoveryData);
    
    // Get current priority languages from FlexSearch
    const currentCultures = await searchService.getIndexedCultures();
    const priorityCultures = currentCultures.length > 0 
      ? currentCultures 
      : ['en-US', 'pt-BR', 'pt-PT', 'es-CO'];
    
    // SPEC-42: Automatically set filters to priority cultures to avoid global DB scan during ingestion
    state.filters.cultures = [...priorityCultures];
    renderFilterPills();
    
    // Build file list for priority cultures only
    const priorityFiles = [];
    for (const model of newDiscoveryData) {
      for (const culture of model.cultures) {
        if (priorityCultures.includes(culture.culture)) {
          for (const file of culture.files) {
            priorityFiles.push({
              model: model.model,
              culture: culture.culture,
              file
            });
          }
        }
      }
    }
    
    if (priorityFiles.length > 0) {
      console.log(`📦 Re-indexing ${priorityFiles.length} files for priority cultures: ${priorityCultures.join(', ')}`);
      
      // Clear existing labels and re-index
      searchService.invalidateSearchCache();
      await searchService.clearWarmStartCache();
      await db.clearLabels(); // Clear old data
      await searchService.clearSearch(); // Clear FlexSearch indices
      
      // Re-index priority languages using quick start approach
      state.indexingMode = 'background';
      state.backgroundIndexing.baseLabelCount = 0;
      state.backgroundIndexing.processedFiles = 0;
      state.backgroundIndexing.totalLabels = 0;
      state.backgroundIndexing.startTime = performance.now();
      showBackgroundProgressIndicator();
      
      // Initialize background status for all cultures being re-scanned
      for (const model of newDiscoveryData) {
        for (const culture of model.cultures) {
          const isPriority = priorityCultures.includes(culture.culture);
          const key = `${model.model}|||${culture.culture}`;
          state.backgroundIndexing.languageStatus.set(key, {
            key,
            model: model.model,
            culture: culture.culture,
            fileCount: culture.files.length,
            processedFiles: 0,
            labelCount: 0,
            status: 'waiting',
            isPriority,
            startedAt: null,
            endedAt: null,
            durationMs: 0
          });
        }
      }
      
      // Calculate non-priority languages for queueing
      const backgroundFiles = [];
      for (const model of newDiscoveryData) {
        for (const culture of model.cultures) {
          if (!priorityCultures.includes(culture.culture)) {
            for (const file of culture.files) {
              backgroundFiles.push({
                model: model.model,
                culture: culture.culture,
                file
              });
            }
          }
        }
      }
      
      // Total files for progress bar denominator
      state.backgroundIndexing.totalFiles = priorityFiles.length + backgroundFiles.length;
      
      // Start parallel indexing
      await startParallelIndexing(priorityFiles, true);
      
      // Show success after priority indexing is done
      showSuccess(t('toast_rescan_complete') || 'Re-scan complete');

      if (backgroundFiles.length > 0) {
        console.log(`📦 Queuing ${backgroundFiles.length} files for background indexing`);
        // Start background indexing after priority is done
        setTimeout(async () => {
          if (state.indexingMode !== 'background') {
            state.indexingMode = 'background';
            showBackgroundProgressIndicator();
          }
          await startParallelIndexing(backgroundFiles, false);

          // Finalize state after all background tasks are done
          state.indexingMode = 'idle';
          hideBackgroundProgressIndicator();

          // SPEC-42: Reconstruct Global Bloom Filter after rescan finishes
          await searchService.refreshGlobalBloomFilter();

          console.log('✅ All background indexing tasks completed.');
          }, 100);
          } else {
          // No background files, we are done
          state.indexingMode = 'idle';
          hideBackgroundProgressIndicator();

          // SPEC-42: Reconstruct Global Bloom Filter
          await searchService.refreshGlobalBloomFilter();
          }    }
  } catch (err) {
    console.error('Silent re-scan error:', err);
    showError(t('error_rescan_failed') || 'Re-scan failed');
  }
}

/**
 * Load existing data
 */
async function loadExistingData() {
  console.log('📦 Loading existing data (streaming)...');
  
  // Get total count without loading all labels
  const totalLabels = await db.getLabelCount();
  state.totalLabels = totalLabels;
  searchService.setIDBTotalCount(totalLabels);
  
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
    // BUG-39: Always show static total count, never progress
    // Progress is shown separately in btn-background-progress
    elements.labelCountBadge.textContent = t('labels_indexed_count', { count: state.totalLabels.toLocaleString() });
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
  setState('stage', 'READY');
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
  if (state.ui.isPopulatingFilters) return;
  
  // SPEC-42: Use memory cache if available to avoid DB IO during indexing
  if (state.ui.catalogCache) {
    state.availableFilters.cultures = state.ui.catalogCache.cultures;
    state.availableFilters.models = state.ui.catalogCache.models;
    renderModalFilters();
    return;
  }

  state.ui.isPopulatingFilters = true;

  try {
    console.log('📂 Populating filters from database...');
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

    // SPEC-42: Update memory cache
    state.ui.catalogCache = { cultures, models };
    state.availableFilters.cultures = cultures;
    state.availableFilters.models = models;

    // Render modal filters
    renderModalFilters();
  } catch (err) {
    console.error('Error populating filters:', err);
  } finally {
    state.ui.isPopulatingFilters = false;
  }
}
/**
 * Render filters in the modal
 */
function renderModalFilters(...args) {
  return searchUIController.renderModalFilters(...args);
}

/**
 * Update text summaries in advanced search modal
 */
function updateModalSelectionSummaries(...args) {
  return searchUIController.updateModalSelectionSummaries(...args);
}

/**
 * Render active filter pills
 */
function renderFilterPills(...args) {
  return searchUIController.renderFilterPills(...args);
}

/**
 * Normalize filters to arrays with unique values
 */
function normalizeFilterState(...args) {
  return searchUIController.normalizeFilterState(...args);
}

/**
 * Handle search - SPEC-19 Hybrid Search (async)
 * SPEC-42: Incremental Loading Support
 */
async function handleSearch(isLoadMore = false) {
  if (state.searchPagination.isLoading) return;
  if (isLoadMore && !state.searchPagination.hasMore) return;

  const query = state.currentQuery.trim();
  
  if (!isLoadMore) {
    normalizeFilterState();
    state.searchPagination.offset = 0;
    state.searchPagination.hasMore = true;
    state.results = [];
    state.groupedResults = [];
    // Reset virtual scroll top if it's a new search
    if (elements.resultsViewport) elements.resultsViewport.scrollTop = 0;
  }

  state.searchPagination.isLoading = true;

  try {
    // Show loading
    if (query && !isLoadMore) {
      showLoading();
    }
    
    // Perform search with new filter structure
    const startTime = performance.now();
    
    // Build filter options - support multiple cultures/models
    const filterOptions = {
      exactMatch: state.filters.exactMatch,
      useBloomFilter: state.filters.useBloomFilter,
      limit: state.searchPagination.limit,
      offset: state.searchPagination.offset,
      // SPEC-42: Pass array of filters to engine
      cultures: [...state.filters.cultures],
      models: [...state.filters.models]
    };

    if (query.length >= 2 && searchService.getStats().totalIndexed === 0 && state.indexingMode !== 'idle') {
      await searchService.preloadModelsByName(query, 3);
    }
    
    // If specific filters are selected, apply them
    let newResults = await searchService.search(query, filterOptions);
    
    // Apply multi-select filters manually
    if (state.filters.cultures.length > 0) {
      newResults = newResults.filter(l => state.filters.cultures.includes(l.culture));
    }
    if (state.filters.models.length > 0) {
      newResults = newResults.filter(l => state.filters.models.includes(l.model));
    }
    
    if (newResults.length < state.searchPagination.limit) {
      state.searchPagination.hasMore = false;
    }
    state.searchPagination.offset += state.searchPagination.limit;
    
    // Append new results
    state.results = isLoadMore ? [...state.results, ...newResults] : newResults;
    
    const searchTime = performance.now() - startTime;
    console.log(`🔍 Search "${query}" returned ${newResults.length} new results in ${searchTime.toFixed(2)}ms`);
    
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
  } catch (err) {
    console.error('❌ Search failed:', err);
    showError(t('toast_search_error') || 'Search failed');
  } finally {
    state.searchPagination.isLoading = false;
  }

  // Update UI
  const totalCountText = state.groupedResults.length.toLocaleString() + (state.searchPagination.hasMore ? '+' : '');
  elements.resultsCount.textContent = totalCountText;
  if (query) {
    const pendingCount = state.groupedResults.filter(g => g.compliance && !g.compliance.isComplete).length;
    elements.searchInfo.textContent =
      state.filters.requiredCultures.length > 0
        ? `Found ${totalCountText} labels (${pendingCount} with missing translations)`
        : `Found ${totalCountText} unique labels`;
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
function showEmptyState(...args) {
  return searchUIController.showEmptyState(...args);
}

/**
 * Show loading state
 */
function showLoading(...args) {
  return searchUIController.showLoading(...args);
}

/**
 * Show no results state
 */
function showNoResults(...args) {
  return searchUIController.showNoResults(...args);
}

function updateResultsToolbarVisibility(...args) {
  return searchUIController.updateResultsToolbarVisibility(...args);
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
function calculateVirtualScrollParams(...args) {
  return searchUIController.calculateVirtualScrollParams(...args);
}

/**
 * Handle scroll event
 * SPEC-42: Infinite Scroll Trigger
 */
function handleScroll(...args) {
  return searchUIController.handleScroll(...args);
}

/**
 * Handle window resize
 */
function handleResize(...args) {
  return searchUIController.handleResize(...args);
}

/**
 * Render virtual scroll
 */
function renderVirtualScroll(...args) {
  return searchUIController.renderVirtualScroll(...args);
}

/**
 * Render a label card
 */
function renderLabelCard(...args) {
  return searchUIController.renderLabelCard(...args);
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
  modalController.openAdvancedSearchModal();
}

/**
 * Close advanced search modal
 */
function closeAdvancedSearchModal() {
  modalController.closeAdvancedSearchModal();
}

/**
 * Open system settings modal
 */
function openSystemSettingsModal() {
  settingsController.openSystemSettingsModal();
}

/**
 * Close system settings modal
 */
function closeSystemSettingsModal() {
  settingsController.closeSystemSettingsModal();
}

/**
 * Open shortcuts help modal
 */
function openShortcutsModal() {
  modalController.openShortcutsModal();
}

/**
 * Close shortcuts help modal
 */
function closeShortcutsModal() {
  modalController.closeShortcutsModal();
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
  return statsController.openStatsDashboardModal();
}

function closeStatsDashboardModal() {
  statsController.closeStatsDashboardModal();
}

// ============================================
// SPEC-36: Tools Menu & Label File Merger
// ============================================

function openToolsModal() {
  mergerController.openToolsModal();
}

function closeToolsModal() {
  mergerController.closeToolsModal();
}

function openMergerModal() {
  mergerController.openMergerModal();
}

function closeMergerModal() {
  mergerController.closeMergerModal();
}

function setupMergerDropzone() {
  mergerController.setupMergerDropzone();
}

async function handleMergerSelectFiles(e) {
  return mergerController.handleMergerSelectFiles(e);
}

function handleMergerClearFiles() {
  mergerController.handleMergerClearFiles();
}

function handleMergerBack() {
  mergerController.handleMergerBack();
}

async function handleMergerMerge() {
  return mergerController.handleMergerMerge();
}

function handleMergerDownload() {
  mergerController.handleMergerDownload();
}

// ============================================
// SPEC-32: Label Builder IDE
// ============================================

function applyBuilderDirectSaveVisualState(...args) {
  return builderController.applyBuilderDirectSaveVisualState(...args);
}

function markBuilderDirty(...args) {
  return builderController.markBuilderDirty(...args);
}

function cloneBuilderLabels(...args) {
  return builderController.cloneBuilderLabels(...args);
}

function pushBuilderHistorySnapshot(...args) {
  return builderController.pushBuilderHistorySnapshot(...args);
}

async function restoreBuilderSnapshot(...args) {
  return builderController.restoreBuilderSnapshot(...args);
}

async function undoBuilderChange(...args) {
  return builderController.undoBuilderChange(...args);
}

function openBuilderModal(...args) {
  return builderController.openBuilderModal(...args);
}

function closeBuilderModal(...args) {
  return builderController.closeBuilderModal(...args);
}

function switchBuilderTab(...args) {
  return builderController.switchBuilderTab(...args);
}

async function renderBuilderHistory(...args) {
  return builderController.renderBuilderHistory(...args);
}

async function restoreBuilderSession(...args) {
  return builderController.restoreBuilderSession(...args);
}

async function loadBuilderWorkspace(...args) {
  return builderController.loadBuilderWorkspace(...args);
}

function renderBuilderItems(...args) {
  return builderController.renderBuilderItems(...args);
}

function updateBuilderFooter(...args) {
  return builderController.updateBuilderFooter(...args);
}

async function addLabelToBuilder(...args) {
  return builderController.addLabelToBuilder(...args);
}

async function removeBuilderItem(...args) {
  return builderController.removeBuilderItem(...args);
}

function editBuilderItem(...args) {
  return builderController.editBuilderItem(...args);
}

function openNewLabelModal(...args) {
  return builderController.openNewLabelModal(...args);
}

function closeNewLabelModal(...args) {
  return builderController.closeNewLabelModal(...args);
}

async function handleSaveNewLabel(...args) {
  return builderController.handleSaveNewLabel(...args);
}

function openConflictModal(...args) {
  return builderController.openConflictModal(...args);
}

function openManualConflictEditor(...args) {
  return builderController.openManualConflictEditor(...args);
}

function closeConflictModal(...args) {
  return builderController.closeConflictModal(...args);
}

async function resolveConflict(...args) {
  return builderController.resolveConflict(...args);
}

async function handleBuilderClear(...args) {
  return builderController.handleBuilderClear(...args);
}

async function handleBuilderFinish(...args) {
  return builderController.handleBuilderFinish(...args);
}

async function handleBuilderDownload(...args) {
  return builderController.handleBuilderDownload(...args);
}

function triggerFileDownload(...args) {
  return builderController.triggerFileDownload(...args);
}

function openExportModal(...args) {
  return builderController.openExportModal(...args);
}

function closeExportModal(...args) {
  return builderController.closeExportModal(...args);
}

function setupExportLanguageCheckboxes(...args) {
  return builderController.setupExportLanguageCheckboxes(...args);
}

function getSelectedExportLanguages(...args) {
  return builderController.getSelectedExportLanguages(...args);
}

function updateExportProgress(...args) {
  return builderController.updateExportProgress(...args);
}

async function handleExportGenerate(...args) {
  return builderController.handleExportGenerate(...args);
}

function updateBackgroundTasksHeader(...args) {
  return builderController.updateBackgroundTasksHeader(...args);
}

function parseCultureInputList(...args) {
  return builderController.parseCultureInputList(...args);
}

function buildExportGroups(...args) {
  return builderController.buildExportGroups(...args);
}

function buildDownloadSignature(...args) {
  return builderController.buildDownloadSignature(...args);
}

async function buildExportLabelsWithOptionalTranslations(...args) {
  return builderController.buildExportLabelsWithOptionalTranslations(...args);
}

function normalizeLabelLineValue(...args) {
  return builderController.normalizeLabelLineValue(...args);
}

function buildLabelFileContent(...args) {
  return builderController.buildLabelFileContent(...args);
}

function inferSourceModel(...args) {
  return builderController.inferSourceModel(...args);
}

function parseLabelFileContent(...args) {
  return builderController.parseLabelFileContent(...args);
}

function groupBuilderLabelsByTarget(...args) {
  return builderController.groupBuilderLabelsByTarget(...args);
}

function findDirectSaveTargets(...args) {
  return builderController.findDirectSaveTargets(...args);
}

async function createDirectSaveTarget(...args) {
  return builderController.createDirectSaveTarget(...args);
}

async function resolveDirectSaveTarget(...args) {
  return builderController.resolveDirectSaveTarget(...args);
}

async function handleBuilderDirectSave(...args) {
  return builderController.handleBuilderDirectSave(...args);
}

function getBuilderTargetLanguages(...args) {
  return builderController.getBuilderTargetLanguages(...args);
}

function setAiTranslationHeaderStatus(...args) {
  return builderController.setAiTranslationHeaderStatus(...args);
}

function updateBuilderTranslateProgress(...args) {
  return builderController.updateBuilderTranslateProgress(...args);
}

function toWorkerLang(...args) {
  return builderController.toWorkerLang(...args);
}

function resetTranslatorState(...args) {
  return builderController.resetTranslatorState(...args);
}

function getManagedTranslatorWorker(...args) {
  return builderController.getManagedTranslatorWorker(...args);
}

function ensureTranslatorWorker(...args) {
  return builderController.ensureTranslatorWorker(...args);
}

function initializeTranslatorWorker(...args) {
  return builderController.initializeTranslatorWorker(...args);
}

function requestTranslations(...args) {
  return builderController.requestTranslations(...args);
}

async function applyTranslatedLabel(...args) {
  return builderController.applyTranslatedLabel(...args);
}

async function handleBuilderAutoTranslate(...args) {
  return builderController.handleBuilderAutoTranslate(...args);
}

// ============================================
// SPEC-34: Hardcoded String Extractor
// ============================================

function openExtractorWorkspace(...args) {
  return extractorController.openExtractorWorkspace(...args);
}

function closeExtractorWorkspace(...args) {
  return extractorController.closeExtractorWorkspace(...args);
}

function updateExtractorStatusBadge(...args) {
  return extractorController.updateExtractorStatusBadge(...args);
}

function renderExtractorFileTree(...args) {
  return extractorController.renderExtractorFileTree(...args);
}

function renderExtractorSummary(...args) {
  return extractorController.renderExtractorSummary(...args);
}

function updateExtractorProgress(...args) {
  return extractorController.updateExtractorProgress(...args);
}

function normalizeFsPath(...args) {
  return extractorController.normalizeFsPath(...args);
}

function parseRnrprojManifest(...args) {
  return extractorController.parseRnrprojManifest(...args);
}

async function resolveFileFromRoot(...args) {
  return extractorController.resolveFileFromRoot(...args);
}

async function resolveFileFromCandidates(...args) {
  return extractorController.resolveFileFromCandidates(...args);
}

async function loadProjectFirstFiles(...args) {
  return extractorController.loadProjectFirstFiles(...args);
}

function detectSemanticSourceLanguage(...args) {
  return extractorController.detectSemanticSourceLanguage(...args);
}

function toSemanticLabelId(...args) {
  return extractorController.toSemanticLabelId(...args);
}

function derivePrefixFromModelName(...args) {
  return extractorController.derivePrefixFromModelName(...args);
}

async function translateExtractorTextsForIds(...args) {
  return extractorController.translateExtractorTextsForIds(...args);
}

async function handleExtractorSelectFiles(...args) {
  return extractorController.handleExtractorSelectFiles(...args);
}

async function buildSuggestedIds(...args) {
  return extractorController.buildSuggestedIds(...args);
}

function renderExtractorResults(...args) {
  return extractorController.renderExtractorResults(...args);
}

async function confirmExtractorCandidate(...args) {
  return extractorController.confirmExtractorCandidate(...args);
}

function useExistingExtractorCandidate(...args) {
  return extractorController.useExistingExtractorCandidate(...args);
}

function ignoreExtractorCandidate(...args) {
  return extractorController.ignoreExtractorCandidate(...args);
}

async function handleExtractorAddAllToBuilder(...args) {
  return extractorController.handleExtractorAddAllToBuilder(...args);
}

function ensureExtractorWorker(...args) {
  return extractorController.ensureExtractorWorker(...args);
}

async function handleExtractorStartScan(...args) {
  return extractorController.handleExtractorStartScan(...args);
}

async function handleExtractorSelectProject(...args) {
  return extractorController.handleExtractorSelectProject(...args);
}

async function loadProjectFilesFromManifest(...args) {
  return extractorController.loadProjectFilesFromManifest(...args);
}

async function saveExtractorSession(...args) {
  return extractorController.saveExtractorSession(...args);
}

async function tryAutoResumeExtractorSession(...args) {
  return extractorController.tryAutoResumeExtractorSession(...args);
}

async function handleExtractorApplyChanges(...args) {
  return extractorController.handleExtractorApplyChanges(...args);
}

async function handleExtractorRollback(...args) {
  return extractorController.handleExtractorRollback(...args);
}

async function resolveFileHandle(...args) {
  return extractorController.resolveFileHandle(...args);
}

function escapeRegExp(...args) {
  return extractorController.escapeRegExp(...args);
}

async function handleExtractorSaveSession(...args) {
  return extractorController.handleExtractorSaveSession(...args);
}

async function handleExtractorResumeLastSession(...args) {
  return extractorController.handleExtractorResumeLastSession(...args);
}

// ============================================
// SPEC-23: Background Indexing Functions
// ============================================

/**
 * Show background progress indicator in header
 */
function showBackgroundProgressIndicator() {
  progressController.showBackgroundProgressIndicator();
}

/**
 * Hide background progress indicator
 */
function hideBackgroundProgressIndicator() {
  progressController.hideBackgroundProgressIndicator();
}

/**
 * Update background progress in header button
 */
function updateBackgroundProgress(processedFiles, totalFiles, totalLabels) {
  progressController.updateBackgroundProgress(processedFiles, totalFiles, totalLabels);
}

function mergeBackgroundPairProgress(pairProgress, statusOverride = null) {
  progressController.mergeBackgroundPairProgress(pairProgress, statusOverride);
}

function queueCatalogProgressFlush() {
  progressController.queueCatalogProgressFlush();
}

/**
 * Open background progress modal
 */
function openBackgroundProgressModal() {
  progressController.openBackgroundProgressModal();
}

/**
 * Close background progress modal
 */
function closeBackgroundProgressModal() {
  progressController.closeBackgroundProgressModal();
}

function flushCatalogProgressNow() {
  return progressController.flushCatalogProgressNow();
}

function scheduleBackgroundProgressUIUpdate() {
  progressController.scheduleBackgroundProgressUIUpdate();
}

function renderBackgroundSummary() {
  progressController.renderBackgroundSummary();
}

/**
 * Render language status list in progress modal
 * SPEC-38: Groups by culture to reduce DOM nodes from 8000+ to ~40
 */
function renderBackgroundLanguageList() {
  progressController.renderBackgroundLanguageList();
}

function getLanguageAggregateStatus(culture) {
  return progressController.getLanguageAggregateStatus(culture);
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
      searchService.setIDBTotalCount(finalLabelCount);
      
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
      
      // SPEC-42: Reconstruct Global Bloom Filter after indexing completes
      await searchService.refreshGlobalBloomFilter();
      
      // Refresh label count
      state.totalLabels = finalLabelCount;
      searchService.invalidateSearchCache();
      updateLabelCount();
      const completedAt = Date.now();
      await db.setMetadata('lastIndexed', completedAt);
      updateLastIndexedDisplay(completedAt);
      emitIndexingCompleteSync(finalLabelCount, completedAt);
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

/**
 * Update the AI download progress in the header (sticky indicator)
 */
function updateHeaderAiDownloadProgress() {
  if (!elements.btnAiDownloadStatus || !elements.aiDownloadStatusText) return;

  const isDownloading = state.ai.status === 'downloading';
  elements.btnAiDownloadStatus.classList.toggle('hidden', !isDownloading);

  if (isDownloading) {
    const text = state.ai.lastMessage 
      ? `${state.ai.lastMessage}`
      : `AI Download: ${Math.round(state.ai.progress)}%`;
    elements.aiDownloadStatusText.textContent = text;
  }
}

function updateAiSettingsUI() {
  const enabled = state.ai.enabled;
  const unlocked = enabled && state.ai.status === 'ready';
  const downloading = state.ai.status === 'downloading';

  // Sync UI elements with state
  if (elements.settingAiEnabled) elements.settingAiEnabled.checked = enabled;
  if (elements.settingAiSemanticId) elements.settingAiSemanticId.checked = state.ai.semanticIdSuggestion;
  if (elements.settingAiAutoTranslate) elements.settingAiAutoTranslate.checked = state.ai.autoTranslateOnDiscovery;
  if (elements.settingAiSourceLanguage) elements.settingAiSourceLanguage.value = state.ai.sourceLanguage;
  if (elements.settingAiTargetLanguage) elements.settingAiTargetLanguage.value = state.ai.targetLanguage;

  updateAiStatusBadge();

  if (elements.aiDownloadFill) {
    elements.aiDownloadFill.style.width = `${Math.max(0, Math.min(100, state.ai.progress))}%`;
  }
  if (elements.aiDownloadLabel) {
    const phaseKey = state.ai.progressPhase === 'indexing' ? 'ai_phase_indexing' : 'ai_phase_downloading';
    let label = state.ai.status === 'ready'
      ? t('ai_progress_ready')
      : `${t(phaseKey)} ${Math.round(state.ai.progress)}%`;

    if (state.ai.status === 'downloading' && state.ai.lastMessage) {
      label = state.ai.lastMessage;
    }

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

    let validStatus = 'inactive';
    if (aiStatus === 'ready' || aiStatus === 'downloading' || aiStatus === 'inactive') {
      validStatus = aiStatus;
    }

    state.ai.status = validStatus === 'downloading' ? 'inactive' : validStatus;
    state.ai.progress = state.ai.status === 'ready' ? 100 : 0;
    state.ai.progressPhase = state.ai.status === 'ready' ? 'indexing' : 'downloading';
    state.ai.enabled = !!aiSettings?.enabled;
    state.ai.semanticIdSuggestion = !!aiSettings?.semanticIdSuggestion;
    state.ai.autoTranslateOnDiscovery = !!aiSettings?.autoTranslateOnDiscovery;
    state.ai.sourceLanguage = aiSettings?.sourceLanguage || 'auto';
    state.ai.targetLanguage = aiSettings?.targetLanguage || 'en-US';

    if (validStatus === 'downloading') {
      await db.setMetadata('aiStatus', 'inactive');
    }
    
    updateAiSettingsUI();
  } catch (err) {
    console.error('Failed to load AI settings:', err);
    state.ai.status = 'inactive';
    state.ai.progress = 0;
    updateAiSettingsUI();
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
      state.ai.lastMessage = payload?.message || '';
      updateAiSettingsUI();
      updateHeaderAiDownloadProgress();
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
function setupModalFilterListeners(...args) {
  return searchUIController.setupModalFilterListeners(...args);
}

/**
 * Apply filters from modal
 */
function applyFilters(...args) {
  return searchUIController.applyFilters(...args);
}

/**
 * Clear all filters
 */
function clearAllFilters(...args) {
  return searchUIController.clearAllFilters(...args);
}

/**
 * Open generic selector modal for models/languages/required languages
 */
function openItemSelectorModal(...args) {
  return searchUIController.openItemSelectorModal(...args);
}

/**
 * Close generic selector modal
 */
function closeItemSelectorModal(...args) {
  return searchUIController.closeItemSelectorModal(...args);
}

/**
 * Render selector modal list
 * SPEC-23: Added status indicators for languages
 */
function renderItemSelectorModal(...args) {
  return searchUIController.renderItemSelectorModal(...args);
}

/**
 * Toggle all visible items in selector modal
 */
function toggleAllInSelectorModal(...args) {
  return searchUIController.toggleAllInSelectorModal(...args);
}

/**
 * Persist current filter state (including compliance) and refresh UI
 */
function commitFilterChangesAndSearch(...args) {
  return searchUIController.commitFilterChangesAndSearch(...args);
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
        builderDirectSaveMode: !!savedSettings.builderDirectSaveMode,
        suppressRepeatedDownloadPrompt: !!savedSettings.suppressRepeatedDownloadPrompt
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

