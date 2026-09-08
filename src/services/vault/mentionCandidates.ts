import { apiListVaultMembers } from './vaultApi';
import {
  filterMentionCandidates,
  type MentionCandidate,
} from '../../renderer/components/notes/extensions/mentionSuggestionExtension';

/**
 * LES MEMBRES DU COFFRE, PRÊTS POUR LE MENU « @ ».
 *
 * Le trombinoscope (`GET /vaults/:id/members`) est lisible par tout membre. On
 * le garde en mémoire cinq minutes par coffre, et une copie dans localStorage
 * pour que le menu réponde hors ligne — une mention tapée dans le train doit
 * trouver ses collègues. Le libellé est l’adresse tant qu’il n’y a pas de nom
 * d’affichage ; à défaut d’adresse (Worker d’avant), l’identifiant.
 */
const CACHE_PREFIX = 'filarr-vault-members:';
const TTL_MS = 5 * 60 * 1000;

const memory = new Map<string, { at: number; list: MentionCandidate[] }>();

function readOffline(vaultId: string): MentionCandidate[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + vaultId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MentionCandidate[]) : null;
  } catch {
    return null;
  }
}

function writeOffline(vaultId: string, list: MentionCandidate[]): void {
  try {
    localStorage.setItem(CACHE_PREFIX + vaultId, JSON.stringify(list));
  } catch {
    /* stockage indisponible : le cache mémoire suffit */
  }
}

export async function vaultMentionCandidates(
  vaultId: string,
  query: string,
  selfUserId: string | null | undefined
): Promise<MentionCandidate[]> {
  const cached = memory.get(vaultId);
  let list = cached && Date.now() - cached.at < TTL_MS ? cached.list : null;
  if (!list) {
    try {
      const members = await apiListVaultMembers(vaultId);
      list = members.map((m) => ({
        userId: m.userId,
        // Nom d'affichage (0092), à défaut l'adresse, à défaut l'identifiant :
        // une puce doit nommer quelqu'un, pas exhiber une clé primaire.
        label: (m.displayName ?? m.email ?? m.userId).trim(),
        secondary: m.displayName ? m.email : m.role,
      }));
      memory.set(vaultId, { at: Date.now(), list });
      writeOffline(vaultId, list);
    } catch {
      list = cached?.list ?? readOffline(vaultId) ?? [];
    }
  }
  return filterMentionCandidates(list, query, selfUserId);
}

/** Oublie le cache d’un coffre (départ ou arrivée d’un membre). */
export function forgetVaultMentionCandidates(vaultId: string): void {
  memory.delete(vaultId);
  try {
    localStorage.removeItem(CACHE_PREFIX + vaultId);
  } catch {
    /* rien à oublier */
  }
}
