/**
 * Organization Types — Filarr Enterprise (E1)
 *
 * Shared between the renderer (React/Redux) and the Electron main process.
 * Mirrors the worker's OrganizationDTO + the caller's role (from GET /org).
 */

export type OrgRole = 'owner' | 'admin' | 'security_admin' | 'editor' | 'viewer';

/** One entry of GET /org — an org the current user belongs to, with their role. */
export interface OrgSummary {
  id: string;
  name: string;
  slug: string | null;
  tier: string; // 'teams' | 'enterprise' (or inherited personal tier)
  role: OrgRole;
  billingStatus: string; // 'active' | 'past_due' | 'suspended' | 'canceled'
  status: string; // 'active' | 'suspended' | 'pending_deletion'
  /**
   * True for the auto-provisioned personal org every user carries. Enterprise
   * space and the org switcher only consider real (isPersonal === false) orgs —
   * the personal org is an implementation detail of the billing model, never a
   * "workspace" the user picks. Returned by GET /org (toOrganizationDTO).
   */
  isPersonal: boolean;
}

/**
 * Lightweight org descriptor denormalized onto ProfileMetadata so the
 * pre-activation ProfilePicker can decide whether to offer the Enterprise
 * toggle without a network round-trip. Only real (non-personal) orgs are kept.
 */
export interface OrgHint {
  id: string;
  name: string;
  tier: string;
  role: OrgRole;
  isPersonal: boolean;
}

/** Admin console DTOs (mirror the worker's org DTOs). */
export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  /** Canonical account email (E3-8) — used by the team-vault invite picker. */
  email: string;
  role: OrgRole;
  status: string;
  createdAt: string;
}

export interface OrgInvitation {
  id: string;
  orgId: string;
  email: string;
  role: OrgRole;
  status: string;
  expiresAt: string;
  createdAt: string;
}

export interface OrgBillingStatus {
  tier: string;
  billingStatus: string;
  status: string;
  seatsPurchased: number;
  billableMembers: number;
  pooledStorageLimit: number;
  /** Octets occupés par les coffres de l’organisation (supprimés compris tant que R2 les tient). */
  pooledStorageUsed?: number;
  /** Fin de l'essai sans carte, si un essai a été ouvert un jour (ISO). */
  trialEndsAt?: string | null;
  /** L'essai est-il ENCORE en cours ? (fenêtre non close) */
  trialing?: boolean;
  /**
   * L'organisation a-t-elle droit à ce qu'elle paie ?
   *
   * Répondu PAR LE SERVEUR, avec le prédicat exact qui garde les fonctions. Les
   * interfaces le recalculaient chacune à partir de trois champs et deux listes
   * de valeurs — trois copies d'une règle, donc trois occasions de proposer une
   * carte que le serveur refusera ensuite, ou l'inverse.
   */
  entitled?: boolean;
}
