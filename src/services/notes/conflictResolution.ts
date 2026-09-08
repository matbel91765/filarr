/**
 * Lecture d'une COPIE DE CONFLIT — module PUR (ni Redux, ni i18n, ni DOM).
 *
 * À QUOI ÇA SERT. La fusion note à note sauve le contenu que l'arbitrage
 * d'horloge allait détruire, sous la forme d'une note ordinaire
 * (`applyConflictCopies`). Une copie, c'est un aveu : la machine n'a pas su
 * choisir, elle a gardé les deux et laissé l'humain trancher. Encore faut-il lui
 * donner de quoi trancher — l'ORIGINE, les DEUX contenus, et les horodatages qui
 * disent lequel est lequel. Ce module reconstitue exactement cela, à partir de ce
 * que la copie porte et du magasin de notes, sans rien deviner.
 *
 * CE QU'IL NE FAIT PAS. Il ne modifie rien, ne fusionne rien, ne supprime rien :
 * il rend un rapport. Appliquer un choix (garder l'une, garder l'autre, coller
 * les deux) reste l'affaire de l'interface et du store — ici, aucune décision.
 * Il ne juge pas non plus la redondance : c'est le rôle de `ghostNotes.ts`, qui
 * répond à une autre question (« puis-je purger sans rien perdre ? »).
 *
 * CE QUE LA COPIE PORTE, ET POURQUOI ÇA SUFFIT.
 *  · `conflictOfId` — l'id de l'origine. Écrit par la MACHINE seule : c'est la
 *    seule signature qui survit à un renommage.
 *  · `conflictSavedAt` — l'instant de la fabrication.
 *  · `conflictOriginalUpdatedAt` — l'horodatage de la version PERDANTE avant que
 *    la copie ne le remplace par « maintenant » (la copie est datée du jour pour
 *    remonter en tête des listes triées par récence).
 *  · `conflictKeptUpdatedAt` — celui de la version CONSERVÉE au moment de la
 *    copie. Indispensable : l'utilisateur a pu continuer d'écrire dans l'original
 *    depuis, et son `updatedAt` d'aujourd'hui ne dit plus rien de l'arbitrage.
 *  · `conflictSide` / `conflictDevice` — d'où venait la perdante (`local` = de
 *    l'appareil qui fusionnait, `remote` = du nuage) et sur quelle plateforme la
 *    fusion a eu lieu. Le magasin ne porte AUCUNE identité d'appareil : on dit
 *    « ton ordinateur » ou « le nuage », jamais un nom de machine.
 *  · le CONTENU complet de la perdante — la copie EST cette version, aux marques
 *    près (id neuf, titre suffixé, champs de placement retirés).
 *
 * Les copies fabriquées AVANT que ces trois derniers champs n'existent n'en
 * portent pas : le rapport les rend à `null` plutôt que d'inventer une
 * provenance, et l'interface les tait.
 */

import type { Note } from '../../types/notes';
import { CONFLICT_TITLE_MARK } from '../../platform/web/sync/notesMerge';
import { normalizeText, reworkedAfterCopy } from './ghostNotes';

/**
 * Marque de titre telle que `conflictTitleSuffix` la pose : ` (⚠ 2026-08-15)`,
 * ou ` (⚠)` quand la date est illisible. Ancrée en FIN de titre — un ⚠ que
 * l'utilisateur aurait écrit lui-même au milieu d'un titre n'est pas une marque.
 */
const TITLE_MARK_PATTERN = new RegExp(`\\s*\\(${CONFLICT_TITLE_MARK}[^)]*\\)\\s*$`);

/** État de la note d'origine au moment de la lecture. */
export type ConflictOriginState =
  /** L'origine vit : les deux versions peuvent être comparées. */
  | 'live'
  /** L'origine est à la corbeille : restaurable, mais pas sous les yeux. */
  | 'trashed'
  /** L'origine a disparu du magasin : la copie est le dernier porteur. */
  | 'missing'
  /** La copie se réclame d'elle-même (donnée abîmée) : rien à comparer. */
  | 'self';

/** Une des deux versions à mettre face à face. */
export interface ConflictVersion {
  /** Id sous lequel cette version est stockée AUJOURD'HUI. */
  id: string;
  /** Titre sans la marque de conflit — celui que la version portait vraiment. */
  title: string;
  /** Document TipTap (JSON sérialisé), tel quel. */
  content: string;
  /** Texte brut, tel quel. */
  plainText: string;
  /**
   * Horodatage de CETTE version au moment de l'arbitrage. Pour la perdante,
   * c'est `conflictOriginalUpdatedAt` et non l'`updatedAt` de la copie (qui est
   * celui de la fabrication). `null` quand rien n'est lisible.
   */
  updatedAt: string | null;
}

/**
 * Tout ce qu'il faut pour montrer un conflit et le résoudre à la main.
 *
 * Correspondance avec le vocabulaire de la conception :
 * `origin`/`originId` = l'ORIGINE, `kept` = la VERSION LOCALE (celle que
 * l'arbitrage a conservée sous l'id d'origine), `losing` = la VERSION PERDANTE
 * (le contenu que la copie sauve), `timestamps` = les HORODATAGES.
 */
export interface ConflictResolution {
  /** Id de la copie de conflit elle-même. */
  copyId: string;
  /** Id de la note d'origine — `conflictOfId`, même si elle a disparu. */
  originId: string;
  originState: ConflictOriginState;
  /** La note d'origine telle qu'elle est stockée, ou `null` si introuvable. */
  origin: Note | null;
  /** Version CONSERVÉE par l'arbitrage, lue sur l'origine. `null` si introuvable. */
  kept: ConflictVersion | null;
  /** Version PERDANTE, reconstituée depuis la copie (marques retirées). */
  losing: ConflictVersion;
  /** `local` = la perdante était sur l'appareil qui fusionnait ; `remote` = elle venait du nuage. */
  side: 'local' | 'remote' | null;
  /** Plateforme qui a fusionné (`web`, `desktop`), ou `null` sur les copies anciennes. */
  device: string | null;
  /**
   * Les deux versions disent la même chose (titre, document et texte) : il n'y a
   * rien à résoudre, la copie peut être supprimée sans perte. Faux dès qu'un
   * doute subsiste.
   */
  identical: boolean;
  /** L'utilisateur a rouvert et modifié la copie depuis sa fabrication. */
  reworked: boolean;
  timestamps: {
    /** Fabrication de la copie (`conflictSavedAt`). */
    savedAt: string | null;
    /** Horodatage de la version perdante AVANT la copie. */
    losingUpdatedAt: string | null;
    /** Horodatage de la version conservée AU MOMENT de la copie. */
    keptUpdatedAtAtCopy: string | null;
    /** Horodatage de l'origine AUJOURD'HUI — a-t-elle rebougé depuis ? */
    keptUpdatedAtNow: string | null;
    /** Horodatage de la copie aujourd'hui (fabrication, ou retouche humaine). */
    copyUpdatedAt: string | null;
  };
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const isoOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Le titre débarrassé de la marque ` (⚠ …)` que la fabrication lui a ajoutée. */
export function stripConflictMark(title: unknown): string {
  return str(title).replace(TITLE_MARK_PATTERN, '').trim();
}

/**
 * Cette note est-elle une copie de conflit ? Le champ machine `conflictOfId` fait
 * foi, et lui seul : la marque du titre s'efface au premier renommage.
 */
export function isConflictCopy(note: Note | null | undefined): boolean {
  return !!note && typeof note.conflictOfId === 'string' && note.conflictOfId.trim() !== '';
}

/**
 * Rapport de résolution pour UNE copie, ou `null` si la note n'en est pas une.
 *
 * `byId` est le magasin des notes — n'importe quelle table `id → Note` fait
 * l'affaire (le store Redux, un instantané, un payload fusionné). Rien n'y est
 * écrit.
 */
export function describeConflictCopy(
  copy: Note,
  byId: Readonly<Record<string, Note>>
): ConflictResolution | null {
  if (!isConflictCopy(copy)) return null;
  const originId = str(copy.conflictOfId).trim();
  const origin = originId === copy.id ? null : (byId[originId] ?? null);

  const originState: ConflictOriginState =
    originId === copy.id ? 'self' : !origin ? 'missing' : origin.deletedAt ? 'trashed' : 'live';

  const losing: ConflictVersion = {
    id: copy.id,
    title: stripConflictMark(copy.title),
    content: str(copy.content),
    plainText: str(copy.plainText),
    // L'`updatedAt` de la copie date sa FABRICATION, pas la version perdante :
    // c'est `conflictOriginalUpdatedAt` qui porte la vraie horloge. Sur une copie
    // ancienne qui ne l'a pas, on préfère `null` à un horodatage qui ment.
    updatedAt: isoOrNull(copy.conflictOriginalUpdatedAt),
  };

  const kept: ConflictVersion | null = origin
    ? {
        id: origin.id,
        title: str(origin.title),
        content: str(origin.content),
        plainText: str(origin.plainText),
        // Ce que l'origine porte AUJOURD'HUI : c'est bien cette version-là qu'on
        // met face à la perdante, même si elle a rebougé depuis l'arbitrage —
        // `keptUpdatedAtAtCopy` dit, lui, où elle en était à la copie.
        updatedAt: isoOrNull(origin.updatedAt),
      }
    : null;

  return {
    copyId: copy.id,
    originId,
    originState,
    origin,
    kept,
    losing,
    side:
      copy.conflictSide === 'local' || copy.conflictSide === 'remote' ? copy.conflictSide : null,
    device: str(copy.conflictDevice) === '' ? null : str(copy.conflictDevice),
    identical: kept !== null && sameSubstance(losing, kept),
    reworked: reworkedAfterCopy(copy),
    timestamps: {
      savedAt: isoOrNull(copy.conflictSavedAt),
      losingUpdatedAt: isoOrNull(copy.conflictOriginalUpdatedAt),
      keptUpdatedAtAtCopy: isoOrNull(copy.conflictKeptUpdatedAt),
      keptUpdatedAtNow: origin ? isoOrNull(origin.updatedAt) : null,
      copyUpdatedAt: isoOrNull(copy.updatedAt),
    },
  };
}

/**
 * Les deux versions portent-elles la même chose ? Titre démarqué IDENTIQUE,
 * document IDENTIQUE à l'octet, texte identique aux blancs près. Volontairement
 * sévère : ce drapeau autorise l'interface à proposer « supprimer la copie »,
 * et un « à peu près » n'autorise rien du tout.
 */
function sameSubstance(a: ConflictVersion, b: ConflictVersion): boolean {
  return (
    a.title === stripConflictMark(b.title) &&
    a.content === b.content &&
    normalizeText(a.plainText) === normalizeText(b.plainText)
  );
}

/**
 * Toutes les copies de conflit d'un lot, de la plus récente à la plus ancienne
 * (l'id départage les ex æquo, pour un ordre stable d'un appel à l'autre).
 * Les copies à la CORBEILLE sont écartées : l'utilisateur les a déjà tranchées.
 */
export function listConflictResolutions(notes: readonly Note[]): ConflictResolution[] {
  const byId: Record<string, Note> = {};
  for (const note of notes) {
    if (note && typeof note.id === 'string') byId[note.id] = note;
  }
  const out: ConflictResolution[] = [];
  for (const note of notes) {
    if (!note || note.deletedAt) continue;
    const described = describeConflictCopy(note, byId);
    if (described) out.push(described);
  }
  out.sort((a, b) => {
    const dateA = a.timestamps.savedAt ?? a.timestamps.copyUpdatedAt ?? '';
    const dateB = b.timestamps.savedAt ?? b.timestamps.copyUpdatedAt ?? '';
    const byDate = dateB.localeCompare(dateA);
    return byDate !== 0 ? byDate : a.copyId.localeCompare(b.copyId);
  });
  return out;
}
