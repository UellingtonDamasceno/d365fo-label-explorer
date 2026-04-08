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
    // SPEC-35: AI & Intelligence
    ai_settings_title: '✨ AI & Intelligence',
    ai_enable_local: 'Enable Local AI Intelligence',
    ai_enable_hint: 'Enables local translation and semantic label ID suggestions. Initial model download is stored in your browser cache.',
    ai_download_model: 'Download AI Model',
    ai_status_inactive: 'Inactive',
    ai_status_downloading: 'Downloading...',
    ai_status_ready: 'Ready',
    ai_progress_ready: 'Ready',
    ai_phase_downloading: 'Downloading',
    ai_phase_indexing: 'Indexing',
    ai_semantic_id: 'Semantic ID Suggestion',
    ai_auto_translate_discovery: 'Auto-Translate on Discovery',
    ai_auto_translate_btn: 'Auto-Translate',
    ai_translation_source: 'Source',
    ai_translation_targets: 'Targets',
    ai_translation_idle: 'AI Translation',
    ai_translation_running: 'Translating',
    ai_translation_progress: 'Translating {current}/{total}',
    ai_translation_initializing: 'Initializing translation engine...',
    ai_translation_complete: 'Translation complete',
    ai_translation_done_toast: 'Translated {count} label entries with AI suggestions.',
    ai_translation_error: 'AI translation failed.',
    ai_translation_requires_ready: 'Enable and prepare Local AI first to use Auto-Translate.',
    ai_translation_select_target: 'Select at least one target language.',
    ai_translation_no_source_labels: 'No labels found for the selected source language.',
    ai_translation_nothing_to_do: 'No pending translation pairs.',
    ai_generated_badge: 'AI-generated suggestion',
    ai_language_pair: 'Default Translation Pair',
    ai_lang_auto: 'Auto detect',
    ai_locked_hint: 'AI options are unlocked after enabling Local AI and finishing model download.',
    ai_clear_cache: 'Clear AI Cache',
    ai_enable_first: 'Enable Local AI Intelligence first.',
    ai_download_required: 'AI is enabled. Download the local model to unlock advanced AI features.',
    ai_ready_toast: '✨ AI Intelligence is ready! Advanced features unlocked.',
    ai_cache_cleared: 'AI cache cleared.',
    ai_clear_confirm: 'Clear local AI model cache?',
    ai_error_generic: 'Failed to initialize local AI model.',
    
    // Item Selector Modal
    select_items: 'Select Items',
    search_items: 'Search...',
    btn_toggle_select_all: 'Select All',
    btn_toggle_deselect_all: 'Deselect All',
    btn_done: 'Done',
    
    // Common Actions
    edit: 'Edit',
    delete: 'Delete',
    close: 'Close',
    
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
    shortcut_add_builder: 'Add to Builder',
    shortcut_remove_builder: 'Remove selected Builder item',
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
    background_indexing_complete: 'Background indexing complete!',
    models_suffix: 'models',
    
    // SPEC-36: Tools Menu & Merger
    btn_tools: 'Tools',
    tools_title: 'Developer Tools',
    tool_merger: 'Merge & Sort Labels',
    tool_merger_desc: 'Combine multiple label files, remove duplicates, and sort alphabetically',
    tool_builder: 'Label Builder',
    tool_builder_desc: 'Create and edit label collections with conflict resolution',
    tool_extractor: 'String Extractor',
    tool_extractor_desc: 'Extract hardcoded strings from D365FO project files',
    extractor_title: 'Hardcoded String Extractor',
    extractor_hint: 'Select .xml/.xpp files (or .rnrproj plus related files) to extract hardcoded string candidates.',
    extractor_start_scan: 'Scan Candidates',
    extractor_save_session: 'Save Session',
    extractor_resume_session: 'Resume Last Session',
    extractor_add_all: 'Add All to Builder',
    extractor_summary: '{files} files loaded • {candidates} pending • {confirmed} confirmed • {ignored} ignored',
    extractor_files_loaded: '{count} files loaded for extraction',
    extractor_scan_complete: 'Scan complete',
    extractor_found_candidates: 'Found {count} string candidates',
    extractor_scan_error: 'Failed to scan files for hardcoded strings',
    extractor_select_files_error: 'Select at least one .xml or .xpp file',
    extractor_confirm_new: 'Confirm New',
    extractor_ignore: 'Ignore',
    extractor_session_saved: 'Extraction session saved',
    extractor_session_save_error: 'Failed to save extraction session',
    extractor_no_session: 'No saved extraction session found',
    extractor_session_resumed: 'Extraction session resumed',
    extractor_session_load_error: 'Failed to load extraction session',
    extractor_project_loaded: 'Project loaded: {name} ({files} files)',
    extractor_existing_label: 'Existing label found: {fullId}',
    extractor_use_existing: 'Use Existing',
    extractor_ai_suggestions: 'Generating semantic ID suggestions...',
    extractor_project_files: 'Project Files',
    extractor_candidates: 'String Candidates',
    extractor_no_files: 'No files loaded',
    extractor_select_hint: 'Select a .rnrproj file or individual .xml/.xpp files to begin.',
    extractor_no_candidates: 'No candidates yet',
    extractor_scan_hint: 'Load files and click Scan to find hardcoded strings.',
    extractor_strings_found: 'strings found',
    extractor_resolved: 'resolved',
    extractor_ignored: 'ignored',
    extractor_auto_save: 'Auto-save progress',
    extractor_apply: 'Apply Changes',
    extractor_resume_prompt: 'Resume "{name}"? ({remaining} strings remaining)',
    extractor_no_confirmed: 'No confirmed labels to apply',
    extractor_applied: 'Added {count} labels to Builder',
    extractor_project_error: 'Failed to load project file',
    btn_select_project: '.rnrproj',
    btn_finish_session: 'Finish Session',
    btn_close: 'Close',
    
    // Builder Modal
    builder_title: 'Label Builder IDE',
    builder_new_label: 'New Label',
    builder_tip: 'Tip: Press <kbd>+</kbd> on any label card to add it here.',
    builder_direct_save_warning: 'Warning: Direct edit mode is active. Changes may affect original files.',
    builder_direct_save_mode: 'Enable Builder Direct Save mode',
    builder_direct_save_hint: 'Allows direct file edits from Builder. Keep disabled to use safe download-only mode.',
    builder_direct_save_confirm: 'Direct Save will update {files} file(s) with {labels} label(s). Continue?',
    builder_direct_save_preflight: 'Pre-flight check: preparing direct save for {files} file(s) and {labels} label(s).',
    builder_direct_save_complete: 'Direct Save complete: {files} file(s) updated • {added} added • {updated} updated • {skipped} unchanged',
    builder_direct_save_error: 'Failed to save labels directly to source files',
    builder_direct_save_permission_denied: 'Write permission denied for Direct Save',
    builder_direct_save_ambiguous_target: 'Multiple target files found for {prefix}.{culture} ({count} matches). Refine labels before Direct Save.',
    builder_direct_save_target_not_found: 'Target file not found for {prefix}.{culture}. Re-scan folder or use Download mode.',
    builder_direct_save_missing_prefix: 'Direct Save requires prefix and culture for all labels.',
    builder_empty_title: 'No labels in workspace',
    builder_empty_hint: 'Add labels from search results using the ➕ button, or create new labels manually.',
    builder_count: '{count} labels',
    btn_new_label: 'New Label',
    btn_clear_workspace: 'Clear All',
    btn_download_file: 'Download .label.txt',
    builder_duplicate_skipped: 'Label already exists in workspace',
    builder_label_added: 'Label added to builder',
    builder_add_error: 'Failed to add label',
    builder_label_removed: 'Label removed from workspace',
    builder_remove_error: 'Failed to remove label',
    builder_label_updated: 'Label updated',
    builder_update_error: 'Failed to update label',
    builder_id_required: 'Label ID is required',
    builder_invalid_id: 'Invalid Label ID format',
    builder_text_required: 'Label text is required',
    builder_conflict_skipped: 'Kept existing label',
    builder_conflict_overwritten: 'Label overwritten',
    builder_conflict_renamed: 'Added with renamed ID',
    builder_conflict_error: 'Failed to resolve conflict',
    builder_clear_confirm: 'Clear all labels from workspace?',
    builder_cleared: 'Workspace cleared',
    builder_clear_error: 'Failed to clear workspace',
    builder_empty: 'No labels to export',
    builder_download_complete: 'Downloaded label file',
    builder_download_same_confirm: 'You already downloaded this exact version. Download again?',
    builder_download_same_disable_confirm: 'Stop showing this repeated-download warning?',
    builder_export_translate_hint: 'Translation options are configured at export time.',
    builder_export_translate_prompt: 'Do you want to generate translated versions during export?',
    builder_export_targets_prompt: 'Enter target languages separated by commas (example: en-US,es-ES,fr-FR):',
    builder_export_no_targets: 'No target languages were provided.',
    builder_export_no_pairs: 'No valid source/target translation pairs were found.',
    builder_export_translating: 'Translating labels for export...',
    builder_export_translation_done: '{count} translated labels prepared for export.',
    builder_undo_empty: 'Nothing to undo in Builder.',
    builder_undo_done: 'Last Builder change reverted.',
    
    // Export Modal
    export_title: 'Export Labels',
    export_source_language: 'Source Language',
    export_target_languages: 'Target Languages (Auto-Translation)',
    export_translation_hint: 'Select additional languages to generate translated versions.',
    export_ai_not_ready: 'AI translation is not ready. Download the model in Settings (Alt+P) to enable auto-translation.',
    export_file_prefix: 'File Prefix',
    export_prefix_hint: 'Output: {Prefix}.{culture}.label.txt',
    btn_export_labels: 'Export Labels',
    btn_generate_export: 'Generate & Export',
    export_no_languages: 'Select at least one language',
    export_preparing: 'Preparing labels...',
    export_translating: 'Translating labels...',
    export_generating: 'Generating files...',
    export_packaging: 'Packaging files...',
    export_complete: 'Export complete!',
    export_success_single: 'Exported {count} labels ({culture})',
    export_success_zip: 'Exported {count} labels in {files} files (ZIP)',
    export_error: 'Export failed',
    
    // New Label Modal
    new_label_title: 'Create New Label',
    edit_label_title: 'Edit Label',
    label_id: 'Label ID',
    label_id_hint: 'Unique identifier (e.g., MyModule_FieldName)',
    label_text: 'Text',
    label_text_hint: 'The label text content',
    label_help: 'Help Text (optional)',
    label_help_text: 'Help Text (optional)',
    label_help_hint: 'Additional help/description',
    label_prefix: 'Prefix (optional)',
    label_prefix_hint: 'File prefix (e.g., @MyModule)',
    btn_cancel: 'Cancel',
    btn_add: 'Add Label',
    btn_save: 'Save',
    
    // Conflict Modal
    conflict_title: 'Label ID Conflict',
    conflict_description: 'A label with this ID already exists with different content.',
    existing_version: 'Existing Version',
    incoming_version: 'New Version',
    btn_skip: 'Skip (Keep Existing)',
    btn_rename: 'Auto-Rename',
    btn_edit_manual: 'Edit Manually',
    btn_overwrite: 'Overwrite',
    
    // Merger Modal
    merger_title: 'Merge & Sort Label Files',
    merger_drop_hint: 'Drag & drop .label.txt files here',
    or: 'or',
    btn_select_files: 'Select Files',
    files_to_merge: 'Files to Merge',
    btn_add_more: 'Add More Files',
    btn_clear_all: 'Clear All',
    total_labels: 'Total Labels',
    duplicates_removed: 'Duplicates Removed',
    conflicts_found: 'Conflicts',
    resolve_conflicts: 'Resolve Conflicts',
    conflicts_hint: 'These label IDs have different text in different files. Choose which version to keep.',
    preview: 'Preview',
    btn_back: 'Back',
    btn_merge: 'Merge Files',
    btn_download: 'Download Merged File',
    merging: 'Merging...',
    merger_error_no_label_files: 'Please select .label.txt files',
    merger_error_min_files: 'Please select at least 2 files to merge',
    merger_error_generic: 'Merge failed. Please try again.',
    merger_download_complete: 'Downloaded merged file with {count} labels'
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
    // SPEC-35: AI & Intelligence
    ai_settings_title: '✨ IA & Inteligência',
    ai_enable_local: 'Ativar Inteligência Local com IA',
    ai_enable_hint: 'Habilita tradução local e sugestão semântica de IDs. O download inicial do modelo ficará no cache do navegador.',
    ai_download_model: 'Baixar Modelo de IA',
    ai_status_inactive: 'Inativo',
    ai_status_downloading: 'Baixando...',
    ai_status_ready: 'Pronto',
    ai_progress_ready: 'Pronto',
    ai_phase_downloading: 'Baixando',
    ai_phase_indexing: 'Indexando',
    ai_semantic_id: 'Sugestão Semântica de ID',
    ai_auto_translate_discovery: 'Auto-Traduzir na Descoberta',
    ai_auto_translate_btn: 'Auto-Traduzir',
    ai_translation_source: 'Origem',
    ai_translation_targets: 'Destinos',
    ai_translation_idle: 'Tradução IA',
    ai_translation_running: 'Traduzindo',
    ai_translation_progress: 'Traduzindo {current}/{total}',
    ai_translation_initializing: 'Inicializando engine de tradução...',
    ai_translation_complete: 'Tradução concluída',
    ai_translation_done_toast: '{count} entradas traduzidas com sugestões de IA.',
    ai_translation_error: 'Falha na tradução por IA.',
    ai_translation_requires_ready: 'Ative e prepare a IA local para usar Auto-Traduzir.',
    ai_translation_select_target: 'Selecione ao menos um idioma de destino.',
    ai_translation_no_source_labels: 'Nenhum label encontrado para o idioma de origem selecionado.',
    ai_translation_nothing_to_do: 'Não há pares pendentes para tradução.',
    ai_generated_badge: 'Sugestão gerada por IA',
    ai_language_pair: 'Par de Tradução Padrão',
    ai_lang_auto: 'Detecção automática',
    ai_locked_hint: 'As opções de IA são desbloqueadas após ativar a IA local e concluir o download do modelo.',
    ai_clear_cache: 'Limpar Cache de IA',
    ai_enable_first: 'Ative a Inteligência Local com IA primeiro.',
    ai_download_required: 'IA ativada. Baixe o modelo local para desbloquear recursos avançados.',
    ai_ready_toast: '✨ Inteligência de IA pronta! Recursos avançados desbloqueados.',
    ai_cache_cleared: 'Cache de IA limpo.',
    ai_clear_confirm: 'Limpar o cache local do modelo de IA?',
    ai_error_generic: 'Falha ao inicializar o modelo local de IA.',
    
    // Item Selector Modal
    select_items: 'Selecionar Itens',
    search_items: 'Buscar...',
    btn_toggle_select_all: 'Selecionar Todos',
    btn_toggle_deselect_all: 'Desmarcar Todos',
    btn_done: 'Concluído',
    
    // Common Actions
    edit: 'Editar',
    delete: 'Excluir',
    close: 'Fechar',
    
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
    shortcut_add_builder: 'Adicionar ao Builder',
    shortcut_remove_builder: 'Remover item selecionado do Builder',
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
    background_indexing_complete: 'Indexação em segundo plano concluída!',
    models_suffix: 'modelos',
    
    // SPEC-36: Tools Menu & Merger
    btn_tools: 'Ferramentas',
    tools_title: 'Ferramentas de Desenvolvimento',
    tool_merger: 'Mesclar & Ordenar Labels',
    tool_merger_desc: 'Combine múltiplos arquivos de label, remova duplicatas e ordene alfabeticamente',
    tool_builder: 'Construtor de Labels',
    tool_builder_desc: 'Crie e edite coleções de labels com resolução de conflitos',
    tool_extractor: 'Extrator de Strings',
    tool_extractor_desc: 'Extraia strings fixas de arquivos de projeto D365FO',
    extractor_title: 'Extrator de Strings Hardcoded',
    extractor_hint: 'Selecione arquivos .xml/.xpp (ou .rnrproj com arquivos relacionados) para extrair candidatos.',
    extractor_start_scan: 'Escanear Candidatos',
    extractor_save_session: 'Salvar Sessão',
    extractor_resume_session: 'Retomar Última Sessão',
    extractor_add_all: 'Adicionar Todos ao Builder',
    extractor_summary: '{files} arquivos carregados • {candidates} pendentes • {confirmed} confirmados • {ignored} ignorados',
    extractor_files_loaded: '{count} arquivos carregados para extração',
    extractor_scan_complete: 'Scan concluído',
    extractor_found_candidates: '{count} candidatos de string encontrados',
    extractor_scan_error: 'Falha ao escanear arquivos para strings hardcoded',
    extractor_select_files_error: 'Selecione ao menos um arquivo .xml ou .xpp',
    extractor_confirm_new: 'Confirmar Novo',
    extractor_ignore: 'Ignorar',
    extractor_session_saved: 'Sessão de extração salva',
    extractor_session_save_error: 'Falha ao salvar sessão de extração',
    extractor_no_session: 'Nenhuma sessão de extração salva encontrada',
    extractor_session_resumed: 'Sessão de extração retomada',
    extractor_session_load_error: 'Falha ao carregar sessão de extração',
    extractor_project_loaded: 'Projeto carregado: {name} ({files} arquivos)',
    extractor_existing_label: 'Label existente encontrada: {fullId}',
    extractor_use_existing: 'Usar Existente',
    extractor_ai_suggestions: 'Gerando sugestões semânticas de ID...',
    extractor_project_files: 'Arquivos do Projeto',
    extractor_candidates: 'Candidatos de String',
    extractor_no_files: 'Nenhum arquivo carregado',
    extractor_select_hint: 'Selecione um arquivo .rnrproj ou arquivos .xml/.xpp para começar.',
    extractor_no_candidates: 'Nenhum candidato ainda',
    extractor_scan_hint: 'Carregue arquivos e clique em Escanear para encontrar strings fixas.',
    extractor_strings_found: 'strings encontradas',
    extractor_resolved: 'resolvidos',
    extractor_ignored: 'ignorados',
    extractor_auto_save: 'Salvar automaticamente',
    extractor_apply: 'Aplicar Alterações',
    extractor_resume_prompt: 'Continuar "{name}"? ({remaining} strings restantes)',
    extractor_no_confirmed: 'Nenhum label confirmado para aplicar',
    extractor_applied: '{count} labels adicionados ao Builder',
    extractor_project_error: 'Falha ao carregar arquivo do projeto',
    btn_select_project: '.rnrproj',
    btn_close: 'Fechar',
    
    // Builder Modal
    builder_title: 'Construtor de Labels',
    builder_new_label: 'Novo Label',
    builder_tip: 'Dica: Pressione <kbd>+</kbd> em qualquer card para adicionar aqui.',
    builder_direct_save_warning: 'Atenção: modo de edição direta ativo. Alterações podem afetar arquivos originais.',
    builder_direct_save_mode: 'Ativar modo Direct Save do Builder',
    builder_direct_save_hint: 'Permite edição direta de arquivos pelo Builder. Desative para usar apenas o modo seguro por download.',
    builder_direct_save_confirm: 'Direct Save vai atualizar {files} arquivo(s) com {labels} label(s). Continuar?',
    builder_direct_save_preflight: 'Pre-flight check: preparando gravação direta em {files} arquivo(s) com {labels} label(s).',
    builder_direct_save_complete: 'Direct Save concluído: {files} arquivo(s) atualizados • {added} adicionados • {updated} atualizados • {skipped} sem alteração',
    builder_direct_save_error: 'Falha ao salvar labels diretamente nos arquivos de origem',
    builder_direct_save_permission_denied: 'Permissão de escrita negada para Direct Save',
    builder_direct_save_ambiguous_target: 'Múltiplos arquivos de destino encontrados para {prefix}.{culture} ({count} correspondências). Refine os labels antes do Direct Save.',
    builder_direct_save_target_not_found: 'Arquivo de destino não encontrado para {prefix}.{culture}. Refaça o scan da pasta ou use modo Download.',
    builder_direct_save_missing_prefix: 'Direct Save exige prefixo e cultura em todos os labels.',
    builder_empty_title: 'Nenhum label no workspace',
    builder_empty_hint: 'Adicione labels dos resultados de busca usando o botão ➕, ou crie novos labels manualmente.',
    builder_count: '{count} labels',
    btn_new_label: 'Novo Label',
    btn_clear_workspace: 'Limpar Todos',
    btn_download_file: 'Baixar .label.txt',
    builder_duplicate_skipped: 'Label já existe no workspace',
    builder_label_added: 'Label adicionado ao construtor',
    builder_add_error: 'Falha ao adicionar label',
    builder_label_removed: 'Label removido do workspace',
    builder_remove_error: 'Falha ao remover label',
    builder_label_updated: 'Label atualizado',
    builder_update_error: 'Falha ao atualizar label',
    builder_id_required: 'ID do label é obrigatório',
    builder_invalid_id: 'Formato de ID inválido',
    builder_text_required: 'Texto do label é obrigatório',
    builder_conflict_skipped: 'Mantido label existente',
    builder_conflict_overwritten: 'Label sobrescrito',
    builder_conflict_renamed: 'Adicionado com ID renomeado',
    builder_conflict_error: 'Falha ao resolver conflito',
    builder_clear_confirm: 'Limpar todos os labels do workspace?',
    builder_cleared: 'Workspace limpo',
    builder_clear_error: 'Falha ao limpar workspace',
    builder_empty: 'Nenhum label para exportar',
    builder_download_complete: 'Arquivo de label baixado',
    builder_download_same_confirm: 'Você já baixou exatamente esta versão. Deseja baixar novamente?',
    builder_download_same_disable_confirm: 'Parar de mostrar este aviso de download repetido?',
    builder_export_translate_hint: 'As opções de tradução são definidas na etapa de exportação.',
    builder_export_translate_prompt: 'Deseja gerar versões traduzidas durante a exportação?',
    builder_export_targets_prompt: 'Informe idiomas de destino separados por vírgula (exemplo: en-US,es-ES,fr-FR):',
    builder_export_no_targets: 'Nenhum idioma de destino foi informado.',
    builder_export_no_pairs: 'Nenhum par válido de tradução origem/destino foi encontrado.',
    builder_export_translating: 'Traduzindo labels para exportação...',
    builder_export_translation_done: '{count} labels traduzidos preparados para exportação.',
    builder_undo_empty: 'Nada para desfazer no Builder.',
    builder_undo_done: 'Última alteração do Builder revertida.',
    
    // Export Modal
    export_title: 'Exportar Labels',
    export_source_language: 'Idioma de Origem',
    export_target_languages: 'Idiomas de Destino (Tradução Automática)',
    export_translation_hint: 'Selecione idiomas adicionais para gerar versões traduzidas.',
    export_ai_not_ready: 'Tradução por IA não está pronta. Baixe o modelo em Configurações (Alt+P) para habilitar a tradução automática.',
    export_file_prefix: 'Prefixo do Arquivo',
    export_prefix_hint: 'Saída: {Prefixo}.{cultura}.label.txt',
    btn_export_labels: 'Exportar Labels',
    btn_generate_export: 'Gerar & Exportar',
    export_no_languages: 'Selecione pelo menos um idioma',
    export_preparing: 'Preparando labels...',
    export_translating: 'Traduzindo labels...',
    export_generating: 'Gerando arquivos...',
    export_packaging: 'Empacotando arquivos...',
    export_complete: 'Exportação concluída!',
    export_success_single: '{count} labels exportados ({culture})',
    export_success_zip: '{count} labels exportados em {files} arquivos (ZIP)',
    export_error: 'Falha na exportação',
    
    // New Label Modal
    new_label_title: 'Criar Novo Label',
    edit_label_title: 'Editar Label',
    label_id: 'ID do Label',
    label_id_hint: 'Identificador único (ex: MeuModulo_NomeCampo)',
    label_text: 'Texto',
    label_text_hint: 'Conteúdo do texto do label',
    label_help: 'Texto de Ajuda (opcional)',
    label_help_text: 'Texto de Ajuda (opcional)',
    label_help_hint: 'Descrição/ajuda adicional',
    label_prefix: 'Prefixo (opcional)',
    label_prefix_hint: 'Prefixo do arquivo (ex: @MeuModulo)',
    btn_cancel: 'Cancelar',
    btn_add: 'Adicionar Label',
    btn_save: 'Salvar',
    
    // Conflict Modal
    conflict_title: 'Conflito de ID de Label',
    conflict_description: 'Um label com este ID já existe com conteúdo diferente.',
    existing_version: 'Versão Existente',
    incoming_version: 'Nova Versão',
    btn_skip: 'Pular (Manter Existente)',
    btn_rename: 'Renomear Automaticamente',
    btn_edit_manual: 'Editar Manualmente',
    btn_overwrite: 'Sobrescrever',
    
    // Merger Modal
    merger_title: 'Mesclar & Ordenar Arquivos de Label',
    merger_drop_hint: 'Arraste e solte arquivos .label.txt aqui',
    or: 'ou',
    btn_select_files: 'Selecionar Arquivos',
    files_to_merge: 'Arquivos para Mesclar',
    btn_add_more: 'Adicionar Mais',
    btn_clear_all: 'Limpar Todos',
    total_labels: 'Total de Labels',
    duplicates_removed: 'Duplicatas Removidas',
    conflicts_found: 'Conflitos',
    resolve_conflicts: 'Resolver Conflitos',
    conflicts_hint: 'Estes IDs de label têm textos diferentes em arquivos diferentes. Escolha qual versão manter.',
    preview: 'Visualização',
    btn_back: 'Voltar',
    btn_merge: 'Mesclar Arquivos',
    btn_download: 'Baixar Arquivo Mesclado',
    merging: 'Mesclando...',
    merger_error_no_label_files: 'Por favor, selecione arquivos .label.txt',
    merger_error_min_files: 'Por favor, selecione pelo menos 2 arquivos para mesclar',
    merger_error_generic: 'Falha na mesclagem. Tente novamente.',
    merger_download_complete: 'Arquivo mesclado baixado com {count} labels'
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
