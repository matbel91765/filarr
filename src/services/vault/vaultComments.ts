/**
 * vaultComments — le MODÈLE des commentaires de coffre, pur (ni React, ni Yjs).
 *
 * Un commentaire de coffre voyage soit dans la Y.Map 'filarr:comments' du
 * Y.Doc de salle (chiffrée par la clé de salle, relayée par le relais
 * aveugle), soit dans le corps chiffré de l'élément (enveloppe vaultNoteBody),
 * soit dans un sidecar de fichier (fileThread). Les trois transports parlent
 * CE modèle.
 *
 * DEUX RÈGLES DURES :
 *   · SUPPRESSION = TOMBSTONE ({deleted:true} conservé, jamais un retrait de
 *     clé) — c'est ce qui rend la fusion-par-union du sidecar stable au 409
 *     (un supprimé ne ressuscite pas) et ce qui protège le semis d'une salle
 *     contre la résurrection depuis un corps ancien ;
 *   · LWW AU GRAIN DE LA CLÉ : muter un commentaire = réécrire son objet
 *     ENTIER. Deux réponses concurrentes sont deux clés distinctes (id =
 *     crypto.randomUUID(), jamais un timestamp — il collisionne entre membres).
 */

export interface VaultComment {
  id: string;
  /** null = commentaire racine ; sinon id du parent (threading plat). */
  parentId: string | null;
  text: string;
  /** vaultMemberLabel — l'email de compte d'abord, l'identité des panneaux. */
  authorName: string;
  authorId: string | null;
  /** toISOString() du poseur. */
  createdAt: string;
  resolved: boolean;
  /** Tombstone — l'entrée ne disparaît JAMAIS. */
  deleted?: boolean;
}

/**
 * Valide ce qui sort du réseau ou du disque — champ par champ, null si
 * inexploitable. TOUT ce qui entre par Y.Map ou par octets déchiffrés passe
 * par ici avant de toucher l'écran.
 */
export function sanitizeComment(raw: unknown): VaultComment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 128) return null;
  if (r.parentId !== null && r.parentId !== undefined && typeof r.parentId !== 'string') {
    return null;
  }
  if (typeof r.text !== 'string' || r.text.length > 20_000) return null;
  if (typeof r.authorName !== 'string') return null;
  if (typeof r.createdAt !== 'string') return null;
  return {
    id: r.id,
    parentId: typeof r.parentId === 'string' && r.parentId.length > 0 ? r.parentId : null,
    text: r.text,
    authorName: r.authorName,
    authorId: typeof r.authorId === 'string' ? r.authorId : null,
    createdAt: r.createdAt,
    resolved: r.resolved === true,
    ...(r.deleted === true ? { deleted: true } : {}),
  };
}

/** Toute une carte brute (Y.Map.toJSON(), JSON du disque) → entrées saines. */
export function sanitizeCommentMap(raw: unknown): Record<string, VaultComment> {
  const out: Record<string, VaultComment> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const c = sanitizeComment(value);
    if (c) out[c.id] = c;
  }
  return out;
}

/**
 * Fusion-par-UNION de deux cartes (la reprise du sidecar au 409). Par clé :
 * deleted l'emporte (OR — un tombstone ne se retire jamais), puis resolved
 * l'emporte (OR), puis le plus récent par createdAt, `b` gagnant l'égalité.
 */
export function mergeComments(
  a: Record<string, VaultComment>,
  b: Record<string, VaultComment>
): Record<string, VaultComment> {
  const out: Record<string, VaultComment> = { ...a };
  for (const [id, theirs] of Object.entries(b)) {
    const ours = out[id];
    if (!ours) {
      out[id] = theirs;
      continue;
    }
    const newest = theirs.createdAt >= ours.createdAt ? theirs : ours;
    out[id] = {
      ...newest,
      resolved: ours.resolved || theirs.resolved,
      ...(ours.deleted || theirs.deleted ? { deleted: true } : {}),
    };
  }
  return out;
}

/**
 * Égalité STABLE de deux cartes — la garde « rien n'a changé » de
 * l'observateur de salle : le rejeu du journal remplit la Y.Map avec ce que
 * le corps portait déjà, et le signaler comme un changement ferait committer
 * un document que personne n'a édité.
 */
export function commentsEqual(
  a: Record<string, VaultComment>,
  b: Record<string, VaultComment>
): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    const x = a[ka[i]];
    const y = b[ka[i]];
    if (
      x.parentId !== y.parentId ||
      x.text !== y.text ||
      x.authorName !== y.authorName ||
      x.authorId !== y.authorId ||
      x.createdAt !== y.createdAt ||
      x.resolved !== y.resolved ||
      (x.deleted === true) !== (y.deleted === true)
    ) {
      return false;
    }
  }
  return true;
}

/** La carte SANS tombstones — ce que le balayage d'orphelins doit recevoir
 *  (un tombstone compte comme présent pour findOrphanCommentIds, et sa marque
 *  doit précisément être balayée). */
export function withoutTombstones(all: Record<string, VaultComment>): Record<string, VaultComment> {
  const out: Record<string, VaultComment> = {};
  for (const [id, c] of Object.entries(all)) if (!c.deleted) out[id] = c;
  return out;
}

export interface VisibleComments {
  roots: VaultComment[];
  repliesByParent: Map<string, VaultComment[]>;
}

/**
 * Ce que le panneau affiche : tombstones exclus, réponses rattachées à leur
 * parent — ou promues racines si le parent est supprimé (une réponse ne meurt
 * pas avec le fil), tri createdAt croissant.
 */
export function visibleComments(all: Record<string, VaultComment>): VisibleComments {
  const alive = Object.values(all).filter((c) => !c.deleted);
  const aliveIds = new Set(alive.map((c) => c.id));
  const roots: VaultComment[] = [];
  const repliesByParent = new Map<string, VaultComment[]>();
  for (const c of alive) {
    if (c.parentId && aliveIds.has(c.parentId)) {
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }
  const byDate = (x: VaultComment, y: VaultComment) => x.createdAt.localeCompare(y.createdAt);
  roots.sort(byDate);
  for (const list of repliesByParent.values()) list.sort(byDate);
  return { roots, repliesByParent };
}
