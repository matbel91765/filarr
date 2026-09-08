/**
 * ssoApi.ts (E5-3) — renderer HTTP layer for the org SSO admin endpoints (OIDC). Uses the
 * authenticated apiClient (Bearer + X-Org-Id). The client_secret is write-only: the server never
 * returns it (only `hasClientSecret`), and sending an empty secret keeps the stored one.
 */

import apiClient from '../network/apiClient';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface SsoConfig {
  type: string;
  oidcIssuer: string | null;
  oidcClientId: string | null;
  hasClientSecret: boolean;
  authorizationEndpoint: string | null;
  tokenEndpoint: string | null;
  jwksUri: string | null;
  jitEnabled: boolean;
  jitDefaultRole: string;
  enabled: boolean;
}

export interface SsoDomain {
  domain: string;
  verified: boolean;
  dnsRecord: string;
  dnsValue: string;
}

/** The org's SSO config, or null if none is set yet. */
export async function apiGetSsoConfig(orgId: string): Promise<SsoConfig | null> {
  const { data } = await apiClient.get<Envelope<SsoConfig | null>>(`/org/${orgId}/sso`);
  return data.data ?? null;
}

/** Create/update the OIDC connection. Runs discovery server-side; an empty clientSecret is kept. */
export async function apiSaveSsoConfig(
  orgId: string,
  body: {
    issuer: string;
    clientId: string;
    clientSecret?: string;
    jitEnabled: boolean;
    jitDefaultRole: string;
  }
): Promise<{ authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string }> {
  const { data } = await apiClient.post<
    Envelope<{ authorizationEndpoint: string; tokenEndpoint: string; jwksUri: string }>
  >(`/org/${orgId}/sso`, body);
  return data.data!;
}

/** Flip the connection live (requires a verified domain) or off. */
export async function apiEnableSso(orgId: string, enabled: boolean): Promise<void> {
  await apiClient.post<Envelope<unknown>>(`/org/${orgId}/sso/enable`, { enabled });
}

export async function apiListSsoDomains(orgId: string): Promise<SsoDomain[]> {
  const { data } = await apiClient.get<Envelope<{ domains: SsoDomain[] }>>(
    `/org/${orgId}/sso/domains`
  );
  return data.data?.domains ?? [];
}

/** Claim a domain → returns the DNS-TXT record to publish. */
export async function apiAddSsoDomain(orgId: string, domain: string): Promise<SsoDomain> {
  const { data } = await apiClient.post<Envelope<SsoDomain>>(`/org/${orgId}/sso/domains`, {
    domain,
  });
  return data.data!;
}

/** Check the published TXT record (server does the DoH lookup). Returns the new verified state. */
export async function apiVerifySsoDomain(orgId: string, domain: string): Promise<boolean> {
  const { data } = await apiClient.post<Envelope<{ verified: boolean }>>(
    `/org/${orgId}/sso/domains/verify`,
    { domain }
  );
  return data.data?.verified ?? false;
}
