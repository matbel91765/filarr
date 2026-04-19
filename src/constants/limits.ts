/**
 * File and storage limits constants
 */

// File size limits
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
export const MAX_FILES_BATCH = 10; // Maximum files to upload at once
export const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for large file uploads

// File extension validation
export const ALLOWED_EXTENSIONS = ['*']; // '*' means all extensions allowed by default

// Blocked extensions for security
export const BLOCKED_EXTENSIONS = [
  '.exe',
  '.bat',
  '.sh',
  '.cmd',
  '.com',
  '.scr',
  '.vbs',
  '.js', // Executable JS files
  '.jar',
  '.app',
  '.deb',
  '.rpm',
  '.msi',
  '.dmg',
];

// Progress thresholds
export const SHOW_PROGRESS_THRESHOLD = 10 * 1024 * 1024; // Show progress for files > 10MB

// Error messages
export const FILE_ERRORS = {
  TOO_LARGE: 'File too large (max 500 MB)',
  BLOCKED_EXTENSION: 'File type is not allowed for security reasons',
  TOO_MANY_FILES: `Cannot upload more than ${MAX_FILES_BATCH} files at once`,
  INVALID_FILE: 'Invalid file',
} as const;

// Helper functions
export const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

export const getFileExtension = (filename: string): string => {
  const parts = filename.split('.');
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : '';
};

export const isExtensionBlocked = (filename: string): boolean => {
  const extension = getFileExtension(filename);
  return BLOCKED_EXTENSIONS.includes(extension);
};

export const isExtensionAllowed = (filename: string): boolean => {
  // If ALLOWED_EXTENSIONS contains '*', all non-blocked extensions are allowed
  if (ALLOWED_EXTENSIONS.includes('*')) {
    return !isExtensionBlocked(filename);
  }

  const extension = getFileExtension(filename);
  return ALLOWED_EXTENSIONS.includes(extension) && !isExtensionBlocked(filename);
};
