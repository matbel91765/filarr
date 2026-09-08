/**
 * LE CONTENEUR SURVIT À L'ÉDITION — et la mauvaise clé se voit.
 *
 * `saveEncryptedFile` réécrivait tout en v2 monobloc sous la clé MACHINE, sans
 * jamais regarder ce qu'il écrasait. Un fichier V3 édité perdait donc son
 * découpage, sa portabilité, et se retrouvait re-soumis au plafond de 500 Mo —
 * une perte de fonction invisible, que rien n'annonçait.
 *
 * Ces tests tiennent les deux moitiés de la règle qui remplace ça :
 *  · réécrire un V3 en V3, sous la MÊME clé ;
 *  · savoir RECONNAÎTRE que la clé n'est pas la bonne, pour pouvoir refuser
 *    plutôt que dégrader.
 *
 * Le deuxième point est le moins évident et le plus important : l'en-tête V3
 * se lit SANS la bonne clé. Seule l'authentification GCM d'un chunk tranche —
 * c'est pour ça que la sonde lit un octet au lieu de se fier à `open()`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  encryptBufferToFileV3,
  decryptFileToBufferV3,
  isV3File,
  V3FileReader,
} from '../streamCrypto';

let dossier = '';
const cleA = crypto.randomBytes(32);
const cleB = crypto.randomBytes(32);

beforeEach(async () => {
  dossier = await fs.mkdtemp(path.join(os.tmpdir(), 'filarr-v3-'));
});
afterEach(async () => {
  await fs.rm(dossier, { recursive: true, force: true }).catch(() => undefined);
});

const chemin = (nom: string) => path.join(dossier, nom);

/** La sonde de `StorageService.v3KeyFor`, reproduite à l'identique. */
async function ouvreAvec(cle: Buffer, fichier: string): Promise<boolean> {
  let lecteur: Awaited<ReturnType<typeof V3FileReader.open>> | null = null;
  try {
    lecteur = await V3FileReader.open(cle, fichier);
    if (lecteur.origSize > 0) await lecteur.read(0, 1);
    return true;
  } catch {
    return false;
  } finally {
    await lecteur?.close().catch(() => undefined);
  }
}

describe('reconnaître la clé d’un conteneur V3', () => {
  it('dit oui à la bonne clé', async () => {
    const f = chemin('a.bin');
    await encryptBufferToFileV3(cleA, Buffer.from('bonjour'), f);
    expect(await ouvreAvec(cleA, f)).toBe(true);
  });

  it('dit NON à une autre clé', async () => {
    const f = chemin('b.bin');
    await encryptBufferToFileV3(cleA, Buffer.from('bonjour'), f);
    expect(await ouvreAvec(cleB, f)).toBe(false);
  });

  it('OUVRIR NE PROUVE RIEN — c’est pourquoi la sonde lit un octet', async () => {
    // Vérifié sur le vrai code : `V3FileReader.open` avec une MAUVAISE clé
    // RÉUSSIT. Il valide l'en-tête et dérive une clé de fichier sans rien
    // authentifier. Se fier à lui ferait passer une mauvaise clé pour la
    // bonne, et l'enregistrement écrirait un conteneur que plus personne ne
    // saurait ouvrir. Ce test protège la sonde contre une « simplification »
    // qui retirerait la lecture.
    const f = chemin('preuve.bin');
    await encryptBufferToFileV3(cleA, Buffer.from('bonjour'), f);

    const lecteur = await V3FileReader.open(cleB, f);
    try {
      await expect(lecteur.read(0, 1)).rejects.toThrow();
    } finally {
      await lecteur.close().catch(() => undefined);
    }
  });

  it('dit non sur un fichier qui n’est pas du V3', async () => {
    const f = chemin('c.bin');
    await fs.writeFile(f, Buffer.from('v2:pas du tout un conteneur'));
    expect(await isV3File(f)).toBe(false);
    expect(await ouvreAvec(cleA, f)).toBe(false);
  });
});

describe('réécrire en préservant le conteneur', () => {
  it('un V3 réécrit reste un V3, lisible sous la même clé', async () => {
    const f = chemin('doc.bin');
    await encryptBufferToFileV3(cleA, Buffer.from('version 1'), f);
    expect(await isV3File(f)).toBe(true);

    // Ce que fait `saveBinaryPreservingContainer` : écrire à côté, renommer.
    const tmp = `${f}.tmp`;
    await encryptBufferToFileV3(cleA, Buffer.from('version 2 — plus longue'), tmp);
    await fs.rename(tmp, f);

    expect(await isV3File(f)).toBe(true);
    const relu = await decryptFileToBufferV3(cleA, f, 1024 * 1024);
    expect(relu.toString()).toBe('version 2 — plus longue');
  });

  it('supporte le contenu VIDE — un document qu’on vide reste ouvrable', async () => {
    // Un conteneur sans aucun chunk n'a rien à authentifier : la sonde ne doit
    // pas le déclarer illisible pour autant, sinon vider un fichier le rendrait
    // impossible à réenregistrer.
    const f = chemin('vide.bin');
    await encryptBufferToFileV3(cleA, Buffer.alloc(0), f);
    expect(await isV3File(f)).toBe(true);
    expect(await ouvreAvec(cleA, f)).toBe(true);
    expect((await decryptFileToBufferV3(cleA, f, 1024)).length).toBe(0);
  });

  it('traverse plusieurs chunks sans perdre un octet', async () => {
    // Au-delà d'un chunk, l'écriture et la relecture passent par le découpage :
    // c'est précisément ce que la dégradation en v2 monobloc faisait perdre.
    const gros = crypto.randomBytes(9 * 1024 * 1024);
    const f = chemin('gros.bin');
    await encryptBufferToFileV3(cleA, gros, f);
    const relu = await decryptFileToBufferV3(cleA, f, 32 * 1024 * 1024);
    expect(relu.equals(gros)).toBe(true);
  });
});
