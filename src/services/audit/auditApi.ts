/**
 * auditApi.ts (E7-5) — renderer HTTP layer for the admin audit-log read API (E7-4).
 *
 * Uses the authenticated apiClient (Bearer via auth:getAccessToken + X-Org-Id), so every
 * call is scoped to the active org. The server returns metadata-only rows (opaque
 * target_id); the renderer resolves human labels locally from already-decrypted data.
 */

import apiClient from '../network/apiClient';

export interface AuditEvent {
  id: number;
  actorUserId: string | null;
  eventType: string;
  targetType: string | null;
  /** Opaque object id — the server never sends titles/content. */
  targetId: string | null;
  ipSubnet: string | null;
  country: string | null;
  occurredAt: number;
  metadata: Record<string, unknown> | null;
  rowHash: string | null;
}

export interface AuditEventsPage {
  events: AuditEvent[];
  nextCursor: string | null;
}

export interface AuditChainStatus {
  ok: boolean;
  brokenAtId?: number;
  position?: number;
  reason?: string;
}

export interface AuditEventsQuery {
  eventType?: string;
  actorUserId?: string;
  targetId?: string;
  country?: string;
  /** occurred_at lower bound (ms). */
  from?: number;
  /** occurred_at upper bound (ms). */
  to?: number;
  cursor?: string;
  limit?: number;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export async function apiGetAuditEvents(q: AuditEventsQuery = {}): Promise<AuditEventsPage> {
  const params: Record<string, string> = {};
  if (q.eventType) params.event_type = q.eventType;
  if (q.actorUserId) params.actor_user_id = q.actorUserId;
  if (q.targetId) params.target_id = q.targetId;
  if (q.country) params.country = q.country;
  if (q.from != null) params.from = String(q.from);
  if (q.to != null) params.to = String(q.to);
  if (q.cursor) params.cursor = q.cursor;
  if (q.limit != null) params.limit = String(q.limit);
  const { data } = await apiClient.get<Envelope<AuditEventsPage>>('/audit/events', { params });
  return data.data ?? { events: [], nextCursor: null };
}

export async function apiVerifyAuditChain(): Promise<AuditChainStatus> {
  const { data } = await apiClient.get<Envelope<AuditChainStatus>>('/audit/verify');
  return data.data ?? { ok: false };
}

export interface AuditStats {
  windowDays: number;
  total: number;
  actors: number;
  byDay: { dayStartMs: number; count: number }[];
  byType: { type: string; count: number }[];
}

export async function apiGetAuditStats(): Promise<AuditStats> {
  const { data } = await apiClient.get<Envelope<AuditStats>>('/audit/stats');
  return data.data ?? { windowDays: 30, total: 0, actors: 0, byDay: [], byType: [] };
}
