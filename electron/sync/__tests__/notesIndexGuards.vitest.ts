/**
 * Les deux gardes de l'index v2 : la FORME (ce qui autorise à conclure) et le
 * REPORT des champs d'appareil (ce qui survit à une réécriture).
 */
import { describe, it, expect } from 'vitest';
import {
  isNotesIndexShape,
  carryIndexDeviceFields,
  normalizeIndex,
  type NotesIndex,
} from '../notesStoreV2';
import { loadVaultV2, saveVaultV2, type VaultIO } from '../notesVaultStore';

// ── Un disque en mémoire, assez pour ces deux règles ────────────────────────

function memoryIO(seed: Record<string, unknown> = {}): VaultIO & {
  files: Record<string, unknown>;
} {
  const files: Record<string, unknown> = { ...seed };
  return {
    files,
    async read(rel: string) {
      return Object.prototype.hasOwnProperty.call(files, rel) ? (files[rel] as never) : null;
    },
    async write(rel: string, value: unknown) {
      files[rel] = JSON.parse(JSON.stringify(value));
    },
    async remove(rel: string) {
      delete files[rel];
    },
    async stat() {
      return null;
    },
  } as unknown as VaultIO & { files: Record<string, unknown> };
}

const splitDeps = () => {
  let n = 0;
  return {
    newObjectId: () => `obj${(n += 1)}`,
    digestOf: (value: unknown) => JSON.stringify(value),
  };
};

describe('isNotesIndexShape', () => {
  it('accepte un index v2, même vide', () => {
    expect(isNotesIndexShape({ version: 2, notes: {} })).toBe(true);
    expect(isNotesIndexShape(normalizeIndex({}))).toBe(true);
  });

  /**
   * LA RÉGRESSION. `normalizeIndex` rend un index VIDE ET VALIDE pour
   * n'importe quel objet — d'où deux conclusions fausses : « le nuage ne porte
   * plus rien » et « ce disque n'a aucune note ».
   */
  const REFUSES: Array<[string, unknown]> = [
    ['un objet vide', {}],
    ['un objet de NOTE', { id: 'n1', title: 'Une note' }],
    ['un index v1', { version: 1, notes: {} }],
    ['un index sans carte de notes', { version: 2 }],
    ['une carte de notes qui est un tableau', { version: 2, notes: [] }],
    ['une version qui est une chaîne', { version: '2', notes: {} }],
    ['null', null],
    ['du JSON pas encore analysé', '{"version":2}'],
    ['un tableau', []],
  ];

  it.each(REFUSES)('refuse %s', (_quoi, input) => {
    expect(isNotesIndexShape(input)).toBe(false);
    // Et pourtant `normalizeIndex` en ferait un index parfaitement valide :
    // c'est exactement le piège.
    expect(normalizeIndex(input).version).toBe(2);
  });
});

describe('loadVaultV2', () => {
  it('rend null quand il n y a pas d index — un profil neuf', async () => {
    expect(await loadVaultV2(memoryIO())).toBeNull();
  });

  it('REFUSE de lire un index qui n a pas la forme, au lieu de rendre un coffre vide', async () => {
    const io = memoryIO({ 'notes/index.enc': { bidule: true } });
    await expect(loadVaultV2(io)).rejects.toThrow(/forme d'un index v2/);
  });
});

describe('carryIndexDeviceFields', () => {
  const previous: NotesIndex = {
    ...normalizeIndex({}),
    blobs: { aaa: '2026-01-01T00:00:00.000Z' },
    blobTombstones: { bbb: '2026-02-01T00:00:00.000Z' },
    blobSweepAt: '2026-03-01T00:00:00.000Z',
    legacyStamp: 'taille:date',
    legacyDigest: 'empreinte',
  };

  it('reporte les cinq champs que splitVault ne peut pas connaître', () => {
    const out = carryIndexDeviceFields(normalizeIndex({}), previous);
    expect(out.blobs).toEqual(previous.blobs);
    expect(out.blobTombstones).toEqual(previous.blobTombstones);
    expect(out.blobSweepAt).toBe(previous.blobSweepAt);
    expect(out.legacyStamp).toBe(previous.legacyStamp);
    expect(out.legacyDigest).toBe(previous.legacyDigest);
  });

  it('ne sème pas un champ que l index source ne portait pas', () => {
    const out = carryIndexDeviceFields(normalizeIndex({}), normalizeIndex({}));
    expect('blobs' in out).toBe(false);
    expect('legacyStamp' in out).toBe(false);
    expect('blobSweepAt' in out).toBe(false);
  });

  it('sans index précédent, rend le neuf tel quel', () => {
    const fresh = normalizeIndex({});
    expect(carryIndexDeviceFields(fresh, null)).toBe(fresh);
  });

  it('respecte un legacyStamp explicitement mis à null', () => {
    const out = carryIndexDeviceFields(normalizeIndex({}), {
      ...normalizeIndex({}),
      legacyStamp: null,
    });
    expect(out.legacyStamp).toBeNull();
    expect('legacyStamp' in out).toBe(true);
  });
});

describe('saveVaultV2 — le registre des images survit à une sauvegarde', () => {
  /**
   * LA RÉGRESSION. `splitVault` fabrique un index NEUF depuis la charge utile :
   * il ne peut pas connaître `blobs` & consorts, qui vivent dans l'index. Chaque
   * sauvegarde les effaçait — le registre des images publiées repartait à zéro,
   * et le blob v1 était relu et réécrit à chaque cycle.
   */
  it('reporte blobs, blobTombstones, blobSweepAt, legacyStamp et legacyDigest', async () => {
    const io = memoryIO();
    const previous: NotesIndex = {
      ...normalizeIndex({}),
      notes: {
        n1: {
          objectId: 'obj1',
          updatedAt: '2026-01-01T00:00:00.000Z',
          deletedAt: null,
          digest: 'x',
          syncedDigest: null,
        },
      },
      allIds: ['n1'],
      blobs: { aaa: '2026-01-01T00:00:00.000Z' },
      blobTombstones: { bbb: '2026-02-01T00:00:00.000Z' },
      blobSweepAt: '2026-03-01T00:00:00.000Z',
      legacyStamp: 'taille:date',
      legacyDigest: 'empreinte',
    };

    const res = await saveVaultV2(
      io,
      { byId: { n1: { id: 'n1', updatedAt: '2026-01-02T00:00:00.000Z' } }, allIds: ['n1'] } as never,
      splitDeps(),
      previous
    );

    expect(res.index.blobs).toEqual({ aaa: '2026-01-01T00:00:00.000Z' });
    expect(res.index.blobTombstones).toEqual({ bbb: '2026-02-01T00:00:00.000Z' });
    expect(res.index.blobSweepAt).toBe('2026-03-01T00:00:00.000Z');
    expect(res.index.legacyStamp).toBe('taille:date');
    expect(res.index.legacyDigest).toBe('empreinte');
    // Et l'index ÉCRIT les porte aussi, pas seulement celui qu'on rend.
    expect((io.files['notes/index.enc'] as NotesIndex).blobs).toEqual({
      aaa: '2026-01-01T00:00:00.000Z',
    });
  });

  it('n invente rien quand le précédent n en portait pas', async () => {
    const io = memoryIO();
    const res = await saveVaultV2(
      io,
      { byId: { n1: { id: 'n1' } }, allIds: ['n1'] } as never,
      splitDeps(),
      normalizeIndex({})
    );
    expect('blobs' in res.index).toBe(false);
    expect('legacyStamp' in res.index).toBe(false);
  });
});
