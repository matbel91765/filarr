/**
 * orgStorageApi.ts — couche HTTP renderer du BYOS d'organisation : la cible de
 * stockage des COFFRES d'équipe (routes /org/:orgId/storage-target du Worker,
 * MANAGE_SETTINGS). Le secret IAM part au Worker en TLS et n'en revient jamais ;
 * aucune trace côté main / electron-log.
 */

import apiClient from '../network/apiClient';
import type { AxiosError } from 'axios';
import type {
  StorageAddressing,
  StorageProvider,
  StorageTargetInput,
} from '../storage/storageTargetApi';
import { StorageTargetApiError } from '../storage/storageTargetApi';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface OrgStorageTargetFilarr {
  mode: 'filarr';
  canConfigure?: boolean;
  targetChanges?: { remaining: number; resetAt: number | null };
}

export interface OrgStorageTargetByos {
  mode: 'byos';
  canConfigure?: boolean;
  provider: StorageProvider;
  endpoint: string;
  region: string;
  bucket: string;
  addressing: StorageAddressing;
  accessKeyIdLast4: string;
  status: 'active' | 'disabled' | 'grace';
  testedAt: number | null;
  graceUntil: number | null;
  rotatedAt?: number | null;
  lastCheckAt?: number | null;
  lastCheckOk?: boolean | null;
  consecutiveFailures?: number;
  lastCheckLatencyMs?: number | null;
  targetChanges?: { remaining: number; resetAt: number | null };
}

export type OrgStorageTargetDto = OrgStorageTargetFilarr | OrgStorageTargetByos;

export interface OrgMigrationStatusDto {
  direction: 'to-byos' | 'to-filarr';
  total: number;
  totalBytes: number;
  remaining: number;
  remainingBytes: number;
  missing: number;
  differing: number;
  vaults: number;
  vaultsScanned: number;
}

export interface OrgMigrationStepDto {
  direction: 'to-byos' | 'to-filarr';
  done: boolean;
  copied: number;
  copiedBytes: number;
  /** Le coffre que ce pas a traité (absent quand tout est fini). */
  vault?: string;
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

export async function apiGetOrgStorageTarget(orgId: string): Promise<OrgStorageTargetDto> {
  try {
    const { data } = await apiClient.get<Envelope<OrgStorageTargetDto>>(
      `/org/${orgId}/storage-target`
    );
    return unwrap(data, 'Failed to load organization storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to load organization storage target');
  }
}

export async function apiTestOrgStorageTarget(
  orgId: string,
  input: StorageTargetInput
): Promise<void> {
  try {
    const { data } = await apiClient.post<Envelope<{ ok: boolean }>>(
      `/org/${orgId}/storage-target/test`,
      input
    );
    unwrap(data, 'Bucket unreachable');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Bucket unreachable');
  }
}

export async function apiSaveOrgStorageTarget(
  orgId: string,
  input: StorageTargetInput
): Promise<OrgStorageTargetDto> {
  try {
    const { data } = await apiClient.put<Envelope<OrgStorageTargetDto>>(
      `/org/${orgId}/storage-target`,
      input
    );
    return unwrap(data, 'Failed to save organization storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to save organization storage target');
  }
}

export async function apiDeleteOrgStorageTarget(orgId: string): Promise<OrgStorageTargetDto> {
  try {
    const { data } = await apiClient.delete<Envelope<OrgStorageTargetDto>>(
      `/org/${orgId}/storage-target`
    );
    return unwrap(data, 'Failed to delete organization storage target');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to delete organization storage target');
  }
}

export async function apiCheckOrgStorageTarget(orgId: string): Promise<{
  ok: boolean;
  lastCheckAt: number;
  consecutiveFailures: number;
  latencyMs: number | null;
}> {
  try {
    const { data } = await apiClient.post<
      Envelope<{
        ok: boolean;
        lastCheckAt: number;
        consecutiveFailures: number;
        latencyMs: number | null;
      }>
    >(`/org/${orgId}/storage-target/check`);
    return unwrap(data, 'Check failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Check failed');
  }
}

export async function apiOrgMigrationStatus(
  orgId: string,
  direction: 'to-byos' | 'to-filarr'
): Promise<OrgMigrationStatusDto> {
  try {
    const { data } = await apiClient.get<Envelope<OrgMigrationStatusDto>>(
      `/org/${orgId}/storage-migration/status?direction=${direction}`
    );
    return unwrap(data, 'Failed to read migration status');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Failed to read migration status');
  }
}

/** UN pas de copie (un coffre à la fois côté Worker). L'appelant boucle sur `done`. */
export async function apiOrgMigrationStep(
  orgId: string,
  direction: 'to-byos' | 'to-filarr'
): Promise<OrgMigrationStepDto> {
  try {
    const { data } = await apiClient.post<Envelope<OrgMigrationStepDto>>(
      `/org/${orgId}/storage-migration/step`,
      { direction },
      { timeout: 15 * 60 * 1000 }
    );
    return unwrap(data, 'Migration step failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Migration step failed');
  }
}

export async function apiOrgMigrationPurgeSource(
  orgId: string,
  direction: 'to-byos' | 'to-filarr',
  force = false
): Promise<{ direction: string; deleted: number; deletedBytes: number }> {
  try {
    const { data } = await apiClient.post<
      Envelope<{ direction: string; deleted: number; deletedBytes: number }>
    >(
      `/org/${orgId}/storage-migration/purge-source`,
      { direction, force },
      { timeout: 5 * 60 * 1000 }
    );
    return unwrap(data, 'Purge failed');
  } catch (err) {
    if (err instanceof StorageTargetApiError) throw err;
    fromAxios(err, 'Purge failed');
  }
}
