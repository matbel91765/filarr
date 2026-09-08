import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { CollabProvider } from '../collabProvider';
import { deriveRoomKey } from '../collabKeys';
import { CollabControl, CollabFrameKind, buildControlFrame, encryptFrame } from '../collabProtocol';
import {
  FAKE_CLOSED,
  FakeRoom,
  fakeTicket,
  settle,
  waitUntil,
  type FakeSocket,
} from './fakeSocket';

const FEK = new Uint8Array(32).fill(7);
const NOTE_ID = 'note-vivante';

let key: CryptoKey;
const disposers: Array<() => void> = [];

beforeEach(async () => {
  key = await deriveRoomKey(FEK, NOTE_ID);
});

afterEach(() => {
  while (disposers.length) disposers.pop()!();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Peer {
  doc: Y.Doc;
  awareness: Awareness;
  provider: CollabProvider;
  socket: () => FakeSocket;
}

async function makePeer(
  room: FakeRoom,
  overrides: Partial<ConstructorParameters<typeof CollabProvider>[0]> = {}
): Promise<Peer> {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const before = room.sockets.length;
  const provider = new CollabProvider({
    noteId: NOTE_ID,
    profileId: 'profil-1',
    doc,
    awareness,
    createSocket: room.create,
    resolveKey: async () => key,
    resolveTicket: async () => fakeTicket(),
    batchMs: 0,
    snapshotIntervalMs: 0,
    syncGraceMs: 10_000_000,
    ...overrides,
  });
  disposers.push(() => {
    provider.destroy();
    awareness.destroy();
    doc.destroy();
  });
  provider.connect();
  await waitUntil(() => room.sockets.length > before, 'socket jamais créé');
  return { doc, awareness, provider, socket: () => room.sockets[before] };
}

function writeParagraph(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment('content');
  const p = new Y.XmlElement('paragraph');
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  fragment.insert(fragment.length, [p]);
}

function readText(doc: Y.Doc): string {
  return doc.getXmlFragment('content').toString();
}

// ==================== Transport ====================

describe('fournisseur — le trafic est chiffré et converge', () => {
  it('propage une frappe locale à l’autre appareil, en clair nulle part sur le fil', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    const b = await makePeer(room);
    room.openAll();
    await settle();

    writeParagraph(a.doc, 'secret de fabrication');
    await waitUntil(
      () => readText(b.doc).includes('secret de fabrication'),
      'la frappe n’a pas atteint le second appareil'
    );

    // Rien de lisible dans les octets qui ont transité.
    const wire = a
      .socket()
      .sent.map((f) => new TextDecoder('latin1').decode(f))
      .join('|');
    expect(wire).not.toContain('secret');
    expect(a.provider.stats.framesSent).toBeGreaterThan(0);
    expect(b.provider.stats.decryptFailures).toBe(0);
  });

  it('rattrape un pair qui arrive après coup (SyncStep1 → SyncStep2)', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();
    writeParagraph(a.doc, 'écrit avant l’arrivée du second');
    await settle();

    const b = await makePeer(room);
    room.openAll();
    await waitUntil(
      () => readText(b.doc).includes('écrit avant l’arrivée du second'),
      'l’arrivant n’a pas été rattrapé'
    );
  });

  it('ne répond JAMAIS à un SyncStep1 par un autre SyncStep1 (garde anti-ping-pong)', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    const b = await makePeer(room);
    room.openAll();

    const step1 = (s: FakeSocket) =>
      s.sent.filter((f) => f[2] === CollabFrameKind.SyncStep1).length;
    await waitUntil(
      () => step1(a.socket()) >= 1 && step1(b.socket()) >= 1,
      'les vecteurs d’état ne sont jamais partis'
    );
    // On laisse largement le temps à un éventuel ping-pong de s'emballer.
    await settle(80);

    // Un seul SyncStep1 par pair : celui de l'ouverture.
    expect(step1(a.socket())).toBe(1);
    expect(step1(b.socket())).toBe(1);
  });

  it('fusionne les modifications hors ligne des deux côtés', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    const b = await makePeer(room);

    // Chacun écrit AVANT que le canal ne s'ouvre.
    writeParagraph(a.doc, 'côté bureau');
    writeParagraph(b.doc, 'côté navigateur');
    await settle();
    expect(a.provider.stats.updatesDropped).toBeGreaterThan(0);

    room.openAll();
    await waitUntil(
      () =>
        [a, b].every(
          (peer) =>
            readText(peer.doc).includes('côté bureau') &&
            readText(peer.doc).includes('côté navigateur')
        ),
      'les deux versions hors ligne n’ont pas fusionné'
    );
  });
});

// ==================== Robustesse ====================

describe('fournisseur — un message hostile ne tue pas la session', () => {
  it('ignore le bruit, le chiffré d’une autre salle et un octet retourné', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();

    const socket = a.socket();
    const autreSalle = await deriveRoomKey(FEK, 'une-autre-note');

    socket.deliver(new Uint8Array([0, 1, 2, 3, 4, 5]).buffer);
    socket.deliver('un message texte inattendu');
    socket.deliver(
      (await encryptFrame(autreSalle, CollabFrameKind.Update, new Uint8Array([1, 2, 3]))).buffer
    );
    const corrompu = await encryptFrame(key, CollabFrameKind.Update, new Uint8Array([9, 9, 9]));
    corrompu[corrompu.length - 1] ^= 0xff;
    socket.deliver(corrompu.buffer);
    await waitUntil(
      () => a.provider.stats.decryptFailures === 4,
      'les quatre messages hostiles n’ont pas été comptés'
    );

    expect(a.provider.status).not.toBe('destroyed');

    // La session encaisse et continue : un vrai message passe toujours.
    const b = await makePeer(room);
    room.openAll();
    writeParagraph(b.doc, 'toujours vivant');
    await waitUntil(
      () => readText(a.doc).includes('toujours vivant'),
      'la session ne reçoit plus rien après le bruit'
    );
  });

  it('ignore une mise à jour Yjs malformée sans lever', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();

    const frame = await encryptFrame(
      key,
      CollabFrameKind.Update,
      new Uint8Array([255, 255, 255, 255, 255, 255])
    );
    expect(() => a.socket().deliver(frame.buffer)).not.toThrow();
    await waitUntil(
      () => a.provider.stats.decryptFailures > 0,
      'la mise à jour malformée n’a pas été écartée'
    );
    expect(a.provider.status).not.toBe('destroyed');
  });
});

// ==================== Repli ====================

describe('fournisseur — repli silencieux', () => {
  it('coffre verrouillé (pas de clé) : état « unavailable », aucune ouverture réseau', async () => {
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => null,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });
    provider.connect();
    await settle();

    expect(provider.status).toBe('unavailable');
    expect(room.sockets).toHaveLength(0);
    // L'édition locale continue de fonctionner.
    expect(() => writeParagraph(doc, 'hors ligne')).not.toThrow();
    expect(readText(doc)).toContain('hors ligne');
  });

  it('jeton refusé (401, hors ligne) : état « offline », l’édition continue', async () => {
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => null,
      snapshotIntervalMs: 0,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });
    provider.connect();
    await settle();

    expect(provider.status).toBe('offline');
    expect(room.sockets).toHaveLength(0);
    writeParagraph(doc, 'toujours éditable');
    await settle();
    expect(readText(doc)).toContain('toujours éditable');
  });

  it('ouverture du socket impossible : aucune exception ne remonte', async () => {
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: () => {
        throw new Error('CSP: wss bloqué');
      },
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });
    expect(() => provider.connect()).not.toThrow();
    await settle();
    expect(provider.status).toBe('offline');
    expect(provider.stats.lastError).toContain('socket-open');
  });
});

// ==================== Reconnexion ====================

describe('fournisseur — reconnexion avec dégradation exponentielle', () => {
  it('replanifie après une coupure, avec un délai qui croît puis plafonne', async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 4000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.sockets).toHaveLength(1);
    room.openAll();
    expect(provider.status).toBe('connected');

    // Coupure réseau.
    room.last.drop();
    expect(provider.status).toBe('offline');

    // Le palier est ≤ 1000 ms (base × 2⁰, gigue 50-100 %).
    await vi.advanceTimersByTimeAsync(1000);
    expect(room.sockets).toHaveLength(2);
    expect(provider.stats.reconnects).toBe(1);

    // Deuxième échec : socket jamais ouvert, on le coupe.
    room.last.drop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(room.sockets).toHaveLength(3);

    // Le plafond tient : même après plusieurs échecs, 4000 ms suffisent.
    for (let i = 0; i < 6; i += 1) {
      const avant = room.sockets.length;
      room.last.drop();
      await vi.advanceTimersByTimeAsync(4000);
      expect(room.sockets.length).toBe(avant + 1);
    }
  });

  it('HORS LIGNE, LES TENTATIVES S’ESPACENT — sans jamais s’arrêter', async () => {
    /**
     * LE BRUIT QU'ON TAIT, ET CELUI QU'ON NE TAIT PAS.
     *
     * Chaque tentative commence par un `POST /collab/token` ; sans réseau, le
     * navigateur inscrit lui-même dans la console une ligne d'échec de
     * chargement que le client ne peut pas supprimer. La rampe (1 s, 2, 4, 8…)
     * en produisait une demi-douzaine par minute pour une salle qui attend
     * simplement son heure — un bruit qui RESSEMBLE à une panne et qui noie ce
     * qui en serait vraiment une.
     *
     * `navigator.onLine` NE DÉCIDE DE RIEN : il ne fait que porter le délai au
     * plafond. C'est ce qui rend son usage sûr — s'il ment, le pire est une
     * reconnexion trouvée un palier plus tard, jamais une salle abandonnée.
     * C'est précisément ce que ce test vérifie : au plafond, ça repart QUAND
     * MÊME.
     */
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // gigue figée : délai = palier / 2
    /**
     * `navigator` est POSÉ, pas espionné : l'environnement `node` de cette suite
     * n'a pas d'`onLine`, et le fournisseur le lit par `typeof` précisément pour
     * survivre à cette absence.
     */
    const navPrecedent = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const faux = { onLine: false };
    Object.defineProperty(globalThis, 'navigator', { value: faux, configurable: true });
    const ecouteurs = new Map<string, Array<() => void>>();
    const fenetrePrecedente = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, fn: () => void) => {
        ecouteurs.set(type, [...(ecouteurs.get(type) ?? []), fn]);
      },
      removeEventListener: () => undefined,
    };
    const rendre = () => {
      if (navPrecedent) Object.defineProperty(globalThis, 'navigator', navPrecedent);
      else delete (globalThis as { navigator?: unknown }).navigator;
      if (fenetrePrecedente === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = fenetrePrecedente;
    };
    disposers.push(rendre);

    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 8000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.sockets).toHaveLength(1);
    room.openAll();
    room.last.drop();

    // Le premier palier vaudrait 500 ms (base × 2⁰ × gigue) : il ne suffit plus.
    await vi.advanceTimersByTimeAsync(500);
    expect(room.sockets).toHaveLength(1);
    // Mais on N'A PAS RENONCÉ — le plafond arrive, et la tentative part.
    await vi.advanceTimersByTimeAsync(7500);
    expect(room.sockets).toHaveLength(2);

    // Et la ligne revenue court-circuite l'attente : `online` ne dépend d'aucun
    // palier, il l'annule.
    faux.onLine = true;
    room.last.drop();
    for (const fn of ecouteurs.get('online') ?? []) fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(room.sockets).toHaveLength(3);
  });

  it('remet le compteur à zéro quand la connexion tient vraiment', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0); // gigue figée : délai = palier / 2
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 60_000,
      stableAfterMs: 5000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    room.openAll();
    expect(provider.status).toBe('connected');
    // Socket ouvert ASSEZ LONGTEMPS pour compter comme une vraie connexion.
    await vi.advanceTimersByTimeAsync(5000);

    room.last.drop();
    await vi.advanceTimersByTimeAsync(500); // reparti du premier palier (1000 / 2)
    expect(room.sockets).toHaveLength(2);
  });

  it('la fin du rejeu remet le compteur à zéro sans attendre le palier de stabilité', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 60_000,
      stableAfterMs: 10_000_000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    room.openAll();
    room.last.deliver(buildControlFrame(CollabControl.ReplayDone).buffer);
    await vi.advanceTimersByTimeAsync(0);
    expect(provider.synced).toBe(true);

    room.last.drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(room.sockets).toHaveLength(2);
  });

  it('un REFUS du relais (poignée de main terminée, puis close) n’efface pas la dégradation', async () => {
    // Le relais accepte la connexion AVANT de refuser, pour que le client
    // puisse lire le code : le navigateur émet donc 'open' PUIS 'close'.
    // Remettre le compteur à zéro sur 'open' produisait une tempête de
    // reconnexion contre un relais qui refuse à chaque fois.
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 60_000,
      stableAfterMs: 5000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    // 4006 « salle pleine » : refus RÉESSAYABLE, donc la dégradation doit jouer.
    room.last.refuse(4006);
    await vi.advanceTimersByTimeAsync(500); // palier 1 : 1000 / 2
    expect(room.sockets).toHaveLength(2);

    room.last.refuse(4006);
    await vi.advanceTimersByTimeAsync(1000); // palier 2 : 2000 / 2
    expect(room.sockets).toHaveLength(3);

    room.last.refuse(4006);
    // Palier 3 = 4000 / 2 : une demi-seconde ne suffit PLUS.
    await vi.advanceTimersByTimeAsync(500);
    expect(room.sockets).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1500);
    expect(room.sockets).toHaveLength(4);
  });

  it('abandonne sur un refus définitif et réessaie sur un jeton périmé', async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    const doc = new Y.Doc();
    let tickets = 0;
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => {
        tickets += 1;
        return fakeTicket();
      },
      snapshotIntervalMs: 0,
      syncGraceMs: 10_000_000,
      reconnectBaseMs: 1000,
      reconnectCapMs: 4000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(tickets).toBe(1);

    // 4003 « jeton périmé » : un billet neuf répare, on réessaie.
    room.last.refuse(4003);
    await vi.advanceTimersByTimeAsync(4000);
    expect(room.sockets).toHaveLength(2);
    expect(tickets).toBe(2);

    // 4002 « signature fausse » : réessayer ne changera rien.
    room.last.refuse(4002);
    expect(provider.status).toBe('unavailable');
    expect(provider.stats.lastError).toBe('close:4002');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(room.sockets).toHaveLength(2);
    expect(tickets).toBe(2);

    // Et même une demande explicite ne rouvre rien.
    provider.connect();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(room.sockets).toHaveLength(2);
  });
});

// ==================== Jeton, ouvertures concurrentes, journal ====================

describe('fournisseur — le jeton ne fuit nulle part', () => {
  it('voyage en SOUS-PROTOCOLE, jamais dans l’URL', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();

    const socket = a.socket();
    expect(socket.protocols).toContain('filarr.collab.v1');
    expect(socket.protocols.some((p) => p.startsWith('filarr.token.'))).toBe(true);
    // L'URL est propre : ni query string, ni jeton.
    expect(socket.url).not.toContain('?');
    expect(socket.url).not.toContain('jeton');
  });

  it('ne journalise que le NOM de l’erreur — pas le message, qui porte l’URL', async () => {
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: () => {
        throw new TypeError(
          "Failed to construct 'WebSocket': wss://relais.filarr.test/collab/room/profil-1/note-1"
        );
      },
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket('jeton-tres-secret'),
      snapshotIntervalMs: 0,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await settle();

    expect(provider.stats.lastError).toBe('socket-open:TypeError');
    expect(provider.stats.lastError).not.toContain('wss://');
    expect(provider.stats.lastError).not.toContain('jeton-tres-secret');
  });
});

describe('fournisseur — une seule ouverture à la fois', () => {
  it('le retour du réseau pendant une ouverture en vol n’ouvre pas un second canal', async () => {
    // `_onOnline` ne voit pas de socket tant que la clé n'est pas résolue :
    // sans jeton de génération, une seconde ouverture partait et le socket
    // orphelin finissait par tuer le vivant en se refermant.
    const listeners = new Map<string, Array<() => void>>();
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener: (type: string, fn: () => void) => {
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((f) => f !== fn)
        );
      },
    };
    const previous = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = fakeWindow;

    try {
      const room = new FakeRoom();
      const doc = new Y.Doc();
      let releaseKey: () => void = () => undefined;
      const keyGate = new Promise<void>((resolve) => {
        releaseKey = () => resolve();
      });
      const provider = new CollabProvider({
        noteId: NOTE_ID,
        profileId: 'profil-1',
        doc,
        createSocket: room.create,
        resolveKey: async () => {
          await keyGate;
          return key;
        },
        resolveTicket: async () => fakeTicket(),
        snapshotIntervalMs: 0,
        syncGraceMs: 10_000_000,
      });
      disposers.push(() => {
        provider.destroy();
        doc.destroy();
      });

      provider.connect();
      await settle();
      expect(room.sockets).toHaveLength(0); // toujours suspendu sur la clé

      // Le réseau revient pendant l'attente.
      for (const fn of listeners.get('online') ?? []) fn();
      releaseKey();
      await settle();

      // UNE seule salle ouverte, et c'est elle qui vit.
      expect(room.sockets).toHaveLength(1);
      room.openAll();
      await settle();
      expect(provider.status).toBe('connected');
      expect(room.sockets[0].readyState).not.toBe(FAKE_CLOSED);
    } finally {
      if (previous === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previous;
    }
  });
});

// ==================== Présence ====================

describe('fournisseur — présence chiffrée', () => {
  it('transporte nom, couleur et curseur, sans les exposer sur le fil', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    const b = await makePeer(room);
    room.openAll();
    await settle();

    a.awareness.setLocalStateField('user', { name: 'Bureau de Mathis', color: '#e8836b' });
    const peerState = () =>
      b.awareness.getStates().get(a.doc.clientID) as
        | { user?: { name?: string; color?: string } }
        | undefined;
    await waitUntil(
      () => peerState()?.user?.name === 'Bureau de Mathis',
      'la présence n’a pas atteint le pair'
    );

    const vuParB = peerState();
    expect(vuParB?.user?.name).toBe('Bureau de Mathis');
    expect(vuParB?.user?.color).toBe('#e8836b');

    const wire = a
      .socket()
      .sent.map((f) => new TextDecoder('latin1').decode(f))
      .join('|');
    expect(wire).not.toContain('Mathis');
    expect(wire).not.toContain('e8836b');

    const presenceFrames = a.socket().sent.filter((f) => f[2] === CollabFrameKind.Awareness);
    expect(presenceFrames.length).toBeGreaterThan(0);
  });

  it('retire la présence à la fermeture — le curseur distant ne reste pas figé', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    const b = await makePeer(room);
    room.openAll();
    await settle();

    a.awareness.setLocalStateField('user', { name: 'Bureau', color: '#fff' });
    await waitUntil(
      () => b.awareness.getStates().has(a.doc.clientID),
      'la présence n’est jamais apparue'
    );

    a.provider.destroy();
    await waitUntil(
      () => !b.awareness.getStates().has(a.doc.clientID),
      'le curseur distant est resté figé après la fermeture'
    );
  });
});

// ==================== Instantané et arrêt ====================

describe('fournisseur — instantané et arrêt propre', () => {
  it('n’émet un instantané qu’UNE FOIS À JOUR (règle de compaction du relais)', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room, { syncGraceMs: 10_000_000 });
    room.openAll();
    await settle(20);

    const snapshots = () => a.socket().sent.filter((f) => f[2] === CollabFrameKind.Snapshot).length;
    expect(snapshots()).toBe(0); // rejeu du relais non terminé : rien ne part

    a.socket().deliver(buildControlFrame(CollabControl.ReplayDone).buffer);
    await waitUntil(() => snapshots() === 1, 'aucun instantané après le rejeu');

    expect(a.provider.synced).toBe(true);
    expect(a.provider.status).toBe('synced');
  });

  it('n’envoie PAS d’instantané périodique quand le document n’a pas bougé', async () => {
    // Deux appareils au repos réécrivaient l'état complet dans le stockage du
    // relais toutes les 45 s, pour rien.
    vi.useFakeTimers();
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      batchMs: 0,
      snapshotIntervalMs: 1000,
      syncGraceMs: 10_000_000,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });

    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    room.openAll();
    room.last.deliver(buildControlFrame(CollabControl.ReplayDone).buffer);
    await vi.advanceTimersByTimeAsync(0);

    // L'instantané d'entrée en salle part TOUJOURS : c'est le point de compaction.
    expect(provider.stats.snapshotsSent).toBe(1);

    // Cinq périodes au repos : rien de plus.
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.stats.snapshotsSent).toBe(1);

    // Une frappe, et le suivant repart.
    writeParagraph(doc, 'une modification');
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.stats.snapshotsSent).toBe(2);

    // Puis de nouveau le silence.
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.stats.snapshotsSent).toBe(2);
  });

  it('se déclare à jour au bout du délai de grâce si le relais ne dit rien', async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      snapshotIntervalMs: 0,
      syncGraceMs: 1500,
    });
    disposers.push(() => {
      provider.destroy();
      doc.destroy();
    });
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    room.openAll();
    expect(provider.synced).toBe(false);

    await vi.advanceTimersByTimeAsync(1500);
    expect(provider.synced).toBe(true);
  });

  it('détruit sans laisser UN SEUL minuteur derrière lui', async () => {
    vi.useFakeTimers();
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket: async () => fakeTicket(),
      batchMs: 50,
      snapshotIntervalMs: 5000,
      syncGraceMs: 1500,
      reconnectBaseMs: 1000,
    });
    provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    room.openAll();

    // Minuteur de regroupement + de grâce + intervalle d'instantané en vol.
    writeParagraph(doc, 'frappe en cours');
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    provider.destroy();
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBe(0);
    expect(provider.status).toBe('destroyed');

    // Détruire deux fois est sans effet, et n'ouvre rien.
    provider.destroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(room.sockets).toHaveLength(1);
    doc.destroy();
  });

  it('après destruction, une frappe locale n’ouvre plus rien et ne lève pas', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();
    a.provider.destroy();
    // Le socket n'est fermé qu'APRÈS les adieux (dernier instantané + retrait
    // de présence) : c'est le signal fiable que plus rien ne peut partir.
    await waitUntil(() => a.socket().readyState === FAKE_CLOSED, 'le canal n’a jamais été refermé');

    const avant = a.provider.stats.framesSent;
    expect(() => writeParagraph(a.doc, 'après la fin')).not.toThrow();
    await settle();
    expect(a.provider.stats.framesSent).toBe(avant);
    a.provider.connect();
    await settle();
    expect(room.sockets).toHaveLength(1);
  });
});

describe('battement de cœur et départ d’un pair', () => {
  it('émet le ping et se tait sur le pong', async () => {
    // La moitié SERVEUR de ce keepalive existait depuis toujours — la salle
    // déclare le couple ping/pong au runtime — et aucun client ne l'émettait.
    const room = new FakeRoom();
    const a = await makePeer(room, { keepaliveMs: 20 });
    room.openAll();
    await settle();

    const socket = a.socket();
    await waitUntil(() => socket.sentText.includes('ping'), 'aucun ping émis');
    socket.deliver('pong');
    // Un pong n'est pas une trame corrompue : il ne compte pas comme un échec.
    expect(a.provider.stats.decryptFailures).toBe(0);
    expect(a.provider.status).not.toBe('destroyed');
  });

  it('un texte hors protocole reste compté comme hostile', async () => {
    const room = new FakeRoom();
    const a = await makePeer(room, { keepaliveMs: 0 });
    room.openAll();
    await settle();

    a.socket().deliver('autre chose que pong');

    await waitUntil(
      () => a.provider.stats.decryptFailures === 1,
      'le texte hors protocole n’a pas été compté'
    );
  });

  it('coupe le canal après deux pings restés sans réponse', async () => {
    // Le défaut fermé ici : quand le chemin réseau meurt sans FIN TCP, aucun
    // `onclose` n'arrive, `readyState` reste OPEN, et le pair se croit « Live »
    // et détenteur du stylo pendant que les autres l'ont déjà périmé.
    const room = new FakeRoom();
    const a = await makePeer(room, { keepaliveMs: 10 });
    room.openAll();
    await settle();

    await waitUntil(
      () => a.provider.stats.reconnects > 0 || a.provider.status !== 'synced',
      'la session est restée « vivante » sur un canal muet'
    );
  });

  it('rend son verdict EN TROIS ÉCHÉANCES, pas quatre — la mesure, pas le principe', async () => {
    // Le compteur montait avant le premier envoi : « deux manqués » se produisait
    // donc à la QUATRIÈME échéance. Avec la période par défaut, le verdict
    // tombait à soixante secondes — après les trente secondes de péremption
    // d'`Awareness` que ce battement doit précisément devancer. Le test compte
    // les échéances, parce que c'est la seule chose qui distinguait les deux
    // versions : toutes deux finissaient par couper.
    const room = new FakeRoom();
    const periode = 10;
    const a = await makePeer(room, { keepaliveMs: periode });
    room.openAll();
    await settle();

    const debut = Date.now();
    await waitUntil(
      () => a.provider.stats.reconnects > 0 || a.provider.status !== 'synced',
      'la session est restée « vivante » sur un canal muet'
    );
    const echeances = (Date.now() - debut) / periode;

    // Trois échéances : ping, ping, verdict. Une marge large absorbe la
    // granularité des minuteurs sans laisser passer un quatrième cycle.
    expect(echeances).toBeLessThan(4);
  });

  it('avec la période par défaut, le verdict précède la péremption d’Awareness', async () => {
    // La contrainte n'est pas esthétique : un pair périmé chez les autres avant
    // de s'être su déconnecté garde le stylo d'enregistrement dans une élection
    // que plus personne ne peut lui reprendre.
    const AWARENESS_TIMEOUT_MS = 30_000;
    const room = new FakeRoom();
    const a = await makePeer(room);
    room.openAll();
    await settle();

    // Trois échéances de la période par défaut, telle que le fournisseur l'applique.
    const periode = (a.provider as unknown as { _opts: { keepaliveMs: number } })._opts.keepaliveMs;
    expect(periode * 3).toBeLessThan(AWARENESS_TIMEOUT_MS);
  });
});

describe('renouvellement du billet', () => {
  it('rouvre le canal AVANT l’expiration, sans passer par « hors ligne »', async () => {
    // Le relais ferme en 4003 à la première trame émise au-delà de l'échéance,
    // et la présence se renouvelle toutes les 15 s : il y a toujours une trame
    // pour déclencher la coupure. Le client l'apprenait par la fermeture, si
    // bien que chaque membre voyait défiler « Hors ligne », « Connexion… »,
    // « Synchronisation… », « Live » quatre fois par heure — alors que rien
    // n'avait jamais été hors ligne.
    const room = new FakeRoom();
    const statuts: string[] = [];
    const a = await makePeer(room, {
      keepaliveMs: 0,
      onStatus: (s: string) => statuts.push(s),
      // Billet très court : le renouvellement est armé à 80 % de sa vie.
      resolveTicket: async () => ({ ...fakeTicket(), expiresAt: Date.now() + 60 }),
    });
    room.openAll();
    await settle();

    const premier = a.socket();
    await waitUntil(
      () => room.sockets.length > 1,
      'le billet n’a pas été renouvelé avant son expiration'
    );

    // Le canal a bien été REMPLACÉ, et non repris après une coupure subie.
    expect(room.sockets.length).toBeGreaterThan(1);
    expect(room.sockets[room.sockets.length - 1]).not.toBe(premier);
    expect(statuts).not.toContain('offline');
  });
});

describe('un membre retiré du coffre l’apprend, et cesse d’essayer', () => {
  /** Un fournisseur qui n'obtiendra JAMAIS de socket : makePeer, lui, en attend un. */
  function sansSocket(resolveTicket: () => Promise<'denied' | null>) {
    const room = new FakeRoom();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const provider = new CollabProvider({
      noteId: NOTE_ID,
      profileId: 'profil-1',
      doc,
      awareness,
      createSocket: room.create,
      resolveKey: async () => key,
      resolveTicket,
      batchMs: 0,
      snapshotIntervalMs: 0,
      keepaliveMs: 0,
    });
    disposers.push(() => {
      provider.destroy();
      awareness.destroy();
      doc.destroy();
    });
    provider.connect();
    return { provider, room };
  }

  it('abandonne sur un refus du serveur, au lieu de boucler en « hors ligne »', async () => {
    // 401/403/404 disent que le serveur a RÉPONDU et qu'il dit non : on n'est
    // plus membre. Réessayer ne peut rien produire — l'appartenance ne revient
    // pas toute seule. Avant, la session redemandait un jeton toutes les trente
    // secondes indéfiniment, en affichant le même « hors ligne » qu'un Wi-Fi
    // capricieux ; et comme cet état compte comme stabilisé, l'exclu finissait
    // seul donc élu, à pousser un enregistrement refusé toutes les six secondes.
    const { provider, room } = sansSocket(async () => 'denied' as const);

    // Un état PROPRE, distinct d'`unavailable` : celui-ci dit « pas de clé pour
    // l'instant » (coffre verrouillé) et se répare au déverrouillage. Les
    // confondre laissait l'exclusion se lire comme un état passager.
    await waitUntil(
      () => provider.status === 'denied',
      'le refus n’a pas produit d’état « refusé »'
    );
    expect(provider.stats.lastError).toBe('room-access-denied');

    // Et surtout : plus aucune tentative.
    await new Promise((r) => setTimeout(r, 80));
    expect(room.sockets.length).toBe(0);
  });

  it('une panne réseau, elle, continue d’espérer', async () => {
    // La distinction est tout le sujet : un jeton absent parce que le réseau est
    // tombé doit encore réessayer, un refus non.
    const { provider } = sansSocket(async () => null);

    await waitUntil(() => provider.status === 'offline', 'pas passé hors ligne');
    expect(provider.stats.lastError).toBe('no-ticket');
  });
});

describe('l’appel nominal ne retire QUE les pairs disparus', () => {
  /** Le relais envoie l'adieu à TOUS les restants (`noteRoom.onSocketGone`). */
  function annonceUnDepart(...peers: Peer[]): void {
    for (const p of peers) p.socket().deliver(buildControlFrame(CollabControl.PeerLeft).buffer);
  }

  async function deuxPairsQuiSeVoient(room: FakeRoom) {
    const a = await makePeer(room, { keepaliveMs: 0, rollCallGraceMs: 40 });
    const b = await makePeer(room, { keepaliveMs: 0, rollCallGraceMs: 40 });
    room.openAll();
    a.awareness.setLocalState({ user: { name: 'A' } });
    b.awareness.setLocalState({ user: { name: 'B' } });
    await settle();
    await waitUntil(() => a.awareness.getStates().size >= 2, 'les deux pairs ne se voient pas');
    return { a, b };
  }

  it('un pair qui se réannonce survit à l’appel', async () => {
    // Le défaut trouvé en revue : la réannonce n'incrémentait pas l'horloge
    // d'Awareness, donc `applyAwarenessUpdate` l'écartait comme un doublon et
    // l'appel nominal ne voyait AUCUNE réponse. Il retirait alors des pairs
    // vivants — l'inverse exact de ce qu'il devait faire, et un curseur qui
    // disparaît sous les yeux de tout le monde à chaque départ.
    const room = new FakeRoom();
    const { a, b } = await deuxPairsQuiSeVoient(room);

    annonceUnDepart(a, b);
    await new Promise((r) => setTimeout(r, 120));

    expect(a.awareness.getStates().has(b.awareness.clientID)).toBe(true);
    expect(b.awareness.getStates().has(a.awareness.clientID)).toBe(true);
  });

  it('un pair réellement disparu est retiré sans attendre la péremption', async () => {
    const room = new FakeRoom();
    const { a, b } = await deuxPairsQuiSeVoient(room);

    // B est parti pour de bon : son socket ne porte plus rien, il ne peut pas
    // répondre à l'appel. Seul A reçoit l'adieu — c'est ce que fait le relais.
    b.provider.destroy();
    b.socket().deliver = () => {};
    annonceUnDepart(a);
    await new Promise((r) => setTimeout(r, 120));

    expect(a.awareness.getStates().has(b.awareness.clientID)).toBe(false);
  });
});
