/**
 * L'INVARIANT : ouvrir un tableau et le réenregistrer SANS Y TOUCHER doit
 * rendre les mêmes octets.
 *
 * C'est toute la difficulté de rendre un `.csv` éditable. `Papa.unparse`
 * normalise le délimiteur, les fins de ligne et les guillemets : sans
 * restitution, modifier UNE cellule réécrirait le fichier entier, et un
 * fichier suivi en git afficherait un diff de 100 % puis un conflit au
 * prochain `pull`.
 */

import { describe, it, expect } from 'vitest';
import { parseCsv, serializeCsv } from '../csvFormat';

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * Ouvrir puis réenregistrer sans modification — et comparer les OCTETS.
 *
 * Comparer des chaînes décodées ne prouverait rien sur le BOM : `TextDecoder`
 * le CONSOMME par défaut, donc il disparaîtrait des deux côtés de l'égalité et
 * le test passerait au vert en le perdant. L'invariant porte sur les octets,
 * il se vérifie sur les octets.
 */
const allerRetour = (source: string, ext = 'csv'): Uint8Array | null => {
  const doc = parseCsv(utf8(source), ext);
  if (!doc) return null;
  return serializeCsv(doc.rows, doc.shape);
};

describe('aller-retour sans modification', () => {
  it('CSV simple en LF', () => {
    const source = 'nom,age\nalice,30\nbob,41\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('délimiteur POINT-VIRGULE — l’export français typique', () => {
    // Réécrire avec une virgule casserait l'ouverture dans Excel FR.
    const source = 'nom;age\nalice;30\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('fins de ligne CRLF', () => {
    const source = 'nom,age\r\nalice,30\r\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('BOM — sans lui Excel cesse de lire l’UTF-8', () => {
    const source = '\ufeffnom,ville\nrené,château\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('TOUS les champs cités — la signature d’un export Excel', () => {
    const source = '"nom","age"\n"alice","30"\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('guillemets MINIMAUX : on n’en ajoute pas', () => {
    const source = 'nom,age\nalice,30\n';
    expect(new TextDecoder().decode(allerRetour(source)!)).not.toContain('"');
  });

  it('cite quand il le FAUT, même en style minimal', () => {
    // Un champ qui contient le délimiteur DOIT être cité, sinon le fichier
    // relu n'a plus le même nombre de colonnes.
    const source = 'nom,note\n"durand, jean",bien\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });

  it('TSV : la tabulation est imposée, jamais devinée', () => {
    const source = 'nom\tage\nalice\t30\n';
    expect(allerRetour(source, 'tsv')).toEqual(utf8(source));
  });

  it('accents et caractères non latins traversent intacts', () => {
    const source = 'ville,pays\n東京,日本\nÉvreux,France\n';
    expect(allerRetour(source)).toEqual(utf8(source));
  });
});

describe('la lecture', () => {
  it('refuse ce qui n’est pas de l’UTF-8 valide', () => {
    // Même règle que l'éditeur de texte : un octet remplacé en silence est un
    // fichier détruit à la première sauvegarde.
    expect(parseCsv(new Uint8Array([0x61, 0x80, 0x62]), 'csv')).toBeNull();
  });

  it('complète les lignes courtes pour rendre une grille rectangulaire', () => {
    const doc = parseCsv(utf8('a,b,c\n1,2\n'), 'csv')!;
    expect(doc.rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('n’invente pas de rangée à partir du saut de ligne final', () => {
    const doc = parseCsv(utf8('a,b\n1,2\n'), 'csv')!;
    expect(doc.rows).toHaveLength(2);
  });

  it('retient la forme, pas seulement le contenu', () => {
    const doc = parseCsv(utf8('\ufeffa;b\r\n1;2\r\n'), 'csv')!;
    expect(doc.shape).toMatchObject({ delimiter: ';', eol: '\r\n', bom: true });
  });
});

describe('l’écriture', () => {
  it('une VRAIE modification reste une vraie modification', () => {
    // La restitution ne doit pas figer le contenu : seule la FORME est
    // restaurée, jamais les cellules.
    const doc = parseCsv(utf8('nom,age\nalice,30\n'), 'csv')!;
    doc.rows[1][1] = '31';
    expect(new TextDecoder().decode(serializeCsv(doc.rows, doc.shape))).toBe('nom,age\nalice,31\n');
  });

  it('cite une cellule qui contient un saut de ligne', () => {
    const doc = parseCsv(utf8('a,b\n1,2\n'), 'csv')!;
    doc.rows[1][0] = 'deux\nlignes';
    const sortie = new TextDecoder().decode(serializeCsv(doc.rows, doc.shape));
    // Sans guillemets, la cellule deviendrait deux rangées à la relecture.
    expect(parseCsv(utf8(sortie), 'csv')!.rows[1][0]).toBe('deux\nlignes');
  });

  it('un tableau vide ne produit pas d’octets aberrants', () => {
    const doc = parseCsv(utf8(''), 'csv')!;
    expect(doc.rows).toEqual([]);
    expect(serializeCsv(doc.rows, doc.shape).length).toBeLessThan(4);
  });
});

describe('les rangées vides de la fin', () => {
  // Trois rangées, dont deux blanches VOLONTAIRES, puis le saut de ligne final.
  const AVEC_BLANCHES = ['a,b', ',', ',', ''].join('\n');

  it('ne retire que la rangée fantôme du saut de ligne final', () => {
    // Le rognage se faisait EN BOUCLE : un tableau finissant par des rangées
    // blanches revenait amputé, et le réenregistrement les effaçait pour de
    // bon. Perte silencieuse, dans le module dont toute la raison d'être est
    // de rendre le fichier tel qu'il était.
    const doc = parseCsv(utf8(AVEC_BLANCHES), 'csv')!;
    expect(doc.rows).toEqual([
      ['a', 'b'],
      ['', ''],
      ['', ''],
    ]);
  });

  it('un aller-retour les rend à l’identique', () => {
    const doc = parseCsv(utf8(AVEC_BLANCHES), 'csv')!;
    expect(new TextDecoder().decode(serializeCsv(doc.rows, doc.shape))).toBe(AVEC_BLANCHES);
  });

  it('sans saut de ligne final, aucune rangée n’est retirée', () => {
    const doc = parseCsv(utf8(['a,b', ','].join('\n')), 'csv')!;
    expect(doc.rows).toHaveLength(2);
  });
});
