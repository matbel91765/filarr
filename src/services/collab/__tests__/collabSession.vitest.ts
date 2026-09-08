import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  startCollabSession,
  createCollabSession,
  releaseCollabSession,
  collabSessionRefCount,
  stopCollabSession,
  stopAllCollabSessions,
  isNoteInLiveSession,
  liveSessionNoteIds,
  presenceColorFor,
  publishLiveSessions,
  purgeCollabOnKeyLoss,
  toSessionStatus,
} from '../collabSession';
import { overrideCollabEnabled } from '../collabFlag';
import { deriveRoomKey, roomKeyCount } from '../collabKeys';
import { isNoteLive, liveNotes, clearLiveNotes } from '../liveNoteRegistry';
import yDocManager from '../../notes/yDocManager';
import { CollabControl, buildControlFrame } from '../collabProtocol';
import { FakeRoom, fakeTicket, settle, waitUntil } from './fakeSocket';

const FEK = new Uint8Array(32).fill(3);
const NOTE_ID = 'note-session';

let key: CryptoKey;
let room: FakeRoom;

beforeEach(async () => {
  key = await deriveRoomKey(FEK, NOTE_ID);
  room = new FakeRoom();
  overrideCollabEnabled(true);
});

afterEach(() => {
  stopAllCollabSessions();
  yDocManager.destroyAll();
  clearLiveNotes();
  overrideCollabEnabled(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function providerOptions() {
  return {
    createSocket: room.create,
    resolveKey: async () => key,
    resolveTicket: async () => fakeTicket(),
    batchMs: 0,
    snapshotIntervalMs: 0,
    syncGraceMs: 10_000_000,
  };
}

function write(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment('content');
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  fragment.insert(fragment.length, [p]);
}

describe('session — drapeau et repli', () => {
  it('ne démarre rien quand le drapeau est éteint', () => {
    overrideCollabEnabled(false);
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    });
    expect(session).toBeNull();
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
    expect(room.sockets).toHaveLength(0);
  });

  it('démarre malgré le drapeau éteint quand on le force (diagnostic)', () => {
    overrideCollabEnabled(false);
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      force: true,
      providerOptions: providerOptions(),
    });
    expect(session).not.toBeNull();
  });

  it('la fabrique de l’éditeur refuse un profil absent plutôt que d’ouvrir une salle bancale', () => {
    expect(
      createCollabSession({
        noteId: NOTE_ID,
        profileId: '',
        user: { name: 'Bureau', color: '#fff' },
      })
    ).toBeNull();
    expect(room.sockets).toHaveLength(0);
  });
});

// ==================== Mode scindé ====================

describe('session — comptage des références (mode scindé)', () => {
  it('réutilise la session existante pour la même note, sans rouvrir de salle', async () => {
    const first = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    });
    const second = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    });
    expect(second).toBe(first);
    await settle();
    // Une seule salle ouverte, pas deux : la seconde demande n'a rien reconnecté.
    expect(room.sockets).toHaveLength(1);
    expect(collabSessionRefCount(NOTE_ID)).toBe(2);
  });

  it('le premier panneau qui ferme ne détruit PAS la session du second', () => {
    const a = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    const b = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    expect(b).toBe(a);

    a.release();
    // Toujours vivante : le second panneau la tient encore.
    expect(a.destroyed).toBe(false);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(true);
    expect(collabSessionRefCount(NOTE_ID)).toBe(1);

    b.release();
    expect(b.destroyed).toBe(true);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
    expect(collabSessionRefCount(NOTE_ID)).toBe(0);
  });

  it('relâcher une session déjà partie ne lève pas et ne fait rien', () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    session.release();
    expect(() => session.release()).not.toThrow();
    expect(() => releaseCollabSession(NOTE_ID)).not.toThrow();
  });

  it('un verrouillage ferme la session même quand deux panneaux la tiennent', () => {
    startCollabSession({ noteId: NOTE_ID, profileId: 'p1', providerOptions: providerOptions() });
    const second = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    stopCollabSession(NOTE_ID);
    expect(second.destroyed).toBe(true);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
  });
});

// ==================== Documents ====================

describe('session — le document ne fuit pas', () => {
  it('relâche le Y.Doc à la fermeture, sans qu’aucun appelant ait à le demander', () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    expect(yDocManager.hasDoc(NOTE_ID, 'p1')).toBe(true);

    session.release();
    // Le défaut est de RELÂCHER : sans cela, chaque changement de note laissait
    // un document (et sa persistance IndexedDB) en mémoire pour toujours.
    expect(yDocManager.hasDoc(NOTE_ID, 'p1')).toBe(false);
    expect(yDocManager.refCount(NOTE_ID, 'p1')).toBe(0);
  });

  it('garde le document quand on le demande explicitement', () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    session.destroy({ keepDoc: true });
    expect(yDocManager.hasDoc(NOTE_ID, 'p1')).toBe(true);
    yDocManager.destroyDoc(NOTE_ID, 'p1');
  });

  it('ne rend JAMAIS le document d’un autre profil pour la même note', () => {
    const un = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    write(un.doc, 'écrit dans le profil 1');

    const deux = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p2',
      providerOptions: providerOptions(),
    })!;

    expect(deux.doc).not.toBe(un.doc);
    expect(deux.getContentJSON()).not.toContain('écrit dans le profil 1');
    expect(un.getContentJSON()).toContain('écrit dans le profil 1');
  });
});

// ==================== Garde de la fusion ====================

describe('session — garde de la fusion', () => {
  it('déclare la note vivante tant que la session tient, et plus après', () => {
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
    startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    });
    expect(isNoteInLiveSession(NOTE_ID)).toBe(true);
    expect(liveSessionNoteIds()).toEqual([NOTE_ID]);

    stopCollabSession(NOTE_ID);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
    expect(liveSessionNoteIds()).toEqual([]);
  });

  it('publie la liste dans le registre léger que lit la fusion web', () => {
    expect(isNoteLive(NOTE_ID)).toBe(false);
    startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    });
    // Sans cette publication, `installNotes` ne saurait pas que la note vit et
    // la fusion écraserait le contenu en cours d'édition.
    expect(isNoteLive(NOTE_ID)).toBe(true);
    expect(liveNotes()).toEqual([NOTE_ID]);

    stopCollabSession(NOTE_ID);
    expect(isNoteLive(NOTE_ID)).toBe(false);
    expect(liveNotes()).toEqual([]);
  });

  it('pousse la même liste au processus principal, sur un canal dédié', () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = { electron: { ipcRenderer: { invoke } } };
    try {
      startCollabSession({
        noteId: NOTE_ID,
        profileId: 'p1',
        providerOptions: providerOptions(),
      });
      expect(invoke).toHaveBeenCalledWith('collab:setLiveNotes', [NOTE_ID]);

      stopCollabSession(NOTE_ID);
      expect(invoke).toHaveBeenLastCalledWith('collab:setLiveNotes', []);
    } finally {
      if (previous === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previous;
      publishLiveSessions();
    }
  });
});

// ==================== État du canal ====================

describe('session — l’état dit la VÉRITÉ sur le rejeu', () => {
  it('distingue « canal ouvert » de « rejeu terminé »', async () => {
    const seen: string[] = [];
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      onStatus: (s) => seen.push(s),
      providerOptions: providerOptions(),
    })!;
    await waitUntil(() => room.sockets.length > 0, 'socket jamais créé');

    room.openAll();
    await settle();
    // Le socket est ouvert, mais le relais n'a pas fini de nous rattraper :
    // confondre les deux faisait semer l'éditeur trop tôt — et DUPLIQUER la note.
    expect(session.status).toBe('connected');
    expect(session.synced).toBe(false);

    room.sockets[0].deliver(buildControlFrame(CollabControl.ReplayDone).buffer);
    await waitUntil(() => session.status === 'synced', 'la fin du rejeu n’a jamais été publiée');
    expect(session.synced).toBe(true);
    expect(seen).toContain('connected');
    expect(seen).toContain('synced');
  });

  it('projette l’état du transport sans jamais confondre les deux', () => {
    expect(toSessionStatus('connected')).toBe('connected');
    expect(toSessionStatus('synced')).toBe('synced');
    expect(toSessionStatus('connecting')).toBe('connecting');
    expect(toSessionStatus('idle')).toBe('connecting');
    expect(toSessionStatus('offline')).toBe('offline');
    expect(toSessionStatus('unavailable')).toBe('offline');
    expect(toSessionStatus('destroyed')).toBe('offline');
  });
});

// ==================== Contenu à la demande ====================

describe('session — contenu à la demande (le magasin, c’est l’éditeur)', () => {
  it('rend le contenu courant sans jamais l’écrire nulle part', async () => {
    vi.useFakeTimers();
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    write(session.doc, 'sans abonné');
    await vi.advanceTimersByTimeAsync(5000);

    expect(session.getContentJSON()).toContain('sans abonné');
    expect(JSON.parse(session.getContentJSON())).toEqual(session.getTiptapJson());
    expect(session.getContentDoc()).toEqual(session.getTiptapJson());
  });

  it('rend le contenu venu d’un autre appareil', async () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    await waitUntil(() => room.sockets.length > 0, 'socket jamais créé');
    room.openAll();

    const distant = new Y.Doc();
    write(distant, 'venu du navigateur');
    const { encryptFrame, CollabFrameKind } = await import('../collabProtocol');
    const frame = await encryptFrame(key, CollabFrameKind.Update, Y.encodeStateAsUpdate(distant));
    room.sockets[0].deliver(frame.buffer);
    await waitUntil(
      () => session.getContentJSON().includes('venu du navigateur'),
      'la mise à jour distante n’est jamais arrivée'
    );

    expect(session.getTiptapJson().content.length).toBeGreaterThan(0);
    distant.destroy();
  });
});

// ==================== Présence et arrêt ====================

describe('session — présence et arrêt', () => {
  it('pose la présence locale et donne une couleur stable', () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      presence: { name: 'Bureau', color: presenceColorFor('appareil-1') },
      providerOptions: providerOptions(),
    })!;
    const local = session.awareness.getLocalState() as { user?: { name?: string } };
    expect(local.user?.name).toBe('Bureau');
    expect(session.getPeers()).toEqual([]);
    expect(presenceColorFor('appareil-1')).toBe(presenceColorFor('appareil-1'));
    expect(presenceColorFor('appareil-1')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ne laisse aucun minuteur derrière elle', async () => {
    vi.useFakeTimers();
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    write(session.doc, 'dernier mot');
    session.destroy();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
  });

  it('détruire deux fois est sans effet', () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    session.destroy();
    expect(() => session.destroy()).not.toThrow();
  });
});

// ==================== Purge ====================

describe('session — la perte de la FEK emporte tout', () => {
  it('arrête les sessions, détruit les documents et oublie les clés de salle', async () => {
    const session = startCollabSession({
      noteId: NOTE_ID,
      profileId: 'p1',
      providerOptions: providerOptions(),
    })!;
    // Les clés de salle sont mises en cache à l'ouverture du canal. On en
    // dérive aussi une pour une note SANS session : `clearRoomKey` (fin de
    // session) ne la retirerait pas — seul `clearRoomKeys` le fait, et c'est
    // exactement ce que la perte de la FEK exige.
    const { getRoomKey } = await import('../collabKeys');
    vi.spyOn(await import('../../auth/hybridCrypto'), 'exportFEKRaw').mockResolvedValue(FEK);
    await getRoomKey(NOTE_ID);
    await getRoomKey('note-refermee-entre-temps');
    expect(roomKeyCount()).toBe(2);
    expect(yDocManager.hasDoc(NOTE_ID, 'p1')).toBe(true);

    purgeCollabOnKeyLoss();

    expect(session.destroyed).toBe(true);
    expect(isNoteInLiveSession(NOTE_ID)).toBe(false);
    expect(liveNotes()).toEqual([]);
    expect(yDocManager.hasDoc(NOTE_ID, 'p1')).toBe(false);
    expect(roomKeyCount()).toBe(0);
  });
});
