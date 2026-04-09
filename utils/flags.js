/**
 * Runtime feature flags (localStorage-based).
 * Default is OFF unless explicitly enabled with value "1".
 */
export const FLAGS = Object.freeze({
  // Fase 1: DB
  USE_SHARED_DB_CONNECTION: localStorage.getItem('ff_shared_db') === '1',
  // Fase 2: Parser
  USE_SHARED_PARSER: localStorage.getItem('ff_shared_parser') === '1',
  // Fase 3: Store
  USE_STORE_MODULE: localStorage.getItem('ff_store') === '1',
  // Fase 4: UI modules
  USE_BUILDER_MODULE: localStorage.getItem('ff_builder') === '1',
  // Fase 4: Resilience
  USE_MANAGED_TRANSLATOR_WORKER: localStorage.getItem('ff_managed_translator_worker') === '1',
  // Fase 5: DOM
  USE_FRAGMENT_RENDER: localStorage.getItem('ff_fragment') === '1',
  // Fase 7: Performance
  USE_L1_SEARCH_CACHE: localStorage.getItem('ff_search_cache') === '1',
  USE_OPFS_CACHE: localStorage.getItem('ff_opfs') === '1',
  USE_TAB_SYNC: localStorage.getItem('ff_tab_sync') === '1',
  USE_DB_WRITE_LOCKS: localStorage.getItem('ff_db_write_lock') === '1',
  USE_SEARCH_PREFETCH: localStorage.getItem('ff_search_prefetch') === '1'
});

