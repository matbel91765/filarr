/**
 * BYOS Storage Service — High-level storage operations for BYOS
 *
 * Bridges the Electron main process with the user's S3-compatible storage.
 * Files are stored as: {folderId}/{fileId}/{fileName}
 */

import * as byosS3Client from './byosS3Client';
import type { ByosS3Config } from './byosS3Client';

export interface ByosFileRef {
  providerId: string;
  folderId: string;
  fileId: string;
  fileName: string;
}

/**
 * Build an S3 key from folder/file IDs
 */
function buildS3Key(ref: ByosFileRef): string {
  return `${ref.folderId}/${ref.fileId}/${ref.fileName}`;
}

/**
 * Upload an already-encrypted buffer to BYOS storage
 */
export async function uploadFile(
  config: ByosS3Config,
  ref: ByosFileRef,
  encryptedBuffer: Buffer,
  contentType: string = 'application/octet-stream'
): Promise<{ key: string; size: number }> {
  const key = buildS3Key(ref);
  const result = await byosS3Client.upload(config, key, encryptedBuffer, contentType);
  return { key: result.key, size: result.size };
}

/**
 * Download a file from BYOS storage (returns encrypted buffer)
 */
export async function downloadFile(
  config: ByosS3Config,
  ref: ByosFileRef
): Promise<Buffer> {
  const key = buildS3Key(ref);
  return byosS3Client.download(config, key);
}

/**
 * Delete a file from BYOS storage
 */
export async function deleteFile(
  config: ByosS3Config,
  ref: ByosFileRef
): Promise<void> {
  const key = buildS3Key(ref);
  await byosS3Client.deleteObject(config, key);
}

/**
 * List files in a folder from BYOS storage
 */
export async function listFiles(
  config: ByosS3Config,
  folderId: string
): Promise<Array<{ key: string; size: number; lastModified?: Date }>> {
  return byosS3Client.listObjects(config, `${folderId}/`);
}
