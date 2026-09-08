/**
 * CONTRATS DE LA BASCULE v1 → v2 DEPUIS LE NAVIGATEUR.
 *
 * ═══ CE QUE CE FICHIER GARDE ═══
 *
 * Le web ne migrait pas. Pas pour une raison technique — `migrateToV2` prend un
 * `VaultIO`, et celui du navigateur en est un — mais parce qu'une phrase écrite
 * en tête de `webNotesCycleV2.ts` décrivait une commodité comme une conception.
 * Conséquence : qui n'utilise Filarr que dans son navigateur ne pouvait pas
 * atteindre la v2 du tout.
 *
 * Ouvrir cette porte, c'est ouvrir la RÉÉCRITURE COMPLÈTE d'un coffre à une
 * plateforme de plus. Les contrats ci-dessous portent donc presque uniquement
 * sur le garde-fou : quand refuse-t-elle, et pourquoi.
 */

import { describe, expect, it } from 'vitest';

import { migrateWebVaultToV2, webLegacyNotesVerdict, webVaultFormat } from '../webNotesCycleV2';
import { NOTES_DIR, NOTES_INDEX_FILENAME, type NotesIndex } from '../notesStoreV2';
import type { VaultIO } from '../notesVaultStore';

const INDEX_PATH = `${NOTES_DIR}/${NOTES_INDEX_FILENAME}`;

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

const T0 = '2026-01-01T00:00:00.000Z';

function note(id: string) {
  return { id, title: `Note ${id}`, content: `c-${id}`, createdAt: T0, updatedAt: T0 };
}

function coffreV1(ids: string[]) {
  const byId: Record<string, unknown> = {};
  for (const id of ids) byId[id] = note(id);
  return { byId, allIds: [...ids], templates: [], notebooks: {} };
}

// ── Le verdict ──────────────────────────────────────────────────────────────

describe('peut-on migrer, vu du navigateur ?', () => {
  const NOW = Date.parse('2026-09-02T00:00:00.000Z');
  const recent = new Date(NOW - 60_000).toISOString();
  const vieux = new Date(NOW - 60 * 24 * 60 * 60 * 1000).toISOString();

  /**
   * L'ÉTAT D'UN ONGLET QUI VIENT DE S'OUVRIR, et le refus qui compte le plus :
   * aucun cycle n'a encore vu le nuage. Migrer sans savoir ce qu'il porte est
   * exactement le geste qu'on ne veut pas — et l'ignorance se résout toute
   * seule au premier cycle.
   */
  it('REFUSE sans manifeste : ne pas savoir n’est pas une autorisation', () => {
    expect(webLegacyNotesVerdict(null, NOW)).toBe('unknown');
    expect(webLegacyNotesVerdict({}, NOW)).toBe('safe'); // manifeste sans entrée = pas de blob
  });

  it('refuse pendant qu’un autre appareil écrit encore en v1', () => {
    expect(webLegacyNotesVerdict({ files: { 'meta:notes': { updatedAt: recent } } }, NOW)).toBe(
      'legacy-active'
    );
  });

  it('un blob v1 RÉÉCRIT par un appareil v2 n’est pas un écrivain v1 — personne ne tape', () => {
    expect(
      webLegacyNotesVerdict(
        { files: { 'meta:notes': { updatedAt: recent, legacyWriteBack: true } } },
        NOW
      )
    ).toBe('safe');
    // Le drapeau à faux (vraie écriture v1 depuis un navigateur) garde le refus.
    expect(
      webLegacyNotesVerdict(
        { files: { 'meta:notes': { updatedAt: recent, legacyWriteBack: false } } },
        NOW
      )
    ).toBe('legacy-active');
  });

  it('autorise quand le blob v1 est abandonné, ou supprimé', () => {
    expect(webLegacyNotesVerdict({ files: { 'meta:notes': { updatedAt: vieux } } }, NOW)).toBe(
      'safe'
    );
    expect(
      webLegacyNotesVerdict(
        { files: { 'meta:notes': { status: 'deleted', updatedAt: recent } } },
        NOW
      )
    ).toBe('safe');
  });

  /** Un horodatage illisible compte comme ACTIF : on ne conclut pas à l'abandon
   *  depuis une donnée qu'on ne sait pas lire. */
  it('traite un horodatage illisible comme actif', () => {
    expect(
      webLegacyNotesVerdict({ files: { 'meta:notes': { updatedAt: 'pas-une-date' } } }, NOW)
    ).toBe('legacy-active');
    expect(webLegacyNotesVerdict({ files: { 'meta:notes': {} } }, NOW)).toBe('legacy-active');
  });
});

// ── La bascule ──────────────────────────────────────────────────────────────

describe('la bascule elle-même', () => {
  it('range les notes une par une, et garde notes.enc', async () => {
    const io = new FauxDisque();
    await io.write('notes.enc', coffreV1(['a', 'b']));

    const res = await migrateWebVaultToV2('safe', io);

    expect(res).toMatchObject({ ok: true, noteCount: 2 });
    expect(await webVaultFormat(io)).toBe('v2');
    // Le chemin de retour est intact — c'est aussi ce que lit un appareil v1.
    expect(io.files.has('notes.enc')).toBe(true);
    const index = io.files.get(INDEX_PATH) as NotesIndex;
    expect(Object.keys(index.notes).sort()).toEqual(['a', 'b']);
  });

  /**
   * L'INDEX EN DERNIER. C'est son écriture qui fait basculer le profil : une
   * coupure avant lui laisse un coffre v1 intact plus quelques objets que
   * personne ne lit, jamais un index qui promet des notes absentes.
   */
  it('écrit les notes AVANT l’index', async () => {
    const io = new FauxDisque();
    await io.write('notes.enc', coffreV1(['a', 'b']));
    io.writes = [];

    await migrateWebVaultToV2('safe', io);

    expect(io.writes[io.writes.length - 1]).toBe(INDEX_PATH);
    expect(io.writes.indexOf(INDEX_PATH)).toBe(io.writes.length - 1);
  });

  /** Le garde-fou du bureau, au mot près : c'est la même décision. */
  it('refuse tant que le verdict n’est pas « safe », sans rien écrire', async () => {
    for (const verdict of ['unknown', 'legacy-active'] as const) {
      const io = new FauxDisque();
      await io.write('notes.enc', coffreV1(['a']));
      io.writes = [];

      const res = await migrateWebVaultToV2(verdict, io);

      expect(res.ok).toBe(false);
      expect(res.why).toBe(verdict === 'unknown' ? 'cloud-not-seen' : 'legacy-active');
      expect(io.writes).toEqual([]);
    }
  });

  it('ne migre pas deux fois, et ne migre pas le vide', async () => {
    const dejaV2 = new FauxDisque();
    await dejaV2.write('notes.enc', coffreV1(['a']));
    await migrateWebVaultToV2('safe', dejaV2);
    expect((await migrateWebVaultToV2('safe', dejaV2)).why).toBe('already-v2');

    // Un profil vierge ne refuse plus : il NAÎT en v2 (index vide posé).
    const vierge = new FauxDisque();
    expect(await migrateWebVaultToV2('safe', vierge)).toEqual({ ok: true, noteCount: 0 });
    expect(await webVaultFormat(vierge)).toBe('v2');
  });

  /**
   * LES EMPREINTES DOIVENT VALOIR CELLES DU BUREAU. `crypto.subtle` est
   * asynchrone alors que `SplitDeps.digestOf` est synchrone : les empreintes
   * sont donc pré-calculées. Si ce pré-calcul manquait une note, elle prendrait
   * une empreinte vide — et les deux plateformes se renverraient indéfiniment
   * un contenu identique qu'elles croiraient différent.
   */
  it('donne à chaque note une empreinte non vide, et distincte', async () => {
    const io = new FauxDisque();
    await io.write('notes.enc', coffreV1(['a', 'b', 'c']));

    await migrateWebVaultToV2('safe', io);

    const index = io.files.get(INDEX_PATH) as NotesIndex;
    const empreintes = Object.values(index.notes).map((e) => e.digest);
    expect(empreintes.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    expect(new Set(empreintes).size).toBe(3);
  });
});
