/**
 * « Mes partages » sur le web — la forme de la liste.
 *
 * LA PANNE. Sur app.filarr.com, ouvrir les réglages faisait tomber toute la
 * page sur `i.filter is not a function`. Le Worker répond
 * `data: { shares: [...] }` ; le jumeau Electron DÉBALLE ce `.shares` avant de
 * rendre la main, le pont web relayait l'enveloppe entière. Le renderer, lui,
 * ne sait pas sur quelle plateforme il tourne : il recevait un OBJET là où son
 * `items.filter(...)` attend un tableau, et l'écran de réglages entier
 * disparaissait derrière l'écran d'erreur.
 *
 * L'autorité de la forme n'est ni le pont ni le renderer : c'est le Worker.
 * Ce test lit donc `infra/cloudflare-worker/src/share.ts` pour vérifier que les
 * enveloppes bouchonnées ici (`shares`, `views`, `revoked`) sont bien celles
 * qu'il émet — sans quoi on garderait un accord entre deux dérivés pendant que
 * la source a bougé.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { webInvoke } from '../dispatcher';

const WORKER_SHARE_SRC = readFileSync(
  join(__dirname, '../../../../infra/cloudflare-worker/src/share.ts'),
  'utf-8'
);

/** Réponses du Worker, par chemin — mêmes clés que share.ts. */
let replies: Record<string, { status: number; body: unknown }>;

beforeEach(() => {
  replies = {
    '/sync/share': {
      status: 200,
      body: {
        success: true,
        data: {
          shares: [
            { shareId: 's1', active: true, expiresAt: 20, createdAt: 1 },
            { shareId: 's2', active: false, expiresAt: 10, createdAt: 2 },
          ],
        },
      },
    },
    '/sync/share/s1/views': {
      status: 200,
      body: {
        success: true,
        data: { views: [{ viewedAt: 1, country: 'FR', ipSubnet: '81.44.0.0/16' }] },
      },
    },
    '/sync/share/s1': { status: 200, body: { success: true, data: { revoked: true } } },
  };

  (globalThis as { fetch: unknown }).fetch = async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const reply = replies[path] ?? { status: 404, body: { success: false } };
    return {
      status: reply.status,
      ok: reply.status < 400,
      json: async () => reply.body,
    } as unknown as Response;
  };

  (globalThis as unknown as { window: unknown }).window = {
    location: { origin: 'https://app.filarr.com' },
  };
});

describe('le Worker reste l’autorité de la forme', () => {
  it('emballe toujours la liste dans `shares` et le journal dans `views`', () => {
    // `[^{}]*` et non `\s*` : l'enveloppe peut porter d'AUTRES champs avant la
    // liste (`supportsWrappedLabel`, depuis les libellés scellés). Ce qu'on
    // garde, c'est que la liste s'appelle toujours `shares` et vit sous `data`
    // — pas qu'elle y soit seule, ce qui ferait échouer ce test au premier
    // champ ajouté à l'enveloppe.
    expect(WORKER_SHARE_SRC).toMatch(/data:\s*\{[^{}]*\bshares:/);
    expect(WORKER_SHARE_SRC).toMatch(/data:\s*\{[^{}]*\bviews:/);
    expect(WORKER_SHARE_SRC).toMatch(/data:\s*\{[^{}]*\brevoked:/);
  });
});

describe('share:list sur le web', () => {
  it('rend un TABLEAU, pas l’enveloppe `{ shares }` du Worker', async () => {
    const res = (await webInvoke('share:list')) as { success: boolean; data: unknown };

    expect(res.success).toBe(true);
    expect(Array.isArray(res.data)).toBe(true);
    // Le geste exact qui plantait en production.
    expect(() => (res.data as { active: boolean }[]).filter((s) => s.active)).not.toThrow();
    expect((res.data as { shareId: string }[]).map((s) => s.shareId)).toEqual(['s1', 's2']);
  });

  it('rend une liste vide quand le Worker n’a pas de partages à donner', async () => {
    replies['/sync/share'] = { status: 200, body: { success: true, data: {} } };
    const res = (await webInvoke('share:list')) as { data: unknown };
    expect(res.data).toEqual([]);
  });

  it('remonte l’échec au lieu de rendre un faux tableau vide', async () => {
    replies['/sync/share'] = { status: 500, body: { success: false, error: 'boom' } };
    const res = (await webInvoke('share:list')) as { success: boolean; error: string };
    expect(res.success).toBe(false);
    expect(res.error).toContain('500');
  });
});

describe('share:listViews sur le web', () => {
  it('rend un TABLEAU d’événements, pas `{ views }`', async () => {
    const res = (await webInvoke('share:listViews', 's1')) as { data: unknown };
    expect(Array.isArray(res.data)).toBe(true);
    expect((res.data as { country: string }[])[0].country).toBe('FR');
  });
});

describe('share:revoke sur le web', () => {
  it('remonte `revoked` au premier niveau, comme le jumeau Electron', async () => {
    const res = (await webInvoke('share:revoke', 's1')) as { success: boolean; revoked: boolean };
    expect(res).toMatchObject({ success: true, revoked: true });
  });

  it('dit `revoked: false` quand le partage était déjà mort', async () => {
    replies['/sync/share/s1'] = { status: 200, body: { success: true, data: { revoked: false } } };
    const res = (await webInvoke('share:revoke', 's1')) as { revoked: boolean };
    expect(res.revoked).toBe(false);
  });
});
