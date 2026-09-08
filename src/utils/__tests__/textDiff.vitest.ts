/**
 * CE QU'UNE COMPARAISON DOIT DIRE — et ce qu'elle ne doit jamais inventer.
 *
 * La comparaison de versions sert à décider si on restaure. Un diff qui
 * exagère l'ampleur du changement pousse à restaurer sans raison ; un diff qui
 * la minimise laisse écraser du travail. Les deux erreurs coûtent des données,
 * et c'est pourquoi on tient l'exactitude plutôt qu'une heuristique.
 */

import { describe, it, expect } from 'vitest';
import { diffLignes, enLignes, enSections } from '../textDiff';

const L = (s: string) => enLignes(s);
const rendu = (r: ReturnType<typeof diffLignes>) =>
  r.lignes.map((l) => `${l.type === 'egal' ? ' ' : l.type === 'ajout' ? '+' : '-'}${l.texte}`);

describe('les cas simples', () => {
  it('deux textes identiques ne montrent aucun changement', () => {
    const r = diffLignes(L('a\nb\nc'), L('a\nb\nc'));
    expect(r.ajouts).toBe(0);
    expect(r.suppressions).toBe(0);
    expect(r.lignes.every((l) => l.type === 'egal')).toBe(true);
  });

  it('une ligne insérée au milieu ne rapporte QU’un ajout', () => {
    const r = diffLignes(L('a\nb\nc'), L('a\nX\nb\nc'));
    expect(rendu(r)).toEqual([' a', '+X', ' b', ' c']);
    expect(r.ajouts).toBe(1);
    expect(r.suppressions).toBe(0);
  });

  it('une ligne retirée ne rapporte QU’une suppression', () => {
    const r = diffLignes(L('a\nb\nc'), L('a\nc'));
    expect(rendu(r)).toEqual([' a', '-b', ' c']);
  });

  it('une ligne modifiée est une suppression puis un ajout', () => {
    const r = diffLignes(L('a\nb\nc'), L('a\nB\nc'));
    expect(rendu(r)).toEqual([' a', '-b', '+B', ' c']);
  });

  it('numérote les lignes du FICHIER, pas du fragment comparé', () => {
    const r = diffLignes(L('a\nb\nc\nd\ne'), L('a\nb\nX\nd\ne'));
    const change = r.lignes.filter((l) => l.type !== 'egal');
    expect(change[0]).toMatchObject({ type: 'suppression', texte: 'c', ligneA: 3 });
    expect(change[1]).toMatchObject({ type: 'ajout', texte: 'X', ligneB: 3 });
  });
});

describe('là où l’heuristique gloutonne se trompait', () => {
  it('un bloc DÉPLACÉ loin ne fait pas passer tout le reste pour réécrit', () => {
    /**
     * Le diff des notes regarde cinq lignes en avant. Ici le bloc bouge de
     * huit : il perdait la synchronisation et rapportait la fin du fichier
     * comme entièrement réécrite. La LCS voit le minimum réel — un bloc
     * déplacé, rien d'autre.
     */
    const avant = L('T1\nT2\nT3\nT4\nT5\nT6\nT7\nT8\nBLOC\nQ1\nQ2');
    const apres = L('BLOC\nT1\nT2\nT3\nT4\nT5\nT6\nT7\nT8\nQ1\nQ2');

    const r = diffLignes(avant, apres);
    expect(r.ajouts).toBe(1);
    expect(r.suppressions).toBe(1);
  });

  it('un changement au tout début ne décale pas la suite', () => {
    const r = diffLignes(
      L('vieux\n1\n2\n3\n4\n5\n6\n7\n8\n9'),
      L('neuf\n1\n2\n3\n4\n5\n6\n7\n8\n9')
    );
    expect(r.ajouts + r.suppressions).toBe(2);
  });
});

describe('les bornes', () => {
  it('rend une différence GROSSIÈRE plutôt que de faire tomber l’onglet', () => {
    // Deux mille lignes toutes différentes des deux côtés : quatre millions de
    // cellules, au-delà de la borne.
    const a = Array.from({ length: 2000 }, (_, i) => `ancien ${i}`);
    const b = Array.from({ length: 2000 }, (_, i) => `nouveau ${i}`);

    const r = diffLignes(a, b);
    expect(r.approximatif).toBe(true);
    expect(r.suppressions).toBe(2000);
    expect(r.ajouts).toBe(2000);
  });

  it('un gros fichier PEU modifié reste exact grâce au rognage', () => {
    // Le préfixe et le suffixe communs sont retirés d'abord : il ne reste
    // qu'une poignée de lignes à comparer, et le résultat est exact.
    const a = Array.from({ length: 50000 }, (_, i) => `ligne ${i}`);
    const b = a.slice();
    b[25000] = 'ligne modifiee';

    const r = diffLignes(a, b);
    expect(r.approximatif).toBe(false);
    expect(r.ajouts).toBe(1);
    expect(r.suppressions).toBe(1);
  });

  it('un texte vide face à un texte plein', () => {
    const r = diffLignes(L(''), L('a\nb'));
    expect(r.suppressions).toBe(1); // la ligne vide du texte vide
    expect(r.ajouts).toBe(2);
  });
});

describe('les fins de ligne', () => {
  it('CRLF et LF ne comptent PAS comme une différence', () => {
    // Sinon ouvrir un fichier Windows sous un éditeur qui normalise ferait
    // apparaître le fichier entier comme réécrit.
    const r = diffLignes(L('a\r\nb\r\nc'), L('a\nb\nc'));
    expect(r.ajouts).toBe(0);
    expect(r.suppressions).toBe(0);
  });
});

describe('le repliage en sections', () => {
  it('ne garde que les alentours des changements', () => {
    const lignes = diffLignes(
      L('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15'),
      L('1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\nQUINZE')
    ).lignes;

    const sections = enSections(lignes, 2);
    expect(sections).toHaveLength(1);
    // 2 lignes de contexte avant, la suppression, l'ajout — rien des douze
    // premières lignes identiques.
    expect(sections[0].map((l) => l.texte)).toEqual(['13', '14', '15', 'QUINZE']);
  });

  it('sépare deux changements éloignés en deux sections', () => {
    const a = Array.from({ length: 40 }, (_, i) => String(i));
    const b = a.slice();
    b[2] = 'X';
    b[35] = 'Y';

    const sections = enSections(diffLignes(a, b).lignes, 2);
    expect(sections).toHaveLength(2);
  });

  it('sans aucun changement, il n’y a rien à montrer', () => {
    expect(enSections(diffLignes(L('a\nb'), L('a\nb')).lignes)).toEqual([]);
  });
});
