/**
 * COMPARER DEUX VERSIONS, POUR DE VRAI.
 *
 * Ce que la méthode faisait avant : lire la taille, la date, l'empreinte et le
 * commentaire — jamais les octets. Comme la date change à chaque
 * enregistrement, chaque comparaison rendait la même ligne « Date : … → … » et
 * rien d'autre. Un écran qui affichait quelque chose, donc, sans jamais rien
 * comparer. Ces cas gèlent la différence : le contenu, ou un motif clair de ne
 * pas pouvoir le lire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const octets = new Map<string, Uint8Array>();
let magasinDispo = true;

vi.mock('../fileVersionStore', () => ({
  isAvailable: () => magasinDispo,
  listVersions: async () => [],
  getVersionBytes: async (_fileId: string, versionId: string) => octets.get(versionId) ?? null,
  saveVersion: async () => undefined,
  deleteVersion: async () => undefined,
  purgeFile: async () => undefined,
}));

import versionService, { type FileVersion } from '../versionService';

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Poser une version consultable par `getVersion`, avec ses octets. */
function poser(id: string, contenu: Uint8Array | null): FileVersion {
  const version = {
    id,
    fileId: 'fichier-1',
    versionNumber: 1,
    size: contenu?.length ?? 0,
    checksum: id,
    createdAt: new Date('2026-08-24T02:00:00Z').toISOString(),
    createdBy: 'moi',
    comment: '',
    contentAvailable: contenu !== null,
  } as unknown as FileVersion;

  if (contenu) octets.set(id, contenu);
  // Le service garde ses versions par fichier ; `getVersion` les y cherche.
  (versionService as unknown as { versions: Record<string, FileVersion[]> }).versions['fichier-1'] =
    [
      ...((versionService as unknown as { versions: Record<string, FileVersion[]> }).versions[
        'fichier-1'
      ] ?? []),
      version,
    ];
  return version;
}

beforeEach(() => {
  octets.clear();
  magasinDispo = true;
  (versionService as unknown as { versions: Record<string, FileVersion[]> }).versions = {};
});

describe('deux versions textuelles', () => {
  it('rend les lignes réellement ajoutées et retirées', async () => {
    poser('v1', utf8('alpha\nbeta\ngamma'));
    poser('v2', utf8('alpha\nBETA\ngamma'));

    const diff = await versionService.compareVersions('v1', 'v2');

    expect(diff.type).toBe('text');
    expect(diff.additions).toBe(1);
    expect(diff.deletions).toBe(1);
    expect(diff.changes).toEqual([
      { type: 'remove', lineNumber: 2, content: 'beta' },
      { type: 'add', lineNumber: 2, content: 'BETA' },
    ]);
  });

  it('deux versions au contenu identique ne rendent AUCUN changement', async () => {
    // Avant, la ligne « Date » était poussée systématiquement : deux versions
    // au contenu identique se présentaient comme différentes.
    poser('v1', utf8('meme chose'));
    poser('v2', utf8('meme chose'));

    const diff = await versionService.compareVersions('v1', 'v2');
    expect(diff.changes).toEqual([]);
    expect(diff.additions).toBe(0);
    expect(diff.deletions).toBe(0);
  });

  it('numérote les lignes du fichier', async () => {
    poser('v1', utf8('a\nb\nc\nd\ne'));
    poser('v2', utf8('a\nb\nc\nd\nE'));

    const diff = await versionService.compareVersions('v1', 'v2');
    expect(diff.changes[0]).toMatchObject({ type: 'remove', lineNumber: 5 });
    expect(diff.changes[1]).toMatchObject({ type: 'add', lineNumber: 5 });
  });
});

describe('ce qui ne se compare pas ligne à ligne', () => {
  it('le binaire est annoncé comme tel, avec l’écart de taille', async () => {
    poser('v1', new Uint8Array([0, 1, 2, 3]));
    poser('v2', new Uint8Array([0, 1, 2, 3, 4, 5]));

    const diff = await versionService.compareVersions('v1', 'v2');
    expect(diff.type).toBe('binary');
    expect(diff.additions).toBe(2);
    expect(diff.changes).toHaveLength(1);
  });

  it('deux binaires IDENTIQUES ne rendent aucun changement', async () => {
    poser('v1', new Uint8Array([9, 9, 9]));
    poser('v2', new Uint8Array([9, 9, 9]));

    expect((await versionService.compareVersions('v1', 'v2')).changes).toEqual([]);
  });

  it('un contenu absent est DIT, pas confondu avec une égalité', async () => {
    // Une version d'avant le magasin de contenus, ou dont l'instantané a été
    // purgé. La faire passer pour identique inviterait à ne pas restaurer.
    poser('v1', utf8('du texte'));
    poser('v2', null);

    const diff = await versionService.compareVersions('v1', 'v2');
    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0].newContent).toMatch(/indisponible/i);
  });

  it('sans magasin d’octets, on le dit aussi', async () => {
    poser('v1', utf8('a'));
    poser('v2', utf8('b'));
    magasinDispo = false;

    const diff = await versionService.compareVersions('v1', 'v2');
    expect(diff.changes[0].newContent).toMatch(/indisponible/i);
  });
});

describe('les garde-fous', () => {
  it('refuse une comparaison sans les deux identifiants', async () => {
    await expect(versionService.compareVersions('', 'v2')).rejects.toBeTruthy();
  });

  it('refuse une version introuvable', async () => {
    poser('v1', utf8('a'));
    await expect(versionService.compareVersions('v1', 'fantome')).rejects.toBeTruthy();
  });

  it('tronque une différence démesurée en le DISANT', async () => {
    // Trois mille lignes toutes différentes : au-delà de la borne d'affichage.
    const a = Array.from({ length: 3000 }, (_, i) => `ancien ${i}`).join('\n');
    const b = Array.from({ length: 3000 }, (_, i) => `nouveau ${i}`).join('\n');
    poser('v1', utf8(a));
    poser('v2', utf8(b));

    const diff = await versionService.compareVersions('v1', 'v2');
    const dernier = diff.changes[diff.changes.length - 1];
    expect(dernier.oldContent).toMatch(/tronqu/i);
    expect(diff.changes.length).toBeLessThan(3000);
  });
});
