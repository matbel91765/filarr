/**
 * Détection des notes PARASITES — module PUR (ni Redux, ni i18n, ni DOM).
 *
 * POURQUOI CE MODULE EXISTE. Deux défauts corrigés en 2026-08 (`fd39f63`) ont
 * écrit dans de VRAIS carnets des notes que personne n'a voulues. Les corriger
 * arrête l'hémorragie mais ne nettoie pas ce qui est déjà là : ce module trouve
 * les résidus, et — c'est tout l'enjeu — sépare ce qui est PROUVÉ redondant de
 * ce qui porte peut-être du contenu unique. Rien ici ne supprime : la fonction
 * rend un rapport, l'interface montre, l'utilisateur tranche.
 *
 * PORTÉE : les NOTES, et elles seules. La fusion fabrique aussi des copies de
 * conflit de CARNETS (même signature `conflictOfId`, dans le registre des
 * carnets) : elles ne sont PAS listées ici, et l'écran de nettoyage le dit.
 * Justification : un carnet ne porte pas de texte, donc aucun verdict ne
 * pourrait jamais prouver sa redondance — chaque ligne serait décochable sans
 * preuve, c'est-à-dire un bouton de suppression déguisé en nettoyage ; et
 * supprimer un carnet déplace les notes qu'il contient, une conséquence d'une
 * tout autre nature que purger une note vide.
 *
 * LES DEUX FAMILLES.
 *
 * 1. COPIE DE CONFLIT (`conflictCopy`). La fusion note-à-note fabrique une copie
 *    de sauvegarde quand l'arbitrage d'horloge détruit un contenu perdant
 *    (`applyConflictCopies`). Le garde de session vivante filtrait sur un
 *    ensemble vide dans le cas normal : une copie par cycle et par appareil est
 *    née pendant les sessions de collaboration. Signature : le champ
 *    `conflictOfId`, écrit par la MACHINE et par elle seule — aucune édition
 *    normale ne le pose. `conflictSavedAt` / `conflictOriginalUpdatedAt`
 *    l'accompagnent, et le titre porte la marque `⚠` ; mais on ne les EXIGE pas,
 *    car un utilisateur qui renomme une copie effacerait la marque du titre sans
 *    toucher au champ, et la copie deviendrait indétectable.
 *
 * 2. NOTE MIROIR (`mirror`). La clé de remontage de l'éditeur dérivait de
 *    `props.note.id`, qui changeait une frame AVANT l'état de session : l'éditeur
 *    se remontait pour la note B en restant lié au document de la note A, et le
 *    retour au stockage écrivait le texte de A dans B avec un contenu VIDE.
 *    Signature : titre vide ET document sans substance ET `plainText` non vide.
 *    Cette combinaison est IMPOSSIBLE par édition normale — `plainText` est
 *    dérivé du document (`extractPlainText`), donc un document vide donne
 *    toujours un `plainText` vide. Une note légitimement vide a les deux vides.
 *
 * CE QUI EST « SÛR À PURGER » — et rien d'autre n'est coché.
 *
 * · Une note miroir seulement si une AUTRE note vivante, elle-même hors de tout
 *   soupçon, contient ENCORE son texte : la signature du miroir dit d'où vient le
 *   texte, elle ne prouve pas qu'il y est resté. Sans porteur retrouvé, le miroir
 *   est peut-être le dernier exemplaire — il est signalé, jamais coché.
 *
 * · Une copie de conflit seulement si son original vit toujours, ET contient déjà
 *   tout son texte, ET que son DOCUMENT ne porte rien que le texte ne restitue.
 *   Ce dernier point est vital : la copie est la version PERDANTE, son document
 *   peut porter une image, un dessin, une base inline (dont les lignes vivent
 *   dans les attributs du nœud), l'URL d'un lien (dans les marks), un tableau,
 *   une pièce jointe — autant de contenu qu'aucun `plainText` ne restitue.
 *   Comparer les textes seuls déclarerait « redondante » une copie qui est le
 *   dernier porteur d'une image.
 *
 * · Jamais une copie que l'utilisateur a retravaillée depuis sa naissance : à sa
 *   naissance `updatedAt === conflictSavedAt`, donc un `updatedAt` postérieur
 *   prouve gratuitement qu'un humain y est repassé.
 */

import type { Note } from '../../types/notes';
import { CONFLICT_TITLE_MARK } from '../../platform/web/sync/notesMerge';

/** Famille de défaut à l'origine de la note. */
export type SuspectFamily = 'conflictCopy' | 'mirror';

/**
 * Pourquoi la note est (ou n'est pas) sûre à purger. Deux verdicts seulement
 * autorisent la présélection (`redundant`, `mirror`), les autres demandent un
 * choix humain.
 */
export type SuspectVerdict =
  /** Copie de conflit dont l'original vivant contient déjà tout le texte ET tout le document. */
  | 'redundant'
  /** Copie de conflit dont l'original ne contient PAS ce texte : unique. */
  | 'uniqueText'
  /** Copie de conflit dont le DOCUMENT porte ce que le texte ne restitue pas. */
  | 'uniqueContent'
  /** Copie de conflit rouverte et modifiée par l'utilisateur après sa création. */
  | 'userEdited'
  /** Copie de conflit dont l'original n'est plus parmi les notes vivantes. */
  | 'originGone'
  /** Note miroir dont le texte a été RETROUVÉ dans une autre note vivante. */
  | 'mirror'
  /** Note miroir dont le texte n'a été retrouvé nulle part : peut-être unique. */
  | 'mirrorOrphan';

export interface SuspectNote {
  id: string;
  family: SuspectFamily;
  /** Titre tel quel — vide pour une note miroir, l'interface le libelle. */
  title: string;
  /** Début du texte, espaces normalisés, tronqué. Vide si la note n'a rien. */
  excerpt: string;
  /** Le texte est plus long que l'extrait rendu. */
  truncated: boolean;
  /** Horodatage à afficher : sauvegarde du conflit, sinon dernière écriture. */
  date: string;
  verdict: SuspectVerdict;
  /**
   * Présélection permise. `true` UNIQUEMENT sur `redundant` et `mirror` — les
   * deux seuls cas où l'on peut prouver qu'aucun contenu ne disparaît.
   */
  safeToPurge: boolean;
  /** Le titre porte encore la marque de conflit (signal d'appoint, jamais requis). */
  titleMarked: boolean;
  /**
   * Note à laquelle le rapport a comparé la suspecte : l'original d'une copie de
   * conflit s'il vit encore, ou la note vivante qui porte le texte d'un miroir.
   */
  origin: { id: string; title: string } | null;
  /** `conflictOfId` brut, même quand l'origine a disparu. */
  originId: string | null;
}

/** Longueur de l'extrait rendu à l'interface. */
export const EXCERPT_LENGTH = 180;

/**
 * Fenêtre de texte brut lue pour fabriquer l'extrait. Large devant
 * `EXCERPT_LENGTH` pour absorber les blancs que la normalisation écrase, mais
 * BORNÉE : sans elle, une note de plusieurs mégaoctets se faisait normaliser en
 * entier pour n'en afficher que 180 caractères.
 */
const EXCERPT_WINDOW = EXCERPT_LENGTH * 4;

/**
 * Tolérance sur « la copie a été retravaillée ». À sa naissance,
 * `updatedAt === conflictSavedAt` à la milliseconde ; quelques secondes couvrent
 * l'écart d'horloge entre l'appareil qui fusionne et celui qui écrit.
 */
export const REWORK_TOLERANCE_MS = 5000;

/**
 * Types de nœuds TipTap qui ne portent RIEN par eux-mêmes : seuls leurs enfants
 * comptent. Tout autre type (image, tableau, bloc de code, base inline,
 * sous-page, dessin…) est du contenu, même sans un seul nœud de texte — d'où la
 * liste blanche plutôt qu'une liste noire : un type inconnu compte comme du
 * contenu, ce qui fait rater un parasite au pire, jamais détruire une note
 * pleine.
 */
const HOLLOW_NODE_TYPES: ReadonlySet<string> = new Set(['doc', 'paragraph']);

/**
 * Marks purement TYPOGRAPHIQUES : elles habillent un texte que `plainText`
 * restitue déjà en entier. Toutes les autres — `link` en tête, dont l'URL
 * n'apparaît nulle part dans le texte — entrent dans la signature.
 */
const TYPOGRAPHIC_MARK_TYPES: ReadonlySet<string> = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'textStyle',
]);

/**
 * Jeton d'un fragment ILLISIBLE (JSON invalide, forme inattendue). Il ne peut
 * jamais prouver son inclusion : deux documents illisibles ne sont pas pour
 * autant le même document.
 */
const OPAQUE = 'opaque';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Espaces (y compris insécables) réduits à un seul, extrémités coupées. */
export function normalizeText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

function nodeHasSubstance(node: unknown): boolean {
  if (typeof node === 'string') return node.trim() !== '';
  if (Array.isArray(node)) return node.some(nodeHasSubstance);
  if (!isRecord(node)) return false;
  const type = node.type;
  if (typeof type !== 'string' || type === '') return true; // forme inconnue : on ne parie pas
  if (type === 'text') return typeof node.text === 'string' && node.text.trim() !== '';
  if (!HOLLOW_NODE_TYPES.has(type)) return true;
  return nodeHasSubstance(node.content);
}

/**
 * Le document porte-t-il quoi que ce soit ? `false` SEULEMENT pour la chaîne
 * vide (ou blanche) et pour un document JSON réellement creux. Tout le reste —
 * contenu absent, `null`, JSON scalaire, JSON invalide, forme inattendue — est
 * déclaré PORTEUR : douter revient ici à ne pas cocher, et c'est le bon sens du
 * doute sur un écran qui supprime définitivement.
 */
export function documentHasSubstance(content: unknown): boolean {
  if (typeof content !== 'string') return true; // illisible : jamais « vide »
  if (content.trim() === '') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return true;
  }
  if (!isRecord(parsed) && !Array.isArray(parsed)) return true; // scalaire : pas un document
  return nodeHasSubstance(parsed);
}

function collectMarkSignature(marks: unknown, into: Set<string>): void {
  if (!Array.isArray(marks)) return;
  for (const mark of marks) {
    if (!isRecord(mark)) {
      into.add(OPAQUE);
      continue;
    }
    const type = mark.type;
    if (typeof type !== 'string' || type === '') {
      into.add(OPAQUE);
      continue;
    }
    if (TYPOGRAPHIC_MARK_TYPES.has(type)) continue;
    const attrs = isRecord(mark.attrs) ? mark.attrs : {};
    // L'URL EST la substance d'un lien : `mark:link` seul ne prouverait rien.
    const href = typeof attrs.href === 'string' ? attrs.href : '';
    into.add(href === '' ? `mark:${type}` : `mark:${type}:${href}`);
  }
}

function collectNodeSignature(node: unknown, into: Set<string>): void {
  if (typeof node === 'string') {
    if (node.trim() !== '') into.add(OPAQUE);
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collectNodeSignature(child, into);
    return;
  }
  if (!isRecord(node)) return;
  const type = node.type;
  if (typeof type !== 'string' || type === '') {
    into.add(OPAQUE);
    return;
  }
  if (type === 'text') {
    collectMarkSignature(node.marks, into);
    return;
  }
  if (!HOLLOW_NODE_TYPES.has(type)) into.add(`node:${type}`);
  collectMarkSignature(node.marks, into);
  collectNodeSignature(node.content, into);
}

/**
 * Ce que le document porte EN PLUS de son texte : types de nœuds non creux et
 * marks non typographiques. Volontairement grossière — elle sert à répondre
 * « l'original a-t-il au moins les mêmes espèces de contenu ? », jamais « ce
 * sont les mêmes octets ».
 */
export function contentSignature(content: unknown): ReadonlySet<string> {
  if (typeof content !== 'string') return new Set([OPAQUE]);
  if (content.trim() === '') return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return new Set([OPAQUE]);
  }
  if (!isRecord(parsed) && !Array.isArray(parsed)) return new Set([OPAQUE]);
  const signature = new Set<string>();
  collectNodeSignature(parsed, signature);
  return signature;
}

/** Tout ce que porte la copie se retrouve-t-il chez l'original ? */
function signatureCoveredBy(copy: ReadonlySet<string>, origin: ReadonlySet<string>): boolean {
  if (copy.has(OPAQUE)) return false; // illisible : rien à prouver avec ça
  for (const token of copy) {
    if (!origin.has(token)) return false;
  }
  return true;
}

function makeExcerpt(plainText: unknown): { excerpt: string; truncated: boolean } {
  const raw = typeof plainText === 'string' ? plainText : '';
  const head = normalizeText(raw.slice(0, EXCERPT_WINDOW));
  if (head.length > EXCERPT_LENGTH) {
    return { excerpt: head.slice(0, EXCERPT_LENGTH), truncated: true };
  }
  // Fenêtre épuisée sans atteindre la longueur voulue : reste-t-il du texte
  // derrière, ou seulement des blancs ?
  const truncated = raw.length > EXCERPT_WINDOW && raw.slice(EXCERPT_WINDOW).trim() !== '';
  return { excerpt: head, truncated };
}

/**
 * Le texte de la copie se retrouve-t-il tel quel dans l'original ? Comparaison
 * sur le texte NORMALISÉ (un retour à la ligne devenu espace ne doit pas faire
 * échouer l'inclusion) mais SENSIBLE À LA CASSE : « Projet » et « projet » ne
 * sont pas le même mot, et l'un ne prouve pas la conservation de l'autre.
 */
function textContains(originText: string, copyText: string): boolean {
  return originText.includes(copyText);
}

/** `conflictOfId` exploitable, ou `null`. */
function conflictOriginId(note: Note): string | null {
  const raw = note.conflictOfId;
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  return id === '' ? null : id;
}

/**
 * La copie a-t-elle été rouverte et modifiée APRÈS sa fabrication ? Sans
 * `conflictSavedAt` lisible, on ne peut rien prouver : on ne dit rien.
 */
export function reworkedAfterCopy(note: Note): boolean {
  const saved = Date.parse(typeof note.conflictSavedAt === 'string' ? note.conflictSavedAt : '');
  const updated = Date.parse(typeof note.updatedAt === 'string' ? note.updatedAt : '');
  if (!Number.isFinite(saved) || !Number.isFinite(updated)) return false;
  return updated - saved > REWORK_TOLERANCE_MS;
}

/**
 * Verdict d'une copie de conflit dont l'original VIT et n'a pas été retouchée.
 * Le seul chemin vers `redundant` : l'original contient tout le texte ET la
 * copie ne porte aucune substance documentaire propre.
 */
function compareToOrigin(copy: Note, origin: Note, copyText: string, originText: string) {
  const copyHasDocument = documentHasSubstance(copy.content);
  // `''.includes(x)` étant toujours vrai, une copie SANS texte dont le document
  // porte quelque chose (une image seule, une base inline seule) serait déclarée
  // redondante par la seule comparaison de textes. Interdit.
  if (copyText === '' && copyHasDocument) return 'uniqueContent' as const;
  if (!textContains(originText, copyText)) return 'uniqueText' as const;
  if (!copyHasDocument) return 'redundant' as const;
  const covered = signatureCoveredBy(
    contentSignature(copy.content),
    contentSignature(origin.content)
  );
  return covered ? ('redundant' as const) : ('uniqueContent' as const);
}

/**
 * Rapport de suspicion sur un lot de notes.
 *
 * Les notes déjà à la CORBEILLE (`deletedAt`) sont écartées des deux côtés :
 * ni suspectes (la corbeille les gère déjà, et elles sont restaurables), ni
 * candidates au rôle d'original (une copie dont l'original est à la corbeille
 * est peut-être le dernier porteur vivant de ce texte — verdict `originGone`,
 * donc non présélectionnée).
 *
 * Ordre rendu : copies de conflit puis notes miroir, chaque famille de la plus
 * récente à la plus ancienne, l'id départageant les ex æquo — un ordre stable
 * d'un appel à l'autre, sinon les cases cochées sautent d'une ligne à l'autre.
 */
export function findSuspectNotes(notes: readonly Note[]): SuspectNote[] {
  const live: Note[] = [];
  for (const note of notes) {
    if (note && !note.deletedAt) live.push(note);
  }
  const byId = new Map<string, Note>();
  for (const note of live) byId.set(note.id, note);

  // Le texte normalisé de chaque note ne sert que si on la compare : on le
  // calcule à la demande, une seule fois.
  const normalizedCache = new Map<string, string>();
  const textOf = (note: Note): string => {
    const cached = normalizedCache.get(note.id);
    if (cached !== undefined) return cached;
    const value = normalizeText(note.plainText);
    normalizedCache.set(note.id, value);
    return value;
  };

  const suspects: SuspectNote[] = [];
  const mirrorTexts = new Map<string, string>();

  for (const note of live) {
    const titleMarked = typeof note.title === 'string' && note.title.includes(CONFLICT_TITLE_MARK);

    // 1. Copie de conflit — testée EN PREMIER : le champ machine prime sur toute
    //    autre lecture de la note.
    const originId = conflictOriginId(note);
    if (originId !== null) {
      const origin = byId.get(originId);
      const isSelf = originId === note.id; // copie qui se réclame d'elle-même : rien à prouver
      let verdict: SuspectVerdict;
      if (!origin || isSelf) verdict = 'originGone';
      else if (reworkedAfterCopy(note)) verdict = 'userEdited';
      else verdict = compareToOrigin(note, origin, textOf(note), textOf(origin));
      const { excerpt, truncated } = makeExcerpt(note.plainText);
      suspects.push({
        id: note.id,
        family: 'conflictCopy',
        title: note.title,
        excerpt,
        truncated,
        date:
          typeof note.conflictSavedAt === 'string' && note.conflictSavedAt !== ''
            ? note.conflictSavedAt
            : note.updatedAt,
        verdict,
        safeToPurge: verdict === 'redundant',
        titleMarked,
        origin: origin && !isSelf ? { id: origin.id, title: origin.title } : null,
        originId,
      });
      continue;
    }

    // 2. Note miroir — les trois conditions ensemble, jamais séparément. Le
    //    porteur du texte est cherché plus bas, une fois tous les suspects connus.
    const titleEmpty = typeof note.title !== 'string' || note.title.trim() === '';
    const text = textOf(note);
    if (titleEmpty && text !== '' && !documentHasSubstance(note.content)) {
      const { excerpt, truncated } = makeExcerpt(note.plainText);
      mirrorTexts.set(note.id, text);
      suspects.push({
        id: note.id,
        family: 'mirror',
        title: note.title,
        excerpt,
        truncated,
        date: note.updatedAt,
        verdict: 'mirrorOrphan',
        safeToPurge: false,
        titleMarked,
        origin: null,
        originId: null,
      });
    }
  }

  // Deuxième passe : « le texte du miroir appartient à une autre note » est une
  // affirmation, pas une preuve. On va CHERCHER cette note ; sans elle, le
  // miroir est peut-être le dernier exemplaire du texte et reste décoché. Les
  // autres suspects ne peuvent pas servir de porteur — deux miroirs jumeaux se
  // couvriraient l'un l'autre, et on les supprimerait tous les deux.
  if (mirrorTexts.size > 0) {
    const suspectIds = new Set(suspects.map((s) => s.id));
    const holders = live.filter((n) => !suspectIds.has(n.id));
    for (const suspect of suspects) {
      const text = mirrorTexts.get(suspect.id);
      if (text === undefined) continue;
      const holder = holders.find((n) => textOf(n).includes(text));
      if (!holder) continue;
      suspect.verdict = 'mirror';
      suspect.safeToPurge = true;
      suspect.origin = { id: holder.id, title: holder.title };
    }
  }

  const familyRank: Record<SuspectFamily, number> = { conflictCopy: 0, mirror: 1 };
  suspects.sort((a, b) => {
    if (familyRank[a.family] !== familyRank[b.family])
      return familyRank[a.family] - familyRank[b.family];
    const byDate = (b.date ?? '').localeCompare(a.date ?? '');
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
  return suspects;
}

/** Les ids que l'on peut cocher d'emblée — et eux seuls. */
export function defaultSelection(suspects: readonly SuspectNote[]): string[] {
  return suspects.filter((s) => s.safeToPurge).map((s) => s.id);
}
