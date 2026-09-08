/**
 * Mots de passe de fichiers SUR LE WEB : un seul format, bcrypt, des deux côtés.
 *
 * LE DÉFAUT QUE CECI ÉPINGLE. `hashPassword`/`comparePassword` choisissaient la
 * branche bcrypt-par-IPC dès que `window.electron.ipcRenderer` existait. Sur
 * app.filarr.com il existe (c'est le dispatcher web) mais il LÈVE sur
 * `crypto:hashPassword` / `crypto:verifyPassword` (pas de handler) : le repli
 * écrit pour le navigateur était du code mort, et aucun mot de passe ne pouvait
 * être posé ni vérifié sur un fichier depuis le web.
 *
 * ET LE FORMAT. Le repli produisait du `$pbkdf2$`, que le bureau (bcrypt seul)
 * ne sait pas relire. bcryptjs est pur JavaScript et déjà une dépendance : le
 * web hache désormais en bcrypt, même coût que le processus principal, et relit
 * les empreintes posées sur le bureau — le `$pbkdf2$` d'hier reste accepté.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChannelNotImplementedError, ChannelUnavailableError } from '../../../platform/web/errors';

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}

/**
 * L'émulation web : le magasin sécurisé est servi (comme sur app.filarr.com),
 * la famille `crypto:*` ne l'est pas, tout le reste est desktop-only.
 * `seed` = des empreintes déjà présentes (posées ailleurs, ou d'un autre âge).
 */
function installWebShim(seed: Record<string, unknown> = {}): void {
  let store: unknown = seed;
  const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
    if (channel === 'secureStore:getPasswordHashes') return store;
    if (channel === 'secureStore:setPasswordHashes') {
      store = args[0];
      return true;
    }
    if (channel.startsWith('crypto:')) throw new ChannelNotImplementedError(channel, 'M1');
    throw new ChannelUnavailableError(channel, 'desktop-only');
  };
  defineGlobal('window', { electron: { ipcRenderer: { invoke } }, __FILARR_WEB__: true });
  defineGlobal('localStorage', memoryStorage());
  defineGlobal('sessionStorage', memoryStorage());
}

/** Une empreinte `$pbkdf2$` telle que l'ancien repli la fabriquait. */
async function legacyPbkdf2(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const hex = (b: Uint8Array) =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  return `$pbkdf2$${hex(salt)}$${hex(new Uint8Array(bits))}`;
}

const protection = (itemId: string, passwordHash: string) => ({
  itemId,
  itemType: 'file',
  passwordHash,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

async function warmService(seed: Record<string, unknown> = {}) {
  installWebShim(seed);
  const svc = await import('../filePasswordService');
  // Comme dans l'application, le cache des empreintes est amorcé bien avant
  // qu'un mot de passe ne soit posé (les listes appellent `isProtected`).
  svc.isProtected('warm-up');
  await new Promise((r) => setTimeout(r, 0));
  return svc;
}

describe('filePasswordService sur le web', () => {
  beforeEach(() => {
    // Un module neuf par test : le cache des empreintes est un état de module.
    return import('vitest').then(({ vi }) => vi.resetModules());
  });
  afterEach(() => {
    for (const g of ['window', 'localStorage', 'sessionStorage']) {
      delete (globalThis as Record<string, unknown>)[g];
    }
  });

  it('pose une empreinte bcrypt (le format du bureau) et la vérifie', async () => {
    const svc = await warmService();
    const p = await svc.setPassword('file-1', 'file', 'corr3ct horse');
    expect(p.passwordHash.startsWith('$2')).toBe(true);
    await expect(svc.verifyPassword('file-1', 'corr3ct horse')).resolves.toBe(true);
    await expect(svc.verifyPassword('file-1', 'wrong')).resolves.toBe(false);
  }, 60_000);

  it('relit une empreinte bcrypt posée sur le BUREAU (coût 12, comme main)', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const desktopHash = await bcrypt.hash('from-desktop', 12);
    const svc = await warmService({ 'file-2': protection('file-2', desktopHash) });
    await expect(svc.verifyPassword('file-2', 'from-desktop')).resolves.toBe(true);
    await expect(svc.verifyPassword('file-2', 'nope')).resolves.toBe(false);
  }, 60_000);

  it('accepte encore le $pbkdf2$ de l’ancien repli', async () => {
    const legacy = await legacyPbkdf2('old-web-password');
    const svc = await warmService({ 'file-3': protection('file-3', legacy) });
    await expect(svc.verifyPassword('file-3', 'old-web-password')).resolves.toBe(true);
    await expect(svc.verifyPassword('file-3', 'nope')).resolves.toBe(false);
  });
});
