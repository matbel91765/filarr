/**
 * Cible de stockage perso (BYOS) — renderer, JWT via apiClient.
 * Le secret IAM ne traverse jamais le main / electron-log.
 */

import apiClient from '../network/apiClient';
import type { AxiosError } from 'axios';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export type StorageProvider = 'r2' | 's3' | 'b2' | 'wasabi' | 'scaleway' | 'ovh' | 'custom';
export type StorageAddressing = 'path' | 'virtual-hosted';

export interface StoragePreset {
  provider: StorageProvider;
  label: string;
  hostSuffixes: string[];
  defaultRegion: string;
  defaultAddressing: StorageAddressing;
  endpointHint: string;
}

/**
 * `canConfigure` est calculé par le Worker (`canUsePersonalByos`) : tier Pro
 * OU siège actif dans une org Teams/Enterprise NON personnelle. L'écran ne
 * doit jamais le redériver du tier personnel — un membre Teams est `free`.
 */
export interface StorageTargetFilarr {
  mode: 'filarr';
  canConfigure?: boolean;
  targetChanges?: { remaining: number; resetAt: number | null };
  /** Les profils qui ont leur PROPRE cible (surcharges existantes). */
  profileOverrides?: string[];
}

export interface StorageTargetByos {
  mode: 'byos';
  canConfigure?: boolean;
  /** 'account' = cible par défaut du compte ; 'profile' = surcharge d'UN profil. */
  scope?: 'account' | 'profile';
  scopeProfileId?: string | null;
  /**
   * Vrai quand la requête portait sur un profil mais que la cible renvoyée est
   * celle DU COMPTE (héritage) — l'écran l'affiche comme « héritée ».
   */
  inherited?: boolean;
  profileOverrides?: string[];
  provider: StorageProvider;
  /**
   * `local` change ce que l'écran doit DIRE, pas seulement ce qu'il affiche :
   * ni sonde de santé, ni migration assistée ne s'appliquent à un magasin que
   * le serveur ne joint pas. Sans ça, les champs de santé restent vides et se
   * lisent comme une panne.
   */
  locality?: StorageLocality;
  endpoint: string;
  region: string;
  bucket: string;
  addressing: StorageAddressing;
  accessKeyIdLast4: string;
  status: 'active' | 'disabled' | 'grace';
  testedAt: number | null;
  graceUntil: number | null;
  rotatedAt?: number | null;
  // Santé (sondée par le cron et par /check).
  lastCheckAt?: number | null;
  lastCheckOk?: boolean | null;
  consecutiveFailures?: number;
  lastCheckLatencyMs?: number | null;
  lastCheckBytes?: number | null;
  lastCheckObjects?: number | null;
  /** Quota de changements de cible (2 / 7 jours) — dit AVANT de mordre. */
  targetChanges?: { remaining: number; resetAt: number | null };
}

export type StorageTargetDto = StorageTargetFilarr | StorageTargetByos;

export interface StoragePresetsDto {
  presets: StoragePreset[];
  corsSnippet: string;
}

/**
 * Localité d'une cible : `local` = magasin sur le RÉSEAU de l'utilisateur
 * (NAS, MinIO, Garage). Le serveur ne le joint jamais — il signe, le bureau
 * exécute. Absent = `public`, c'est-à-dire le comportement d'avant.
 */
export type StorageLocality = 'public' | 'local';

export interface StorageTargetInput {
  provider: StorageProvider;
  locality?: StorageLocality;
  endpoint: string;
  region: string;
  bucket: string;
  addressing: StorageAddressing;
  accessKeyId: string;
  secretAccessKey: string;
}

export class StorageTargetApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'StorageTargetApiError';
    this.code = code;
  }
}

function unwrap<T>(data: Envelope<T> | undefined, fallback: string): T {
  if (!data?.success || data.data === undefined) {
    throw new StorageTargetApiError(data?.error || fallback, data?.code);
  }
  return data.data;
}

function fromAxios(err: unknown, fallback: string): never {
  const ax = err as AxiosError<Envelope<unknown>>;
  const body = ax.response?.data;
  throw new StorageTargetApiError(body?.error || ax.message || fallback, body?.code);
}

export async function fetchStoragePresets(): Promise<StoragePresetsDto> {
  try {
    const { data } = await apiClient.get<Envelope<StoragePresetsDto>>('/account/storage-presets');
    return unwrap(data, 'Failed to load storage presets');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to load storage presets');
  }
}

const scopeQuery = (profileId?: string): string =>
  profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';

export async function fetchStorageTarget(profileId?: string): Promise<StorageTargetDto> {
  try {
    const { data } = await apiClient.get<Envelope<StorageTargetDto>>(
      `/account/storage-target${scopeQuery(profileId)}`
    );
    return unwrap(data, 'Failed to load storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to load storage target');
  }
}

export async function testStorageTarget(input: StorageTargetInput): Promise<void> {
  try {
    const { data } = await apiClient.post<Envelope<{ ok: boolean }>>(
      '/account/storage-target/test',
      input
    );
    unwrap(data, 'Bucket unreachable');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Bucket unreachable');
  }
}

export async function saveStorageTarget(
  input: StorageTargetInput,
  profileId?: string
): Promise<StorageTargetDto> {
  try {
    const { data } = await apiClient.put<Envelope<StorageTargetDto>>(
      '/account/storage-target',
      profileId ? { ...input, profileId } : input
    );
    return unwrap(data, 'Failed to save storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to save storage target');
  }
}

// ── Santé : sonde avec les identifiants STOCKÉS (le secret ne repasse pas) ──

export interface StorageHealthDto {
  ok: boolean;
  lastCheckAt: number;
  consecutiveFailures: number;
  latencyMs: number | null;
  bytes: number | null;
  objects: number | null;
}

export async function checkStorageTarget(profileId?: string): Promise<StorageHealthDto> {
  try {
    const { data } = await apiClient.post<Envelope<StorageHealthDto>>(
      `/account/storage-target/check${scopeQuery(profileId)}`
    );
    return unwrap(data, 'Check failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Check failed');
  }
}

// ── Export de conformité : où vivent les octets de chaque profil, signé ──────

/** Le document /account/storage-inventory, remis tel quel à l'utilisateur. */
export interface StorageInventoryDto {
  version: string;
  generatedAt: number;
  userId: string;
  email: string;
  accountDefault: Record<string, unknown>;
  scopes: Array<Record<string, unknown>>;
  /** HMAC hex quand le Worker a un secret d'audit, null sinon. */
  signature: string | null;
}

export async function fetchStorageInventory(): Promise<StorageInventoryDto> {
  try {
    const { data } = await apiClient.get<Envelope<StorageInventoryDto>>(
      '/account/storage-inventory'
    );
    return unwrap(data, 'Failed to build storage inventory');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to build storage inventory');
  }
}

// ── Migration assistée Filarr Cloud ⇄ bucket user (copie serveur-à-serveur) ──

export type MigrationDirection = 'to-byos' | 'to-filarr';

export interface MigrationStatusDto {
  direction: MigrationDirection;
  total: number;
  totalBytes: number;
  remaining: number;
  remainingBytes: number;
  missing: number;
  differing: number;
}

export interface MigrationStepDto {
  direction: MigrationDirection;
  done: boolean;
  copied: number;
  copiedBytes: number;
  remaining: number;
  remainingBytes: number;
  total: number;
  totalBytes: number;
}

export interface MigrationPurgeDto {
  direction: MigrationDirection;
  deleted: number;
  deletedBytes: number;
}

export async function fetchMigrationStatus(
  direction: MigrationDirection,
  profileId?: string
): Promise<MigrationStatusDto> {
  try {
    const { data } = await apiClient.get<Envelope<MigrationStatusDto>>(
      `/sync/storage-migration/status?direction=${direction}` +
        (profileId ? `&profileId=${encodeURIComponent(profileId)}` : '')
    );
    return unwrap(data, 'Failed to read migration status');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to read migration status');
  }
}

/** UN pas de copie. L'appelant boucle tant que `done` est faux. */
export async function runMigrationStep(
  direction: MigrationDirection,
  profileId?: string
): Promise<MigrationStepDto> {
  try {
    const { data } = await apiClient.post<Envelope<MigrationStepDto>>(
      '/sync/storage-migration/step',
      profileId ? { direction, profileId } : { direction },
      // Un pas copie jusqu'à 512 Mio : bien au-delà du délai par défaut d'axios.
      { timeout: 15 * 60 * 1000 }
    );
    return unwrap(data, 'Migration step failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Migration step failed');
  }
}

/**
 * Efface la SOURCE après vérification serveur. 409 `differing_objects` sans
 * `force` ; 409 `deletion_incomplete` = rappeler.
 */
export async function purgeMigrationSource(
  direction: MigrationDirection,
  force = false,
  profileId?: string
): Promise<MigrationPurgeDto> {
  try {
    const { data } = await apiClient.post<Envelope<MigrationPurgeDto>>(
      '/sync/storage-migration/purge-source',
      profileId ? { direction, force, profileId } : { direction, force },
      { timeout: 5 * 60 * 1000 }
    );
    return unwrap(data, 'Purge failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Purge failed');
  }
}

export async function deleteStorageTarget(profileId?: string): Promise<StorageTargetDto> {
  try {
    const { data } = await apiClient.delete<Envelope<StorageTargetDto>>(
      `/account/storage-target${scopeQuery(profileId)}`
    );
    return unwrap(data, 'Failed to delete storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to delete storage target');
  }
}
