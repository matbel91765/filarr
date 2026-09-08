/**
 * La file des retours — et le dépilement qui n'existait pas.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const post = vi.fn();

vi.mock('../../network/apiClient', () => ({
  default: {
    post: (...args: unknown[]) => post(...args),
  },
}));

/** Un `localStorage` en mémoire — l'environnement de test est `node`. */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  return map;
}

let store: Map<string, string>;

const {
  sendFeedback,
  drainPendingFeedback,
  pendingFeedbackCount,
  PENDING_FEEDBACK_KEY,
  PENDING_MAX,
} = await import('../feedbackQueue');

const retour = (id: string) => ({ id, type: 'bug', text: `texte ${id}` });

const pending = (): unknown[] => JSON.parse(store.get(PENDING_FEEDBACK_KEY) ?? '[]');

const ok = () => ({ data: { success: true } });

beforeEach(() => {
  store = installStorage();
  post.mockReset();
});

describe('sendFeedback', () => {
  it('poste et rend « sent » quand le serveur répond', async () => {
    post.mockResolvedValue(ok());
    expect(await sendFeedback(retour('a'))).toBe('sent');
    expect(post).toHaveBeenCalledWith('/feedback', retour('a'));
    expect(pending()).toEqual([]);
  });

  it('met de côté et rend « queued » quand le réseau est muet', async () => {
    post.mockRejectedValue(new Error('offline'));
    expect(await sendFeedback(retour('a'))).toBe('queued');
    expect(pending()).toEqual([retour('a')]);
  });

  it('met de côté aussi quand le serveur REFUSE (success: false)', async () => {
    post.mockResolvedValue({ data: { success: false, error: 'non' } });
    expect(await sendFeedback(retour('a'))).toBe('queued');
    expect(pending()).toEqual([retour('a')]);
  });

  /**
   * LA RÉGRESSION. Les retours s'empilaient dans `localStorage` et RIEN ne
   * dépilait jamais : ils n'arrivaient nulle part, pendant que l'écran
   * remerciait pour un envoi qui n'avait pas eu lieu.
   */
  it('REJOUE la file au premier envoi réussi', async () => {
    post.mockRejectedValue(new Error('offline'));
    await sendFeedback(retour('a'));
    await sendFeedback(retour('b'));
    expect(pendingFeedbackCount()).toBe(2);

    post.mockReset();
    post.mockResolvedValue(ok());
    expect(await sendFeedback(retour('c'))).toBe('sent');
    // Le rejeu est lancé sans être attendu : on lui laisse un tour de boucle.
    await new Promise((r) => setTimeout(r, 0));

    expect(post.mock.calls.map((c) => (c[1] as { id: string }).id)).toEqual(['c', 'a', 'b']);
    expect(pending()).toEqual([]);
  });

  it('plafonne la file et garde les plus RÉCENTS', async () => {
    post.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < PENDING_MAX + 3; i += 1) await sendFeedback(retour(`r${i}`));
    const left = pending() as Array<{ id: string }>;
    expect(left).toHaveLength(PENDING_MAX);
    expect(left[left.length - 1].id).toBe(`r${PENDING_MAX + 2}`);
    expect(left[0].id).toBe('r3');
  });
});

describe('drainPendingFeedback', () => {
  it('ne fait rien, et ne coûte rien, quand la file est vide', async () => {
    expect(await drainPendingFeedback()).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('vide la file quand tout passe', async () => {
    store.set(PENDING_FEEDBACK_KEY, JSON.stringify([retour('a'), retour('b')]));
    post.mockResolvedValue(ok());
    expect(await drainPendingFeedback()).toBe(2);
    expect(pending()).toEqual([]);
  });

  /**
   * Vingt requêtes vouées à l'échec coûtent vingt délais d'attente. On s'arrête
   * au premier refus, et le RESTE de la file survit dans l'ordre.
   */
  it('s arrête au premier échec et garde la suite, dans l ordre', async () => {
    store.set(PENDING_FEEDBACK_KEY, JSON.stringify([retour('a'), retour('b'), retour('c')]));
    post.mockResolvedValueOnce(ok()).mockRejectedValue(new Error('offline'));

    expect(await drainPendingFeedback()).toBe(1);
    expect(post).toHaveBeenCalledTimes(2);
    expect(pending()).toEqual([retour('b'), retour('c')]);
  });

  it('laisse la file intacte quand rien ne passe', async () => {
    store.set(PENDING_FEEDBACK_KEY, JSON.stringify([retour('a')]));
    post.mockRejectedValue(new Error('offline'));
    expect(await drainPendingFeedback()).toBe(0);
    expect(pending()).toEqual([retour('a')]);
  });

  it('écarte ce qui n est pas un retour plutôt que de le rejouer sans fin', async () => {
    store.set(PENDING_FEEDBACK_KEY, JSON.stringify([null, 'bidule', retour('a')]));
    post.mockResolvedValue(ok());
    expect(await drainPendingFeedback()).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('survit à un localStorage illisible', async () => {
    store.set(PENDING_FEEDBACK_KEY, '{ pas du json');
    expect(await drainPendingFeedback()).toBe(0);
    expect(pendingFeedbackCount()).toBe(0);
  });
});
