/**
 * Centralised service exports.
 *
 * Network and cloud-auth services have been removed for the public release;
 * the auth surface here covers the local crypto path only.
 */

// Core
export { storageAdapter, folderService, fileService, versionService, trashCleanupService } from './core';

// Auth (local crypto only)
export { encryptionService, filePasswordService } from './auth';

// Search
export { searchService, filterService } from './search';

// Platform
export { themeService, shortcutsService, errorService, qaService } from './platform';
