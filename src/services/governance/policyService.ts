/**
 * policyService — E9-10 client transport for the org governance policy.
 *
 * Fetches the member-readable effective policy from the Worker (apiClient holds the auto-refreshed
 * token + X-Org-Id), persists it to the on-disk cache via the main process (electron `org:policy:*`),
 * and posts a best-effort resync ack after an offline gap. The policy is metadata only — never keys
 * or content — so caching it locally is safe.
 */

import apiClient from '../network/apiClient';
import type { EffectivePolicy } from '../../store/slices/governanceSlice';

export interface CachedPolicy {
  orgId: string;
  policyJson: EffectivePolicy;
  policyVersion: number;
  /** epoch ms of the last successful online fetch. */
  fetchedAt: number;
}

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

function ipcInvoke(): Invoke | null {
  if (typeof window !== 'undefined' && window.electron?.ipcRenderer) {
    return window.electron.ipcRenderer.invoke as Invoke;
  }
  return null;
}

/** Fetch the effective policy (session + sharing + retention + version) for an org. Throws on error. */
export async function fetchEffectivePolicy(
  orgId: string
): Promise<{ policy: EffectivePolicy; version: number }> {
  const res = await apiClient.get(`/org/${orgId}/policies/effective`);
  const data = (res.data as { data?: { policy?: EffectivePolicy; version?: number } })?.data;
  if (!data || !data.policy) throw new Error('malformed policy response');
  return { policy: data.policy, version: Number(data.version) || 0 };
}

/** Read the on-disk policy cache (null if absent / no electron bridge). */
export async function loadCachedPolicy(): Promise<CachedPolicy | null> {
  const invoke = ipcInvoke();
  if (!invoke) return null;
  try {
    const res = (await invoke('org:policy:load')) as {
      success?: boolean;
      data?: CachedPolicy | null;
    };
    return res?.data ?? null;
  } catch {
    return null;
  }
}

/** Persist the policy cache (profile-scoped, plain JSON, 0o600). Best-effort. */
export async function saveCachedPolicy(data: CachedPolicy): Promise<void> {
  const invoke = ipcInvoke();
  if (!invoke) return;
  try {
    await invoke('org:policy:save', data);
  } catch {
    /* non-fatal: a missed cache write just means a re-fetch next online */
  }
}

/** Drop the on-disk policy cache (logout / explicit reset). Best-effort. */
export async function clearCachedPolicy(): Promise<void> {
  const invoke = ipcInvoke();
  if (!invoke) return;
  try {
    await invoke('org:policy:clear');
  } catch {
    /* non-fatal */
  }
}

/**
 * Tell the server this device re-synced after an offline gap (E9-10 AC7). Pure best-effort audit
 * telemetry — never block or surface a failure. Metadata only (versions + a coarse offline-hours
 * bucket); the server rate-limits + clamps it.
 */
export async function ackResync(
  orgId: string,
  body: { fromVersion: number; toVersion: number; offlineHours: number }
): Promise<void> {
  try {
    await apiClient.post(`/org/${orgId}/policies/resync-ack`, body);
  } catch {
    /* best-effort */
  }
}
