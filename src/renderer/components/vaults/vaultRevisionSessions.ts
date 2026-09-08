/**
 * vaultRevisionSessions — grouper l'historique E3-12 par SESSION D'ÉDITION.
 *
 * L'id de session vit dans meta.editSession (chiffrée sous K_item, héritée par
 * la révision conservée via l'INSERT…SELECT du commit — le serveur n'en sait
 * rien). Le groupement est CONSÉCUTIF, jamais global : si une session
 * réapparaît après une restauration intercalée, deux groupes distincts —
 * l'historique reste chronologique, jamais réordonné.
 *
 * Une révision sans session (toutes celles d'avant la fonctionnalité) est un
 * groupe singleton : la compat ascendante est le rendu d'aujourd'hui. Et la
 * rétention serveur ne conserve que quelques révisions — les groupes restent
 * petits, c'est attendu.
 */

import type { VaultRevisionSummary } from '../../../store/slices/vaultsSlice';
import { EDIT_SESSION_MAX_PARTICIPANTS } from './vaultNoteCollab';

export interface RevisionSessionGroup {
  /** Clé React UNIQUE : `${sessionId}:${première révision}` — une même session
   *  réapparue après restauration intercalée fait deux groupes distincts. */
  key: string;
  sessionId: string | null;
  revisions: VaultRevisionSummary[];
  participants: string[];
  newestAt: number;
  oldestAt: number;
}

function sessionIdOf(r: VaultRevisionSummary): string | null {
  const raw = (r.meta as { editSession?: unknown }).editSession;
  if (!raw || typeof raw !== 'object') return null;
  const id = (raw as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function participantsOf(r: VaultRevisionSummary): string[] {
  const raw = (r.meta as { editSession?: unknown }).editSession;
  if (!raw || typeof raw !== 'object') return [];
  const list = (raw as { participants?: unknown }).participants;
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
}

/** L'entrée est « plus récente d'abord » (listVaultItemRevisions) — préservé. */
export function groupRevisionsBySession(
  revisions: readonly VaultRevisionSummary[]
): RevisionSessionGroup[] {
  const groups: RevisionSessionGroup[] = [];
  for (const r of revisions) {
    const sessionId = sessionIdOf(r);
    const last = groups[groups.length - 1];
    if (sessionId !== null && last && last.sessionId === sessionId) {
      last.revisions.push(r);
      last.oldestAt = Math.min(last.oldestAt, r.createdAt);
      last.newestAt = Math.max(last.newestAt, r.createdAt);
      for (const name of participantsOf(r)) {
        if (!last.participants.includes(name)) last.participants.push(name);
      }
      last.participants = last.participants.slice(0, EDIT_SESSION_MAX_PARTICIPANTS);
      continue;
    }
    groups.push({
      key: sessionId === null ? `rev:${r.id}` : `${sessionId}:${r.id}`,
      sessionId,
      revisions: [r],
      participants: participantsOf(r).slice(0, EDIT_SESSION_MAX_PARTICIPANTS),
      newestAt: r.createdAt,
      oldestAt: r.createdAt,
    });
  }
  return groups;
}
