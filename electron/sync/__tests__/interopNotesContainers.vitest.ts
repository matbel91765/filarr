/**
 * INTEROPÉRABILITÉ BUREAU ↔ WEB — vecteurs croisés sur les conteneurs d'objets
 * de note.
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 *
 * Un même coffre v2 peut être tenu par un ordinateur ET par un navigateur. Les
 * deux scellent les objets de note dans des familles DIFFÉRENTES :
 *
 *   · bureau → « v2: » + hex, PBKDF2-SHA-512 600 000 tours sur la clé machine,
 *     sel 16 o, IV 16 o, AES-256-GCM (`StorageService.encrypt`) ;
 *   · web    → marqueur(1) || IV(12) || AES-256-GCM sous la FEK
 *     (`hybridCrypto.encryptFileContent`).
 *
 * Aucun des deux ne lisait l'autre : les objets d'en face passaient pour
 * illisibles, donc pour ABSENTS, et la note écrite d'un côté n'arrivait jamais
 * de l'autre — sans la moindre erreur affichée.
 *
 * Les vecteurs sont construits ICI, à la main, d'après le format que chaque
 * écrivain produit. C'est délibéré : un test qui ferait écrire puis relire le
 * MÊME module ne prouverait qu'un aller-retour avec lui-même, et deux
 * implémentations fausses à l'identique y passeraient sans broncher.
 *
 * ⚠ CE FICHIER NE TIENT QU'UN SENS : « le bureau lit ce que le web scelle ».
 * L'autre sens vit dans
 * `src/platform/web/sync/__tests__/interopDesktopContainers.vitest.ts`, et il
 * ne peut pas vivre ici : `containerCrypto` s'appuie sur les types DOM de
 * WebCrypto, que `electron/tsconfig.json` (lib ES2020 + node) ne connaît pas.
 */
import { describe, it, expect } from 'vitest';
import * as crypto from 'crypto';
import zlib from 'zlib';

import { openWebFileContainer } from '../webContainerRead';

const OBJET = {
  id: 'note-42',
  title: 'Résiliation du bail',
  content: '<p>Envoyer la lettre avant le 30.</p>',
  updatedAt: '2026-09-03T10:00:00.000Z',
};

// ════════════════════════════════════════════════════════════════════════════
// Vecteur WEB → à lire par le BUREAU
// ════════════════════════════════════════════════════════════════════════════

/** Reproduit `hybridCrypto.encryptFileContent` À L'OCTET. */
async function sealWeb(
  value: unknown,
  fek: Buffer,
  opts: { compress?: boolean; legacy?: boolean } = {}
): Promise<Buffer> {
  const raw = Buffer.from(JSON.stringify(value), 'utf-8');
  const body = opts.compress ? Buffer.from(zlib.deflateSync(raw)) : raw;
  const iv = crypto.randomBytes(12);
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(fek),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );
  const ct = Buffer.from(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(body))
  );
  if (opts.legacy) return Buffer.concat([iv, ct]); // forme héritée, sans marqueur
  return Buffer.concat([Buffer.from([opts.compress ? 0x02 : 0x01]), iv, ct]);
}

describe('le BUREAU lit ce que le WEB scelle', () => {
  const fek = crypto.randomBytes(32);

  it('ouvre la forme marquée « clair » (0x01)', async () => {
    const bytes = await sealWeb(OBJET, fek);
    expect(bytes[0]).toBe(0x01);
    const plain = await openWebFileContainer(bytes, [fek]);
    expect(JSON.parse(plain.toString('utf-8'))).toEqual(OBJET);
  });

  it('ouvre la forme marquée « deflate » (0x02) et décompresse', async () => {
    const bytes = await sealWeb(OBJET, fek, { compress: true });
    expect(bytes[0]).toBe(0x02);
    const plain = await openWebFileContainer(bytes, [fek]);
    expect(JSON.parse(plain.toString('utf-8'))).toEqual(OBJET);
  });

  it('ouvre la forme HÉRITÉE, sans marqueur', async () => {
    const bytes = await sealWeb(OBJET, fek, { legacy: true });
    const plain = await openWebFileContainer(bytes, [fek]);
    expect(JSON.parse(plain.toString('utf-8'))).toEqual(OBJET);
  });

  /**
   * L'IV est uniformément aléatoire : environ un conteneur hérité sur cent
   * vingt-huit commence par 0x01 ou 0x02. Ce n'est PAS une heuristique sur les
   * octets qui tranche, c'est l'échec d'authentification GCM.
   */
  it('un conteneur hérité dont l IV commence par un octet de marqueur s ouvre quand même', async () => {
    // On force la collision : on refabrique jusqu'à ce que l'IV commence par
    // 0x01 ou 0x02, plutôt que d'attendre le hasard.
    let bytes: Buffer | null = null;
    for (let i = 0; i < 4000 && bytes === null; i += 1) {
      const candidate = await sealWeb(OBJET, fek, { legacy: true });
      if (candidate[0] === 0x01 || candidate[0] === 0x02) bytes = candidate;
    }
    if (!bytes) return; // extraordinairement improbable ; ne rien affirmer de faux
    const plain = await openWebFileContainer(bytes, [fek]);
    expect(JSON.parse(plain.toString('utf-8'))).toEqual(OBJET);
  });

  /**
   * Après une bascule de clé, tout objet antérieur n'ouvre que sous une clé
   * RETIRÉE. Ne garder que la clé active ferait passer pour illisibles
   * précisément les objets les plus anciens.
   */
  it('essaie les clés retirées après la clé active', async () => {
    const retiree = crypto.randomBytes(32);
    const bytes = await sealWeb(OBJET, retiree);
    await expect(openWebFileContainer(bytes, [fek])).rejects.toThrow();
    const plain = await openWebFileContainer(bytes, [fek, retiree]);
    expect(JSON.parse(plain.toString('utf-8'))).toEqual(OBJET);
  });

  it('refuse ce qui est trop court pour être un conteneur', async () => {
    await expect(openWebFileContainer(Buffer.alloc(10), [fek])).rejects.toThrow(/trop court/);
  });

  it('refuse quand aucune clé n est fournie', async () => {
    const bytes = await sealWeb(OBJET, fek);
    await expect(openWebFileContainer(bytes, [])).rejects.toThrow(/aucune clé/);
  });

  it('refuse un conteneur abîmé plutôt que de rendre du bruit', async () => {
    const bytes = await sealWeb(OBJET, fek);
    bytes[bytes.length - 1] ^= 0xff;
    await expect(openWebFileContainer(bytes, [fek])).rejects.toThrow();
  });
});
