/**
 * orgCoverage — « votre organisation vous couvre-t-elle encore ? »
 *
 * CE QUE ÇA REGARDE. Payer un siège d'organisation n'écrit jamais l'abonnement
 * personnel : le serveur calcule un palier EFFECTIF (le meilleur du personnel
 * et de l'organisation) et le dit dans `GET /billing/status` — `coveredByOrg`
 * est vrai quand c'est l'organisation qui élève le palier.
 *
 * CE QUE ÇA DÉCIDE. Le jour où ce booléen passe de vrai à faux, quatre choses
 * changent d'un coup pour la personne (coffres fermés, quota redescendu,
 * plafond d'appareils, récupération par l'organisation perdue) — et sans ce
 * module elle ne l'apprendrait que par un 413 muet, quelques jours plus tard.
 * Ce module ne fait que REMARQUER la transition ; l'écran dit le reste.
 *
 * LA MÉMOIRE EST PAR COMPTE ET PAR APPAREIL : c'est une question d'affichage
 * (« vous l'a-t-on déjà dit ici ? »), pas un état du compte. Deux comptes sur
 * le même navigateur ne partagent pas leur réponse.
 */

import apiClient from '../network/apiClient';

/**
 * L'ÉTAT D'APPARTENANCE, tel que le serveur le tranche — le client n'a aucun
 * autre moyen de distinguer « j'ai été retiré » (coffres coupés, copie de
 * récupération purgée) de « l'organisation ne paie plus » (appartenance
 * intacte, coffres en lecture seule, récupération intacte).
 */
export type OrgMembershipState = 'covered' | 'lapsed' | 'none';

export interface OrgCoverage {
  /** Le palier PERSONNEL (`users.subscription_tier`). */
  tier: string;
  /** Le palier appliqué — le meilleur du personnel et de l'organisation. */
  effectiveTier: string;
  /** Vrai quand c'est l'organisation qui porte le palier au-dessus du personnel. */
  coveredByOrg: boolean;
  orgMembership: OrgMembershipState;
  storageUsed: number;
  storageLimit: number;
}

/** Miroir de `TIER_RANK` côté serveur : free < solo < pro < teams < enterprise. */
const TIER_RANK: Record<string, number> = { free: 0, solo: 1, pro: 2, teams: 3, enterprise: 4 };
export const rankOf = (tier: string): number => TIER_RANK[tier] ?? 0;

/** Ce que cet appareil retient d'une lecture : de quoi dire, la fois suivante, ce qui a BAISSÉ. */
export interface CoverageMemory {
  membership: OrgMembershipState;
  rank: number;
  storageLimit: number;
}

export function memoryOf(c: OrgCoverage): CoverageMemory {
  return {
    membership: c.orgMembership,
    rank: rankOf(c.effectiveTier),
    storageLimit: c.storageLimit,
  };
}

export type CoverageVerdict =
  | { kind: 'first' }
  | { kind: 'same' }
  | { kind: 'gained' }
  | {
      kind: 'lost';
      /** `removed` : plus d'appartenance ; `billing` : l'organisation ne paie plus. */
      reason: 'removed' | 'billing';
      /** Le palier effectif a réellement BAISSÉ — sinon rien ne change pour les plafonds. */
      rankDropped: boolean;
      /** Le quota de synchronisation a réellement baissé. */
      quotaDropped: boolean;
    };

/**
 * LE VERDICT, LIGNE PAR LIGNE. La bascule « couvert → plus couvert » ne suffit
 * pas : un compte Pro dont l'organisation Teams cesse de payer garde 150 Go et
 * ne perd que l'écriture dans les coffres d'équipe. Lui annoncer quatre pertes
 * apprendrait à ne plus lire la notice — la seule qui compte le jour où quelque
 * chose arrive vraiment. Chaque conséquence n'est donc dite que si elle a eu lieu.
 */
export function coverageVerdict(
  previous: CoverageMemory | null,
  current: OrgCoverage
): CoverageVerdict {
  if (previous === null) return { kind: 'first' };
  const now = memoryOf(current);
  if (previous.membership === 'covered' && now.membership !== 'covered') {
    return {
      kind: 'lost',
      reason: now.membership === 'none' ? 'removed' : 'billing',
      rankDropped: now.rank < previous.rank,
      quotaDropped: now.storageLimit < previous.storageLimit,
    };
  }
  if (previous.membership !== 'covered' && now.membership === 'covered') return { kind: 'gained' };
  return { kind: 'same' };
}

const KEY = (userId: string): string => `filarr.orgCoverage.${userId}`;

export function readLastCoverage(userId: string): CoverageMemory | null {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<CoverageMemory>;
    if (
      (j.membership === 'covered' || j.membership === 'lapsed' || j.membership === 'none') &&
      typeof j.rank === 'number' &&
      typeof j.storageLimit === 'number'
    ) {
      return { membership: j.membership, rank: j.rank, storageLimit: j.storageLimit };
    }
    // Une mémoire d'une forme antérieure (ou illisible) vaut « aucune » : on
    // réapprend en silence plutôt que de déduire une perte d'un format.
    return null;
  } catch {
    // Stockage indisponible (navigation privée, politique du navigateur) : sans
    // mémoire, on se comporte comme au premier jour — on retient, on ne dit rien.
    return null;
  }
}

export function writeLastCoverage(userId: string, memory: CoverageMemory): void {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(memory));
  } catch {
    /* sans mémoire, l'écran reviendra au prochain montage — acceptable */
  }
}

/** Une seule requête, celle que l'écran d'abonnement fait déjà. `null` hors ligne. */
export async function fetchOrgCoverage(): Promise<OrgCoverage | null> {
  try {
    const { data } = await apiClient.get<{
      success: boolean;
      data?: Partial<OrgCoverage>;
    }>('/billing/status');
    const d = data?.data;
    if (!data?.success || !d || typeof d.coveredByOrg !== 'boolean') return null;
    const m = d.orgMembership;
    return {
      tier: typeof d.tier === 'string' ? d.tier : 'free',
      effectiveTier: typeof d.effectiveTier === 'string' ? d.effectiveTier : 'free',
      coveredByOrg: d.coveredByOrg,
      // Un worker d'avant le champ : on dérive de `coveredByOrg`, sans inventer
      // de « lapsed » — la ligne « lecture seule » ne se dira pas à tort.
      orgMembership:
        m === 'covered' || m === 'lapsed' || m === 'none' ? m : d.coveredByOrg ? 'covered' : 'none',
      storageUsed: typeof d.storageUsed === 'number' ? d.storageUsed : 0,
      storageLimit: typeof d.storageLimit === 'number' ? d.storageLimit : 0,
    };
  } catch {
    return null;
  }
}

// ── Le palier EFFECTIF, pour les écrans qui décident d'après le palier ───────
//
// LE DÉFAUT QUE CECI FERME. Trois écrans lisaient `cloudUser.subscriptionTier`
// — le palier PERSONNEL, celui du jeton — pour griser des options ou compter
// des règles. Un siège Teams a 'free' sur cette ligne : la modale de partage
// lui interdisait le mot de passe et 14 jours d'échéance pendant que le
// serveur, lui, lui accordait Teams. Le même défaut que le lot paliers côté
// serveur (C2), côté écran. Le palier effectif vient de `/billing/status`,
// lu une fois par `OrgCoverageNotice` et publié ici pour tous.
//
// Même patron que `mentionInbox` : un magasin de module, publié par qui lit,
// lu par qui décide. Avant la première lecture, on retombe sur le palier
// personnel — l'ancien comportement, jamais un palier deviné.

type Listener = () => void;
let _coverage: OrgCoverage | null = null;
const _listeners = new Set<Listener>();

export function publishOrgCoverage(c: OrgCoverage | null): void {
  _coverage = c;
  for (const l of _listeners) l();
}

export function readOrgCoverage(): OrgCoverage | null {
  return _coverage;
}

export function subscribeOrgCoverage(listener: Listener): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Le palier à appliquer à l'écran : l'effectif s'il est connu, sinon le personnel. */
export function effectiveTierOf(
  coverage: OrgCoverage | null,
  personalTier: string | null | undefined
): string {
  if (coverage && typeof coverage.effectiveTier === 'string' && coverage.effectiveTier) {
    return coverage.effectiveTier;
  }
  return personalTier || 'free';
}
