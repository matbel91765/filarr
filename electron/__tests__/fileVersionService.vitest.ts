/**
 * La rétention des instantanés de fichiers — la seule partie de
 * `fileVersionService` qui RAISONNE, donc la seule qui se teste sans disque
 * ni chiffrement.
 *
 * Ce qu'on vérifie tient en une phrase : on ne perd jamais le plus récent, et
 * on ne laisse jamais l'historique d'un fichier manger le disque.
 */

import { describe, expect, it } from 'vitest';
import { applyRetention, type FileVersionMeta } from '../fileVersionService';

const KO = 1024;

const v = (n: number, size: number, minutesAgo: number): FileVersionMeta => ({
  id: `id${n}`,
  fileId: 'f1',
  fileName: 'note.md',
  folderId: 'dossier',
  versionNumber: n,
  size,
  sha256: `sha${n}`,
  // Base fixe : `Date.now()` rendrait le test dépendant de l'heure d'exécution.
  createdAt: new Date(1_700_000_000_000 - minutesAgo * 60_000).toISOString(),
});

describe('applyRetention', () => {
  it('garde tout tant que le nombre et la taille tiennent', () => {
    const versions = [v(3, KO, 0), v(2, KO, 10), v(1, KO, 20)];
    const { kept, dropped } = applyRetention(versions, 10, 10 * KO);
    expect(kept).toHaveLength(3);
    expect(dropped).toHaveLength(0);
  });

  it('coupe au NOMBRE, en gardant les plus récentes', () => {
    const versions = [v(5, KO, 0), v(4, KO, 1), v(3, KO, 2), v(2, KO, 3), v(1, KO, 4)];
    const { kept, dropped } = applyRetention(versions, 3, 10 * KO);
    expect(kept.map((k) => k.versionNumber)).toEqual([5, 4, 3]);
    expect(dropped.map((d) => d.versionNumber)).toEqual([2, 1]);
  });

  it("coupe à l'ENVELOPPE de taille, même si le compte le permettrait", () => {
    const versions = [v(3, 6 * KO, 0), v(2, 6 * KO, 1), v(1, 6 * KO, 2)];
    const { kept, dropped } = applyRetention(versions, 10, 10 * KO);
    // 6 + 6 = 12 Ko > 10 Ko : seule la plus récente tient.
    expect(kept.map((k) => k.versionNumber)).toEqual([3]);
    expect(dropped.map((d) => d.versionNumber)).toEqual([2, 1]);
  });

  it('garde TOUJOURS la plus récente, même seule au-dessus de l’enveloppe', () => {
    // Un historique vide est un pire service qu'un historique trop gros, et
    // l'entrée vient d'être payée (chiffrée puis écrite).
    const versions = [v(2, 99 * KO, 0), v(1, KO, 1)];
    const { kept, dropped } = applyRetention(versions, 10, 10 * KO);
    expect(kept.map((k) => k.versionNumber)).toEqual([2]);
    expect(dropped.map((d) => d.versionNumber)).toEqual([1]);
  });

  it('ordonne par date et non par ordre d’arrivée', () => {
    // L'index peut arriver dans n'importe quel ordre : c'est `createdAt` qui
    // tranche, jamais la position dans le tableau.
    const versions = [v(1, KO, 30), v(3, KO, 0), v(2, KO, 15)];
    const { kept } = applyRetention(versions, 2, 10 * KO);
    expect(kept.map((k) => k.versionNumber)).toEqual([3, 2]);
  });

  it('traite une taille absente ou aberrante comme nulle plutôt que d’exclure', () => {
    const casse = { ...v(2, Number.NaN, 0) };
    const { kept, dropped } = applyRetention([casse, v(1, KO, 1)], 10, 10 * KO);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it('sur une liste vide, ne rend rien et ne casse pas', () => {
    expect(applyRetention([], 10, 10 * KO)).toEqual({ kept: [], dropped: [] });
  });
});
