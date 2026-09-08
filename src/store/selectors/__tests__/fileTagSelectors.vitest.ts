/**
 * L'ÉTIQUETTE EST LUE LÀ OÙ ELLE EST ÉCRITE : DANS LE DOSSIER.
 *
 * ── LE DÉFAUT ───────────────────────────────────────────────────────────────
 *
 * Les étiquettes de fichiers vivaient dans `tagsSlice.fileTagMappings`, une
 * table de session que rien ne persistait. Elles vivent maintenant dans
 * `Folder.fileTags` (`metadata.json`), et ces sélecteurs sont le pont — le seul
 * endroit qui croise les deux tranches, pour qu'aucun écran ne refasse ce
 * croisement à chaque frappe.
 *
 *   npx vitest run src/store/selectors/__tests__/fileTagSelectors.vitest.ts
 */

import { describe, it, expect } from 'vitest';

import {
  selectAllFileTags,
  selectFileTagIndex,
  selectFolderFileTags,
  selectTagsForFile,
} from '../fileTagSelectors';
import type { Folder } from '../../../types';

function folder(over: Partial<Folder> & { id: string }): Folder {
  return { name: over.id, color: '#000', items: [], ...over } as Folder;
}

function state(...folders: Folder[]) {
  return { folders: { byId: Object.fromEntries(folders.map((f) => [f.id, f])) } };
}

describe('selectFileTagIndex — le croisement, fait UNE fois', () => {
  it('réunit les tables de tous les dossiers', () => {
    const s = state(
      folder({ id: 'd1', fileTags: { f1: ['pitch'] } }),
      folder({ id: 'd2', fileTags: { f2: ['archive', 'pitch'] } })
    );
    expect(selectFileTagIndex(s)).toEqual({ f1: ['pitch'], f2: ['archive', 'pitch'] });
  });

  it('NORMALISE à la lecture — un dossier écrit par une version laxiste rentre dans le rang', () => {
    const s = state(folder({ id: 'd1', fileTags: { f1: ['Pitch', 'PITCH', ' appel d offres '] } }));
    expect(selectFileTagIndex(s)).toEqual({ f1: ['pitch', 'appel-d-offres'] });
  });

  it('ÉCARTE les dossiers à la corbeille', () => {
    // Leurs fichiers ne se cherchent pas non plus : compter leurs étiquettes
    // ferait remonter des pastilles qui ne mènent nulle part.
    const s = state(
      folder({ id: 'd1', fileTags: { f1: ['vivant'] } }),
      folder({ id: 'd2', fileTags: { f2: ['mort'] }, deletedAt: '2026-01-01' })
    );
    expect(selectFileTagIndex(s)).toEqual({ f1: ['vivant'] });
  });

  it('n’invente pas d’entrée pour un fichier sans étiquette', () => {
    const s = state(folder({ id: 'd1', fileTags: { f1: [] } }));
    expect(selectFileTagIndex(s)).toEqual({});
  });

  it('rend la MÊME RÉFÉRENCE tant que les dossiers ne bougent pas', () => {
    // C'est tout l'intérêt de la mémoïsation : une liste filtrée à chaque
    // frappe ne doit pas re-parcourir le coffre entier.
    const s = state(folder({ id: 'd1', fileTags: { f1: ['pitch'] } }));
    expect(selectFileTagIndex(s)).toBe(selectFileTagIndex(s));
  });
});

describe('selectAllFileTags — le vocabulaire', () => {
  it('est trié, dédoublonné, et ignore la corbeille', () => {
    const s = state(
      folder({ id: 'd1', fileTags: { f1: ['zèbre', 'pitch'] } }),
      folder({ id: 'd2', fileTags: { f2: ['pitch'] } }),
      folder({ id: 'd3', fileTags: { f3: ['fantome'] }, deletedAt: '2026-01-01' })
    );
    expect(selectAllFileTags(s)).toEqual(['pitch', 'zèbre']);
  });
});

describe('les vues à un seul objet', () => {
  it('un fichier sans étiquette rend une liste vide STABLE', () => {
    const s = state(folder({ id: 'd1' }));
    expect(selectTagsForFile(s, 'inconnu')).toEqual([]);
    expect(selectTagsForFile(s, 'inconnu')).toBe(selectTagsForFile(s, 'autre'));
  });

  it('un dossier sans table rend `{}`, jamais `undefined`', () => {
    const s = state(folder({ id: 'd1' }));
    expect(selectFolderFileTags(s, 'd1')).toEqual({});
    expect(selectFolderFileTags(s, 'inexistant')).toEqual({});
  });

  it('rend la table du dossier telle qu’elle est persistée', () => {
    const s = state(folder({ id: 'd1', fileTags: { f1: ['pitch'] } }));
    expect(selectFolderFileTags(s, 'd1')).toEqual({ f1: ['pitch'] });
  });
});
