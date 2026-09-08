/**
 * Le code du serveur doit SURVIVRE au transport, sur la route de jointure aussi.
 *
 * CE QUI ÉTAIT CASSÉ. `apiJoinVault` était le seul de ses voisins à ne pas
 * classifier ses échecs. Axios aplatit un refus en « Request failed with status
 * code 403 » ; le thunk recopiait cette phrase telle quelle, et tout le travail
 * de traduction des refus (invitation expirée, adresse qui ne correspond pas,
 * clé changée depuis) devenait décoratif : l'utilisateur recevait une chaîne
 * anglaise sur le statut HTTP, pour la seule opération dont les échecs sont
 * précisément ceux qu'il peut corriger lui-même.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const client = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('../../network/apiClient', () => ({ default: client }));

import {
  apiJoinVault,
  apiGetOrgInvitationPreview,
  apiGetVaultInvitationPreview,
} from '../vaultApi';
import { isDeadInviteError, isVaultErrorRetryable } from '../vaultErrorMessages';

/** Un rejet façon axios : le serveur a répondu, avec son code. */
function httpError(status: number, code?: string) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: code ? { success: false, code } : { success: false } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('apiJoinVault', () => {
  it.each([
    ['invitation expirée', 410, 'invite_expired'],
    ['adresse qui ne correspond pas', 403, 'invite_email_mismatch'],
    ['jeton révoqué ou déjà utilisé', 404, 'invite_invalid'],
    ['clé du coffre changée depuis', 409, 'invite_stale_epoch'],
    ['déjà membre', 409, 'already_member'],
    ['mauvais locataire', 404, 'vault_not_found'],
    ['pas membre de l’espace', 403, 'org_forbidden'],
  ])('rend le code du Worker pour %s', async (_label, status, code) => {
    client.post.mockRejectedValueOnce(httpError(status, code));
    await expect(apiJoinVault('v1', 'jeton')).rejects.toThrow(code);
  });

  it('appelle bien la bonne route avec le jeton dans le corps', async () => {
    client.post.mockResolvedValueOnce({ data: { success: true, data: { role: 'editor' } } });
    await expect(apiJoinVault('v1', 'jeton')).resolves.toEqual({ role: 'editor' });
    expect(client.post).toHaveBeenCalledWith('/vaults/v1/join', { token: 'jeton' });
  });

  it('n’invente pas une panne réseau quand le serveur a répondu', async () => {
    client.post.mockRejectedValueOnce(httpError(500));
    await expect(apiJoinVault('v1', 'jeton')).rejects.toThrow('server_error');
  });

  it('dit la panne réseau quand rien n’est revenu', async () => {
    client.post.mockRejectedValueOnce(
      Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' })
    );
    await expect(apiJoinVault('v1', 'jeton')).rejects.toThrow('network_unavailable');
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Le repli était `invite_invalid` — un VERDICT du
   * serveur (« ce jeton n'existe plus »), sur lequel l'écran d'acceptation
   * efface le porteur. Or un repli ne sert que lorsque la classification RENONCE.
   * La branche ESPACE avait déjà reçu un repli d'inconnu délibérément non
   * terminal ; la branche COFFRE avait gardé le verdict.
   */
  it('renonce plutôt que de prononcer un verdict qu’il n’a pas', async () => {
    // Notre propre Error : ni axios, ni statut. Rien n'est connu.
    client.post.mockRejectedValueOnce(new Error('Vault is locked'));
    await expect(apiJoinVault('v1', 'jeton')).rejects.toThrow('request_failed');
  });

  it('aucun repli d’INCONNU de cette route n’est terminal ni mortel', async () => {
    const unknowns: unknown[] = [
      new Error('Vault is locked'),
      Object.assign(new Error('boom'), { isAxiosError: true, response: { status: 400 } }),
      undefined,
    ];
    for (const thrown of unknowns) {
      client.post.mockRejectedValueOnce(thrown);
      const code = await apiJoinVault('v1', 'jeton').then(
        () => null,
        (e: Error) => e.message
      );
      expect(isVaultErrorRetryable(code), String(code)).toBe(true);
      expect(isDeadInviteError(code), String(code)).toBe(false);
    }
  });

  /**
   * Un défi Cloudflare, une règle WAF ou un mauvais routage rendent un 403/404
   * dont le corps est du HTML, pas une enveloppe du Worker. Le lire comme un
   * refus d'autorisation faisait dire « acceptez d'abord l'invitation à
   * l'espace » à un incident d'infrastructure — et ce code-là étant terminal,
   * la panne se présentait comme une décision.
   */
  it('ne prend pas une page de défi pour un refus d’autorisation', async () => {
    client.post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: '<!DOCTYPE html><title>Just a moment…</title>' },
      })
    );
    await expect(apiJoinVault('v1', 'jeton')).rejects.toThrow('server_error');
  });
});

describe('apiGetOrgInvitationPreview', () => {
  it('rend le nom de l’espace et le rôle, pour dire ce qu’on rejoint AVANT d’agir', async () => {
    client.get.mockResolvedValueOnce({
      data: { success: true, data: { orgName: 'Studio', role: 'editor' } },
    });
    await expect(apiGetOrgInvitationPreview('jeton')).resolves.toEqual({
      orgName: 'Studio',
      role: 'editor',
    });
    expect(client.get).toHaveBeenCalledWith('/org/invitations/jeton');
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Le Worker a été élargi pour rendre l'adresse
   * invitée, sous le nom `email` ; le client déclarait `invitedEmail` et rendait
   * `data.data` tel quel. `preview.invitedEmail` était donc TOUJOURS `undefined` :
   * la ligne « Envoyée à … » ne s'affichait jamais et la garde de poste partagé
   * n'avait rien à comparer. Une route PUBLIQUE avait été élargie pour rien.
   */
  it('remappe l’adresse invitée, sans quoi tout l’élargissement serveur est inerte', async () => {
    client.get.mockResolvedValueOnce({
      data: {
        success: true,
        data: { orgName: 'Studio', role: 'editor', email: 'alice@example.com' },
      },
    });
    await expect(apiGetOrgInvitationPreview('jeton')).resolves.toEqual({
      orgName: 'Studio',
      role: 'editor',
      invitedEmail: 'alice@example.com',
    });
  });

  it('reste muet sur l’adresse quand le serveur n’en rend pas', async () => {
    // Un déploiement antérieur du Worker : l'écran retombe sur sa phrase
    // générique plutôt que d'afficher « Envoyée à undefined ».
    client.get.mockResolvedValueOnce({
      data: { success: true, data: { orgName: 'Studio', role: 'viewer' } },
    });
    const preview = await apiGetOrgInvitationPreview('jeton');
    expect(preview?.invitedEmail).toBeUndefined();
  });

  it('échappe le jeton dans le chemin', async () => {
    client.get.mockResolvedValueOnce({ data: { success: true, data: null } });
    await apiGetOrgInvitationPreview('a/b?c');
    expect(client.get).toHaveBeenCalledWith('/org/invitations/a%2Fb%3Fc');
  });

  it('ne jette jamais : un aperçu absent ne doit pas empêcher d’accepter', async () => {
    client.get.mockRejectedValueOnce(httpError(410, 'invitation_expired'));
    await expect(apiGetOrgInvitationPreview('jeton')).resolves.toBeNull();
  });
});

/**
 * L'APERÇU DE COFFRE (F29) — celui qui n'existait pas.
 *
 * LE DÉFAUT QU'IL FERME. L'invitation d'ESPACE avait son aperçu public depuis
 * toujours ; celle de COFFRE n'en avait aucun, parce que son NOM est chiffré de
 * bout en bout et que rien n'avait donc été prévu. Mais ce n'est pas le nom qui
 * manquait à l'écran : c'est l'ADRESSE INVITÉE. Sans elle, quelqu'un qui a
 * plusieurs comptes — un perso, un pro, le cas ordinaire — cliquait
 * « Accepter » et n'apprenait qu'ensuite, par un 403, qu'il s'était trompé de
 * compte.
 */
describe('apiGetVaultInvitationPreview', () => {
  it('rend l’adresse invitée et le rôle, remappés depuis `email`', async () => {
    client.get.mockResolvedValueOnce({
      data: { success: true, data: { email: 'alice@example.com', role: 'editor' } },
    });
    await expect(apiGetVaultInvitationPreview('jeton')).resolves.toEqual({
      invitedEmail: 'alice@example.com',
      role: 'editor',
    });
    expect(client.get).toHaveBeenCalledWith('/vaults/invites/jeton/preview');
  });

  it('échappe le jeton dans le chemin', async () => {
    client.get.mockResolvedValueOnce({ data: { success: true, data: null } });
    await apiGetVaultInvitationPreview('a/b?c');
    expect(client.get).toHaveBeenCalledWith('/vaults/invites/a%2Fb%3Fc/preview');
  });

  /**
   * MÊME TOLÉRANCE QUE L'APERÇU D'ESPACE. Un aperçu est un ORNEMENT : hors
   * ligne, sous plafond de requêtes ou derrière un défi d'infrastructure, il ne
   * rend rien — et l'écran doit continuer de proposer « Accepter », le serveur
   * restant l'autorité. Conclure d'un silence que l'adresse ne correspond pas
   * enfermerait quelqu'un qui a pourtant le bon compte.
   */
  it.each([
    ['invitation inconnue', 404, 'invite_invalid'],
    ['invitation consommée ou révoquée', 409, 'invite_invalid'],
    ['plafond de requêtes', 429, 'rate_limited'],
    ['panne du serveur', 500, undefined],
  ])('ne jette jamais et rend null pour %s', async (_label, status, code) => {
    client.get.mockRejectedValueOnce(httpError(status, code));
    await expect(apiGetVaultInvitationPreview('jeton')).resolves.toBeNull();
  });

  /**
   * LA SEULE EXCEPTION, ET C'EST UN FAIT AFFIRMÉ. Le 410 dit que l'invitation a
   * EXPIRÉ — pas que le serveur n'a pas pu répondre. Le distinguer permet à
   * l'écran de le dire AVANT le geste (« demandez-en une nouvelle ») plutôt que
   * de faire vivre l'acceptation entière pour aboutir au même refus.
   */
  it('distingue le 410 : l’invitation a expiré, et le serveur l’affirme', async () => {
    client.get.mockRejectedValueOnce(httpError(410, 'invite_expired'));
    await expect(apiGetVaultInvitationPreview('jeton')).resolves.toEqual({
      invitedEmail: null,
      role: null,
      expired: true,
    });
  });

  it('reste muet plutôt que de rendre « undefined » quand le corps est incomplet', async () => {
    client.get.mockResolvedValueOnce({ data: { success: true, data: {} } });
    await expect(apiGetVaultInvitationPreview('jeton')).resolves.toEqual({
      invitedEmail: null,
      role: null,
    });
  });
});
