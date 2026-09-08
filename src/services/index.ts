/**
 * Point d'entree centralise pour tous les services
 */

// Core
export { storageAdapter, folderService, fileService, versionService, trashCleanupService } from './core';

// Auth
export { authApiService, encryptionService, filePasswordService } from './auth';

// Network
export { apiClient, connectionMonitor, rateLimiter } from './network';

// Search
export { searchService, filterService } from './search';

// Platform
export { themeService, shortcutsService, errorService, qaService } from './platform';
