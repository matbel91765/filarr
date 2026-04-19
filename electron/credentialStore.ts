/**
 * Credential Store — Secure storage for BYOS secrets in Electron main process
 *
 * Stores S3 secretAccessKey values encrypted with the master key.
 * Uses the same encryption functions as the main storage service.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

interface CredentialEntry {
  providerId: string;
  encryptedSecret: string;
  iv: string;
  createdAt: string;
}

interface CredentialStore {
  version: number;
  credentials: CredentialEntry[];
  /** Per-installation random salt for key derivation (hex-encoded) */
  keySalt?: string;
}

const CREDENTIAL_FILE = 'credentials.enc';
const ALGORITHM = 'aes-256-gcm';

function getCredentialPath(): string {
  return path.join(app.getPath('userData'), 'FilarData', CREDENTIAL_FILE);
}

function getOrCreateKeySalt(): Buffer {
  const store = loadStore();
  if (store.keySalt) {
    return Buffer.from(store.keySalt, 'hex');
  }
  // First use: generate random salt and persist it
  const salt = crypto.randomBytes(16);
  store.keySalt = salt.toString('hex');
  saveStore(store);
  return salt;
}

function getEncryptionKey(): Buffer {
  // Derive a key from the master encryption key file using PBKDF2
  const keyPath = path.join(app.getPath('userData'), 'FilarData', 'encryption.key');
  if (!fs.existsSync(keyPath)) {
    throw new Error('Encryption key not found. Please set up local storage first.');
  }
  const masterKey = fs.readFileSync(keyPath);
  const salt = getOrCreateKeySalt();
  return crypto.pbkdf2Sync(masterKey, salt, 600_000, 32, 'sha512');
}

function encryptSecret(secret: string, key: Buffer): { encrypted: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as: encrypted + authTag (concatenated, both hex)
  return {
    encrypted: encrypted.toString('hex') + ':' + authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

function decryptSecret(encryptedHex: string, ivHex: string, key: Buffer): string {
  const iv = Buffer.from(ivHex, 'hex');
  const [dataHex, tagHex] = encryptedHex.split(':');
  const encrypted = Buffer.from(dataHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf-8');
}

function loadStore(): CredentialStore {
  const filePath = getCredentialPath();
  if (!fs.existsSync(filePath)) {
    return { version: 1, credentials: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as CredentialStore;
}

function saveStore(store: CredentialStore): void {
  const filePath = getCredentialPath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Save a credential (S3 secretAccessKey) for a provider
 */
export async function saveCredential(providerId: string, secretAccessKey: string): Promise<void> {
  const key = getEncryptionKey();
  const { encrypted, iv } = encryptSecret(secretAccessKey, key);

  const store = loadStore();
  // Remove existing entry for this provider
  store.credentials = store.credentials.filter((c) => c.providerId !== providerId);
  store.credentials.push({
    providerId,
    encryptedSecret: encrypted,
    iv,
    createdAt: new Date().toISOString(),
  });
  saveStore(store);
}

/**
 * Get a credential (S3 secretAccessKey) for a provider
 */
export async function getCredential(providerId: string): Promise<string> {
  const store = loadStore();
  const entry = store.credentials.find((c) => c.providerId === providerId);
  if (!entry) {
    throw new Error(`No credential found for provider ${providerId}`);
  }
  const key = getEncryptionKey();
  return decryptSecret(entry.encryptedSecret, entry.iv, key);
}

/**
 * Delete a credential for a provider
 */
export async function deleteCredential(providerId: string): Promise<void> {
  const store = loadStore();
  store.credentials = store.credentials.filter((c) => c.providerId !== providerId);
  saveStore(store);
}

/**
 * Check if a credential exists for a provider
 */
export async function hasCredential(providerId: string): Promise<boolean> {
  const store = loadStore();
  return store.credentials.some((c) => c.providerId === providerId);
}
