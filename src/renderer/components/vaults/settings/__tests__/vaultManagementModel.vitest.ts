/**
 * vaultManagementModel — les règles de la page « Gérer le coffre ».
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/vaultManagementModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  VAULT_TAB_ORDER,
  buildEmailIndex,
  buildInviteEmailIndex,
  buildMemberRows,
  countByRole,
  defaultVaultTab,
  displayName,
  freezeStateFromVault,
  outsidersInSpace,
  resolveVaultTab,
  visibleVaultTabs,
} from '../vaultManagementModel';
import type { VaultInviteDTO, VaultMemberDTO } from '../../../../../services/vault/vaultApi';

const membre = (userId: string, role: string, extra: Partial<VaultMemberDTO> = {}) =>
  ({ userId, role, joinedAt: '2026-01-01T00:00:00.000Z', ...extra }) as VaultMemberDTO;

describe('les onglets visibles par rôle', () => {
  it('l’ordre est celui de la page — les six onglets décidés (D2)', () => {
    expect([...VAULT_TAB_ORDER]).toEqual([
      'overview',
      'members',
      'invitations',
      'activity',
      'settings',
      'danger',
    ]);
  });

  it('un administrateur et un propriétaire voient les Invitations ET les Réglages', () => {
    for (const role of ['owner', 'admin']) {
      expect(visibleVaultTabs(role)).toContain('invitations');
      expect(visibleVaultTabs(role)).toContain('settings');
    }
  });

  it('un membre et un lecteur ne les voient pas — l’ÉCRITURE leur est fermée', () => {
    // La LECTURE des réglages leur est pourtant ouverte : ce qu'ils en subissent
    // se voit là où les règles s'appliquent (un partage non proposé, une
    // suppression non offerte), avec le mot qui l'explique. Un onglet en lecture
    // seule leur ferait chercher un bouton Enregistrer qui n'existe pas.
    for (const role of ['member', 'viewer', 'inconnu']) {
      expect(visibleVaultTabs(role)).not.toContain('invitations');
      expect(visibleVaultTabs(role)).not.toContain('settings');
      // …mais le Danger reste : « Quitter » est le geste dont ils ont besoin.
      expect(visibleVaultTabs(role)).toContain('danger');
    }
  });

  it('on atterrit toujours sur l’Aperçu', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      expect(defaultVaultTab(role)).toBe('overview');
    }
  });
});

describe('resolveVaultTab — ce que vaut le ?tab= d’une URL', () => {
  it('un onglet légitime est respecté', () => {
    expect(resolveVaultTab('members', 'viewer')).toBe('members');
    expect(resolveVaultTab('invitations', 'admin')).toBe('invitations');
    expect(resolveVaultTab('settings', 'admin')).toBe('settings');
  });

  it('absent, inconnu ou fermé à ce rôle → l’Aperçu, sans se plaindre', () => {
    expect(resolveVaultTab(undefined, 'owner')).toBe('overview');
    expect(resolveVaultTab('', 'owner')).toBe('overview');
    expect(resolveVaultTab('nimporte-quoi', 'owner')).toBe('overview');
    // Un lien « Invitations » ou « Réglages » transmis à un lecteur ouvre
    // l'écran quand même, sur l'Aperçu, sans reproche.
    expect(resolveVaultTab('invitations', 'viewer')).toBe('overview');
    expect(resolveVaultTab('settings', 'member')).toBe('overview');
  });
});

describe('buildEmailIndex — qui nomme les gens', () => {
  const membres = [membre('u1', 'owner', { email: 'du-coffre@x.tld' }), membre('u2', 'member')];

  it('l’annuaire l’emporte, la ligne du coffre prend le relais', () => {
    const idx = buildEmailIndex([{ userId: 'u1', email: 'annuaire@x.tld' }], membres);
    expect(idx.u1).toBe('annuaire@x.tld');
    // u2 n'est ni dans l'annuaire ni porteur d'adresse : rien, pas une chaîne vide.
    expect(idx.u2).toBeUndefined();
  });

  it('sans annuaire (rôle sans la route, ou panne), la ligne du coffre suffit', () => {
    const idx = buildEmailIndex([], membres);
    expect(idx.u1).toBe('du-coffre@x.tld');
    expect(displayName('u2', idx)).toBe('u2');
  });

  it('un vieux Worker n’envoie ni l’un ni l’autre : on retombe sur l’identifiant', () => {
    const idx = buildEmailIndex([], [membre('u9', 'member')]);
    expect(displayName('u9', idx)).toBe('u9');
    expect(displayName('u9', idx)).not.toContain('undefined');
  });
});

describe('buildMemberRows — les capacités reproduisent celles du serveur', () => {
  const roster = [
    membre('owner-1', 'owner', { email: 'zoe@x.tld' }),
    membre('admin-1', 'admin', { email: 'alice@x.tld' }),
    membre('member-1', 'member', { email: 'bob@x.tld' }),
  ];
  const idx = buildEmailIndex([], roster);

  it('trie par libellé, pas par ordre d’arrivée', () => {
    const rows = buildMemberRows(roster, idx, { myUserId: 'owner-1', myRole: 'owner' });
    expect(rows.map((r) => r.label)).toEqual(['alice@x.tld', 'bob@x.tld', 'zoe@x.tld']);
  });

  it('un administrateur ne retire pas un propriétaire, un propriétaire si', () => {
    const parAdmin = buildMemberRows(roster, idx, { myUserId: 'admin-1', myRole: 'admin' });
    expect(parAdmin.find((r) => r.role === 'owner')!.removable).toBe(false);
    const parOwner = buildMemberRows(roster, idx, { myUserId: 'owner-1', myRole: 'owner' });
    // Un propriétaire POURRAIT retirer un autre propriétaire — mais jamais lui-même.
    expect(parOwner.find((r) => r.userId === 'owner-1')!.removable).toBe(false);
    expect(parOwner.find((r) => r.userId === 'member-1')!.removable).toBe(true);
  });

  it('personne ne change son propre rôle, ni celui d’un propriétaire', () => {
    const rows = buildMemberRows(roster, idx, { myUserId: 'admin-1', myRole: 'admin' });
    expect(rows.find((r) => r.userId === 'admin-1')!.canChangeRole).toBe(false);
    expect(rows.find((r) => r.userId === 'owner-1')!.canChangeRole).toBe(false);
    expect(rows.find((r) => r.userId === 'member-1')!.canChangeRole).toBe(true);
  });

  it('un membre et un lecteur ne peuvent rien : la page est en lecture pour eux', () => {
    for (const role of ['member', 'viewer']) {
      const rows = buildMemberRows(roster, idx, { myUserId: 'member-1', myRole: role });
      expect(rows.every((r) => !r.removable && !r.canChangeRole && !r.transferable)).toBe(true);
    }
  });

  it('seul un propriétaire transmet, et jamais à lui-même ni à un autre owner', () => {
    const rows = buildMemberRows(roster, idx, { myUserId: 'owner-1', myRole: 'owner' });
    expect(rows.find((r) => r.userId === 'member-1')!.transferable).toBe(true);
    expect(rows.find((r) => r.userId === 'owner-1')!.transferable).toBe(false);
    const parAdmin = buildMemberRows(roster, idx, { myUserId: 'admin-1', myRole: 'admin' });
    expect(parAdmin.every((r) => !r.transferable)).toBe(true);
  });

  it('marque « vous » sur la bonne ligne, et sur aucune quand on ne se connaît pas', () => {
    const rows = buildMemberRows(roster, idx, { myUserId: 'member-1', myRole: 'member' });
    expect(rows.filter((r) => r.isSelf).map((r) => r.userId)).toEqual(['member-1']);
    const anonyme = buildMemberRows(roster, idx, { myUserId: null, myRole: 'member' });
    expect(anonyme.some((r) => r.isSelf)).toBe(false);
  });

  it('reporte `inSpace` tel quel, y compris son absence (vieux Worker)', () => {
    const rows = buildMemberRows(
      [membre('u1', 'member', { inSpace: false }), membre('u2', 'member')],
      {},
      { myUserId: null, myRole: 'owner' }
    );
    expect(rows.find((r) => r.userId === 'u1')!.inSpace).toBe(false);
    expect(rows.find((r) => r.userId === 'u2')!.inSpace).toBeUndefined();
  });
});

describe('outsidersInSpace — « dans l’espace, mais pas dans le coffre »', () => {
  it('rend ceux que le coffre ne connaît pas', () => {
    const out = outsidersInSpace(
      [
        { userId: 'u1', email: 'a@x.tld' },
        { userId: 'u2', email: 'b@x.tld' },
      ],
      [membre('u1', 'owner')]
    );
    expect(out.map((e) => e.userId)).toEqual(['u2']);
  });

  it('annuaire illisible → aucune affirmation', () => {
    expect(outsidersInSpace([], [membre('u1', 'owner')])).toEqual([]);
  });
});

describe('countByRole', () => {
  it('compte ce qui est là, et rien d’autre', () => {
    expect(
      countByRole([membre('a', 'owner'), membre('b', 'member'), membre('c', 'member')])
    ).toEqual({ owner: 1, member: 2 });
    expect(countByRole([])).toEqual({});
  });
});

describe('freezeStateFromVault — le gel qui vient de la réponse fraîche (F23)', () => {
  it('reporte l’état de gel tel que le serveur vient de le rendre', () => {
    expect(
      freezeStateFromVault('v1', { frozenAt: '2026-08-29T10:00:00Z', frozenBy: 'u-alice' })
    ).toEqual({ vaultId: 'v1', frozenAt: '2026-08-29T10:00:00Z', frozenBy: 'u-alice' });
  });

  it('un coffre lu et NON gelé lève le gel — le dégel d’un autre admin arrive par là', () => {
    expect(freezeStateFromVault('v1', { frozenAt: null, frozenBy: null })).toEqual({
      vaultId: 'v1',
      frozenAt: null,
      frozenBy: null,
    });
  });

  it('UNE LECTURE TOMBÉE N’EST PAS UN COFFRE VIVANT : rien n’est publié', () => {
    // `apiGetVault` avale son propre échec et rend `null`. Le lire comme « pas
    // gelé » effacerait un bandeau VRAI sur une panne de réseau — c'est la
    // règle du dossier : jamais de verdict tiré d'un silence.
    expect(freezeStateFromVault('v1', null)).toBeNull();
    expect(freezeStateFromVault('v1', undefined)).toBeNull();
  });

  it('un worker d’avant le gel n’affirme rien non plus, mais la ligne existe', () => {
    // Le DTO est là, sans les colonnes : le coffre a été LU, et il n'est pas
    // gelé pour ce serveur-là.
    expect(freezeStateFromVault('v1', {})).toEqual({
      vaultId: 'v1',
      frozenAt: null,
      frozenBy: null,
    });
  });
});

/**
 * L'INDEX QUI PERMET AU FIL DE NOMMER L'INVITÉ.
 *
 * L'audit ne porte JAMAIS d'adresse — c'est une règle dure du serveur — mais il
 * porte l'identifiant de l'invitation. Cette carte est la moitié cliente de la
 * jointure : elle vit ici, le serveur n'en apprend rien, et aucune adresse
 * n'entre dans le journal.
 */
describe('buildInviteEmailIndex — la jointure locale du fil d’activité', () => {
  const inv = (id: string, email: string, status = 'pending'): VaultInviteDTO => ({
    id,
    vaultId: 'v1',
    inviteeEmail: email,
    role: 'member',
    status,
    expiresAt: '2026-09-06T00:00:00.000Z',
    createdAt: '2026-08-30T00:00:00.000Z',
  });

  it('couvre les TROIS listes — les lignes du fil parlent souvent d’une fin', () => {
    // « a repris l'invitation de … », « … a refusé son invitation » : ces
    // événements-là désignent des invitations RÉGLÉES ou ÉCHUES. Ne lire que
    // les vivantes laisserait anonymes précisément celles qui racontent une fin.
    const index = buildInviteEmailIndex(
      [inv('i1', 'vivante@x.com')],
      [inv('i2', 'reglee@x.com', 'accepted')],
      [inv('i3', 'echue@x.com', 'expired')]
    );
    expect(index.get('i1')).toBe('vivante@x.com');
    expect(index.get('i2')).toBe('reglee@x.com');
    expect(index.get('i3')).toBe('echue@x.com');
  });

  it('une invitation hors fenêtre reste INCONNUE — le fil ne devinera pas', () => {
    // Le serveur ne rend les réglées que 14 jours et les échues que 30. Passé ce
    // délai la ligne du fil garde sa formule sans nom, et c'est voulu : inventer
    // un nom serait un verdict tiré d'une absence d'information.
    expect(buildInviteEmailIndex([], [], []).get('i-oubliee')).toBeUndefined();
  });

  it('la PREMIÈRE liste gagne, et une adresse vide ne prend pas la place d’une vraie', () => {
    const index = buildInviteEmailIndex([inv('i1', 'fraiche@x.com')], [inv('i1', 'vieille@x.com')]);
    expect(index.get('i1')).toBe('fraiche@x.com');
    expect(buildInviteEmailIndex([inv('i2', '')]).has('i2')).toBe(false);
  });
});
