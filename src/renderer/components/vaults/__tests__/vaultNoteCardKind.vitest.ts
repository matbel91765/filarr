/**
 * LE FIL « une note se reconnaît d'un coup d'œil » — de `itemType` à la carte.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultNoteCardKind.vitest.ts
 *
 * POURQUOI CE TEST LIT LA SOURCE. La suite tourne en environnement `node` : il
 * n'y a pas de DOM pour rendre `FileCard` et regarder ce qui sort. Or le défaut
 * qu'on ferme n'est PAS un calcul — `vaultItemKind` est éprouvé à côté, sur des
 * valeurs — c'est un CHAÎNON MANQUANT : une donnée qui existe et qu'aucune vue
 * ne demande. `offlineStatus` a été exactement cela pendant des mois (une prop
 * de `FileCard` que personne ne passait) et rien ne l'a dit, parce qu'aucun test
 * ne reliait la source à la prop. C'est le même procédé que
 * `grantOverviewModel.vitest.ts`, pour la même raison.
 *
 * L'AUTORITÉ CONSULTÉE EST DONC LE FICHIER LUI-MÊME, jamais un second dérivé :
 * on confronte la promesse (« la carte montre le genre dans les deux vues ») au
 * texte qui la tient. Retirer `kind={…}` de l'explorateur, ou la pastille d'une
 * seule des deux vues, fait tomber ce fichier.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..');
const explorer = readFileSync(join(dir, 'VaultFolderView.tsx'), 'utf8');
const card = readFileSync(join(dir, '..', 'files', 'FileCard.tsx'), 'utf8');

describe('le genre part de l’explorateur de coffre', () => {
  it('la carte de coffre passe `kind` à FileCard', () => {
    expect(explorer).toMatch(/kind=\{file\.kind/);
  });

  it('un FICHIER ordinaire ne porte aucun genre — la carte reste celle du perso', () => {
    // `undefined` et non `'file'` : la carte ne doit pas apprendre un troisième
    // état pour ne rien en faire, et l'espace personnel n'a pas de `kind`.
    expect(explorer).toMatch(/file\.kind === 'file' \? undefined : file\.kind/);
  });
});

describe('la carte MONTRE le genre, dans les deux vues', () => {
  it('elle reçoit la prop et sait qu’une note n’est pas un fichier', () => {
    expect(card).toMatch(/kind\?: FileCardKind;/);
    expect(card).toMatch(/const isNote = !isFolder && !!kind;/);
  });

  it('une note ne cherche PAS d’icône déduite du nom — elle n’a pas d’extension', () => {
    expect(card).toMatch(/const fileTypeInfo = !isFolder && !isNote \? getFileTypeInfo\(/);
  });

  it('vignette dédiée en LISTE comme en GRILLE', () => {
    expect(card).toMatch(/<NoteThumbnail size="list" \/>/);
    expect(card).toMatch(/<NoteThumbnail size="grid" \/>/);
  });

  it('pastille de genre en LISTE comme en GRILLE — le mot, pas seulement le signe', () => {
    // Deux occurrences exactement : une par vue. Une seule, et l'une des deux
    // vues laisse encore une note ressembler à un fichier.
    expect(card.match(/<KindPill kind=\{kind\} \/>/g)?.length).toBe(2);
  });

  it('les libellés sont ceux du coffre, déjà traduits — aucune clé inventée', () => {
    expect(card).toContain('teamVaults.items.kindTransclusion');
    expect(card).toContain('teamVaults.items.kindNote');
  });
});
