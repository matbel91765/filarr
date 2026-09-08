/**
 * LES ÉTIQUETTES DE FICHIERS SURVIVENT AU RECHARGEMENT — LE FORMAT.
 *
 * ── LE DÉFAUT ───────────────────────────────────────────────────────────────
 *
 * Le `TagPicker` du bureau écrivait dans `tagsSlice.fileTagMappings`, qui
 * n'était ni persisté ni synchronisé : fermer l'application effaçait tout le
 * travail d'étiquetage, sans un mot. La fonction avait pourtant l'air de
 * marcher — c'est le pire genre de défaut.
 *
 * ── CE QUE CES VECTEURS GARDENT ─────────────────────────────────────────────
 *
 * LA FORME SÉRIALISÉE, parce que c'est elle que le téléphone lit. Le format
 * vient de lui (`filarr-mobile/src/services/tags/fileTags.ts`) : une table
 * plate `Folder.fileTags`, des chaînes normalisées par la MÊME règle, et la
 * clé RETIRÉE plutôt qu'écrite à `[]`. Un écart d'un caractère sur la
 * normalisation couperait le vocabulaire en deux, et les deux moitiés
 * paraîtraient correctes chacune de son côté.
 *
 *   npx vitest run src/services/tags/__tests__/fileTags.vitest.ts
 */

import { describe, it, expect } from 'vitest';

import {
  allFileTags,
  fileMatchesQuery,
  fileMatchesTag,
  fileTagsOf,
  mergedTagVocabulary,
  normalizeFileTag,
  normalizeFileTagList,
  pruneFileTags,
  sanitizeFileTagMap,
  tagCountsForFolder,
  toggleFileTag,
  withFileTags,
  type FileTagMap,
} from '../fileTags';

// ── La normalisation, mot pour mot celle du mobile ──────────────────────────

describe('normalizeFileTag — la règle est partagée avec le téléphone', () => {
  it('minuscule, sans espaces de bord', () => {
    expect(normalizeFileTag('  Pitch  ')).toBe('pitch');
    expect(normalizeFileTag('PITCH')).toBe('pitch');
  });

  it('espaces ET virgules deviennent des tirets, sans doublons de tirets', () => {
    expect(normalizeFileTag('appel d offres')).toBe('appel-d-offres');
    expect(normalizeFileTag('a,,b')).toBe('a-b');
    expect(normalizeFileTag('a ,  b')).toBe('a-b');
  });

  it('une saisie vide reste vide — elle ne devient pas un tiret', () => {
    expect(normalizeFileTag('   ')).toBe('');
    expect(normalizeFileTag('')).toBe('');
  });

  it('les accents et la casse Unicode sont PRÉSERVÉS, pas translittérés', () => {
    // Le mobile ne translittère pas non plus : « été » et « ete » sont deux
    // étiquettes. Translittérer d'un seul côté les ferait diverger.
    expect(normalizeFileTag('Été')).toBe('été');
  });
});

describe('normalizeFileTagList — ordre de saisie, pas ordre alphabétique', () => {
  it('garde le PREMIER ordre et dédoublonne', () => {
    expect(normalizeFileTagList(['Zèbre', 'archive', 'ZÈBRE'])).toEqual(['zèbre', 'archive']);
  });

  it('jette les vides sans laisser de trou', () => {
    expect(normalizeFileTagList(['  ', 'a', ''])).toEqual(['a']);
  });
});

// ── La table, telle qu'elle est persistée ───────────────────────────────────

describe('withFileTags — la FORME dans metadata.json', () => {
  it('range une liste normalisée sous l’identifiant du fichier', () => {
    expect(withFileTags(undefined, 'f1', ['Pitch', 'appel d offres'])).toEqual({
      f1: ['pitch', 'appel-d-offres'],
    });
  });

  it('une liste VIDE retire la clé — jamais un `[]` qui traîne', () => {
    // Un `[]` résiduel ferait diverger le condensat du dossier et relancerait
    // un cycle de synchronisation pour un geste qui n'a rien changé.
    const map: FileTagMap = { f1: ['pitch'], f2: ['archive'] };
    expect(withFileTags(map, 'f1', [])).toEqual({ f2: ['archive'] });
    expect(withFileTags(map, 'f1', ['   '])).toEqual({ f2: ['archive'] });
  });

  it('rend la table D’ORIGINE quand rien ne change — l’appelant peut s’abstenir d’écrire', () => {
    const map: FileTagMap = { f1: ['pitch'] };
    expect(withFileTags(map, 'f1', ['Pitch'])).toBe(map);
    expect(withFileTags(map, 'f2', [])).toBe(map);
  });

  it('ne mute jamais la table d’entrée', () => {
    const map: FileTagMap = { f1: ['pitch'] };
    const out = withFileTags(map, 'f2', ['archive']);
    expect(map).toEqual({ f1: ['pitch'] });
    expect(out).not.toBe(map);
  });
});

describe('toggleFileTag — le geste du sélecteur', () => {
  it('ajoute puis retire, et l’aller-retour rend la table à son état d’origine', () => {
    const posee = toggleFileTag({}, 'f1', 'Pitch');
    expect(posee).toEqual({ f1: ['pitch'] });
    expect(toggleFileTag(posee, 'f1', 'pitch')).toEqual({});
  });

  it('ajoute EN FIN de liste — la pastille ne saute pas sous le curseur', () => {
    const map = toggleFileTag({ f1: ['zèbre'] }, 'f1', 'archive');
    expect(map.f1).toEqual(['zèbre', 'archive']);
  });

  it('une étiquette vide ne fait rien', () => {
    const map: FileTagMap = { f1: ['pitch'] };
    expect(toggleFileTag(map, 'f1', '   ')).toBe(map);
  });
});

describe('pruneFileTags — un fichier détruit n’a plus d’étiquettes', () => {
  it('retire les entrées orphelines', () => {
    expect(pruneFileTags({ f1: ['a'], f2: ['b'] }, ['f1'])).toEqual({ f1: ['a'] });
  });

  it('rend la table d’origine quand tout le monde est vivant', () => {
    const map: FileTagMap = { f1: ['a'] };
    expect(pruneFileTags(map, ['f1', 'f2'])).toBe(map);
  });
});

describe('sanitizeFileTagMap — ces octets viennent d’un AUTRE appareil', () => {
  it('relit ce qu’on a écrit', () => {
    expect(sanitizeFileTagMap({ f1: ['pitch', 'archive'] })).toEqual({
      f1: ['pitch', 'archive'],
    });
  });

  it('normalise à la relecture — un fichier écrit par une version laxiste rentre dans le rang', () => {
    expect(sanitizeFileTagMap({ f1: ['Pitch', 'PITCH', ' appel d offres '] })).toEqual({
      f1: ['pitch', 'appel-d-offres'],
    });
  });

  it('ÉCARTE ce qui n’a pas la forme, sans rien deviner', () => {
    expect(sanitizeFileTagMap(null)).toEqual({});
    expect(sanitizeFileTagMap([1, 2])).toEqual({});
    expect(sanitizeFileTagMap('pitch')).toEqual({});
    expect(sanitizeFileTagMap({ f1: 'pitch' })).toEqual({});
    expect(sanitizeFileTagMap({ f1: [1, null, 'pitch'] })).toEqual({ f1: ['pitch'] });
    expect(sanitizeFileTagMap({ f1: [] })).toEqual({});
  });
});

describe('fileTagsOf', () => {
  it('rend une liste vide plutôt qu’undefined', () => {
    expect(fileTagsOf(undefined, 'f1')).toEqual([]);
    expect(fileTagsOf({ id: 'd1' }, 'f1')).toEqual([]);
    expect(fileTagsOf({ id: 'd1', fileTags: { f1: ['Pitch'] } }, 'f1')).toEqual(['pitch']);
  });
});

// ── Vocabulaire et comptages ────────────────────────────────────────────────

describe('allFileTags', () => {
  it('réunit et TRIE le vocabulaire de tous les dossiers', () => {
    expect(
      allFileTags([
        { id: 'd1', fileTags: { f1: ['zèbre', 'pitch'] } },
        { id: 'd2', fileTags: { f2: ['archive', 'pitch'] } },
      ])
    ).toEqual(['archive', 'pitch', 'zèbre']);
  });

  it('ignore les dossiers à la CORBEILLE', () => {
    // Proposer une étiquette qui ne vit plus que dans un dossier supprimé
    // mènerait à une liste vide.
    expect(
      allFileTags([
        { id: 'd1', fileTags: { f1: ['vivant'] } },
        { id: 'd2', fileTags: { f2: ['mort'] }, deletedAt: '2026-01-01' },
      ])
    ).toEqual(['vivant']);
  });
});

describe('mergedTagVocabulary — les mêmes étiquettes servent aux notes et aux fichiers', () => {
  it('réunit, dédoublonne, trie', () => {
    expect(mergedTagVocabulary(['pitch', 'note'], ['pitch', 'archive'])).toEqual([
      'archive',
      'note',
      'pitch',
    ]);
  });
});

describe('tagCountsForFolder', () => {
  const files = [
    { id: 'f1', name: 'a.pdf' },
    { id: 'f2', name: 'b.pdf' },
    { id: 'f3', name: 'c.pdf', deletedAt: '2026-01-01' },
  ];

  it('compte les fichiers VIVANTS, du plus fréquent au moins fréquent', () => {
    expect(
      tagCountsForFolder({
        fileTags: { f1: ['pitch', 'archive'], f2: ['pitch'], f3: ['pitch'] },
        files,
      })
    ).toEqual([
      { tag: 'pitch', count: 2 },
      { tag: 'archive', count: 1 },
    ]);
  });

  it('un fichier À LA CORBEILLE ne gonfle pas la pastille', () => {
    // Sinon la pastille annonce « 3 » et le filtre n'en montre que deux.
    expect(tagCountsForFolder({ fileTags: { f3: ['fantome'] }, files })).toEqual([]);
  });

  it('une entrée orpheline (fichier inconnu) ne compte pas non plus', () => {
    expect(tagCountsForFolder({ fileTags: { inconnu: ['x'] }, files })).toEqual([]);
  });

  it('à égalité, l’ordre est ALPHABÉTIQUE — donc stable d’un rendu à l’autre', () => {
    expect(
      tagCountsForFolder({ fileTags: { f1: ['zèbre'], f2: ['archive'] }, files }).map((c) => c.tag)
    ).toEqual(['archive', 'zèbre']);
  });
});

describe('fileMatchesTag', () => {
  const map: FileTagMap = { f1: ['pitch'] };
  it('`null` laisse tout passer — aucun filtre n’est pas un filtre vide', () => {
    expect(fileMatchesTag(map, 'f2', null)).toBe(true);
  });
  it('ne retient que les porteurs', () => {
    expect(fileMatchesTag(map, 'f1', 'pitch')).toBe(true);
    expect(fileMatchesTag(map, 'f2', 'pitch')).toBe(false);
  });
});

// ── La recherche par nom ────────────────────────────────────────────────────

describe('fileMatchesQuery — chercher « pitch » trouve un PDF étiqueté pitch', () => {
  const file = { id: 'f1', name: 'investisseurs.pdf' };

  it('une requête vide laisse tout passer', () => {
    expect(fileMatchesQuery(file, [], '   ')).toBe(true);
  });

  it('trouve par le NOM, sans casse', () => {
    expect(fileMatchesQuery(file, [], 'INVEST')).toBe(true);
  });

  it('trouve par l’ÉTIQUETTE quand le nom ne dit rien', () => {
    expect(fileMatchesQuery(file, ['pitch'], 'pitch')).toBe(true);
    expect(fileMatchesQuery(file, [], 'pitch')).toBe(false);
  });

  it('`#` en tête ne cherche QUE dans les étiquettes', () => {
    // « #investisseurs » ne doit PAS trouver le fichier par son nom : c'est
    // toute la raison d'être du préfixe.
    expect(fileMatchesQuery(file, ['pitch'], '#pitch')).toBe(true);
    expect(fileMatchesQuery(file, ['pitch'], '#investisseurs')).toBe(false);
  });

  it('`#` seul retombe sur « tout passe » plutôt que sur « rien »', () => {
    expect(fileMatchesQuery(file, [], '#')).toBe(true);
  });

  it('`#` normalise la requête — « #Appel D Offres » trouve `appel-d-offres`', () => {
    expect(fileMatchesQuery(file, ['appel-d-offres'], '#Appel D Offres')).toBe(true);
  });

  it('la recherche par étiquette est un PRÉFIXE-DANS, pas une égalité', () => {
    expect(fileMatchesQuery(file, ['appel-d-offres'], '#offres')).toBe(true);
  });
});
