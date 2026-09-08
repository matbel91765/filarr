/**
 * sinksApi.ts — renderer HTTP layer for the admin SIEM sink config API.
 *
 * Uses the authenticated apiClient (Bearer via auth:getAccessToken + X-Org-Id), so every
 * call is scoped to the active org. A "sink" streams the org's tamper-evident audit log
 * to an external destination (a signed webhook, or a Splunk HTTP Event Collector). The
 * server never returns the signing secret / HEC token — only a `hasSecret` flag.
 */

import apiClient from '../network/apiClient';

export type AuditSinkType = 'webhook' | 'splunk_hec';

export interface AuditSink {
  id: string;
  type: AuditSinkType;
  url: string;
  enabled: boolean;
  /** Whether a signing secret / HEC token is stored (the value itself is never returned). */
  hasSecret: boolean;
  /** Last audit event id successfully delivered to this sink. */
  lastDeliveredId: number;
  /** Last delivery error, or null when the last attempt succeeded. */
  lastError: string | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSinkBody {
  type: AuditSinkType;
  url: string;
  /** Webhook HMAC signing secret (>= 16 chars). */
  secret?: string;
  /** Splunk HEC token. */
  hecToken?: string;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export async function apiListSinks(): Promise<{ sinks: AuditSink[] }> {
  const { data } = await apiClient.get<Envelope<{ sinks: AuditSink[] }>>('/audit/sinks');
  return data.data ?? { sinks: [] };
}

export async function apiCreateSink(body: CreateSinkBody): Promise<{ id: string }> {
  // Server responds 201 { success, data: { id } } — only the new id, not the full DTO.
  const { data } = await apiClient.post<Envelope<{ id: string }>>('/audit/sinks', body);
  if (!data.success || !data.data) throw new Error(data.error || data.code || 'create_failed');
  return data.data;
}

export async function apiSetSinkEnabled(id: string, enabled: boolean): Promise<void> {
  // PATCH responds { success: true } with NO data payload — gate on success, not data.
  const { data } = await apiClient.patch<Envelope<unknown>>(`/audit/sinks/${id}`, { enabled });
  if (!data.success) throw new Error(data.error || data.code || 'update_failed');
}

export async function apiDeleteSink(id: string): Promise<void> {
  const { data } = await apiClient.delete<Envelope<unknown>>(`/audit/sinks/${id}`);
  if (!data.success) throw new Error(data.error || data.code || 'delete_failed');
}
