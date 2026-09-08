/**
 * openWith — AVEC QUOI OUVRIR CE FICHIER, et qui l'a décidé.
 *
 * ── LA RÈGLE QUI GOUVERNE TOUT LE MODULE ───────────────────────────────────
 * L'ABSENCE DE PRÉFÉRENCE NE CHANGE RIEN. Sans choix mémorisé, `cibleParDefaut`
 * rend exactement ce que le produit faisait avant ce module : l'éditeur qui
 * revendique l'extension, sinon l'application système. Aucune boîte ne surgit
 * au double-clic, aucun comportement ne bouge pour qui ne demande rien.
 *
 * C'est la condition pour qu'une fonctionnalité de confort ne devienne pas une
 * friction : un dialogue qui s'ouvrirait sur `.md`, `.txt`, `.csv`, `.pdf`
 * serait l'écran de toutes les frictions, pour un besoin qui se manifeste
 * trois fois par an.
 *
 * ── POURQUOI LA PRÉFÉRENCE N'EST PAS SYNCHRONISÉE ──────────────────────────
 * Elle est rangée dans le stockage du PROFIL, local à l'appareil, et ne monte
 * jamais au nuage. La liste des cibles dépend de la machine : les greffons
 * installés ne sont pas les mêmes, et « l'application système » désigne Word
 * ici et LibreOffice là. Synchroniser ce choix, ce serait imposer à un
 * appareil une décision prise pour un autre.
 */

import profileStorage from '../core/profileStorage';
import {
  editorAcceptsSize,
  editorsForFileName,
  importerForFileName,
  trustOfProvider,
} from '../plugins/pluginRegistry';
import type { EditorProvider } from '../plugins/pluginTypes';

/** Une façon d'ouvrir un fichier. */
export type OpenTarget =
  | {
      kind: 'editor';
      /** Identifiant STABLE de la cible, tel qu'il est mémorisé. */
      id: string;
      provider: EditorProvider;
      displayName: string;
      /** Cet éditeur ouvre le format NATIVEMENT, ou l'IMPORTE dans le sien. */
      mode: 'native' | 'import';
      /** Vrai pour un greffon du cœur ; faux pour un greffon tiers. */
      builtin: boolean;
    }
  | { kind: 'preview'; id: 'preview' }
  | { kind: 'system'; id: 'system' };

export type OpenTargetKind = OpenTarget['kind'];

/**
 * L'identifiant mémorisé d'une cible.
 *
 * Il vaut l'id de la CONTRIBUTION, pas la position dans la liste : un greffon
 * désinstallé puis réinstallé, ou une liste qui change d'ordre, ne doit pas
 * faire pointer la préférence sur un autre éditeur. Une préférence qui ne
 * correspond plus à rien est ignorée, jamais devinée.
 */
export function targetId(t: OpenTarget): string {
  return t.id;
}

const CLE_PREFERENCES = 'filarr.openWith.byExtension';

/** L'extension, en minuscules et sans point — la clé de préférence. */
export function extensionOf(fileName: string): string {
  const point = fileName.lastIndexOf('.');
  if (point <= 0) return '';
  return fileName.slice(point + 1).toLowerCase();
}

// ── Les préférences ──────────────────────────────────────────────────────────

type Preferences = Record<string, string>;

function lire(): Preferences {
  try {
    const brut = profileStorage.getItem(CLE_PREFERENCES);
    if (!brut) return {};
    const parse: unknown = JSON.parse(brut);
    if (!parse || typeof parse !== 'object' || Array.isArray(parse)) return {};
    // On ne garde que les paires de chaînes : un stockage local est modifiable,
    // et une valeur exotique ne doit pas se propager jusqu'à la résolution.
    return Object.fromEntries(
      Object.entries(parse as Record<string, unknown>).filter(
        ([k, v]) => typeof k === 'string' && typeof v === 'string'
      )
    ) as Preferences;
  } catch {
    return {};
  }
}

function ecrire(prefs: Preferences): void {
  try {
    profileStorage.setItem(CLE_PREFERENCES, JSON.stringify(prefs));
  } catch {
    // Un stockage plein ou refusé ne doit pas empêcher d'ouvrir un fichier.
  }
}

/** La cible mémorisée pour cette extension, ou null. */
export function preferenceFor(fileName: string): string | null {
  const ext = extensionOf(fileName);
  if (!ext) return null;
  return lire()[ext] ?? null;
}

export function rememberPreference(fileName: string, id: string): void {
  const ext = extensionOf(fileName);
  if (!ext) return;
  const prefs = lire();
  prefs[ext] = id;
  ecrire(prefs);
}

export function forgetPreference(fileName: string): void {
  const ext = extensionOf(fileName);
  if (!ext) return;
  const prefs = lire();
  delete prefs[ext];
  ecrire(prefs);
}

/** Toutes les préférences, pour l'écran de réglages. */
export function allPreferences(): Preferences {
  return lire();
}

export function clearAllPreferences(): void {
  ecrire({});
}

// ── Les cibles disponibles ───────────────────────────────────────────────────

export interface TargetsInput {
  fileName: string;
  /** Taille du fichier, si connue — elle écarte les éditeurs qui la refusent. */
  size?: number;
  /** Le fichier a-t-il un aperçu ? L'appelant tranche (le registre l'ignore). */
  hasPreview: boolean;
  /** L'ouverture par l'application système est-elle possible ici ? */
  canOpenSystem: boolean;
  /**
   * Autoriser les cibles d'IMPORT (ouvrir un `.docx` dans l'éditeur de
   * documents, par exemple).
   *
   * FAUX PAR DÉFAUT, ET CE N'EST PAS DE LA PRUDENCE. `getBytes()` d'un éditeur
   * rend TOUJOURS son format natif : enregistrer un `.docx` ouvert par
   * importeur écrirait des octets `.fdoc` sous un nom `.docx`, et le fichier ne
   * serait plus ouvrable par personne — ni par Word, ni par Filarr. Tant que
   * l'hôte ne sait pas CONVERTIR (créer un fichier neuf au bon format en
   * laissant l'original intact), proposer cette ouverture serait offrir un
   * geste destructeur.
   */
  allowImport?: boolean;
}

/**
 * Toutes les façons d'ouvrir ce fichier, de la plus spécifique à la plus
 * générique : éditeurs natifs, puis importeur, puis aperçu, puis système.
 *
 * Les éditeurs qui REFUSENT la taille sont écartés de la liste plutôt que
 * grisés dedans : proposer une ouverture qu'on sait devoir refuser n'aide
 * personne, et l'aperçu (qui sait fenêtrer) est juste en dessous.
 */
export function openTargetsFor(input: TargetsInput): OpenTarget[] {
  const { fileName, size, hasPreview, canOpenSystem } = input;
  const cibles: OpenTarget[] = [];

  for (const provider of editorsForFileName(fileName)) {
    if (!editorAcceptsSize(provider, size)) continue;
    cibles.push({
      kind: 'editor',
      id: provider.contribution.id,
      provider,
      displayName: provider.contribution.displayName,
      mode: 'native',
      builtin: trustOfProvider(provider) === 'builtin',
    });
  }

  // L'IMPORTEUR n'apparaît que si aucun éditeur ne revendique le format
  // nativement : ouvrir un `.fdoc` « en important » n'aurait aucun sens, et
  // proposer les deux pour le même fichier ne ferait qu'obscurcir le choix.
  if (cibles.length === 0 && input.allowImport === true) {
    const importeur = importerForFileName(fileName);
    if (importeur && editorAcceptsSize(importeur, size)) {
      cibles.push({
        kind: 'editor',
        id: importeur.contribution.id,
        provider: importeur,
        displayName: importeur.contribution.displayName,
        mode: 'import',
        builtin: trustOfProvider(importeur) === 'builtin',
      });
    }
  }

  if (hasPreview) cibles.push({ kind: 'preview', id: 'preview' });
  if (canOpenSystem) cibles.push({ kind: 'system', id: 'system' });
  return cibles;
}

/**
 * La cible qu'un double-clic doit emprunter.
 *
 * Sans préférence, c'est la PREMIÈRE de la liste — donc exactement le
 * comportement d'avant ce module. Une préférence qui ne correspond à aucune
 * cible disponible (greffon désinstallé, fichier devenu trop gros) est
 * ignorée : on retombe sur le défaut plutôt que de refuser d'ouvrir.
 */
export function defaultTargetFor(input: TargetsInput): OpenTarget | null {
  const cibles = openTargetsFor(input);
  if (cibles.length === 0) return null;
  const memorise = preferenceFor(input.fileName);
  if (memorise) {
    const trouvee = cibles.find((c) => c.id === memorise);
    if (trouvee) return trouvee;
  }
  return cibles[0];
}

/**
 * Faut-il DEMANDER avant d'ouvrir ?
 *
 * Une seule situation le justifie : un format qu'aucun éditeur ne revendique
 * mais qu'un éditeur sait IMPORTER — un `.docx`, typiquement. Ouvrir dans
 * Filarr y crée un document d'un autre format, et le faire sans demander
 * serait une conversion subie. Partout ailleurs, on ouvre.
 */
export function shouldAskBeforeOpening(input: TargetsInput): boolean {
  if (preferenceFor(input.fileName)) return false;
  const cibles = openTargetsFor(input);
  return cibles.some((c) => c.kind === 'editor' && c.mode === 'import');
}
