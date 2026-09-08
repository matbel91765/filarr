/**
 * Session sur un élément de coffre — la façade, vue du dehors.
 *
 * L'élection est testée ici À TRAVERS L'AWARENESS RÉELLE plutôt que sur des
 * listes fabriquées : c'est le seul moyen de vérifier que le scrutin voit
 * vraiment ce qu'un pair publie, et qu'un départ de salle le fait basculer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import {
  startVaultCollabSession,
  getVaultCollabSession,
  stopAllCollabSessions,
  isNoteInLiveSession,
  liveSessionNoteIds,
  startCollabSession,
  collabSessionRefCount,
  purgeVaultCollab,
  type CollabSession,
} from '../collabSession';
import { overrideCollabEnabled } from '../collabFlag';
import { deriveVaultRoomKey, clearRoomKeys } from '../collabKeys';
import { clearLiveNotes, liveNotes } from '../liveNoteRegistry';
import yDocManager from '../../notes/yDocManager';
import { FakeRoom, fakeVaultTicket, settle, waitUntil } from './fakeSocket';
import { CollabControl, buildControlFrame } from '../collabProtocol';

const K_VAULT = new Uint8Array(32).fill(4);
const VAULT_ID = 'coffre-1';
const ITEM_ID = 'element-1';
const ROOM_ID = `vault:${VAULT_ID}:${ITEM_ID}`;

let key: CryptoKey;
let room: FakeRoom;

beforeEach(async () => {
  key = await deriveVaultRoomKey(K_VAULT, VAULT_ID, ITEM_ID);
  room = new FakeRoom();
  overrideCollabEnabled(true);
});

afterEach(() => {
  stopAllCollabSessions();
  yDocManager.destroyAll();
  clearLiveNotes();
  clearRoomKeys();
  overrideCollabEnabled(null);
  vi.restoreAllMocks();
});

function providerOptions(overrides: Record<string, unknown> = {}) {
  return {
    createSocket: room.create,
    resolveKey: async () => key,
    resolveTicket: async () => fakeVaultTicket('member'),
    batchMs: 0,
    snapshotIntervalMs: 0,
    syncGraceMs: 10_000_000,
    ...overrides,
  };
}

function open(
  role: 'owner' | 'admin' | 'member' | 'viewer' = 'member',
  overrides: Record<string, unknown> = {},
  profileId = 'profil-1'
): CollabSession {
  return startVaultCollabSession({
    vaultId: VAULT_ID,
    itemId: ITEM_ID,
    epoch: 1,
    profileId,
    presence: { name: 'alice@filarr.test', color: '#2563eb', role, memberId: 'u-alice' },
    providerOptions: providerOptions(overrides),
  })!;
}

/**
 * Fabrique un pair distant et injecte sa présence dans la salle, exactement
 * comme une trame Awareness le ferait. `clientId` est imposé pour piloter
 * l'ordre du scrutin.
 */
function joinPeer(
  session: CollabSession,
  clientId: number,
  role: string,
  name = 'bob@filarr.test'
): { leave: () => void } {
  const doc = new Y.Doc();
  doc.clientID = clientId;
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', { name, color: '#059669', role, memberId: 'u-bob' });
  applyAwarenessUpdate(session.awareness, encodeAwarenessUpdate(awareness, [clientId]), 'test');
  return {
    leave: () => {
      removeAwarenessStates(awareness, [clientId], 'test');
      applyAwarenessUpdate(session.awareness, encodeAwarenessUpdate(awareness, [clientId]), 'test');
      doc.destroy();
    },
  };
}

// ==================== Ouverture ====================

describe('salle de coffre — ouverture', () => {
  it('s’identifie par (coffre, élément) et se retrouve par ce couple', () => {
    const session = open();
    expect(session.noteId).toBe(ROOM_ID);
    expect(session.vault).toEqual({ vaultId: VAULT_ID, itemId: ITEM_ID });
    expect(getVaultCollabSession(VAULT_ID, ITEM_ID)).toBe(session);
  });

  it('S’OUVRE MÊME DRAPEAU ÉTEINT — le réglage ne gouverne QUE mes appareils', () => {
    /**
     * LE DÉFAUT RAPPORTÉ APRÈS UN ESSAI RÉEL : « à deux, l'écriture ne
     * fonctionne pas ». Aucun octet ne partait, parce qu'une salle de COFFRE
     * empruntait le drapeau `filarr-live-collab` — éteint par défaut, et dont
     * l'intitulé promet « l'édition vivante entre MES APPAREILS ». Deux membres
     * d'un coffre partagé n'avaient aucune raison de l'allumer.
     *
     * Le réglage garde son sens pour une note personnelle : la vérité y est un
     * fichier local, la salle est un CONFORT, et ouvrir un canal permanent
     * mérite un consentement. Un élément de coffre n'a pas ce luxe — sa vérité
     * est un objet nuage unique gardé par un compare-and-set, et sans salle
     * deux membres l'écrivent à l'aveugle.
     */
    overrideCollabEnabled(false);
    const session = startVaultCollabSession({
      vaultId: VAULT_ID,
      itemId: ITEM_ID,
      epoch: 1,
      profileId: 'profil-1',
      providerOptions: providerOptions(),
    });
    expect(session).not.toBeNull();
    expect(session?.noteId).toBe(ROOM_ID);
  });

  it('et une note PERSONNELLE, elle, reste fermée drapeau éteint', () => {
    // La frontière est là, et elle ne bouge pas : le réglage continue de
    // gouverner exactement ce que son intitulé annonce.
    overrideCollabEnabled(false);
    expect(
      startCollabSession({
        noteId: 'note-perso-1',
        profileId: 'profil-1',
        providerOptions: providerOptions(),
      })
    ).toBeNull();
    expect(room.sockets).toHaveLength(0);
  });

  it('refuse d’ouvrir sans profil ou sur des identifiants bancals', () => {
    const base = { itemId: ITEM_ID, epoch: 1, profileId: 'profil-1' };
    expect(startVaultCollabSession({ ...base, vaultId: VAULT_ID, profileId: '' })).toBeNull();
    expect(startVaultCollabSession({ ...base, vaultId: 'coffre:1' })).toBeNull();
    expect(startVaultCollabSession({ ...base, vaultId: VAULT_ID, itemId: 'el/1' })).toBeNull();
    expect(room.sockets).toHaveLength(0);
  });

  it('ne publie PAS la salle dans la liste des notes vivantes du processus principal', () => {
    const personal = startCollabSession({
      noteId: 'note-perso',
      profileId: 'profil-1',
      providerOptions: providerOptions(),
    })!;
    open();
    // La garde de fusion `notes.enc` ne concerne pas les éléments de coffre, et
    // un identifiant de coffre n'a rien à faire dans ce canal.
    expect(liveSessionNoteIds()).toEqual(['note-perso']);
    expect(liveNotes()).toEqual(['note-perso']);
    // La session existe pourtant bien.
    expect(isNoteInLiveSession(ROOM_ID)).toBe(true);
    personal.release();
  });

  it('partage la salle entre deux ouvertures du même élément (comptage de références)', () => {
    const first = open();
    const second = open();
    expect(second).toBe(first);
    first.release();
    expect(first.destroyed).toBe(false);
    second.release();
    expect(second.destroyed).toBe(true);
  });
});

// ==================== Élection ====================

describe('salle de coffre — qui enregistre', () => {
  it('un membre SEUL en salle est le responsable', () => {
    const session = open('member');
    expect(session.isSaveResponsible(true)).toBe(true);
    expect(session.getSaveResponsible()).toBe(session.awareness.clientID);
  });

  it('un pair au plus petit identifiant nous retire la charge', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID - 1, 'member');
    expect(session.getSaveResponsible()).toBe(session.awareness.clientID - 1);
    expect(session.isSaveResponsible(true)).toBe(false);
  });

  it('un pair au plus GRAND identifiant ne change rien', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID + 1, 'member');
    expect(session.isSaveResponsible(true)).toBe(true);
  });

  it('LA REPRISE : le départ du responsable nous rend la charge, sans négociation', () => {
    const session = open('member');
    const peer = joinPeer(session, session.awareness.clientID - 1, 'admin');
    expect(session.isSaveResponsible(true)).toBe(false);

    peer.leave();

    expect(session.getSaveResponsible()).toBe(session.awareness.clientID);
    expect(session.isSaveResponsible(true)).toBe(true);
  });

  it('UN LECTEUR N’ENREGISTRE JAMAIS, même seul dans la salle', () => {
    const session = open('viewer');
    expect(session.isSaveResponsible(true)).toBe(false);
    expect(session.getSaveResponsible()).toBeNull();
  });

  it('un lecteur au plus petit identifiant ne nous prend pas la charge', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID - 1, 'viewer');
    expect(session.isSaveResponsible(true)).toBe(true);
  });

  it('n’élit personne quand la salle n’est faite que de lecteurs', () => {
    const session = open('viewer');
    joinPeer(session, session.awareness.clientID - 1, 'viewer');
    expect(session.getSaveResponsible()).toBeNull();
  });

  it('n’enregistre pas tant que la salle n’est pas stabilisée', () => {
    const session = open('member');
    expect(session.isSaveResponsible(false)).toBe(false);
  });

  it('adopte le rôle RESTRICTIF que le relais a inscrit dans le jeton', async () => {
    // Le client se croit membre ; le relais, lui, a émis un jeton de lecteur.
    // C'est le relais qui fait autorité sur ce qu'il acceptera de relayer.
    const session = open('member', { resolveTicket: async () => fakeVaultTicket('viewer') });
    await waitUntil(() => session.getPresence()?.role === 'viewer', 'rôle serveur jamais adopté');
    expect(session.isSaveResponsible(true)).toBe(false);
  });

  it('n’élargit PAS nos droits quand le relais annonce mieux que notre rôle local', async () => {
    const session = open('viewer', { resolveTicket: async () => fakeVaultTicket('owner') });
    await settle();
    expect(session.getPresence()?.role).toBe('viewer');
    expect(session.isSaveResponsible(true)).toBe(false);
  });

  /**
   * DEUX PAIRS HORS LIGNE S'ÉLISENT TOUS LES DEUX — le défaut de la plainte.
   *
   * Le relais est injoignable (jeton refusé, `COLLAB_ROOM_SECRET` absent,
   * pare-feu, 429) : chaque session passe « hors ligne » et ne voit personne.
   * L'API des coffres, elle, répond parfaitement aux deux. Tant qu'« hors
   * ligne » vaut « stabilisé », chacun se croit seul, chacun est élu, et chacun
   * pousse un enregistrement automatique sur le MÊME objet nuage : le second
   * récolte 409 item_version_conflict, toutes les six secondes.
   *
   * La salle est le seul témoin possible de l'autre pair. Sans elle, le défaut
   * de position est « je n'enregistre pas tout seul », pas l'inverse.
   */
  it('LE DÉFAUT : hors ligne, la valeur par défaut n’élit PLUS le pair de coffre', async () => {
    const session = open('member', { resolveTicket: async () => null });
    await waitUntil(
      () => session.status === 'offline',
      'la session n’est jamais passée hors ligne'
    );
    expect(session.isSaveResponsible()).toBe(false);
    // Le scrutin lui-même n'a pas changé : c'est bien la STABILISATION qui
    // manque, et un appelant qui l'affirme reste souverain (le bouton manuel).
    expect(session.getSaveResponsible()).toBe(session.awareness.clientID);
    expect(session.isSaveResponsible(true)).toBe(true);
  });
});

// ==================== Gel et dégel, vus du relais ====================

/**
 * F23 — LE SEUL MAILLON QUI CONVERTIT UN JETON EN LECTURE SEULE.
 *
 * `shouldWriteBackVaultNote` refuse bien d'écrire sur `serverReadOnly: true`,
 * mais on le lui passe à la main : personne ne vérifiait que ce booléen se met
 * à VRAI tout seul quand le relais signe un billet de lecteur. Une garde que
 * rien ne fait échouer ne garde rien — ces quatre cas-ci tombent si
 * `_adoptServerRole` cesse d'annoncer le gel, ou cesse de le lever.
 */
describe('salle de coffre — le gel arrive par le jeton, et le dégel aussi (F23)', () => {
  /**
   * Un billet dont le rôle CHANGE d'une ouverture à l'autre. C'est le vrai
   * trajet : le worker répond `role:'viewer'` tant que le coffre est gelé, puis
   * `role:'member'` au renouvellement qui suit le dégel. `reconnectBaseMs` est
   * ramené à la milliseconde pour que la reconnexion — porteuse du billet
   * suivant — n'attende pas la gigue d'une seconde.
   */
  function billetMouvant(initial: string | null) {
    const boite = { role: initial };
    return {
      boite,
      opts: {
        resolveTicket: async () => fakeVaultTicket(boite.role),
        reconnectBaseMs: 1,
      },
    };
  }

  it('un jeton de LECTEUR met la salle en lecture seule et réveille ses abonnés', async () => {
    const { opts } = billetMouvant('viewer');
    const session = open('admin', opts);
    const vus: boolean[] = [];
    session.onServerReadOnly((ro) => vus.push(ro));
    await waitUntil(() => session.serverReadOnly, 'la lecture seule n’a jamais été annoncée');
    expect(vus).toEqual([true]);
  });

  it('LE DÉGEL SE LÈVE TOUT SEUL : le billet suivant rend la salle éditable', async () => {
    const { boite, opts } = billetMouvant('viewer');
    const session = open('admin', opts);
    const vus: boolean[] = [];
    session.onServerReadOnly((ro) => vus.push(ro));
    await waitUntil(() => session.serverReadOnly, 'la lecture seule n’a jamais été annoncée');

    // Le coffre est dégelé : le relais rendra désormais un billet qui écrit.
    boite.role = 'member';
    room.last.drop();

    await waitUntil(() => !session.serverReadOnly, 'le dégel n’a jamais été annoncé');
    expect(vus).toEqual([true, false]);
  });

  it('un billet SANS rôle (salle personnelle) n’affirme rien du tout', async () => {
    const { opts } = billetMouvant(null);
    const session = open('member', opts);
    const vus: boolean[] = [];
    session.onServerReadOnly((ro) => vus.push(ro));
    await waitUntil(() => room.sockets.length > 0, 'aucun canal n’a été ouvert');
    await settle();
    expect(session.serverReadOnly).toBe(false);
    // Une absence de rôle n'est pas un verdict : personne n'est réveillé.
    expect(vus).toEqual([]);
  });

  it('LE DÉGEL REND LA CHARGE D’ENREGISTREMENT — la présence remonte au rôle DÉCLARÉ', async () => {
    const { boite, opts } = billetMouvant('viewer');
    const session = open('admin', opts);
    await waitUntil(() => session.getPresence()?.role === 'viewer', 'rôle serveur jamais adopté');
    expect(session.isSaveResponsible(true)).toBe(false);

    boite.role = 'member';
    room.last.drop();
    await waitUntil(() => !session.serverReadOnly, 'le dégel n’a jamais été annoncé');

    // Le serveur dit ce qu'on a le droit de faire MAINTENANT, pas quel rang on
    // tient : on remonte au rôle que l'écran a DÉCLARÉ, jamais à celui du billet.
    expect(session.getPresence()?.role).toBe('admin');
    expect(session.isSaveResponsible(true)).toBe(true);
  });
});

// ==================== Version committée ====================

describe('salle de coffre — la version committée circule', () => {
  /** Deux membres RÉELLEMENT connectés au même relais, chacun son document. */
  async function pair(): Promise<{ alice: CollabSession; bob: CollabSession }> {
    const alice = open('member', {}, 'profil-alice');
    const bob = open('member', {}, 'profil-bob');
    await waitUntil(() => room.sockets.length >= 2, 'les deux canaux ne se sont pas ouverts');
    room.openAll();
    await settle();
    return { alice, bob };
  }

  it('LE CŒUR DU DÉFAUT : un pair non élu adopte la version que l’élu vient d’écrire', async () => {
    const { alice, bob } = await pair();
    expect(bob.getCommittedVersion()).toBeNull();

    // Alice est l'élue : elle committe v4 et l'annonce.
    alice.publishCommittedVersion(4);

    // Sans cette circulation, Bob resterait sur la version de son chargement —
    // et son premier enregistrement une fois promu partirait en 409, pour
    // toujours.
    await waitUntil(() => bob.getCommittedVersion() === 4, 'version jamais parvenue au pair');
  });

  it('LE SCÉNARIO COMPLET : l’élu enregistre, l’élu part, le promu enregistre SANS conflit', async () => {
    const { alice, bob } = await pair();

    // Le coffre, réduit à ce qui compte : une version, et une garde dessus.
    let stored = 3;
    const commit = (expectedVersion: number): 'ok' | 'conflict' => {
      if (expectedVersion !== stored) return 'conflict';
      stored += 1;
      return 'ok';
    };

    // Les deux ont ouvert l'élément en v3.
    let aliceGuard: number | null = 3;
    let bobGuard: number | null = 3;
    const adopt = (current: number | null, announced: number) =>
      current === null || announced > current ? announced : current;
    const offBob = bob.onCommittedVersion((v) => {
      bobGuard = adopt(bobGuard, v);
    });

    // 1. Alice, élue, enregistre.
    expect(commit(aliceGuard!)).toBe('ok');
    aliceGuard = aliceGuard! + 1;
    alice.publishCommittedVersion(aliceGuard);
    await waitUntil(() => bobGuard === 4, 'la version committée n’a pas atteint le pair');

    // 2. Alice ferme la note : Bob devient mécaniquement le responsable.
    alice.release();
    expect(alice.destroyed).toBe(true);

    // 3. Bob enregistre. C'est ICI que tout se jouait : avec une version de
    //    référence restée à 3, ce commit part en conflit et n'en sort jamais.
    expect(commit(bobGuard!)).toBe('ok');
    expect(stored).toBe(5);
    offBob();
  });

  it('ne recule JAMAIS : une annonce périmée (journal rejoué, fusion) est ignorée', async () => {
    const session = open('member');
    session.publishCommittedVersion(7);
    session.publishCommittedVersion(5);
    expect(session.getCommittedVersion()).toBe(7);
    session.publishCommittedVersion(7);
    expect(session.getCommittedVersion()).toBe(7);
    session.publishCommittedVersion(8);
    expect(session.getCommittedVersion()).toBe(8);
  });

  it('n’écrit rien dans le DOCUMENT — la version n’est pas du texte', () => {
    const session = open('member');
    session.publishCommittedVersion(12);
    // Le fragment reste vide : la carte de salle est un type de premier niveau
    // distinct, donc elle ne produit aucune transaction ProseMirror et ne peut
    // pas être confondue avec une frappe.
    expect(session.fragment.length).toBe(0);
    expect(session.getContentJSON()).not.toContain('12');
  });

  it('reste muette en régime PERSONNEL — il n’y a rien à arbitrer chez soi', () => {
    const personal = startCollabSession({
      noteId: 'note-perso',
      profileId: 'profil-1',
      providerOptions: providerOptions(),
    })!;
    personal.publishCommittedVersion(9);
    expect(personal.getCommittedVersion()).toBeNull();
    personal.release();
  });

  it('ignore une valeur qui n’est pas un nombre fini', () => {
    const session = open('member');
    session.publishCommittedVersion(Number.NaN);
    session.publishCommittedVersion(Number.POSITIVE_INFINITY);
    expect(session.getCommittedVersion()).toBeNull();
  });
});

// ==================== Semis ====================

describe('salle de coffre — qui sème une salle vide', () => {
  it('un pair seul sème', () => {
    const session = open('member');
    expect(session.isSeedResponsible()).toBe(true);
  });

  it('un seul pair sème — deux semis dupliqueraient la note', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID - 1, 'member');
    // Le CRDT ne perd rien : si les deux versaient le corps déchiffré, la note
    // apparaîtrait en double. Le plus petit identifiant sème, l'autre attend.
    expect(session.isSeedResponsible()).toBe(false);
    expect(session.getSeedResponsible()).toBe(session.awareness.clientID - 1);
  });

  it('LE RÔLE N’ENTRE PAS DANS CE SCRUTIN : un lecteur peut semer', () => {
    // Semer est un geste LOCAL — il n'écrit rien dans le coffre. Une salle de
    // lecteurs qui n'aurait pas de semeur regarderait un document vide au lieu
    // de la note qu'elle a le droit de lire.
    const session = open('viewer');
    expect(session.getSaveResponsible()).toBeNull();
    expect(session.isSeedResponsible()).toBe(true);
  });

  it('un lecteur au plus petit identifiant sème avant nous', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID - 1, 'viewer');
    expect(session.isSeedResponsible()).toBe(false);
    // Mais c'est toujours NOUS qui enregistrons : les deux scrutins sont distincts.
    expect(session.isSaveResponsible(true)).toBe(true);
  });

  it('le départ du semeur nous rend la main', () => {
    const session = open('member');
    const peer = joinPeer(session, session.awareness.clientID - 1, 'member');
    expect(session.isSeedResponsible()).toBe(false);
    peer.leave();
    expect(session.isSeedResponsible()).toBe(true);
  });
});

// ==================== Présence ====================

describe('salle de coffre — présence', () => {
  it('publie le membre et son rôle, pas un nom d’appareil', () => {
    const session = open('admin');
    const local = session.awareness.getLocalState() as {
      user?: { name?: string; role?: string; memberId?: string };
    };
    expect(local.user?.name).toBe('alice@filarr.test');
    expect(local.user?.role).toBe('admin');
    expect(local.user?.memberId).toBe('u-alice');
  });

  it('voit les autres membres avec leur rôle', () => {
    const session = open('member');
    joinPeer(session, session.awareness.clientID + 5, 'viewer', 'carol@filarr.test');
    const peers = session.getPeers();
    expect(peers).toHaveLength(1);
    expect(peers[0].user?.name).toBe('carol@filarr.test');
    expect(peers[0].user?.role).toBe('viewer');
  });
});

// ==================== Verrouillage d'un coffre ====================

describe('salle de coffre — verrouiller le coffre ferme ses salles', () => {
  it('arrête les sessions du coffre visé, quel que soit le nombre de détenteurs', () => {
    const session = open('member');
    // Deux panneaux sur le même élément : le comptage de références ne doit pas
    // empêcher un verrouillage de fermer la salle.
    open('member');
    expect(collabSessionRefCount(ROOM_ID)).toBe(2);

    purgeVaultCollab(VAULT_ID);

    expect(session.destroyed).toBe(true);
    expect(getVaultCollabSession(VAULT_ID, ITEM_ID)).toBeNull();
  });

  it('ne touche ni aux autres coffres ni aux notes personnelles', () => {
    const personal = startCollabSession({
      noteId: 'note-perso',
      profileId: 'profil-1',
      providerOptions: providerOptions(),
    })!;
    const autreCoffre = startVaultCollabSession({
      vaultId: 'coffre-2',
      itemId: ITEM_ID,
      epoch: 1,
      profileId: 'profil-1',
      providerOptions: providerOptions(),
    })!;
    const vise = open('member');

    purgeVaultCollab(VAULT_ID);

    expect(vise.destroyed).toBe(true);
    expect(autreCoffre.destroyed).toBe(false);
    expect(personal.destroyed).toBe(false);
    autreCoffre.release();
    personal.release();
  });
});

// ==================== Repli ====================

describe('salle de coffre — repli', () => {
  it('sans clé (coffre verrouillé) : pas de salle, et le document reste éditable', async () => {
    const session = open('member', { resolveKey: async () => null });
    await waitUntil(() => session.status === 'offline', 'état de repli jamais atteint');
    expect(room.sockets).toHaveLength(0);
    // L'édition locale continue : le CRDT est là, il accepte le texte.
    const p = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    text.insert(0, 'écrit hors salle');
    p.insert(0, [text]);
    session.fragment.insert(0, [p]);
    expect(session.getContentJSON()).toContain('écrit hors salle');
    // Et nous restons responsables de l'enregistrement : personne d'autre ne l'est.
    expect(session.isSaveResponsible(true)).toBe(true);
  });

  it('sans billet (hors ligne, 401) : repli silencieux, aucune exception', async () => {
    const session = open('member', { resolveTicket: async () => null });
    await waitUntil(() => session.status === 'offline', 'état de repli jamais atteint');
    expect(room.sockets).toHaveLength(0);
    expect(session.destroyed).toBe(false);
  });

  it('atteint « en direct » quand le relais annonce la fin de son rejeu', async () => {
    const session = open('member');
    await waitUntil(() => room.sockets.length > 0, 'socket jamais créé');
    room.openAll();
    await settle();
    expect(session.status).toBe('connected');

    room.sockets[0].deliver(buildControlFrame(CollabControl.ReplayDone).buffer);
    await waitUntil(() => session.status === 'synced', 'rejeu jamais annoncé');
    expect(session.synced).toBe(true);
  });

  it('se réannonce quand un pair arrive — sinon il ne nous verrait pas', async () => {
    open('member');
    await waitUntil(() => room.sockets.length > 0, 'socket jamais créé');
    room.openAll();
    await waitUntil(() => room.sockets[0].sent.length > 0, 'rien émis à l’ouverture');
    const before = room.sockets[0].sent.length;

    room.sockets[0].deliver(buildControlFrame(CollabControl.PeerJoined).buffer);
    // La présence n'étant jamais rejouée par le relais, cette réémission est le
    // SEUL moyen pour l'arrivant de nous voir avant le renouvellement périodique.
    await waitUntil(
      () => room.sockets[0].sent.length > before,
      'aucune présence réémise à l’arrivée d’un pair'
    );
  });
});
