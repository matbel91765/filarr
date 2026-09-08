/**
 * BYOS S3 Client — Lightweight S3 client for Electron main process
 *
 * Connects directly to the user's own S3-compatible storage.
 * AWS SDK v3 (@aws-sdk/client-s3) is loaded dynamically at runtime.
 * If not installed, functions throw a clear error message.
 */

import * as credentialStore from './credentialStore';

export interface ByosS3Config {
  providerId: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
}

export interface ByosUploadResult {
  key: string;
  etag?: string;
  size: number;
}

/* eslint-disable @typescript-eslint/no-var-requires */

function loadS3SDK(): any {
  try {
    return require('@aws-sdk/client-s3');
  } catch {
    throw new Error(
      'BYOS requires @aws-sdk/client-s3. Install it with: npm install @aws-sdk/client-s3 --legacy-peer-deps'
    );
  }
}

/**
 * Creates an S3 client for a BYOS provider.
 */
export async function createS3Client(config: ByosS3Config): Promise<any> {
  const secretAccessKey = await credentialStore.getCredential(config.providerId);
  const sdk = loadS3SDK();

  return new sdk.S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: !!config.endpoint,
  });
}

/**
 * Upload an encrypted buffer to S3
 */
export async function upload(
  config: ByosS3Config,
  key: string,
  data: Buffer,
  contentType: string = 'application/octet-stream'
): Promise<ByosUploadResult> {
  const client = await createS3Client(config);
  const sdk = loadS3SDK();

  const result = await client.send(
    new sdk.PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    })
  );

  return {
    key,
    etag: result.ETag,
    size: data.length,
  };
}

/**
 * Download a file from S3
 */
export async function download(
  config: ByosS3Config,
  key: string
): Promise<Buffer> {
  const client = await createS3Client(config);
  const sdk = loadS3SDK();

  const result = await client.send(
    new sdk.GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );

  if (!result.Body) {
    throw new Error(`Empty response for key: ${key}`);
  }

  // Convert stream to buffer
  const chunks: Uint8Array[] = [];
  const stream = result.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Delete a file from S3
 */
export async function deleteObject(
  config: ByosS3Config,
  key: string
): Promise<void> {
  const client = await createS3Client(config);
  const sdk = loadS3SDK();

  await client.send(
    new sdk.DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    })
  );
}

/**
 * List objects in S3 under a prefix
 */
export async function listObjects(
  config: ByosS3Config,
  prefix: string
): Promise<Array<{ key: string; size: number; lastModified?: Date }>> {
  const client = await createS3Client(config);
  const sdk = loadS3SDK();

  const result = await client.send(
    new sdk.ListObjectsV2Command({
      Bucket: config.bucket,
      Prefix: prefix,
    })
  );

  return (result.Contents || []).map((obj: any) => ({
    key: obj.Key || '',
    size: obj.Size || 0,
    lastModified: obj.LastModified,
  }));
}

/**
 * Test S3 connectivity by checking bucket access
 */
export async function testConnection(config: ByosS3Config): Promise<{ success: boolean; latencyMs: number }> {
  const client = await createS3Client(config);
  const sdk = loadS3SDK();

  const start = Date.now();
  await client.send(new sdk.HeadBucketCommand({ Bucket: config.bucket }));
  const latencyMs = Date.now() - start;

  return { success: true, latencyMs };
}
