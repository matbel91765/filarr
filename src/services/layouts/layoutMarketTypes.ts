/**
 * L'ENVELOPPE DE MARCHÉ — ce qu'on publie, et pourquoi ce n'est pas le fichier.
 *
 * ── DEUX OBJETS, ET PAS UN SEUL ─────────────────────────────────────────────
 *
 * Le réflexe aurait été d'ajouter au `.filarrlayout` un auteur, une signature,
 * un slug et un semver. Ce serait casser tous les fichiers déjà exportés — et
 * mentir sur ce qu'est un fichier reçu de la main à la main.
 *
 * Un fichier qu'on vous donne N'A AUCUNE PROVENANCE À REVENDIQUER : on fait
 * confiance à la personne qui l'envoie, pas à un certificat. Une fiche de
 * catalogue, elle, doit en avoir une. Les deux objets sont donc distincts :
 *
 *   · `LayoutFile` (`layoutFormat.ts`) — la disposition, telle qu'elle voyage
 *     par courriel ou par clé USB. Inchangée, et elle le reste.
 *   · `LayoutMarketEnvelope` (ici) — ce qui est SIGNÉ et publié : l'identité de
 *     marché (slug, version, catégorie), l'empreinte de l'éditeur, et le
 *     fichier lui-même.
 *
 * ── POURQUOI `layout` EST UNE CHAÎNE ET NON UN OBJET ────────────────────────
 *
 * C'est la décision la plus contre-intuitive de ce module, et la seule qui
 * fasse tenir le modèle de confiance.
 *
 * `validateLayoutFile` prend délibérément une CHAÎNE : son plafond de taille et
 * son refus du `JSON.parse` hostile n'ont de sens qu'AVANT l'analyse. Si
 * l'enveloppe portait un objet déjà analysé, il faudrait le re-sérialiser pour
 * le valider — et une re-sérialisation N'EST PAS les octets d'origine. L'ordre
 * des clés change, les échappements Unicode changent, les nombres se
 * renormalisent. Le validateur verrait alors autre chose que ce qui a été
 * signé : exactement le trou que la signature était censée fermer.
 *
 * En chaîne, la même suite d'octets traverse tout : le signataire, le réseau,
 * D1, le vérificateur et le validateur en voient un seul et unique exemplaire.
 *
 * ── CE MODULE EST PUR ───────────────────────────────────────────────────────
 *
 * Aucune crypto, aucun réseau, aucun React : il est exécutable côté worker
 * (chantier 02) et se teste seul. La crypto vit dans `layoutMarketSigning.ts`.
 */

import {
  LAYOUT_FILE_MAX_BYTES,
  LAYOUT_FILE_TARGETS,
  LAYOUT_LIMITS,
  codePointLength,
  utf8ByteLength,
  type LayoutFileTarget,
} from './layoutFormat';
import { validateLayoutFile, type LayoutValidationOk } from './layoutValidator';

// ==================== Identité du format ====================

/** Le discriminant de l'enveloppe. Jamais celui du fichier (`filarr.layout`). */
export const LAYOUT_MARKET_KIND = 'filarr.layout.market';

/**
 * Version du format d'ENVELOPPE — indépendante de `LAYOUT_FILE_FORMAT_VERSION`.
 * Les deux évolueront à des rythmes différents : on peut changer ce qu'un
 * catalogue affiche sans toucher à ce qu'une disposition contient.
 */
export const LAYOUT_MARKET_FORMAT_VERSION = 1;

/**
 * Le slug : ASCII minuscule, jamais d'Unicode. MIROIR EXACT de `SLUG_RE`
 * (worker, `marketplace.ts`).
 *
 * L'ASCII n'est pas une paresse : un slug est une adresse, et deux slugs qui se
 * ressemblent à l'œil sans être égaux aux octets (`accueil` en cyrillique et en
 * latin) font une usurpation qu'aucun affichage ne rattrape.
 */
export const LAYOUT_MARKET_SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;

/** Semver strict — MIROIR de `SEMVER_RE` (worker). Trois champs, rien d'autre. */
export const LAYOUT_MARKET_SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Points de code d'une icône. Huit et non quatre (`LAYOUT_LIMITS.iconCodePoints`)
 * parce qu'une famille liée par des ZWJ en coûte sept à elle seule, et qu'un
 * emoji de carte de catalogue a le droit d'en être une.
 */
export const LAYOUT_MARKET_ICON_MAX_CODEPOINTS = 8;

/**
 * Plafond d'une VIGNETTE, en octets d'image (avant base64).
 *
 * 8 Kio n'est pas un chiffre rond arbitraire : c'est ce que pèse un WebP de
 * 96×96 largement détaillé, et c'est ce qu'on peut se permettre de servir
 * CINQUANTE FOIS dans une page de catalogue. Une vignette de 40 Kio ferait deux
 * mégaoctets de réponse pour une liste qu'on fait défiler.
 *
 * Le client ne se contente pas de vérifier ce plafond : il RÉENCODE l'image
 * lui-même (voir `LayoutPublishWizard`), si bien que la taille est bornée par
 * construction et non par un refus après coup.
 */
export const LAYOUT_ICON_MAX_BYTES = 8 * 1024;

/**
 * Plafond d'une IMAGE D'APERÇU — huit fois celui de l'icône, et c'est possible
 * parce qu'elle ne voyage PAS dans le catalogue.
 *
 * Une icône est servie cinquante fois par page : elle doit rester minuscule.
 * L'aperçu, lui, ne vit que dans l'enveloppe, qu'on ne télécharge qu'en ouvrant
 * une fiche ou en installant. Il peut donc être une vraie capture — c'est ce
 * qui manquait pour qu'une fiche montre quelque chose.
 */
export const LAYOUT_PREVIEW_MAX_BYTES = 96 * 1024;

/**
 * CE PLAFOND SE COMPTE EN OCTETS DÉCODÉS, ET L'ENVELOPPE PORTE DU BASE64.
 *
 * `dataUrlBytes` (côté fabrication) et `isRasterDataUrl` (côté lecture)
 * mesurent tous les deux l'image DÉCODÉE — c'est la bonne unité pour dire « une
 * capture pèse 96 Kio ». Mais ce qui voyage dans l'enveloppe signée, ce qui est
 * rangé en base et ce qui traverse le réseau, c'est la CHAÎNE base64, qui vaut
 * quatre tiers de cela plus l'en-tête `data:image/webp;base64,`.
 *
 * Ce facteur manquait dans le calcul du plafond d'enveloppe : les images y
 * étaient comptées décodées, donc sous-estimées d'un tiers. Il est nommé ici
 * pour que le calcul plus bas puisse le dire à voix haute.
 */
const BASE64_OVERHEAD = 4 / 3;

/** L'en-tête d'une URL de données, généreusement arrondi. */
const DATA_URL_HEADER_BYTES = 32;

/**
 * COMBIEN D'IMAGES UNE FICHE PEUT PORTER.
 *
 * Quatre, et pas dix. Une galerie de dix captures ne se regarde pas : on voit
 * la première, on fait défiler machinalement, et on n'apprend rien de plus que
 * ce que la première disait. Quatre laissent la place à un avant/après, à un
 * détail, à une variante — c'est-à-dire à un PROPOS.
 *
 * Ce nombre entre aussi dans le plafond d'enveloppe : l'augmenter alourdit
 * chaque publication, et le calcul plus bas le dit à voix haute.
 */
export const LAYOUT_PREVIEW_MAX_COUNT = 4;

/**
 * Ce que COÛTERAIT, en octets de chaîne, une enveloppe qui pousse chacune de
 * ses parties à son maximum.
 *
 * `LAYOUT_FILE_MAX_BYTES` (256 Kio) borne le fichier ; l'enveloppe l'emporte
 * ÉCHAPPÉ dans une chaîne JSON, ce qui peut le gonfler (chaque `"` devient
 * `\"`, chaque saut de ligne `\n`). Le facteur 2 couvre le pire cas. Les
 * images, elles, se comptent en base64 (`BASE64_OVERHEAD`).
 *
 * Ce n'est PAS le plafond : c'est ce qu'on lui compare.
 */
const LAYOUT_ENVELOPE_WORST_CASE_BYTES =
  2 * LAYOUT_FILE_MAX_BYTES +
  Math.ceil(
    LAYOUT_PREVIEW_MAX_COUNT * (LAYOUT_PREVIEW_MAX_BYTES * BASE64_OVERHEAD + DATA_URL_HEADER_BYTES)
  ) +
  Math.ceil(LAYOUT_ICON_MAX_BYTES * BASE64_OVERHEAD + DATA_URL_HEADER_BYTES) +
  8 * 1024;

/**
 * Plafond de l'enveloppe SÉRIALISÉE, en octets UTF-8.
 *
 * ── POURQUOI CE NOMBRE EST ÉCRIT, ET NON DÉRIVÉ ─────────────────────────────
 *
 * Il l'a été. Le plafond valait « la somme de ses parties », ce qui se lisait
 * bien : changer le nombre d'images ou leur poids, et il suivait tout seul.
 * Sauf qu'il suivait vers un endroit où l'enveloppe ne RENTRE PAS.
 *
 * `envelope_json` est rangé dans une colonne D1, et D1 refuse toute valeur au-
 * delà d'un million d'octets. Une enveloppe de 1,3 Mio passerait la
 * vérification de signature, passerait la validation de forme, et échouerait à
 * l'écriture — sur une erreur de base de données que rien, dans l'assistant de
 * publication, ne saurait traduire en « votre capture est trop lourde ».
 *
 * Le plafond est donc le PLUS PETIT des deux : ce que la base accepte, avec sa
 * marge, et jamais ce que la somme des parties voudrait.
 *
 * ⚠ Ce plafond ne remplace PAS celui du fichier : les deux s'appliquent, et
 * celui du fichier est vérifié sur les octets qu'il borne réellement. Et une
 * publication qui pousse À LA FOIS le fichier et les quatre captures à leur
 * maximum sera refusée : c'est voulu, et c'est le seul refus que l'auteur peut
 * corriger lui-même (une capture de moins, ou un accueil plus simple).
 */
export const LAYOUT_MARKET_MAX_ENVELOPE_BYTES = Math.min(
  LAYOUT_ENVELOPE_WORST_CASE_BYTES,
  /** 1 000 000 est le plafond D1 ; on garde 5 % pour ce qui l'entoure. */
  950_000
);

/**
 * Les deux seuls en-têtes acceptés — et l'absence de SVG est le point entier.
 *
 * Un SVG est un DOCUMENT : il peut porter des scripts, des références externes,
 * des filtres. Le rendre dans une page qui manipule des clés serait ouvrir une
 * porte pour une icône. On n'accepte donc que du RASTER, et on le reconnaît sur
 * les octets, pas sur la parole de l'émetteur.
 */
const ICON_PREFIXES = ['data:image/webp;base64,', 'data:image/png;base64,'] as const;

/**
 * Les premiers caractères BASE64 d'un vrai fichier — la signature, lue sans
 * rien décoder.
 *
 * `\x89PNG` se code toujours `iVBORw0KGgo` ; `RIFF` (conteneur WebP) toujours
 * `UklGR`. Comparer là plutôt qu'après un `atob` évite de décoder huit kilos
 * pour découvrir qu'ils ne valaient rien — et laisse ce module pur, sans
 * dépendre d'une fonction que tous les environnements n'ont pas.
 */
const ICON_MAGIC: Record<string, string> = {
  'data:image/png;base64,': 'iVBORw0KGgo',
  'data:image/webp;base64,': 'UklGR',
};

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * L'icône est-elle une VIGNETTE recevable ?
 *
 * Ce que cette fonction promet : le préfixe est l'un des deux, la charge est du
 * base64 bien formé, elle commence par la signature du format annoncé, et elle
 * tient sous le plafond. Ce qu'elle ne promet PAS : que l'image se décode. Un
 * fichier tronqué passe ici et ne s'affichera pas — c'est acceptable, parce que
 * la conséquence est une carte sans icône, jamais du code exécuté.
 */
function isRasterDataUrl(value: string, maxBytes: number): boolean {
  const prefix = ICON_PREFIXES.find((p) => value.startsWith(p));
  if (!prefix) return false;
  const payload = value.slice(prefix.length);
  if (payload === '' || !BASE64_RE.test(payload)) return false;
  if (!payload.startsWith(ICON_MAGIC[prefix])) return false;
  // Quatre caractères base64 portent trois octets. On borne sans décoder.
  return Math.floor((payload.length * 3) / 4) <= maxBytes;
}

export function isImageIcon(icon: string): boolean {
  return isRasterDataUrl(icon, LAYOUT_ICON_MAX_BYTES);
}

/**
 * L'image d'aperçu — mêmes refus que l'icône (jamais de SVG, signature lue sur
 * les octets), plafond plus large.
 */
export function isPreviewImage(value: string): boolean {
  return isRasterDataUrl(value, LAYOUT_PREVIEW_MAX_BYTES);
}

/**
 * L'icône d'une fiche : un emoji, OU une vignette. Rien d'autre.
 *
 * Les deux coexistent parce qu'ils répondent à deux besoins réels : un emoji se
 * tape en une seconde, une vignette montre à quoi ressemble un thème. Forcer
 * l'un ferait perdre l'autre.
 */
export function isIconValue(icon: string): boolean {
  return isEmojiOnly(icon) || isImageIcon(icon);
}

// ==================== Catégories ====================

/**
 * Les six catégories d'une DISPOSITION.
 *
 * Volontairement PAS celles des greffons (`editors`, `data`, `media`…) : ces
 * mots décrivent ce qu'un programme sait ouvrir, pas la façon dont quelqu'un
 * organise son accueil. Un onglet « Éditeurs » dans un catalogue de mises en
 * page nommerait autre chose que ce qu'il contient.
 *
 * `other` est le REFUGE : toute valeur inconnue y retombe, jamais une erreur —
 * un catalogue servi par une version plus récente ne doit pas se vider chez qui
 * n'a pas encore mis à jour.
 */
export const LAYOUT_MARKET_CATEGORIES = [
  'work',
  'study',
  'creative',
  'minimal',
  'dashboard',
  'other',
] as const;

export type LayoutMarketCategory = (typeof LAYOUT_MARKET_CATEGORIES)[number];

const CATEGORY_SET: ReadonlySet<string> = new Set(LAYOUT_MARKET_CATEGORIES);

/** Toute valeur hors liste retombe sur `other`. Jamais de refus, jamais de vide. */
export function normalizeLayoutCategory(raw: unknown): LayoutMarketCategory {
  return typeof raw === 'string' && CATEGORY_SET.has(raw) ? (raw as LayoutMarketCategory) : 'other';
}

// ==================== Icônes ====================

const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * L'icône est-elle un emoji, et RIEN d'autre ?
 *
 * MIROIR de `isValidPluginIcon` (worker), et pour les mêmes raisons — répétées
 * ici parce qu'un lecteur de ce module n'ira pas les chercher dans l'autre.
 *
 * PAR POINTS DE CODE, PAS PAR LONGUEUR DE CHAÎNE. `.length` compte des unités
 * UTF-16 : « 👨‍👩‍👧‍👦 » en vaut onze, un simple « 🗂️ » en vaut trois. Une borne
 * exprimée en unités arbitrerait la composition de l'emoji, pas sa taille.
 *
 * FERMÉ PAR LISTE BLANCHE : pictogramme étendu, sélecteur de variante (U+FE0F),
 * liant sans chasse (U+200D) et modificateurs de teinte. La liste blanche règle
 * d'un coup ce qu'une liste noire aurait oublié — les caractères de contrôle et
 * de format (Cc/Cf : forçages bidirectionnels RLO/LRO, invisibles) ne sont pas
 * des pictogrammes, donc ils tombent. `<>&"'` tombent pour la même raison.
 *
 * ⚠ CE N'EST PAS LA DÉFENSE PRINCIPALE. La vraie défense est le RENDU : texte
 * brut React dans un `<bdi>`, longueur écrêtée à l'affichage. Cette fonction
 * empêche de PUBLIER une bêtise, elle ne promet rien sur ce qui sortira d'une
 * base de données que personne ne signe.
 */
export function isEmojiOnly(icon: string): boolean {
  const points = [...icon];
  if (points.length < 1 || points.length > LAYOUT_MARKET_ICON_MAX_CODEPOINTS) return false;
  let pictogramme = false;
  for (const ch of points) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d) continue;
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue;
    if (!EXTENDED_PICTOGRAPHIC.test(ch)) return false;
    pictogramme = true;
  }
  // Un « emoji » fait de zéro pictogramme (que des liants) n'en est pas un.
  return pictogramme;
}

// ==================== L'enveloppe ====================

/**
 * LES IMAGES D'UNE FICHE, ANCIENNE ET NOUVELLE FORME RÉUNIES.
 *
 * Tout le produit passe par ici. Deux lectures — « la galerie si elle existe,
 * sinon l'ancienne capture » — recopiées dans chaque écran auraient fini par
 * diverger, et l'un d'eux aurait cessé d'afficher les fiches d'avant la galerie
 * sans que rien ne le signale.
 */
export function previewsOf(envelope: { preview?: string; previews?: string[] }): readonly string[] {
  if (envelope.previews && envelope.previews.length > 0) return envelope.previews;
  return envelope.preview ? [envelope.preview] : [];
}

export interface LayoutMarketEnvelope {
  kind: typeof LAYOUT_MARKET_KIND;
  formatVersion: number;
  /** Identité PUBLIQUE et définitive. Premier arrivé, premier servi. */
  slug: string;
  /** Semver strict. Une version publiée est IMMUABLE. */
  version: string;
  name: string;
  description: string;
  /**
   * Le nom d'auteur AFFICHÉ — un pseudonyme, et rien de plus.
   *
   * ⚠ IL EST REVENDIQUÉ, PAS PROUVÉ. N'importe qui peut écrire « Équipe
   * Filarr » ici : le champ voyage dans l'enveloppe signée, ce qui garantit
   * qu'il n'a pas été modifié APRÈS coup, pas qu'il dise vrai. La seule
   * identité qui ne se prête pas reste l'empreinte, et les deux doivent donc
   * s'afficher ensemble — jamais le pseudonyme seul.
   */
  author?: string;
  /** Emoji, ou absent. Jamais une chaîne vide (le champ disparaît). */
  icon?: string;
  /**
   * Une CAPTURE, large, montrée sur la fiche seulement.
   *
   * Elle ne part jamais dans le catalogue : c'est ce qui permet qu'elle soit
   * huit fois plus lourde que l'icône sans peser sur une liste de cinquante
   * lignes.
   */
  preview?: string;
  /**
   * LA GALERIE — jusqu'à quatre captures, montrées sur la fiche seulement.
   *
   * ── POURQUOI `preview` SURVIT À CÔTÉ ────────────────────────────────────
   *
   * Les versions déjà publiées portent `preview`, au singulier, DANS LEUR
   * ENVELOPPE SIGNÉE. On ne peut pas les migrer : rééecrire le champ
   * invaliderait la signature, qui porte sur les octets exacts. Le champ
   * ancien reste donc lu tel quel, et `previewsOf` réunit les deux formes en
   * une seule liste pour tout le reste du produit.
   *
   * C'est la règle habituelle d'un format signé : on AJOUTE, on ne renomme
   * jamais.
   */
  previews?: string[];
  category: LayoutMarketCategory;
  /** Là où cette disposition se pose — recopié du fichier, pour le filtrage. */
  target: LayoutFileTarget;
  /** Six groupes de cinq chiffres. RECALCULÉ à la vérification, jamais cru. */
  publisherFingerprint: string;
  /** Le `.filarrlayout` VERBATIM. Voir l'en-tête : c'est une chaîne, exprès. */
  layout: string;
}

// ==================== Lecture défensive ====================

/**
 * Les défauts de FORME d'une enveloppe. Un seul par appel : le premier trouvé
 * suffit à refuser, et énumérer les autres ne renseignerait qu'un attaquant.
 */
export type EnvelopeShapeErrorCode =
  | 'not-object'
  | 'bad-kind'
  | 'unsupported-version'
  | 'bad-slug'
  | 'bad-version'
  | 'bad-name'
  | 'bad-description'
  | 'bad-author'
  | 'bad-icon'
  | 'bad-preview'
  | 'bad-target'
  | 'bad-fingerprint'
  | 'bad-layout';

/** L'empreinte telle qu'elle est RENDUE : six groupes de cinq chiffres. */
const FINGERPRINT_RE = /^\d{5}(?: \d{5}){5}$/;

/**
 * Un point de code est-il INVISIBLE ou DIRECTIONNEL ?
 *
 * Le refus n'est pas cosmétique. U+202E (forçage de droite à gauche) retourne le
 * sens de lecture de tout ce qui suit : un nom s'affiche alors à l'envers de ce
 * qu'il contient, et le lecteur choisit en croyant savoir. U+0000 coupe la
 * chaîne au milieu pour tout consommateur qui n'est pas JavaScript.
 *
 * ÉNUMÉRÉ et non écrit en expression régulière : une classe de caractères de
 * contrôle littérale est illisible en revue, elle fait passer le fichier pour du
 * binaire aux yeux de `grep`, et c'est exactement le genre de ligne dont
 * personne ne vérifie les bornes.
 */
function isInvisibleOrDirectional(cp: number): boolean {
  if (cp <= 0x1f || cp === 0x7f) return true; // C0 + DEL
  if (cp >= 0x80 && cp <= 0x9f) return true; // C1
  if (cp === 0x200e || cp === 0x200f) return true; // marques LRM / RLM
  if (cp >= 0x202a && cp <= 0x202e) return true; // encadrements et forçages
  if (cp >= 0x2066 && cp <= 0x2069) return true; // isolats
  return false;
}

/**
 * Une chaîne d'en-tête est-elle lisible ? Non vide, sous son plafond, et sans
 * caractère invisible ni directionnel.
 *
 * Le plafond porte sur les POINTS DE CODE, comme partout ailleurs dans ce
 * format : compter en unités UTF-16 se tromperait d'un facteur deux sur un nom
 * écrit en emoji ou en idéogrammes.
 */
function readHeaderText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || codePointLength(trimmed) > max) return null;
  for (const ch of trimmed) {
    if (isInvisibleOrDirectional(ch.codePointAt(0) ?? 0)) return null;
  }
  return trimmed;
}

/**
 * Relit une enveloppe REÇUE et la RECONSTRUIT champ par champ.
 *
 * Reconstruire plutôt que valider en place : l'objet rendu ne porte QUE les
 * champs connus, donc rien de ce qu'un émetteur aurait ajouté ne voyage plus
 * loin. C'est la même règle que `validateLayoutFile` applique au fichier.
 *
 * ⚠ Cette fonction ne valide PAS le contenu de `layout` — elle vérifie que
 * c'est une chaîne sous plafond, et rien de plus. Le fichier est l'affaire de
 * `validateLayoutFile`, qui a ses propres refus et son propre récapitulatif.
 */
export function readEnvelope(
  raw: unknown
): { ok: true; envelope: LayoutMarketEnvelope } | { ok: false; code: EnvelopeShapeErrorCode } {
  const fail = (code: EnvelopeShapeErrorCode) => ({ ok: false as const, code });

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fail('not-object');
  const doc = raw as Record<string, unknown>;

  if (doc.kind !== LAYOUT_MARKET_KIND) return fail('bad-kind');
  if (doc.formatVersion !== LAYOUT_MARKET_FORMAT_VERSION) return fail('unsupported-version');

  const slug = typeof doc.slug === 'string' ? doc.slug : '';
  if (!LAYOUT_MARKET_SLUG_RE.test(slug)) return fail('bad-slug');

  const version = typeof doc.version === 'string' ? doc.version : '';
  if (!LAYOUT_MARKET_SEMVER_RE.test(version)) return fail('bad-version');

  const name = readHeaderText(doc.name, LAYOUT_LIMITS.name);
  if (name === null) return fail('bad-name');

  // La description est FACULTATIVE mais jamais absente du modèle rendu : une
  // chaîne vide se rend, un `undefined` se teste partout où il passe.
  let description = '';
  if (doc.description !== undefined && doc.description !== '') {
    const read = readHeaderText(doc.description, LAYOUT_LIMITS.description);
    if (read === null) return fail('bad-description');
    description = read;
  }

  let author: string | undefined;
  if (doc.author !== undefined && doc.author !== '') {
    // Mêmes refus que le nom : ni vide, ni trop long, ni porteur d'un caractère
    // invisible ou directionnel. Un pseudonyme s'affiche à côté d'un badge de
    // confiance : le retourner à l'envers serait la meilleure place pour le faire.
    const read = readHeaderText(doc.author, LAYOUT_LIMITS.slotLabel);
    if (read === null) return fail('bad-author');
    author = read;
  }

  let icon: string | undefined;
  if (doc.icon !== undefined && doc.icon !== '') {
    if (typeof doc.icon !== 'string' || !isIconValue(doc.icon)) return fail('bad-icon');
    icon = doc.icon;
  }

  let previewImage: string | undefined;
  if (doc.preview !== undefined && doc.preview !== '') {
    if (typeof doc.preview !== 'string' || !isPreviewImage(doc.preview)) return fail('bad-preview');
    previewImage = doc.preview;
  }

  /**
   * La galerie. REFUSÉE EN BLOC si une seule image ne va pas — contrairement à
   * une suggestion de thème, qu'on oublie sans drame.
   *
   * Une fiche dont la troisième capture a été remplacée par autre chose n'est
   * pas une fiche « presque bonne » : c'est une enveloppe dont le contenu ne
   * correspond plus à ce que son auteur a signé, et le seul comportement
   * défendable est de ne pas la servir.
   */
  let gallery: string[] | undefined;
  if (doc.previews !== undefined) {
    if (!Array.isArray(doc.previews)) return fail('bad-preview');
    if (doc.previews.length > LAYOUT_PREVIEW_MAX_COUNT) return fail('bad-preview');
    for (const image of doc.previews) {
      if (typeof image !== 'string' || !isPreviewImage(image)) return fail('bad-preview');
    }
    if (doc.previews.length > 0) gallery = [...(doc.previews as string[])];
  }

  const target = doc.target;
  if (typeof target !== 'string' || !LAYOUT_FILE_TARGETS.includes(target as LayoutFileTarget)) {
    return fail('bad-target');
  }

  // L'empreinte n'est ici que LUE. Elle n'est CRUE nulle part : la
  // vérification la recalcule depuis la clé qui a réellement signé, et refuse
  // si les deux diffèrent (`fingerprint_mismatch`).
  if (
    typeof doc.publisherFingerprint !== 'string' ||
    !FINGERPRINT_RE.test(doc.publisherFingerprint)
  ) {
    return fail('bad-fingerprint');
  }

  if (typeof doc.layout !== 'string' || doc.layout === '') return fail('bad-layout');
  if (utf8ByteLength(doc.layout) > LAYOUT_FILE_MAX_BYTES) return fail('bad-layout');

  return {
    ok: true,
    envelope: {
      kind: LAYOUT_MARKET_KIND,
      formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
      slug,
      version,
      name,
      description,
      ...(author ? { author } : {}),
      ...(icon ? { icon } : {}),
      ...(previewImage ? { preview: previewImage } : {}),
      ...(gallery ? { previews: gallery } : {}),
      // Hors liste ⇒ `other`, jamais un refus : voir `normalizeLayoutCategory`.
      category: normalizeLayoutCategory(doc.category),
      target: target as LayoutFileTarget,
      publisherFingerprint: doc.publisherFingerprint,
      layout: doc.layout,
    },
  };
}

// ==================== Refus, et lecture complète ====================

export type LayoutMarketVerifyErrorCode =
  | 'too_large'
  | 'bad_signature'
  | 'bad_envelope'
  | 'envelope_mismatch'
  | 'fingerprint_mismatch'
  | 'bad_layout';

export class LayoutMarketVerifyError extends Error {
  code: LayoutMarketVerifyErrorCode;
  /** Le refus PRÉCIS de la sous-couche, quand il y en a un. Jamais montré tel
   *  quel à un visiteur : il sert au journal et aux tests. */
  detail?: string;

  constructor(code: LayoutMarketVerifyErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'LayoutMarketVerifyError';
    this.code = code;
    this.detail = detail;
  }
}

// ==================== Inspecter (sans crypto) ====================

export interface EnvelopeInspection {
  envelope: LayoutMarketEnvelope;
  /** Le résultat de `validateLayoutFile` : le fichier RECONSTRUIT, et les
   *  comptes « appliqués / inconnus / ignorés ». */
  validation: LayoutValidationOk;
}

/**
 * La moitié SANS CRYPTO de la vérification : plafond, analyse, forme, et la
 * disposition elle-même.
 *
 * Elle est isolée parce que le WORKER en a besoin telle quelle au moment de la
 * publication — il vérifie la signature avec sa propre implémentation Ed25519,
 * mais la lecture de l'enveloppe doit être RIGOUREUSEMENT la même des deux
 * côtés. Deux lectures différentes, c'est un fichier accepté à la publication
 * et refusé à l'installation, ou l'inverse.
 *
 * ⚠ `knownTypes` reçoit un ENSEMBLE VIDE côté serveur, délibérément : le worker
 * n'a pas à connaître le catalogue de blocs d'un binaire, qui change à chaque
 * version de l'application. Les blocs tombent alors tous en « inconnus », ce que
 * le validateur accepte par construction — il ne refuse que sur `no-widgets`,
 * c'est-à-dire zéro bloc lisible, connu ou non.
 */
export function inspectEnvelope(
  envelopeJson: unknown,
  knownTypes: ReadonlySet<string>
): { ok: true; inspection: EnvelopeInspection } | { ok: false; error: LayoutMarketVerifyError } {
  const fail = (code: LayoutMarketVerifyErrorCode, detail?: string) => ({
    ok: false as const,
    error: new LayoutMarketVerifyError(code, detail),
  });

  if (typeof envelopeJson !== 'string') return fail('bad_envelope', 'not-a-string');
  // EN OCTETS, et avant toute analyse.
  if (utf8ByteLength(envelopeJson) > LAYOUT_MARKET_MAX_ENVELOPE_BYTES) return fail('too_large');

  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    return fail('bad_envelope', 'not-json');
  }

  const read = readEnvelope(parsed);
  if (!read.ok) return fail('bad_envelope', read.code satisfies EnvelopeShapeErrorCode);

  // La disposition est validée SUR SA CHAÎNE — celle qui a été signée, jamais
  // une re-sérialisation. Voir l'en-tête de `layoutMarketTypes`.
  const validation = validateLayoutFile(read.envelope.layout, { knownTypes });
  if (validation.status !== 'ok') return fail('bad_layout', validation.code);

  return { ok: true, inspection: { envelope: read.envelope, validation } };
}
