/**
 * Types globaux de l'application
 */

import { SerializedError } from '@reduxjs/toolkit';

// ==================== DOMAIN TYPES ====================

// Types pour les dossiers
export interface Folder {
  id: string;
  name: string;
  color: string;
  items: string[]; // Array of item IDs (files or folders)
  parentId?: string | null;
  protected?: boolean;
  password?: string;
  createdAt?: string;
  updatedAt?: string;
  date?: string;
  description?: string;
  reminders?: Reminder[];
  deletedAt?: string; // Date when item was moved to trash
}

// Types pour les fichiers
export interface FileItem {
  id: string;
  name: string;
  type: string;
  size: number;
  encryptedData?: string;
  iv?: string;
  parentId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  date?: string;
  description?: string;
  content?: ArrayBuffer | string;
  deletedAt?: string; // Date when item was moved to trash
}

// Type union pour les items (fichiers ou dossiers)
export type Item = FileItem | Folder;

// Guards de type
export function isFolder(item: Item | any): item is Folder {
  return item && 'items' in item && Array.isArray(item.items);
}

export function isFile(item: Item | any): item is FileItem {
  return item && ('encryptedData' in item || ('size' in item && typeof item.size === 'number'));
}

// Types pour les rappels
export interface Reminder {
  id: string;
  itemId: string;
  itemName: string;
  itemType: 'file' | 'folder';
  date: string;
  message?: string;
  priority?: 'low' | 'normal' | 'high';
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly';
  completed?: boolean;
  read?: boolean;
  snoozedUntil?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ==================== USER & AUTH TYPES ====================

export interface User {
  id: string;
  name: string;
  email: string;
  role?: 'user' | 'admin' | 'premium';
  permissions?: string[];
  avatarUrl?: string;
  subscription?: UserSubscription;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserSubscription {
  plan: 'free' | 'premium' | 'business';
  status: 'active' | 'inactive' | 'cancelled' | 'expired';
  startDate: string;
  endDate?: string;
  autoRenew: boolean;
}

// Types pour l'authentification
export interface AuthState {
  isAuthenticated: boolean;
  loading: boolean;
  localProfile: {
    name: string;
    avatarColor: string;
    createdAt: string;
    pinHash?: string;
  } | null;
  isLocked: boolean;
}

// ==================== REDUX STATE TYPES ====================

// Types pour le store Redux
export interface RootState {
  folders: FoldersState;
  files: FilesState;
  ui: UIState;
  auth: AuthState;
  search: SearchState;
}

export interface FoldersState {
  byId: Record<string, Folder>;
  allIds: string[];
  currentFolderId: string | null;
  loading: boolean;
  error: SerializedError | null;
  lastModified: string | null;
}

export interface FilesState {
  byId: Record<string, FileItem>;
  allIds: string[];
  selectedIds: string[];
  loading: boolean;
  error: SerializedError | null;
  uploadProgress: Record<string, number>;
  downloadProgress: Record<string, number>;
}

export interface UIState {
  theme: 'light' | 'dark' | 'custom';
  customTheme: Record<string, string> | null;
  sidebarOpen: boolean;
  viewMode: ViewMode;
  itemsPerPage: number;
  sortBy: { field: SortOption; order: SortDirection };
  modal: {
    isOpen: boolean;
    type: string | null;
    props: Record<string, any>;
  };
  notifications: UINotification[];
  dragAndDrop: {
    isDragging: boolean;
    draggedItemId: string | null;
    dropTargetId: string | null;
  };
  operations: {
    inProgress: boolean;
    type: string | null;
    progress: number;
    message: string | null;
  };
}

export interface UINotification {
  id: number | string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
  autoClose?: boolean;
  timestamp?: string;
  actions?: any[];
  metadata?: Record<string, any>;
}

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'success';
  lastSyncTime: string | null;
  pendingChanges: number;
  progress: number;
  error: SerializedError | null;
  syncedItems: string[];
  conflicts: SyncConflict[];
  settings: SyncSettings;
}

export interface SyncConflict {
  id: string;
  itemId: string;
  itemType: 'file' | 'folder';
  localVersion: Item;
  remoteVersion: Item;
  timestamp: string;
  resolved: boolean;
  resolution?: 'local' | 'remote' | 'merge';
}

export interface SyncSettings {
  enabled: boolean;
  autoSync: boolean;
  syncInterval: number;
  conflictResolution: 'manual' | 'local' | 'remote' | 'newest';
}

export interface SearchState {
  query: string;
  results: SearchResult[];
  selectedResultId: string | null;
  loading: boolean;
  error: SerializedError | null;
  filters: SearchFilters;
  searchOptions: SearchOptions;
  history: string[];
  sortOrder: SortOrder;
  pagination: Pagination;
}

export interface SearchResult {
  id: string;
  type: 'file' | 'folder';
  item: Item;
  relevance: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  field: string;
  value: string;
  start: number;
  end: number;
}

export interface SearchFilters {
  type?: 'file' | 'folder' | 'all';
  dateFrom?: string;
  dateTo?: string;
  sizeMin?: number;
  sizeMax?: number;
  tags?: string[];
  protected?: boolean;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  includeContent: boolean;
}

export interface SortOrder {
  field: 'relevance' | 'name' | 'date' | 'size';
  direction: SortDirection;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

// ==================== ERROR TYPES ====================

// Types pour les erreurs
export interface AppError {
  code: string;
  message: string;
  details?: Record<string, any>;
  metadata?: Record<string, any>;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  timestamp?: string;
  stack?: string;
}

// ==================== ENCRYPTION TYPES ====================

export interface EncryptionOptions {
  password?: string;
  algorithm?: string;
  keyLength?: number;
}

export interface EncryptedData {
  data: string;
  iv: string;
  authTag?: string;
}

// ==================== STORAGE TYPES ====================

export interface StorageOptions {
  type: 'local' | 'cloud';
  path?: string;
  cloudProvider?: 'aws' | 'azure' | 'gcp';
}

// ==================== UI TYPES ====================

// Types pour les options de vue
export type ViewMode = 'grid' | 'list';
export type SortOption = 'name' | 'date' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';

// Types pour le contexte de menu
export interface ContextMenuOptions {
  x: number;
  y: number;
  options: ContextMenuItem[];
  onOptionSelect: (option: string, item?: Item) => void;
  item?: Item;
}

export interface ContextMenuItem {
  id?: string;
  label?: string;
  icon?: string;
  disabled?: boolean;
  divider?: boolean;
  onClick?: () => void;
}

// Types pour le fil d'Ariane
export interface BreadcrumbItem {
  id: string;
  name: string;
  path?: string;
}

// Types pour les progrès d'upload/download
export interface ProgressState {
  [itemId: string]: number;
}

// ==================== CONFIG TYPES ====================

export interface AppConfig {
  // Stockage
  useCloudStorage: boolean;
  cloudStorageUrl: string;
  authToken: string | null;

  // Interface utilisateur
  theme: 'light' | 'dark' | 'system';
  language: string;

  // Fonctionnalités
  enableNotifications: boolean;
  enableAutoSave: boolean;
  autoSaveInterval: number;

  // Sécurité
  encryptionEnabled: boolean;
  encryptionAlgorithm: string;

  // Synchronisation
  syncEnabled: boolean;
  syncInterval: number;

  // Développement
  isDevelopment: boolean;
  debugMode: boolean;
}

// ==================== SERVICE INTERFACES ====================

export interface IFolderService {
  getAllFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder | null>;
  createFolder(data: FolderCreateData): Promise<Folder>;
  updateFolder(id: string, data: Partial<Folder>): Promise<Folder>;
  deleteFolder(id: string): Promise<boolean>;
  addItemToFolder(folderId: string, itemId: string): Promise<Folder>;
  removeItemFromFolder(folderId: string, itemId: string): Promise<Folder>;
}

export interface IFileService {
  addFileToFolder(folderId: string, fileData: FileCreateData): Promise<FileItem>;
  deleteFile(folderId: string, fileId: string): Promise<boolean>;
  renameFile(folderId: string, fileId: string, newName: string): Promise<FileItem>;
  readFile(folderId: string, fileId: string): Promise<ArrayBuffer>;
  downloadFile(fileId: string): Promise<DownloadResult>;
  updateFileMetadata(fileId: string, metadata: Partial<FileItem>): Promise<FileItem>;
}

export interface IReminderService {
  getAllReminders(): Promise<Reminder[]>;
  getReminders(itemId: string): Promise<Reminder[]>;
  addReminder(itemId: string, data: Partial<Reminder>): Promise<Reminder>;
  updateReminder(itemId: string, reminderId: string, data: Partial<Reminder>): Promise<Reminder>;
  deleteReminder(itemId: string, reminderId: string): Promise<boolean>;
  markAsRead(reminderId: string): Promise<Reminder>;
  snoozeReminder(reminderId: string, until: string): Promise<Reminder>;
}

export interface IEncryptionService {
  encrypt(data: string | Buffer, password: string): Promise<EncryptedData>;
  decrypt(encryptedData: string, iv: string, password: string): Promise<Buffer>;
  deriveKey(password: string, salt?: Buffer): Promise<{ key: Buffer; salt: Buffer }>;
  verifyPassword(password: string, encryptedData: string, iv: string): Promise<boolean>;
}

/**
 * Storage Implementation Interface
 * Defines the contract for storage implementations (Electron, Cloud, etc.)
 */
export interface IStorageImplementation {
  saveFolder(folder: Folder): Promise<Folder>;
  getFolders(): Promise<Folder[]>;
  getFolder(id: string): Promise<Folder>;
  updateFolder(id: string, updatedFolder: Folder): Promise<Folder>;
  deleteFolder(id: string, permanent?: boolean): Promise<boolean>;
  addItemToFolder(folderId: string, item: Item): Promise<Folder>;
  removeItemFromFolder(folderId: string, itemId: string): Promise<Folder>;
  renameItem(parentId: string, itemId: string, oldName: string, newName: string): Promise<boolean>;
  readEncryptedFile(
    folderId: string,
    fileName: string,
    onProgress?: (percent: number) => void
  ): Promise<Buffer>;
  saveEncryptedFile(folderId: string, fileName: string, content: Buffer): Promise<void>;
  addReminder(itemId: string, reminder: Reminder): Promise<Reminder>;
  updateReminder(
    itemId: string,
    reminderId: string,
    updatedReminder: Partial<Reminder>
  ): Promise<Reminder>;
  deleteReminder(itemId: string, reminderId: string): Promise<boolean>;
  getAllReminders(): Promise<Reminder[]>;
  getReminders(itemId: string): Promise<Reminder[]>;
  getItem(id: string): Promise<Item>;
  updateItemInFolder(
    folderId: string | null,
    itemId: string,
    itemData: Partial<Item>
  ): Promise<Item>;
  moveItem(itemId: string, sourceFolderId: string, targetFolderId: string): Promise<MoveResult>;
  copyItem(
    itemId: string,
    sourceFolderId: string,
    targetFolderId: string,
    newName?: string
  ): Promise<CopyResult>;
}

/**
 * Folder creation data interface
 */
export interface FolderCreateData {
  id?: string;
  name: string;
  color?: string;
  items?: Item[];
  reminders?: Reminder[];
  parentId?: string | null;
  date?: string;
  description?: string;
  protected?: boolean;
  password?: string;
}

/**
 * File creation data interface
 */
export interface FileCreateData {
  id?: string;
  name: string;
  type?: string;
  size?: number;
  content?: Buffer;
  date?: string;
  description?: string;
  protected?: boolean;
  password?: string;
}

/**
 * Download result interface
 */
export interface DownloadResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
}

/**
 * Move result interface
 */
export interface MoveResult {
  sourceFolder: Folder;
  targetFolder: Folder;
}

/**
 * Copy result interface
 */
export interface CopyResult {
  targetFolder: Folder;
  newItem: Item;
}

/**
 * Breadcrumb path item
 */
export interface PathItem {
  id: string;
  name: string;
}

// ==================== PREMIUM FEATURES TYPES ====================

/**
 * Auto-Tagging Types
 */
export interface Tag {
  id: string;
  name: string;
  color?: string;
  category?: string;
  createdAt?: string;
}

export interface TagSuggestion {
  tag: string;
  confidence: number;
  reason: string;
  category?: string;
}

export interface AutoTaggingResult {
  fileId: string;
  suggestions: TagSuggestion[];
  appliedTags: Tag[];
  documentType?: DocumentType;
}

export type DocumentType =
  | 'invoice'
  | 'contract'
  | 'receipt'
  | 'report'
  | 'presentation'
  | 'spreadsheet'
  | 'image'
  | 'photo'
  | 'document'
  | 'other';

export interface DocumentPattern {
  type: DocumentType;
  keywords: string[];
  patterns: RegExp[];
  fileTypes: string[];
}

/**
 * Smart Search Types (Enhanced)
 */
export interface SearchIndex {
  fileId: string;
  fileName: string;
  folderPath: string;
  content: string;
  tags: string[];
  metadata: Record<string, any>;
  lastIndexed: string;
}

export interface NaturalLanguageQuery {
  originalQuery: string;
  parsedFilters: {
    fileTypes?: string[];
    dateRange?: { start: Date; end: Date };
    tags?: string[];
    keywords?: string[];
  };
  searchTerms: string[];
}

/**
 * Smart Folders Types
 */
export interface SmartFolder {
  id: string;
  name: string;
  color?: string;
  rules: SmartFolderRule[];
  actions: SmartFolderAction[];
  enabled: boolean;
  lastRun?: string;
  matchCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmartFolderRule {
  id: string;
  type: RuleType;
  condition: RuleCondition;
  value: any;
  operator: RuleOperator;
}

export type RuleType =
  | 'fileName'
  | 'fileType'
  | 'fileSize'
  | 'dateCreated'
  | 'dateModified'
  | 'hasTag'
  | 'ocrContent'
  | 'fileExtension'
  | 'folderPath';

export type RuleCondition = 'AND' | 'OR';

export type RuleOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'matches' // regex
  | 'greaterThan'
  | 'lessThan'
  | 'between'
  | 'inRange'
  | 'in'
  | 'notIn'
  | 'isEmpty'
  | 'isNotEmpty';

export interface SmartFolderAction {
  id: string;
  type: ActionType;
  params: Record<string, any>;
}

export type ActionType =
  | 'moveToFolder'
  | 'copyToFolder'
  | 'addTag'
  | 'removeTag'
  | 'setReminder'
  | 'sendNotification'
  | 'archive';

export interface SmartFolderTemplate {
  name: string;
  description: string;
  rules: Omit<SmartFolderRule, 'id'>[];
  actions: Omit<SmartFolderAction, 'id'>[];
}

/**
 * Background Processing Types
 */
export interface BackgroundTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  error?: string;
  result?: any;
  metadata: Record<string, any>;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedTime?: number;
}

export type TaskType = 'ocr' | 'autoTag' | 'smartFolder' | 'indexing' | 'bulkOperation';

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';

export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskQueue {
  tasks: BackgroundTask[];
  running: BackgroundTask[];
  completed: BackgroundTask[];
  failed: BackgroundTask[];
}

/**
 * Premium Settings Types
 */
export interface PremiumSettings {
  ocr: {
    enabled: boolean;
    autoProcess: boolean;
    languages: string[];
    defaultLanguage: string;
  };
  autoTagging: {
    enabled: boolean;
    autoApply: boolean;
    minConfidence: number;
    enableLearning: boolean;
  };
  smartSearch: {
    enabled: boolean;
    indexContent: boolean;
    fuzzyMatching: boolean;
    naturalLanguage: boolean;
  };
  smartFolders: {
    enabled: boolean;
    autoExecute: boolean;
    executionInterval: number; // minutes
  };
  backgroundProcessing: {
    maxConcurrentTasks: number;
    enableNotifications: boolean;
  };
}

/**
 * Analytics and Statistics
 */
export interface PremiumAnalytics {
  ocrProcessedFiles: number;
  autoTaggedFiles: number;
  searchesPerformed: number;
  smartFoldersExecuted: number;
  storageOptimized: number; // bytes
  timesSaved: number; // seconds
}

// ==================== HIERARCHICAL TAGS TYPES ====================

/**
 * Hierarchical Tag with parent-child relationships
 */
export interface HierarchicalTag {
  id: string;
  name: string;
  parentId: string | null;
  color: string;
  icon?: string;
  aliases: string[];
  description?: string;
  usageCount: number;
  children: string[]; // Child tag IDs
  createdAt: string;
  updatedAt: string;
}

/**
 * Tag statistics for usage analytics
 */
export interface TagStatistics {
  tagId: string;
  totalFiles: number;
  recentUsage: number; // Files tagged in last 30 days
  averageConfidence: number;
  topCoTags: string[]; // Tags often used together
  lastUsedAt: string;
}

/**
 * Bulk tag operation
 */
export interface BulkTagOperation {
  id: string;
  type: 'add' | 'remove' | 'replace' | 'merge';
  sourceTagIds: string[];
  targetTagId?: string;
  fileIds: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  result?: {
    successCount: number;
    failureCount: number;
    errors: string[];
  };
  createdAt: string;
  completedAt?: string;
}

// ==================== VIRTUAL COLLECTIONS TYPES ====================

/**
 * Virtual Collection - groups files without physical movement
 */
export interface VirtualCollection {
  id: string;
  name: string;
  description?: string;
  type: 'manual' | 'smart';
  color: string;
  icon?: string;
  coverImage?: string;

  // For manual collections
  fileIds: string[];
  customOrder: string[]; // File IDs in custom order

  // For smart collections
  criteria?: SmartCollectionCriteria;

  // Metadata
  fileCount: number;
  totalSize: number;
  isShared: boolean;
  sharedWith: string[]; // User IDs
  exportFormat?: 'zip' | 'folder' | 'json';

  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

/**
 * Smart collection criteria for automatic file grouping
 */
export interface SmartCollectionCriteria {
  rules: SmartCollectionRule[];
  matchType: 'all' | 'any'; // AND or OR logic
  sortBy: CollectionSortField;
  sortOrder: SortDirection;
  limit?: number;
}

/**
 * Individual rule for smart collections
 */
export interface SmartCollectionRule {
  id: string;
  field: SmartCollectionField;
  operator: SmartCollectionOperator;
  value: any;
  isNegated: boolean;
}

/**
 * Fields available for smart collection rules
 */
export type SmartCollectionField =
  | 'name'
  | 'extension'
  | 'size'
  | 'createdAt'
  | 'modifiedAt'
  | 'tags'
  | 'folder'
  | 'type'
  | 'content'
  | 'isFavorite'
  | 'description';

/**
 * Operators for smart collection rules
 */
export type SmartCollectionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'between'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'matchesRegex'
  | 'inList'
  | 'hasAny'
  | 'hasAll'
  | 'isTrue'
  | 'isFalse'
  | 'withinLast';

/**
 * Sort fields for collections
 */
export type CollectionSortField =
  | 'name'
  | 'dateAdded'
  | 'dateCreated'
  | 'dateModified'
  | 'size'
  | 'type'
  | 'custom';

/**
 * Collection export options
 */
export interface CollectionExportOptions {
  format: 'zip' | 'folder' | 'json' | 'csv';
  includeMetadata: boolean;
  includeTags: boolean;
  preserveStructure: boolean;
  targetPath?: string;
}

/**
 * Collection share settings
 */
export interface CollectionShareSettings {
  collectionId: string;
  isPublic: boolean;
  sharedWith: CollectionShareRecipient[];
  permissions: CollectionPermissions;
  expiresAt?: string;
  shareLink?: string;
}

/**
 * Collection share recipient
 */
export interface CollectionShareRecipient {
  userId: string;
  email: string;
  permissions: CollectionPermissions;
  addedAt: string;
}

/**
 * Permissions for shared collections
 */
export interface CollectionPermissions {
  canView: boolean;
  canEdit: boolean;
  canAddFiles: boolean;
  canRemoveFiles: boolean;
  canShare: boolean;
  canExport: boolean;
}

// ==================== PASSWORD MANAGER TYPES ====================

export type PMEntryType = 'login' | 'secure_note' | 'credit_card' | 'identity';

export interface PMCustomField {
  id: string;
  name: string;
  value: string;
  type: 'text' | 'hidden' | 'boolean';
}

export interface PMAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface PMEntryBase {
  id: string;
  type: PMEntryType;
  name: string;
  categoryId: string | null;
  tagIds: string[];
  notes: string;
  isFavorite: boolean;
  linkedFileIds: string[];
  linkedFolderIds: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  passwordChangedAt: string | null;
}

export interface PMLoginEntry extends PMEntryBase {
  type: 'login';
  url: string;
  username: string;
  password: string;
  totp: string;
  customFields: PMCustomField[];
}

export interface PMSecureNoteEntry extends PMEntryBase {
  type: 'secure_note';
  content: string;
}

export interface PMCreditCardEntry extends PMEntryBase {
  type: 'credit_card';
  cardholderName: string;
  cardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
  pin: string;
  brand: string;
}

export interface PMIdentityEntry extends PMEntryBase {
  type: 'identity';
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: PMAddress;
  company: string;
  ssn: string;
  passportNumber: string;
  licenseNumber: string;
}

export type PMEntry = PMLoginEntry | PMSecureNoteEntry | PMCreditCardEntry | PMIdentityEntry;

export interface PMCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
}

export interface PMDatabaseMetadata {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  passwordHash: string;
  salt: string;
  lockTimeout: number;
  entryCount: number;
  kdfIterations: number;
  kdfType?: 'pbkdf2' | 'argon2id';
}

export interface PMDatabaseContent {
  entries: PMEntry[];
  categories: PMCategory[];
}

export interface PMPasswordGenOptions {
  mode: 'random' | 'passphrase';
  length: number;
  includeUppercase: boolean;
  includeLowercase: boolean;
  includeNumbers: boolean;
  includeSymbols: boolean;
  excludeAmbiguous: boolean;
  customSymbols: string;
  wordCount: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export interface PMHealthIssue {
  entryId: string;
  entryName: string;
  issue: 'weak' | 'reused' | 'old' | 'breached';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
}

export interface PMPasswordHealth {
  totalEntries: number;
  overallScore: number;
  weakPasswords: PMHealthIssue[];
  reusedPasswords: PMHealthIssue[];
  oldPasswords: PMHealthIssue[];
  breachedPasswords?: PMHealthIssue[];
}

export interface PMBreachInfo {
  isBreached: boolean;
  occurrences: number;
  lastChecked: string;
}

export type PMImportFormat =
  | 'bitwarden_csv'
  | 'bitwarden_json'
  | 'chrome_csv'
  | 'firefox_csv'
  | 'keepass_csv'
  | 'filarr_json'
  | 'filarr_encrypted';

export interface PMImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  errors: string[];
}

export interface PMExportOptions {
  format: PMImportFormat;
  encrypted: boolean;
  password?: string;
  includeNotes: boolean;
  includeTags: boolean;
}

export interface PMOperationResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}
