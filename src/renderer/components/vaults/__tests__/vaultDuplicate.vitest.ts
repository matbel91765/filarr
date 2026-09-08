/**
 * « Dupliquer ici » — le nom du duplicata et le plan.
 *
 * Ce que ces tests défendent : « (copie) » ne s'empile jamais (« a (copie) »
 * → « a (copie 2) ») ; l'extension reste à sa place ; un nom déjà pris dans le
 * dossier (le lot en cours compris) fait passer au numéro suivant ; les
 * dossiers cochés sont exclus et COMPTÉS ; la méta garde tout le reste.
 */

import { describe, it, expect } from 'vitest';
import {
  splitExtension,
  copyNameFor,
  duplicateMeta,
  takenNamesIn,
  planDuplicate,
} from '../vaultDuplicate';
import type { VaultItemLike } from '../vaultExplorerModel';

const none = new Set<string>();

describe('splitExtension', () => {
  it('coupe à la DERNIÈRE extension, jamais sur un point de tête ou de queue', () => {
    expect(splitExtension('rapport.final.pdf')).toEqual(['rapport.final', '.pdf']);
    expect(splitExtension('.env')).toEqual(['.env', '']);
    expect(splitExtension('Sans point')).toEqual(['Sans point', '']);
    expect(splitExtension('fin.')).toEqual(['fin.', '']);
  });
});

describe('copyNameFor', () => {
  it('ajoute « (copie) » avant l extension', () => {
    expect(copyNameFor('contrat.pdf', 'copie', none)).toBe('contrat (copie).pdf');
    expect(copyNameFor('Réunion', 'copie', none)).toBe('Réunion (copie)');
  });
  it('n empile jamais : (copie) → (copie 2) → (copie 3)', () => {
    expect(copyNameFor('contrat (copie).pdf', 'copie', none)).toBe('contrat (copie 2).pdf');
    expect(copyNameFor('contrat (copie 2).pdf', 'copie', none)).toBe('contrat (copie 3).pdf');
    expect(copyNameFor('note (copie 9)', 'copie', none)).toBe('note (copie 10)');
  });
  it('saute les noms déjà pris dans le dossier', () => {
    const taken = new Set(['contrat (copie).pdf', 'contrat (copie 2).pdf']);
    expect(copyNameFor('contrat.pdf', 'copie', taken)).toBe('contrat (copie 3).pdf');
  });
  it('le mot est celui de la langue — et les caractères spéciaux n y cassent rien', () => {
    expect(copyNameFor('a.txt', 'copy', none)).toBe('a (copy).txt');
    expect(copyNameFor('a (copy).txt', 'copy', none)).toBe('a (copy 2).txt');
    expect(copyNameFor('a (c.o+py).txt', 'c.o+py', none)).toBe('a (c.o+py 2).txt');
    // Un autre mot n'est pas un suffixe : « copie » n'est pas « copy ».
    expect(copyNameFor('a (copie).txt', 'copy', none)).toBe('a (copie) (copy).txt');
  });
});

describe('duplicateMeta', () => {
  it('suffixe fileName pour un fichier, title pour une note, garde le reste', () => {
    const f = duplicateMeta(
      { fileName: 'a.pdf', mime: 'application/pdf', path: 'X' },
      'copie',
      none
    );
    expect(f).toEqual({ fileName: 'a (copie).pdf', mime: 'application/pdf', path: 'X' });
    const n = duplicateMeta({ title: 'Idées', path: 'X' }, 'copie', none);
    expect(n).toEqual({ title: 'Idées (copie)', path: 'X' });
  });
  it('sans aucun nom : le suffixe seul, pour rester reconnaissable', () => {
    expect(duplicateMeta({}, 'copie', none)).toEqual({ title: '(copie)' });
  });
});

function item(
  id: string,
  path: string | undefined,
  meta: Partial<VaultItemLike['meta']> = {},
  itemType = 'file'
): VaultItemLike {
  return {
    id,
    ownerUserId: 'me',
    itemType,
    sizeBytes: 1,
    updatedAt: '2026-08-27T10:00:00Z',
    meta: { fileName: `${id}.pdf`, path, ...meta },
  };
}

describe('takenNamesIn', () => {
  it('les contenus du dossier seulement — ni marqueurs, ni fils, ni autres dossiers', () => {
    const items = [
      item('a', 'X'),
      item('b', 'X', { fileName: undefined, title: 'Note' }, 'note'),
      item('m', 'X', { fileName: undefined, title: 'X', folderMarker: true }, 'note'),
      item('t', 'X', { fileName: undefined, threadFor: 'a' }, 'note'),
      item('c', 'X/Y'),
      item('r', undefined),
    ];
    expect([...takenNamesIn(items, 'X')].sort()).toEqual(['Note', 'a.pdf']);
    expect([...takenNamesIn(items, '')]).toEqual(['r.pdf']);
  });
});

describe('planDuplicate', () => {
  it('fichiers et notes cochés directement ; dossiers et types inconnus exclus et comptés', () => {
    const plan = planDuplicate({
      items: [item('a', 'X'), item('n', 'X', {}, 'note'), item('z', 'X', {}, 'mystère')],
      folderPaths: ['X/Y', 'Z'],
    });
    expect(plan.files.map((i) => i.id)).toEqual(['a', 'n']);
    expect(plan.skippedFolders).toBe(2);
    expect(plan.skippedOther).toBe(1);
  });
  it('rien de coché : un plan vide, pas une exception', () => {
    expect(planDuplicate({ items: [], folderPaths: [] })).toEqual({
      files: [],
      skippedFolders: 0,
      skippedOther: 0,
    });
  });
});
