/**
 * LE SEUL CONTRAT DE L'ADAPTATEUR DISQUE QUI MÉRITE D'ÊTRE PROUVÉ :
 * AUCUN CHEMIN NE SORT DU PROFIL.
 *
 * Les chemins d'objets de note viennent d'un INDEX, et un index peut venir du
 * nuage — donc d'une donnée qu'un attaquant contrôlerait s'il tenait le compte.
 * Une entrée dont l'`objectId` remonterait l'arborescence ferait écrire, ou pire
 * effacer, ailleurs sur la machine.
 *
 * Deux barrières indépendantes couvrent ça, et c'est voulu : `isValidObjectId`
 * (jeu de caractères, dans notesVaultStore) refuse déjà tout ce qui n'est pas
 * alphanumérique. Celle-ci est la seconde, celle qui tient même si la première
 * est contournée par un chemin qu'on n'avait pas prévu.
 */

import path from 'path';
import { describe, expect, it } from 'vitest';

import { safeJoin, upgradeNotesVaultContainers, type UpgradeDeps } from '../notesVaultIO';

const BASE = path.resolve('/profils/p1');

describe('résolution de chemin sous le profil', () => {
  it('accepte ce qui reste sous la racine', () => {
    expect(safeJoin(BASE, 'notes/index.enc')).toBe(path.join(BASE, 'notes', 'index.enc'));
    expect(safeJoin(BASE, 'notes.enc')).toBe(path.join(BASE, 'notes.enc'));
    // La racine elle-même est acceptable (list du dossier de profil).
    expect(safeJoin(BASE, '.')).toBe(BASE);
  });

  it('refuse tout ce qui s’en échappe', () => {
    for (const mauvais of [
      '../voisin/index.enc',
      'notes/../../voisin.enc',
      '../../../../etc/passwd',
      path.resolve('/ailleurs/quelque-chose.enc'),
    ]) {
      expect(safeJoin(BASE, mauvais)).toBeNull();
    }
  });

  /**
   * Le piège classique du préfixe : `/profils/p1-bis` COMMENCE par `/profils/p1`
   * sans être dedans. La comparaison porte donc sur `racine + séparateur`, pas
   * sur la racine seule.
   */
  it('ne confond pas un dossier VOISIN dont le nom commence pareil', () => {
    expect(safeJoin(BASE, '../p1-bis/vol.enc')).toBeNull();
    expect(safeJoin(BASE, '../p1bis/vol.enc')).toBeNull();
  });
});

// ── Migration v2 → v3 du coffre de notes ─────────────────────────────────────
//
// Une passe sur `notes/` et `notes/blobs/` : ce qui n'est pas `v3:` est relu
// puis réécrit en `v3:`. Jamais `notes.enc` à la racine, jamais un fichier qui a
// bougé entre la lecture et la réécriture, jamais une rétrogradation.

describe('upgradeNotesVaultContainers', () => {
  const BASE = path.resolve('C:/profil');
  const P = (rel: string) => path.join(BASE, ...rel.split('/'));

  /** Un disque en mémoire : le contenu commence par son marqueur, le clair est du JSON. */
  function disque(fichiers: Record<string, string>, enabled = true) {
    const files = new Map<string, string>(Object.entries(fichiers).map(([k, v]) => [P(k), v]));
    const ecrits: string[] = [];
    const deps: UpgradeDeps = {
      enabled: () => enabled,
      readHead: async (full) => (files.get(full) ?? '').slice(0, 3),
      stat: async (full) => {
        const c = files.get(full);
        return c === undefined ? null : `${c.length}:${c}`;
      },
      readFile: async (full) => files.get(full) ?? '',
      decrypt: async (container) => {
        if (container.startsWith('boom')) throw new Error('illisible');
        return JSON.parse(container.slice(3));
      },
      encryptToFile: async (plain, full) => {
        files.set(full, 'v3:' + JSON.stringify(plain));
        ecrits.push(full);
      },
      list: async (fullDir) => {
        const prefix = fullDir + path.sep;
        return [...files.keys()]
          .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes(path.sep))
          .map((k) => k.slice(prefix.length));
      },
    };
    return { files, ecrits, deps };
  }

  it('réécrit en v3 ce qui est en v2 sous notes/ et notes/blobs/, laisse le v3 tel quel', async () => {
    const d = disque({
      'notes/a.enc': 'v2:{"id":"a"}',
      'notes/b.enc': 'v3:{"id":"b"}',
      'notes/index.enc': 'v2:{"notes":{}}',
      'notes/blobs/img.enc': 'v2:"base64"',
    });
    const r = await upgradeNotesVaultContainers(BASE, d.deps);
    expect(r).toEqual({ upgraded: 3, skipped: 1, failed: 0 });
    expect(d.files.get(P('notes/a.enc'))).toBe('v3:{"id":"a"}');
    expect(d.files.get(P('notes/index.enc'))).toBe('v3:{"notes":{}}');
    expect(d.files.get(P('notes/blobs/img.enc'))).toBe('v3:"base64"');
    expect(d.files.get(P('notes/b.enc'))).toBe('v3:{"id":"b"}');
  });

  it('ne touche JAMAIS notes.enc à la racine, ni ce qui n’est pas un .enc', async () => {
    const d = disque({
      'notes.enc': 'v2:{"byId":{}}',
      'notes/a.enc': 'v2:{"id":"a"}',
      'notes/lisez-moi.txt': 'v2:pas un conteneur',
    });
    await upgradeNotesVaultContainers(BASE, d.deps);
    expect(d.files.get(P('notes.enc'))).toBe('v2:{"byId":{}}');
    expect(d.files.get(P('notes/lisez-moi.txt'))).toBe('v2:pas un conteneur');
    expect(d.ecrits).toEqual([P('notes/a.enc')]);
  });

  it('drapeau éteint : rien n’est lu, rien n’est écrit', async () => {
    const d = disque({ 'notes/a.enc': 'v2:{"id":"a"}' }, false);
    expect(await upgradeNotesVaultContainers(BASE, d.deps)).toEqual({ upgraded: 0, skipped: 0, failed: 0 });
    expect(d.ecrits).toEqual([]);
  });

  it('un fichier qui bouge pendant sa lecture est laissé au plus frais', async () => {
    const d = disque({ 'notes/a.enc': 'v2:{"id":"a","v":1}' });
    const decryptOriginal = d.deps.decrypt;
    d.deps.decrypt = async (container) => {
      // Le cycle de synchronisation écrit une version plus fraîche pendant qu'on déchiffre.
      d.files.set(P('notes/a.enc'), 'v2:{"id":"a","v":2}');
      return decryptOriginal(container);
    };
    const r = await upgradeNotesVaultContainers(BASE, d.deps);
    expect(r).toEqual({ upgraded: 0, skipped: 1, failed: 0 });
    expect(d.files.get(P('notes/a.enc'))).toBe('v2:{"id":"a","v":2}');
  });

  it('un fichier illisible est compté en échec, les autres passent', async () => {
    const d = disque({ 'notes/a.enc': 'boom', 'notes/b.enc': 'v2:{"id":"b"}' });
    const r = await upgradeNotesVaultContainers(BASE, d.deps);
    expect(r).toEqual({ upgraded: 1, skipped: 0, failed: 1 });
    expect(d.files.get(P('notes/a.enc'))).toBe('boom');
    expect(d.files.get(P('notes/b.enc'))).toBe('v3:{"id":"b"}');
  });
});
