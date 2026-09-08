/**
 * Which tenant each request is scoped to.
 *
 * The header is the whole reason shared vaults work outside the enterprise space,
 * and the whole reason they can break: send none and org-scoped routes answer 400
 * org_required; send the wrong one and a guest's vault is a 404 that looks exactly
 * like "deleted". So precedence is pinned here, including the negative case that
 * keeps every personal route (/sync, /share, /send) exactly as it was.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveOrgHeader,
  getOrgContextId,
  setActiveOrg,
  setImplicitOrg,
  rememberVaultOrg,
  forgetVaultOrgs,
  requiresAuth,
} from '../apiClient';

beforeEach(() => {
  setActiveOrg(null);
  setImplicitOrg(null);
  forgetVaultOrgs();
});

describe('resolveOrgHeader', () => {
  it('sends nothing when no context is known', () => {
    expect(resolveOrgHeader('/vaults')).toBeNull();
  });

  it('fills org-scoped paths in with the implicit personal space', () => {
    setImplicitOrg('mine');
    expect(resolveOrgHeader('/vaults')).toBe('mine');
    expect(resolveOrgHeader('/vaults/v1/items')).toBe('mine');
    expect(resolveOrgHeader('/account/public-key/u2')).toBe('mine');
    expect(resolveOrgHeader('/account/keys/log/u2')).toBe('mine');
  });

  it('leaves personal routes untouched — no request gains a tenant it never had', () => {
    setImplicitOrg('mine');
    for (const path of ['/sync/delta', '/share/abc', '/send/xyz', '/account/wrapped-key']) {
      expect(resolveOrgHeader(path)).toBeNull();
    }
  });

  it('scopes a vault to the space it was FOUND in, not to ours', () => {
    setImplicitOrg('mine');
    rememberVaultOrg('guestVault', 'host');
    expect(resolveOrgHeader('/vaults/guestVault/items')).toBe('host');
    // A vault we never listed falls back to the ambient context (e.g. creation).
    expect(resolveOrgHeader('/vaults/unknown/items')).toBe('mine');
    expect(resolveOrgHeader('/vaults')).toBe('mine');
  });

  it('lets an explicitly chosen org outrank the implicit one', () => {
    setImplicitOrg('mine');
    setActiveOrg('acme');
    expect(resolveOrgHeader('/vaults')).toBe('acme');
    // …but a vault's own tenant is more specific still.
    rememberVaultOrg('v9', 'host');
    expect(resolveOrgHeader('/vaults/v9')).toBe('host');
  });

  it('tolerates an absolute URL and a query string', () => {
    setImplicitOrg('mine');
    expect(resolveOrgHeader('https://api.filarr.com/vaults?since=1')).toBe('mine');
  });

  it('does not mistake a lookalike path for an org-scoped one', () => {
    setImplicitOrg('mine');
    expect(resolveOrgHeader('/vaultsomething')).toBeNull();
    expect(resolveOrgHeader('/organizations-export')).toBeNull();
  });
});

describe('getOrgContextId', () => {
  it('answers for a named vault, for raw fetches that build their own request', () => {
    setImplicitOrg('mine');
    rememberVaultOrg('v1', 'host');
    expect(getOrgContextId('v1')).toBe('host');
    expect(getOrgContextId('unlisted')).toBe('mine');
    expect(getOrgContextId()).toBe('mine');
  });

  it('is cleared with the index, so a profile switch cannot inherit a tenant', () => {
    setImplicitOrg('mine');
    rememberVaultOrg('v1', 'host');
    forgetVaultOrgs();
    setImplicitOrg(null);
    expect(getOrgContextId('v1')).toBeNull();
  });
});

/**
 * QUELLES REQUÊTES PARTENT SANS JETON — et pourquoi c'est un sujet.
 *
 * L'intercepteur refuse LOCALEMENT une route authentifiée quand aucun jeton n'a
 * pu être obtenu : partir anonyme ne produirait qu'un 401, que
 * `classifyVaultFailure` lit `session_expired`, TERMINAL — l'écran dirait
 * « votre session s'est terminée » et retirerait « Réessayer » sur une coupure
 * de quelques secondes.
 *
 * MAIS DEUX ROUTES PUBLIQUES VIVENT SOUS CES PRÉFIXES : les aperçus
 * d'invitation. Le jeton d'invitation EST leur autorité (qui le tient tient
 * déjà l'invitation), et leur seul usage sérieux est justement celui où AUCUNE
 * session n'existe — le sélecteur de profils du bureau avant toute activation,
 * et l'écran d'acceptation d'un visiteur pas encore connecté. Le garde les
 * rejetait donc sur place, et la ligne « Envoyée à b@… » ne pouvait
 * structurellement pas s'afficher là où elle sert le plus — sans que rien ne le
 * dise, un aperçu refusé ressemblant en tout point à un aperçu resté sans
 * réponse.
 */
describe('requiresAuth', () => {
  it('laisse partir les deux aperçus publics d’invitation, sans session', () => {
    expect(requiresAuth('/org/invitations/abc123')).toBe(false);
    expect(requiresAuth('/vaults/invites/abc123/preview')).toBe(false);
    // Le jeton échappé (`%2F`) reste UN segment : la route publique aussi.
    expect(requiresAuth('/vaults/invites/a%2Fb%3Fc/preview')).toBe(false);
    // Une requête absolue passe par le même chemin.
    expect(requiresAuth('https://api.filarr.com/org/invitations/abc123')).toBe(false);
  });

  it('n’ouvre RIEN d’autre sous ces préfixes — l’exception est un motif, pas un préfixe', () => {
    for (const path of [
      '/org/invitations/abc123/accept',
      '/org/invitations',
      '/vaults/invites',
      '/vaults/invites/abc123',
      '/vaults/invites/abc123/preview/extra',
      '/vaults/v1/invites',
      '/vaults',
      '/vaults/v1/items',
      '/org/personal',
      '/me',
      '/shared-with-me',
      '/marketplace/x',
    ]) {
      expect(requiresAuth(path), path).toBe(true);
    }
  });

  it('laisse partir les routes qui n’ont jamais exigé de jeton', () => {
    for (const path of ['/health', '/auth/login', '/sync/delta', '/send/xyz', '', undefined]) {
      expect(requiresAuth(path), String(path)).toBe(false);
    }
  });
});
