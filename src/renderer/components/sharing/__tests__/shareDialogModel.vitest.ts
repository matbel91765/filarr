/**
 * shareDialogModel — les décisions PURES du dialogue de partage unifié.
 *
 * Ce qu'on éprouve ici est exactement ce qui ne se voit pas à la compilation :
 * quelles sections pour quelle cible / rôle / mode, laquelle des deux voies
 * d'invitation prendre (cérémonie inline pour quelqu'un de l'espace, invitation
 * d'espace avec intention pour un nouveau venu), et les exclusions du
 * changement de rôle et du retrait — les mêmes que la page « Gérer le coffre ».
 */

import { describe, it, expect } from 'vitest';
import type { SpaceDirectoryEntry } from '../../../../services/vault/vaultApi';
import type { VaultItemSummary } from '../../../../store/slices/vaultsSlice';
import type { FileItem } from '../../../../types';
import {
  shareDialogSections,
  hasAnyShareSection,
  shareTargetName,
  inviteRoute,
  inviteRouteWithDirectory,
  seatGate,
  inviteBlockedBySeats,
  blockedGrantsForVault,
  canChangeVaultMemberRole,
  canRemoveVaultMember,
  buildAccessRows,
  isAssignableVaultRole,
  type ShareTarget,
  type ShareDialogContext,
} from '../shareDialogModel';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const item = (over: Partial<VaultItemSummary> = {}): VaultItemSummary => ({
  id: 'it1',
  vaultId: 'v1',
  ownerUserId: 'u1',
  itemType: 'file',
  meta: { fileName: 'a.pdf', mime: 'application/pdf' },
  wrappedItemKey: '',
  wrappedUnderEpoch: 1,
  totalChunks: 1,
  sizeBytes: 10,
  status: 'active',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

const file: FileItem = { id: 'f1', name: 'rapport.pdf', type: 'application/pdf', size: 42 };

const VAULT: ShareTarget = { kind: 'vault', vaultId: 'v1' };
const VAULT_ITEM: ShareTarget = {
  kind: 'vaultItem',
  vaultId: 'v1',
  item: item(),
  itemName: 'a.pdf',
};
const PERSONAL_FILE: ShareTarget = { kind: 'personalFile', file, folderId: 'd1' };
const PERSONAL_NOTE: ShareTarget = { kind: 'personalNote', noteId: 'n1', name: 'Idées' };

const ctx = (over: Partial<ShareDialogContext> = {}): ShareDialogContext => ({
  accountMode: 'cloud',
  myRole: 'owner',
  hasAddTargets: true,
  externalSharesDisabled: false,
  ...over,
});

/**
 * Une entrée d'annuaire (P2) : deux champs, et rien d'autre. L'ancienne fixture
 * était un `OrgMember` complet avec son rôle et son statut d'espace — c'est
 * précisément ce que la ligne d'invitation n'a plus le droit d'exiger, puisque
 * la route qui la servait est refusée aux invités.
 */
const member = (over: Partial<SpaceDirectoryEntry> = {}): SpaceDirectoryEntry => ({
  userId: 'u2',
  email: 'Bob@Example.com',
  ...over,
});

// ── Sections ─────────────────────────────────────────────────────────────────

describe('shareDialogSections', () => {
  it('mode local : aucune section, quelle que soit la cible', () => {
    for (const target of [VAULT, VAULT_ITEM, PERSONAL_FILE, PERSONAL_NOTE]) {
      const s = shareDialogSections(target, ctx({ accountMode: 'local' }));
      expect(hasAnyShareSection(s)).toBe(false);
    }
  });

  it('coffre, admin/owner : inviter + personnes + activité + avancé, jamais lien/ajout', () => {
    for (const myRole of ['owner', 'admin']) {
      const s = shareDialogSections(VAULT, ctx({ myRole }));
      expect(s).toEqual({
        invite: true,
        people: true,
        itemGrant: false,
        link: false,
        addToVault: false,
        activity: true,
        advanced: true,
      });
    }
  });

  it('coffre, membre/lecteur : la liste et l activité, sans inviter', () => {
    for (const myRole of ['member', 'viewer']) {
      const s = shareDialogSections(VAULT, ctx({ myRole }));
      expect(s.invite).toBe(false);
      expect(s.people).toBe(true);
      expect(s.activity).toBe(true);
      expect(s.advanced).toBe(true);
    }
  });

  it('élément de coffre, admin : grant + lien (fichier) + activité, sans trombinoscope', () => {
    const s = shareDialogSections(VAULT_ITEM, ctx({ myRole: 'admin' }));
    expect(s.itemGrant).toBe(true);
    expect(s.link).toBe(true);
    expect(s.activity).toBe(true);
    expect(s.invite).toBe(false);
    expect(s.people).toBe(false);
    expect(s.advanced).toBe(false);
    expect(s.addToVault).toBe(false);
  });

  it('élément de coffre : le grant est réservé aux admins, le lien à qui écrit', () => {
    const asMember = shareDialogSections(VAULT_ITEM, ctx({ myRole: 'member' }));
    expect(asMember.itemGrant).toBe(false);
    expect(asMember.link).toBe(true);
    const asViewer = shareDialogSections(VAULT_ITEM, ctx({ myRole: 'viewer' }));
    expect(asViewer.itemGrant).toBe(false);
    expect(asViewer.link).toBe(false);
  });

  it('élément de coffre : une note n a pas de lien public, un marqueur de dossier pas de grant', () => {
    const note: ShareTarget = {
      kind: 'vaultItem',
      vaultId: 'v1',
      item: item({ itemType: 'note', meta: { title: 'n' } }),
      itemName: 'n',
    };
    expect(shareDialogSections(note, ctx()).link).toBe(false);
    expect(shareDialogSections(note, ctx()).itemGrant).toBe(true);
    const marker: ShareTarget = {
      kind: 'vaultItem',
      vaultId: 'v1',
      item: item({ itemType: 'note', meta: { title: 'd', folderMarker: true } }),
      itemName: 'd',
    };
    expect(shareDialogSections(marker, ctx()).itemGrant).toBe(false);
  });

  it('lot d éléments (dossier, sélection) : le partage par personne seul, admin seulement, jamais de lien', () => {
    const lot: ShareTarget = {
      kind: 'vaultItems',
      vaultId: 'v1',
      items: [item({ id: 'i1' }), item({ id: 'i2' })],
      name: 'Contrats',
    };
    const asAdmin = shareDialogSections(lot, ctx({ myRole: 'admin' }));
    expect(asAdmin.itemGrant).toBe(true);
    expect(asAdmin.link).toBe(false);
    expect(asAdmin.activity).toBe(true);
    expect(shareDialogSections(lot, ctx({ myRole: 'member' })).itemGrant).toBe(false);
    expect(shareDialogSections(lot, ctx({ myRole: 'viewer' })).itemGrant).toBe(false);
    // Un lot qui ne contient que des marqueurs n'a rien à sceller.
    const vide: ShareTarget = {
      kind: 'vaultItems',
      vaultId: 'v1',
      items: [item({ itemType: 'note', meta: { title: 'd', folderMarker: true } })],
      name: 'd',
    };
    expect(shareDialogSections(vide, ctx()).itemGrant).toBe(false);
    // Règle 13 : hors nuage, rien.
    expect(hasAnyShareSection(shareDialogSections(lot, ctx({ accountMode: 'local' })))).toBe(false);
    expect(shareTargetName(lot, 'x', 'Sans titre')).toBe('Contrats');
  });

  it('politique d org « pas de lien externe » : le lien disparaît, coffre et perso', () => {
    expect(shareDialogSections(VAULT_ITEM, ctx({ externalSharesDisabled: true })).link).toBe(false);
    expect(shareDialogSections(PERSONAL_FILE, ctx({ externalSharesDisabled: true })).link).toBe(
      false
    );
  });

  it('fichier personnel : lien + ajout au coffre (si une cible existe), rien de coffre', () => {
    const s = shareDialogSections(PERSONAL_FILE, ctx());
    expect(s).toEqual({
      invite: false,
      people: false,
      itemGrant: false,
      link: true,
      addToVault: true,
      activity: false,
      advanced: false,
    });
    expect(shareDialogSections(PERSONAL_FILE, ctx({ hasAddTargets: false })).addToVault).toBe(
      false
    );
  });

  it('note personnelle : le coffre est la SEULE voie — pas de lien', () => {
    const s = shareDialogSections(PERSONAL_NOTE, ctx());
    expect(s.link).toBe(false);
    expect(s.addToVault).toBe(true);
    expect(
      hasAnyShareSection(shareDialogSections(PERSONAL_NOTE, ctx({ hasAddTargets: false })))
    ).toBe(false);
  });

  it('shareTargetName : le nom de la cible, et « Sans titre » à défaut', () => {
    expect(shareTargetName(VAULT, 'Équipe', 'Sans titre')).toBe('Équipe');
    expect(shareTargetName(VAULT, '', 'Sans titre')).toBe('Sans titre');
    expect(shareTargetName(VAULT_ITEM, 'x', 'Sans titre')).toBe('a.pdf');
    expect(shareTargetName(PERSONAL_FILE, 'x', 'Sans titre')).toBe('rapport.pdf');
    expect(shareTargetName(PERSONAL_NOTE, 'x', 'Sans titre')).toBe('Idées');
  });
});

// ── Invitation : une ligne, deux voies ───────────────────────────────────────

describe('inviteRoute', () => {
  const roster = [member(), member({ userId: 'u3', email: 'carol@x.io' })];

  it('rien de tapé, ou pas une adresse → empty (aucun bouton actif)', () => {
    expect(inviteRoute('', roster, []).kind).toBe('empty');
    expect(inviteRoute('   ', roster, []).kind).toBe('empty');
    expect(inviteRoute('bob', roster, []).kind).toBe('empty');
    expect(inviteRoute('bob@', roster, []).kind).toBe('empty');
  });

  it('membre de l espace → cérémonie inline (voie member), casse et espaces ignorés', () => {
    const r = inviteRoute('  BOB@example.COM ', roster, []);
    expect(r.kind).toBe('member');
    if (r.kind === 'member') expect(r.member.userId).toBe('u2');
  });

  it('adresse inconnue de l espace → invitation d espace avec intention (voie newcomer), normalisée', () => {
    const r = inviteRoute(' Dave@Example.com ', roster, []);
    expect(r).toEqual({ kind: 'newcomer', email: 'dave@example.com' });
  });

  it('déjà membre DU COFFRE → inVault : rien à envoyer', () => {
    expect(inviteRoute('bob@example.com', roster, ['u2']).kind).toBe('inVault');
    expect(inviteRoute('bob@example.com', roster, new Set(['u2'])).kind).toBe('inVault');
  });

  // Le filtre des inactifs a changé de main (P2) : c'est l'annuaire du coffre
  // qui écarte suspendus et seulement-invités, là où le statut d'espace est un
  // fait. Ce que le modèle garantit ici, c'est l'autre moitié : quelqu'un que
  // l'annuaire ne rend pas — inactif, inconnu, ou annuaire tronqué — reste un
  // nouveau venu, jamais quelqu'un à qui on prétendrait sceller la clé.
  it('une adresse absente de l annuaire est un nouveau venu, jamais un membre', () => {
    expect(inviteRoute('bob@example.com', [], []).kind).toBe('newcomer');
    expect(inviteRoute('bob@example.com', [member({ email: '' })], []).kind).toBe('newcomer');
  });
});

/**
 * L'ANNUAIRE ILLISIBLE N'EST PAS « IL N'Y A PERSONNE » (P2 → F02).
 *
 * `GET /org/:orgId/members` exigeait `VIEW_MEMBERS`, un droit d'ESPACE qu'un
 * admin de coffre invité chez quelqu'un d'autre n'a jamais : le 403 était avalé,
 * et une liste vide se lisait « cette adresse est inconnue ». Résultat : toute
 * adresse tapée devenait un « nouveau venu », y compris celle d'un voisin
 * d'espace à qui on aurait pu sceller la clé sur-le-champ — et l'invitation
 * partait pour revenir en 409.
 */
describe('inviteRouteWithDirectory — on ne route pas à l’aveugle', () => {
  const roster = [member(), member({ userId: 'u3', email: 'carol@x.io' })];

  it('annuaire lisible : exactement le routage d’avant', () => {
    expect(inviteRouteWithDirectory('bob@example.com', roster, 'ok', []).kind).toBe('member');
    expect(inviteRouteWithDirectory('dave@x.io', roster, 'ok', []).kind).toBe('newcomer');
    expect(inviteRouteWithDirectory('bob@example.com', roster, 'ok', ['u2']).kind).toBe('inVault');
  });

  it('annuaire refusé ou en panne : « unknown », JAMAIS « newcomer »', () => {
    for (const state of ['forbidden', 'unavailable'] as const) {
      expect(inviteRouteWithDirectory('dave@x.io', [], state, []).kind, state).toBe('unknown');
      // Même une adresse que l'annuaire tronqué ne nomme pas : on ignore, on ne
      // conclut pas. C'est la moitié qui coûtait une invitation inutile.
      expect(inviteRouteWithDirectory('bob@example.com', [], state, []).kind, state).toBe(
        'unknown'
      );
    }
  });

  it('un champ vide reste vide, quel que soit l’état de l’annuaire', () => {
    // Un champ auquel on n'a encore rien demandé n'a aucune raison de porter un
    // avertissement : il serait affiché en permanence, donc jamais lu.
    expect(inviteRouteWithDirectory('', [], 'forbidden', []).kind).toBe('empty');
    expect(inviteRouteWithDirectory('bob', [], 'unavailable', []).kind).toBe('empty');
  });

  it('« a déjà accès » survit à l’annuaire : ce fait-là vient de /members', () => {
    // La liste du coffre, elle, a bien été lue — et elle porte l'adresse depuis
    // P2. Éteindre ce verdict rendrait la ligne muette sur le seul cas où elle
    // a une certitude.
    expect(inviteRouteWithDirectory('bob@example.com', roster, 'forbidden', ['u2']).kind).toBe(
      'inVault'
    );
  });
});

describe('seatGate / inviteBlockedBySeats', () => {
  it('sans plafond (vraie org) : jamais plein', () => {
    expect(seatGate(null)).toEqual({
      memberLimit: null,
      membersUsed: null,
      activeMembers: null,
      pendingInvites: null,
      spaceFull: false,
    });
    expect(seatGate({ seats: 5, viewers: 0, seatsPurchased: 5, tier: 'teams' }).spaceFull).toBe(
      false
    );
  });

  it('LE CAS DU FONDATEUR : 2 membres + 1 invitation en attente = plein, et on peut le dire', () => {
    // Le serveur rend désormais l'occupation TELLE QUE LA GARDE LA COMPTE
    // (`membersUsed = activeMembers + pendingInvites`), plus le détail. Sans ce
    // détail, l'écran ne peut afficher que « 3 sur 3 » et l'hôte cherche une
    // troisième personne dans une liste qui n'en montre que deux.
    const gate = seatGate({
      seats: 0,
      viewers: 0,
      seatsPurchased: 0,
      tier: 'solo',
      memberLimit: 3,
      membersUsed: 3,
      activeMembers: 2,
      pendingInvites: 1,
    });
    expect(gate).toEqual({
      memberLimit: 3,
      membersUsed: 3,
      activeMembers: 2,
      pendingInvites: 1,
      spaceFull: true,
    });
    // Le bouton s'éteint AVANT le clic : c'est tout l'objet du correctif.
    expect(inviteBlockedBySeats({ kind: 'newcomer', email: 'x@y.z' }, gate)).toBe(true);
    // …mais JAMAIS pour quelqu'un déjà dans l'espace : cette route ne consomme
    // aucun siège, et l'éteindre serait fermer la seule porte encore ouverte.
    expect(inviteBlockedBySeats({ kind: 'member', member: member() }, gate)).toBe(false);
  });

  it('un worker d’avant le correctif : le détail manque, le verdict tient quand même', () => {
    // `undefined` se lit « je ne sais pas », jamais « zéro » : l'occupation
    // reste affichable, seule l'explication manque.
    const gate = seatGate({
      seats: 0,
      viewers: 0,
      seatsPurchased: 0,
      tier: 'solo',
      memberLimit: 3,
      membersUsed: 3,
    });
    expect(gate.activeMembers).toBeNull();
    expect(gate.pendingInvites).toBeNull();
    expect(gate.spaceFull).toBe(true);
  });

  it('plafond perso atteint : plein — et seule la voie newcomer est bloquée', () => {
    const full = seatGate({
      seats: 0,
      viewers: 0,
      seatsPurchased: 0,
      tier: 'solo',
      memberLimit: 3,
      membersUsed: 3,
    });
    expect(full.spaceFull).toBe(true);
    expect(inviteBlockedBySeats({ kind: 'newcomer', email: 'x@y.z' }, full)).toBe(true);
    // Sceller à quelqu'un déjà dans l'espace ne consomme aucun siège.
    expect(inviteBlockedBySeats({ kind: 'member', member: member() }, full)).toBe(false);
    expect(inviteBlockedBySeats({ kind: 'empty' }, full)).toBe(false);
  });

  it('plafond non atteint : la voie newcomer passe', () => {
    const ok = seatGate({
      seats: 0,
      viewers: 0,
      seatsPurchased: 0,
      tier: 'solo',
      memberLimit: 3,
      membersUsed: 2,
    });
    expect(ok.spaceFull).toBe(false);
    expect(inviteBlockedBySeats({ kind: 'newcomer', email: 'x@y.z' }, ok)).toBe(false);
  });
});

describe('blockedGrantsForVault', () => {
  it('ne garde que les blocages de CE coffre', () => {
    const all = [
      { vaultId: 'v1', email: 'a@x.io', userId: 'u-a', reason: 'key_unverified' as const },
      { vaultId: 'v2', email: 'b@x.io', userId: 'u-b', reason: 'no_key' as const },
      { vaultId: 'v1', email: 'c@x.io', userId: 'u-c', reason: 'seal_failed' as const },
    ];
    expect(blockedGrantsForVault(all, 'v1').map((b) => b.email)).toEqual(['a@x.io', 'c@x.io']);
    expect(blockedGrantsForVault(all, 'v3')).toEqual([]);
  });
});

// ── Les personnes ayant accès : qui peut changer quoi ────────────────────────

describe('canChangeVaultMemberRole', () => {
  const me = 'me';
  it('un admin change le rôle d un autre membre non propriétaire', () => {
    expect(canChangeVaultMemberRole({ userId: 'u2', role: 'member' }, me, 'admin')).toBe(true);
    expect(canChangeVaultMemberRole({ userId: 'u2', role: 'viewer' }, me, 'owner')).toBe(true);
  });
  it('jamais un propriétaire (sa succession passe par le transfert)', () => {
    expect(canChangeVaultMemberRole({ userId: 'u2', role: 'owner' }, me, 'owner')).toBe(false);
  });
  it('jamais soi-même', () => {
    expect(canChangeVaultMemberRole({ userId: me, role: 'admin' }, me, 'admin')).toBe(false);
  });
  it('jamais depuis un rôle qui n administre pas', () => {
    expect(canChangeVaultMemberRole({ userId: 'u2', role: 'member' }, me, 'member')).toBe(false);
    expect(canChangeVaultMemberRole({ userId: 'u2', role: 'member' }, me, 'viewer')).toBe(false);
  });
});

describe('canRemoveVaultMember', () => {
  const me = 'me';
  it('un admin retire un membre, pas un propriétaire ; un propriétaire retire un autre propriétaire', () => {
    expect(canRemoveVaultMember({ userId: 'u2', role: 'member' }, me, 'admin')).toBe(true);
    expect(canRemoveVaultMember({ userId: 'u2', role: 'owner' }, me, 'admin')).toBe(false);
    expect(canRemoveVaultMember({ userId: 'u2', role: 'owner' }, me, 'owner')).toBe(true);
  });
  it('jamais soi-même (c est « quitter »), jamais sans administrer', () => {
    expect(canRemoveVaultMember({ userId: me, role: 'member' }, me, 'owner')).toBe(false);
    expect(canRemoveVaultMember({ userId: 'u2', role: 'member' }, me, 'member')).toBe(false);
  });
});

describe('buildAccessRows', () => {
  it('moi en tête, puis par libellé ; e-mail quand connu, identifiant sinon ; droits par ligne', () => {
    const rows = buildAccessRows(
      [
        { userId: 'zed', role: 'member', joinedAt: '' },
        { userId: 'me', role: 'admin', joinedAt: '' },
        { userId: 'own', role: 'owner', joinedAt: '' },
      ],
      { zed: 'zed@x.io', own: 'alice@x.io' },
      'me',
      'admin'
    );
    expect(rows.map((r) => r.userId)).toEqual(['me', 'own', 'zed']);
    expect(rows[0]).toMatchObject({
      label: 'me',
      isSelf: true,
      canChangeRole: false,
      canRemove: false,
    });
    expect(rows[1]).toMatchObject({ label: 'alice@x.io', canChangeRole: false, canRemove: false });
    expect(rows[2]).toMatchObject({ label: 'zed@x.io', canChangeRole: true, canRemove: true });
  });

  // P2 : l'adresse portée par la ligne du coffre elle-même. C'est la seule que
  // reçoive un membre ou un lecteur — l'annuaire leur est fermé — et sans elle
  // la liste d'accès leur affichait une colonne d'identifiants opaques.
  it('sans annuaire, l adresse de la ligne du coffre fait le libellé', () => {
    const rows = buildAccessRows(
      [
        { userId: 'zed', role: 'member', joinedAt: '', email: 'zed@x.io' },
        { userId: 'sans', role: 'member', joinedAt: '' },
      ],
      {},
      'moi',
      'viewer'
    );
    expect(rows.map((r) => r.label)).toEqual(['sans', 'zed@x.io']);
  });

  it('l annuaire prime quand il est là : une seule source affichée par ligne', () => {
    const rows = buildAccessRows(
      [{ userId: 'zed', role: 'member', joinedAt: '', email: 'ancienne@x.io' }],
      { zed: 'zed@x.io' },
      'moi',
      'admin'
    );
    expect(rows[0].label).toBe('zed@x.io');
  });
});

describe('isAssignableVaultRole', () => {
  it('owner n est jamais assignable', () => {
    expect(isAssignableVaultRole('admin')).toBe(true);
    expect(isAssignableVaultRole('member')).toBe(true);
    expect(isAssignableVaultRole('viewer')).toBe(true);
    expect(isAssignableVaultRole('owner')).toBe(false);
    expect(isAssignableVaultRole('')).toBe(false);
  });
});
