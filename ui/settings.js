export function createSettingsController({
  getElements,
  state,
  searchService,
  loadDisplaySettingsFromDb,
  loadAiSettingsFromDb,
  updateAiSettingsUI
}) {
  function openSystemSettingsModal() {
    const elements = getElements();
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

  function closeSystemSettingsModal() {
    const elements = getElements();
    if (!elements.systemSettingsModal) return;
    elements.systemSettingsModal.classList.add('hidden');
  }

  return {
    openSystemSettingsModal,
    closeSystemSettingsModal
  };
}
