/**
 * Database Proxy - SPEC-11: SQLite WASM + Streaming Migration
 * Redirects all data operations to core/sqlite-db.js
 * Explicitly maps exports for maximum browser compatibility.
 */
import * as SQLiteDB from './sqlite-db.js';

export const initDB = SQLiteDB.initDB;
export const getDB = SQLiteDB.getDB;
export const getRuntimeStorageMode = SQLiteDB.getRuntimeStorageMode;
export const addLabels = SQLiteDB.addLabels;
export const addLabelsWithLock = SQLiteDB.addLabelsWithLock;
export const getLabels = SQLiteDB.getLabels;
export const getLabelById = SQLiteDB.getLabelById;
export const getAllLabels = SQLiteDB.getAllLabels;
export const getLabelCount = SQLiteDB.getLabelCount;
export const getAllCultures = SQLiteDB.getAllCultures;
export const getAllModels = SQLiteDB.getAllModels;
export const clearLabels = SQLiteDB.clearLabels;
export const setMetadata = SQLiteDB.setMetadata;
export const saveMetadata = SQLiteDB.saveMetadata;
export const getMetadata = SQLiteDB.getMetadata;
export const saveCatalog = SQLiteDB.saveCatalog;
export const updateCatalogStatus = SQLiteDB.updateCatalogStatus;
export const updateCatalogProgress = SQLiteDB.updateCatalogProgress;
export const updateCatalogProgressBatch = SQLiteDB.updateCatalogProgressBatch;
export const getCatalog = SQLiteDB.getCatalog;
export const getCatalogByStatus = SQLiteDB.getCatalogByStatus;
export const clearCatalog = SQLiteDB.clearCatalog;
export const addBuilderLabel = SQLiteDB.addBuilderLabel;
export const updateBuilderLabel = SQLiteDB.updateBuilderLabel;
export const removeBuilderLabel = SQLiteDB.removeBuilderLabel;
export const getBuilderLabels = SQLiteDB.getBuilderLabels;
export const clearBuilderWorkspace = SQLiteDB.clearBuilderWorkspace;
export const getBuilderCount = SQLiteDB.getBuilderCount;
export const findBuilderLabelById = SQLiteDB.findBuilderLabelById;
export const saveExtractionSession = SQLiteDB.saveExtractionSession;
export const getExtractionSession = SQLiteDB.getExtractionSession;
export const getExtractionSessions = SQLiteDB.getExtractionSessions;
export const removeExtractionSession = SQLiteDB.removeExtractionSession;
export const saveBuilderSession = SQLiteDB.saveBuilderSession;
export const getBuilderSessions = SQLiteDB.getBuilderSessions;
export const getBuilderSession = SQLiteDB.getBuilderSession;
export const removeBuilderSession = SQLiteDB.removeBuilderSession;
export const saveExtractionBackup = SQLiteDB.saveExtractionBackup;
export const getExtractionBackups = SQLiteDB.getExtractionBackups;
export const pruneExtractionBackups = SQLiteDB.pruneExtractionBackups;
export const saveBloomFilter = SQLiteDB.saveBloomFilter;
export const getBloomFilter = SQLiteDB.getBloomFilter;
export const getLabelsByIds = SQLiteDB.getLabelsByIds;
export const saveDirectoryHandle = SQLiteDB.saveDirectoryHandle;
export const getSavedDirectoryHandle = SQLiteDB.getSavedDirectoryHandle;
export const hasData = SQLiteDB.hasData;
export const searchFTS = SQLiteDB.searchFTS;
export const STORES = SQLiteDB.STORES;
export const DB_NAME = SQLiteDB.DB_NAME;
export const DB_VERSION = SQLiteDB.DB_VERSION;
