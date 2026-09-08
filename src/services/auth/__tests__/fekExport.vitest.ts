/**
 * `exportFEKRaw` rend une COPIE — patron de panne vécu, verrouillé ici.
 *
 * LE DÉFAUT. `exportFEKRaw` rendait `new Uint8Array(_fekRaw)`, c'est-à-dire une
 * VUE sur l'ArrayBuffer du module, pas une copie. Tout appelant qui effaçait
 * « sa » copie derrière lui — l'hygiène normale sur du matériel de clé —
 * mettait donc la FEK MAÎTRE à zéro. `collabKeys.getRoomKey` le fait
 * (`fek.fill(0)` dans son `finally`), donc la première note ouverte en session
 * de collaboration détruisait la FEK de la session.
 *
 * CE QUE ÇA CASSAIT. La clé importée (`_fek`, non extractible) restait valide,
 * donc le chiffrement de fichiers continuait de marcher : rien ne se voyait.
 * Mais tout le chemin CONTENEUR-FEK — le manifeste de synchronisation — se
 * mettait à chiffrer et déchiffrer avec 32 octets nuls : le cycle web levait au
 * déchiffrement du manifeste et le bouton de synchronisation passait au ROUGE,
 * sans aucun rapport apparent avec la collaboration.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// `hybridCrypto` pousse la clé de session au processus principal et lit les
// clés retirées : les deux passent par `window.electron`, référencé NU. Un
// objet vide suffit — les gardes `?.` font le reste.
beforeAll(() => {
  (globalThis as unknown as { window?: unknown }).window ??= {};
});

let importFEKRaw: (raw: Uint8Array) => Promise<void>;
let exportFEKRaw: () => Promise<Uint8Array | null>;
let getRoomKey: (noteId: string) => Promise<CryptoKey | null>;
let clearRoomKeys: () => void;

beforeAll(async () => {
  const hybrid = await import('../hybridCrypto');
  importFEKRaw = hybrid.importFEKRaw;
  exportFEKRaw = hybrid.exportFEKRaw;
  const keys = await import('../../collab/collabKeys');
  getRoomKey = keys.getRoomKey;
  clearRoomKeys = keys.clearRoomKeys;
});

/** FEK reconnaissable : aucun octet nul, donc un effacement se voit. */
const FEK = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const asArray = (bytes: Uint8Array | null): number[] => Array.from(bytes ?? []);

beforeEach(async () => {
  clearRoomKeys();
  await importFEKRaw(FEK);
});

describe('exportFEKRaw — la FEK maître survit à ses appelants', () => {
  it('rend des octets égaux à la FEK importée', async () => {
    expect(asArray(await exportFEKRaw())).toEqual(Array.from(FEK));
  });

  it("l'appelant qui efface sa copie ne touche pas à la FEK maître", async () => {
    const copie = await exportFEKRaw();
    copie!.fill(0); // exactement ce que fait `collabKeys.getRoomKey`

    expect(asArray(await exportFEKRaw())).toEqual(Array.from(FEK));
  });

  it('deux exports ne partagent pas leur mémoire', async () => {
    const a = await exportFEKRaw();
    const b = await exportFEKRaw();
    a!.fill(0);

    expect(asArray(b)).toEqual(Array.from(FEK));
  });

  it('dériver une clé de salle de collaboration ne vide pas la FEK', async () => {
    // LE SCÉNARIO EXACT DU DÉFAUT : ouvrir une note en session vivante.
    expect(await getRoomKey('note-42')).not.toBeNull();

    expect(asArray(await exportFEKRaw())).toEqual(Array.from(FEK));
  });

  it('la FEK reste intacte après plusieurs salles', async () => {
    await getRoomKey('note-1');
    await getRoomKey('note-2');
    await getRoomKey('note-3');

    expect(asArray(await exportFEKRaw())).toEqual(Array.from(FEK));
  });

  it('et la clé de salle dérivée reste celle de la VRAIE FEK', async () => {
    // Une FEK effacée ne se contentait pas de casser la sync : la salle
    // suivante aurait été chiffrée sous une clé dérivée de 32 octets nuls,
    // donc illisible pour l'appareil d'en face.
    const { deriveRoomKeyBits } = await import('../../collab/collabKeys');
    const attendu = await deriveRoomKeyBits(FEK, 'note-42');

    await getRoomKey('note-42'); // première dérivation : c'est elle qui effaçait
    const apres = await deriveRoomKeyBits((await exportFEKRaw())!, 'note-42');

    expect(Array.from(apres)).toEqual(Array.from(attendu));
  });
});
