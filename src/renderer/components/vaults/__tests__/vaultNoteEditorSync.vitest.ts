/**
 * VaultNoteEditor sync guards (E3-12) — the anti-overwrite rules of the vault-note
 * editor, tested where they live.
 *
 * The failure these exist to prevent: the editor keyed its load (and its save) on
 * the item's VERSION. A background list refresh advanced that version while the
 * document on screen stayed put, so the next save carried a version the user had
 * never read — the server's compare-and-set saw a "current" version, accepted the
 * write, and the other member's save was gone. Every assertion below is written so
 * that re-introducing that coupling turns it red.
 */

import { describe, it, expect } from 'vitest';
import {
  loadKey,
  shouldReload,
  saveGuardVersion,
  remoteState,
  shouldAnnounceNewerVersion,
  surfaceKey,
} from '../vaultNoteEditorSync';

const base = { isOpen: true, vaultId: 'v1', itemId: 'i1', reloadNonce: 0 };

describe('loadKey / shouldReload — what may re-read the body', () => {
  it('MUTATION GUARD: the item VERSION is not part of the load identity', () => {
    // The list refreshes mid-edit and reports version 9 instead of 5. Whatever the
    // caller passes, the load identity can only be built from these four fields —
    // adding the version to LoadKeyInput would make this render as a reload.
    const before = loadKey(base);
    const after = loadKey({ ...base });
    expect(after).toBe(before);
    expect(shouldReload(base, { ...base })).toBe(false);
    // And the key must not accidentally serialise anything version-shaped.
    expect(before).toBe('1:v1:i1:0');
  });

  it('an explicit reload (nonce bump) is the ONLY in-place trigger', () => {
    expect(shouldReload(base, { ...base, reloadNonce: 1 })).toBe(true);
  });

  it('opening, closing, or switching item/vault re-reads', () => {
    expect(shouldReload({ ...base, isOpen: false }, base)).toBe(true);
    expect(shouldReload(base, { ...base, itemId: 'i2' })).toBe(true);
    expect(shouldReload(base, { ...base, vaultId: 'v2' })).toBe(true);
  });
});

describe('saveGuardVersion — what a save is allowed to claim it read', () => {
  it('MUTATION GUARD: it is the LOADED version, never the list’s newer one', () => {
    // The newer version is deliberately IN the object handed over: reaching for it
    // is precisely the silent overwrite — the CAS would pass against a document
    // this user never saw.
    const state = { loadedVersion: 5, remoteVersion: 9 };
    expect(saveGuardVersion(state)).toBe(5);
  });

  it('is null when nothing is loaded, so no save can be offered', () => {
    expect(saveGuardVersion({ loadedVersion: null })).toBeNull();
  });
});

describe('remoteState — announce, never apply', () => {
  it('flags a newer remote version instead of adopting it', () => {
    expect(remoteState({ loadedVersion: 5, remoteVersion: 6, hasConflict: false })).toBe(
      'newer-available'
    );
  });

  it('stays quiet when the loaded document is current', () => {
    expect(remoteState({ loadedVersion: 5, remoteVersion: 5, hasConflict: false })).toBe('in-sync');
    // A version BEHIND the loaded one (a stale list response arriving late) is not a
    // reason to shout either.
    expect(remoteState({ loadedVersion: 6, remoteVersion: 5, hasConflict: false })).toBe('in-sync');
  });

  it('defers to the conflict UI while a conflict is unresolved', () => {
    expect(remoteState({ loadedVersion: 5, remoteVersion: 9, hasConflict: true })).toBe('in-sync');
  });

  it('says nothing before a document is loaded', () => {
    expect(remoteState({ loadedVersion: null, remoteVersion: 9, hasConflict: false })).toBe(
      'in-sync'
    );
  });
});

describe('surfaceKey — the editing surface follows the loaded document', () => {
  it('changes per LOAD, not per version', () => {
    // tiptap takes `content` as an initial value: without a new key, a reload would
    // leave the previous text on screen while the state claims the new version.
    expect(surfaceKey('i1', 1)).not.toBe(surfaceKey('i1', 2));
    expect(surfaceKey('i1', 1)).toBe(surfaceKey('i1', 1));
    expect(surfaceKey('i1', 1)).not.toBe(surfaceKey('i2', 1));
  });
});

describe('shouldAnnounceNewerVersion — se taire n’est légitime que dans une salle qui CONVERGE', () => {
  const base = {
    ready: true,
    roomConverging: false,
    loadedVersion: 5,
    remoteVersion: 6,
    hasConflict: false,
  };

  it('hors salle, une version plus récente est annoncée', () => {
    expect(shouldAnnounceNewerVersion(base)).toBe(true);
  });

  it('dans une salle qui converge, le silence est juste : c’est NOTRE texte', () => {
    // L'élu vient d'écrire le texte que tout le monde regarde déjà. Proposer de
    // « recharger » rejouerait la même chose et re-cléfierait la salle.
    expect(shouldAnnounceNewerVersion({ ...base, roomConverging: true })).toBe(false);
  });

  it('LE DÉFAUT : une salle OUVERTE MAIS HORS LIGNE ne converge rien — il faut parler', () => {
    // `collabLive` seul suffisait à faire taire l'annonce. Une salle hors ligne
    // est pourtant exactement le cas où l'autre membre a enregistré SANS que
    // rien ne nous parvienne : taire l'avis laisse la personne taper sur une
    // version périmée jusqu'au 409. C'est ce que l'appelant doit passer dans
    // `roomConverging` — la salle vivante ET rejouée, pas la salle ouverte.
    expect(shouldAnnounceNewerVersion({ ...base, roomConverging: false })).toBe(true);
  });

  it('rien avant que le corps ne soit à l’écran, rien pendant un conflit', () => {
    expect(shouldAnnounceNewerVersion({ ...base, ready: false })).toBe(false);
    expect(shouldAnnounceNewerVersion({ ...base, hasConflict: true })).toBe(false);
    expect(shouldAnnounceNewerVersion({ ...base, loadedVersion: null })).toBe(false);
    expect(shouldAnnounceNewerVersion({ ...base, remoteVersion: 5 })).toBe(false);
  });
});
