/**
 * Acheter un plan depuis le navigateur.
 *
 * LE TROU. `billing:checkout` et `billing:portal` étaient classés « livrés, palier
 * M1 » et servis par personne : `webInvoke` jetait un ChannelNotImplementedError
 * que l'appelant avalait dans un `console.error`. Le bouton clignotait, rien ne se
 * passait, aucun message. Et comme le serveur exige un palier payant pour créer un
 * coffre partagé, un utilisateur qui n'a que le web ne pouvait rien acheter, donc
 * jamais créer de coffre ni inviter : il ne pouvait qu'être invité chez un autre.
 *
 * Deux propriétés comptent autant que l'appel lui-même : l'onglet s'ouvre pendant
 * le clic (sinon le navigateur le bloque comme une fenêtre surgissante), et un
 * échec REMONTE — c'est tout l'objet du correctif.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webInvoke } from '../dispatcher';
import { ChannelNotImplementedError } from '../errors';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];
let reply: { status: number; body: unknown };
let opened: Array<{
  target: string;
  location: { replace: (u: string) => void };
  closed: boolean;
  opener: unknown;
}>;
let popupBlocked = false;

beforeEach(() => {
  calls = [];
  reply = {
    status: 200,
    body: { success: true, data: { checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_1' } },
  };
  opened = [];
  popupBlocked = false;

  (globalThis as { fetch: unknown }).fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return {
      status: reply.status,
      ok: reply.status < 400,
      json: async () => reply.body,
    } as unknown as Response;
  });

  (globalThis as unknown as { window: unknown }).window = {
    // Ce faux `open` REPRODUIT la regle de la spec HTML : avec `noopener` dans
    // les features, un vrai navigateur rend `null`. Sans elle, le test validait
    // un appel qui, en production, ouvrait un onglet `about:blank` dont on ne
    // gardait aucune poignee — jamais navigue, jamais referme. Un stub trop
    // gentil ne garde rien.
    open: vi.fn((_url: string, _target?: string, features?: string) => {
      if (popupBlocked) return null;
      if (typeof features === 'string' && features.includes('noopener')) return null;
      const tab = {
        target: '',
        closed: false,
        opener: {} as unknown,
        location: {
          replace: (u: string) => {
            tab.target = u;
          },
        },
        close: () => {
          tab.closed = true;
        },
      };
      opened.push(tab as never);
      return tab;
    }),
    location: { origin: 'https://app.filarr.com' },
  };
});

describe('billing:checkout — le canal qui manquait', () => {
  it('n’est plus « classé mais pas servi »', async () => {
    const res = await webInvoke('billing:checkout', 'solo');
    expect(res).toBeDefined();
    expect(res).not.toBeInstanceOf(ChannelNotImplementedError);
  });

  it('poste le plan et des URL de retour que le Worker accepte', async () => {
    await webInvoke('billing:checkout', 'pro');

    const call = calls.find((c) => c.url.endsWith('/billing/checkout'));
    expect(call?.method).toBe('POST');
    expect(call?.body).toMatchObject({ plan: 'pro' });
    // Le Worker n'accepte que des URL filarr.com en https (isAllowedRedirectUrl) :
    // une origine de développement partirait en 400.
    const body = call?.body as { successUrl: string; cancelUrl: string };
    expect(new URL(body.successUrl).host).toBe('filarr.com');
    expect(new URL(body.cancelUrl).host).toBe('filarr.com');
  });

  it('n’accepte que solo ou pro — le Worker refuse le reste en 400', async () => {
    await webInvoke('billing:checkout', 'teams');
    expect((calls[0]?.body as { plan: string }).plan).toBe('solo');
  });

  it('ouvre l’onglet AVANT l’appel réseau, puis y écrit l’URL de Stripe', async () => {
    // Un window.open qui suit une promesse n'est plus rattaché au geste de
    // l'utilisateur : le navigateur le bloque. L'onglet est donc ouvert vide.
    const openSpy = (globalThis as unknown as { window: { open: ReturnType<typeof vi.fn> } }).window
      .open;
    const res = (await webInvoke('billing:checkout', 'solo')) as {
      success: boolean;
      data: { opened: boolean };
    };

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(opened[0].target).toBe('https://checkout.stripe.com/c/pay/cs_test_1');
    expect(res).toMatchObject({ success: true, data: { opened: true } });
  });

  it('n’ouvre PAS avec noopener — la spec rendrait null, et l’onglet resterait blanc', async () => {
    // Le defaut reel : `window.open('', '_blank', 'noopener,noreferrer')` rend
    // `null`, donc `tab.location.replace(urlStripe)` n’avait jamais lieu et
    // l’utilisateur restait sur about:blank pendant que nous concluions
    // « fenetre bloquee ». La protection est reprise en annulant `opener`.
    const openSpy = (globalThis as unknown as { window: { open: ReturnType<typeof vi.fn> } }).window
      .open;
    await webInvoke('billing:checkout', 'solo');

    const features = openSpy.mock.calls[0][2];
    expect(features === undefined || !String(features).includes('noopener')).toBe(true);
    expect(opened[0].opener).toBeNull();
  });

  it('rend l’URL quand le bloqueur a refusé l’onglet, au lieu d’échouer en silence', async () => {
    popupBlocked = true;
    const res = (await webInvoke('billing:checkout', 'solo')) as {
      success: boolean;
      data: { opened: boolean; url: string };
    };
    // La session Stripe existe : il ne manque qu'un clic, et l'appelant peut
    // l'offrir. C'est exactement le silence que ce fichier ferme.
    expect(res.success).toBe(true);
    expect(res.data.opened).toBe(false);
    expect(res.data.url).toContain('checkout.stripe.com');
  });
});

describe('un refus remonte, avec son code', () => {
  it('rend l’erreur du Worker telle quelle', async () => {
    reply = { status: 400, body: { success: false, error: 'Invalid plan', code: 'bad_request' } };
    const res = (await webInvoke('billing:checkout', 'solo')) as { success: boolean; code: string };
    expect(res).toMatchObject({ success: false, code: 'bad_request' });
  });

  it('déduit session_expired d’un 401 sans corps exploitable', async () => {
    reply = { status: 401, body: null };
    const res = (await webInvoke('billing:checkout', 'solo')) as { success: boolean; code: string };
    expect(res).toMatchObject({ success: false, code: 'session_expired' });
  });

  it('refuse une URL qui n’est pas https, même venue de notre propre serveur', async () => {
    // Défense en profondeur : un serveur compromis ne doit pas pouvoir pousser
    // javascript: ou data: dans un onglet que nous ouvrons.
    reply = { status: 200, body: { success: true, data: { checkoutUrl: 'javascript:alert(1)' } } };
    const res = (await webInvoke('billing:checkout', 'solo')) as { success: boolean };
    expect(res.success).toBe(false);
  });

  it('referme l’onglet vide quand l’appel a échoué', async () => {
    reply = { status: 500, body: null };
    await webInvoke('billing:checkout', 'solo');
    expect(opened[0].closed).toBe(true);
  });
});

describe('billing:portal — même parcours, même garanties', () => {
  it('poste sur /billing/portal et ouvre l’URL du portail', async () => {
    reply = {
      status: 200,
      body: { success: true, data: { portalUrl: 'https://billing.stripe.com/p/session_1' } },
    };
    const res = (await webInvoke('billing:portal')) as { success: boolean };

    expect(calls[0].url).toContain('/billing/portal');
    expect(calls[0].method).toBe('POST');
    expect(opened[0].target).toBe('https://billing.stripe.com/p/session_1');
    expect(res.success).toBe(true);
  });
});
