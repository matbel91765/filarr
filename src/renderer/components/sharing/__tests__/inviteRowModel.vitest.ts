/**
 * LA LIGNE D'INVITATION DIT L'ISSUE AVANT LE CLIC (F02).
 *
 * Le défaut d'origine n'était pas un bug de calcul : c'était un écran qui ne
 * disait rien. Deux boutons sans rapport — « Invite » pour l'ESPACE, « Give
 * access » pour le COFFRE — et l'hôte apprenait laquelle des deux voies il avait
 * prise par le toast qui suivait. Ce que ces tests tiennent, ce sont les cinq
 * états et ce que chacun promet : une promesse qu'on ne peut pas tenir (« l'accès
 * suivra ») affichée sur un annuaire illisible est exactement le mensonge que la
 * fiche existe pour retirer.
 */

import { describe, it, expect } from 'vitest';
import { inviteRowView, INVITE_ROW_KEYS as K, type InviteRowFlags } from '../inviteRowModel';
import type { InviteRouteEx } from '../shareDialogModel';

const flags = (over: Partial<InviteRowFlags> = {}): InviteRowFlags => ({
  keyReady: true,
  needsConfirm: false,
  seatBlocked: false,
  hasOrg: true,
  sending: false,
  ...over,
});

const MEMBER: InviteRouteEx = {
  kind: 'member',
  member: { userId: 'u2', email: 'bob@x.io' },
};
const IN_VAULT: InviteRouteEx = {
  kind: 'inVault',
  member: { userId: 'u2', email: 'bob@x.io' },
};
const NEWCOMER: InviteRouteEx = { kind: 'newcomer', email: 'dave@x.io' };
const EMPTY: InviteRouteEx = { kind: 'empty' };
const UNKNOWN: InviteRouteEx = { kind: 'unknown' };

describe('member — dans votre espace, l’accès est donné maintenant', () => {
  it('annonce le scellement, déplie la cérémonie et nomme le geste', () => {
    const v = inviteRowView(MEMBER, flags());
    expect(v.noticeKey).toBe(K.routeMember);
    expect(v.showCeremony).toBe(true);
    expect(v.buttonKey).toBe(K.giveAccess);
    expect(v.canSend).toBe(true);
  });

  it('le bouton DIT qu’il confirme quand la clé a changé', () => {
    // Sans ça, « Donner l'accès » ferait valider une empreinte nouvelle sans que
    // rien à l'écran n'ait annoncé que c'était aussi ce qu'on validait.
    const v = inviteRowView(MEMBER, flags({ needsConfirm: true }));
    expect(v.buttonKey).toBe(K.confirmAndGiveAccess);
  });

  it('reste ÉTEINT tant que la cérémonie n’autorise pas le scellement', () => {
    // `keyReady` est faux pendant la vérification, sur un journal falsifié, et
    // sur un changement de clé non confirmé : trois raisons de ne rien sceller.
    expect(inviteRowView(MEMBER, flags({ keyReady: false })).canSend).toBe(false);
    expect(inviteRowView(MEMBER, flags({ sending: true })).canSend).toBe(false);
  });

  it('NE CONSULTE PAS le plafond de sièges — sceller ne consomme aucun siège', () => {
    // Le défaut de l'ancien modal : il désactivait le champ entier dès que
    // l'espace était plein, y compris pour donner l'accès à quelqu'un qui y
    // était DÉJÀ, c'est-à-dire au seul geste qui ne coûte rien.
    const v = inviteRowView(MEMBER, flags({ seatBlocked: true }));
    expect(v.canSend).toBe(true);
    expect(v.noticeKey).toBe(K.routeMember);
  });
});

describe('newcomer — un e-mail part, l’accès suit tout seul', () => {
  it('annonce l’invitation d’espace, sans cérémonie (aucune clé à vérifier encore)', () => {
    const v = inviteRowView(NEWCOMER, flags());
    expect(v.noticeKey).toBe(K.routeNewcomer);
    expect(v.buttonKey).toBe(K.sendSpaceInvite);
    expect(v.showCeremony).toBe(false);
    expect(v.canSend).toBe(true);
  });

  it('le plafond de l’espace est la SEULE chose qui l’empêche, et il le dit', () => {
    const v = inviteRowView(NEWCOMER, flags({ seatBlocked: true }));
    expect(v.canSend).toBe(false);
    expect(v.noticeKey).toBe(K.routeSpaceFull);
    expect(v.noticeTone).toBe('warn');
  });

  it('sans espace connu, il n’y a nulle part où inviter', () => {
    expect(inviteRowView(NEWCOMER, flags({ hasOrg: false })).canSend).toBe(false);
  });
});

describe('inVault — la personne a déjà accès', () => {
  it('le dit, éteint le bouton et emmène vers sa ligne', () => {
    const v = inviteRowView(IN_VAULT, flags());
    expect(v.noticeKey).toBe(K.routeInVault);
    expect(v.canSend).toBe(false);
    expect(v.showSeeRow).toBe(true);
    expect(v.showCeremony).toBe(false);
  });
});

describe('empty — rien de tapé', () => {
  it('AUCUN message : reprocher une adresse à moitié tapée fait lire les vrais comme du bruit', () => {
    const v = inviteRowView(EMPTY, flags());
    expect(v.noticeKey).toBeNull();
    expect(v.canSend).toBe(false);
    expect(v.showCeremony).toBe(false);
    expect(v.showSeeRow).toBe(false);
  });
});

describe('unknown — l’annuaire n’a pas pu être lu', () => {
  it('n’invite PAS à l’aveugle et propose de relire', () => {
    // C'est l'état neuf de la fiche. L'échec silencieux de l'annuaire (403 pour
    // un admin de coffre invité chez quelqu'un d'autre) faisait passer TOUT LE
    // MONDE pour un nouveau venu : on proposait une invitation d'espace à des
    // gens qui y étaient déjà, et le 409 arrivait après coup.
    const v = inviteRowView(UNKNOWN, flags());
    expect(v.noticeKey).toBe(K.routeUnknown);
    expect(v.noticeTone).toBe('warn');
    expect(v.canSend).toBe(false);
    expect(v.showCeremony).toBe(false);
  });

  it('reste éteint même avec une clé prête et un espace disponible', () => {
    // Les autres portes sont ouvertes ; c'est le ROUTAGE qu'on ignore.
    expect(inviteRowView(UNKNOWN, flags({ keyReady: true, seatBlocked: false })).canSend).toBe(
      false
    );
  });
});

describe('les cinq états, vus ensemble', () => {
  it('un seul état arme le bouton pour chaque voie, et jamais deux voies à la fois', () => {
    const routes: InviteRouteEx[] = [MEMBER, NEWCOMER, IN_VAULT, EMPTY, UNKNOWN];
    const armed = routes.filter((r) => inviteRowView(r, flags()).canSend).map((r) => r.kind);
    expect(armed).toEqual(['member', 'newcomer']);
  });

  it('la cérémonie ne se déplie QUE là où une clé est résolvable', () => {
    const routes: InviteRouteEx[] = [MEMBER, NEWCOMER, IN_VAULT, EMPTY, UNKNOWN];
    const withCeremony = routes
      .filter((r) => inviteRowView(r, flags()).showCeremony)
      .map((r) => r.kind);
    expect(withCeremony).toEqual(['member']);
  });

  it('rien n’est envoyable pendant qu’un envoi est en vol', () => {
    const routes: InviteRouteEx[] = [MEMBER, NEWCOMER, IN_VAULT, EMPTY, UNKNOWN];
    for (const r of routes) {
      expect(inviteRowView(r, flags({ sending: true })).canSend, r.kind).toBe(false);
    }
  });
});
