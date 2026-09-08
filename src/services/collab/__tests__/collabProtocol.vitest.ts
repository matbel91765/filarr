import { describe, it, expect, beforeAll } from 'vitest';
import {
  COLLAB_HEADER_BYTES,
  COLLAB_IV_BYTES,
  COLLAB_MAGIC,
  COLLAB_PROTOCOL_VERSION,
  CollabControl,
  CollabFrameKind,
  buildControlFrame,
  decryptFrame,
  encryptFrame,
  readFrameHeader,
  toBytes,
} from '../collabProtocol';
import { deriveRoomKey } from '../collabKeys';

const FEK = new Uint8Array(32).fill(9);
let key: CryptoKey;
let otherKey: CryptoKey;

beforeAll(async () => {
  key = await deriveRoomKey(FEK, 'note-proto');
  otherKey = await deriveRoomKey(FEK, 'autre-note');
});

const payload = new TextEncoder().encode('le serveur ne doit jamais lire ceci');

describe('cadre binaire chiffré', () => {
  it('fait l’aller-retour', async () => {
    const frame = await encryptFrame(key, CollabFrameKind.Update, payload);
    const opened = await decryptFrame(key, frame);
    expect(opened?.kind).toBe(CollabFrameKind.Update);
    expect(new TextDecoder().decode(opened!.payload)).toBe('le serveur ne doit jamais lire ceci');
  });

  it('laisse l’en-tête lisible au relais et RIEN d’autre', async () => {
    const frame = await encryptFrame(key, CollabFrameKind.Snapshot, payload);
    const header = readFrameHeader(frame);
    expect(header).toEqual({ kind: CollabFrameKind.Snapshot, flags: 0 });
    expect(frame[0]).toBe(COLLAB_MAGIC);
    expect(frame[1]).toBe(COLLAB_PROTOCOL_VERSION);

    // Le clair n'apparaît nulle part dans la trame.
    const asText = new TextDecoder('latin1').decode(frame);
    expect(asText).not.toContain('serveur');
  });

  it('tire un IV neuf à chaque message — jamais de réutilisation', async () => {
    const a = await encryptFrame(key, CollabFrameKind.Update, payload);
    const b = await encryptFrame(key, CollabFrameKind.Update, payload);
    const ivA = a.slice(COLLAB_HEADER_BYTES, COLLAB_HEADER_BYTES + COLLAB_IV_BYTES);
    const ivB = b.slice(COLLAB_HEADER_BYTES, COLLAB_HEADER_BYTES + COLLAB_IV_BYTES);
    expect(Array.from(ivA)).not.toEqual(Array.from(ivB));
    // Chiffrés différents pour le même clair : pas de motif exploitable.
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('écarte une trame dont un octet de chiffré a bougé — sans lever', async () => {
    const frame = await encryptFrame(key, CollabFrameKind.Update, payload);
    frame[frame.length - 3] ^= 0x01;
    await expect(decryptFrame(key, frame)).resolves.toBeNull();
  });

  it('écarte une trame dont le TYPE a été retourné par le relais (l’en-tête est AAD)', async () => {
    const frame = await encryptFrame(key, CollabFrameKind.Update, payload);
    frame[2] = CollabFrameKind.Snapshot;
    await expect(decryptFrame(key, frame)).resolves.toBeNull();
  });

  it('écarte une trame chiffrée pour une AUTRE salle', async () => {
    const frame = await encryptFrame(otherKey, CollabFrameKind.Update, payload);
    await expect(decryptFrame(key, frame)).resolves.toBeNull();
  });

  it('écarte le bruit : trame vide, tronquée, mauvaise magie, version future', async () => {
    await expect(decryptFrame(key, new Uint8Array(0))).resolves.toBeNull();
    await expect(decryptFrame(key, new Uint8Array([1, 2, 3]))).resolves.toBeNull();

    const frame = await encryptFrame(key, CollabFrameKind.Update, payload);
    const badMagic = frame.slice();
    badMagic[0] = 0x00;
    await expect(decryptFrame(key, badMagic)).resolves.toBeNull();

    const futureVersion = frame.slice();
    futureVersion[1] = 0x02;
    await expect(decryptFrame(key, futureVersion)).resolves.toBeNull();

    const unknownKind = frame.slice();
    unknownKind[2] = 0x7f;
    await expect(decryptFrame(key, unknownKind)).resolves.toBeNull();

    await expect(decryptFrame(key, frame.slice(0, COLLAB_HEADER_BYTES + 4))).resolves.toBeNull();
  });

  it('lit une trame de contrôle du relais sans clé', async () => {
    const frame = buildControlFrame(CollabControl.ReplayDone);
    const opened = await decryptFrame(key, frame);
    expect(opened?.kind).toBe(CollabFrameKind.Control);
    expect(opened?.flags).toBe(CollabControl.ReplayDone);
  });

  it('normalise ce qu’un WebSocket peut livrer', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    expect(toBytes(src)).toBe(src);
    expect(Array.from(toBytes(src.buffer)!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(toBytes(new DataView(src.buffer))!)).toEqual([1, 2, 3, 4]);
    expect(toBytes('texte')).toBeNull();
    expect(toBytes(null)).toBeNull();
  });
});
