import { describe, it, expect } from 'vitest';
import { hkdfSync } from 'node:crypto';
import { deriveRoomKeyBits, deriveRoomKey } from '../collabKeys';
import { encryptFrame, decryptFrame, CollabFrameKind } from '../collabProtocol';

const FEK = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
const OTHER_FEK = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('dérivation de la clé de salle', () => {
  it('est déterministe : deux appareils, même FEK, même note → même clé', async () => {
    const a = await deriveRoomKeyBits(FEK, 'note-42');
    const b = await deriveRoomKeyBits(FEK, 'note-42');
    expect(a.byteLength).toBe(32);
    expect(hex(a)).toBe(hex(b));
  });

  it('correspond octet pour octet à HKDF-SHA-256(FEK, sel=noteId, info=filarr-collab-v1)', async () => {
    // Implémentation INDÉPENDANTE (node:crypto) : si WebCrypto et Node
    // divergent, c'est notre convention de dérivation qui est fausse.
    const expected = new Uint8Array(
      hkdfSync(
        'sha256',
        FEK,
        Buffer.from('note-42', 'utf8'),
        Buffer.from('filarr-collab-v1', 'utf8'),
        32
      )
    );
    const actual = await deriveRoomKeyBits(FEK, 'note-42');
    expect(hex(actual)).toBe(hex(expected));
  });

  it('isole les salles : une note différente donne une clé différente', async () => {
    const a = await deriveRoomKeyBits(FEK, 'note-42');
    const b = await deriveRoomKeyBits(FEK, 'note-43');
    expect(hex(a)).not.toBe(hex(b));
  });

  it('isole les comptes : une FEK différente donne une clé différente', async () => {
    const a = await deriveRoomKeyBits(FEK, 'note-42');
    const b = await deriveRoomKeyBits(OTHER_FEK, 'note-42');
    expect(hex(a)).not.toBe(hex(b));
  });

  it('refuse un secret vide ou un noteId absent', async () => {
    await expect(deriveRoomKeyBits(new Uint8Array(0), 'note-42')).rejects.toThrow();
    await expect(deriveRoomKeyBits(FEK, '')).rejects.toThrow();
  });

  it('importe une clé NON EXPORTABLE — elle ne peut pas quitter la mémoire', async () => {
    const key = await deriveRoomKey(FEK, 'note-42');
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
  });

  it('deux appareils dérivant séparément peuvent se lire', async () => {
    const desktop = await deriveRoomKey(FEK, 'note-42');
    const web = await deriveRoomKey(FEK, 'note-42');
    const frame = await encryptFrame(
      desktop,
      CollabFrameKind.Update,
      new TextEncoder().encode('bonjour')
    );
    const opened = await decryptFrame(web, frame);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!.payload)).toBe('bonjour');
  });
});
