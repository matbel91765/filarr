/**
 * INTEROPÉRABILITÉ BUREAU → WEB — vecteurs croisés sur les conteneurs d'objets
 * de note.
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 *
 * Un même coffre v2 peut être tenu par un ordinateur ET par un navigateur, et
 * les deux scellent dans des familles DIFFÉRENTES :
 *
 *   · bureau → « v2: » + hex, PBKDF2-SHA-512 600 000 tours sur la clé machine,
 *     sel 16 o, IV 16 o, AES-256-GCM (`StorageService.encrypt`) ;
 *   · web    → marqueur(1) || IV(12) || AES-256-GCM sous la FEK
 *     (`hybridCrypto.encryptFileContent`).
 *
 * Aucun des deux ne lisait l'autre : les objets d'en face passaient pour
 * illisibles, donc pour ABSENTS, et la note écrite sur l'ordinateur
 * n'apparaissait jamais dans le navigateur — sans la moindre erreur affichée.
 *
 * ⚠ CE FICHIER NE TIENT QU'UN SENS. L'autre — « le bureau lit ce que le web
 * scelle » — vit dans `electron/sync/__tests__/interopNotesContainers.vitest.ts`,
 * et les deux ne peuvent pas cohabiter : `containerCrypto` s'appuie sur les
 * types DOM de WebCrypto, que la compilation du processus principal ignore.
 *
 * Le vecteur est construit ICI, à la main, d'après le format que
 * `StorageService.encrypt` produit. C'est délibéré : un test qui ferait écrire
 * puis relire le MÊME module ne prouverait qu'un aller-retour avec lui-même.
 */
import { describe, it, expect } from 'vitest';
import * as nodeCrypto from 'crypto';

import { decryptMachineContainerText } from '../containerCrypto';

const OBJET = {
  id: 'note-42',
  title: 'Résiliation du bail',
  content: '<p>Envoyer la lettre avant le 30.</p>',
  updatedAt: '2026-09-03T10:00:00.000Z',
};

/**
 * Reproduit `StorageService.encrypt` À L'OCTET :
 *
 *     "v2:" + selHex(16 o) + ivHex(16 o) + chiffréHex + tagHex(16 o)
 *
 * clé dérivée par PBKDF2-SHA-512, 600 000 tours, sur les OCTETS BRUTS de la clé
 * machine. Noter l'IV de SEIZE octets — pas douze : c'est le piège documenté du
 * pack de vecteurs, et c'est ce que le bureau écrit depuis toujours.
 */
function sealDesktop(value: unknown, machineKey: Buffer, marker: 'v1:' | 'v2:' = 'v2:'): string {
  const iv = nodeCrypto.randomBytes(16);
  const salt = nodeCrypto.randomBytes(16);
  const rounds = marker === 'v2:' ? 600_000 : 10_000;
  const derived = nodeCrypto.pbkdf2Sync(machineKey, salt, rounds, 32, 'sha512');
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', derived, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]).toString('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${marker}${salt.toString('hex')}${iv.toString('hex')}${body}${tag}`;
}

describe('le WEB lit ce que le BUREAU scelle', () => {
  const machineKey = nodeCrypto.randomBytes(32);

  it('ouvre un conteneur « v2: » écrit par l ordinateur', async () => {
    const container = sealDesktop(OBJET, machineKey);
    expect(container.startsWith('v2:')).toBe(true);
    expect(await decryptMachineContainerText(container, new Uint8Array(machineKey))).toEqual(OBJET);
  });

  /** Les profils anciens portent encore du « v1: » — 10 000 tours. */
  it('ouvre aussi la forme « v1: », héritée', async () => {
    const container = sealDesktop(OBJET, machineKey, 'v1:');
    expect(await decryptMachineContainerText(container, new Uint8Array(machineKey))).toEqual(OBJET);
  });

  it('refuse le conteneur sous une AUTRE clé machine', async () => {
    const container = sealDesktop(OBJET, machineKey);
    await expect(
      decryptMachineContainerText(container, new Uint8Array(nodeCrypto.randomBytes(32)))
    ).rejects.toThrow();
  });

  /**
   * Le piège documenté du pack de vecteurs : la clé machine voyage en base64
   * dans le manifeste, et il faut la DÉCODER avant de dériver. Dériver sur les
   * caractères base64 produit une clé différente, donc un refus.
   */
  it('la clé doit être décodée depuis base64, pas dérivée sur le texte', async () => {
    const container = sealDesktop(OBJET, machineKey);
    const b64 = machineKey.toString('base64');
    await expect(
      decryptMachineContainerText(container, new TextEncoder().encode(b64))
    ).rejects.toThrow();
  });

  it('refuse un conteneur abîmé plutôt que de rendre du bruit', async () => {
    const container = sealDesktop(OBJET, machineKey);
    const abime = `${container.slice(0, -2)}${container.slice(-2) === 'ff' ? '00' : 'ff'}`;
    await expect(decryptMachineContainerText(abime, new Uint8Array(machineKey))).rejects.toThrow();
  });
});

// ── Bureau v3 → web ──────────────────────────────────────────────────────────
//
// Même exigence que pour `v2:` : le conteneur est construit ICI, à la main,
// d'après le contrat (HKDF-SHA-256 sur la clé machine, info "filarr-container-v3",
// disposition inchangée), pas par le module qu'on teste.

describe('interop bureau → web : conteneur clé machine v3 (HKDF)', () => {
  function scelleV3Bureau(value: unknown, machineKey: Buffer): string {
    const salt = nodeCrypto.randomBytes(16);
    const iv = nodeCrypto.randomBytes(16);
    const key = Buffer.from(
      nodeCrypto.hkdfSync('sha256', machineKey, salt, 'filarr-container-v3', 32)
    );
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return (
      'v3:' +
      salt.toString('hex') +
      iv.toString('hex') +
      ct.toString('hex') +
      cipher.getAuthTag().toString('hex')
    );
  }

  it('le web ouvre un objet de note scellé en v3 par le bureau', async () => {
    const machineKey = nodeCrypto.randomBytes(32);
    const container = scelleV3Bureau(OBJET, machineKey);
    expect(await decryptMachineContainerText(container, Uint8Array.from(machineKey))).toEqual(
      OBJET
    );
  });

  it('un v3 ouvert avec la mauvaise clé, ou relabellisé v2, est refusé', async () => {
    const machineKey = nodeCrypto.randomBytes(32);
    const container = scelleV3Bureau(OBJET, machineKey);
    await expect(
      decryptMachineContainerText(container, Uint8Array.from(nodeCrypto.randomBytes(32)))
    ).rejects.toThrow();
    await expect(
      decryptMachineContainerText('v2:' + container.slice(3), Uint8Array.from(machineKey))
    ).rejects.toThrow();
  });
});
