/**
 * LE PANNEAU DÉTAILS DIT « NOTE », ET NE MONTRE PAS DE LIGNES VIDES.
 *
 *   npx vitest run src/renderer/components/views/FolderView/__tests__/fileDetailsPanelKind.vitest.ts
 *
 * LE DÉFAUT QU'IL FERME, vu sur une capture. Les détails d'une note de coffre
 * annonçaient « Fichier », une extension vide et un type MIME vide : le panneau
 * retombait sur `getFileTypeInfo(nom)`, or une note n'a PAS d'extension. C'est
 * exactement le défaut déjà corrigé sur les cartes (`vaultItemKind`), au même
 * endroit du raisonnement — on déduisait le genre du NOM au lieu de le lire là
 * où il est écrit.
 *
 * POURQUOI CE TEST LIT LA SOURCE. Ce qu'il garde n'est pas un calcul —
 * `vaultItemKind` est éprouvé à côté, sur des valeurs — c'est un CHAÎNON : une
 * donnée qui existe côté explorateur et que le panneau ne demandait pas.
 * `offlineStatus` a été cela pendant des mois. Même procédé, et même autorité
 * consultée : le fichier qui tient la promesse, jamais un second dérivé.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const dir = join(__dirname, '..');
const lire = (p: string) => readFileSync(p, 'utf8');

const panel = lire(join(dir, 'FileDetailsPanel.tsx'));
const explorer = lire(join(dir, '..', '..', 'vaults', 'VaultFolderView.tsx'));

describe('l’explorateur de coffre DIT le genre au panneau', () => {
  it('il le tire de `vaultItemKind`, la même autorité que les cartes', () => {
    expect(explorer).toMatch(/const detailsKind = [\s\S]{0,80}vaultItemKind\(detailsItem\)/);
  });

  it('un FICHIER ordinaire ne porte aucun genre — le panneau reste celui du perso', () => {
    // `undefined` et non `'file'` : même contrat que la carte, pour que le
    // panneau n'apprenne pas un troisième état dont il ne ferait rien.
    expect(explorer).toMatch(/kind=\{detailsKind === 'file' \? undefined : detailsKind\}/);
  });
});

describe('le panneau lit ce genre et cesse de deviner', () => {
  it('il reçoit la prop, du même type que la carte', () => {
    // Le MÊME type que `FileCard` : deux unions parallèles finiraient par
    // diverger, et l'une des deux vues montrerait un genre que l'autre ignore.
    expect(panel).toMatch(/kind\?: FileCardKind;/);
    expect(panel).toMatch(/const isNote = !isFolder && !!kind;/);
  });

  it('une note ne cherche PAS d’icône déduite du nom — elle n’a pas d’extension', () => {
    expect(panel).toMatch(/const fileTypeInfo = fileItem && !isNote \? getFileTypeInfo\(/);
  });

  it('elle s’annonce « Note » / « Note intégrée » — les clés du coffre, déjà traduites', () => {
    expect(panel).toContain('teamVaults.items.kindTransclusion');
    expect(panel).toContain('teamVaults.items.kindNote');
    // …et l'ancien repli « Fichier » ne la reprend pas au passage.
    expect(panel).toMatch(/isNote[\s\S]{0,200}fileItem\?\.type \|\| t\('details\.kind\.file'/);
  });

  it('NI EXTENSION NI TYPE MIME pour une note — deux lignes vides valent moins que rien', () => {
    // Une ligne « Extension : » suivie d'un blanc n'informe pas : elle fait
    // croire à une donnée manquante là où la question ne se pose pas.
    expect(panel).toMatch(
      /\{!isNote && \([\s\S]{0,400}details\.info\.extension[\s\S]{0,400}details\.info\.mimeType/
    );
  });
});
