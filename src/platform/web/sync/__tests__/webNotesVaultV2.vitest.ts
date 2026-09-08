/**
 * CONTRATS DU COFFRE v2 DU NAVIGATEUR — écrire en v2 depuis le web.
 *
 * Le web pouvait lire, synchroniser et (depuis peu) migrer un coffre v2, mais
 * il continuait d'ÉCRIRE en v1 : chaque sauvegarde réécrivait `notes_enc` en
 * entier. Un profil migré depuis le navigateur obtenait la compatibilité v2,
 * pas son gain. Ce fichier garde le chemin d'écriture v2 et ce qui le rend sûr.
 */

import { describe, expect, it } from 'vitest';

import {
  extractIntoWebStore,
  inlineFromWebStore,
  loadWebVaultV2,
  saveWebVaultV2,
  webBlobHash,
} from '../webNotesVaultV2';
import { NOTES_DIR, NOTES_INDEX_FILENAME, type NotesIndex } from '../notesStoreV2';
import { BLOB_REF_PREFIX } from '../noteBlobs';
import type { VaultIO } from '../notesVaultStore';

const INDEX_PATH = `${NOTES_DIR}/${NOTES_INDEX_FILENAME}`;
const OCTETS = 'QUJDREVGR0hJSktMTU5PUA==';
const T0 = '2026-01-01T00:00:00.000Z';

class FauxDisque implements VaultIO {
  files = new Map<string, unknown>();
  writes: string[] = [];
  async read(p: string): Promise<unknown | null> {
    const v = this.files.get(p);
    return v === undefined ? null : structuredClone(v);
  }
  async write(p: string, plain: unknown): Promise<void> {
    this.files.set(p, structuredClone(plain));
    this.writes.push(p);
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const k of this.files.keys()) {
      if (k.startsWith(`${dir}/`)) out.push(k.slice(dir.length + 1));
    }
    return out;
  }
}

/** Une note telle que le renderer l'écrit : le document est une CHAÎNE. */
const vraieNote = (id: string, b64: string | null = OCTETS) => ({
  id,
  title: `Note ${id}`,
  createdAt: T0,
  updatedAt: T0,
  content: JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'bonjour' }] },
      ...(b64
        ? [
            {
              type: 'fileEmbed',
              attrs: { fileType: 'image/png', src: `data:image/png;base64,${b64}` },
            },
          ]
        : []),
    ],
  }),
});

const coffre = (notes: Array<ReturnType<typeof vraieNote>>) => ({
  byId: Object.fromEntries(notes.map((n) => [n.id, n])),
  allIds: notes.map((n) => n.id),
  templates: [],
  notebooks: {},
});

describe('sortir les images, dans le navigateur', () => {
  it('pose l’image dans le magasin et laisse une référence dans la note', async () => {
    const io = new FauxDisque();
    const { payload, extracted } = await extractIntoWebStore(io, coffre([vraieNote('a')]));

    expect(extracted).toBe(1);
    const hash = await webBlobHash(OCTETS);
    expect(io.files.get(`${NOTES_DIR}/blobs/${hash}.enc`)).toBe(OCTETS);
    const contenu = (payload.byId as Record<string, { content: string }>).a.content;
    expect(contenu).toContain(`${BLOB_REF_PREFIX}${hash}`);
    expect(contenu).not.toContain(OCTETS);
  });

  it('une note sans image repart INTACTE, sans un parcours de plus', async () => {
    const io = new FauxDisque();
    const source = coffre([vraieNote('a', null)]);
    const { payload, extracted } = await extractIntoWebStore(io, source);
    expect(extracted).toBe(0);
    expect(payload).toEqual(source);
    expect(io.writes).toEqual([]);
  });

  it('la même image dans deux notes n’est écrite qu’une fois', async () => {
    const io = new FauxDisque();
    await extractIntoWebStore(io, coffre([vraieNote('a'), vraieNote('b')]));
    expect(io.writes).toHaveLength(1);
  });

  it('aller-retour : réinsérer rend le document de départ', async () => {
    const io = new FauxDisque();
    const source = coffre([vraieNote('a')]);
    const { payload } = await extractIntoWebStore(io, source);
    const { payload: rendu, missing } = await inlineFromWebStore(io, payload);
    expect(missing).toBe(0);
    const a = (rendu.byId as Record<string, { content: string }>).a;
    expect(JSON.parse(a.content)).toEqual(JSON.parse(vraieNote('a').content));
  });

  /** L'empreinte est un identifiant partagé avec le bureau : elle doit être
   *  stable, hexadécimale, et de la longueur attendue par la garde de chemin. */
  it('l’empreinte a la forme que la garde de chemin accepte', async () => {
    const h = await webBlobHash(OCTETS);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
    expect(await webBlobHash(OCTETS)).toBe(h);
  });
});

describe('écrire et relire le coffre v2 du navigateur', () => {
  it('écrit les objets, puis l’index ; relit le tout, images en ligne', async () => {
    const io = new FauxDisque();
    const res = await saveWebVaultV2(io, coffre([vraieNote('a'), vraieNote('b', null)]), null);

    expect(Object.keys(res.index.notes).sort()).toEqual(['a', 'b']);
    expect(io.writes[io.writes.length - 1]).toBe(INDEX_PATH);

    const charge = await loadWebVaultV2(io);
    expect(charge?.missing).toEqual([]);
    const a = (charge!.payload.byId as Record<string, { content: string }>).a;
    expect(a.content).toContain(`data:image/png;base64,${OCTETS}`);
  });

  it('une seconde écriture identique ne réécrit AUCUN objet', async () => {
    const io = new FauxDisque();
    const premiere = await saveWebVaultV2(io, coffre([vraieNote('a')]), null);
    io.writes = [];
    const seconde = await saveWebVaultV2(io, coffre([vraieNote('a')]), premiere.index);
    expect(seconde.written).toEqual([]);
  });

  /**
   * LE GAIN, PROUVÉ : éditer le TEXTE d'une note illustrée ne réécrit que la
   * note — jamais l'image, qui est immuable et déjà dans le magasin.
   */
  it('éditer le texte réécrit la note, pas l’image', async () => {
    const io = new FauxDisque();
    const premiere = await saveWebVaultV2(io, coffre([vraieNote('a')]), null);
    io.writes = [];
    const modifiee = {
      ...vraieNote('a'),
      title: 'AUTRE TITRE',
      updatedAt: '2026-09-02T00:00:00.000Z',
    };
    await saveWebVaultV2(io, coffre([modifiee]), premiere.index);
    expect(io.writes.filter((w) => w.includes('/blobs/'))).toEqual([]);
    expect(io.writes.filter((w) => w !== INDEX_PATH)).toHaveLength(1);
  });

  /** Même refus qu'au bureau : écrire un coffre auquel il manque des notes les
   *  effacerait de l'index, donc du nuage, donc de tous les appareils. */
  it('refuse d’écrire quand des notes n’ont pas pu être relues', async () => {
    const io = new FauxDisque();
    await expect(saveWebVaultV2(io, coffre([vraieNote('a')]), null, ['x'])).rejects.toThrow(
      /refusée/
    );
    expect(io.writes).toEqual([]);
  });

  it('un profil qui n’est pas en v2 rend null', async () => {
    expect(await loadWebVaultV2(new FauxDisque())).toBeNull();
  });

  it('une image introuvable est signalée, jamais effacée', async () => {
    const io = new FauxDisque();
    await saveWebVaultV2(io, coffre([vraieNote('a')]), null);
    const hash = await webBlobHash(OCTETS);
    io.files.delete(`${NOTES_DIR}/blobs/${hash}.enc`);
    const charge = await loadWebVaultV2(io);
    const a = (charge!.payload.byId as Record<string, { content: string }>).a;
    expect(a.content).toContain(`${BLOB_REF_PREFIX}${hash}`);
    const index = io.files.get(INDEX_PATH) as NotesIndex;
    expect(index.notes.a).toBeDefined();
  });
});
