import { describe, it, expect, vi } from 'vitest';
import {
  mayAutoSeal,
  canGrantIn,
  runGrantSweep,
  type SweepCandidate,
  type SweepDeps,
} from '../pendingGrantSweep';
import type { PendingGrantDTO } from '../vaultApi';

/**
 * LE BALAYAGE DES INTENTIONS — ce qui remplace le second geste de l'hôte.
 *
 * Un seul défaut se cache ici, et il est grave dans les deux sens. Sceller trop
 * largement, c'est donner l'accès à un coffre chiffré de bout en bout sous une
 * clé que personne n'a vérifiée — exactement ce que la transparence des clés
 * existe pour refuser, et l'automatisation est précisément ce qui rend la faute
 * silencieuse. Sceller trop peu, c'est laisser des gens attendre un accès promis
 * devant un écran qui ne dit rien, ce qui est le défaut d'origine.
 *
 * Ces tests tiennent donc la LIGNE : quels verdicts de transparence autorisent
 * un scellement sans humain, et ce qu'il advient de tout le reste.
 *
 * `deps.seal` A CHANGÉ DE DESTINATION AVEC F06 — ajout direct au lieu d'une
 * invitation par jeton — et rien ici n'a bougé : c'est exactement la propriété
 * qu'on veut. Ce module décide QUAND sceller ; par où l'écriture passe est
 * l'affaire de l'appelant (`sweepPendingGrants`, éprouvé dans
 * `store/slices/__tests__/addMemberDirect.vitest.ts`).
 */

const grant = (o: Partial<PendingGrantDTO> = {}): PendingGrantDTO => ({
  inviteId: 'inv1',
  email: 'zoe@x.com',
  userId: 'u-zoe',
  role: 'member',
  hasKey: true,
  ...o,
});

const admin = (o: Partial<SweepCandidate> = {}): SweepCandidate => ({
  id: 'v1',
  role: 'admin',
  unlocked: true,
  ...o,
});

/** Des dépendances par défaut où TOUT réussit — chaque test n'en casse qu'une. */
function deps(over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    listGrants: vi.fn(async () => [grant()]),
    verify: vi.fn(async () => ({ status: 'ok' as const, peerKey: { userId: 'u-zoe' } })),
    seal: vi.fn(async () => null),
    ...over,
  };
}

// ── 1. LA LIGNE : QUELS VERDICTS AUTORISENT UN SCELLEMENT SANS HUMAIN ────────

describe('mayAutoSeal — la frontière de l’automatisation', () => {
  it('autorise ce que le sélecteur manuel accepte SANS confirmation', () => {
    // `ok` : clé identique à celle épinglée. `first_seen` / `no_log` : première
    // rencontre, il n'y a rien à comparer — et le sélecteur manuel ne demande
    // rien non plus dans ce cas. Automatiser ne baisse donc aucune garde.
    expect(mayAutoSeal('ok')).toBe(true);
    expect(mayAutoSeal('first_seen')).toBe(true);
    expect(mayAutoSeal('no_log')).toBe(true);
  });

  it('refuse TOUT ce qui demande un humain', () => {
    // `changed` exige une comparaison hors bande ; les deux autres sont des
    // signes de substitution possible et BLOQUENT le sélecteur manuel.
    expect(mayAutoSeal('changed')).toBe(false);
    expect(mayAutoSeal('served_not_latest')).toBe(false);
    expect(mayAutoSeal('tampered_log')).toBe(false);
  });

  it('refuse l’absence de verdict — un silence n’autorise rien', () => {
    expect(mayAutoSeal(null)).toBe(false);
    expect(mayAutoSeal(undefined)).toBe(false);
  });
});

describe('canGrantIn — qui peut faire entrer quelqu’un', () => {
  it('propriétaire et admin, et personne d’autre', () => {
    expect(canGrantIn('owner')).toBe(true);
    expect(canGrantIn('admin')).toBe(true);
    expect(canGrantIn('member')).toBe(false);
    expect(canGrantIn('viewer')).toBe(false);
  });
});

// ── 2. CE QUE LE BALAYAGE NE REGARDE MÊME PAS ────────────────────────────────

describe('les coffres écartés d’emblée', () => {
  it('un coffre où l’on est simple membre n’est pas interrogé', async () => {
    const d = deps();
    const r = await runGrantSweep([admin({ role: 'member' })], d);
    expect(d.listGrants).not.toHaveBeenCalled();
    expect(r).toEqual({ granted: [], blocked: [] });
  });

  it('un coffre VERROUILLÉ non plus — sans K_vault, il n’y a rien à sceller', async () => {
    const d = deps();
    await runGrantSweep([admin({ unlocked: false })], d);
    expect(d.listGrants).not.toHaveBeenCalled();
  });
});

// ── 3. LES BLOCAGES, ET LEUR MOTIF ───────────────────────────────────────────

describe('ce qui est remonté à l’hôte au lieu d’être exécuté', () => {
  it('un compte sans clé publiée : aucun aller-retour, motif no_key', async () => {
    const d = deps({ listGrants: vi.fn(async () => [grant({ hasKey: false })]) });
    const r = await runGrantSweep([admin()], d);

    expect(d.verify).not.toHaveBeenCalled();
    expect(d.seal).not.toHaveBeenCalled();
    expect(r.blocked).toEqual([
      { vaultId: 'v1', email: 'zoe@x.com', userId: 'u-zoe', reason: 'no_key' },
    ]);
  });

  it('porte l’IDENTIFIANT du compte, pas seulement l’adresse', async () => {
    // Sans lui, la fiche « Où en est l'accès de X ? » ne peut ni lancer la
    // cérémonie de clé (qui s'adresse à un compte) ni retirer l'entrée après un
    // scellement manuel — la pastille survivait à sa propre cause.
    const d = deps({ verify: vi.fn(async () => ({ status: 'changed' as const, peerKey: {} })) });
    const r = await runGrantSweep([admin()], d);
    expect(r.blocked[0].userId).toBe('u-zoe');
  });

  it('une clé introuvable au moment de la vérification : même motif', async () => {
    const d = deps({ verify: vi.fn(async () => null) });
    const r = await runGrantSweep([admin()], d);
    expect(r.blocked[0].reason).toBe('no_key');
    expect(d.seal).not.toHaveBeenCalled();
  });

  it('une clé qui a CHANGÉ n’est jamais scellée dans le dos de l’hôte', async () => {
    // Le cœur du sujet : c'est ici qu'une automatisation trop zélée
    // transformerait un scellement vérifié en scellement de confiance.
    const d = deps({
      verify: vi.fn(async () => ({ status: 'changed' as const, peerKey: {} })),
    });
    const r = await runGrantSweep([admin()], d);

    expect(d.seal).not.toHaveBeenCalled();
    expect(r.granted).toEqual([]);
    expect(r.blocked).toEqual([
      { vaultId: 'v1', email: 'zoe@x.com', userId: 'u-zoe', reason: 'key_unverified' },
    ]);
  });

  it('un journal falsifié non plus', async () => {
    const d = deps({
      verify: vi.fn(async () => ({ status: 'tampered_log' as const, peerKey: {} })),
    });
    const r = await runGrantSweep([admin()], d);
    expect(d.seal).not.toHaveBeenCalled();
    expect(r.blocked[0].reason).toBe('key_unverified');
  });

  it('une clé servie qui n’est pas la dernière du journal non plus', async () => {
    const d = deps({
      verify: vi.fn(async () => ({ status: 'served_not_latest' as const, peerKey: {} })),
    });
    const r = await runGrantSweep([admin()], d);
    expect(d.seal).not.toHaveBeenCalled();
    expect(r.blocked[0].reason).toBe('key_unverified');
  });

  it('un refus du scellement est signalé comme tel, et retentable', async () => {
    const d = deps({ seal: vi.fn(async () => 'rate_limited') });
    const r = await runGrantSweep([admin()], d);
    expect(r.granted).toEqual([]);
    expect(r.blocked[0].reason).toBe('seal_failed');
  });
});

/**
 * `seal_failed` DÉMULTIPLEXÉ (F04) — LE DÉFAUT QUE CETTE SECTION FERME.
 *
 * Tout refus du scellement devenait « Filarr réessaiera la prochaine fois ».
 * Or deux de ces refus disent l'exact contraire d'une panne : `already_member`
 * (quelqu'un a fait entrer la personne entre-temps) et `already_invited` (une
 * invitation valide porte déjà le même scellé). La promesse EST tenue, par un
 * autre chemin — et la phrase de reprise était non seulement fausse mais
 * INDÉFINIE : chaque passage suivant se faisait refuser à l'identique, donc la
 * pastille ne partait jamais.
 */
describe('le refus qui n’en est pas un', () => {
  it.each(['already_member', 'already_invited'])(
    '%s retire l’entrée au lieu de promettre une reprise',
    async (code) => {
      const d = deps({ seal: vi.fn(async () => code) });
      const r = await runGrantSweep([admin()], d);
      expect(r.blocked).toEqual([]);
      // Ni annoncée non plus : aucun accès n'a été accordé par CE passage, et
      // un toast « accès accordé » serait une seconde contre-vérité.
      expect(r.granted).toEqual([]);
    }
  );

  it('n’avale que ces deux-là — le reste reste une panne à reprendre', async () => {
    for (const code of ['rate_limited', 'not_org_member', 'host_plan_lapsed', 'server_error']) {
      const d = deps({ seal: vi.fn(async () => code) });
      const r = await runGrantSweep([admin()], d);
      expect(r.blocked, code).toEqual([
        { vaultId: 'v1', email: 'zoe@x.com', userId: 'u-zoe', reason: 'seal_failed' },
      ]);
    }
  });

  it('n’interrompt pas la file : la personne suivante est servie', async () => {
    const d = deps({
      listGrants: vi.fn(async () => [grant({ email: 'a@x.com' }), grant({ email: 'b@x.com' })]),
      seal: vi.fn(async ({ grant: g }) => (g.email === 'a@x.com' ? 'already_member' : null)),
    });
    const r = await runGrantSweep([admin()], d);
    expect(r.blocked).toEqual([]);
    expect(r.granted).toEqual([{ vaultId: 'v1', email: 'b@x.com' }]);
  });
});

// ── 4. LE CAS NOMINAL ────────────────────────────────────────────────────────

describe('quand tout va bien, personne n’a rien à faire', () => {
  it('scelle et rend la personne servie', async () => {
    const d = deps();
    const r = await runGrantSweep([admin()], d);
    expect(r.granted).toEqual([{ vaultId: 'v1', email: 'zoe@x.com' }]);
    expect(r.blocked).toEqual([]);
  });

  it('scelle à la clé VÉRIFIÉE, pas à une clé re-demandée', async () => {
    // La redemander rouvrirait la fenêtre où le serveur peut en substituer une
    // autre entre le contrôle et le scellé.
    const verified = { userId: 'u-zoe', fingerprint: 'FP-VERIFIEE' };
    const d = deps({
      verify: vi.fn(async () => ({ status: 'first_seen' as const, peerKey: verified })),
    });
    await runGrantSweep([admin()], d);
    expect(vi.mocked(d.seal).mock.calls[0][0].peerKey).toBe(verified);
  });

  it('porte le rôle de coffre voulu jusqu’au scellement', async () => {
    const d = deps({ listGrants: vi.fn(async () => [grant({ role: 'viewer' })]) });
    await runGrantSweep([admin()], d);
    expect(vi.mocked(d.seal).mock.calls[0][0].grant.role).toBe('viewer');
  });
});

// ── 5. LA ROBUSTESSE : UNE GREFFE NE DOIT PAS CASSER SON HÔTE ────────────────

describe('un incident local ne prive personne d’autre de son accès', () => {
  it('un coffre dont la lecture échoue est sauté, les autres sont servis', async () => {
    const d = deps({
      listGrants: vi.fn(async (vaultId: string) => {
        if (vaultId === 'v1') throw new Error('boom');
        return [grant({ email: 'bob@x.com' })];
      }),
    });
    const r = await runGrantSweep([admin(), admin({ id: 'v2' })], d);
    expect(r.granted).toEqual([{ vaultId: 'v2', email: 'bob@x.com' }]);
  });

  it('une vérification qui JETTE devient un blocage, pas une panne', async () => {
    const d = deps({
      verify: vi.fn(async () => {
        throw new Error('réseau');
      }),
    });
    const r = await runGrantSweep([admin()], d);
    expect(r.blocked[0].reason).toBe('no_key');
  });

  it('un scellement qui JETTE n’interrompt pas la suite', async () => {
    const d = deps({
      listGrants: vi.fn(async () => [grant({ email: 'a@x.com' }), grant({ email: 'b@x.com' })]),
      seal: vi.fn(async ({ grant: g }) => {
        if (g.email === 'a@x.com') throw new Error('boom');
        return null;
      }),
    });
    const r = await runGrantSweep([admin()], d);
    expect(r.blocked).toEqual([
      { vaultId: 'v1', email: 'a@x.com', userId: 'u-zoe', reason: 'seal_failed' },
    ]);
    expect(r.granted).toEqual([{ vaultId: 'v1', email: 'b@x.com' }]);
  });

  it('scelle SÉQUENTIELLEMENT — deux e-mails de front feraient un pic de requêtes', async () => {
    let concurrent = 0;
    let peak = 0;
    const d = deps({
      listGrants: vi.fn(async () => [grant({ email: 'a@x.com' }), grant({ email: 'b@x.com' })]),
      seal: vi.fn(async () => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        await new Promise((r) => setTimeout(r, 5));
        concurrent -= 1;
        return null;
      }),
    });
    await runGrantSweep([admin()], d);
    expect(peak).toBe(1);
  });
});
