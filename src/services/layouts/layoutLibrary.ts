/**
 * LA BIBLIOTHÈQUE LOCALE DE MODÈLES — ce qu'on a importé, et rien d'autre.
 *
 * ── POURQUOI ELLE N'EST PAS DANS `layout.enc` ───────────────────────────────
 *
 * Le conteneur chiffré porte déjà des `templates`, et l'y ranger aurait semblé
 * naturel. Deux raisons l'interdisent :
 *
 *  1. `normalizeLayoutDocument` (electron/sync/layoutMergeCore.ts) RECONSTRUIT
 *     chaque gabarit champ par champ : `id`, `name`, `slots`, `updatedAt`,
 *     `version`, `author`. Tout le reste — la description, l'icône, la
 *     catégorie, la cible, les emplacements nommés — serait effacé au premier
 *     aller-retour disque, sans un message, et le modèle importé perdrait
 *     exactement ce qui le rend présentable. Le format de fusion est figé et
 *     hors de ce chantier : on ne l'élargit pas en passant.
 *  2. Un modèle importé est un objet de TRAVAIL, pas une préférence : le
 *     synchroniser ferait remonter dans le nuage un fichier reçu de
 *     l'extérieur, ce que personne n'a demandé.
 *
 * Le stockage est donc LOCAL et PAR PROFIL (`profileStorage`) : ce qu'un profil
 * importe ne se voit pas depuis un autre, comme le reste de ce qui le concerne.
 * Quand la v2 en ligne arrivera, c'est CE module qui gagnera une seconde source
 * (le catalogue distant) — l'interface, elle, n'aura pas à changer.
 */

import { getItem, removeItem, setItem } from '../core/profileStorage';
import { LAYOUT_FILE_MAX_BYTES, utf8ByteLength, type LayoutFile } from './layoutFormat';
import { validateLayoutFile } from './layoutValidator';

/** Clé de stockage, portée par le profil actif. */
const STORAGE_KEY = 'filarr.layouts.library';

/** Modèles gardés. Au-delà, le plus ancien sort — une bibliothèque, pas une décharge. */
export const LIBRARY_MAX_ENTRIES = 60;

/**
 * Budget total, en octets UTF-8. `localStorage` est un quota partagé par tout le
 * profil : une bibliothèque qui grossirait sans limite ferait échouer des
 * écritures qui n'ont rien à voir avec elle, et le symptôme apparaîtrait
 * ailleurs.
 */
export const LIBRARY_MAX_BYTES = 2 * 1024 * 1024;

/**
 * D'OÙ VIENT UN MODÈLE INSTALLÉ DEPUIS LE CATALOGUE.
 *
 * Absent = il est arrivé par fichier, de la main à la main. C'est la
 * distinction qui fonde tout le modèle de confiance : un fichier qu'on vous
 * donne n'a aucune provenance à revendiquer, une fiche de catalogue en a une.
 *
 * ⚠ CE N'EST PAS UNE PREUVE, C'EST UN SOUVENIR. Ces trois champs sont posés
 * APRÈS une vérification de signature réussie, et ils dorment ensuite dans le
 * stockage du navigateur — que n'importe quelle XSS, ou n'importe qui devant la
 * machine, peut réécrire. Ils servent à afficher « installé » et « mise à jour
 * disponible » ; ils ne servent JAMAIS à décider qu'un modèle est authentique.
 * Cette décision-là se reprend à zéro, à chaque installation, dans
 * `verifyPublishedLayout`.
 */
export interface LibraryOrigin {
  slug: string;
  version: string;
  /** Six groupes de cinq chiffres — celle qui était affichée à l'installation. */
  publisherFingerprint: string;
}

export interface LibraryEntry {
  /** Le fichier VALIDÉ — jamais le JSON brut, jamais un objet non relu. */
  file: LayoutFile;
  /** Quand il est entré ici. Sert au tri et à l'éviction. */
  importedAt: string;
  /** Le nom du fichier d'origine, pour que l'utilisateur reconnaisse le sien. */
  sourceName?: string;
  /** Renseigné pour les modèles venus du catalogue. Voir `LibraryOrigin`. */
  origin?: LibraryOrigin;
}

/**
 * Relit une origine venue du stockage. Reconstruite champ par champ et refusée
 * en bloc si un seul champ manque : une origine à moitié lue ferait un « mise à
 * jour disponible » calculé contre une version indéfinie.
 */
function readOrigin(raw: unknown): LibraryOrigin | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.slug !== 'string' || o.slug === '') return null;
  if (typeof o.version !== 'string' || o.version === '') return null;
  if (typeof o.publisherFingerprint !== 'string' || o.publisherFingerprint === '') return null;
  return { slug: o.slug, version: o.version, publisherFingerprint: o.publisherFingerprint };
}

type Listener = () => void;
const listeners = new Set<Listener>();

/**
 * S'abonner aux changements. Deux écrans lisent cette bibliothèque (le panneau
 * de la place de marché et la boîte d'import), et un import fait depuis l'un
 * doit se voir dans l'autre sans attendre un remontage.
 */
export function subscribeLayoutLibrary(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

/**
 * Relit la bibliothèque. Chaque entrée REPASSE par le validateur : ce qui est
 * sur le disque a pu être écrit par une version plus ancienne, ou modifié à la
 * main dans les outils du navigateur. Une bibliothèque n'est pas une frontière
 * de confiance.
 */
export function listLayoutLibrary(knownTypes: ReadonlySet<string>): LibraryEntry[] {
  let raw: string | null = null;
  try {
    raw = getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: LibraryEntry[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const result = validateLayoutFile(JSON.stringify(record.file), { knownTypes });
    if (result.status !== 'ok') continue;
    const origin = readOrigin(record.origin);
    out.push({
      file: result.file,
      importedAt: typeof record.importedAt === 'string' ? record.importedAt : '',
      ...(typeof record.sourceName === 'string' ? { sourceName: record.sourceName } : {}),
      ...(origin ? { origin } : {}),
    });
  }
  // Le plus récemment importé en premier : c'est celui qu'on cherche.
  out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return out;
}

function write(entries: LibraryEntry[]): void {
  // Éviction par le bas, puis par le poids : on préfère perdre le plus ancien
  // modèle plutôt que de refuser l'import que l'utilisateur vient de demander.
  let kept = entries.slice(0, LIBRARY_MAX_ENTRIES);
  let payload = JSON.stringify(kept);
  while (kept.length > 1 && utf8ByteLength(payload) > LIBRARY_MAX_BYTES) {
    kept = kept.slice(0, kept.length - 1);
    payload = JSON.stringify(kept);
  }
  try {
    if (kept.length === 0) removeItem(STORAGE_KEY);
    else setItem(STORAGE_KEY, payload);
  } catch {
    // Quota plein ou stockage refusé : la bibliothèque est un confort, pas la
    // mise en page elle-même. On n'interrompt pas l'import pour ça.
    return;
  }
  notify();
}

/**
 * Range un modèle. Le même identifiant REMPLACE l'entrée existante (réimporter
 * une version corrigée ne doit pas empiler deux modèles homonymes) et remonte
 * en tête.
 */
export function saveToLayoutLibrary(
  file: LayoutFile,
  knownTypes: ReadonlySet<string>,
  sourceName?: string,
  origin?: LibraryOrigin
): void {
  const serialized = JSON.stringify(file);
  if (utf8ByteLength(serialized) > LAYOUT_FILE_MAX_BYTES) return;
  /**
   * DEUX identités peuvent désigner la même entrée, et il faut écarter les
   * deux. L'identifiant de FICHIER dédoublonne un modèle réimporté ; le SLUG
   * dédoublonne une mise à jour venue du catalogue — un auteur qui régénère son
   * fichier change son `id`, et sans cette seconde clause on empilerait deux
   * versions du même modèle publié.
   */
  const existing = listLayoutLibrary(knownTypes).filter(
    (entry) => entry.file.id !== file.id && !(origin && entry.origin?.slug === origin.slug)
  );
  const entry: LibraryEntry = {
    file,
    importedAt: new Date().toISOString(),
    ...(sourceName ? { sourceName } : {}),
    ...(origin ? { origin } : {}),
  };
  write([entry, ...existing]);
}

export function removeFromLayoutLibrary(id: string, knownTypes: ReadonlySet<string>): void {
  write(listLayoutLibrary(knownTypes).filter((entry) => entry.file.id !== id));
}
