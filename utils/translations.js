/**
 * D365FO Label Explorer - Translations / i18n System
 * Provides multilingual support for the UI
 */

export const translations = {
  en: {
    // Onboarding
    app_title: 'D365FO Label Explorer',
    app_subtitle: 'Ultra-fast label file explorer for Dynamics 365 Finance & Operations',
    select_folder_hint: 'Select your <code>PackagesLocalDirectory</code> folder to get started.',
    typical_path: 'Typically: <code>K:\\AosService\\PackagesLocalDirectory\\</code>',
    btn_select_folder: 'Select D365FO Folder',
    scanning_models: 'Scanning for models...',
    browser_warning_title: "⚠️ Your browser doesn't support the File System Access API.",
    browser_warning_hint: 'Please use <strong>Google Chrome 86+</strong> or <strong>Microsoft Edge 86+</strong>.',
    
    // Discovery Dashboard
    discovery_complete: 'Discovery Complete',
    discovery_summary: 'Found <strong>{models}</strong> models with <strong>{files}</strong> label files.',
    btn_select_all: '✓ Select All',
    btn_deselect_all: '✗ Deselect All',
    select_language: 'Select language...',
    btn_apply_global_language: 'Apply Global Language',
    files_selected: '{selected} of {total} files selected',
    btn_start_indexing: 'Start Indexing Selected',
    btn_change_folder: 'Change Folder',
    btn_cancel_rescan: 'Cancel',
    indexing_labels: 'Indexing labels...',
    saving_database: 'Saving to database...',
    building_index: 'Building search index...',
    
    // Header
    labels_indexed_count: '{count} labels indexed',
    last_indexed: 'Last indexed: {date}',
    btn_rescan: 'Re-scan',
    
    // Sidebar / Search
    search_placeholder: 'Search labels...',
    btn_advanced_search: 'Advanced Search',
    btn_system_settings: 'System Settings',
    results: 'Results',
    sort_label: 'Sort:',
    sort_relevance: 'Relevance',
    sort_labelid_asc: 'Label ID (A-Z)',
    sort_labelid_desc: 'Label ID (Z-A)',
    sort_text_asc: 'Text (A-Z)',
    sort_text_desc: 'Text (Z-A)',
    sort_model_asc: 'Model (A-Z)',
    
    // Empty state
    empty_title: 'Start Searching',
    empty_description: 'Type in the search box to find labels across all your D365FO models.',
    feature_fast_search: 'Fast Search',
    feature_fast_search_desc: '< 200ms even with 100k+ labels',
    feature_fuzzy: 'Fuzzy Match',
    feature_fuzzy_desc: 'Find labels even with typos',
    feature_copy: 'Copy ID',
    feature_copy_desc: 'One-click copy @Prefix:ID',
    
    // Advanced Search Modal
    modal_advanced_search: '🔍 Advanced Search',
    modal_models: 'Models',
    modal_languages: 'Languages',
    all_models: 'All models',
    all_languages: 'All languages',
    btn_select_models: 'Select Models',
    btn_select_languages: 'Select Languages',
    exact_match: 'Exact Match',
    translation_compliance: 'Translation Compliance',
    no_required_languages: 'No required languages',
    btn_set_required: 'Set Required',
    hide_incomplete: 'Hide incomplete labels',
    btn_clear_filters: 'Clear All',
    btn_apply_filters: 'Apply Filters',
    
    // System Settings Modal
    modal_system_settings: '⚙️ System Settings',
    display_settings: 'Display Settings',
    label_format: 'Label ID Format',
    format_full: 'Full (@Prefix:ID)',
    format_simple: 'Simple (ID only)',
    format_hybrid: 'Hybrid (ID + prefix below)',
    group_duplicates: 'Group Duplicate Labels',
    interface_language: 'Interface Language',
    lang_auto: 'Auto (Browser)',
    btn_apply_settings: 'Apply Settings',
    // SPEC-19: Search Performance Settings
    search_performance: '🔍 Search Performance',
    enable_hybrid_search: 'Enable Hybrid Search',
    hint_hybrid_search: 'Uses memory cache for fast fuzzy search. Disable to force IndexedDB-only searches (slower but uses less RAM).',
    max_models_memory: 'Max Models in Memory',
    hint_max_models: 'Higher values = faster search, more RAM usage (default: 5)',
    fuzzy_threshold: 'Fuzzy Search Threshold',
    hint_fuzzy_threshold: 'Lower = stricter matching, Higher = more tolerance for typos',
    
    // Item Selector Modal
    select_items: 'Select Items',
    search_items: 'Search...',
    btn_toggle_select_all: 'Select All',
    btn_toggle_deselect_all: 'Deselect All',
    btn_done: 'Done',
    
    // Label Details Modal
    modal_label_occurrences: '📦 Label Occurrences',
    found_in_models: 'Found in {count} {models}:',
    model_singular: 'model',
    model_plural: 'models',
    full_id: 'Full ID:',
    btn_close: 'Close',
    
    // Label Card
    btn_copy_id: 'Copy ID',
    btn_copy_text: 'Copy Text',
    available_in_files: 'Available in {count} files',
    missing_languages: 'MISSING: {languages}',
    
    // Toast messages
    toast_copied_id: 'Label ID copied!',
    toast_copied_text: 'Label text copied!',
    toast_filters_applied: 'Filters applied',
    toast_filters_cleared: 'Filters cleared',
    toast_settings_applied: 'Settings applied',
    toast_select_language_first: 'Select a language first',
    toast_applied_language: 'Applied {culture} to all models',
    toast_all_selected: 'All files selected',
    toast_all_deselected: 'All files deselected',
    toast_selection_restored: 'Selection restored',
    toast_nothing_to_undo: 'Nothing to undo',
    toast_indexing_complete: 'Successfully indexed {count} labels!',
    toast_indexing_skipped: 'Indexing complete. {count} lines were skipped due to format issues.',
    toast_no_files_selected: 'No files selected for indexing',
    toast_select_folder: 'Please click again to select a folder',
    toast_folder_error: 'Failed to access folder. Please try again.',
    toast_scan_error: 'Failed to scan folder. Please try again.',
    toast_no_labels_found: 'No D365FO label files found. Make sure you selected the correct folder.',
    toast_db_init_error: 'Failed to initialize database. Please check your browser settings.',
    toast_language_filter_applied: 'Language filter applied ({count} languages)',
    
    // Language Filter Modal
    filter_languages: 'Filter Languages',
    filter_languages_title: '🌐 Filter Languages',
    filter_languages_hint: 'Select which languages to keep across all models. Models without any selected languages will be unchecked.',
    search_languages: 'Search languages...',
    btn_apply_filter: 'Apply Filter',
    
    // Keyboard shortcuts legend
    shortcuts_title: 'Keyboard Shortcuts',
    shortcut_focus_search: 'Focus Search',
    shortcut_advanced_search: 'Advanced Search',
    shortcut_settings: 'Settings',
    shortcut_rescan: 'Re-scan',
    shortcut_select_folder: 'Select Folder',
    shortcut_close: 'Close',
    shortcut_nav_down: 'Next result',
    shortcut_nav_up: 'Previous result',
    shortcut_copy: 'Copy Label ID',
    shortcut_details: 'Open details',
    shortcut_undo: 'Undo selection',
    
    // SPEC-23: Tiered Discovery & Background Indexing
    recommended_quick_start: 'Quick Start (Recommended)',
    recommended_hint: 'Start searching in ~5 seconds',
    btn_quick_start: 'Start Quick Search',
    background_indexing_label: 'Index remaining languages in background',
    advanced_selection: 'Advanced Selection',
    btn_index_selected: 'Index All Selected',
    background_indexing_title: 'Background Indexing',
    labels_indexed: 'Labels Indexed',
    overall_progress: 'Overall Progress',
    estimated_time: 'Est. Remaining',
    labels_indexed: 'Labels Indexed',
    processing_speed: 'Processing Speed',
    language_status: 'Language Status',
    model_column: 'Model',
    language_column: 'Language',
    progress_column: 'Progress',
    status_column: 'Status',
    status_ready: 'Ready',
    status_processing: 'Processing',
    status_waiting: 'Waiting',
    labels_per_second: '{count}/s',
    header_indexing_active: '📦 Indexing: {percent}% ({count} labels)',
    background_summary_complete: 'Completed: {labels} labels across {files} files at {speed}/s',
    background_hint: 'You can continue searching while indexing completes.',
    no_priority_languages_found: 'No priority languages found in this folder',
    background_indexing_complete: 'Background indexing complete!'
  },
  
  'pt-BR': {
    // Onboarding
    app_title: 'D365FO Label Explorer',
    app_subtitle: 'Explorador ultrarrápido de arquivos de label para Dynamics 365 Finance & Operations',
    select_folder_hint: 'Selecione sua pasta <code>PackagesLocalDirectory</code> para começar.',
    typical_path: 'Geralmente: <code>K:\\AosService\\PackagesLocalDirectory\\</code>',
    btn_select_folder: 'Selecionar Pasta D365FO',
    scanning_models: 'Escaneando modelos...',
    browser_warning_title: '⚠️ Seu navegador não suporta a API File System Access.',
    browser_warning_hint: 'Por favor, use <strong>Google Chrome 86+</strong> ou <strong>Microsoft Edge 86+</strong>.',
    
    // Discovery Dashboard
    discovery_complete: 'Descoberta Concluída',
    discovery_summary: 'Encontrados <strong>{models}</strong> modelos com <strong>{files}</strong> arquivos de label.',
    btn_select_all: '✓ Selecionar Todos',
    btn_deselect_all: '✗ Desmarcar Todos',
    select_language: 'Selecionar idioma...',
    btn_apply_global_language: 'Aplicar Idioma Global',
    files_selected: '{selected} de {total} arquivos selecionados',
    btn_start_indexing: 'Iniciar Indexação',
    btn_change_folder: 'Trocar Pasta',
    btn_cancel_rescan: 'Cancelar',
    indexing_labels: 'Indexando labels...',
    saving_database: 'Salvando no banco de dados...',
    building_index: 'Construindo índice de busca...',
    
    // Header
    labels_indexed_count: '{count} labels indexados',
    last_indexed: 'Última indexação: {date}',
    btn_rescan: 'Re-escanear',
    
    // Sidebar / Search
    search_placeholder: 'Buscar labels...',
    btn_advanced_search: 'Busca Avançada',
    btn_system_settings: 'Configurações',
    results: 'Resultados',
    sort_label: 'Ordenar:',
    sort_relevance: 'Relevância',
    sort_labelid_asc: 'Label ID (A-Z)',
    sort_labelid_desc: 'Label ID (Z-A)',
    sort_text_asc: 'Texto (A-Z)',
    sort_text_desc: 'Texto (Z-A)',
    sort_model_asc: 'Modelo (A-Z)',
    
    // Empty state
    empty_title: 'Comece a Buscar',
    empty_description: 'Digite na caixa de busca para encontrar labels em todos os seus modelos D365FO.',
    feature_fast_search: 'Busca Rápida',
    feature_fast_search_desc: '< 200ms mesmo com 100k+ labels',
    feature_fuzzy: 'Busca Flexível',
    feature_fuzzy_desc: 'Encontra labels mesmo com erros de digitação',
    feature_copy: 'Copiar ID',
    feature_copy_desc: 'Copie @Prefix:ID com um clique',
    
    // Advanced Search Modal
    modal_advanced_search: '🔍 Busca Avançada',
    modal_models: 'Modelos',
    modal_languages: 'Idiomas',
    all_models: 'Todos os modelos',
    all_languages: 'Todos os idiomas',
    btn_select_models: 'Selecionar Modelos',
    btn_select_languages: 'Selecionar Idiomas',
    exact_match: 'Correspondência Exata',
    translation_compliance: 'Conformidade de Tradução',
    no_required_languages: 'Nenhum idioma obrigatório',
    btn_set_required: 'Definir Obrigatórios',
    hide_incomplete: 'Ocultar labels incompletos',
    btn_clear_filters: 'Limpar Todos',
    btn_apply_filters: 'Aplicar Filtros',
    
    // System Settings Modal
    modal_system_settings: '⚙️ Configurações do Sistema',
    display_settings: 'Configurações de Exibição',
    label_format: 'Formato do Label ID',
    format_full: 'Completo (@Prefix:ID)',
    format_simple: 'Simples (apenas ID)',
    format_hybrid: 'Híbrido (ID + prefixo abaixo)',
    group_duplicates: 'Agrupar Labels Duplicados',
    interface_language: 'Idioma da Interface',
    lang_auto: 'Automático (Navegador)',
    btn_apply_settings: 'Aplicar Configurações',
    // SPEC-19: Search Performance Settings
    search_performance: '🔍 Desempenho de Busca',
    enable_hybrid_search: 'Habilitar Busca Híbrida',
    hint_hybrid_search: 'Usa cache em memória para busca fuzzy rápida. Desabilite para forçar busca apenas no IndexedDB (mais lenta mas usa menos RAM).',
    max_models_memory: 'Máx. Modelos em Memória',
    hint_max_models: 'Valores maiores = busca mais rápida, mais uso de RAM (padrão: 5)',
    fuzzy_threshold: 'Tolerância de Busca Fuzzy',
    hint_fuzzy_threshold: 'Menor = busca mais exata, Maior = mais tolerância a erros de digitação',
    
    // Item Selector Modal
    select_items: 'Selecionar Itens',
    search_items: 'Buscar...',
    btn_toggle_select_all: 'Selecionar Todos',
    btn_toggle_deselect_all: 'Desmarcar Todos',
    btn_done: 'Concluído',
    
    // Label Details Modal
    modal_label_occurrences: '📦 Ocorrências do Label',
    found_in_models: 'Encontrado em {count} {models}:',
    model_singular: 'modelo',
    model_plural: 'modelos',
    full_id: 'ID Completo:',
    btn_close: 'Fechar',
    
    // Label Card
    btn_copy_id: 'Copiar ID',
    btn_copy_text: 'Copiar Texto',
    available_in_files: 'Disponível em {count} arquivos',
    missing_languages: 'FALTANDO: {languages}',
    
    // Toast messages
    toast_copied_id: 'Label ID copiado!',
    toast_copied_text: 'Texto do label copiado!',
    toast_filters_applied: 'Filtros aplicados',
    toast_filters_cleared: 'Filtros limpos',
    toast_settings_applied: 'Configurações aplicadas',
    toast_select_language_first: 'Selecione um idioma primeiro',
    toast_applied_language: 'Aplicado {culture} a todos os modelos',
    toast_all_selected: 'Todos os arquivos selecionados',
    toast_all_deselected: 'Todos os arquivos desmarcados',
    toast_selection_restored: 'Seleção restaurada',
    toast_nothing_to_undo: 'Nada para desfazer',
    toast_indexing_complete: '{count} labels indexados com sucesso!',
    toast_indexing_skipped: 'Indexação completa. {count} linhas ignoradas por problemas de formato.',
    toast_no_files_selected: 'Nenhum arquivo selecionado para indexação',
    toast_select_folder: 'Clique novamente para selecionar uma pasta',
    toast_folder_error: 'Falha ao acessar a pasta. Tente novamente.',
    toast_scan_error: 'Falha ao escanear a pasta. Tente novamente.',
    toast_no_labels_found: 'Nenhum arquivo de label D365FO encontrado. Verifique se selecionou a pasta correta.',
    toast_db_init_error: 'Falha ao inicializar o banco de dados. Verifique as configurações do navegador.',
    toast_language_filter_applied: 'Filtro de idiomas aplicado ({count} idiomas)',
    
    // Language Filter Modal
    filter_languages: 'Filtrar Idiomas',
    filter_languages_title: '🌐 Filtrar Idiomas',
    filter_languages_hint: 'Selecione quais idiomas manter em todos os modelos. Modelos sem idiomas selecionados serão desmarcados.',
    search_languages: 'Buscar idiomas...',
    btn_apply_filter: 'Aplicar Filtro',
    
    // Keyboard shortcuts legend
    shortcuts_title: 'Atalhos de Teclado',
    shortcut_focus_search: 'Focar Busca',
    shortcut_advanced_search: 'Busca Avançada',
    shortcut_settings: 'Configurações',
    shortcut_rescan: 'Re-escanear',
    shortcut_select_folder: 'Selecionar Pasta',
    shortcut_close: 'Fechar',
    shortcut_nav_down: 'Próximo resultado',
    shortcut_nav_up: 'Resultado anterior',
    shortcut_copy: 'Copiar Label ID',
    shortcut_details: 'Abrir detalhes',
    shortcut_undo: 'Desfazer seleção',
    
    // SPEC-23: Tiered Discovery & Background Indexing
    recommended_quick_start: 'Início Rápido (Recomendado)',
    recommended_hint: 'Comece a buscar em ~5 segundos',
    btn_quick_start: 'Iniciar Busca Rápida',
    background_indexing_label: 'Indexar idiomas restantes em segundo plano',
    advanced_selection: 'Seleção Avançada',
    btn_index_selected: 'Indexar Todos Selecionados',
    background_indexing_title: 'Indexação em Segundo Plano',
    labels_indexed: 'Labels Indexados',
    overall_progress: 'Progresso Total',
    estimated_time: 'Tempo Restante',
    labels_indexed: 'Labels Indexados',
    processing_speed: 'Velocidade',
    language_status: 'Status por Idioma',
    model_column: 'Modelo',
    language_column: 'Idioma',
    progress_column: 'Progresso',
    status_column: 'Status',
    status_ready: 'Pronto',
    status_processing: 'Processando',
    status_waiting: 'Aguardando',
    labels_per_second: '{count}/s',
    header_indexing_active: '📦 Indexando: {percent}% ({count} labels)',
    background_summary_complete: 'Concluído: {labels} labels em {files} arquivos a {speed}/s',
    background_hint: 'Você pode continuar buscando enquanto a indexação completa.',
    no_priority_languages_found: 'Nenhum idioma prioritário encontrado nesta pasta',
    background_indexing_complete: 'Indexação em segundo plano concluída!'
  }
};

// Current active language
let currentLang = 'en';

/**
 * Set the current interface language
 * @param {string} lang - Language code (e.g., 'en', 'pt-BR')
 */
export function setLanguage(lang) {
  if (translations[lang]) {
    currentLang = lang;
  } else if (lang === 'auto') {
    // Auto-detect from browser
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    currentLang = translations[browserLang] ? browserLang : 
                  translations[browserLang.split('-')[0]] ? browserLang.split('-')[0] : 'en';
  } else {
    currentLang = 'en';
  }
  return currentLang;
}

/**
 * Get the current language code
 * @returns {string}
 */
export function getCurrentLanguage() {
  return currentLang;
}

/**
 * Get a translation by key
 * @param {string} key - Translation key
 * @param {Object} params - Parameters for interpolation (e.g., {count: 5})
 * @returns {string}
 */
export function t(key, params = {}) {
  let text = translations[currentLang]?.[key] || translations.en[key] || key;
  
  // Interpolate parameters
  Object.keys(params).forEach(param => {
    text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
  });
  
  return text;
}

/**
 * Update all DOM elements with data-i18n attribute
 */
export function updateInterfaceText() {
  // Update elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translated = t(key);
    
    // Check if it's an input with placeholder
    if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
      el.placeholder = translated;
    } else if (el.tagName === 'OPTION') {
      el.textContent = translated;
    } else {
      // Preserve innerHTML for elements with HTML content
      if (translations[currentLang]?.[key]?.includes('<') || translations.en[key]?.includes('<')) {
        el.innerHTML = translated;
      } else {
        el.textContent = translated;
      }
    }
  });

  // Update elements with data-i18n-placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // Update elements with data-i18n-title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
}

/**
 * Get available languages for UI selector
 * @returns {Array<{code: string, name: string}>}
 */
export function getAvailableLanguages() {
  return [
    { code: 'auto', name: 'Auto (Browser)' },
    { code: 'en', name: 'English' },
    { code: 'pt-BR', name: 'Português (Brasil)' }
  ];
}
