export function createStatsController({
  getElements,
  db,
  showInfo,
  formatBytes,
  formatMs,
  escapeHtml,
  formatLanguageDisplay
}) {
  async function openStatsDashboardModal() {
    const elements = getElements();
    if (!elements.statsDashboardModal) return;

    const catalog = await db.getCatalog();
    if (!catalog.length) {
      showInfo('No indexed dataset statistics available yet.');
      return;
    }

    const modelMap = new Map();
    let totalFiles = 0;
    let totalLabels = 0;
    let totalBytes = 0;
    let totalProcessingMs = 0;

    for (const entry of catalog) {
      totalFiles += entry.fileCount || 0;
      totalLabels += entry.labelCount || 0;
      totalBytes += entry.totalBytes || 0;
      totalProcessingMs += entry.totalProcessingMs || 0;

      const modelAgg = modelMap.get(entry.model) || {
        model: entry.model,
        files: 0,
        labels: 0,
        bytes: 0,
        processingMs: 0
      };
      modelAgg.files += entry.fileCount || 0;
      modelAgg.labels += entry.labelCount || 0;
      modelAgg.bytes += entry.totalBytes || 0;
      modelAgg.processingMs += entry.totalProcessingMs || 0;
      modelMap.set(entry.model, modelAgg);
    }

    const globalSpeed = totalProcessingMs > 0
      ? Math.round(totalLabels / (totalProcessingMs / 1000))
      : 0;

    if (elements.statsTotalModels) {
      elements.statsTotalModels.textContent = modelMap.size.toLocaleString();
    }
    if (elements.statsTotalFiles) {
      elements.statsTotalFiles.textContent = totalFiles.toLocaleString();
    }
    if (elements.statsTotalSize) {
      elements.statsTotalSize.textContent = formatBytes(totalBytes);
    }
    if (elements.statsGlobalSpeed) {
      elements.statsGlobalSpeed.textContent = `${globalSpeed.toLocaleString()}/s`;
    }

    const modelRows = [...modelMap.values()].sort((a, b) => b.labels - a.labels).map((entry) => `
      <div class="language-status-item ready">
        <span class="model-name">${escapeHtml(entry.model)}</span>
        <span class="language-name">${entry.files.toLocaleString()} files</span>
        <div class="language-progress-cell">
          <span class="language-progress-text">${entry.labels.toLocaleString()} labels</span>
        </div>
        <span class="language-status-badge">⏱️ ${formatMs(entry.processingMs)}</span>
      </div>
    `);
    if (elements.statsModelList) {
      elements.statsModelList.innerHTML = modelRows.join('');
    }

    const pairRows = catalog
      .slice()
      .sort((a, b) => (b.totalProcessingMs || 0) - (a.totalProcessingMs || 0))
      .map((entry) => `
        <div class="language-status-item ${entry.status === 'ready' ? 'ready' : 'indexing'}">
          <span class="model-name">${escapeHtml(entry.model)}</span>
          <span class="language-name">${formatLanguageDisplay(entry.culture)}</span>
          <div class="language-progress-cell">
            <span class="language-progress-text">${(entry.labelCount || 0).toLocaleString()} • ${formatBytes(entry.totalBytes || 0)}</span>
          </div>
          <span class="language-status-badge">⏱️ ${formatMs(entry.totalProcessingMs || 0)}</span>
        </div>
      `);
    if (elements.statsPairList) {
      elements.statsPairList.innerHTML = pairRows.join('');
    }

    elements.statsDashboardModal.classList.remove('hidden');
  }

  function closeStatsDashboardModal() {
    const elements = getElements();
    elements.statsDashboardModal?.classList.add('hidden');
  }

  return {
    openStatsDashboardModal,
    closeStatsDashboardModal
  };
}
