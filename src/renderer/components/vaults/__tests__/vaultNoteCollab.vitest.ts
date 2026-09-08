/**
 * Vault-note live collaboration — the rules the editor bends to.
 *
 * The write-back gate is the one that matters: it is the last thing standing
 * between "N peers converged on one text" and "N clients hammering one
 * compare-and-set". Every veto below is a case where writing to the vault would
 * be wrong, and each is tested in isolation because a single missing one turns
 * a quiet room into a conflict loop.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  updateTypingReceipts,
  isTypingNow,
  TYPING_TTL_MS,
  resolveEditSessionId,
  buildEditSessionMeta,
  EDIT_SESSION_GAP_MS,
  adoptCommittedVersion,
  shouldOpenVaultRoom,
  shouldWriteBackVaultNote,
  deriveVaultPresence,
  sameVaultPresence,
  vaultMemberLabel,
  participantInitial,
  VAULT_COLLAB_SAVE_DEBOUNCE_MS,
  vaultRoomSettled,
  loneVaultSaverEligible,
  nextOfflineSince,
  LONE_SAVER_ISOLATION_MS,
  commitCoversDocument,
  reconcileCommittedTitle,
  type VaultAwarenessUser,
} from '../vaultNoteCollab';

const openable = {
  bodyReady: true,
  vaultUnlocked: true,
  collabEligible: true,
  epoch: 1,
  profileId: 'profil-1',
};

describe('opening the room', () => {
  it('opens when the vault is unlocked and a note body is mounted', () => {
    expect(shouldOpenVaultRoom(openable)).toBe(true);
  });

  it('N’A PLUS DE PORTE À RÉGLAGE — un élément de coffre n’est pas une commodité', () => {
    // LE DÉFAUT QUE CECI FERME, et il a été rapporté après un essai réel : « à
    // deux, l’écriture ne fonctionne pas ». La salle ne s’ouvrait jamais, parce
    // qu’elle empruntait le drapeau `filarr-live-collab` — éteint par défaut, et
    // dont l’intitulé promet « l’édition vivante entre MES APPAREILS ». Personne
    // n’avait de raison de l’allumer pour écrire à deux dans un coffre partagé.
    //
    // Pour une note personnelle, ce réglage garde tout son sens : la vérité est
    // un fichier local, la salle est un CONFORT, et ouvrir un canal permanent
    // mérite un consentement. Pour un élément de coffre, la salle n’est pas un
    // confort : c’est la seule chose qui empêche deux membres d’écrire le même
    // objet nuage à l’aveugle. L’éteindre ne rend pas la collaboration privée,
    // elle la rend SILENCIEUSEMENT CONFLICTUELLE — 409 au second qui enregistre.
    //
    // La garde ne connaît donc plus aucun drapeau : ce champ n’existe plus, et
    // en glisser un ne doit rien refermer.
    expect(shouldOpenVaultRoom({ ...openable, flagEnabled: false } as never)).toBe(true);
  });

  it('waits for the decrypted body: a room without a document is noise', () => {
    expect(shouldOpenVaultRoom({ ...openable, bodyReady: false })).toBe(false);
  });

  it('stays shut on a locked vault — there is no K_vault to key it with', () => {
    expect(shouldOpenVaultRoom({ ...openable, vaultUnlocked: false })).toBe(false);
  });

  it('waits for the epoch the mounted body was sealed under', () => {
    // The room key comes from K_vault AT THAT EPOCH. Opening before we know it
    // would key the room on nothing at all.
    expect(shouldOpenVaultRoom({ ...openable, epoch: null })).toBe(false);
  });

  it('l’ÉLIGIBILITÉ appartient à l’appelant — la garde ne connaît plus les formats', () => {
    // L'ancienne règle « seules les notes » était LE point de couplage d'un
    // pipeline générique de bout en bout. Les éditeurs de greffons ouvrent des
    // salles sur des éléments FICHIERS : c'est l'appelant qui affirme que son
    // contenu est un document CRDT, et la garde le croit — ou le refuse.
    expect(shouldOpenVaultRoom({ ...openable, collabEligible: false })).toBe(false);
    expect(shouldOpenVaultRoom({ ...openable, collabEligible: true })).toBe(true);
  });

  it('needs an active profile to scope the document registry', () => {
    expect(shouldOpenVaultRoom({ ...openable, profileId: null })).toBe(false);
  });

  it('LETS A READER IN. They watch live; the write ban lives at the save, not the door', () => {
    // Nothing in the gate mentions the role — deliberately. Excluding readers
    // here would cost them the feature entirely.
    expect(shouldOpenVaultRoom(openable)).toBe(true);
  });
});

const writable = {
  responsible: true,
  localRole: 'member',
  dirty: true,
  saving: false,
  hasConflict: false,
  guardVersion: 4,
  settled: true,
};

describe('writing back', () => {
  it('writes when we are the elected saver and everything is clear', () => {
    expect(shouldWriteBackVaultNote(writable)).toBe(true);
    expect(VAULT_COLLAB_SAVE_DEBOUNCE_MS).toBeGreaterThan(0);
  });

  it('A READER NEVER WRITES — whatever the election says', () => {
    // Checked against OUR role, not the room's opinion of us: a room that
    // wrongly elected us must still not make us write.
    expect(shouldWriteBackVaultNote({ ...writable, localRole: 'viewer' })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...writable, localRole: null })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...writable, localRole: undefined })).toBe(false);
  });

  it('LE PAIR ISOLÉ ÉCRIT QUAND MÊME — sinon le correctif de la salle coûte le texte', () => {
    // `settled` reste faux (le relais n'a jamais montré la salle) mais
    // `loneSaver` a été établi SANS lui : voir `loneVaultSaverEligible`. Sans ce
    // second chemin, une salle qui ne se stabilise jamais tue l'enregistrement
    // automatique d'un coffre où l'on est pourtant seul.
    expect(shouldWriteBackVaultNote({ ...writable, settled: false })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...writable, settled: false, loneSaver: true })).toBe(true);
  });

  it('être seul ne lève AUCUN des autres vetos', () => {
    // L'isolement remplace la preuve de solitude, rien d'autre : un lecteur, un
    // conflit ouvert, un enregistrement en vol ou une garde de version absente
    // restent des refus.
    const lone = { ...writable, settled: false, loneSaver: true };
    expect(shouldWriteBackVaultNote({ ...lone, localRole: 'viewer' })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...lone, hasConflict: true })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...lone, saving: true })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...lone, guardVersion: null })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...lone, serverReadOnly: true })).toBe(false);
    expect(shouldWriteBackVaultNote({ ...lone, dirty: false })).toBe(false);
  });

  it('a peer that is not the saver keeps its hands off the vault', () => {
    expect(shouldWriteBackVaultNote({ ...writable, responsible: false })).toBe(false);
  });

  it('never writes an unchanged document', () => {
    expect(shouldWriteBackVaultNote({ ...writable, dirty: false })).toBe(false);
  });

  it('never stacks a second save on one in flight', () => {
    expect(shouldWriteBackVaultNote({ ...writable, saving: true })).toBe(false);
  });

  it('goes quiet while a conflict is on screen — the user decides, not the timer', () => {
    expect(shouldWriteBackVaultNote({ ...writable, hasConflict: true })).toBe(false);
  });

  it('refuses to write without a version to re-base onto', () => {
    expect(shouldWriteBackVaultNote({ ...writable, guardVersion: null })).toBe(false);
  });

  it('refuses to write before the room settles — that is when two savers exist', () => {
    expect(shouldWriteBackVaultNote({ ...writable, settled: false })).toBe(false);
  });

  /**
   * F23 — LE COFFRE A ÉTÉ GELÉ PENDANT QU'ON ÉCRIVAIT.
   *
   * C'est le seul veto de cette liste qui vient du SERVEUR et non de notre
   * propre état. `POST /collab/token` sur un coffre gelé rend 200 avec
   * `role: 'viewer'` : le relais dégrade le jeton au lieu de fermer la salle
   * (geler veut dire « lecture seule », pas « on éteint la lumière »). Ce
   * signal-là arrive AVANT tout refus d'écriture, et c'est tout son intérêt —
   * sans lui, le pair élu continue de tenter un enregistrement toutes les six
   * secondes, jusqu'à ce que le serveur réponde 409 `vault_frozen`, et l'écran
   * affiche une suite d'échecs pour un état parfaitement normal.
   *
   * NOTRE RÔLE LOCAL, LUI, N'A PAS CHANGÉ (on est toujours membre) : c'est
   * précisément pourquoi il fallait un champ à part plutôt que de tordre
   * `localRole`, qui sert aussi à dire aux autres qui l'on est.
   */
  it('LE SERVEUR NOUS A MIS EN LECTURE SEULE : personne n’écrit, même élu', () => {
    expect(shouldWriteBackVaultNote({ ...writable, serverReadOnly: true })).toBe(false);
    // Et l'absence du champ ne ferme rien : une salle qui n'a rien dit se
    // comporte comme avant la fiche.
    expect(shouldWriteBackVaultNote({ ...writable, serverReadOnly: false })).toBe(true);
    expect(shouldWriteBackVaultNote(writable)).toBe(true);
  });
});

// ── The guard version, as a room-wide fact ───────────────────────────────────

describe('adopting what the room committed', () => {
  it('THE FIX: a peer that never saved still learns the version that was written', () => {
    // The whole point. Peer opened at v3, the elected peer committed v4 and said
    // so. Without adopting it, this peer writes v3 the moment it is promoted and
    // takes a 409 it can never get out of.
    expect(adoptCommittedVersion(3, 4)).toBe(4);
  });

  it('a peer that has no version at all takes the announcement', () => {
    expect(adoptCommittedVersion(null, 4)).toBe(4);
  });

  it('NEVER GOES BACKWARDS — a replayed journal must not un-do a newer load', () => {
    // Joining a stale room replays an old announcement; our own load may be
    // newer (someone saved from outside the room). Taking the older one would
    // manufacture the exact conflict this is meant to prevent.
    expect(adoptCommittedVersion(7, 5)).toBe(7);
    expect(adoptCommittedVersion(7, 7)).toBe(7);
  });

  it('ignores a value that is not a finite number', () => {
    expect(adoptCommittedVersion(3, Number.NaN)).toBe(3);
    expect(adoptCommittedVersion(null, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('the promoted peer writes with the version the room reached, not its own load', () => {
    // End to end, as the editor sees it: two peers load v3, four commits happen
    // in the room, the last one is announced. The promoted peer must present 7.
    let guard: number | null = 3;
    for (const announced of [4, 5, 6, 7]) guard = adoptCommittedVersion(guard, announced);
    expect(guard).toBe(7);
  });
});

// ── Le titre, qui ne voyage PAS par le document partagé ──────────────────────

describe('ce qu’un commit distant a le droit de déclarer enregistré', () => {
  const titre = (localTitle: string, baseTitle: string, committedTitle: string | null) =>
    reconcileCommittedTitle({ localTitle, baseTitle, committedTitle });

  it('LA PERTE FERMÉE : un renommage que le commit n’a pas écrit reste EN ATTENTE', () => {
    /**
     * A renomme « Notes » en « Budget », B tient le stylo et commite avec SON
     * titre. Chez A, l'annonce faisait retomber `dirty` : pastille verte
     * « Enregistré dans le coffre » sur un titre qui venait d'être écrasé.
     * Le titre n'est pas dans le CRDT — le commit d'un pair ne le porte pas.
     */
    const d = titre('Budget', 'Notes', 'Notes');
    expect(d.stillPending).toBe(true);
    // Et rien n'est jeté au passage : notre texte reste à l'écran.
    expect(d.adopt).toBeNull();
  });

  it('L’IGNORANCE NE VAUT PAS UN OUI : sans titre annoncé, l’attente demeure', () => {
    // Un pair d'une version antérieure n'annonce que la version. On ne peut donc
    // pas prouver que notre renommage est parti — et un badge vert affirmé sur
    // une absence d'information est exactement ce que ce chantier ferme.
    expect(titre('Budget', 'Notes', null).stillPending).toBe(true);
    // …mais sans renommage local, il n'y a rien à retenir.
    expect(titre('Notes', 'Notes', null)).toEqual({ adopt: null, stillPending: false });
  });

  it('notre propre commit fait retomber l’attente', () => {
    expect(titre('Budget', 'Notes', 'Budget')).toEqual({ adopt: null, stillPending: false });
  });

  it('LA SECONDE PERTE : sans renommage ici, le titre écrit est ADOPTÉ', () => {
    /**
     * B renomme et commite ; A n'a rien touché. Ne pas adopter laissait A
     * afficher l'ancien titre — et surtout le RÉÉCRIRE par-dessus au prochain
     * enregistrement, puisque c'est le titre affiché qui part dans le commit.
     */
    expect(titre('Notes', 'Notes', 'Budget')).toEqual({ adopt: 'Budget', stillPending: false });
  });

  it('un titre vidé des deux côtés n’est pas un renommage', () => {
    expect(titre('', '', '')).toEqual({ adopt: null, stillPending: false });
  });
});

// ── Presence ─────────────────────────────────────────────────────────────────

type States = ReadonlyMap<number, { user?: VaultAwarenessUser | null } | undefined>;

function states(entries: Array<[number, VaultAwarenessUser | null]>): States {
  return new Map(entries.map(([id, user]) => [id, { user }]));
}

const fallback = { name: 'me@filarr.test', color: '#2563eb' };

describe('presence', () => {
  it('shows MEMBERS, and puts us first', () => {
    const list = deriveVaultPresence(
      states([
        [30, { name: 'carol@filarr.test', color: '#059669', role: 'member' }],
        [10, { name: 'me@filarr.test', color: '#2563eb', role: 'owner' }],
        [20, { name: 'bob@filarr.test', color: '#db2777', role: 'admin' }],
      ]),
      10,
      fallback,
      10
    );
    expect(list.map((p) => p.name)).toEqual([
      'me@filarr.test',
      'bob@filarr.test',
      'carol@filarr.test',
    ]);
    expect(list[0].isLocal).toBe(true);
  });

  it('MARKS A READER AS SUCH — their typing never reaches the vault', () => {
    const list = deriveVaultPresence(
      states([
        [10, { name: 'me@filarr.test', color: '#2563eb', role: 'member' }],
        [20, { name: 'bob@filarr.test', color: '#db2777', role: 'viewer' }],
      ]),
      10,
      fallback,
      10
    );
    expect(list.find((p) => p.clientId === 20)?.isReader).toBe(true);
    expect(list.find((p) => p.clientId === 20)?.role).toBe('viewer');
    expect(list.find((p) => p.clientId === 10)?.isReader).toBe(false);
  });

  it('treats a peer that announced no role as a reader, not as a writer', () => {
    const list = deriveVaultPresence(
      states([
        [10, { name: 'me@filarr.test', color: '#2563eb', role: 'member' }],
        [20, { name: 'mystery', color: '#000' }],
        [30, null],
      ]),
      10,
      fallback,
      10
    );
    expect(list.find((p) => p.clientId === 20)?.isReader).toBe(true);
    expect(list.find((p) => p.clientId === 30)?.isReader).toBe(true);
  });

  it('names the peer that holds the pen', () => {
    const list = deriveVaultPresence(
      states([
        [10, { name: 'me@filarr.test', color: '#2563eb', role: 'member' }],
        [20, { name: 'bob@filarr.test', color: '#db2777', role: 'member' }],
      ]),
      10,
      fallback,
      20
    );
    expect(list.find((p) => p.clientId === 20)?.isSaver).toBe(true);
    expect(list.find((p) => p.clientId === 10)?.isSaver).toBe(false);
  });

  it('marks nobody when the room has no saver at all', () => {
    const list = deriveVaultPresence(
      states([[10, { name: 'me@filarr.test', color: '#2563eb', role: 'viewer' }]]),
      10,
      fallback,
      null
    );
    expect(list.every((p) => !p.isSaver)).toBe(true);
  });

  it('holds the previous list when nothing visible changed (no pointless re-render)', () => {
    const build = (saver: number | null) =>
      deriveVaultPresence(
        states([[10, { name: 'me@filarr.test', color: '#2563eb', role: 'member' }]]),
        10,
        fallback,
        saver
      );
    expect(sameVaultPresence(build(10), build(10))).toBe(true);
    // A change of saver IS visible: the room must repaint.
    expect(sameVaultPresence(build(10), build(null))).toBe(false);
  });
});

describe('member label', () => {
  it('publishes the account email — the identity the vault roster is built on', () => {
    expect(vaultMemberLabel({ email: 'a@b.c', profileName: 'Laptop', userId: 'u1' })).toBe('a@b.c');
  });

  it('falls back through profile name then user id, never to empty', () => {
    expect(vaultMemberLabel({ email: '', profileName: 'Laptop', userId: 'u1' })).toBe('Laptop');
    expect(vaultMemberLabel({ email: null, profileName: null, userId: 'u1' })).toBe('u1');
    expect(vaultMemberLabel({})).toBe('Member');
  });

  it('takes a readable initial, accents and emoji included', () => {
    expect(participantInitial('élodie@filarr.test')).toBe('É');
    expect(participantInitial('  ')).toBe('?');
    expect(participantInitial('🦊 fox')).toBe('🦊');
  });
});

describe('typing — réception immunisée au décalage d’horloge', () => {
  const states = (entries: Array<[number, unknown]>) =>
    new Map(entries.map(([id, typing]) => [id, { typing }])) as ReadonlyMap<
      number,
      { typing?: unknown } | undefined
    >;

  it('un CHANGEMENT de valeur date le reçu à NOTRE horloge, même valeur aberrante', () => {
    const t1 = updateTypingReceipts(new Map(), states([[7, 999_999_999_999]]), 1000);
    expect(t1.get(7)).toEqual({ value: 999_999_999_999, seenAt: 1000 });
    // Valeur inchangée : le reçu est CONSERVÉ (seenAt n'avance pas).
    const t2 = updateTypingReceipts(t1, states([[7, 999_999_999_999]]), 5000);
    expect(t2.get(7)?.seenAt).toBe(1000);
    // Nouvelle valeur : redaté.
    const t3 = updateTypingReceipts(t2, states([[7, 1]]), 6000);
    expect(t3.get(7)?.seenAt).toBe(6000);
  });

  it('null/absent retire le reçu ; un pair disparu des states est purgé', () => {
    const t1 = updateTypingReceipts(new Map(), states([[7, 5]]), 1000);
    expect(updateTypingReceipts(t1, states([[7, null]]), 2000).has(7)).toBe(false);
    expect(updateTypingReceipts(t1, states([]), 2000).size).toBe(0);
  });

  it('isTypingNow : vrai sous le TTL, faux après', () => {
    const r = { value: 1, seenAt: 1000 };
    expect(isTypingNow(r, 1000 + TYPING_TTL_MS - 1)).toBe(true);
    expect(isTypingNow(r, 1000 + TYPING_TTL_MS)).toBe(false);
    expect(isTypingNow(undefined, 0)).toBe(false);
  });

  it('deriveVaultPresence pose isTyping pour un pair du set — JAMAIS pour le local', () => {
    const raw = new Map([
      [1, { user: { name: 'moi@x.com', color: '#111', role: 'member' } }],
      [7, { user: { name: 'lui@x.com', color: '#222', role: 'member' } }],
    ]) as never;
    const list = deriveVaultPresence(
      raw,
      1,
      { name: 'moi@x.com', color: '#111' },
      null,
      new Set([1, 7])
    );
    const byId = Object.fromEntries(list.map((p) => [p.clientId, p.isTyping]));
    expect(byId[7]).toBe(true);
    expect(byId[1]).toBe(false);
  });

  it('sameVaultPresence détecte un flip d’isTyping seul', () => {
    const raw = new Map([
      [7, { user: { name: 'lui@x.com', color: '#222', role: 'member' } }],
    ]) as never;
    const a = deriveVaultPresence(raw, 1, { name: 'x', color: '#1' }, null, new Set());
    const b = deriveVaultPresence(raw, 1, { name: 'x', color: '#1' }, null, new Set([7]));
    expect(sameVaultPresence(a, b)).toBe(false);
  });
});

describe('session d’édition — résolution et méta', () => {
  it('null → mint ; frais → conserve ; périmé → renouvelle ; futur → conserve', () => {
    const mint = () => 'neuf';
    expect(resolveEditSessionId(null, 1000, mint)).toEqual({ id: 'neuf', renewed: true });
    expect(
      resolveEditSessionId({ id: 'vivant', lastSaveAt: 1000 }, 1000 + EDIT_SESSION_GAP_MS - 1, mint)
    ).toEqual({ id: 'vivant', renewed: false });
    expect(
      resolveEditSessionId({ id: 'mort', lastSaveAt: 0 }, EDIT_SESSION_GAP_MS, mint).renewed
    ).toBe(true);
    // lastSaveAt dans le FUTUR = horloge d'un autre sauveur en avance : on garde.
    expect(resolveEditSessionId({ id: 'futur', lastSaveAt: 99_999 }, 1000, mint)).toEqual({
      id: 'futur',
      renewed: false,
    });
  });

  it('buildEditSessionMeta : dédoublonne, plafonne à 8 noms de 64 chars', () => {
    const participants = [
      { name: 'alice@x.com' },
      { name: 'alice@x.com' },
      { name: '  ' },
      { name: 'x'.repeat(100) },
      ...Array.from({ length: 10 }, (_, i) => ({ name: `p${i}@x.com` })),
    ];
    const meta = buildEditSessionMeta('sess', participants, 42);
    expect(meta.id).toBe('sess');
    expect(meta.at).toBe(42);
    expect(meta.participants.length).toBe(8);
    expect(meta.participants[0]).toBe('alice@x.com');
    expect(meta.participants[1].length).toBe(64);
    expect(new Set(meta.participants).size).toBe(8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LE CANAL, ET CE QU'IL PROUVE
// ─────────────────────────────────────────────────────────────────────────────

describe('vaultRoomSettled — « hors ligne » ne prouve pas qu’on est seul', () => {
  it('seul un canal SYNCED a montré la salle', () => {
    expect(vaultRoomSettled('synced')).toBe(true);
  });

  it('LE DÉFAUT : hors ligne ne vaut PAS stabilisé pour un élément de coffre', () => {
    // Le relais injoignable (jeton refusé, secret de salle absent, coupure) met
    // la session « hors ligne ». Compter cet état pour stabilisé, c'est dire
    // « je suis seul » sans preuve : les autres membres, eux, atteignent
    // parfaitement l'API des coffres. Deux pairs hors ligne s'élisent alors tous
    // les deux et écrivent tous les deux le MÊME objet nuage — 409
    // item_version_conflict garanti au second, toutes les six secondes.
    expect(vaultRoomSettled('offline')).toBe(false);
  });

  it('ni « en cours » ni « connecté » : le journal n’est pas rejoué', () => {
    expect(vaultRoomSettled('connecting')).toBe(false);
    expect(vaultRoomSettled('connected')).toBe(false);
  });

  it('un refus d’accès n’est évidemment pas une salle stabilisée', () => {
    expect(vaultRoomSettled('denied')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LE PAIR ISOLÉ — ce que « hors ligne » N'INTERDIT PAS
// ─────────────────────────────────────────────────────────────────────────────

describe('loneVaultSaverEligible — un pair durablement sans relais peut redevenir sauveur', () => {
  const isolated = {
    status: 'offline' as const,
    offlineSince: 1_000,
    memberCount: 1,
    localRole: 'member' as string | null | undefined,
    now: 1_000 + LONE_SAVER_ISOLATION_MS,
  };

  it('LA CONTREPARTIE DE vaultRoomSettled : seul membre du coffre, relais mort, on écrit', () => {
    // Sans ceci, la règle « hors ligne ne prouve pas qu'on est seul » coûtait
    // l'enregistrement automatique À TOUT LE MONDE dès que le relais tombait :
    // plus personne n'était élu, et seul le bouton « Enregistrer » écrivait
    // encore — en silence, sans que rien ne l'annonce.
    expect(loneVaultSaverEligible(isolated)).toBe(true);
  });

  it('DEUX PAIRS HORS LIGNE NE SE CROIENT PAS TOUS DEUX SEULS — la preuve vient du serveur', () => {
    // C'est le défaut d'origine, et il ne doit pas rouvrir. La seule preuve
    // qu'on puisse produire SANS le relais est l'effectif du coffre, que
    // `/vaults/heads` annonce par une TOUT AUTRE voie que la salle : à deux
    // membres, un autre PEUT écrire, donc on ne prend pas le stylo.
    expect(loneVaultSaverEligible({ ...isolated, memberCount: 2 })).toBe(false);
  });

  it('UNE IGNORANCE N’EST PAS UNE PREUVE : effectif inconnu, on s’abstient', () => {
    // Même discipline que partout ailleurs ici — on ne tire jamais un verdict
    // définitif d'une absence d'information.
    expect(loneVaultSaverEligible({ ...isolated, memberCount: undefined })).toBe(false);
  });

  it('l’isolement doit être DURABLE — une salle qui vient de tomber va peut-être revenir', () => {
    expect(loneVaultSaverEligible({ ...isolated, now: 1_000 + LONE_SAVER_ISOLATION_MS - 1 })).toBe(
      false
    );
    expect(loneVaultSaverEligible({ ...isolated, offlineSince: null })).toBe(false);
  });

  it('ni « en cours », ni « connecté », ni « synchronisé » : ce n’est pas de l’isolement', () => {
    // `connecting` et `connected` disent que le relais répond ou va répondre ;
    // `synced` a déjà montré la salle et n'a pas besoin de repli.
    expect(loneVaultSaverEligible({ ...isolated, status: 'connecting' })).toBe(false);
    expect(loneVaultSaverEligible({ ...isolated, status: 'connected' })).toBe(false);
    expect(loneVaultSaverEligible({ ...isolated, status: 'synced' })).toBe(false);
  });

  it('UN REFUS N’EST PAS UN ISOLEMENT — on n’est plus membre, on n’écrit plus', () => {
    // `denied` est un verdict du serveur, pas une panne de réseau. Le confondre
    // avec l'isolement ferait pousser un enregistrement voué au 403.
    expect(loneVaultSaverEligible({ ...isolated, status: 'denied' })).toBe(false);
  });

  it('un lecteur reste un lecteur, même seul au monde', () => {
    expect(loneVaultSaverEligible({ ...isolated, localRole: 'viewer' })).toBe(false);
    expect(loneVaultSaverEligible({ ...isolated, localRole: null })).toBe(false);
  });
});

describe('nextOfflineSince — l’horloge de l’isolement, et ce qui la RÉARME', () => {
  it('démarre à la première chute et ne se redate pas ensuite', () => {
    // Redater à chaque évènement « hors ligne » repousserait l'échéance à
    // l'infini : le fournisseur en émet un par tentative de reconnexion.
    expect(nextOfflineSince(null, 'offline', 1_000)).toBe(1_000);
    expect(nextOfflineSince(1_000, 'offline', 9_000)).toBe(1_000);
  });

  it('LE PIÈGE : un canal qui clignote ne doit jamais « prouver » une solitude', () => {
    // L'isolement se compte en silence ININTERROMPU. Sans cette remise à zéro,
    // un canal qui tombe et revient toutes les cinq secondes accumulerait
    // quand même ses vingt secondes et élirait un pair qui n'a jamais été seul.
    expect(nextOfflineSince(1_000, 'connecting', 5_000)).toBeNull();
    expect(nextOfflineSince(1_000, 'connected', 5_000)).toBeNull();
    expect(nextOfflineSince(1_000, 'synced', 5_000)).toBeNull();
    expect(nextOfflineSince(1_000, 'denied', 5_000)).toBeNull();
    // …et l'horloge repart de zéro à la chute suivante, pas de l'ancienne.
    expect(nextOfflineSince(null, 'offline', 12_000)).toBe(12_000);
  });
});

describe('commitCoversDocument — ce qui a été écrit couvre-t-il ce qui est à l’écran ?', () => {
  it('rien n’a bougé pendant l’enregistrement : le commit couvre tout', () => {
    expect(commitCoversDocument(12, 12)).toBe(true);
  });

  it('LE DÉFAUT : une frappe arrivée pendant l’envoi n’est PAS dans le commit', () => {
    // Un enregistrement de coffre n'est pas instantané : déclaration de
    // révision, envoi des morceaux chiffrés, puis commit. Tout ce qui change le
    // document entre la sérialisation et le succès est ABSENT de ce qui vient
    // d'être écrit — baisser `dirty` là-dessus perd la frappe jusqu'à ce que
    // quelqu'un retape, et ment à la garde de fermeture.
    expect(commitCoversDocument(12, 13)).toBe(false);
  });
});

/**
 * LE VETO VAUT AUSSI À LA FERMETURE.
 *
 * `shouldWriteBackVaultNote` est éprouvé ci-dessus veto par veto — mais un veto
 * ne sert qu'aux chemins qui l'appellent. La fermeture de l'éditeur pousse un
 * DERNIER enregistrement, et elle le faisait sur une liste de conditions écrite
 * à la main, plus courte de trois : le conflit non résolu (elle renvoyait alors
 * la même version périmée, donc un second 409 sans écran pour le montrer), la
 * lecture seule rendue par le relais, et la salle non stabilisée.
 *
 * Faute de DOM dans cette suite, on confronte la promesse au TEXTE de l'écran —
 * même procédé que `grantOverviewModel.vitest.ts`, et pour la même raison : ce
 * qu'on garde ici n'est pas un calcul, c'est un chaînage.
 */
describe('la fermeture emprunte le MÊME veto que la cadence', () => {
  const source = readFileSync(join(__dirname, '..', 'VaultNoteEditor.tsx'), 'utf8');
  const pousser = source.slice(
    source.indexOf('const pousserDernierEnregistrement'),
    source.indexOf('const sortieTraiteeRef')
  );

  it('le dernier enregistrement passe par shouldWriteBackVaultNote', () => {
    expect(pousser.length).toBeGreaterThan(200);
    expect(pousser).toContain('shouldWriteBackVaultNote({ ...input, localRole: myRole })');
    // Et surtout : plus de liste parallèle recomposée sur place.
    expect(pousser).not.toContain('input.dirty && input.responsible');
  });

  it('TOUTES LES SORTIES l’empruntent — pas seulement celle qui a un bouton', () => {
    /**
     * Le veto ne sert qu'aux chemins qui l'appellent, et ce fichier en a
     * quatre : la fermeture, le retour « ← nom du coffre », la demande de
     * sortie, et le DÉMONTAGE (coffre verrouillé pendant l'édition, navigation
     * ailleurs) — le seul qui n'ait aucun bouton et qui, jusqu'ici, annulait le
     * minuteur sans rien écrire. Deux sorties d'un même écran ne peuvent pas
     * avoir deux politiques d'écriture.
     */
    for (const appelant of [
      'const handleClose',
      'const quitterPanneau',
      'filetDeSortieRef.current =',
    ]) {
      const bloc = source.slice(source.indexOf(appelant));
      expect(bloc.slice(0, 1400), appelant).toContain('pousserDernierEnregistrement(');
    }
    // Le démontage l'ARME vraiment : une fonction jamais branchée ne garde rien.
    expect(source).toContain('useEffect(() => () => filetDeSortieRef.current(), [])');
  });
});
