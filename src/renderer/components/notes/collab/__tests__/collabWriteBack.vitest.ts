/**
 * Retour au stockage : débounce, garde anti-effacement, source du contenu.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  decideStaleSharedDoc,
  COLLAB_READY_TIMEOUT_MS,
  COLLAB_WRITE_BACK_DELAY_MS,
  DEFAULT_WRITE_BACK_DELAY_MS,
  computeWriteBack,
  createWriteBackDebouncer,
  decideCollabSettle,
  isExternalNoteWrite,
  isStaleCollabSession,
  shouldSkipWriteBack,
  writeBackDelayMs,
} from '../collabWriteBack';

describe('writeBackDelayMs', () => {
  it('garde 300 ms pour la frappe locale', () => {
    expect(writeBackDelayMs(false)).toBe(DEFAULT_WRITE_BACK_DELAY_MS);
    expect(DEFAULT_WRITE_BACK_DELAY_MS).toBe(300);
  });

  it('passe à 2 s en session vivante', () => {
    expect(writeBackDelayMs(true)).toBe(COLLAB_WRITE_BACK_DELAY_MS);
    expect(COLLAB_WRITE_BACK_DELAY_MS).toBe(2000);
  });
});

describe('createWriteBackDebouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('n’écrit rien avant l’échéance', () => {
    const emit = vi.fn();
    const debouncer = createWriteBackDebouncer();

    debouncer.schedule(emit, 2000);
    vi.advanceTimersByTime(1999);
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('une frappe de plus repousse l’écriture au lieu de l’ajouter', () => {
    const emit = vi.fn();
    const debouncer = createWriteBackDebouncer();

    debouncer.schedule(emit, 2000);
    vi.advanceTimersByTime(1500);
    debouncer.schedule(emit, 2000);
    vi.advanceTimersByTime(1500);
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('cancelPending signale ce qu’il a annulé et empêche l’écriture', () => {
    const emit = vi.fn();
    const debouncer = createWriteBackDebouncer();

    expect(debouncer.cancelPending()).toBe(false);

    debouncer.schedule(emit, 2000);
    expect(debouncer.isPending()).toBe(true);
    expect(debouncer.cancelPending()).toBe(true);
    expect(debouncer.isPending()).toBe(false);

    vi.advanceTimersByTime(5000);
    expect(emit).not.toHaveBeenCalled();
  });

  it('redevient inactif après avoir écrit', () => {
    const debouncer = createWriteBackDebouncer();
    debouncer.schedule(() => undefined, 300);
    vi.advanceTimersByTime(300);
    expect(debouncer.isPending()).toBe(false);
    expect(debouncer.cancelPending()).toBe(false);
  });
});

describe('shouldSkipWriteBack', () => {
  it('ne bloque jamais la frappe locale hors session', () => {
    expect(shouldSkipWriteBack({ collabActive: false, ready: false })).toBe(false);
    expect(shouldSkipWriteBack({ collabActive: false, ready: true })).toBe(false);
  });

  it('bloque tant que la session n’est pas tranchée', () => {
    expect(shouldSkipWriteBack({ collabActive: true, ready: false })).toBe(true);
  });

  it('laisse tout passer une fois la session tranchée', () => {
    expect(shouldSkipWriteBack({ collabActive: true, ready: true })).toBe(false);
  });

  it('plafonne l’attente pour ne jamais perdre une frappe locale', () => {
    // Le plafond doit rester au-dessus du débounce, sinon la première écriture
    // partirait avant que la session ait eu une chance de se prononcer.
    expect(COLLAB_READY_TIMEOUT_MS).toBeGreaterThan(COLLAB_WRITE_BACK_DELAY_MS);
  });
});

describe('computeWriteBack', () => {
  const editorDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
  const crdtDoc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'crdt' }] }],
  };

  it('prend le document de l’éditeur hors session', () => {
    const payload = computeWriteBack({
      getCollabJson: null,
      getEditorJson: () => editorDoc,
      getPlainText: () => 'local',
    });

    expect(payload.doc).toBe(editorDoc);
    expect(payload.json).toBe(JSON.stringify(editorDoc));
    expect(payload.plainText).toBe('local');
  });

  it('prend le document du CRDT en session — c’est lui qui a convergé', () => {
    const payload = computeWriteBack({
      getCollabJson: () => crdtDoc,
      getEditorJson: () => editorDoc,
      getPlainText: () => 'crdt',
    });

    expect(payload.doc).toBe(crdtDoc);
  });

  it('retombe sur l’éditeur si le fournisseur ne répond pas', () => {
    const payload = computeWriteBack({
      getCollabJson: () => {
        throw new Error('session détruite');
      },
      getEditorJson: () => editorDoc,
      getPlainText: () => 'local',
    });

    expect(payload.doc).toBe(editorDoc);
  });

  it('retombe sur l’éditeur si le fournisseur renvoie autre chose qu’un document', () => {
    const payload = computeWriteBack({
      getCollabJson: () => null,
      getEditorJson: () => editorDoc,
      getPlainText: () => 'local',
    });

    expect(payload.doc).toBe(editorDoc);
  });
});

// ==================== Semis de la session ====================

describe('decideCollabSettle — le semis attend la fin du rejeu', () => {
  const input = (over: Partial<Parameters<typeof decideCollabSettle>[0]> = {}) => ({
    status: 'connecting' as const,
    fragmentEmpty: true,
    docLoaded: true,
    timedOut: false,
    ...over,
  });

  it('LE DÉFAUT : un canal seulement CONNECTÉ ne suffit pas à semer', () => {
    // Un second appareil qui rejoint une salle déjà garnie voit un fragment
    // vide tant que le rejeu n'est pas arrivé. Semer ici versait le contenu du
    // magasin par-dessus le rejeu à venir : la note se retrouvait EN DOUBLE.
    expect(decideCollabSettle(input({ status: 'connected' }))).toBe('wait');
    expect(decideCollabSettle(input({ status: 'connected', timedOut: true }))).toBe('wait');
  });

  it('sème quand la fin du rejeu est confirmée et que la salle est vide', () => {
    expect(decideCollabSettle(input({ status: 'synced' }))).toBe('seed');
  });

  it('adopte sans semer dès que le partagé porte quelque chose', () => {
    expect(decideCollabSettle(input({ status: 'connected', fragmentEmpty: false }))).toBe('adopt');
    expect(decideCollabSettle(input({ status: 'synced', fragmentEmpty: false }))).toBe('adopt');
    expect(decideCollabSettle(input({ status: 'offline', fragmentEmpty: false }))).toBe('adopt');
  });

  it('attend la persistance locale : un fragment vide ne prouve rien avant elle', () => {
    // IndexedDB rend son contenu de façon asynchrone. Semer avant sa réponse
    // duplique exactement comme un rejeu trop tardif.
    expect(decideCollabSettle(input({ status: 'synced', docLoaded: false }))).toBe('wait');
    expect(decideCollabSettle(input({ status: 'offline', docLoaded: false, timedOut: true }))).toBe(
      'wait'
    );
  });

  it('sème hors ligne, mais seulement une fois le plafond passé', () => {
    // Pas de canal = pas de rejeu à attendre ; le plafond laisse quand même sa
    // chance à une reconnexion immédiate.
    expect(decideCollabSettle(input({ status: 'offline' }))).toBe('wait');
    expect(decideCollabSettle(input({ status: 'offline', timedOut: true }))).toBe('seed');
  });

  it('ne sème jamais tant que le canal est en cours d’établissement', () => {
    expect(decideCollabSettle(input({ status: 'connecting', timedOut: true }))).toBe('wait');
  });
});

// ==================== Écriture externe vs écho ====================

describe('isExternalNoteWrite — la restauration de version passe, l’écho non', () => {
  const doc = (text: string) => JSON.stringify({ type: 'doc', content: [{ text }] });

  it('ignore l’écho de notre propre retour au stockage', () => {
    const written = doc('frappe en cours');
    expect(
      isExternalNoteWrite({ stored: written, lastWritten: written, sessionContent: written })
    ).toBe(false);
  });

  it('ignore un magasin qui rend exactement l’état du document partagé', () => {
    const shared = doc('convergé');
    expect(
      isExternalNoteWrite({
        stored: shared,
        lastWritten: doc('plus vieux'),
        sessionContent: shared,
      })
    ).toBe(false);
  });

  it('LAISSE PASSER une restauration de version', () => {
    // C'est le SEUL chemin par lequel une restauration atteint l'éditeur :
    // couper l'effet sans condition cassait la fonctionnalité en session.
    expect(
      isExternalNoteWrite({
        stored: doc('version restaurée'),
        lastWritten: doc('frappe en cours'),
        sessionContent: doc('frappe en cours'),
      })
    ).toBe(true);
  });

  it('n’adopte jamais un magasin vide en session', () => {
    expect(
      isExternalNoteWrite({ stored: '', lastWritten: doc('a'), sessionContent: doc('a') })
    ).toBe(false);
    expect(
      isExternalNoteWrite({ stored: undefined, lastWritten: null, sessionContent: null })
    ).toBe(false);
  });

  it('passe quand la session ne répond pas (rien à comparer d’autre)', () => {
    expect(
      isExternalNoteWrite({
        stored: doc('venu d’ailleurs'),
        lastWritten: null,
        sessionContent: null,
      })
    ).toBe(true);
  });
});

describe('isStaleCollabSession — la session est en retard d’un rendu', () => {
  /**
   * LE DÉFAUT VÉCU : une note fantôme « Sans titre » recopiait la frappe.
   * `useCollabSession` publie la session par un ÉTAT posé dans un effet, donc
   * elle change UN RENDU APRÈS `noteId` ; la clé de remontage de l'éditeur,
   * elle, suivait la note DEMANDÉE. L'éditeur de la note B était donc remonté
   * lié au fragment Yjs de la note A — et `useEditor` n'ayant pas de tableau de
   * dépendances, ce lien devenait définitif. Le retour au stockage écrivait
   * alors le texte de A dans B, frappe après frappe.
   */
  it('vrai quand la session désigne encore la note précédente', () => {
    expect(isStaleCollabSession('note-a', 'note-b')).toBe(true);
  });

  it('faux quand la session désigne bien la note demandée', () => {
    expect(isStaleCollabSession('note-b', 'note-b')).toBe(false);
  });

  it('faux sans session : il n’y a rien à attendre (drapeau éteint, création refusée)', () => {
    expect(isStaleCollabSession(null, 'note-b')).toBe(false);
    expect(isStaleCollabSession(undefined, 'note-b')).toBe(false);
  });

  it('le contenu à écrire ne vient JAMAIS du document d’une autre note', () => {
    // Ce que faisait le défaut : le document venait de la session de la note
    // COURANTE (vide, fraîchement ouverte) et le texte de l'éditeur, resté
    // lié au fragment de la note PRÉCÉDENTE — les deux moitiés d'une note
    // fantôme qui recopie ce qu'on tape ailleurs.
    const sessionDeLaNotePrecedente = { noteId: 'note-a' };
    const session = isStaleCollabSession(sessionDeLaNotePrecedente.noteId, 'note-b')
      ? null
      : sessionDeLaNotePrecedente;

    const payload = computeWriteBack({
      getCollabJson: session ? () => ({ type: 'doc', content: [] }) : null,
      getEditorJson: () => ({ type: 'doc', content: [{ type: 'paragraph' }] }),
      getPlainText: () => 'texte de la note B',
    });

    expect(session).toBeNull();
    expect(payload.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('decideStaleSharedDoc — un document garni ne fait foi que s’il n’est pas périmé', () => {
  const A = '{"type":"doc","content":[{"type":"paragraph","text":"vieux"}]}';
  const B = '{"type":"doc","content":[{"type":"paragraph","text":"restaure"}]}';

  it('adopte quand les contenus sont égaux, quelle que soit l’horloge', () => {
    expect(
      decideStaleSharedDoc({
        storeContent: A,
        docContent: A,
        storeUpdatedAt: '2026-09-03T20:50:15Z',
        docStoreUpdatedAt: null,
      })
    ).toBe('adopt');
  });

  it('remplace un document sans horloge dont le texte diffère du magasin (document d’avant la règle)', () => {
    expect(
      decideStaleSharedDoc({
        storeContent: B,
        docContent: A,
        storeUpdatedAt: '2026-09-03T20:50:15Z',
        docStoreUpdatedAt: null,
      })
    ).toBe('replace');
  });

  it('remplace quand le magasin a été écrit après ce que le document a vu de lui', () => {
    expect(
      decideStaleSharedDoc({
        storeContent: B,
        docContent: A,
        storeUpdatedAt: '2026-09-03T20:50:15Z',
        docStoreUpdatedAt: '2026-09-01T04:33:00Z',
      })
    ).toBe('replace');
  });

  it('adopte quand le document porte une frappe que le magasin n’a pas encore', () => {
    expect(
      decideStaleSharedDoc({
        storeContent: B,
        docContent: A,
        storeUpdatedAt: '2026-09-03T20:50:15Z',
        docStoreUpdatedAt: '2026-09-03T20:50:15Z',
      })
    ).toBe('adopt');
  });

  it('adopte sans contenu de magasin, ou sans horloge de magasin lisible', () => {
    expect(
      decideStaleSharedDoc({
        storeContent: null,
        docContent: A,
        storeUpdatedAt: null,
        docStoreUpdatedAt: null,
      })
    ).toBe('adopt');
    expect(
      decideStaleSharedDoc({
        storeContent: B,
        docContent: A,
        storeUpdatedAt: 'n/a',
        docStoreUpdatedAt: null,
      })
    ).toBe('adopt');
  });
});
