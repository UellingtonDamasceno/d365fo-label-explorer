export const builderState = {
  labels: [], // Array of { id (db), labelId, culture, text, helpText, prefix, source, sourceModel, sourcePath }
  pendingConflict: null, // { existingLabel, newLabel }
  conflictResolveCallback: null, // Function to call after conflict resolution
  selectedLabelId: null,
  translatorWorker: null,
  translatorReady: false,
  translating: false,
  translateProgress: 0,
  pendingInit: null,
  pendingTranslate: null,
  directSaving: false,
  history: [],
  isDirty: false,
  lastDownloadedSignature: '',
  undoApplying: false
};

export function resetBuilderHistoryState() {
  builderState.history = [];
  builderState.isDirty = false;
  builderState.lastDownloadedSignature = '';
  builderState.undoApplying = false;
}
