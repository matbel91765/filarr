/**
 * INSTALLER UN MODÈLE VENU DU CATALOGUE — le geste, et ce qu'il refuse.
 *
 * ── INSTALLER N'EST PAS APPLIQUER ───────────────────────────────────────────
 *
 * Ce module range le modèle dans la BIBLIOTHÈQUE locale. Il ne touche pas à
 * l'accueil de qui que ce soit. Appliquer reste le geste séparé de
 * `useApplyLayoutFile`, qui crée une mise en page NOMMÉE et laisse la
 * précédente intacte à un clic.
 *
 * La distinction n'est pas cosmétique : télécharger quelque chose et voir son
 * écran changer dans la foulée est exactement ce qui fait qu'on n'essaie plus
 * rien. Deux gestes, deux décisions.
 *
 * ── CE QUI EST VÉRIFIÉ, ET DANS QUEL ORDRE ──────────────────────────────────
 *
 *   1. la SIGNATURE, l'anti-substitution et l'empreinte (`verifyPublishedLayout`) ;
 *   2. le CHANGEMENT DE CLÉ, si ce slug est déjà installé (voir plus bas) ;
 *   3. l'écriture en bibliothèque, avec l'origine.
 *
 * ── LE CHANGEMENT DE CLÉ D'ÉDITEUR ──────────────────────────────────────────
 *
 * Un modèle publié aujourd'hui par une clé, mis à jour demain par une autre,
 * est le scénario d'usurpation qui reste ouvert quand tout le reste est fermé :
 * la signature est valide, l'empreinte correspond à la clé qui a signé, le slug
 * est le bon — et pourtant ce n'est plus la même personne.
 *
 * Aucune cryptographie ne tranche ça : la seule autorité est ce que
 * l'utilisateur a vu et accepté la première fois (TOFU). On REFUSE donc, et on
 * laisse l'appelant redemander explicitement avec `acceptKeyChange`. Le refus
 * porte les deux empreintes, pour que l'écran puisse les montrer côte à côte —
 * les comparer de mémoire ne marche pas.
 */

import type { LayoutFile } from './layoutFormat';
import { apiGetLayoutMarketEnvelope, type LayoutMarketEnvelopeDTO } from './layoutMarketApi';
import { verifyPublishedLayout } from './layoutMarketSigning';
import type { LayoutMarketEnvelope } from './layoutMarketTypes';
import { importSummary, type LayoutValidationOk } from './layoutValidator';
import {
  listLayoutLibrary,
  saveToLayoutLibrary,
  type LibraryEntry,
  type LibraryOrigin,
} from './layoutLibrary';

/**
 * « Ce n'est plus la même clé qui signe. »
 *
 * Une classe à part et non un code de plus dans `LayoutMarketVerifyError` : ce
 * refus n'est PAS un défaut de l'enveloppe (elle est parfaitement valide), c'est
 * une décision qui appartient à l'utilisateur. Les confondre pousserait un
 * appelant à traiter les deux de la même façon — c'est-à-dire à afficher
 * « modèle corrompu » là où il faut poser une question.
 */
export class PublisherKeyChangedError extends Error {
  readonly knownFingerprint: string;
  readonly newFingerprint: string;

  constructor(knownFingerprint: string, newFingerprint: string) {
    super('publisher_key_changed');
    this.name = 'PublisherKeyChangedError';
    this.knownFingerprint = knownFingerprint;
    this.newFingerprint = newFingerprint;
  }
}

// ==================== L'état d'une ligne ====================

/**
 * Trois états, et pas six. Les extensions en ont davantage (`broken`,
 * `conflict`, `disabled`) parce qu'un greffon s'exécute, s'enregistre et peut
 * échouer à l'un ou l'autre. Un modèle est un document : il est là, ou il ne
 * l'est pas, ou il en existe une version plus récente.
 */
export type LayoutEntryState = 'available' | 'installed' | 'update';

export interface LayoutEntryVerdict {
  state: LayoutEntryState;
  installedVersion: string | null;
  latestVersion: string;
}

/** Compare deux semver stricts (`\d+\.\d+\.\d+`). Rend > 0 si `a` est plus récent. */
export function compareLayoutVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * L'état d'une ligne du catalogue, croisé avec la bibliothèque.
 *
 * ⚠ L'index est fait sur le SLUG et non sur l'identifiant de fichier : un
 * auteur qui régénère sa disposition change l'`id` du fichier, et un index par
 * `id` afficherait « disponible » sur un modèle déjà installé.
 */
export function layoutEntryState(
  latestVersion: string,
  installedOrigin: LibraryOrigin | undefined
): LayoutEntryVerdict {
  if (!installedOrigin) {
    return { state: 'available', installedVersion: null, latestVersion };
  }
  const base = { installedVersion: installedOrigin.version, latestVersion };
  if (compareLayoutVersions(latestVersion, installedOrigin.version) > 0) {
    return { ...base, state: 'update' };
  }
  return { ...base, state: 'installed' };
}

/** Les origines installées, indexées par slug — l'entrée du croisement ci-dessus. */
export function originsBySlug(entries: readonly LibraryEntry[]): Map<string, LibraryOrigin> {
  const out = new Map<string, LibraryOrigin>();
  for (const entry of entries) {
    if (entry.origin) out.set(entry.origin.slug, entry.origin);
  }
  return out;
}

// ==================== Installer ====================

export interface InstallLayoutResult {
  /** Le fichier RECONSTRUIT par le validateur — jamais celui du réseau. */
  file: LayoutFile;
  envelope: LayoutMarketEnvelope;
  /** « 12 appliqués, 1 en attente, 0 ignoré » — déjà compté, pas à recompter. */
  summary: ReturnType<typeof importSummary>;
}

export interface InstallLayoutOptions {
  slug: string;
  version: string;
  /** Les types que CE binaire sait rendre. Donnés, jamais importés d'ici. */
  knownTypes: ReadonlySet<string>;
  /** L'utilisateur a vu les deux empreintes et a dit oui. */
  acceptKeyChange?: boolean;
  /** Injection pour les tests — en production, le vrai appel réseau. */
  fetchEnvelope?: (slug: string, version: string) => Promise<LayoutMarketEnvelopeDTO>;
}

/**
 * Télécharge, VÉRIFIE, puis range. Jette plutôt que de rendre un booléen : un
 * appelant qui oublie de regarder un booléen installerait quand même.
 */
export async function installLayoutTemplate(
  opts: InstallLayoutOptions
): Promise<InstallLayoutResult> {
  const fetchEnvelope = opts.fetchEnvelope ?? apiGetLayoutMarketEnvelope;
  const dto = await fetchEnvelope(opts.slug, opts.version);

  // 1. Toute la confiance tient ici. `expected` est obligatoire : sans lui, une
  // signature valide suffirait, et un serveur compromis substituerait un modèle
  // à un autre.
  const inspection = await verifyPublishedLayout({
    envelopeJson: dto.envelopeJson,
    signature: dto.signature,
    signPublicKey: dto.signPublicKey,
    expected: { slug: opts.slug, version: opts.version },
    knownTypes: opts.knownTypes,
  });
  const { envelope, validation } = inspection;

  // 2. TOFU. La bibliothèque est relue MAINTENANT et non passée en paramètre :
  // entre l'affichage de la liste et le clic, une autre installation a pu
  // passer, et c'est l'état au moment du geste qui fait autorité.
  if (!opts.acceptKeyChange) {
    const known = originsBySlug(listLayoutLibrary(opts.knownTypes)).get(opts.slug);
    if (known && known.publisherFingerprint !== envelope.publisherFingerprint) {
      throw new PublisherKeyChangedError(known.publisherFingerprint, envelope.publisherFingerprint);
    }
  }

  // 3. Ranger — le fichier RECONSTRUIT par le validateur, celui dont les blocs
  // fautifs ont été écartés, jamais l'objet brut du réseau.
  saveToLayoutLibrary(validation.file, opts.knownTypes, undefined, {
    slug: envelope.slug,
    version: envelope.version,
    publisherFingerprint: envelope.publisherFingerprint,
  });

  return {
    file: validation.file,
    envelope,
    summary: importSummary(validation as LayoutValidationOk),
  };
}
