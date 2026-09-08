import { describe, it, expect } from 'vitest';
import {
  coverageVerdict,
  effectiveTierOf,
  memoryOf,
  publishOrgCoverage,
  rankOf,
  readOrgCoverage,
  subscribeOrgCoverage,
  type OrgCoverage,
} from './orgCoverage';

/**
 * « VOTRE ORGANISATION NE VOUS COUVRE PLUS » — le verdict, ligne par ligne.
 *
 * Deux façons de se tromper, relevées par la session site avant qu'on n'expédie :
 *  · dire « vérifiez votre phrase de récupération » à quelqu'un dont
 *    l'organisation a seulement cessé de payer — sa copie de récupération est
 *    intacte, on l'enverrait chercher une perte qui n'a pas eu lieu ;
 *  · annoncer quatre pertes à un Pro dont l'organisation Teams s'arrête, alors
 *    qu'il garde 150 Go et ne perd que l'écriture dans les coffres d'équipe.
 * Une notice qui crie pour rien apprend à ne plus être lue.
 */

const GiB = 1024 * 1024 * 1024;
const cov = (over: Partial<OrgCoverage>): OrgCoverage => ({
  tier: 'free',
  effectiveTier: 'teams',
  coveredByOrg: true,
  orgMembership: 'covered',
  storageUsed: 0,
  storageLimit: 150 * GiB,
  ...over,
});

describe('coverageVerdict', () => {
  it('sans mémoire : on retient, on ne dit rien', () => {
    expect(coverageVerdict(null, cov({}))).toEqual({ kind: 'first' });
  });

  it('RETIRÉ : coffres coupés, récupération purgée — et un gratuit perd quota et appareils', () => {
    const avant = memoryOf(cov({}));
    const apres = cov({
      effectiveTier: 'free',
      coveredByOrg: false,
      orgMembership: 'none',
      storageLimit: 5 * GiB,
    });
    expect(coverageVerdict(avant, apres)).toEqual({
      kind: 'lost',
      reason: 'removed',
      rankDropped: true,
      quotaDropped: true,
    });
  });

  it("L'ORGANISATION NE PAIE PLUS, compte Pro : rien ne baisse — la notice ne dit que la lecture seule", () => {
    // Le faux positif : teams → pro fait basculer `coveredByOrg`, mais les deux
    // valent 150 Go. Le rang baisse (le plafond d'appareils PEUT bouger), le
    // quota non, et la récupération n'a pas été purgée.
    const avant = memoryOf(cov({ tier: 'pro' }));
    const apres = cov({
      tier: 'pro',
      effectiveTier: 'pro',
      coveredByOrg: false,
      orgMembership: 'lapsed',
    });
    expect(coverageVerdict(avant, apres)).toEqual({
      kind: 'lost',
      reason: 'billing',
      rankDropped: true,
      quotaDropped: false,
    });
  });

  it("l'organisation reprend son abonnement : « gained », rien à annoncer", () => {
    const avant = memoryOf(
      cov({
        effectiveTier: 'free',
        coveredByOrg: false,
        orgMembership: 'lapsed',
        storageLimit: 5 * GiB,
      })
    );
    expect(coverageVerdict(avant, cov({}))).toEqual({ kind: 'gained' });
  });

  it('rien ne bouge : « same » — y compris quand on n’a jamais été couvert', () => {
    expect(coverageVerdict(memoryOf(cov({})), cov({}))).toEqual({ kind: 'same' });
    const jamais = cov({
      effectiveTier: 'free',
      coveredByOrg: false,
      orgMembership: 'none',
      storageLimit: 5 * GiB,
    });
    expect(coverageVerdict(memoryOf(jamais), jamais)).toEqual({ kind: 'same' });
  });

  it('un compte qui n’a jamais été couvert et dont l’org lapse ne déclenche rien (il n’a rien perdu)', () => {
    const avant = memoryOf(
      cov({
        effectiveTier: 'enterprise',
        tier: 'enterprise',
        orgMembership: 'none',
        coveredByOrg: false,
      })
    );
    const apres = cov({
      effectiveTier: 'enterprise',
      tier: 'enterprise',
      orgMembership: 'lapsed',
      coveredByOrg: false,
    });
    expect(coverageVerdict(avant, apres)).toEqual({ kind: 'same' });
  });
});

describe('rankOf — miroir du serveur', () => {
  it('free < solo < pro < teams < enterprise, inconnu = free', () => {
    expect([
      rankOf('free'),
      rankOf('solo'),
      rankOf('pro'),
      rankOf('teams'),
      rankOf('enterprise'),
    ]).toEqual([0, 1, 2, 3, 4]);
    expect(rankOf('platine')).toBe(0);
  });
});

describe('le palier EFFECTIF pour les écrans', () => {
  it("l'effectif l'emporte quand il est connu, sinon le personnel — jamais un palier deviné", () => {
    expect(effectiveTierOf(cov({ effectiveTier: 'teams' }), 'free')).toBe('teams');
    expect(effectiveTierOf(null, 'solo')).toBe('solo');
    expect(effectiveTierOf(null, undefined)).toBe('free');
    expect(effectiveTierOf(cov({ effectiveTier: '' }), 'pro')).toBe('pro');
  });

  it('le magasin publie, se lit, et prévient ses abonnés', () => {
    let appels = 0;
    const off = subscribeOrgCoverage(() => {
      appels++;
    });
    const c = cov({ effectiveTier: 'teams' });
    publishOrgCoverage(c);
    expect(readOrgCoverage()).toBe(c);
    expect(appels).toBe(1);
    off();
    publishOrgCoverage(null);
    expect(appels).toBe(1);
    expect(readOrgCoverage()).toBeNull();
  });
});
