/**
 * entryState — L'ÉTAT D'INSTALLATION, EN UN COUP D'ŒIL.
 *
 * L'ancienne liste disait tout par la forme du bouton : un bouton secondaire
 * « Installer », un bouton secondaire « Mettre à jour » (même variante, même
 * taille, même couleur — indiscernables au balayage), ou un texte gris de douze
 * pixels « Installé ». Et rien du tout pour une extension installée mais
 * DÉSACTIVÉE, ou installée mais CASSÉE : ces deux-là s'affichaient exactement
 * comme une extension saine.
 *
 * Ici, un seul verdict par ligne, calculé une fois, qui décide à la fois de la
 * pastille, de sa couleur et du bouton principal. Un état = une couleur = un
 * mot ; c'est ce qui rend une liste lisible sans la lire.
 *
 * Module PUR.
 */

import { compareSemver } from '../../../services/plugins/marketplaceTypes';
import type { LoadedPluginState } from '../../../services/plugins/installedPlugins';

/**
 * L'ordre compte : du plus urgent au plus banal. En cas de cumul (une extension
 * cassée ET une mise à jour disponible), c'est le PROBLÈME qui gagne — une
 * pastille « mise à jour » sur une extension qui ne fonctionne plus dirait la
 * moins importante des deux vérités.
 */
export type EntryState =
  /** Vérifiée à l'installation, refusée par le registre : installée mais inerte. */
  | 'broken'
  | 'conflict'
  /** Une version plus récente existe en ligne. */
  | 'update'
  /** Installée et volontairement coupée. */
  | 'disabled'
  /** Installée, active, à jour. */
  | 'installed'
  /** Jamais installée ici. */
  | 'available';

export interface EntryVerdict {
  state: EntryState;
  installedVersion: string | null;
  latestVersion: string | null;
}

/** L'état d'une ligne du catalogue, croisé avec ce qui est installé. */
export function catalogEntryState(
  latestVersion: string,
  installed: LoadedPluginState | undefined
): EntryVerdict {
  if (!installed) return { state: 'available', installedVersion: null, latestVersion };
  const base = { installedVersion: installed.installedVersion, latestVersion };
  if (installed.status === 'broken_signature') return { ...base, state: 'broken' };
  if (installed.status === 'register_failed') return { ...base, state: 'conflict' };
  // Enregistré, mais jamais celui qui ouvre : la même pastille « conflit »
  // qu'un refus, parce que du point de vue de l'utilisateur la conséquence est
  // la même — l'extension est là et ne sert pas.
  if (installed.status === 'shadowed') return { ...base, state: 'conflict' };
  if (compareSemver(latestVersion, installed.installedVersion) > 0) {
    return { ...base, state: 'update' };
  }
  if (installed.status === 'disabled') return { ...base, state: 'disabled' };
  return { ...base, state: 'installed' };
}

/** L'état d'une ligne de « Mes extensions » — le catalogue n'est qu'un indice. */
export function installedEntryState(
  installed: LoadedPluginState,
  latestVersion: string | null
): EntryVerdict {
  const base = { installedVersion: installed.installedVersion, latestVersion };
  if (installed.status === 'broken_signature') return { ...base, state: 'broken' };
  if (installed.status === 'register_failed') return { ...base, state: 'conflict' };
  // Enregistré, mais jamais celui qui ouvre : la même pastille « conflit »
  // qu'un refus, parce que du point de vue de l'utilisateur la conséquence est
  // la même — l'extension est là et ne sert pas.
  if (installed.status === 'shadowed') return { ...base, state: 'conflict' };
  if (latestVersion && compareSemver(latestVersion, installed.installedVersion) > 0) {
    return { ...base, state: 'update' };
  }
  if (installed.status === 'disabled') return { ...base, state: 'disabled' };
  return { ...base, state: 'installed' };
}

/** Le ton visuel de chaque état — une seule table, aucun `if` dans le JSX. */
export const ENTRY_TONE: Record<EntryState, 'danger' | 'warn' | 'info' | 'ok' | 'muted' | 'none'> =
  {
    broken: 'danger',
    conflict: 'warn',
    update: 'info',
    disabled: 'muted',
    installed: 'ok',
    available: 'none',
  };

/** La clé i18n du mot de la pastille. `available` n'en a pas : pas de pastille. */
export const ENTRY_LABEL_KEY: Record<EntryState, string | null> = {
  broken: 'marketplace.state.broken',
  conflict: 'marketplace.state.conflict',
  update: 'marketplace.state.update',
  disabled: 'marketplace.state.disabled',
  installed: 'marketplace.state.installed',
  available: null,
};

/**
 * Le tri du catalogue. Le serveur rend 50 lignes dans SON ordre ; l'ancien écran
 * n'offrait aucun contrôle et ne disait pas non plus quel était cet ordre. Ces
 * trois clés sont locales à la page servie — elles ne mentent donc pas : elles
 * ordonnent ce qui est à l'écran, ce que l'intitulé dit.
 */
export type CatalogSort = 'relevance' | 'downloads' | 'recent' | 'name';

export const CATALOG_SORTS: readonly CatalogSort[] = [
  'relevance',
  'downloads',
  'recent',
  'name',
] as const;

export interface SortableEntry {
  name: string;
  downloads: number;
  updatedAt: string;
}

export function sortCatalog<T extends SortableEntry>(rows: readonly T[], sort: CatalogSort): T[] {
  const copy = rows.slice();
  switch (sort) {
    case 'downloads':
      return copy.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
    case 'recent':
      // Une date servie peut être absente ou farfelue : `NaN` retomberait en
      // comparaison instable, on la ramène donc à l'époque zéro.
      return copy.sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt));
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'relevance':
    default:
      // L'ordre du serveur, tel quel — c'est lui qui a exécuté la recherche.
      return copy;
  }
}

function dateValue(raw: unknown): number {
  if (typeof raw !== 'string') return 0;
  const v = Date.parse(raw);
  return Number.isFinite(v) ? v : 0;
}
