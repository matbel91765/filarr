/**
 * Logique PURE du badge « Partagée » — ce que le badge DIT et où il MÈNE, par
 * état, sans React ni Redux, pour que la matrice se teste en isolement (même
 * raison que `noteShareModel`, dont ce module est la couche de présentation).
 *
 * Le composant `NoteSharedBadge` ne fait que : lire l'entrée de la note dans
 * `selectShareInfoByNoteId`, appeler ces fonctions, traduire les textes rendus
 * ici sous forme (clé, repli, paramètres) et poser le résultat dans le DOM.
 *
 * DISCIPLINE DE LANGAGE. Les textes parlent de COPIE et d'ENVOI, jamais de
 * synchronisation : la copie déposée dans un coffre vit sa vie indépendante
 * (voir `NoteShareRef`). Un badge lu comme « à jour » ferait lire à un membre
 * une version périmée en toute confiance — c'est le mensonge que ce module
 * a pour rôle de rendre impossible à formuler.
 */

import type { NoteShareBadgeState } from '../../../services/notes/noteShareModel';
import type { NoteShareEntry, NoteShareInfo } from '../../../store/selectors/noteShareSelectors';
import { vaultShareDestination } from './noteShareNavigation';

/**
 *  - `dot`  : le glyphe seul (cartes de liste, récents, épinglés, arbre) ;
 *  - `chip` : « Coffre <Nom> » dans la rangée d'emplacement d'une carte ;
 *  - `full` : icône + libellé, dans l'en-tête de l'éditeur.
 */
export type NoteSharedBadgeVariant = 'dot' | 'chip' | 'full';

/**
 * Un texte à traduire : la clé i18n, son repli anglais, et ses paramètres
 * d'interpolation. Le modèle ne connaît pas `t` ; c'est l'appelant qui
 * traduit — ce qui permet de tester les CHOIX (quelle clé, quels paramètres)
 * sans monter i18next.
 */
export interface ShareBadgeText {
  key: string;
  fallback: string;
  params?: Record<string, string | number>;
}

/**
 * On ne mène quelque part que quand il y a quelque chose à voir : la copie
 * (`live`) ou le coffre à déverrouiller pour la voir (`locked`). Un coffre
 * disparu n'a pas d'adresse ; une copie manquante mènerait à une liste où elle
 * n'est pas — le clic se lirait comme « elle est bien là » ; `unknown` est
 * transitoire (chargement) et devient l'un des deux premiers d'ici peu.
 */
export function isShareBadgeNavigable(state: NoteShareBadgeState): boolean {
  return state === 'live' || state === 'locked';
}

/**
 * Le dépôt que le badge REPRÉSENTE : le premier dont l'état égale le résumé
 * (`info.badge` est le meilleur état par préséance — voir `noteShareModel`).
 * Avec une copie visible dans le coffre A et une copie manquante dans le
 * coffre B, le badge dit `live`, donc son infobulle nomme A et son clic ouvre
 * A — pas B, qui n'a rien à montrer. Repli sur la première entrée si aucune ne
 * porte l'état résumé (impossible par construction, mais le type l'exige).
 */
export function primaryShareEntry(info: NoteShareInfo): NoteShareEntry {
  return info.entries.find((e) => e.state === info.badge) ?? info.entries[0];
}

/** Nombre de dépôts AUTRES que celui que le badge représente — le « +N ». */
export function shareBadgeExtraCount(info: NoteShareInfo): number {
  return Math.max(0, info.entries.length - 1);
}

/** La route qu'ouvre le clic, `null` si l'état ne mène nulle part. */
export function shareBadgeDestination(info: NoteShareInfo): string | null {
  if (!isShareBadgeNavigable(info.badge)) return null;
  return vaultShareDestination(primaryShareEntry(info).ref);
}

/**
 * La date d'envoi, dans la locale de l'interface ; chaîne vide si l'horodatage
 * est illisible (une note importée avec un `at` corrompu ne doit pas afficher
 * « Invalid Date » dans une infobulle).
 */
export function formatShareDate(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * L'infobulle d'UN dépôt, honnête par état. Les seuls états qui NOMMENT le
 * coffre sont ceux où le coffre est connu (`live`, `copyMissing`) ; `vaultGone`
 * n'a plus de nom à donner et `unknown` ne promet rien.
 */
export function shareBadgeTooltip(
  entry: Pick<NoteShareEntry, 'state' | 'vaultName' | 'ref'>,
  locale?: string
): ShareBadgeText {
  const vault = entry.vaultName ?? '';
  switch (entry.state) {
    case 'live':
      return {
        key: 'notes.sharedBadge.live',
        fallback:
          'A copy is in the vault "{{vault}}" (sent on {{date}}). Changes made here do not propagate to it.',
        params: { vault, date: formatShareDate(entry.ref.at, locale) },
      };
    case 'locked':
      return {
        key: 'notes.sharedBadge.locked',
        fallback: 'Copy in a locked vault — unlock it to open it.',
      };
    case 'copyMissing':
      return {
        key: 'notes.sharedBadge.copyMissing',
        fallback:
          'The copy sent to the vault "{{vault}}" cannot be found — probably deleted from the vault.',
        params: { vault },
      };
    case 'vaultGone':
      return {
        key: 'notes.sharedBadge.vaultGone',
        fallback: 'The vault that held the copy is no longer accessible.',
      };
    case 'unknown':
    default:
      return { key: 'notes.sharedBadge.unknown', fallback: 'Shared' };
  }
}

/**
 * La ligne « aussi dans N autre(s) coffre(s) » ajoutée à l'infobulle quand la
 * note est déposée à plusieurs endroits ; `null` s'il n'y en a qu'un.
 */
export function shareBadgeMoreTooltip(info: NoteShareInfo): ShareBadgeText | null {
  const count = shareBadgeExtraCount(info);
  if (count === 0) return null;
  return {
    key: 'notes.sharedBadge.moreVaults',
    fallback: 'Also in {{count}} other vault(s).',
    params: { count },
  };
}

/**
 * Le libellé COURT de la variante `full`. Il suit l'état, sinon un « Partagée »
 * vert à côté d'une copie manquante dirait le contraire de l'infobulle.
 */
export function shareBadgeLabel(state: NoteShareBadgeState): ShareBadgeText {
  switch (state) {
    case 'locked':
      return { key: 'notes.sharedBadge.labelLocked', fallback: 'Shared · locked vault' };
    case 'copyMissing':
      return { key: 'notes.sharedBadge.labelCopyMissing', fallback: 'Copy missing' };
    case 'vaultGone':
      return { key: 'notes.sharedBadge.labelVaultGone', fallback: 'Vault unavailable' };
    case 'live':
    case 'unknown':
    default:
      return { key: 'notes.sharedBadge.label', fallback: 'Shared' };
  }
}

/**
 * Le texte du chip : « Coffre <Nom> » quand le nom est connu, « Coffre » nu
 * sinon (coffre disparu ou liste pas encore chargée). Le « +N » est rendu à
 * part par le composant (`shareBadgeExtraCount`), pour être stylé comme un
 * suffixe et non fondu dans le nom tronqué.
 */
export function shareBadgeChipLabel(entry: Pick<NoteShareEntry, 'vaultName'>): ShareBadgeText {
  if (entry.vaultName) {
    return {
      key: 'notes.sharedBadge.chip',
      fallback: 'Vault {{vault}}',
      params: { vault: entry.vaultName },
    };
  }
  return { key: 'notes.sharedBadge.chipNoVault', fallback: 'Vault' };
}
