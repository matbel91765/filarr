/**
 * SUPPRIMER UN FICHIER QUE WINDOWS TIENT ENCORE.
 *
 * Sous Windows, `unlink` répond `EPERM` tant qu'un descripteur reste ouvert
 * sur le fichier. Le porteur est presque toujours nous-mêmes — une lecture qui
 * vient de finir, un antivirus qui inspecte un fichier fraîchement écrit — et
 * il le rend en quelques millisecondes.
 *
 * Avant, la première erreur remontait : le vidage de la corbeille s'arrêtait
 * sur le premier fichier tenu en journalisant « Error permanently deleting
 * item », et la corbeille restait pleine sans explication.
 *
 * Deux garanties, et la seconde compte autant que la première : on réessaie,
 * mais on ne boucle pas sans fin. Un fichier réellement verrouillé par un
 * autre programme doit finir par lever, pour que l'appelant puisse le dire.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const echecs = { restants: 0, code: 'EPERM', appels: 0 };

vi.mock('fs/promises', async () => {
  const vrai = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  return {
    ...vrai,
    default: vrai,
    unlink: vi.fn(async (chemin: string) => {
      echecs.appels += 1;
      if (echecs.restants > 0) {
        echecs.restants -= 1;
        const err = new Error(`${echecs.code}: operation not permitted, unlink`) as NodeJS.ErrnoException;
        err.code = echecs.code;
        throw err;
      }
      return vrai.unlink(chemin);
    }),
  };
});

vi.mock('electron-log', () => ({ default: { warn: () => {}, error: () => {}, info: () => {} } }));

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { secureDeleteFile } from '../secureDelete';

let dossier = '';

async function fichier(nom: string, contenu = 'des octets'): Promise<string> {
  const chemin = path.join(dossier, nom);
  await fs.writeFile(chemin, contenu);
  return chemin;
}

beforeEach(async () => {
  dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'filarr-unlink-'));
  echecs.restants = 0;
  echecs.code = 'EPERM';
  echecs.appels = 0;
});

afterEach(async () => {
  echecs.restants = 0;
  await fs.rm(dossier, { recursive: true, force: true }).catch(() => undefined);
});

describe('le fichier tenu quelques instants', () => {
  it('finit par être supprimé après un EPERM passager', async () => {
    const chemin = await fichier('tenu.enc');
    echecs.restants = 1;

    await expect(secureDeleteFile(chemin)).resolves.toBeUndefined();
    expect(echecs.appels).toBe(2);
    await expect(fs.stat(chemin)).rejects.toBeTruthy();
  });

  it('survit à plusieurs refus successifs', async () => {
    const chemin = await fichier('bien-tenu.enc');
    echecs.restants = 3;

    await expect(secureDeleteFile(chemin)).resolves.toBeUndefined();
    await expect(fs.stat(chemin)).rejects.toBeTruthy();
  });

  it('traite EBUSY comme EPERM', async () => {
    const chemin = await fichier('occupe.enc');
    echecs.code = 'EBUSY';
    echecs.restants = 2;

    await expect(secureDeleteFile(chemin)).resolves.toBeUndefined();
  });
});

describe('ce qui doit quand même lever', () => {
  it('renonce après les tentatives prévues', async () => {
    // Verrouillé pour de bon : l'appelant DOIT l'apprendre, sinon la corbeille
    // se vide « avec succès » en laissant des fichiers derrière elle.
    const chemin = await fichier('verrouille.enc');
    echecs.restants = 99;

    await expect(secureDeleteFile(chemin)).rejects.toMatchObject({ code: 'EPERM' });
    // Une tentative initiale plus les trois attentes prévues : borné.
    expect(echecs.appels).toBe(4);
  });

  it('ne réessaie PAS une erreur qui ne vient pas d’un verrou', async () => {
    const chemin = await fichier('autre.enc');
    echecs.code = 'EACCES';
    echecs.restants = 99;

    await expect(secureDeleteFile(chemin)).rejects.toMatchObject({ code: 'EACCES' });
    expect(echecs.appels).toBe(1);
  });
});

describe('le fichier déjà parti', () => {
  it('un ENOENT n’est pas une erreur', async () => {
    await expect(
      secureDeleteFile(path.join(dossier, 'jamais-existe.enc'))
    ).resolves.toBeUndefined();
  });
});
