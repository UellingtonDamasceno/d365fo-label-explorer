export function createBuilderController({
  getElements,
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
}) {
  const elements = new Proxy({}, {
    get: (_, key) => getElements()?.[key]
  });

  let managedTranslatorWorker = null;

  function applyBuilderDirectSaveVisualState() {
    const modalContent = elements.builderModal?.querySelector('.builder-content');
    const directSaveActive = !!state.displaySettings.builderDirectSaveMode;

    elements.builderDirectSaveWarning?.classList.toggle('hidden', !directSaveActive);
    modalContent?.classList.toggle('direct-save-active', directSaveActive);
  }

  function markBuilderDirty() {
    builderState.isDirty = true;
  }

  function cloneBuilderLabels(labels) {
    return labels.map((item) => ({ ...item }));
  }

  function pushBuilderHistorySnapshot() {
    if (builderState.undoApplying) return;
    builderState.history.push({
      labels: cloneBuilderLabels(builderState.labels),
      selectedLabelId: builderState.selectedLabelId
    });
    if (builderState.history.length > 10) {
      builderState.history.shift();
    }
  }

  async function restoreBuilderSnapshot(snapshot) {
    builderState.undoApplying = true;
    try {
      await db.clearBuilderWorkspace();
      const restored = [];
      for (const label of snapshot.labels || []) {
        const entry = { ...label };
        delete entry.id;
        const id = await db.addBuilderLabel(entry);
        restored.push({ ...entry, id });
      }

      builderState.labels = restored;
      const selectedOriginal = (snapshot.labels || []).find((item) => item.id === snapshot.selectedLabelId);
      if (selectedOriginal) {
        const selectedRestored = restored.find((item) =>
          item.labelId === selectedOriginal.labelId &&
          item.culture === selectedOriginal.culture &&
          item.text === selectedOriginal.text
        );
        builderState.selectedLabelId = selectedRestored?.id || restored[0]?.id || null;
      } else {
        builderState.selectedLabelId = restored[0]?.id || null;
      }

      renderBuilderItems();
      updateBuilderFooter();
    } finally {
      builderState.undoApplying = false;
    }
  }

  async function undoBuilderChange() {
    if (!builderState.history.length) {
      showInfo(t('builder_undo_empty'));
      return;
    }
    try {
      const snapshot = builderState.history.pop();
      await restoreBuilderSnapshot(snapshot);
      markBuilderDirty();
      showSuccess(t('builder_undo_done'));
    } catch (err) {
      console.error('Failed to undo builder change:', err);
      showError(t('builder_update_error'));
    }
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
    switchBuilderTab('workspace'); // SPEC-41: Default to workspace tab
    elements.builderModal?.classList.remove('hidden');
    elements.app?.classList.add('builder-open');
  }

  function closeBuilderModal() {
    elements.builderModal?.classList.add('hidden');
    elements.app?.classList.remove('builder-open');
  }

  /**
   * SPEC-41: Switch between Workspace and History tabs
   */
  function switchBuilderTab(tabName) {
    const tabs = document.querySelectorAll('.builder-tab');
    const contents = document.querySelectorAll('.builder-tab-content');
  
    tabs.forEach(tab => tab.classList.remove('active'));
    contents.forEach(content => content.classList.add('hidden'));
  
    const activeTab = document.getElementById(`tab-${tabName}`);
    const activeContent = document.getElementById(`builder-${tabName}-content`);
  
    if (activeTab) activeTab.classList.add('active');
    if (activeContent) activeContent.classList.remove('hidden');
  
    if (tabName === 'history') {
      renderBuilderHistory();
    }
  }

  /**
   * SPEC-41: Render export history
   */
  async function renderBuilderHistory() {
    const container = document.getElementById('builder-history-list');
    if (!container) return;
  
    try {
      const sessions = await db.getBuilderSessions();
    
      if (!sessions || sessions.length === 0) {
        container.innerHTML = `
          <div class="builder-empty-state">
            <span class="empty-icon">📜</span>
            <p data-i18n="history_empty">${t('history_empty')}</p>
            <p class="hint" data-i18n="history_hint">${t('history_hint')}</p>
          </div>
        `;
        return;
      }
    
      // Sort by timestamp descending (newest first)
      sessions.sort((a, b) => b.timestamp - a.timestamp);
    
      container.innerHTML = sessions.map(session => {
        const date = new Date(session.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
        const statusClass = session.status || 'completed';
        const statusText = session.status === 'processing' ? 'Processing' : 
                          session.status === 'failed' ? 'Failed' : 'Completed';
      
        return `
          <div class="builder-history-item" data-session-id="${session.id}">
            <div class="builder-history-item-header">
              <span class="builder-history-item-title">${session.model || 'Untitled'}</span>
              <span class="builder-history-item-status ${statusClass}">${statusText}</span>
            </div>
            <div class="builder-history-item-info">
              <span>📅 ${dateStr}</span>
              <span>📦 ${session.labelCount || 0} labels</span>
              ${session.targetCultures ? `<span>🌐 ${session.targetCultures.length} cultures</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    
      // Add click handlers to restore sessions
      container.querySelectorAll('.builder-history-item').forEach(item => {
        item.addEventListener('click', () => {
          const sessionId = parseInt(item.dataset.sessionId);
          restoreBuilderSession(sessionId);
        });
      });
    
    } catch (err) {
      console.error('Error loading builder history:', err);
      container.innerHTML = `
        <div class="builder-empty-state">
          <span class="empty-icon">❌</span>
          <p>Error loading history</p>
        </div>
      `;
    }
  }

  /**
   * SPEC-41: Restore a session from history
   */
  async function restoreBuilderSession(sessionId) {
    try {
      const session = await db.getBuilderSession(sessionId);
      if (!session || !session.labels) {
        showError(t('history_restore_error') || 'Failed to restore session');
        return;
      }
    
      // Clear current workspace and load session
      await db.clearBuilderWorkspace();
    
      // Add labels to workspace
      for (const label of session.labels) {
        await db.addBuilderLabel(label);
      }
    
      // Reload workspace
      await loadBuilderWorkspace();
    
      // Switch to workspace tab
      switchBuilderTab('workspace');
    
      showSuccess(t('history_restore_success') || `Restored ${session.labelCount} labels from history`);
    } catch (err) {
      console.error('Error restoring session:', err);
      showError(t('history_restore_error') || 'Failed to restore session');
    }
  }

  async function loadBuilderWorkspace() {
    try {
      builderState.labels = await db.getBuilderLabels();
      builderState.history = [];
      builderState.isDirty = false;
      builderState.lastDownloadedSignature = '';
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
    const sourcePath = String(sourceLabel.fileName || sourceLabel.sourcePath || 'unknown').replace(/^\/+/, '');
    const sourceValue = sourceLabel.model
      ? (sourcePath.startsWith(`${sourceLabel.model}/`) ? sourcePath : `${sourceLabel.model}/${sourcePath}`)
      : 'Search Result';

    // Prepare label for builder
    const newLabel = {
      labelId: sourceLabel.labelId || sourceLabel.fullId?.split(':')[1] || '',
      culture: sourceLabel.culture || elements.builderCultureSelect?.value || 'en-US',
      text: sourceLabel.text || '',
      helpText: sourceLabel.helpText || sourceLabel.help || '',
      prefix: sourceLabel.prefix || sourceLabel.fullId?.split(':')[0]?.replace('@', '') || '',
      source: sourceValue,
      sourceModel: sourceLabel.model || sourceLabel.sourceModel || '',
      sourcePath
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
      pushBuilderHistorySnapshot();
      const id = await db.addBuilderLabel(newLabel);
      newLabel.id = id;
      builderState.labels.push(newLabel);
      builderState.selectedLabelId = id;
      markBuilderDirty();
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
      pushBuilderHistorySnapshot();
      await db.removeBuilderLabel(id);
      builderState.labels = builderState.labels.filter(l => l.id !== id);
      if (builderState.selectedLabelId === id) {
        builderState.selectedLabelId = builderState.labels.length > 0 ? builderState.labels[0].id : null;
      }
      markBuilderDirty();
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
        pushBuilderHistorySnapshot();
        await db.updateBuilderLabel(id, { labelId, text, helpText, prefix });
        const idx = builderState.labels.findIndex(l => l.id === id);
        if (idx !== -1) {
          builderState.labels[idx] = { ...builderState.labels[idx], labelId, text, helpText, prefix };
        }
        markBuilderDirty();
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
        pushBuilderHistorySnapshot();
        const id = await db.addBuilderLabel(newLabel);
        newLabel.id = id;
        builderState.labels.push(newLabel);
        builderState.selectedLabelId = id;
        markBuilderDirty();
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
          pushBuilderHistorySnapshot();
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
          markBuilderDirty();
          showSuccess(t('builder_conflict_overwritten') || 'Label overwritten');
          break;
        
        case 'rename':
          // Add with auto-renamed ID
          pushBuilderHistorySnapshot();
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
          markBuilderDirty();
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
      pushBuilderHistorySnapshot();
      await db.clearBuilderWorkspace();
      builderState.labels = [];
      builderState.selectedLabelId = null;
      markBuilderDirty();
      renderBuilderItems();
      updateBuilderFooter();
      showSuccess(t('builder_cleared') || 'Workspace cleared');
    } catch (err) {
      console.error('Error clearing builder workspace:', err);
      showError(t('builder_clear_error') || 'Failed to clear workspace');
    }
  }

  /**
   * Handle finishing the session (clear workspace)
   */
  async function handleBuilderFinish() {
    await handleBuilderClear();
  }

  async function handleBuilderDownload() {
    try {
      if (builderState.labels.length === 0) {
        showError(t('builder_empty') || 'No labels to download');
        return;
      }

      const baseLabels = [...builderState.labels].sort((a, b) =>
        a.labelId.localeCompare(b.labelId)
      );
      const exportLabels = await buildExportLabelsWithOptionalTranslations(baseLabels);
      if (!exportLabels.length) return;

      const exportGroups = buildExportGroups(exportLabels);
      const downloadSignature = buildDownloadSignature(exportGroups);
      if (
        !builderState.isDirty &&
        downloadSignature &&
        downloadSignature === builderState.lastDownloadedSignature &&
        !state.displaySettings.suppressRepeatedDownloadPrompt
      ) {
        const proceed = confirm(t('builder_download_same_confirm'));
        if (!proceed) return;
        const suppress = confirm(t('builder_download_same_disable_confirm'));
        if (suppress) {
          state.displaySettings.suppressRepeatedDownloadPrompt = true;
          await saveDisplaySettingsToDb();
        }
      }

      const directSaveActive = !!state.displaySettings.builderDirectSaveMode;
      if (directSaveActive) {
        if (builderState.directSaving) return;
        await handleBuilderDirectSave(exportLabels).catch((err) => {
          console.error('Direct Save failed:', err);
          showError(err?.message || t('builder_direct_save_error'));
        });
        builderState.lastDownloadedSignature = downloadSignature;
        builderState.isDirty = false;
        return;
      }

      for (const group of exportGroups) {
        const content = buildLabelFileContent(group.labels);
        triggerFileDownload(content, group.filename);
      }
      builderState.lastDownloadedSignature = downloadSignature;
      builderState.isDirty = false;
      showSuccess(t('builder_download_complete') || `Downloaded ${exportLabels.length} labels`);
    } catch (err) {
      console.error('Builder export failed:', err);
      showError(err?.message || t('builder_direct_save_error'));
    }
  }

  function triggerFileDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'custom.label.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // =============================================
  // Export Modal Functions (Multi-language + ZIP)
  // =============================================

  function openExportModal() {
    if (builderState.labels.length === 0) {
      showError(t('builder_empty') || 'No labels to export');
      return;
    }

    // Get dominant culture from labels
    const cultureCounts = new Map();
    builderState.labels.forEach((label) => {
      const c = label.culture || 'en-US';
      cultureCounts.set(c, (cultureCounts.get(c) || 0) + 1);
    });
    let dominantCulture = 'en-US';
    let maxCount = 0;
    cultureCounts.forEach((count, culture) => {
      if (count > maxCount) {
        maxCount = count;
        dominantCulture = culture;
      }
    });

    // Update modal UI
    if (elements.exportSourceCulture) {
      elements.exportSourceCulture.textContent = dominantCulture;
    }
    if (elements.exportLabelCount) {
      elements.exportLabelCount.textContent = `${builderState.labels.length} labels`;
    }

    // Get prefix from labels or use default
    let prefix = 'Labels';
    const firstLabel = builderState.labels[0];
    if (firstLabel?.prefix) {
      prefix = firstLabel.prefix.replace(/^@/, '');
    }
    if (elements.exportFilePrefix) {
      elements.exportFilePrefix.value = prefix;
    }

    // Setup language checkboxes
    setupExportLanguageCheckboxes(dominantCulture);

    // Show AI warning if not ready
    const aiReady = isAiReadyAndEnabled();
    elements.exportAiWarning?.classList.toggle('hidden', aiReady);

    // Reset progress
    elements.exportProgressSection?.classList.add('hidden');
    if (elements.exportProgressFill) elements.exportProgressFill.style.width = '0%';
    if (elements.exportProgressLabel) elements.exportProgressLabel.textContent = '';

    // Enable generate button
    if (elements.btnExportGenerate) {
      elements.btnExportGenerate.disabled = false;
      elements.btnExportGenerate.innerHTML = '🚀 <span data-i18n="btn_generate_export">Generate & Export</span>';
    }

    elements.exportModal?.classList.remove('hidden');
  }

  function closeExportModal() {
    elements.exportModal?.classList.add('hidden');
  }

  function setupExportLanguageCheckboxes(sourceCulture) {
    const container = elements.exportLanguageCheckboxes;
    if (!container) return;

    const aiReady = isAiReadyAndEnabled();
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');

    checkboxes.forEach((checkbox) => {
      const lang = checkbox.value;
      const isSource = lang.toLowerCase() === sourceCulture.toLowerCase();

      // Source language is always checked and disabled (will always export)
      if (isSource) {
        checkbox.checked = true;
        checkbox.disabled = true;
      } else {
        // Other languages need AI to translate
        checkbox.checked = false;
        checkbox.disabled = !aiReady;
      }
    });
  }

  function getSelectedExportLanguages() {
    const container = elements.exportLanguageCheckboxes;
    if (!container) return [];

    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map((cb) => cb.value);
  }

  function updateExportProgress(progress, message) {
    elements.exportProgressSection?.classList.remove('hidden');
    if (elements.exportProgressFill) {
      elements.exportProgressFill.style.width = `${progress}%`;
    }
    if (elements.exportProgressLabel) {
      elements.exportProgressLabel.textContent = message || `${progress}%`;
    }
  }

  async function handleExportGenerate() {
    if (builderState.labels.length === 0) {
      showError(t('builder_empty') || 'No labels to export');
      return;
    }

    const selectedLanguages = getSelectedExportLanguages();
    if (selectedLanguages.length === 0) {
      showError(t('export_no_languages') || 'Select at least one language');
      return;
    }

    const prefix = elements.exportFilePrefix?.value?.trim() || 'Labels';
    const sourceCulture = elements.exportSourceCulture?.textContent || 'en-US';
  
    // 1. Snapshot the session before clearing workspace
    const taskId = Date.now();
    const sessionSnapshot = {
      id: taskId,
      timestamp: taskId,
      model: prefix,
      labelCount: builderState.labels.length,
      status: 'processing',
      labels: cloneBuilderLabels(builderState.labels),
      targetCultures: selectedLanguages
    };

    // Save to history immediately
    await db.saveBuilderSession(sessionSnapshot);
  
    // 2. Close modal and clear workspace immediately
    closeExportModal();
    await db.clearBuilderWorkspace();
    builderState.labels = [];
    builderState.isDirty = false;
    renderBuilderItems();
    updateBuilderFooter();
  
    showInfo(t('export_started_background') || 'Export started in background. Check the status in the header.');

    // 3. Process in background
    const task = {
      id: taskId,
      type: 'export',
      name: `${prefix} (${selectedLanguages.length} langs)`,
      status: 'processing',
      progress: 5,
      message: t('export_preparing')
    };
  
    state.backgroundTasks.push(task);
    updateBackgroundTasksHeader();

    try {
      // Group existing labels by ID to easily check for translations
      const labelsById = new Map();
      sessionSnapshot.labels.forEach(label => {
        if (!labelsById.has(label.labelId)) {
          labelsById.set(label.labelId, new Map());
        }
        labelsById.get(label.labelId).set(label.culture.toLowerCase(), label);
      });

      const uniqueIds = Array.from(labelsById.keys());
      const allExportLabels = [];
      const jobs = [];
    
      uniqueIds.forEach(labelId => {
        const translations = labelsById.get(labelId);
        const sourceLabel = translations.get(sourceCulture.toLowerCase()) || Array.from(translations.values())[0];
      
        selectedLanguages.forEach(targetCulture => {
          const lowerTarget = targetCulture.toLowerCase();
          if (translations.has(lowerTarget)) {
            allExportLabels.push({ ...translations.get(lowerTarget), prefix });
          } else if (isAiReadyAndEnabled()) {
            jobs.push({
              key: `${labelId}::${sourceLabel.culture}::${targetCulture}`,
              text: sourceLabel.text,
              sourceLanguage: toWorkerLang(sourceLabel.culture),
              targetLanguage: toWorkerLang(targetCulture),
              targetCulture,
              labelId: labelId,
              sourceCulture: sourceLabel.culture
            });
          }
        });
      });

      // Run translations
      if (jobs.length > 0) {
        task.progress = 10;
        task.message = t('export_translating');
        updateBackgroundTasksHeader();
      
        const initResult = await initializeTranslatorWorker();
        if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER && initResult === null && !builderState.translatorReady) {
          throw new Error(t('ai_translation_error'));
        }

        const result = await requestTranslations(jobs, (prog) => {
          task.progress = Math.round(10 + prog * 60);
          updateBackgroundTasksHeader();
        });
        if (!result) {
          throw new Error(t('ai_translation_error'));
        }

        const translatedItems = result?.translations || [];
        for (const item of translatedItems) {
          if (item.translatedText && !item.error) {
            const entry = {
              labelId: item.labelId,
              culture: item.targetCulture,
              text: item.translatedText,
              prefix,
              isAiTranslated: true
            };
            allExportLabels.push(entry);
          
            // SPEC-32 Cache: Save translated label back to main database for future search
            try {
              const addLabelsFn = typeof db.addLabelsWithLock === 'function' ? db.addLabelsWithLock : db.addLabels;
              await addLabelsFn([{
                id: `${prefix}:${item.labelId}:${item.targetCulture}`,
                fullId: `@${prefix}:${item.labelId}`,
                labelId: item.labelId,
                prefix: prefix,
                model: 'User Cache',
                culture: item.targetCulture,
                text: item.translatedText,
                help: '',
                isUserGenerated: true
              }]);
            } catch (e) {}
          }
        }
      }

      task.progress = 80;
      task.message = t('export_generating');
      updateBackgroundTasksHeader();

      // Group and package
      const groups = new Map();
      allExportLabels.forEach(label => {
        if (!groups.has(label.culture)) groups.set(label.culture, []);
        groups.get(label.culture).push(label);
      });

      groups.forEach(labels => labels.sort((a, b) => a.labelId.localeCompare(b.labelId)));

      let zipBlob = null;
      if (groups.size === 1) {
        const [culture, labels] = [...groups.entries()][0];
        const content = buildLabelFileContent(labels);
        zipBlob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      } else {
        const zip = new JSZip();
        groups.forEach((labels, culture) => {
          zip.file(`${prefix}.${culture}.label.txt`, buildLabelFileContent(labels));
        });
        zipBlob = await zip.generateAsync({ type: 'blob' });
      }

      // Update session in DB with the final results
      sessionSnapshot.status = 'completed';
      sessionSnapshot.zipBlob = zipBlob;
      await db.saveBuilderSession(sessionSnapshot);

      task.progress = 100;
      task.status = 'completed';
      task.message = t('export_complete');
      updateBackgroundTasksHeader();
      showSuccess(t('export_success_background', { name: prefix }));

    } catch (err) {
      console.error('Background export failed:', err);
      task.status = 'error';
      task.message = err?.message || 'Export failed';
      updateBackgroundTasksHeader();
    }
  }

  /**
   * Update background tasks header indicator
   */
  function updateBackgroundTasksHeader() {
    if (!elements.btnBackgroundTasks || !elements.backgroundTasksText) return;

    const activeTasks = state.backgroundTasks.filter(t => t.status === 'processing');
    elements.btnBackgroundTasks.classList.toggle('hidden', state.backgroundTasks.length === 0);
  
    if (state.backgroundTasks.length > 0) {
      const completed = state.backgroundTasks.filter(t => t.status === 'completed').length;
      const total = state.backgroundTasks.length;
      // BUG-25.5: Don't add emoji here - it's already in HTML as .btn-icon
      elements.backgroundTasksText.textContent = `${completed}/${total}`;
    
      // If we just finished a task, show a little highlight
      if (activeTasks.length === 0) {
        elements.btnBackgroundTasks.classList.add('tasks-completed');
      } else {
        elements.btnBackgroundTasks.classList.remove('tasks-completed');
      }
    }
  }

  function parseCultureInputList(rawTargets) {
    return [...new Set(
      String(rawTargets || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )];
  }

  function buildExportGroups(labels) {
    const groups = new Map();
    labels.forEach((label) => {
      const prefix = label.prefix || 'custom';
      const culture = label.culture || 'en-US';
      const key = `${prefix}|||${culture}`;
      if (!groups.has(key)) {
        groups.set(key, {
          prefix,
          culture,
          filename: `${prefix}.${culture}.label.txt`,
          labels: []
        });
      }
      groups.get(key).labels.push(label);
    });

    return [...groups.values()].map((group) => ({
      ...group,
      labels: [...group.labels].sort((a, b) => a.labelId.localeCompare(b.labelId))
    }));
  }

  function buildDownloadSignature(groups) {
    if (!Array.isArray(groups) || groups.length === 0) return '';
    const payload = groups.map((group) => ({
      file: group.filename,
      content: buildLabelFileContent(group.labels)
    }));
    return JSON.stringify(payload);
  }

  async function buildExportLabelsWithOptionalTranslations(baseLabels) {
    const shouldTranslate = confirm(t('builder_export_translate_prompt'));
    if (!shouldTranslate) return baseLabels;

    if (!isAiReadyAndEnabled()) {
      showInfo(t('ai_translation_requires_ready'));
      return baseLabels;
    }

    const defaultTargets = state.ai.targetLanguage || 'en-US';
    const requested = prompt(t('builder_export_targets_prompt'), defaultTargets);
    if (requested === null) return baseLabels;

    const targetCultures = parseCultureInputList(requested);
    if (!targetCultures.length) {
      showInfo(t('builder_export_no_targets'));
      return baseLabels;
    }

    const validSourceLabels = baseLabels.filter((label) => label.labelId && label.text && label.culture);
    if (!validSourceLabels.length) {
      showInfo(t('builder_export_no_pairs'));
      return baseLabels;
    }

    const jobs = [];
    validSourceLabels.forEach((label) => {
      targetCultures.forEach((targetCulture) => {
        if (targetCulture !== label.culture) {
          jobs.push({
            key: `${label.id || label.labelId}::${label.culture}::${targetCulture}`,
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

    if (!jobs.length) {
      showInfo(t('builder_export_no_pairs'));
      return baseLabels;
    }

    builderState.translating = true;
    updateBuilderTranslateProgress(0, t('builder_export_translating'));
    setAiTranslationHeaderStatus(true, t('builder_export_translating'));
    try {
      const initResult = await initializeTranslatorWorker();
      if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER && initResult === null && !builderState.translatorReady) {
        throw new Error(t('ai_translation_error'));
      }

      const result = await requestTranslations(jobs);
      if (!result) {
        throw new Error(t('ai_translation_error'));
      }
      const translatedItems = result?.translations || [];
      const sourceByKey = new Map(
        validSourceLabels.map((label) => [`${label.labelId}::${label.culture}`, label])
      );

      const merged = [...baseLabels];
      translatedItems.forEach((item) => {
        const source = sourceByKey.get(`${item.labelId}::${item.sourceCulture}`);
        if (!source || !item.translatedText) return;
        merged.push({
          ...source,
          id: undefined,
          culture: item.targetCulture,
          text: item.translatedText,
          isAiTranslated: true,
          source: `AI Export (${source.culture} -> ${item.targetCulture})`
        });
      });

      const deduped = new Map();
      merged.forEach((label) => {
        const key = `${label.labelId}::${label.culture}`;
        deduped.set(key, label);
      });

      state.ai.targetLanguage = targetCultures[0] || state.ai.targetLanguage;
      await saveAiSettingsToDb();
      showSuccess(t('builder_export_translation_done', { count: translatedItems.length }));
      return [...deduped.values()];
    } catch (err) {
      console.error('Export translation failed:', err);
      showError(err?.message || t('ai_translation_error'));
      return baseLabels;
    } finally {
      builderState.translating = false;
      updateBuilderTranslateProgress(0, t('ai_translation_idle'));
      setAiTranslationHeaderStatus(false, t('ai_translation_idle'));
    }
  }

  function normalizeLabelLineValue(value) {
    return String(value || '')
      .replace(/\r?\n/g, ' ');
  }

  function buildLabelFileContent(labels) {
    const lines = [];
    labels.forEach((label) => {
      lines.push(`${label.labelId}=${normalizeLabelLineValue(label.text)}`);
      if (label.helpText) {
        lines.push(` ;${normalizeLabelLineValue(label.helpText)}`);
      }
    });
    return lines.join('\n');
  }

  function inferSourceModel(label) {
    if (label?.sourceModel) return label.sourceModel;
    const source = String(label?.source || '');
    const parts = source.split('/');
    if (parts.length >= 2 && parts[0] && source !== 'Search Result') {
      return parts[0];
    }
    return '';
  }

  function parseLabelFileContent(content) {
    const entries = [];
    const lines = String(content || '').split(/\r?\n/);
    let current = null;

    for (const rawLine of lines) {
      const line = rawLine ?? '';
      if (!line) continue;

      if (line.startsWith(' ;')) {
        if (current) {
          const helpPart = line.slice(2).trim().replace(/;;/g, ';');
          if (helpPart) {
            current.helpText = current.helpText ? `${current.helpText} ${helpPart}` : helpPart;
          }
        }
        continue;
      }

      const equalsIndex = line.indexOf('=');
      if (equalsIndex > 0 && line.charCodeAt(0) !== 32) {
        if (current) entries.push(current);
        current = {
          labelId: line.slice(0, equalsIndex).trim(),
          text: line.slice(equalsIndex + 1).replace(/;;/g, ';'),
          helpText: ''
        };
        continue;
      }

      if (current) {
        entries.push(current);
        current = null;
      }
    }

    if (current) {
      entries.push(current);
    }

    return entries;
  }

  function groupBuilderLabelsByTarget(labels) {
    const grouped = new Map();
    labels.forEach((label) => {
      const sourceModel = inferSourceModel(label);
      const key = `${label.prefix || ''}|||${label.culture || ''}|||${sourceModel}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          prefix: label.prefix || '',
          culture: label.culture || '',
          sourceModel,
          labels: []
        });
      }
      grouped.get(key).labels.push(label);
    });
    return [...grouped.values()];
  }

  function findDirectSaveTargets(prefix, culture, sourceModel = '') {
    const matches = [];
    state.discoveryData.forEach((model) => {
      if (sourceModel && model.model !== sourceModel) return;
      model.cultures.forEach((cultureEntry) => {
        if (cultureEntry.culture !== culture) return;
        cultureEntry.files.forEach((file) => {
          if (file.prefix === prefix) {
            matches.push({
              model: model.model,
              culture: cultureEntry.culture,
              name: file.name,
              handle: file.handle
            });
          }
        });
      });
    });
    return matches;
  }

  async function createDirectSaveTarget(prefix, culture, sourceModel) {
    if (!sourceModel) return null;
    const modelEntry = state.discoveryData.find((model) => model.model === sourceModel);
    if (!modelEntry?.labelResourcesHandle) return null;

    const permissionOk = await fileAccess.requestPermission(modelEntry.labelResourcesHandle, 'readwrite');
    if (!permissionOk) {
      throw new Error(t('builder_direct_save_permission_denied'));
    }

    let cultureHandle;
    try {
      cultureHandle = await modelEntry.labelResourcesHandle.getDirectoryHandle(culture);
    } catch (err) {
      cultureHandle = await modelEntry.labelResourcesHandle.getDirectoryHandle(culture, { create: true });
    }

    const fileName = `${prefix}.${culture}.label.txt`;
    const fileHandle = await cultureHandle.getFileHandle(fileName, { create: true });

    let cultureEntry = modelEntry.cultures.find((entry) => entry.culture === culture);
    if (!cultureEntry) {
      cultureEntry = { culture, handle: cultureHandle, files: [] };
      modelEntry.cultures.push(cultureEntry);
    }
    if (!cultureEntry.files.some((file) => file.name === fileName)) {
      cultureEntry.files.push({ name: fileName, handle: fileHandle, prefix });
    }
    modelEntry.fileCount = modelEntry.cultures.reduce((sum, entry) => sum + entry.files.length, 0);

    return {
      model: sourceModel,
      culture,
      name: fileName,
      handle: fileHandle
    };
  }

  async function resolveDirectSaveTarget(group) {
    let matches = findDirectSaveTargets(group.prefix, group.culture, group.sourceModel);

    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(t('builder_direct_save_ambiguous_target', {
        prefix: group.prefix,
        culture: group.culture,
        count: matches.length
      }));
    }

    if (!group.sourceModel) {
      matches = findDirectSaveTargets(group.prefix, group.culture);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) {
        throw new Error(t('builder_direct_save_ambiguous_target', {
          prefix: group.prefix,
          culture: group.culture,
          count: matches.length
        }));
      }
      throw new Error(t('builder_direct_save_target_not_found', {
        prefix: group.prefix,
        culture: group.culture
      }));
    }

    const created = await createDirectSaveTarget(group.prefix, group.culture, group.sourceModel);
    if (created) return created;

    throw new Error(t('builder_direct_save_target_not_found', {
      prefix: group.prefix,
      culture: group.culture
    }));
  }

  async function handleBuilderDirectSave(sortedLabels) {
    builderState.directSaving = true;
    try {
      const invalid = sortedLabels.filter((label) => !label.prefix || !label.culture);
      if (invalid.length > 0) {
        throw new Error(t('builder_direct_save_missing_prefix'));
      }

      const grouped = groupBuilderLabelsByTarget(sortedLabels);
      const proceed = confirm(t('builder_direct_save_confirm', {
        files: grouped.length,
        labels: sortedLabels.length
      }));
      if (!proceed) return;

      showInfo(t('builder_direct_save_preflight', {
        files: grouped.length,
        labels: sortedLabels.length
      }));

      let updatedFiles = 0;
      let appendedLabels = 0;
      let replacedLabels = 0;
      let skippedLabels = 0;

      for (const group of grouped) {
        const target = await resolveDirectSaveTarget(group);
        const permissionOk = await fileAccess.requestPermission(target.handle, 'readwrite');
        if (!permissionOk) {
          throw new Error(t('builder_direct_save_permission_denied'));
        }

        const existingContent = await fileAccess.readFileAsText(target.handle);
        const entries = parseLabelFileContent(existingContent);
        const indexById = new Map(entries.map((entry, index) => [entry.labelId, index]));

        for (const label of group.labels) {
          const existingIdx = indexById.get(label.labelId);
          const nextValue = {
            labelId: label.labelId,
            text: label.text || '',
            helpText: label.helpText || ''
          };

          if (Number.isInteger(existingIdx)) {
            const current = entries[existingIdx];
            if (current.text === nextValue.text && (current.helpText || '') === nextValue.helpText) {
              skippedLabels++;
              continue;
            }
            entries[existingIdx] = nextValue;
            replacedLabels++;
          } else {
            indexById.set(nextValue.labelId, entries.length);
            entries.push(nextValue);
            appendedLabels++;
          }
        }

        await fileAccess.writeFileAsText(target.handle, buildLabelFileContent(entries));
        updatedFiles++;
      }

      showSuccess(t('builder_direct_save_complete', {
        files: updatedFiles,
        added: appendedLabels,
        updated: replacedLabels,
        skipped: skippedLabels
      }));
    } finally {
      builderState.directSaving = false;
    }
  }

  function getBuilderTargetLanguages() {
    if (!elements.builderTargetLanguages) return [];
    return [...elements.builderTargetLanguages.options]
      .filter((option) => option.selected)
      .map((option) => option.value);
  }

  // SPEC-41: Removed btn-ai-translation-status - this function is now a no-op
  function setAiTranslationHeaderStatus(visible, message = '') {
    // Progress is now shown in builder translate progress bar only
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

  function resetTranslatorState() {
    builderState.translating = false;
    builderState.translatorReady = false;
    builderState.pendingInit = null;
    builderState.pendingTranslate = null;
  }

  function getManagedTranslatorWorker() {
    if (managedTranslatorWorker?.isActive) {
      return managedTranslatorWorker;
    }

    if (builderState.translatorWorker) {
      try {
        builderState.translatorWorker.terminate();
      } catch (_) {}
      builderState.translatorWorker = null;
    }

    managedTranslatorWorker = new ManagedWorker('./workers/translator.worker.js', { type: 'module' })
      .start()
      .onProgress((message) => {
        const { type, payload } = message || {};
        if (type === 'INIT_PROGRESS') {
          builderState.translating = true;
          updateBuilderTranslateProgress(payload?.progress || 0, payload?.message || t('ai_status_downloading'));
          return;
        }
        if (type === 'TRANSLATE_PROGRESS') {
          const progress = payload?.progress || 0;
          const progressLabel = t('ai_translation_progress', {
            current: payload?.completed || 0,
            total: payload?.total || 0
          });
          updateBuilderTranslateProgress(progress, progressLabel);
        }
      });

    return managedTranslatorWorker;
  }

  function ensureTranslatorWorker() {
    if (managedTranslatorWorker?.isActive) {
      managedTranslatorWorker.terminate();
      managedTranslatorWorker = null;
    }

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
        builderState.translatorReady = false;
        try {
          builderState.translatorWorker?.terminate();
        } catch (_) {}
        builderState.translatorWorker = null;
        updateBuilderTranslateProgress(0, '');
        showError(error.message);
      }
    };

    builderState.translatorWorker.onerror = (event) => {
      console.error('Translator worker error:', event);
      builderState.translating = false;
      builderState.translatorReady = false;
      if (builderState.pendingInit) {
        builderState.pendingInit.reject(new Error('Translator worker failed'));
        builderState.pendingInit = null;
      }
      if (builderState.pendingTranslate) {
        builderState.pendingTranslate.reject(new Error('Translator worker failed'));
        builderState.pendingTranslate = null;
      }
      try {
        builderState.translatorWorker?.terminate();
      } catch (_) {}
      builderState.translatorWorker = null;
      updateBuilderTranslateProgress(0, '');
      showError(t('ai_translation_error'));
    };

    return builderState.translatorWorker;
  }

  function initializeTranslatorWorker() {
    if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER) {
      if (builderState.translatorReady) {
        return Promise.resolve();
      }
      return withFeatureError('AI Translation Init', async () => {
        const worker = getManagedTranslatorWorker();
        const response = await worker.send(
          'INIT',
          {},
          {
            resolveTypes: ['READY'],
            progressTypes: ['INIT_PROGRESS'],
            errorTypes: ['ERROR']
          }
        );
        builderState.translatorReady = true;
        return response?.payload;
      }, { fallback: null, showToast: false });
    }

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
    if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER) {
      return withFeatureError('AI Translation Request', async () => {
        const worker = getManagedTranslatorWorker();
        const response = await worker.send(
          'TRANSLATE',
          { payload: { jobs } },
          {
            resolveTypes: ['TRANSLATE_COMPLETE'],
            progressTypes: ['TRANSLATE_PROGRESS'],
            errorTypes: ['ERROR']
          }
        );
        return response?.payload || { translations: [] };
      }, { fallback: null, showToast: false });
    }

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
    pushBuilderHistorySnapshot();
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
      markBuilderDirty();
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
    markBuilderDirty();
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
    // BUG-39: Disable button visually during translation
    if (elements.btnBuilderAutoTranslate) {
      elements.btnBuilderAutoTranslate.disabled = true;
      elements.btnBuilderAutoTranslate.classList.add('btn-disabled');
    }
    updateBuilderTranslateProgress(0, t('ai_translation_initializing'));

    try {
      const initResult = await initializeTranslatorWorker();
      if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER && initResult === null && !builderState.translatorReady) {
        throw new Error(t('ai_translation_error'));
      }

      const result = await requestTranslations(jobs);
      if (!result) {
        throw new Error(t('ai_translation_error'));
      }
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
      if (FLAGS.USE_MANAGED_TRANSLATOR_WORKER) {
        try {
          managedTranslatorWorker?.terminate();
        } catch (_) {}
        managedTranslatorWorker = null;
        resetTranslatorState();
      }
      showError(err.message || t('ai_translation_error'));
      updateBuilderTranslateProgress(0, '');
    } finally {
      builderState.translating = false;
      // BUG-39: Re-enable button after translation completes
      if (elements.btnBuilderAutoTranslate) {
        elements.btnBuilderAutoTranslate.disabled = false;
        elements.btnBuilderAutoTranslate.classList.remove('btn-disabled');
      }
      setTimeout(() => {
        updateBuilderTranslateProgress(0, t('ai_translation_idle'));
        setAiTranslationHeaderStatus(false, t('ai_translation_idle'));
      }, 800);
    }
  }

  return {
    applyBuilderDirectSaveVisualState,
    markBuilderDirty,
    cloneBuilderLabels,
    pushBuilderHistorySnapshot,
    restoreBuilderSnapshot,
    undoBuilderChange,
    openBuilderModal,
    closeBuilderModal,
    switchBuilderTab,
    renderBuilderHistory,
    restoreBuilderSession,
    loadBuilderWorkspace,
    renderBuilderItems,
    updateBuilderFooter,
    addLabelToBuilder,
    removeBuilderItem,
    editBuilderItem,
    openNewLabelModal,
    closeNewLabelModal,
    handleSaveNewLabel,
    openConflictModal,
    openManualConflictEditor,
    closeConflictModal,
    resolveConflict,
    handleBuilderClear,
    handleBuilderFinish,
    handleBuilderDownload,
    triggerFileDownload,
    openExportModal,
    closeExportModal,
    setupExportLanguageCheckboxes,
    getSelectedExportLanguages,
    updateExportProgress,
    handleExportGenerate,
    updateBackgroundTasksHeader,
    parseCultureInputList,
    buildExportGroups,
    buildDownloadSignature,
    buildExportLabelsWithOptionalTranslations,
    normalizeLabelLineValue,
    buildLabelFileContent,
    inferSourceModel,
    parseLabelFileContent,
    groupBuilderLabelsByTarget,
    findDirectSaveTargets,
    createDirectSaveTarget,
    resolveDirectSaveTarget,
    handleBuilderDirectSave,
    getBuilderTargetLanguages,
    setAiTranslationHeaderStatus,
    updateBuilderTranslateProgress,
    toWorkerLang,
    resetTranslatorState,
    getManagedTranslatorWorker,
    ensureTranslatorWorker,
    initializeTranslatorWorker,
    requestTranslations,
    applyTranslatedLabel,
    handleBuilderAutoTranslate
  };
}
