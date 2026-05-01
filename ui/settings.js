export function createSettingsController({
  getElements,
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
  applyBuilderDirectSaveVisualState,
  handleSearch,
  saveDisplaySettingsToDb
}) {
  function openSystemSettingsModal() {
    const elements = getElements();
    if (!elements.systemSettingsModal) return;

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
  }

  function closeSystemSettingsModal() {
    const elements = getElements();
    if (!elements.systemSettingsModal) return;
    elements.systemSettingsModal.classList.add('hidden');
  }

  /**
   * Apply system settings from modal
   */
  async function applySystemSettings() {
    const elements = getElements();
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

    if (state.displaySettings.uiLanguage === 'auto') {
      setDisplayLocale(null);
    } else {
      setDisplayLocale(state.displaySettings.uiLanguage);
    }

    setLanguage(state.displaySettings.uiLanguage);
    updateInterfaceText();
    applyBuilderDirectSaveVisualState();
    updateAiSettingsUI();

    const searchSettings = {
      enableHybridSearch: elements.settingHybridSearch?.checked ?? true,
      maxModelsInMemory: parseInt(elements.settingMaxModels?.value) || 5,
      fuzzyThreshold: parseFloat(elements.settingFuzzyThreshold?.value) || 0.2
    };
    await searchService.saveSettings(searchSettings);

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

  function updateAiSettingsUI() {
    const elements = getElements();
    const enabled = state.ai.enabled;
    const unlocked = enabled && state.ai.status === 'ready';
    const downloading = state.ai.status === 'downloading';

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
  }

  function updateAiStatusBadge() {
    const elements = getElements();
    if (!elements.aiStatusBadge) return;
    let key = 'ai_status_inactive';
    if (state.ai.status === 'downloading') key = 'ai_status_downloading';
    if (state.ai.status === 'ready') key = 'ai_status_ready';
    elements.aiStatusBadge.setAttribute('data-status', state.ai.status);
    elements.aiStatusBadge.textContent = t(key);
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

    state.ai.worker = new Worker(
      new URL('../workers/ai-model.worker.js', import.meta.url),
      { type: 'module' }
    );
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
    const elements = getElements();
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

  function updateHeaderAiDownloadProgress() {
    const elements = getElements();
    if (!elements.btnAiDownloadStatus || !elements.aiDownloadStatusText) return;
    const isDownloading = state.ai.status === 'downloading';
    elements.btnAiDownloadStatus.classList.toggle('hidden', !isDownloading);
    if (isDownloading) {
      const text = state.ai.lastMessage ? state.ai.lastMessage : `AI Download: ${Math.round(state.ai.progress)}%`;
      elements.aiDownloadStatusText.textContent = text;
    }
  }

  return {
    openSystemSettingsModal,
    closeSystemSettingsModal,
    applySystemSettings,
    updateAiSettingsUI,
    loadAiSettingsFromDb,
    saveAiSettingsToDb,
    startAiModelDownload,
    clearAiCache,
    updateHeaderAiDownloadProgress
  };
}
