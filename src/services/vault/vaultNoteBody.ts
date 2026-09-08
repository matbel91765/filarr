/**
 * vaultNoteBody — l'ENVELOPPE du corps d'une note de coffre.
 *
 * Historiquement, le corps chiffré d'une note de coffre est un document
 * ProseMirror nu ({type:'doc', ...}). Les commentaires (Temps 2) y ajoutent
 * une enveloppe versionnée — {format:'filarr.note+comments', v:1, doc,
 * comments} — écrite SEULEMENT quand il existe au moins un commentaire
 * (tombstones compris) : une note jamais commentée continue de s'écrire nue,
 * lisible par tout client antérieur.
 *
 * FENÊTRE DE VERSIONS MIXTES, assumée et écrite ici : un client pré-T2 ne
 * peut pas OUVRIR une note commentée (son parse exige type==='doc' →
 * 'unsupported') ; et un client pré-T2 déjà EN SALLE (note ouverte avant le
 * premier commentaire), s'il est élu écrivain, persiste un corps nu — les
 * commentaires restent dans la Y.Map de la salle et reviennent au prochain
 * enregistrement d'un client T2. Auto-réparant, jamais silencieusement
 * corrompu.
 *
 * TOUS les lecteurs du corps passent par ce module (VaultNoteEditor,
 * TransclusionNodeView) — en oublier un fait tomber les notes commentées en
 * 'unsupported' ou casse les transclusions.
 */

import { sanitizeCommentMap, type VaultComment } from './vaultComments';

export const VAULT_NOTE_FORMAT = 'filarr.note+comments';

export interface VaultNoteBody {
  doc: unknown;
  comments: Record<string, VaultComment>;
}

/** Une VALEUR déjà parsée (objet) ou brute (texte) → {doc, comments} | null. */
export function normalizeVaultNoteBodyValue(value: unknown): VaultNoteBody | null {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (p.type === 'doc') return { doc: parsed, comments: {} };
  if (
    p.format === VAULT_NOTE_FORMAT &&
    p.v === 1 &&
    p.doc &&
    typeof p.doc === 'object' &&
    (p.doc as { type?: string }).type === 'doc'
  ) {
    return { doc: p.doc, comments: sanitizeCommentMap(p.comments) };
  }
  return null;
}

export function parseVaultNoteBodyText(text: string): VaultNoteBody | null {
  return normalizeVaultNoteBodyValue(text);
}

export function parseVaultNoteBody(bytes: Uint8Array): VaultNoteBody | null {
  try {
    return normalizeVaultNoteBodyValue(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/**
 * Sérialise le corps : doc NU si aucun commentaire (compat descendante),
 * enveloppe v1 sinon. Les tombstones COMPTENT comme commentaires — les
 * retirer ferait ressusciter les supprimés à la prochaine fusion.
 */
export function serializeVaultNoteBody(
  doc: unknown,
  comments: Record<string, VaultComment>
): Uint8Array {
  const body =
    Object.keys(comments).length === 0 ? doc : { format: VAULT_NOTE_FORMAT, v: 1, doc, comments };
  return new TextEncoder().encode(JSON.stringify(body));
}
