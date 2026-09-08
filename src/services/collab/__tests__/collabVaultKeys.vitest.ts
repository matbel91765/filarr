/**
 * Clé de salle du régime COFFRE.
 *
 * Ce que ces tests protègent vraiment, dans l'ordre :
 *   · LA SALLE NE SE PARTITIONNE PAS À L'ENREGISTREMENT. La clé dérive de
 *     K_vault, qui ne bouge pas d'une révision à l'autre — dériver de K_item
 *     (neuf à chaque enregistrement) donnait à chaque révision une clé
 *     différente, donc des pairs qui ne se lisaient plus dès la première
 *     sauvegarde. C'est le premier bloc ci-dessous, et il est écrit pour tomber
 *     si quelqu'un remet la révision dans la dérivation ;
 *   · la frontière entre les deux régimes : un même secret ne doit JAMAIS
 *     produire la même clé selon qu'on parle d'une note personnelle ou d'un
 *     élément de coffre.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hkdfSync } from 'node:crypto';
import {
  deriveVaultRoomKey,
  deriveVaultRoomKeyBits,
  deriveRoomKeyBits,
  getVaultRoomKey,
  clearRoomKeys,
  clearVaultRoomKeys,
  getRoomKey,
  roomKeyCount,
  VAULT_HKDF_INFO,
} from '../collabKeys';
import { encryptFrame, decryptFrame, CollabFrameKind } from '../collabProtocol';
import { vaultRoomId, parseVaultRoomId, isVaultRoomId, vaultRoomSalt } from '../collabRoom';
import { getVaultKey } from '../../vault/vaultKeyCache';
import { exportFEKRaw } from '../../auth/hybridCrypto';

vi.mock('../../vault/vaultKeyCache', () => ({
  getVaultKey: vi.fn(),
  isVaultUnlocked: vi.fn(),
  unlockVault: vi.fn(),
  lockVault: vi.fn(),
  clearVaultKeys: vi.fn(),
}));

vi.mock('../../auth/hybridCrypto', () => ({
  exportFEKRaw: vi.fn(),
}));

const K_VAULT = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const K_VAULT_NEXT_EPOCH = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
const FEK = new Uint8Array(32).fill(9);

const VAULT_ID = 'coffre-1';
const ITEM_ID = 'element-1';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

beforeEach(() => {
  clearRoomKeys();
  vi.mocked(getVaultKey).mockReset();
  vi.mocked(exportFEKRaw).mockReset();
  vi.mocked(exportFEKRaw).mockResolvedValue(FEK.slice());
});

afterEach(() => {
  clearRoomKeys();
});

// ============ LA SALLE SURVIT-ELLE À UN ENREGISTREMENT ? ============
//
// Le défaut d'origine tenait en une ligne : la clé dérivait de K_item, et
// `updateVaultItem` en fabrique un NEUF à chaque révision. Ces trois tests sont
// écrits pour tomber si la révision revient dans la dérivation, de quelque
// manière que ce soit.

describe('la clé de salle SURVIT à un enregistrement', () => {
  it('la révision n’entre pas dans la dérivation : la salle garde sa clé', async () => {
    // Le scénario exact du bug : Alice ouvre v3 et reste en salle ; quelqu'un
    // enregistre (v4, K_item neuf) ; Bob ouvre v4. Les deux DOIVENT se lire.
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    const avant = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });

    // L'enregistrement. Rien de ce qu'il change n'est une entrée d'ici : ni la
    // version, ni le wrap, ni K_item. Seul le cache est vidé, comme le ferait
    // une session ouverte plus tard sur une autre machine.
    clearRoomKeys();

    const apres = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    expect(avant).not.toBeNull();
    expect(apres).not.toBeNull();
    const frame = await encryptFrame(
      avant!,
      CollabFrameKind.Update,
      new TextEncoder().encode('écrit avant l’enregistrement')
    );
    const opened = await decryptFrame(apres!, frame);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!.payload)).toBe('écrit avant l’enregistrement');
  });

  it('la seule entrée secrète est K_vault : deux membres du coffre dérivent la même clé', async () => {
    // Deux membres n'ont RIEN d'autre en commun que K_vault — pas le même
    // appareil, pas le même compte, pas la même révision chargée.
    const alice = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
    const bob = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
    const frame = await encryptFrame(
      alice,
      CollabFrameKind.Update,
      new TextEncoder().encode('bonjour l’équipe')
    );
    const opened = await decryptFrame(bob, frame);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!.payload)).toBe('bonjour l’équipe');
  });

  it('DEUX ÉLÉMENTS du même coffre ont bien des clés DIFFÉRENTES', async () => {
    // C'est le sel qui fait ce travail depuis que K_item ne le fait plus : sans
    // lui, tous les éléments d'un coffre partageraient une seule clé.
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    const un = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    const deux = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: 'element-2', epoch: 1 });
    expect(un).not.toBeNull();
    expect(deux).not.toBeNull();
    const frame = await encryptFrame(un!, CollabFrameKind.Update, new Uint8Array([1]));
    expect(await decryptFrame(deux!, frame)).toBeNull();
  });
});

// ==================== Dérivation ====================

describe('dérivation de la clé de salle de coffre', () => {
  it('est déterministe : deux membres, même K_vault, même élément → même clé', async () => {
    const a = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    const b = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    expect(a.byteLength).toBe(32);
    expect(hex(a)).toBe(hex(b));
  });

  it('correspond octet pour octet à HKDF-SHA-256(K_vault, sel=vaultId:itemId, info=filarr-collab-vault-v1)', async () => {
    // Implémentation INDÉPENDANTE (node:crypto) : si WebCrypto et Node
    // divergent, c'est notre convention de dérivation qui est fausse.
    const expected = new Uint8Array(
      hkdfSync(
        'sha256',
        K_VAULT,
        Buffer.from(`${VAULT_ID}:${ITEM_ID}`, 'utf8'),
        Buffer.from(VAULT_HKDF_INFO, 'utf8'),
        32
      )
    );
    const actual = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    expect(hex(actual)).toBe(hex(expected));
    expect(vaultRoomSalt(VAULT_ID, ITEM_ID)).toBe(`${VAULT_ID}:${ITEM_ID}`);
  });

  it('LA SÉPARATION DES RÉGIMES : le même secret ne donne pas la même clé en personnel et en coffre', async () => {
    // Le sel est délibérément identique des deux côtés, pour que le SEUL écart
    // testé soit l'étiquette HKDF. C'est elle qui sépare les deux mondes.
    const salt = vaultRoomSalt(VAULT_ID, ITEM_ID);
    const personnel = await deriveRoomKeyBits(K_VAULT, salt);
    const coffre = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    expect(hex(personnel)).not.toBe(hex(coffre));
  });

  it('isole les salles : un autre élément du même coffre donne une autre clé', async () => {
    const a = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    const b = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, 'element-2');
    expect(hex(a)).not.toBe(hex(b));
  });

  it('isole les coffres : le même identifiant d’élément dans un autre coffre diffère', async () => {
    const a = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    const b = await deriveVaultRoomKeyBits(K_VAULT, 'coffre-2', ITEM_ID);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('isole les époques : une K_vault rescellée donne une clé différente', async () => {
    const a = await deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, ITEM_ID);
    const b = await deriveVaultRoomKeyBits(K_VAULT_NEXT_EPOCH, VAULT_ID, ITEM_ID);
    expect(hex(a)).not.toBe(hex(b));
  });

  it('refuse un secret vide ou des identifiants absents', async () => {
    await expect(deriveVaultRoomKeyBits(new Uint8Array(0), VAULT_ID, ITEM_ID)).rejects.toThrow();
    await expect(deriveVaultRoomKeyBits(K_VAULT, '', ITEM_ID)).rejects.toThrow();
    await expect(deriveVaultRoomKeyBits(K_VAULT, VAULT_ID, '')).rejects.toThrow();
  });

  it('importe une clé NON EXPORTABLE', async () => {
    const key = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('un membre d’un autre élément ne peut PAS lire cette salle', async () => {
    const ici = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
    const ailleurs = await deriveVaultRoomKey(K_VAULT, VAULT_ID, 'element-2');
    const frame = await encryptFrame(ici, CollabFrameKind.Update, new TextEncoder().encode('x'));
    expect(await decryptFrame(ailleurs, frame)).toBeNull();
  });

  it('n’efface PAS le secret qu’on lui prête — ce serait verrouiller le coffre', async () => {
    // K_vault vient du cache mémoire des coffres : la zéroïser ici rendrait
    // illisible tout le contenu du coffre à la première ouverture de salle.
    const secret = K_VAULT.slice();
    await deriveVaultRoomKey(secret, VAULT_ID, ITEM_ID);
    expect(hex(secret)).toBe(hex(K_VAULT));
  });
});

// ==================== Façade ====================

describe('getVaultRoomKey — le chemin que prend l’éditeur', () => {
  it('rend null quand le coffre est verrouillé, SANS lever', async () => {
    vi.mocked(getVaultKey).mockReturnValue(null);
    await expect(
      getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 })
    ).resolves.toBeNull();
  });

  it('prend K_vault à l’époque de la révision chargée, pas à la courante', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    const key = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 3 });
    expect(key).not.toBeNull();
    // Elle doit être EXACTEMENT celle que dérive un membre tenant K_vault.
    const reference = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
    const frame = await encryptFrame(reference, CollabFrameKind.Update, new Uint8Array([1, 2, 3]));
    const opened = await decryptFrame(key!, frame);
    expect(opened?.payload).toEqual(new Uint8Array([1, 2, 3]));
    expect(vi.mocked(getVaultKey)).toHaveBeenCalledWith(VAULT_ID, 3);
  });

  it('re-dérive quand le coffre est RESCELLÉ — jamais une clé périmée en silence', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    const k1 = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT_NEXT_EPOCH);
    const k2 = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 2 });
    expect(k1).not.toBeNull();
    expect(k2).not.toBeNull();
    // Un rescellement, c'est une révocation : les deux clés ne se lisent pas.
    const frame = await encryptFrame(k1!, CollabFrameKind.Update, new Uint8Array([9]));
    expect(await decryptFrame(k2!, frame)).toBeNull();
  });

  it('rend la MÊME clé tant que l’époque ne bouge pas (cache mémoire)', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    const a = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    const b = await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    expect(a).toBe(b);
    expect(vi.mocked(getVaultKey)).toHaveBeenCalledTimes(1);
  });

  it('rend null sur des identifiants qui ne composent pas un nom de salle', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    await expect(
      getVaultRoomKey({ vaultId: 'coffre:1', itemId: ITEM_ID, epoch: 1 })
    ).resolves.toBeNull();
    await expect(
      getVaultRoomKey({ vaultId: VAULT_ID, itemId: 'element/1', epoch: 1 })
    ).resolves.toBeNull();
  });
});

// ==================== Purge par coffre ====================

describe('clearVaultRoomKeys — le pendant de lockVault', () => {
  it('oublie les salles du coffre visé, et RIEN d’autre', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    await getVaultRoomKey({ vaultId: VAULT_ID, itemId: ITEM_ID, epoch: 1 });
    await getVaultRoomKey({ vaultId: VAULT_ID, itemId: 'element-2', epoch: 1 });
    await getVaultRoomKey({ vaultId: 'coffre-2', itemId: ITEM_ID, epoch: 1 });
    await getRoomKey('note-personnelle');
    expect(roomKeyCount()).toBe(4);

    clearVaultRoomKeys(VAULT_ID);

    // Les deux salles du coffre verrouillé sont parties ; l'autre coffre et la
    // note personnelle continuent leur vie.
    expect(roomKeyCount()).toBe(2);
    expect(await getRoomKey('note-personnelle')).not.toBeNull();
  });

  it('ne confond pas deux coffres dont l’identifiant est un préfixe de l’autre', async () => {
    vi.mocked(getVaultKey).mockReturnValue(K_VAULT);
    await getVaultRoomKey({ vaultId: 'coffre', itemId: ITEM_ID, epoch: 1 });
    await getVaultRoomKey({ vaultId: 'coffre-2', itemId: ITEM_ID, epoch: 1 });
    clearVaultRoomKeys('coffre');
    expect(roomKeyCount()).toBe(1);
  });
});

// ==================== Identité de salle ====================

describe('identité de salle', () => {
  it('compose et redécompose sans ambiguïté', () => {
    const id = vaultRoomId(VAULT_ID, ITEM_ID);
    expect(id).toBe(`vault:${VAULT_ID}:${ITEM_ID}`);
    expect(parseVaultRoomId(id)).toEqual({ vaultId: VAULT_ID, itemId: ITEM_ID });
    expect(isVaultRoomId(id)).toBe(true);
  });

  it('ne confond jamais une note personnelle avec une salle de coffre', () => {
    expect(parseVaultRoomId('7f1c9a2e-2f4b-4a1e-9c3d-0b6a5d8e1f22')).toBeNull();
    expect(isVaultRoomId('note-42')).toBe(false);
  });

  it('refuse des identifiants qui rendraient le nom ambigu', () => {
    expect(() => vaultRoomId('coffre:1', ITEM_ID)).toThrow();
    expect(() => vaultRoomId(VAULT_ID, 'element/1')).toThrow();
    expect(() => vaultRoomId('', ITEM_ID)).toThrow();
    expect(parseVaultRoomId('vault:coffre')).toBeNull();
  });
});
