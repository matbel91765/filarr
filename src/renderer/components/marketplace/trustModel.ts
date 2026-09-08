/**
 * trustModel — TRADUIRE LA CRYPTO EN PHRASES.
 *
 * ── LE PROBLÈME ─────────────────────────────────────────────────────────────
 *
 * L'ancien écran affichait `publisherFingerprint` tel quel : « 41209 77304
 * 18822 90015 33471 60902 », en petit, en monospace, entre le numéro de version
 * et le nombre de téléchargements. Trente chiffres qui ne veulent RIEN dire pour
 * qui n'a pas lu la spec — et qui, pire, occupaient la place où aurait dû se
 * trouver la seule chose utile : « est-ce que je connais cet auteur ? ».
 *
 * Une place de marché d'extensions vend de la CONFIANCE avant de vendre des
 * fonctionnalités. Ce module ne calcule donc rien de nouveau : il transforme des
 * faits déjà vérifiés par la crypto (l'empreinte de la clé qui a signé) en un
 * VERDICT que l'écran peut dire en français.
 *
 * ── CE QU'IL N'INVENTE PAS ──────────────────────────────────────────────────
 *
 * Il n'invente PAS de nom d'auteur. Nous n'en avons pas : le protocole ne
 * transporte qu'une clé publique et son empreinte. Fabriquer « Marc » à partir
 * de chiffres serait une identité de fiction, exactement le mensonge qu'une
 * place de marché signée est censée empêcher. Ce qu'on peut dire honnêtement, et
 * ce que ce module dit, c'est le LIEN : « la même clé que celle qui a signé
 * Markdown Pro et CSV Studio, déjà installés chez vous ».
 *
 * Module PUR — aucun React, aucun réseau, aucun store.
 */

/**
 * Le verdict de confiance sur l'auteur d'une extension.
 *
 *  · `yours`       — signée par VOTRE clé d'identité ;
 *  · `known`       — même clé que d'autres extensions déjà installées ici ;
 *  · `first`       — première extension de cette clé chez vous (ni bon ni
 *                    mauvais : c'est un FAIT, et l'écran doit le dire sans
 *                    dramatiser — sinon tout nouvel auteur est suspect) ;
 *  · `key_changed` — la clé installée et la clé proposée diffèrent : le seul
 *                    cas réellement alarmant ;
 *  · `unknown`     — l'empreinte est absente ou illisible (donnée servie).
 */
export type TrustLevel = 'yours' | 'known' | 'first' | 'key_changed' | 'unknown';

export interface PublisherTrust {
  level: TrustLevel;
  /** Les extensions DÉJÀ INSTALLÉES signées par cette même clé (hors elle-même). */
  alsoBy: string[];
}

/** Ce dont le modèle a besoin d'une extension installée — rien de plus. */
export interface InstalledTrustFact {
  slug: string;
  name: string;
  publisherFingerprint: string;
}

/** Six groupes de cinq chiffres séparés par des espaces (computeFingerprint). */
const FINGERPRINT_RE = /^\d{5}( \d{5}){5}$/;

/**
 * LES ÉDITEURS OFFICIELS — par EMPREINTE, jamais par nom.
 *
 * C'est tout l'enjeu du badge. Un pseudonyme est revendiqué : si « officiel »
 * se déduisait du nom affiché, il suffirait d'écrire « Équipe Filarr » pour
 * l'obtenir, et le badge vaudrait moins que rien — il donnerait une garantie à
 * exactement celui qui cherche à tromper.
 *
 * La liste vit donc DANS LE BINAIRE, et pas dans une réponse du serveur : un
 * serveur compromis pourrait sinon s'attribuer le badge. La distribuer avec
 * l'application signifie qu'on ne peut l'obtenir qu'en publiant une version de
 * Filarr.
 *
 * ⚠ Une empreinte suit une CLÉ DE COMPTE. Faire tourner cette clé retire le
 * badge jusqu'à ce que la nouvelle empreinte soit ajoutée ici et livrée. C'est
 * le prix d'une garantie qui ne dépend de personne d'autre.
 */
export const OFFICIAL_FINGERPRINTS: readonly string[] = [
  // Compte de publication de Filarr. À remplacer ou compléter au besoin —
  // rien d'autre dans le produit ne dépend de cette valeur.
  '26156 83321 47777 86772 20689 57088',
];

/** L'empreinte est-elle celle d'un éditeur officiel ? */
export function isOfficialPublisher(fingerprint: unknown): boolean {
  return OFFICIAL_FINGERPRINTS.some((known) => sameFingerprint(known, fingerprint));
}

export function isFingerprintShaped(fp: unknown): fp is string {
  return typeof fp === 'string' && FINGERPRINT_RE.test(fp.trim());
}

/**
 * Comparaison d'empreintes — normalisée sur les espaces.
 *
 * L'empreinte vient de deux sources (le catalogue servi, l'enregistrement
 * IndexedDB) : un espace insécable ou une espace double glissée dans l'une des
 * deux ferait dire « auteur inconnu » à propos de la clé qu'on connaît le mieux,
 * c'est-à-dire exactement le mauvais verdict.
 */
export function sameFingerprint(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const na = norm(a);
  return na.length > 0 && na === norm(b);
}

/**
 * Le verdict sur l'auteur d'une extension.
 *
 * `ownFingerprint` est l'empreinte du compte courant (null si la paire de clés
 * n'est pas déverrouillée) ; `installed` la liste des extensions déjà installées
 * — c'est le seul « carnet d'adresses » que nous ayons, et il est local.
 */
export function describePublisher(
  fingerprint: unknown,
  ownFingerprint: string | null,
  installed: readonly InstalledTrustFact[],
  selfSlug?: string
): PublisherTrust {
  if (!isFingerprintShaped(fingerprint)) return { level: 'unknown', alsoBy: [] };

  const alsoBy = installed
    .filter((p) => p.slug !== selfSlug && sameFingerprint(p.publisherFingerprint, fingerprint))
    .map((p) => p.name);

  if (ownFingerprint && sameFingerprint(ownFingerprint, fingerprint)) {
    return { level: 'yours', alsoBy };
  }
  return { level: alsoBy.length > 0 ? 'known' : 'first', alsoBy };
}

/**
 * Les six groupes de l'empreinte, pour un affichage en grille lisible.
 *
 * Une empreinte se LIT À VOIX HAUTE (c'est un safety number à la Signal) : la
 * rendre en une seule ligne de trente chiffres, c'est garantir que personne ne
 * la comparera jamais. Trois par trois, la comparaison redevient possible.
 */
export function fingerprintGroups(fp: unknown): string[] {
  if (typeof fp !== 'string') return [];
  return fp.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6);
}

/**
 * Les DEUX empreintes alignées, avec le drapeau « ce groupe diffère ».
 *
 * C'est ce que l'écran de changement de clé doit montrer : pas deux pavés
 * monospace à comparer à l'œil, mais les groupes qui ne correspondent PAS,
 * marqués. Sans cela, « comparez ces deux nombres » est une instruction que
 * personne ne suit.
 */
export interface FingerprintDiffRow {
  index: number;
  pinned: string;
  offered: string;
  differs: boolean;
}

export function diffFingerprints(pinned: unknown, offered: unknown): FingerprintDiffRow[] {
  const a = fingerprintGroups(pinned);
  const b = fingerprintGroups(offered);
  const n = Math.max(a.length, b.length);
  const rows: FingerprintDiffRow[] = [];
  for (let i = 0; i < n; i++) {
    const pa = a[i] ?? '';
    const pb = b[i] ?? '';
    rows.push({ index: i, pinned: pa, offered: pb, differs: pa !== pb });
  }
  return rows;
}
