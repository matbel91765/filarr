/**
 * csvFormat — lire un tableau, et le RÉÉCRIRE tel qu'il était.
 *
 * ── LE PROBLÈME QUE CE MODULE EXISTE POUR RÉSOUDRE ─────────────────────────
 * Rendre un `.csv` éditable est facile ; le réécrire sans le réécrire ENTIER
 * ne l'est pas. `Papa.unparse` normalise tout ce qu'il touche : le
 * délimiteur, les fins de ligne, et surtout les guillemets. Un fichier
 * exporté d'Excel (qui met des guillemets partout) ressortirait sans aucun,
 * et un fichier suivi en git afficherait un diff de 100 % pour une seule
 * cellule modifiée — puis un conflit au prochain `pull`.
 *
 * On retient donc la FORME du fichier lu — délimiteur, fins de ligne, marque
 * d'ordre des octets, style de guillemets — et on la restitue à l'écriture.
 *
 * ── CE QUE LA FIDÉLITÉ NE COUVRE PAS, ET IL FAUT LE SAVOIR ─────────────────
 * Le style de guillemets est détecté par HEURISTIQUE : « tout est cité » ou
 * « seulement ce qui l'exige ». Ce sont les deux styles que produisent les
 * outils réels, et ils couvrent la quasi-totalité des fichiers. Un fichier au
 * style MIXTE — quelques champs cités sans raison, d'autres non — ressortira
 * uniformisé. C'est une limite assumée, pas un oubli : suivre le statut de
 * chaque champ demanderait un analyseur à nous, papaparse ne l'expose pas.
 */

import Papa from 'papaparse';

export interface CsvShape {
  /** Le séparateur du fichier lu (`,`, `;`, tabulation…). */
  delimiter: string;
  /** Les fins de ligne d'origine. */
  eol: '\n' | '\r\n';
  /** Le fichier commençait-il par une marque d'ordre des octets UTF-8 ? */
  bom: boolean;
  /**
   * Le fichier cite-t-il TOUS ses champs ?
   *
   * C'est la signature d'un export Excel. Ne pas la restituer ferait
   * réécrire chaque ligne d'un fichier qu'on n'a pas touché.
   */
  quoteAll: boolean;
}

export interface CsvDocument {
  /** Grille rectangulaire — les lignes courtes sont complétées. */
  rows: string[][];
  shape: CsvShape;
}

// Écrit en ÉCHAPPEMENT et non en caractère : U+FEFF est invisible, et un
// copier-coller ou un outil de formatage le perd sans que rien ne le montre.
const BOM = '\ufeff';

/**
 * Le style de guillemets, lu sur le TEXTE BRUT.
 *
 * On compte les champs qui commencent par un guillemet, et on compare au
 * nombre total de champs. Tout cité (ou presque : une ligne d'en-tête sans
 * guillemets est courante) ⇒ `quoteAll`.
 */
function detecteQuoteAll(texte: string, delimiter: string): boolean {
  const lignes = texte.split(/\r?\n/).filter((l) => l.length > 0);
  if (lignes.length === 0) return false;
  // On échantillonne : sur un fichier de 100 000 lignes, la centaine
  // premières dit déjà le style, et les parcourir toutes coûterait cher pour
  // une information qui ne varie pas.
  const echantillon = lignes.slice(0, 100);
  let champs = 0;
  let cites = 0;
  for (const ligne of echantillon) {
    for (const champ of ligne.split(delimiter)) {
      champs += 1;
      if (champ.startsWith('"')) cites += 1;
    }
  }
  if (champs === 0) return false;
  // 80 % : une ligne d'en-tête nue au milieu d'un fichier tout cité ne doit
  // pas faire basculer le verdict.
  return cites / champs >= 0.8;
}

/**
 * Lire des octets comme un tableau. Rend `null` quand ce n'est pas du texte
 * UTF-8 — jamais un tableau approximatif.
 */
export function parseCsv(bytes: Uint8Array, extension: string): CsvDocument | null {
  let brut: string;
  try {
    // `fatal: true` — même règle que l'éditeur de texte : un octet invalide
    // remplacé en silence est un fichier détruit à la première sauvegarde.
    brut = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  // LE BOM SE LIT SUR LES OCTETS, PAS SUR LE TEXTE. `TextDecoder` le CONSOMME
  // par défaut (`ignoreBOM: false`) : après décodage il a déjà disparu, et le
  // chercher là revenait à ne jamais le trouver — donc à le perdre à chaque
  // enregistrement, et à faire cesser Excel de lire l'UTF-8.
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const texte = brut.startsWith(BOM) ? brut.slice(1) : brut;
  const eol: CsvShape['eol'] = texte.includes('\r\n') ? '\r\n' : '\n';

  const estTsv = extension.toLowerCase() === 'tsv';
  let resultat = Papa.parse<string[]>(texte, {
    // TSV impose la tabulation ; pour le reste on laisse papaparse deviner,
    // puis on RETIENT ce qu'il a deviné pour le réécrire à l'identique.
    delimiter: estTsv ? '\t' : '',
    skipEmptyLines: false,
  });

  /**
   * RATTRAPER UNE DEVINETTE QUI NE DONNE QU'UNE COLONNE.
   *
   * `guessDelimiter` choisit le candidat dont le nombre de champs est le plus
   * CONSTANT — et un séparateur absent donne « une colonne partout », donc une
   * constance parfaite. Sur `a;b` papaparse répond donc `,` : en toute logique,
   * et en toute fausseté. C'est le cas ORDINAIRE en France, où les tableurs
   * exportent au point-virgule.
   *
   * On ne réessaie QUE si la devinette n'a produit qu'une colonne : un fichier
   * réellement mono-colonne le reste, et on ne va pas chercher un séparateur
   * dans un texte qui n'en a pas.
   */
  if (!estTsv) {
    const colonnesDe = (r: Papa.ParseResult<string[]>): number =>
      (r.data as string[][]).reduce((max, l) => Math.max(max, l?.length ?? 0), 0);
    if (colonnesDe(resultat) <= 1) {
      for (const candidat of [';', '\t', '|']) {
        const essai = Papa.parse<string[]>(texte, { delimiter: candidat, skipEmptyLines: false });
        if (colonnesDe(essai) > 1) {
          resultat = essai;
          break;
        }
      }
    }
  }

  const lignes = (resultat.data as string[][]).filter((r) => Array.isArray(r));
  /**
   * LA RANGÉE FANTÔME — et UNE SEULE.
   *
   * Un fichier qui finit par un saut de ligne donne une dernière ligne vide
   * qui n'est pas une donnée : la garder ajouterait une rangée dans la grille,
   * et l'écriture la rendrait réelle.
   *
   * Mais on n'en retire qu'UNE, et seulement si le texte se termine bien par
   * un saut de ligne. Le rognage en boucle mangeait les lignes blanches
   * VOLONTAIRES en fin de fichier — un tableau se terminant par deux rangées
   * vides revenait amputé, et le réenregistrement effaçait ces rangées pour
   * de bon. C'est une perte silencieuse, dans un module dont toute la raison
   * d'être est de rendre le fichier tel qu'il était.
   */
  if (
    lignes.length > 0 &&
    texte.endsWith('\n') &&
    lignes[lignes.length - 1].every((c) => c === '')
  ) {
    lignes.pop();
  }

  const colonnes = lignes.reduce((max, r) => Math.max(max, r.length), 0);
  const rows = lignes.map((r) => {
    if (r.length === colonnes) return r;
    const complet = r.slice();
    while (complet.length < colonnes) complet.push('');
    return complet;
  });

  const delimiter = resultat.meta.delimiter || (extension.toLowerCase() === 'tsv' ? '\t' : ',');
  return { rows, shape: { delimiter, eol, bom, quoteAll: detecteQuoteAll(texte, delimiter) } };
}

/** Réécrire le tableau en restituant la forme du fichier d'origine. */
export function serializeCsv(rows: string[][], shape: CsvShape): Uint8Array {
  const corps = Papa.unparse(rows, {
    delimiter: shape.delimiter,
    newline: shape.eol,
    quotes: shape.quoteAll,
  });
  // `unparse` ne pose pas de saut de ligne final ; les outils qui écrivent du
  // CSV, si. Sans lui, chaque aller-retour retirerait la dernière ligne vide.
  const avecFin = corps.endsWith(shape.eol) ? corps : corps + shape.eol;
  return new TextEncoder().encode(shape.bom ? BOM + avecFin : avecFin);
}

/** La forme d'un tableau neuf. */
export const FORME_CSV_NEUTRE: CsvShape = {
  delimiter: ',',
  eol: '\n',
  bom: false,
  quoteAll: false,
};
