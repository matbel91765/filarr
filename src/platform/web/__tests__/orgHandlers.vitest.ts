/**
 * Les canaux org:* du parcours personnel, servis sur le web.
 *
 * LE TROU EN AMONT. `org:list` était classé mais pas servi : `webInvoke` jetait
 * un ChannelNotImplementedError, `fetchOrgs` rejetait, et `state.org.orgs`
 * restait vide EN PERMANENCE sur app.filarr.com. Or `selectSharedVaultOrgIds`
 * (les locataires que loadVaults interroge) et `selectIsSharedVaultGuest`
 * (l'entrée « Coffres partagés » d'un invité gratuit) en dérivent tous les deux.
 * Un coffre partagé par quelqu'un d'autre restait donc invisible, même après une
 * jointure réussie : livrer l'acceptation sans cela, c'est réussir dans le vide.
 *
 * Le `code` du Worker doit traverser le handler intact — c'est de lui que dépend
 * la véracité du message affiché à qui accepte.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webInvoke } from '../dispatcher';
import { ChannelNotImplementedError } from '../errors';

interface Call {
  url: string;
  method: string;
}

let calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { success: true } };

beforeEach(() => {
  calls = [];
  reply = { status: 200, body: { success: true } };
  (globalThis as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    return {
      status: reply.status,
      ok: reply.status < 400,
      json: async () => reply.body,
    } as unknown as Response;
  });
});

describe('org:list — le canal sans lequel un invité ne voit rien', () => {
  it('n’est plus « classé mais pas servi »', async () => {
    await expect(webInvoke('org:list')).resolves.toBeDefined();
    // La régression exacte à empêcher : le canal qui jette.
    await expect(webInvoke('org:list')).resolves.not.toBeInstanceOf(ChannelNotImplementedError);
  });

  it('rend les espaces dans la forme que fetchOrgs attend', async () => {
    reply = {
      status: 200,
      body: { success: true, data: { orgs: [{ id: 'host', isPersonal: true, role: 'viewer' }] } },
    };
    const res = (await webInvoke('org:list')) as { success: boolean; data?: { orgs: unknown[] } };

    expect(res.success).toBe(true);
    expect(res.data?.orgs).toHaveLength(1);
    expect(calls[0]).toEqual({ url: 'https://api.filarr.com/org', method: 'GET' });
  });

  it('rend un échec lisible quand le serveur ne répond pas en JSON', async () => {
    reply = { status: 502, body: null };
    await expect(webInvoke('org:list')).resolves.toEqual({
      success: false,
      error: 'HTTP 502',
      code: 'server_error',
    });
  });
});

describe('org:acceptInvitation', () => {
  it('poste sur la route d’acceptation, jeton échappé', async () => {
    reply = { status: 200, body: { success: true, data: { orgId: 'host', role: 'viewer' } } };
    const res = (await webInvoke('org:acceptInvitation', 'a/b')) as { success: boolean };

    expect(res.success).toBe(true);
    expect(calls[0]).toEqual({
      url: 'https://api.filarr.com/org/invitations/a%2Fb/accept',
      method: 'POST',
    });
  });

  it.each([
    'invitation_email_mismatch',
    'personal_account',
    'already_member',
    'personal_seat_limit_reached',
    'invitation_expired',
    'invitation_not_found',
    'invitation_already_used',
  ])('laisse passer le code %s du Worker', async (code) => {
    reply = { status: 403, body: { success: false, error: 'refusé', code } };
    const res = (await webInvoke('org:acceptInvitation', 'jeton')) as { code?: string };

    // Sans ce code, l'écran d'acceptation ne peut que mentir.
    expect(res.code).toBe(code);
  });

  /**
   * LE DÉFAUT QUE CECI FERME. Un échec de TRANSPORT ne porte aucun `code` : page
   * de défi Cloudflare, 502 de passerelle, 401 sans corps. L'enveloppe le
   * remontait muet, l'écran d'acceptation n'avait plus que son repli — et ce
   * repli était `invite_invalid`, un verdict TERMINAL traduit « invitation
   * retirée ou déjà utilisée ». Une panne de dix secondes annonçait donc une
   * invitation morte, et le refus étant définitif, l'écran CONSOMMAIT le jeton.
   */
  it.each([
    ['une session tombée sans corps JSON', 401, null, 'session_expired'],
    ['une session tombée avec un corps muet', 401, { success: false }, 'session_expired'],
    ['une passerelle en panne', 502, null, 'server_error'],
    ['un Worker en erreur', 500, { success: false, error: 'boom' }, 'server_error'],
    ['une page HTML de défi sur un 403', 403, null, 'server_error'],
  ])('dérive un code du statut pour %s', async (_label, status, body, expected) => {
    reply = { status, body };
    const res = (await webInvoke('org:acceptInvitation', 'jeton')) as {
      success?: boolean;
      code?: string;
    };

    expect(res.success).toBe(false);
    expect(res.code).toBe(expected);
    // Le point de tout ceci : jamais un verdict terminal tiré d'une absence.
    expect(res.code).not.toBe('invite_invalid');
  });

  it('laisse INDÉTERMINÉ ce qu’il ne sait pas, plutôt que d’inventer un verdict', async () => {
    // Un 4xx sans code n'est ni la session ni le serveur : `request_failed`
    // n'est dans aucune table de traduction, donc l'écran garde sa phrase
    // générique et son bouton « Réessayer » — la seule chose vraie ici.
    reply = { status: 409, body: { success: false, error: 'conflit' } };
    const res = (await webInvoke('org:acceptInvitation', 'jeton')) as { code?: string };
    expect(res.code).toBe('request_failed');
  });

  it('ne touche JAMAIS au code que le Worker a écrit lui-même', async () => {
    reply = { status: 500, body: { success: false, code: 'invitation_expired' } };
    const res = (await webInvoke('org:acceptInvitation', 'jeton')) as { code?: string };
    expect(res.code).toBe('invitation_expired');
  });
});

describe('org:getCurrent / org:setCurrent', () => {
  it('rend un contexte personnel plutôt que de jeter, sans stockage', async () => {
    // En espace personnel initOrgContext force l'org à null : un miroir local
    // suffit, et un canal absent ne doit jamais empêcher fetchOrgs de partir.
    await expect(webInvoke('org:getCurrent')).resolves.toEqual({
      success: true,
      data: { orgId: null },
    });
    await expect(webInvoke('org:setCurrent', null)).resolves.toEqual({ success: true });
    expect(calls).toEqual([]);
  });
});
