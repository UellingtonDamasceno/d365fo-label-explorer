import { buildPriorityLanguages } from '../utils/languages.js';

const _state = {
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
    models: [], // Multiple models
    exactMatch: false,
    useBloomFilter: true, // SPEC-42: Fast-fail toggle
    requiredCultures: [],
    hideIncomplete: false
  },
  displaySettings: {
    labelFormat: 'full', // 'full', 'simple', 'hybrid'
    groupDuplicates: true,
    uiLanguage: 'auto',
    builderDirectSaveMode: false,
    suppressRepeatedDownloadPrompt: false
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
  // SPEC-42: Pagination State for Incremental Search
  searchPagination: {
    isLoading: false,
    hasMore: true,
    offset: 0,
    limit: 500 // Chunk size
  },
  virtualScroll: {
    itemHeight: 160, // Calculated dynamically from CSS var(--card-height) + gap
    bufferSize: 5,
    scrollTop: 0,
    visibleCount: 0
  },
  keyboardNav: {
    selectedIndex: -1 // Currently selected card index for keyboard navigation
  },
  // UI Loading states
  ui: {
    isPopulatingFilters: false,
    modalListenersAttached: false,
    selectionListenersAttached: false,
    catalogCache: null // SPEC-42: Memory cache for fast modal opening
  },
  // Background processes tracking
  backgroundTasks: [], // Array of { id, type, name, status, progress, message }
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
    lastMessage: '',
    semanticIdSuggestion: false,
    autoTranslateOnDiscovery: false,
    sourceLanguage: 'auto',
    targetLanguage: 'en-US',
    worker: null
  }
};

const _listeners = new Map();

function notifyPath(path) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (parts.length === 0) return;

  for (let i = parts.length; i > 0; i -= 1) {
    const topic = parts.slice(0, i).join('.');
    const callbacks = _listeners.get(topic);
    if (!callbacks || callbacks.size === 0) continue;
    const value = getState(topic);
    callbacks.forEach((callback) => callback(value));
  }
}

export const state = _state;

export function getState(path) {
  if (!path) return _state;
  return String(path).split('.').reduce((acc, key) => acc?.[key], _state);
}

export function setState(path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (keys.length === 0) return;

  let target = _state;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
      target[keys[i]] = {};
    }
    target = target[keys[i]];
  }

  target[keys[keys.length - 1]] = value;
  notifyPath(path);
}

export function updateState(path, updater) {
  const current = getState(path);
  setState(path, updater(current));
}

export function subscribe(path, callback) {
  const topic = String(path || '').trim();
  if (!topic) {
    return () => {};
  }

  if (!_listeners.has(topic)) {
    _listeners.set(topic, new Set());
  }
  _listeners.get(topic).add(callback);

  return () => {
    const topicListeners = _listeners.get(topic);
    topicListeners?.delete(callback);
    if (topicListeners?.size === 0) {
      _listeners.delete(topic);
    }
  };
}
