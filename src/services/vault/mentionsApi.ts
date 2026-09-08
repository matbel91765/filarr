import apiClient from '../network/apiClient';

/**
 * LES MENTIONS, CÔTÉ CLIENT — ce qui part et ce qui revient.
 *
 * Ce qui part : des identifiants. Jamais le texte, jamais le titre — le
 * serveur ne les a pas et ne doit pas les avoir. Ce qui revient : de quoi
 * afficher « X vous a nommé », le client résolvant le titre avec ses clés.
 */

export type MentionSkipReason = 'self' | 'not_member' | 'unread_exists';

export interface MentionSignalResult {
  created: number;
  skipped: Array<{ userId: string; reason: MentionSkipReason }>;
}

export interface MentionDTO {
  id: string;
  vaultId: string;
  itemId: string;
  fromUserId: string;
  /** Nom d’affichage, à défaut adresse — résolu par le serveur. */
  fromLabel: string;
  itemKind: 'note' | 'file' | 'transclusion' | null;
  createdAt: string;
  readAt: string | null;
}

export interface MentionInbox {
  mentions: MentionDTO[];
  unread: number;
  nextCursor: string | null;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Signale les personnes nommées dans un élément. Le serveur saute celles qui
 * ont déjà une mention non lue, l'émetteur lui-même, et les non-membres — il
 * rend le motif de chaque refus, jamais un silence.
 */
export async function apiSignalMentions(
  vaultId: string,
  itemId: string,
  toUserIds: string[]
): Promise<MentionSignalResult> {
  const { data } = await apiClient.post<Envelope<MentionSignalResult>>('/mentions', {
    vaultId,
    itemId,
    toUserIds,
  });
  return data.data ?? { created: 0, skipped: [] };
}

export async function apiListMentions(opts?: {
  limit?: number;
  unreadOnly?: boolean;
  cursor?: string | null;
}): Promise<MentionInbox> {
  const params: Record<string, string> = {};
  if (opts?.limit) params.limit = String(opts.limit);
  if (opts?.unreadOnly) params.unreadOnly = '1';
  if (opts?.cursor) params.cursor = opts.cursor;
  const { data } = await apiClient.get<Envelope<MentionInbox>>('/mentions', { params });
  return data.data ?? { mentions: [], unread: 0, nextCursor: null };
}

/** `null` = tout marquer. Ne touche jamais les mentions de quelqu’un d’autre. */
export async function apiMarkMentionsRead(ids: string[] | null): Promise<number> {
  if (ids !== null && ids.length === 0) return 0;
  const { data } = await apiClient.post<Envelope<{ updated: number }>>(
    '/mentions/read',
    ids === null ? { all: true } : { ids }
  );
  return data.data?.updated ?? 0;
}
