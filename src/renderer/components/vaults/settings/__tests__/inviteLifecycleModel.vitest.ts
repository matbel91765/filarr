import { describe, it, expect } from 'vitest';
import {
  EXPIRING_SOON_MS,
  groupInvites,
  isLapsed,
  isStaleEpoch,
  lapsedCause,
  parseInstant,
  reissueAction,
} from '../inviteLifecycleModel';
import type { VaultInviteDTO } from '../../../../../services/vault/vaultApi';

/**
 * LE DÉFAUT QUE CE MODÈLE FERME (F03). `listVaultInvites` filtre
 * `expires_at > now` : une invitation expirée et une personne jamais invitée
 * rendaient EXACTEMENT le même écran vide chez l'hôte. C'est cette
 * indiscernabilité qui a fait conclure à un accès perdu (cas du 28/08) là où il
 * n'y avait qu'un lien à réémettre.
 *
 * Trois décisions se jouent ici, et aucune ne se voit à la compilation :
 *   — QUAND une ligne est échue : le serveur le dit (`expired` / `revoked`),
 *     mais il ne le dit qu'après son balayage. Entre la péremption et le cron,
 *     la ligne est `pending` avec une date passée, et l'hôte ne doit PAS lire
 *     « expire le … » au passé pendant ce temps ;
 *   — QUAND relancer est un mensonge : une invitation scellée sous une époque
 *     révolue ne s'ouvrira jamais (l'époque ne fait que monter), donc le bouton
 *     doit dire « Réémettre », pas « Relancer » ;
 *   — QUELLE action propose la ligne échue : réinviter (la personne est dans
 *     l'espace : accès scellé sur-le-champ) ou l'inviter à nouveau DANS
 *     l'espace. Et quand l'annuaire n'a pas pu être lu, on ne devine pas.
 */

const invite = (o: Partial<VaultInviteDTO> = {}): VaultInviteDTO => ({
  id: 'inv1',
  vaultId: 'v1',
  inviteeEmail: 'zoe@x.io',
  role: 'member',
  status: 'pending',
  expiresAt: '2026-09-10T10:00:00.000Z',
  createdAt: '2026-09-03 10:00:00',
  wrappedVaultKeyEpoch: 3,
  ...o,
});

/** Le 5 septembre 2026 à midi UTC — entre la création et la péremption ci-dessus. */
const NOW = Date.parse('2026-09-05T12:00:00.000Z');

const annuaire = [{ userId: 'u-zoe', email: 'zoe@x.io' }];

// ── 1. LES DATES : DEUX FORMATS CIRCULENT, ET LES CONFONDRE DÉCALE D'UNE HEURE

describe('parseInstant', () => {
  it('lit l’ISO que le worker écrit pour expires_at', () => {
    expect(parseInstant('2026-09-10T10:00:00.000Z')).toBe(Date.parse('2026-09-10T10:00:00.000Z'));
  });

  it('lit le format SQLite de settled_at COMME DE L’UTC', () => {
    // `'YYYY-MM-DD HH:MM:SS'` sans fuseau : passé tel quel à `Date.parse`, un
    // navigateur le lit en heure LOCALE et la date affichée glisse d'un fuseau.
    // C'est de l'UTC — le worker l'écrit avec `datetime('now')`.
    expect(parseInstant('2026-09-04 08:30:00')).toBe(Date.parse('2026-09-04T08:30:00Z'));
  });

  it('ne fabrique jamais de date à partir de rien', () => {
    expect(parseInstant(null)).toBeNull();
    expect(parseInstant(undefined)).toBeNull();
    expect(parseInstant('')).toBeNull();
    expect(parseInstant('pas une date')).toBeNull();
  });
});

// ── 2. « ÉCHUE » : LE SERVEUR LE DIT, ET LE CLIENT LE VOIT AUSSI ─────────────

describe('isLapsed — le verdict est aussi dérivé côté client', () => {
  it('reconnaît ce que le serveur a déjà classé', () => {
    expect(isLapsed(invite({ status: 'expired' }), NOW)).toBe(true);
    expect(isLapsed(invite({ status: 'revoked' }), NOW)).toBe(true);
  });

  it('reconnaît une PENDING dont la date est passée — le cron n’a pas encore balayé', () => {
    // C'est la fenêtre où l'ancien écran affichait « expire le 3 septembre »
    // sur une invitation déjà morte, avec un bouton « Relancer » à côté.
    expect(isLapsed(invite({ expiresAt: '2026-09-04T10:00:00.000Z' }), NOW)).toBe(true);
  });

  it('laisse tranquille une invitation encore vivante', () => {
    expect(isLapsed(invite(), NOW)).toBe(false);
    expect(isLapsed(invite({ status: 'accepted' }), NOW)).toBe(false);
    expect(isLapsed(invite({ status: 'declined' }), NOW)).toBe(false);
  });

  it('n’affirme rien d’une date illisible', () => {
    // Un worker plus ancien, un champ vide : l'absence d'information ne devient
    // pas un verdict (« terminal ≠ jetable »).
    expect(isLapsed(invite({ expiresAt: '' }), NOW)).toBe(false);
  });
});

describe('lapsedCause — révoquée et expirée n’appellent pas la même phrase', () => {
  it('distingue la reprise volontaire de la péremption', () => {
    expect(lapsedCause(invite({ status: 'revoked' }))).toBe('revoked');
    expect(lapsedCause(invite({ status: 'expired' }))).toBe('expired');
    // Une pending échue est une expiration que le cron n'a pas encore écrite.
    expect(lapsedCause(invite({ status: 'pending' }))).toBe('expired');
  });
});

// ── 3. « À RÉÉMETTRE » : RELANCER NE PEUT QUE SE FAIRE REFUSER ───────────────

describe('isStaleEpoch', () => {
  it('est vrai quand le scellé date d’une époque révolue', () => {
    expect(isStaleEpoch(invite({ wrappedVaultKeyEpoch: 2 }), 3)).toBe(true);
  });

  it('est faux quand le scellé est à jour', () => {
    expect(isStaleEpoch(invite({ wrappedVaultKeyEpoch: 3 }), 3)).toBe(false);
  });

  it('n’AFFIRME RIEN quand le worker n’envoie pas l’époque', () => {
    // Un worker d'avant F03 omet le champ. Le lire comme un zéro ferait marquer
    // « à réémettre » TOUTES les invitations d'un coffre déjà tourné.
    expect(isStaleEpoch(invite({ wrappedVaultKeyEpoch: undefined }), 3)).toBe(false);
  });
});

// ── 4. L’ACTION PROPOSÉE DÉPEND DE L’ANNUAIRE, ET DE SA LISIBILITÉ ───────────

describe('reissueAction', () => {
  it('propose la ré-invitation directe pour quelqu’un de l’espace', () => {
    expect(reissueAction('zoe@x.io', annuaire, 'ok')).toEqual({
      kind: 'reinvite',
      userId: 'u-zoe',
    });
  });

  it('compare les adresses sans se laisser arrêter par la casse ni les espaces', () => {
    expect(reissueAction('  ZOE@X.io ', annuaire, 'ok').kind).toBe('reinvite');
  });

  it('renvoie vers l’espace pour quelqu’un qui n’y est plus', () => {
    expect(reissueAction('parti@x.io', annuaire, 'ok')).toEqual({
      kind: 'reinviteToSpace',
      userId: null,
    });
  });

  it('REFUSE DE DEVINER quand l’annuaire n’a pas pu être lu', () => {
    // Le défaut d'origine : un annuaire refusé (403 systématique pour un admin
    // de coffre invité) faisait passer TOUT LE MONDE pour un nouveau venu, donc
    // proposait une invitation d'espace à des gens qui y étaient déjà.
    expect(reissueAction('zoe@x.io', [], 'forbidden').kind).toBe('unknown');
    expect(reissueAction('zoe@x.io', [], 'unavailable').kind).toBe('unknown');
  });
});

// ── 5. LE REGROUPEMENT, TEL QUE L’ÉCRAN LE CONSOMME ──────────────────────────

describe('groupInvites', () => {
  const base = {
    settled: [],
    lapsed: [],
    nowMs: NOW,
    currentKeyEpoch: 3,
    directory: annuaire,
    directoryState: 'ok' as const,
  };

  it('déplace une PENDING échue hors de la section « En attente »', () => {
    const morte = invite({ id: 'morte', expiresAt: '2026-09-01T10:00:00.000Z' });
    const g = groupInvites({ ...base, invites: [invite(), morte] });

    expect(g.pending.map((r) => r.invite.id)).toEqual(['inv1']);
    expect(g.lapsed.map((r) => r.invite.id)).toEqual(['morte']);
    expect(g.lapsed[0].cause).toBe('expired');
  });

  it('ne montre pas deux fois la même invitation quand le serveur la liste aussi', () => {
    // Le worker rend les `pending` échues DANS `lapsed` : sans dédoublonnage,
    // la même ligne apparaît dans les deux listes.
    const morte = invite({ id: 'morte', expiresAt: '2026-09-01T10:00:00.000Z' });
    const g = groupInvites({ ...base, invites: [morte], lapsed: [morte] });
    expect(g.lapsed).toHaveLength(1);
  });

  it('marque « à réémettre » une ligne en attente scellée sous une époque révolue', () => {
    const g = groupInvites({ ...base, invites: [invite({ wrappedVaultKeyEpoch: 1 })] });
    expect(g.pending[0].staleEpoch).toBe(true);
    expect(g.toReissue).toBe(1);
    // Et elle porte l'action de rattrapage, pas un « Relancer » qui échouerait.
    expect(g.pending[0].action.kind).toBe('reinvite');
  });

  it('compte celles qui expirent sous 48 h, et pas les autres', () => {
    const g = groupInvites({
      ...base,
      invites: [
        invite({ id: 'urgente', expiresAt: new Date(NOW + EXPIRING_SOON_MS - 1000).toISOString() }),
        invite({ id: 'calme', expiresAt: new Date(NOW + EXPIRING_SOON_MS + 1000).toISOString() }),
      ],
    });
    expect(g.expiringSoon).toBe(1);
    expect(g.pending.find((r) => r.invite.id === 'urgente')?.urgent).toBe(true);
    expect(g.pending.find((r) => r.invite.id === 'calme')?.urgent).toBe(false);
  });

  it('trie les échues de la plus récente à la plus ancienne', () => {
    const g = groupInvites({
      ...base,
      invites: [],
      lapsed: [
        invite({ id: 'vieille', status: 'revoked', settledAt: '2026-09-01 08:00:00' }),
        invite({ id: 'fraiche', status: 'revoked', settledAt: '2026-09-04 08:00:00' }),
      ],
    });
    expect(g.lapsed.map((r) => r.invite.id)).toEqual(['fraiche', 'vieille']);
  });

  it('lit la date de règlement d’une révocation, pas sa péremption', () => {
    const g = groupInvites({
      ...base,
      invites: [],
      lapsed: [invite({ status: 'revoked', settledAt: '2026-09-04 08:00:00' })],
    });
    expect(g.lapsed[0].atMs).toBe(Date.parse('2026-09-04T08:00:00Z'));
    expect(g.lapsed[0].cause).toBe('revoked');
  });

  it('garde l’accusé des quatorze jours tel que le serveur le sert', () => {
    const g = groupInvites({
      ...base,
      invites: [],
      settled: [invite({ id: 'ok', status: 'accepted', settledAt: '2026-09-04 08:00:00' })],
    });
    expect(g.settled.map((r) => r.invite.id)).toEqual(['ok']);
    expect(g.settled[0].atMs).toBe(Date.parse('2026-09-04T08:00:00Z'));
  });

  it('n’offre aucune action quand l’annuaire est illisible — bouton désactivé', () => {
    const g = groupInvites({
      ...base,
      invites: [],
      lapsed: [invite({ status: 'expired' })],
      directory: [],
      directoryState: 'forbidden',
    });
    expect(g.lapsed[0].action.kind).toBe('unknown');
  });

  it('propose d’inviter à nouveau DANS L’ESPACE quelqu’un qui n’y est plus', () => {
    const g = groupInvites({
      ...base,
      invites: [],
      lapsed: [invite({ status: 'expired', inviteeEmail: 'parti@x.io' })],
    });
    expect(g.lapsed[0].action).toEqual({ kind: 'reinviteToSpace', userId: null });
  });

  it('ramène un rôle inconnu au rôle le moins privilégié plutôt que de le porter tel quel', () => {
    // `role` est une chaîne libre dans le DTO ; la ré-invitation, elle, doit
    // poster un rôle que le serveur accepte.
    const g = groupInvites({ ...base, invites: [invite({ role: 'sorcier' })] });
    expect(g.pending[0].role).toBe('viewer');
  });
});
