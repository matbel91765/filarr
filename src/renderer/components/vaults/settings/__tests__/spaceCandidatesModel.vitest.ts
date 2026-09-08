/**
 * spaceCandidatesModel — « qui est dans mon espace sans avoir accès à ce
 * coffre », et rien d'autre.
 *
 * CE QUE CES TESTS GARDENT. Le défaut rapporté est une ABSENCE : la ligne
 * d'invitation attend qu'on tape une adresse, et personne n'est nommé nulle
 * part — « je ne vois toujours pas matbel ». Une liste de candidats se casse en
 * silence de quatre façons qui compilent toutes parfaitement : on s'y propose
 * soi-même, on y propose quelqu'un qui a déjà accès, on y perd la personne
 * cherchée parce que la casse ne correspond pas, ou on affirme « personne » sur
 * un annuaire qu'on n'a pas su lire. Aucune ne se voit à l'œil sans deux comptes
 * réels ; toutes se voient ici.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/spaceCandidatesModel.vitest.ts
 */

import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_SECTION_LIMIT,
  CANDIDATE_SUGGESTION_LIMIT,
  nextCandidateIndex,
  spaceCandidates,
} from '../spaceCandidatesModel';
import type { VaultInviteDTO, VaultMemberDTO } from '../../../../../services/vault/vaultApi';

const NOW = Date.parse('2026-08-29T12:00:00.000Z');

const membre = (userId: string, role = 'member') =>
  ({ userId, role, joinedAt: '2026-01-01T00:00:00.000Z' }) as VaultMemberDTO;

const invitation = (inviteeEmail: string, extra: Partial<VaultInviteDTO> = {}) =>
  ({
    id: `inv-${inviteeEmail}`,
    vaultId: 'v1',
    inviteeEmail,
    role: 'member',
    status: 'pending',
    // Une semaine devant nous : vivante, sauf mention contraire.
    expiresAt: '2026-09-05T12:00:00.000Z',
    createdAt: '2026-08-29T09:00:00.000Z',
    ...extra,
  }) as VaultInviteDTO;

const ANNUAIRE = [
  { userId: 'u-zoe', email: 'zoe@x.tld' },
  { userId: 'u-matbel', email: 'matbel91765@gmail.com' },
  { userId: 'u-alice', email: 'alice@x.tld' },
  { userId: 'u-moi', email: 'matlion47@gmail.com' },
];

describe('spaceCandidates — les gens de l’espace qui n’ont pas accès', () => {
  it('rend ceux que le coffre ne connaît pas, triés par adresse', () => {
    const out = spaceCandidates({
      directory: ANNUAIRE,
      members: [membre('u-moi', 'owner')],
      myUserId: 'u-moi',
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.email)).toEqual([
      'alice@x.tld',
      'matbel91765@gmail.com',
      'zoe@x.tld',
    ]);
    expect(out.total).toBe(3);
    expect(out.hidden).toBe(0);
  });

  it('le cas rapporté : le coffre n’a que son propriétaire, matbel apparaît quand même', () => {
    const out = spaceCandidates({
      directory: [
        { userId: 'u-moi', email: 'matlion47@gmail.com' },
        { userId: 'u-matbel', email: 'matbel91765@gmail.com' },
      ],
      members: [membre('u-moi', 'owner')],
      myUserId: 'u-moi',
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.userId)).toEqual(['u-matbel']);
  });

  it('ne se propose jamais soi-même, même absent du trombinoscope', () => {
    const out = spaceCandidates({
      directory: ANNUAIRE,
      members: [],
      myUserId: 'u-moi',
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.userId)).not.toContain('u-moi');
    expect(out.total).toBe(3);
  });

  it('sans identifiant connu, on n’exclut personne à l’aveugle', () => {
    const out = spaceCandidates({
      directory: ANNUAIRE,
      members: [],
      myUserId: null,
      nowMs: NOW,
    });
    expect(out.total).toBe(4);
  });

  it('écarte les membres du coffre — ils ont déjà accès', () => {
    const out = spaceCandidates({
      directory: ANNUAIRE,
      members: [membre('u-moi', 'owner'), membre('u-alice', 'admin'), membre('u-zoe')],
      myUserId: 'u-moi',
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.userId)).toEqual(['u-matbel']);
  });

  it('écarte une entrée sans adresse : il n’y aurait rien à pré-remplir', () => {
    const out = spaceCandidates({
      directory: [
        { userId: 'u-vide', email: '' },
        { userId: 'u-blanc', email: '   ' },
        { userId: 'u-alice', email: 'alice@x.tld' },
      ],
      members: [],
      myUserId: null,
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.userId)).toEqual(['u-alice']);
  });

  it('annuaire illisible (donc vide) : aucune affirmation', () => {
    const out = spaceCandidates({
      directory: [],
      members: [membre('u-moi', 'owner')],
      myUserId: 'u-moi',
      nowMs: NOW,
    });
    expect(out.items).toEqual([]);
    expect(out.total).toBe(0);
  });
});

describe('le drapeau « invitation en attente »', () => {
  const base = {
    directory: ANNUAIRE,
    members: [membre('u-moi', 'owner')],
    myUserId: 'u-moi',
    nowMs: NOW,
  };

  it('se pose sur l’adresse invitée, casse et espaces ignorés', () => {
    const out = spaceCandidates({
      ...base,
      invites: [invitation('  MatBel91765@Gmail.COM ')],
    });
    expect(out.items.find((c) => c.userId === 'u-matbel')!.pendingInvite).toBe(true);
    expect(out.items.find((c) => c.userId === 'u-alice')!.pendingInvite).toBe(false);
  });

  it('une invitation morte ne le pose pas — expirée, révoquée, ou périmée avant le cron', () => {
    for (const morte of [
      invitation('matbel91765@gmail.com', { status: 'expired' }),
      invitation('matbel91765@gmail.com', { status: 'revoked' }),
      invitation('matbel91765@gmail.com', { status: 'accepted' }),
      // Encore `pending` côté serveur, mais la date est passée : le balayage
      // n'a simplement pas encore eu lieu.
      invitation('matbel91765@gmail.com', { expiresAt: '2026-08-01T00:00:00.000Z' }),
    ]) {
      const out = spaceCandidates({ ...base, invites: [morte] });
      expect(out.items.find((c) => c.userId === 'u-matbel')!.pendingInvite).toBe(false);
    }
  });

  it('sans liste d’invitations (rôle sans la route), le drapeau reste baissé', () => {
    const out = spaceCandidates(base);
    expect(out.items.every((c) => !c.pendingInvite)).toBe(true);
  });
});

describe('le filtre de la frappe', () => {
  const base = { directory: ANNUAIRE, members: [], myUserId: 'u-moi', nowMs: NOW };

  it('insensible à la casse, sur le PRÉFIXE comme sur la sous-chaîne', () => {
    expect(spaceCandidates({ ...base, filter: 'MAT' }).items.map((c) => c.userId)).toEqual([
      'u-matbel',
    ]);
    expect(spaceCandidates({ ...base, filter: 'gmail' }).items.map((c) => c.userId)).toEqual([
      'u-matbel',
    ]);
    expect(spaceCandidates({ ...base, filter: '@x.tld' }).items.map((c) => c.userId)).toEqual([
      'u-alice',
      'u-zoe',
    ]);
  });

  it('le préfixe passe devant la sous-chaîne, puis l’ordre alphabétique', () => {
    const out = spaceCandidates({
      directory: [
        { userId: 'u-1', email: 'zoe.mat@x.tld' },
        { userId: 'u-2', email: 'mat.b@x.tld' },
        { userId: 'u-3', email: 'mat.a@x.tld' },
        { userId: 'u-4', email: 'alice.mat@x.tld' },
      ],
      members: [],
      myUserId: null,
      filter: 'mat',
      nowMs: NOW,
    });
    expect(out.items.map((c) => c.email)).toEqual([
      'mat.a@x.tld',
      'mat.b@x.tld',
      'alice.mat@x.tld',
      'zoe.mat@x.tld',
    ]);
  });

  it('un filtre vide ou fait d’espaces ne filtre rien', () => {
    expect(spaceCandidates({ ...base, filter: '' }).total).toBe(3);
    expect(spaceCandidates({ ...base, filter: '   ' }).total).toBe(3);
  });

  it('une adresse inconnue ne rend personne — et n’empêche pas de l’envoyer', () => {
    const out = spaceCandidates({ ...base, filter: 'nouveau@ailleurs.tld' });
    expect(out.items).toEqual([]);
    expect(out.total).toBe(0);
  });
});

describe('la limite', () => {
  const foule = Array.from({ length: 12 }, (_, i) => ({
    userId: `u-${i}`,
    // `p01@…` : deux chiffres, pour que l'ordre alphabétique soit l'ordre humain.
    email: `p${String(i).padStart(2, '0')}@x.tld`,
  }));

  it('tronque `items` mais dit la vérité sur le total', () => {
    const out = spaceCandidates({
      directory: foule,
      members: [],
      myUserId: null,
      limit: 8,
      nowMs: NOW,
    });
    expect(out.items).toHaveLength(8);
    expect(out.items[0].email).toBe('p00@x.tld');
    expect(out.total).toBe(12);
    expect(out.hidden).toBe(4);
  });

  it('sans limite, tout est rendu', () => {
    const out = spaceCandidates({ directory: foule, members: [], myUserId: null, nowMs: NOW });
    expect(out.items).toHaveLength(12);
    expect(out.hidden).toBe(0);
  });

  it('la limite de la liste déroulante est celle de la fiche : huit', () => {
    expect(CANDIDATE_SUGGESTION_LIMIT).toBe(8);
  });

  /**
   * LA SECTION AUSSI A UN PLAFOND, DÉSORMAIS. Elle n'en avait pas, au motif que
   * « l'annuaire d'un espace est borné par ses sièges » — vrai d'un espace
   * personnel partagé, faux d'un espace d'entreprise à plusieurs centaines de
   * sièges. Le plafond doit rester NETTEMENT au-dessus de celui de la liste
   * déroulante : la section répond à « qui n'a pas accès ? », et la rabattre sur
   * huit noms rendrait les deux surfaces redondantes.
   */
  it('la section a son propre plafond, bien plus haut que celui du champ', () => {
    expect(CANDIDATE_SECTION_LIMIT).toBe(25);
    expect(CANDIDATE_SECTION_LIMIT).toBeGreaterThan(CANDIDATE_SUGGESTION_LIMIT);
  });

  it('au-delà du plafond de section, `hidden` dit ce qui manque', () => {
    const espaceDentreprise = Array.from({ length: 300 }, (_, i) => ({
      userId: `u-${i}`,
      email: `p${String(i).padStart(3, '0')}@x.tld`,
    }));
    const out = spaceCandidates({
      directory: espaceDentreprise,
      members: [],
      myUserId: null,
      limit: CANDIDATE_SECTION_LIMIT,
      nowMs: NOW,
    });
    expect(out.items).toHaveLength(25);
    expect(out.total).toBe(300);
    expect(out.hidden).toBe(275);
  });
});

describe('nextCandidateIndex — les flèches dans la liste', () => {
  it('descend, remonte, et boucle par « ce que j’ai tapé » (-1)', () => {
    // Trois candidats : quatre positions, dont celle du texte libre.
    expect(nextCandidateIndex(-1, 1, 3)).toBe(0);
    expect(nextCandidateIndex(0, 1, 3)).toBe(1);
    expect(nextCandidateIndex(2, 1, 3)).toBe(-1);
    expect(nextCandidateIndex(-1, -1, 3)).toBe(2);
    expect(nextCandidateIndex(0, -1, 3)).toBe(-1);
  });

  it('liste vide : on reste sur son texte, la flèche ne fait rien de faux', () => {
    expect(nextCandidateIndex(-1, 1, 0)).toBe(-1);
    expect(nextCandidateIndex(-1, -1, 0)).toBe(-1);
  });

  it('un index devenu hors bornes (la liste a rétréci sous la frappe) revient au texte', () => {
    expect(nextCandidateIndex(9, 1, 2)).toBe(-1);
    expect(nextCandidateIndex(9, -1, 2)).toBe(-1);
  });
});
