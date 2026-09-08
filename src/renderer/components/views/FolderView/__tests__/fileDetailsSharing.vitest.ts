/**
 * Section « Partage » du panneau de détails — ce qui se rend pour quel `sharing`.
 *
 * Ce qui est verrouillé ici, c'est ce qui se casse sans bruit dans un JSX :
 * une section qui existe vide, une troncature qui glisse de 3 à 4, un avis
 * « journal désactivé » qui disparaît dès que des lignes d'activité arrivent
 * à côté, une date qui reste en français pour un utilisateur en anglais.
 */

import { describe, it, expect } from 'vitest';
import {
  SHARING_LIST_LIMIT,
  activityTimestampIso,
  formatDetailsDate,
  planSharingSection,
  roleLabelKey,
  type FileDetailsSharing,
  type SharingActivityEntry,
  type SharingGrantee,
  type SharingMember,
} from '../fileDetailsSharing';

const member = (n: number, role = 'member'): SharingMember => ({
  label: `Personne ${n}`,
  role,
  userId: `user-${n}`,
});

const grantee = (n: number, stale = false): SharingGrantee => ({
  label: `invite${n}@exemple.fr`,
  stale,
});

const entry = (at: number, text = `événement ${at}`): SharingActivityEntry => ({ text, at });

describe('planSharingSection — existence de la section', () => {
  it('rend null sans `sharing` : pas de section en mode local ni pour un hôte muet', () => {
    expect(planSharingSection(undefined)).toBeNull();
  });

  it('rend null pour un `sharing` fourni mais sans rien à montrer — jamais de section vide', () => {
    expect(planSharingSection({})).toBeNull();
    expect(planSharingSection({ members: [], grantees: [] })).toBeNull();
    expect(planSharingSection({ memberCount: 0, members: [] })).toBeNull();
  });

  it('existe dès qu’un seul contenu est là : le bouton, l’avis, ou une liste d’activité même vide', () => {
    expect(planSharingSection({ onOpenShareDialog: () => undefined })).not.toBeNull();
    expect(planSharingSection({ activityRecorded: false })).not.toBeNull();
    expect(planSharingSection({ recentActivity: [] })).not.toBeNull();
    expect(planSharingSection({ onViewActivity: () => undefined })).not.toBeNull();
  });

  it('un `activityRecorded: true` seul ne fait pas une section : il n’y a rien à dire', () => {
    expect(planSharingSection({ activityRecorded: true })).toBeNull();
  });
});

describe('planSharingSection — membres', () => {
  it('liste au plus SHARING_LIST_LIMIT membres et compte le reste', () => {
    const plan = planSharingSection({ members: [1, 2, 3, 4, 5].map((n) => member(n)) });
    expect(plan).not.toBeNull();
    expect(plan!.visibleMembers.map((m) => m.userId)).toEqual(['user-1', 'user-2', 'user-3']);
    expect(plan!.hiddenMemberCount).toBe(2);
    expect(plan!.memberCount).toBe(5);
    expect(SHARING_LIST_LIMIT).toBe(3);
  });

  it('exactement à la limite : tout est visible, rien de caché', () => {
    const plan = planSharingSection({ members: [1, 2, 3].map((n) => member(n)) });
    expect(plan!.visibleMembers).toHaveLength(3);
    expect(plan!.hiddenMemberCount).toBe(0);
  });

  it('l’empilement d’avatars reçoit TOUS les membres, graine = userId (teinte stable au renommage)', () => {
    const plan = planSharingSection({ members: [1, 2, 3, 4].map((n) => member(n)) });
    expect(plan!.avatarItems).toHaveLength(4);
    expect(plan!.avatarItems[0]).toEqual({ label: 'Personne 1', seed: 'user-1' });
  });

  it('`memberCount` prime sur la liste quand l’hôte connaît un total plus grand (liste partielle)', () => {
    const plan = planSharingSection({ memberCount: 12, members: [member(1)] });
    expect(plan!.memberCount).toBe(12);
    expect(plan!.visibleMembers).toHaveLength(1);
    // Les 11 autres existent, même non chargés : « et N de plus » les annonce.
    expect(plan!.hiddenMemberCount).toBe(9);
  });

  it('un `memberCount` incohérent (plus petit que la liste) ne cache jamais un membre chargé', () => {
    const plan = planSharingSection({ memberCount: 1, members: [member(1), member(2)] });
    expect(plan!.memberCount).toBe(2);
    expect(plan!.visibleMembers).toHaveLength(2);
  });

  it('un total connu sans liste fait quand même une ligne « membres »', () => {
    const plan = planSharingSection({ memberCount: 4 });
    expect(plan!.memberCount).toBe(4);
    expect(plan!.visibleMembers).toEqual([]);
    expect(plan!.hiddenMemberCount).toBe(1);
  });
});

describe('planSharingSection — personnes (grantees)', () => {
  it('tronque à SHARING_LIST_LIMIT en gardant la pastille « périmé » de chacun', () => {
    const plan = planSharingSection({
      grantees: [grantee(1), grantee(2, true), grantee(3), grantee(4, true)],
    });
    expect(plan!.visibleGrantees.map((g) => g.stale ?? false)).toEqual([false, true, false]);
    expect(plan!.hiddenGranteeCount).toBe(1);
  });

  it('sans personne : pas de ligne, et le compte de reste est zéro', () => {
    const plan = planSharingSection({ grantees: [], onOpenShareDialog: () => undefined });
    expect(plan!.visibleGrantees).toEqual([]);
    expect(plan!.hiddenGranteeCount).toBe(0);
  });
});

describe('planSharingSection — « pas encore partagé »', () => {
  it('s’affiche quand il y a un bouton mais personne', () => {
    const plan = planSharingSection({ onOpenShareDialog: () => undefined });
    expect(plan!.showNotShared).toBe(true);
    expect(plan!.showManageButton).toBe(true);
  });

  it('ne s’affiche pas dès qu’il y a un membre ou une personne', () => {
    expect(
      planSharingSection({ members: [member(1)], onOpenShareDialog: () => undefined })!
        .showNotShared
    ).toBe(false);
    expect(
      planSharingSection({ grantees: [grantee(1)], onOpenShareDialog: () => undefined })!
        .showNotShared
    ).toBe(false);
  });

  it('ne s’affiche pas sans bouton : sans geste possible, ce serait un reproche', () => {
    expect(planSharingSection({ activityRecorded: false })!.showNotShared).toBe(false);
  });
});

describe('planSharingSection — activité', () => {
  it('garde les SHARING_LIST_LIMIT plus récentes, les plus récentes d’abord, quel que soit l’ordre d’arrivée', () => {
    const plan = planSharingSection({
      recentActivity: [entry(10), entry(50), entry(30), entry(40), entry(20)],
    });
    expect(plan!.activity.map((e) => e.at)).toEqual([50, 40, 30]);
  });

  it('tri stable : deux entrées au même instant gardent leur ordre d’origine', () => {
    const plan = planSharingSection({
      recentActivity: [entry(10, 'a'), entry(10, 'b'), entry(10, 'c')],
    });
    expect(plan!.activity.map((e) => e.text)).toEqual(['a', 'b', 'c']);
  });

  it('un horodatage illisible ne fait pas sauter les autres ni lancer le tri', () => {
    const plan = planSharingSection({
      recentActivity: [entry(Number.NaN, 'nan'), entry(20, 'b'), entry(30, 'c')],
    });
    expect(plan!.activity).toHaveLength(3);
    expect(plan!.activity.map((e) => e.text)).toContain('nan');
  });

  it('liste fournie et vide → « aucune activité » ; liste absente → rien', () => {
    expect(planSharingSection({ recentActivity: [] })!.showNoActivity).toBe(true);
    expect(planSharingSection({ onOpenShareDialog: () => undefined })!.showNoActivity).toBe(false);
  });
});

describe('planSharingSection — avis « journal désactivé »', () => {
  it('s’affiche pour activityRecorded === false, et JAMAIS pour undefined ou true', () => {
    expect(planSharingSection({ activityRecorded: false })!.showActivityDisabledNotice).toBe(true);
    expect(
      planSharingSection({ activityRecorded: true, recentActivity: [] })!.showActivityDisabledNotice
    ).toBe(false);
    expect(planSharingSection({ recentActivity: [] })!.showActivityDisabledNotice).toBe(false);
  });

  it('reste affiché même à côté de lignes d’activité (un journal coupé se dit, toujours)', () => {
    const plan = planSharingSection({
      activityRecorded: false,
      recentActivity: [entry(1), entry(2)],
    });
    expect(plan!.showActivityDisabledNotice).toBe(true);
    expect(plan!.activity).toHaveLength(2);
  });

  it('quand le journal est coupé, on ne dit pas AUSSI « aucune activité » : l’avis explique le vide', () => {
    const plan = planSharingSection({ activityRecorded: false, recentActivity: [] });
    expect(plan!.showActivityDisabledNotice).toBe(true);
    expect(plan!.showNoActivity).toBe(false);
  });
});

describe('planSharingSection — gestes', () => {
  it('bouton et lien suivent la présence des rappels, indépendamment l’un de l’autre', () => {
    const both: FileDetailsSharing = {
      onOpenShareDialog: () => undefined,
      onViewActivity: () => undefined,
    };
    expect(planSharingSection(both)).toMatchObject({
      showManageButton: true,
      showViewAllLink: true,
    });
    expect(planSharingSection({ onViewActivity: () => undefined })).toMatchObject({
      showManageButton: false,
      showViewAllLink: true,
    });
  });
});

describe('roleLabelKey', () => {
  it('traduit les rôles connus, insensible à la casse et aux espaces', () => {
    expect(roleLabelKey('owner')).toBe('details.sharing.role.owner');
    expect(roleLabelKey(' Viewer ')).toBe('details.sharing.role.viewer');
    expect(roleLabelKey('EDITOR')).toBe('details.sharing.role.editor');
  });

  it('rend null pour un rôle inconnu : le panneau affiche alors la chaîne de l’hôte, pas une clé', () => {
    expect(roleLabelKey('archiviste')).toBeNull();
    expect(roleLabelKey('')).toBeNull();
  });
});

describe('activityTimestampIso', () => {
  it('rend l’ISO d’un horodatage fini, undefined sinon — sans jamais lancer', () => {
    expect(activityTimestampIso(Date.UTC(2026, 2, 5, 10, 30))).toBe('2026-03-05T10:30:00.000Z');
    expect(activityTimestampIso(Number.NaN)).toBeUndefined();
    expect(activityTimestampIso(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('formatDetailsDate', () => {
  const iso = '2026-03-05T10:30:00.000Z';

  it('suit la langue de l’app au lieu du fr-FR en dur', () => {
    expect(formatDetailsDate(iso, 'fr')).toContain('mars');
    expect(formatDetailsDate(iso, 'en')).toContain('March');
  });

  it('rend « - » pour une date absente ou illisible, jamais « Invalid Date »', () => {
    expect(formatDetailsDate(undefined, 'fr')).toBe('-');
    expect(formatDetailsDate(null, 'fr')).toBe('-');
    expect(formatDetailsDate('', 'fr')).toBe('-');
    expect(formatDetailsDate('pas une date', 'fr')).toBe('-');
  });

  it('ne lance pas sur une étiquette de langue exotique ou vide', () => {
    expect(() => formatDetailsDate(iso, 'x!!-invalid')).not.toThrow();
    expect(formatDetailsDate(iso, 'x!!-invalid')).toContain('2026');
    expect(formatDetailsDate(iso, '')).toContain('2026');
    expect(formatDetailsDate(iso, undefined)).toContain('2026');
  });
});
