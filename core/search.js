/**
 * Search Service for D365FO Label Explorer
 * Uses FlexSearch for fast indexing and searching
 */

// FlexSearch is loaded globally via script tag
const FlexSearch = window.FlexSearch;

// FlexSearch index instance
let searchIndex = null;

// All labels data (for filtering)
let labelsData = [];

/**
 * Initialize the search index
 */
export function initSearch() {
  searchIndex = new FlexSearch.Document({
    document: {
      id: 'id',
      index: ['searchTarget'],
      store: true
    },
    tokenize: 'forward',
    resolution: 9,
    cache: true
  });
  
  labelsData = [];
}

/**
 * Add labels to the search index
 * @param {Array<Object>} labels 
 */
export function indexLabels(labels) {
  if (!searchIndex) {
    initSearch();
  }

  labels.forEach(label => {
    const doc = {
      ...label,
      searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
    };
    searchIndex.add(doc);
    labelsData.push(label);
  });
}

/**
 * Index all labels from array (append to existing)
 * @param {Array<Object>} labels 
 */
export function indexAll(labels) {
  if (!searchIndex) {
    initSearch();
  }
  
  labels.forEach(label => {
    const doc = {
      ...label,
      searchTarget: `${label.labelId} ${label.text} ${label.help || ''} ${label.fullId}`
    };
    searchIndex.add(doc);
    labelsData.push(label);
  });
}

/**
 * Search for labels
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array<Object>} - Matching labels
 */
export function search(query, options = {}) {
  if (!searchIndex || !query || query.trim() === '') {
    return applyFilters(labelsData, options);
  }

  const { exactMatch = false, culture, model, limit = 1000 } = options;

  // Perform search
  let results;
  
  if (exactMatch) {
    // Exact match - filter by exact text or ID match
    results = labelsData.filter(label => {
      const lowerQuery = query.toLowerCase();
      return (
        label.text.toLowerCase().includes(lowerQuery) ||
        label.fullId.toLowerCase().includes(lowerQuery) ||
        label.labelId.toLowerCase().includes(lowerQuery) ||
        (label.help && label.help.toLowerCase().includes(lowerQuery))
      );
    });
  } else {
    // Fuzzy search using FlexSearch
    const searchResults = searchIndex.search(query, {
      limit,
      enrich: true
    });

    // Collect unique IDs from all field results
    const idSet = new Set();
    const matchedLabels = [];

    searchResults.forEach(fieldResult => {
      if (fieldResult.result) {
        fieldResult.result.forEach(item => {
          if (!idSet.has(item.id)) {
            idSet.add(item.id);
            matchedLabels.push(item.doc);
          }
        });
      }
    });

    results = matchedLabels;
  }

  // Apply filters
  return applyFilters(results, options);
}

/**
 * Apply culture and model filters
 * @param {Array<Object>} labels 
 * @param {Object} options 
 * @returns {Array<Object>}
 */
function applyFilters(labels, options) {
  const { culture, model } = options;
  
  let filtered = labels;

  if (culture) {
    filtered = filtered.filter(l => l.culture === culture);
  }

  if (model) {
    filtered = filtered.filter(l => l.model === model);
  }

  return filtered;
}

/**
 * Get all labels (filtered)
 * @param {Object} options 
 * @returns {Array<Object>}
 */
export function getAllLabels(options = {}) {
  return applyFilters(labelsData, options);
}

/**
 * Get search stats
 * @returns {Object}
 */
export function getStats() {
  return {
    totalDocuments: labelsData.length,
    cultures: [...new Set(labelsData.map(l => l.culture))],
    models: [...new Set(labelsData.map(l => l.model))]
  };
}

/**
 * Clear the search index
 */
export function clearSearch() {
  if (searchIndex) {
    searchIndex = null;
  }
  labelsData = [];
}

/**
 * Check if search is ready
 * @returns {boolean}
 */
export function isReady() {
  return searchIndex !== null && labelsData.length > 0;
}

export { searchIndex, labelsData };
