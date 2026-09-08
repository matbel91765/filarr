/**
 * LE MENU DE RÔLE D'UNE INVITATION, CONFRONTÉ À L'AUTORITÉ — pas à un jumeau.
 *
 * POURQUOI CE FICHIER EXISTE. Le rôle d'une invitation en attente se corrige
 * désormais depuis DEUX écrans (la liste des membres et l'onglet Invitations),
 * par le même `PATCH /vaults/:id/invites/:inviteId`. Ce que le menu propose et
 * ce que le serveur accepte doivent donc coïncider exactement : un rôle de trop
 * offrirait un `bad_request` à qui l'a choisi ; un rôle de moins cacherait un
 * rang que l'espace sait pourtant accorder.
 *
 * ET L'AUTORITÉ, C'EST LE WORKER. Comparer la liste du menu à une autre
 * constante du client ne garderait rien : les deux dériveraient ensemble. Ce
 * test lit donc `INVITABLE_ROLES` DANS LA SOURCE du worker, telle qu'elle est
 * dans l'arbre de travail — la même méthode que le contrôle des codes d'erreur,
 * pour la même raison.
 *
 * `owner` EST LE CAS QUI COMPTE. La propriété se TRANSFÈRE (elle a sa route, sa
 * confirmation, son invariant « un seul propriétaire ») ; elle ne s'invite pas.
 * L'offrir dans un menu déroulant à côté de « lecteur » laisserait croire qu'on
 * peut donner un coffre en cochant une ligne — et le serveur, lui, refuserait.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VAULT_INVITE_ROLES } from '../vaultSettingsModel';
import { seatLinkOffer } from '../pendingSeatsModel';

const VAULTS_SRC = join(__dirname, '../../../../../../infra/cloudflare-worker/src/vaults.ts');

/** Les rôles que le worker accepte, LUS CHEZ LUI. */
function invitableRolesFromWorker(): string[] {
  const src = readFileSync(VAULTS_SRC, 'utf8');
  const m = src.match(/const INVITABLE_ROLES = new Set\(\[([^\]]*)\]\)/);
  if (!m)
    throw new Error('INVITABLE_ROLES introuvable dans vaults.ts — le test ne garde plus rien');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('le menu de rôle d’une invitation', () => {
  it('propose EXACTEMENT ce que le worker accepte', () => {
    expect([...VAULT_INVITE_ROLES].sort()).toEqual(invitableRolesFromWorker().sort());
  });

  it('ne propose jamais owner — la propriété se transfère, elle ne s’invite pas', () => {
    expect(VAULT_INVITE_ROLES).not.toContain('owner');
    expect(invitableRolesFromWorker()).not.toContain('owner');
  });
});

describe('retrouver un lien', () => {
  it('propose la régénération sur une invitation dont le scellé est courant', () => {
    expect(seatLinkOffer({ staleEpoch: false })).toBe('regenerate');
  });

  it('ne la propose PAS après une rotation : le serveur refuserait, et le lien neuf mènerait à une clé morte', () => {
    expect(seatLinkOffer({ staleEpoch: true })).toBe('reissueFirst');
  });
});
