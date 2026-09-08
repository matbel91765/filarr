/**
 * Registre des notes tenues par un éditeur.
 *
 * Ce que ces cas gardent — et pourquoi ils existent : la garde qui protège une
 * note d'une écriture venue d'ailleurs (ligne créée depuis une base inline,
 * colonne miroir posée par une base voisine) portait sur
 * `state.notes.editingNoteId`, UN identifiant. L'application ouvre plusieurs
 * notes à la fois : en vue scindée, la note du second panneau passait pour
 * libre, l'écriture avait lieu, et le document ProseMirror de ce panneau la
 * réécrivait à la frappe suivante — la ligne disparaissait sans un mot.
 *
 * Un modèle à un seul identifiant ne peut PAS satisfaire ces cas : c'est ce qui
 * les rend utiles.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireNoteEditor,
  canWriteNoteContent,
  heldNoteIds,
  isNoteHeldByEditor,
  resetNoteEditorRegistry,
  subscribeNoteEditors,
} from '../noteEditorRegistry';

beforeEach(() => {
  resetNoteEditorRegistry();
});

describe('occupation d’une note', () => {
  it('une note libre s’écrit, une note montée ne s’écrit pas', () => {
    expect(isNoteHeldByEditor('note-a')).toBe(false);
    expect(canWriteNoteContent('note-a')).toBe(true);

    const release = acquireNoteEditor('note-a');
    expect(isNoteHeldByEditor('note-a')).toBe(true);
    expect(canWriteNoteContent('note-a')).toBe(false);

    release();
    expect(isNoteHeldByEditor('note-a')).toBe(false);
    expect(canWriteNoteContent('note-a')).toBe(true);
  });

  it('une note inconnue n’est jamais tenue, et le vide ne s’écrit pas', () => {
    expect(isNoteHeldByEditor('jamais-ouverte')).toBe(false);
    // Sans note d'accueil, il n'y a rien où écrire — surtout pas « libre »
    expect(canWriteNoteContent('')).toBe(false);
    expect(isNoteHeldByEditor('')).toBe(false);
  });

  it('acquérir la note vide ne fabrique aucune occupation fantôme', () => {
    const release = acquireNoteEditor('');
    expect(heldNoteIds().size).toBe(0);
    release();
    expect(heldNoteIds().size).toBe(0);
  });
});

describe('vue scindée : deux panneaux, deux notes', () => {
  it('tient les DEUX notes à la fois (un identifiant unique n’y suffirait pas)', () => {
    const releaseA = acquireNoteEditor('note-a');
    const releaseB = acquireNoteEditor('note-b');

    expect(canWriteNoteContent('note-a')).toBe(false);
    expect(canWriteNoteContent('note-b')).toBe(false);
    expect([...heldNoteIds()].sort()).toEqual(['note-a', 'note-b']);

    // Fermer un panneau ne libère QUE sa note
    releaseA();
    expect(canWriteNoteContent('note-a')).toBe(true);
    expect(canWriteNoteContent('note-b')).toBe(false);

    releaseB();
    expect(heldNoteIds().size).toBe(0);
  });

  it('la même note dans deux panneaux reste tenue tant que les deux la tiennent', () => {
    const releaseLeft = acquireNoteEditor('note-a');
    const releaseRight = acquireNoteEditor('note-a');
    expect(canWriteNoteContent('note-a')).toBe(false);

    // Le démontage du premier panneau ne doit pas déclarer la note libre :
    // le second l'a toujours en mémoire
    releaseLeft();
    expect(canWriteNoteContent('note-a')).toBe(false);

    releaseRight();
    expect(canWriteNoteContent('note-a')).toBe(true);
  });

  it('une libération répétée ne rend pas la note d’un autre panneau', () => {
    const releaseLeft = acquireNoteEditor('note-a');
    acquireNoteEditor('note-a');

    releaseLeft();
    releaseLeft();
    releaseLeft();
    // Le panneau restant tient toujours la note
    expect(canWriteNoteContent('note-a')).toBe(false);
  });

  it('un panneau qui change de note libère l’ancienne et prend la nouvelle', () => {
    const release = acquireNoteEditor('note-a');
    release();
    const next = acquireNoteEditor('note-b');
    expect(canWriteNoteContent('note-a')).toBe(true);
    expect(canWriteNoteContent('note-b')).toBe(false);
    next();
  });
});

describe('abonnement', () => {
  it('prévient à chaque changement et rend un instantané STABLE entre deux', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeNoteEditors(() => seen.push(heldNoteIds().size));

    const first = heldNoteIds();
    // Identité inchangée tant que rien ne bouge : sans cela, `useSyncExternalStore`
    // re-rendrait sans fin
    expect(heldNoteIds()).toBe(first);

    const release = acquireNoteEditor('note-a');
    expect(heldNoteIds()).not.toBe(first);
    release();
    expect(seen).toEqual([1, 0]);

    unsubscribe();
    acquireNoteEditor('note-b');
    // Plus abonné : plus prévenu
    expect(seen).toEqual([1, 0]);
  });
});
