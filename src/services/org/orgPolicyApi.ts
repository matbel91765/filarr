/**
 * orgPolicyApi.ts — renderer HTTP layer for the org governance policy admin endpoints (E9-1). Uses the
 * authenticated apiClient (Bearer + X-Org-Id). The policy is metadata only (never a vault key) and
 * versioned append-only; updates are optimistic-concurrency gated on `expectedVersion`.
 */

import apiClient from '../network/apiClient';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface SessionPolicy {
  idleTimeoutMinutes: number | null;
  absoluteTimeoutMinutes: number | null;
  reauthForSensitiveActions: boolean;
  offlineGraceDays: number | null;
  /** E5-7: require every member to have 2FA (enforced on password logins). */
  mfaRequired: boolean;
}

export interface SharingPolicy {
  externalSharesDisabled: boolean;
  forceExpiry: boolean;
  maxExpiryDays: number | null;
  forcePassword: boolean;
  restrictDownload: boolean;
}

export interface RetentionPolicy {
  trashRetentionDays: number | null;
  versionRetentionDays: number | null;
}

export interface IpAllowlistPolicy {
  enabled: boolean;
  cidrs: string[];
}

export type PluginPolicyMode = 'open' | 'allowlist' | 'blocked';

/**
 * Politique du POSTE DE TRAVAIL — ce que l'organisation impose à l'application
 * elle-même, par opposition à la session, au réseau ou au partage.
 *
 * MIROIR de `WorkspacePolicy` (infra/cloudflare-worker/src/policies.ts), qui reste
 * l'autorité : le Worker valide chaque champ, refuse le catalogue, refuse le
 * paquet d'une extension hors liste et refuse la publication. L'écran
 * d'administration écrit ici ; il ne décide de rien.
 */
export interface WorkspacePolicy {
  marketplaceDisabled: boolean;
  layoutMarketDisabled: boolean;
  pluginPolicy: PluginPolicyMode;
  allowedPluginIds: string[];
  publishingDisabled: boolean;
  defaultTheme: string | null;
  themeLocked: boolean;
  defaultFontId: string | null;
  fontLocked: boolean;
}

/**
 * Les thèmes et polices qu'une organisation peut imposer.
 *
 * MIROIRS des listes closes du Worker (`ORG_THEMES` / `ORG_FONTS`). Elles sont
 * ici pour REMPLIR le sélecteur, jamais pour valider : c'est le Worker qui refuse
 * une valeur inconnue, et il le fera même si cette copie dérive. La conséquence
 * d'une dérive est donc un choix manquant dans une liste, pas un poste qui se
 * retrouve avec un thème que personne ne sait résoudre.
 *
 * 'custom' est volontairement absent : c'est la palette qu'un utilisateur s'est
 * composée sur SON poste, elle n'existe chez aucun de ses collègues.
 */
export const ORG_THEME_IDS = [
  'light',
  'dark',
  'space',
  'lofi',
  'sky',
  'aurora',
  'sakura',
  'crepuscule',
  'foret',
  'terracotta',
  'papier',
  'minuit',
] as const;

export const ORG_FONT_IDS = [
  'inter',
  'system',
  'geist',
  'mono',
  'georgia',
  'nunito',
  'space-grotesk',
  'atkinson',
  'jakarta',
] as const;

export interface OrgPolicyDocument {
  session: SessionPolicy;
  sharing: SharingPolicy;
  retention: RetentionPolicy;
  ipAllowlist: IpAllowlistPolicy;
  /**
   * Facultative : une organisation dont la politique a été écrite avant l'arrivée
   * de cette section n'en a pas, et l'écran doit alors partir du défaut du
   * produit plutôt que de tomber en panne sur un champ absent.
   */
  workspace?: WorkspacePolicy;
}

/** Le défaut du produit : aucune restriction. Ce que voit une organisation qui n'a rien réglé. */
export const OPEN_WORKSPACE_POLICY: WorkspacePolicy = {
  marketplaceDisabled: false,
  layoutMarketDisabled: false,
  pluginPolicy: 'open',
  allowedPluginIds: [],
  publishingDisabled: false,
  defaultTheme: null,
  themeLocked: false,
  defaultFontId: null,
  fontLocked: false,
};

export interface OrgPolicyState {
  policy: OrgPolicyDocument;
  version: number;
  updatedAt: string | null;
}

/** The org's current governance policy (defaults if none set yet). */
export async function apiGetOrgPolicy(orgId: string): Promise<OrgPolicyState> {
  const { data } = await apiClient.get<Envelope<OrgPolicyState>>(`/org/${orgId}/policies`);
  if (!data.success || !data.data) throw new Error(data.error || 'Failed to load policy');
  return data.data;
}

/** A partial patch — only the sections present are replaced (server merges the rest). */
export type OrgPolicyPatch = Partial<OrgPolicyDocument>;

/**
 * Apply a partial patch → a new version. `expectedVersion` is the version last read; the server rejects
 * the write if it no longer matches (someone else edited), so the client can reload and retry.
 */
export async function apiUpdateOrgPolicy(
  orgId: string,
  patch: OrgPolicyPatch,
  expectedVersion: number
): Promise<{ policy: OrgPolicyDocument; version: number; unchanged?: boolean }> {
  const { data } = await apiClient.put<
    Envelope<{ policy: OrgPolicyDocument; version: number; unchanged?: boolean }>
  >(`/org/${orgId}/policies`, { policy: patch, expectedVersion });
  if (!data.success || !data.data) throw new Error(data.error || 'Failed to save policy');
  return data.data;
}
