/**
 * textEncoding — lire des octets comme du texte, et les rendre TELS QU'ILS
 * ÉTAIENT.
 *
 * ── CE QUE ÇA RÉPARE ───────────────────────────────────────────────────────
 * L'éditeur de texte décodait avec un `new TextDecoder()` nu. Sans option,
 * `fatal` vaut faux : tout octet invalide devient U+FFFD, SANS UN MOT. Le
 * fichier s'ouvrait donc « très bien », l'utilisateur corrigeait une virgule,
 * enregistrait — et chaque octet non-UTF-8 avait été remplacé par un losange.
 * Un `.log` avec un octet binaire, un `.csv` exporté en Windows-1252, un
 * fichier japonais : mutilés en silence, sans que rien ne l'annonce.
 *
 * Deux pertes indépendantes, et la seconde est plus vicieuse :
 *
 *  1. LES OCTETS NON DÉCODABLES. On refuse maintenant de décoder plutôt que de
 *     remplacer. L'appelant ouvre alors le fichier en LECTURE SEULE : le voir
 *     sans pouvoir l'abîmer vaut mieux que ne pas le voir, et vaut infiniment
 *     mieux que l'abîmer sans le savoir.
 *
 *  2. LES FINS DE LIGNE. Un `<textarea>` NORMALISE : la spécification HTML dit
 *     que l'« API value » rend toujours des LF, quel que soit ce qu'on y a mis.
 *     Rouvrir un fichier Windows et l'enregistrer sans y toucher réécrivait
 *     donc CHAQUE LIGNE — un diff de 100 % sur un fichier qu'on croyait ne pas
 *     avoir modifié, et un conflit garanti au prochain `git pull`.
 *
 *  3. LE BOM. Même histoire : présent à la lecture, absent à l'écriture. Sur un
 *     `.csv`, c'est Excel qui cesse de reconnaître l'UTF-8.
 *
 * ── POURQUOI CE MODULE EST PUR ─────────────────────────────────────────────
 * Rien ici ne touche au DOM. C'est ce qui rend la règle testable octet par
 * octet, sans monter un éditeur — et c'est là que vivent les cas tordus (BOM
 * seul, CRLF mélangés, fichier vide, CR isolé d'un vieux Mac).
 */

/** Ce qu'on a retenu d'un fichier pour pouvoir le réécrire à l'identique. */
export interface TextShape {
  /** Le fichier commençait-il par une marque d'ordre des octets UTF-8 ? */
  bom: boolean;
  /**
   * Les fins de ligne d'origine.
   *
   * `mixed` est conservé tel quel plutôt que normalisé : un fichier déjà
   * incohérent n'a pas à être « réparé » à notre initiative — on écrirait alors
   * des lignes que l'utilisateur n'a pas touchées. On retient donc le style
   * MAJORITAIRE et on ne l'applique qu'aux séparateurs que le textarea a
   * aplatis.
   */
  eol: 'lf' | 'crlf' | 'cr';
}

export interface DecodedText {
  text: string;
  shape: TextShape;
}

const BOM = [0xef, 0xbb, 0xbf];

/**
 * Un octet NUL dans les premiers kilo-octets = binaire.
 *
 * UTF-8 valide peut contenir un NUL, mais aucun fichier texte que l'on édite à
 * la main n'en contient : c'est le test qu'utilisent `git` et `file` depuis
 * toujours, et il attrape les cas que `fatal: true` laisse passer — un PNG
 * commence par des octets parfaitement décodables.
 */
const SONDE_BINAIRE = 8192;

function estBinaire(bytes: Uint8Array): boolean {
  const fin = Math.min(bytes.length, SONDE_BINAIRE);
  for (let i = 0; i < fin; i += 1) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function detecterEol(texte: string): TextShape['eol'] {
  let crlf = 0;
  let lfSeul = 0;
  let crSeul = 0;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    if (c === 13) {
      if (texte.charCodeAt(i + 1) === 10) {
        crlf += 1;
        i += 1;
      } else {
        crSeul += 1;
      }
    } else if (c === 10) {
      lfSeul += 1;
    }
  }
  // LF gagne les égalités : c'est le style d'un fichier sans aucune fin de
  // ligne (une seule ligne), et le défaut le moins surprenant partout ailleurs.
  if (crlf > lfSeul && crlf >= crSeul) return 'crlf';
  if (crSeul > lfSeul && crSeul > crlf) return 'cr';
  return 'lf';
}

/**
 * Décoder STRICTEMENT. Rend `null` quand les octets ne sont pas du texte UTF-8
 * — jamais un texte approximatif.
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  if (estBinaire(bytes)) return null;

  const bom =
    bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
  const utiles = bom ? bytes.subarray(3) : bytes;

  let brut: string;
  try {
    // `fatal: true` — c'est TOUT le correctif. Sans lui, un octet invalide
    // devient U+FFFD et le fichier est perdu dès la première sauvegarde.
    brut = new TextDecoder('utf-8', { fatal: true }).decode(utiles);
  } catch {
    return null;
  }

  const eol = detecterEol(brut);
  // Le texte remis à l'éditeur est TOUJOURS en LF : c'est ce que le textarea
  // rendra de toute façon, et faire semblant du contraire ferait diverger ce
  // qu'on croit avoir posé de ce qu'on relira.
  const text = eol === 'lf' ? brut : brut.replace(/\r\n?/g, '\n');
  return { text, shape: { bom, eol } };
}

/**
 * Ré-encoder en restituant la forme d'origine.
 *
 * Le texte arrive en LF (le textarea n'en rend pas d'autre) ; on rétablit les
 * séparateurs et la marque d'ordre des octets, pour qu'un fichier enregistré
 * sans modification soit IDENTIQUE, octet pour octet, à celui qu'on a ouvert.
 */
export function encodeText(text: string, shape: TextShape): Uint8Array {
  const avecEol =
    shape.eol === 'crlf'
      ? text.replace(/\n/g, '\r\n')
      : shape.eol === 'cr'
        ? text.replace(/\n/g, '\r')
        : text;
  const corps = new TextEncoder().encode(avecEol);
  if (!shape.bom) return corps;
  const sortie = new Uint8Array(corps.length + 3);
  sortie.set(BOM, 0);
  sortie.set(corps, 3);
  return sortie;
}

/** La forme d'un fichier qu'on n'a pas lu (document neuf) : la plus neutre. */
export const FORME_NEUTRE: TextShape = { bom: false, eol: 'lf' };
