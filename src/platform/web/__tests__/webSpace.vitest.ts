/**
 * L'espace (personnel / entreprise) sur le WEB — par profil, jamais par navigateur.
 *
 * LE DÉFAUT QUE CECI ÉPINGLE (2026-09-03) : une seule clé globale. Se connecter
 * avec un compte d'organisation la mettait à « entreprise » ; revenir sur le
 * profil personnel ne la touchait pas, et la puce « Organisation » restait
 * allumée sur un compte qui ne peut pas appartenir à une organisation.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  idb: new Map<string, unknown>(),
  active: null as string | null,
  ls: new Map<string, string>(),
}));

vi.mock('../idb', () => ({
  idbGet: async (k: string) => h.idb.get(k) ?? null,
  idbPut: async (k: string, v: unknown) => {
    h.idb.set(k, v);
  },
}));
vi.mock('../webStore', () => ({ getActiveProfileId: async () => h.active }));
vi.mock('../webApiBase', () => ({ apiFetch: vi.fn() }));

// Environnement node : pas de localStorage. Un doublon fidèle suffit.
beforeEach(() => {
  h.idb.clear();
  h.ls.clear();
  h.active = null;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => h.ls.get(k) ?? null,
      setItem: (k: string, v: string) => {
        h.ls.set(k, String(v));
      },
      removeItem: (k: string) => {
        h.ls.delete(k);
      },
    },
  });
});

function seed(active: string, profiles: Array<{ id: string; accountType?: string }>): void {
  h.active = active;
  h.idb.set('profiles_manifest', {
    activeProfileId: active,
    profiles: profiles.map((p) => ({
      id: p.id,
      cloudAccount: p.accountType
        ? { email: `${p.id}@x.test`, tier: 'free', accountType: p.accountType }
        : null,
    })),
  });
}

async function handlers() {
  const { spaceKeypairHandlers } = await import('../handlers/spaceKeypairHandlers');
  return spaceKeypairHandlers;
}
const get = async (hs: Record<string, (...a: unknown[]) => unknown>) =>
  ((await hs['space:get']()) as { data: { space: string } }).data.space;

describe('l’espace web est celui du PROFIL actif', () => {
  it('se connecter en organisation, puis revenir sur le profil perso : la puce s’éteint', async () => {
    const hs = await handlers();
    seed('org-1', [
      { id: 'org-1', accountType: 'enterprise' },
      { id: 'perso', accountType: 'personal' },
    ]);
    await hs['space:set']('enterprise', 'o1');
    expect(await get(hs)).toBe('enterprise');
    // Le sélecteur change de profil : c’est un AUTRE dossier, pas le même navigateur.
    h.active = 'perso';
    expect(await get(hs)).toBe('personal');
    // Et l’organisation retrouve SON espace quand on y revient.
    h.active = 'org-1';
    expect(await get(hs)).toBe('enterprise');
  });

  it('un compte PERSONNEL est toujours dans l’espace personnel, quoi qu’on ait mémorisé', async () => {
    const hs = await handlers();
    seed('perso', [{ id: 'perso', accountType: 'personal' }]);
    await hs['space:set']('enterprise');
    expect(await get(hs)).toBe('personal');
  });

  it('sans estampille, la préférence mémorisée POUR CE PROFIL vaut ; l’ancienne clé globale n’est jamais héritée', async () => {
    const hs = await handlers();
    seed('local', [{ id: 'local' }]);
    h.ls.set('filarr-web-space', 'enterprise'); // la clé d’avant, celle qui mentait
    expect(await get(hs)).toBe('personal');
    await hs['space:set']('enterprise');
    expect(await get(hs)).toBe('enterprise');
    expect(h.ls.get('filarr-web-space:local')).toBe('enterprise');
  });

  it('un compte d’organisation sans préférence part dans SON espace', async () => {
    const hs = await handlers();
    seed('org-2', [{ id: 'org-2', accountType: 'enterprise' }]);
    expect(await get(hs)).toBe('enterprise');
  });

  it('aucun profil actif : personnel, et rien n’est écrit', async () => {
    const hs = await handlers();
    expect(await get(hs)).toBe('personal');
    await hs['space:set']('enterprise');
    expect(h.ls.size).toBe(0);
  });
});
