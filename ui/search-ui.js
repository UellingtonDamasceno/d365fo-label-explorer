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

export function createSearchUIController({
  getElements,
  state,
  highlight,
  escapeHtml,
  escapeAttr,
  getLanguageFlag,
  formatLanguageDisplay,
  showInfo,
  saveFiltersToDb,
  invalidateSearchCache,
  handleSearch,
  closeAdvancedSearchModal,
  getLanguageAggregateStatus,
  showLabelDetailsModal,
  addLabelToBuilder,
  handleCopyId,
  handleCopyText
}) {
  const elements = createElementsProxy(getElements);

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

  function renderModalFilters() {
    // Exact match
    if (elements.modalExactMatch) {
      elements.modalExactMatch.checked = !!state.filters.exactMatch;
    }
    if (elements.modalUseBloomFilter) {
      elements.modalUseBloomFilter.checked = !!state.filters.useBloomFilter;
    }
    if (elements.modalHideIncomplete) {
      elements.modalHideIncomplete.checked = state.filters.hideIncomplete;
    }

    updateModalSelectionSummaries();
  }

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
        invalidateSearchCache?.();
        handleSearch();
      });
    });
  }

  function normalizeFilterState() {
    state.filters.models = [...new Set(state.filters.models || [])];
    state.filters.cultures = [...new Set(state.filters.cultures || [])];
    state.filters.requiredCultures = [...new Set(state.filters.requiredCultures || [])];
  }

  function showEmptyState() {
    elements.emptyState?.classList.remove('hidden');
    elements.loadingState?.classList.add('hidden');
    elements.resultsInner.innerHTML = '';
    elements.resultsInner.style.height = '0';
    updateResultsToolbarVisibility(false);
  }

  function showLoading() {
    elements.emptyState?.classList.add('hidden');
    elements.loadingState?.classList.remove('hidden');
    updateResultsToolbarVisibility(false);
  }

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

  function calculateVirtualScrollParams() {
    const viewportHeight = elements.resultsViewport?.clientHeight || 600;
    
    // Get computed CSS variables for accurate height calculation
    const rootStyles = getComputedStyle(document.documentElement);
    const cardHeight = parseFloat(rootStyles.getPropertyValue('--card-height')) || 9.375; // rem
    const cardGap = parseFloat(rootStyles.getPropertyValue('--card-gap')) || 0.625; // rem
    const fontSize = parseFloat(rootStyles.fontSize) || 16; // px
    
    // Convert rem to px
    let calculatedHeight = Math.ceil((cardHeight + cardGap) * fontSize);
    
    // BUG-39: Fallback for invalid values - minimum 100px, maximum 300px
    if (!calculatedHeight || calculatedHeight <= 0 || isNaN(calculatedHeight)) {
      calculatedHeight = 150; // Safe fallback
    }
    calculatedHeight = Math.max(100, Math.min(300, calculatedHeight));
    
    state.virtualScroll.itemHeight = calculatedHeight;
    
    // BUG-39: Ensure visibleCount is reasonable (max 50 items at once)
    const rawVisibleCount = Math.ceil(viewportHeight / state.virtualScroll.itemHeight) + 
      (state.virtualScroll.bufferSize * 2);
    state.virtualScroll.visibleCount = Math.min(50, Math.max(5, rawVisibleCount));
  }

  function handleScroll() {
    state.virtualScroll.scrollTop = elements.resultsViewport.scrollTop;
    
    // Check if we need to load more results (infinite scroll)
    if (state.searchPagination.hasMore && !state.searchPagination.isLoading) {
      const scrollHeight = elements.resultsViewport.scrollHeight;
      const clientHeight = elements.resultsViewport.clientHeight;
      
      // If we are within 2 screens of the bottom, load more
      if (scrollHeight - state.virtualScroll.scrollTop - clientHeight < clientHeight * 2) {
        handleSearch(true);
      }
    }
    
    renderVirtualScroll();
  }

  function handleResize() {
    calculateVirtualScrollParams();
    renderVirtualScroll();
  }

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

  function setupModalFilterListeners() {
    // Exact match toggle
    elements.modalExactMatch?.addEventListener('change', (e) => {
      state.filters.exactMatch = e.target.checked;
    });

    // SPEC-42: Bloom Filter toggle
    elements.modalUseBloomFilter?.addEventListener('change', (e) => {
      state.filters.useBloomFilter = e.target.checked;
    });

    // Compliance toggle
    elements.modalHideIncomplete?.addEventListener('change', (e) => {
      state.filters.hideIncomplete = e.target.checked;
    });
  }

  function applyFilters() {
    // Save search filters to DB and refresh
    normalizeFilterState();
    saveFiltersToDb();
    renderFilterPills();
    
    // Close modal
    closeAdvancedSearchModal();
    
    // Trigger search with new settings
    invalidateSearchCache?.();
    handleSearch();
    
    showInfo('Advanced search filters applied');
  }

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
    invalidateSearchCache?.();
    handleSearch();
    
    showInfo('All filters cleared');
  }

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

  function closeItemSelectorModal() {
    elements.itemSelectorModal?.classList.add('hidden');
    updateModalSelectionSummaries();
    commitFilterChangesAndSearch();
  }

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

  function commitFilterChangesAndSearch() {
    normalizeFilterState();
    saveFiltersToDb();
    renderFilterPills();
    invalidateSearchCache?.();
    handleSearch();
  }

  return {
    updateKeyboardSelection,
    renderModalFilters,
    updateModalSelectionSummaries,
    renderFilterPills,
    normalizeFilterState,
    showEmptyState,
    showLoading,
    showNoResults,
    updateResultsToolbarVisibility,
    calculateVirtualScrollParams,
    handleScroll,
    handleResize,
    renderVirtualScroll,
    renderLabelCard,
    setupModalFilterListeners,
    applyFilters,
    clearAllFilters,
    openItemSelectorModal,
    closeItemSelectorModal,
    renderItemSelectorModal,
    toggleAllInSelectorModal,
    commitFilterChangesAndSearch
  };
}
