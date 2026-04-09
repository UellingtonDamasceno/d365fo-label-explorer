export function createModalController({ getElements }) {
  function openAdvancedSelectionModal() {
    getElements().advancedSelectionModal?.classList.remove('hidden');
  }

  function closeAdvancedSelectionModal() {
    getElements().advancedSelectionModal?.classList.add('hidden');
  }

  function openLanguageFilterModal() {
    getElements().languageFilterModal?.classList.remove('hidden');
  }

  function closeLanguageFilterModal() {
    getElements().languageFilterModal?.classList.add('hidden');
  }

  function openAdvancedSearchModal() {
    const elements = getElements();
    if (!elements.advancedSearchModal) return;
    elements.advancedSearchModal.classList.remove('hidden');
  }

  function closeAdvancedSearchModal() {
    const elements = getElements();
    if (!elements.advancedSearchModal) return;
    elements.advancedSearchModal.classList.add('hidden');
  }

  function openShortcutsModal() {
    const elements = getElements();
    if (!elements.shortcutsModal) return;
    elements.shortcutsModal.classList.remove('hidden');
  }

  function closeShortcutsModal() {
    const elements = getElements();
    if (!elements.shortcutsModal) return;
    elements.shortcutsModal.classList.add('hidden');
  }

  return {
    openAdvancedSelectionModal,
    closeAdvancedSelectionModal,
    openLanguageFilterModal,
    closeLanguageFilterModal,
    openAdvancedSearchModal,
    closeAdvancedSearchModal,
    openShortcutsModal,
    closeShortcutsModal
  };
}
