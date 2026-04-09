export const extractorState = {
  files: [],
  candidates: [],
  worker: null,
  running: false,
  sessionId: null,
  projectModel: '',
  projectName: ''
};

export function createExtractorSessionId(modelName = '') {
  const modelPart = (modelName || 'generic').replace(/[^A-Za-z0-9_-]/g, '_');
  return `extractor_${modelPart}_${Date.now()}`;
}
