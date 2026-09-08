/**
 * L'INVARIANT QUI COMPTE : ouvrir un fichier puis l'enregistrer SANS Y TOUCHER
 * doit rendre les mêmes octets, exactement.
 *
 * Tout le reste de ce module en découle. Un décodage tolérant, une fin de ligne
 * normalisée, un BOM oublié — chacun casse cet invariant en silence, et le
 * dégât ne se voit qu'au `git diff` suivant, ou dans Excel qui cesse de lire un
 * `.csv` en UTF-8.
 */

import { describe, it, expect } from 'vitest';
import { decodeText, encodeText, FORME_NEUTRE } from '../textEncoding';

const octets = (...n: number[]) => new Uint8Array(n);
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Ouvrir puis réenregistrer sans modification. */
const allerRetour = (bytes: Uint8Array): Uint8Array | null => {
  const lu = decodeText(bytes);
  return lu ? encodeText(lu.text, lu.shape) : null;
};

describe('aller-retour sans modification', () => {
  it('rend des octets IDENTIQUES sur du LF simple', () => {
    const source = utf8('alpha\nbeta\n');
    expect(allerRetour(source)).toEqual(source);
  });

  it('rend des octets IDENTIQUES sur du CRLF — le cœur du défaut', () => {
    // Le textarea aplatit tout en LF. Sans restitution, CHAQUE ligne du fichier
    // se retrouvait réécrite : un diff de 100 % sur un fichier non modifié.
    const source = utf8('alpha\r\nbeta\r\n');
    expect(allerRetour(source)).toEqual(source);
  });

  it('rend des octets IDENTIQUES quand un BOM est présent', () => {
    const source = octets(0xef, 0xbb, 0xbf, ...utf8('nom;valeur\r\n'));
    expect(allerRetour(source)).toEqual(source);
  });

  it('rend des octets IDENTIQUES sur des CR isolés (vieux Mac)', () => {
    const source = utf8('alpha\rbeta\r');
    expect(allerRetour(source)).toEqual(source);
  });

  it('rend des octets IDENTIQUES sur un fichier vide', () => {
    expect(allerRetour(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it('rend des octets IDENTIQUES sur de l’UTF-8 non ASCII', () => {
    const source = utf8('éàü — 日本語\n');
    expect(allerRetour(source)).toEqual(source);
  });
});

describe('refus de décoder', () => {
  it('refuse des octets qui ne sont pas de l’UTF-8 valide', () => {
    // 0x80 seul est une continuation orpheline. L'ancien décodeur en faisait un
    // U+FFFD sans un mot, et la première sauvegarde figeait la mutilation.
    expect(decodeText(octets(0x61, 0x80, 0x62))).toBeNull();
  });

  it('refuse du binaire même quand il se décode', () => {
    // Un NUL passe `fatal: true` : c'est de l'UTF-8 parfaitement valide. Seule
    // la sonde binaire l'attrape.
    expect(decodeText(octets(0x61, 0x00, 0x62))).toBeNull();
  });

  it('accepte un texte qui ressemble à du binaire mais n’en est pas', () => {
    expect(decodeText(utf8('\t\r\n[0m couleurs ANSI'))).not.toBeNull();
  });
});

describe('détection de la forme', () => {
  it('retient crlf quand il domine', () => {
    expect(decodeText(utf8('a\r\nb\r\nc\n'))?.shape.eol).toBe('crlf');
  });

  it('retient lf quand il domine', () => {
    expect(decodeText(utf8('a\nb\nc\r\n'))?.shape.eol).toBe('lf');
  });

  it('retient lf pour un fichier sans aucune fin de ligne', () => {
    expect(decodeText(utf8('une seule ligne'))?.shape.eol).toBe('lf');
  });

  it('signale le BOM et le retire du texte rendu', () => {
    const lu = decodeText(octets(0xef, 0xbb, 0xbf, ...utf8('a')));
    expect(lu?.shape.bom).toBe(true);
    expect(lu?.text).toBe('a');
  });

  it('rend toujours du LF à l’éditeur, quelle que soit la source', () => {
    expect(decodeText(utf8('a\r\nb'))?.text).toBe('a\nb');
    expect(decodeText(utf8('a\rb'))?.text).toBe('a\nb');
  });
});

describe('écriture', () => {
  it('n’ajoute pas de BOM quand le fichier n’en avait pas', () => {
    expect(encodeText('a', FORME_NEUTRE)).toEqual(utf8('a'));
  });

  it('restitue les fins de ligne du fichier, pas celles du textarea', () => {
    expect(encodeText('a\nb', { bom: false, eol: 'crlf' })).toEqual(utf8('a\r\nb'));
    expect(encodeText('a\nb', { bom: false, eol: 'cr' })).toEqual(utf8('a\rb'));
  });

  it('une VRAIE modification reste une vraie modification', () => {
    // La restitution ne doit pas figer le contenu : seuls les séparateurs et le
    // BOM sont restaurés, jamais le texte.
    const lu = decodeText(utf8('a\r\nb\r\n'))!;
    expect(encodeText(lu.text.replace('b', 'z'), lu.shape)).toEqual(utf8('a\r\nz\r\n'));
  });
});
