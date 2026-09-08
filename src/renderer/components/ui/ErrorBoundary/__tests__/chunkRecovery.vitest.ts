/**
 * Le rechargement d'un onglet reste ouvert pendant un deploiement — et le
 * garde-fou qui empeche ce rechargement de devenir une boucle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isChunkLoadError,
  installChunkRecovery,
  recoverFromChunkError,
  RECOVERY_WINDOW_MS,
} from '../chunkRecovery';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    map,
  };
}

describe('isChunkLoadError', () => {
  it('reconnait le ChunkLoadError de webpack, celui vu en production', () => {
    const err = Object.assign(new Error('Loading chunk 5378 failed.'), {
      name: 'ChunkLoadError',
    });
    expect(isChunkLoadError(err)).toBe(true);
  });

  it.each([
    'Loading chunk 5378 failed.',
    'Loading CSS chunk 12 failed.',
    'Failed to fetch dynamically imported module: https://app.filarr.com/x.js',
    'Importing a module script failed.',
  ])('reconnait « %s » meme sans le nom webpack', (message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it.each([new Error('Cannot read properties of undefined'), null, undefined, 'boom'])(
    'ne prend pas une erreur ordinaire pour un deploiement (%s)',
    (value) => {
      expect(isChunkLoadError(value)).toBe(false);
    }
  );
});

describe('recoverFromChunkError', () => {
  const chunkError = Object.assign(new Error('Loading chunk 5378 failed.'), {
    name: 'ChunkLoadError',
  });

  it('recharge et le dit, pour que l’appelant n’affiche pas une erreur qui se repare', () => {
    const reload = vi.fn();
    const storage = memoryStorage();

    expect(recoverFromChunkError(chunkError, { storage, reload, now: () => 1000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ne recharge PAS sur une erreur ordinaire', () => {
    const reload = vi.fn();
    expect(recoverFromChunkError(new Error('boom'), { storage: memoryStorage(), reload })).toBe(
      false
    );
    expect(reload).not.toHaveBeenCalled();
  });

  it('ne boucle pas : la deuxieme tentative dans la fenetre est refusee', () => {
    const reload = vi.fn();
    const storage = memoryStorage();

    recoverFromChunkError(chunkError, { storage, reload, now: () => 1000 });
    const second = recoverFromChunkError(chunkError, {
      storage,
      reload,
      now: () => 1000 + RECOVERY_WINDOW_MS - 1,
    });

    expect(second).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('retente une fois la fenetre passee — un deploiement plus tard reste un deploiement', () => {
    const reload = vi.fn();
    const storage = memoryStorage();

    recoverFromChunkError(chunkError, { storage, reload, now: () => 1000 });
    const later = recoverFromChunkError(chunkError, {
      storage,
      reload,
      now: () => 1000 + RECOVERY_WINDOW_MS + 1,
    });

    expect(later).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('un stockage qui jette ne bloque pas la reprise (navigation privee)', () => {
    const reload = vi.fn();
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };

    expect(recoverFromChunkError(chunkError, { storage: hostile, reload })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('une empreinte illisible est traitee comme absente, pas comme « deja tente »', () => {
    const reload = vi.fn();
    const storage = memoryStorage({ 'filarr:chunk-recovery-at': 'n’importe quoi' });

    expect(recoverFromChunkError(chunkError, { storage, reload, now: () => 5000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installChunkRecovery — le meme defaut hors du rendu', () => {
  // L'environnement vitest est `node` : pas de sessionStorage. On en pose un,
  // parce que c'est LUI qui porte l'empreinte partagee entre les deux chemins.
  beforeEach(() => {
    (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = memoryStorage();
  });

  function fakeWindow() {
    const listeners: Record<string, EventListener[]> = {};
    const reload = vi.fn();
    return {
      target: {
        addEventListener: (type: string, fn: EventListener) => {
          (listeners[type] ??= []).push(fn);
        },
        removeEventListener: (type: string, fn: EventListener) => {
          listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
        },
        location: { reload },
        listeners,
      },
      reload,
      emit: (reason: unknown) => {
        const event = { reason, preventDefault: vi.fn() };
        (listeners['unhandledrejection'] ?? []).forEach((fn) =>
          (fn as unknown as (e: unknown) => void)(event)
        );
        return event;
      },
    };
  }

  it('recharge sur un rejet non gere qui vient d’un import() dynamique', () => {
    const w = fakeWindow();
    installChunkRecovery(w.target as unknown as Window);

    const event = w.emit(
      Object.assign(new Error('Loading chunk 5378 failed.'), { name: 'ChunkLoadError' })
    );

    expect(w.reload).toHaveBeenCalledTimes(1);
    // Traite : le rejet ne doit pas partir en console comme une panne.
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('laisse passer un rejet ordinaire — il appartient a son appelant', () => {
    const w = fakeWindow();
    installChunkRecovery(w.target as unknown as Window);

    const event = w.emit(new Error('mot de passe invalide'));

    expect(w.reload).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('se retire quand on le lui demande', () => {
    const w = fakeWindow();
    installChunkRecovery(w.target as unknown as Window)();

    w.emit(Object.assign(new Error('Loading chunk 1 failed.'), { name: 'ChunkLoadError' }));

    expect(w.reload).not.toHaveBeenCalled();
  });

  it('partage l’empreinte avec le chemin du rendu : une seule reprise', () => {
    const w = fakeWindow();
    installChunkRecovery(w.target as unknown as Window);
    const chunkError = Object.assign(new Error('Loading chunk 5378 failed.'), {
      name: 'ChunkLoadError',
    });

    w.emit(chunkError);
    const second = w.emit(chunkError);

    expect(w.reload).toHaveBeenCalledTimes(1);
    expect(second.preventDefault).not.toHaveBeenCalled();
  });
});
