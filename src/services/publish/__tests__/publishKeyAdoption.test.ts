import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * B1 — L'ADOPTION DE LA CLÉ CÔTÉ RENDERER NE DÉPEND D'AUCUN ÉCRAN.
 *
 * Le trou fermé ici : une bascule peut s'achever par la reprise au démarrage
 * (`resumeOnStartup`) sans que la modale « Publier ce coffre » soit montée.
 * Le process principal émet alors `publish:key-adopted` — si la seule écoute
 * vivait dans la modale, le renderer garderait sa copie de l'ANCIENNE FEK et
 * scellerait ses nouveaux fichiers sous une clé que plus rien ne désigne
 * comme active.
 *
 * Ces tests verrouillent trois choses :
 *  1. le SIMPLE CHARGEMENT de `publishBridge` (bundle initial du renderer)
 *     installe l'écoute — aucun montage d'écran requis ; retirer
 *     l'auto-installation du module fait échouer ce test ;
 *  2. l'événement recharge la FEK par le MÊME chemin que `commitKeySwitch`
 *     (`hybrid:loadFEK` → `importFEKRaw`) puis rafraîchit les clés retirées ;
 *  3. l'installeur est idempotent, et un échec d'adoption ne lève pas et ne
 *     journalise aucun octet de clé.
 */

type Handler = (...args: unknown[]) => void;

vi.mock('../../auth/hybridCrypto', () => ({
  importFEKRaw: vi.fn(async () => undefined),
  refreshRetiredFeks: vi.fn(async () => undefined),
}));

/** Octets factices de FEK — jamais une vraie clé, évidemment. */
const FEK_BYTES = Array.from({ length: 32 }, (_, i) => i + 1);

interface FakeBridge {
  on: vi.Mock;
  invoke: vi.Mock;
  send: vi.Mock;
}

function installFakeBridge(fekResponse: unknown = FEK_BYTES): {
  bridge: FakeBridge;
  handlers: Map<string, Handler[]>;
} {
  const handlers = new Map<string, Handler[]>();
  const bridge: FakeBridge = {
    on: vi.fn((channel: string, handler: Handler) => {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => undefined;
    }),
    invoke: vi.fn(async (channel: string) => {
      if (channel === 'hybrid:loadFEK') return fekResponse;
      if (channel === 'publish:getRetiredKeys') return [];
      return null;
    }),
    send: vi.fn(),
  };
  (window as unknown as { electron?: unknown }).electron = { ipcRenderer: bridge };
  return { bridge, handlers };
}

/** Laisse se dérouler les micro-tâches de l'adoption (import dynamique inclus). */
async function flushAdoption(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function adoptedHandlers(handlers: Map<string, Handler[]>): Handler[] {
  return handlers.get('publish:key-adopted') ?? [];
}

interface HybridCryptoMock {
  importFEKRaw: vi.Mock;
  refreshRetiredFeks: vi.Mock;
}

/**
 * Charge `publishBridge` sur un registre de modules NEUF — c'est l'équivalent
 * du chargement du bundle au démarrage du renderer. Le pont factice doit déjà
 * être posé sur `window` : l'auto-installation se joue à l'import.
 */
async function loadFreshModules(): Promise<{
  publishBridge: typeof import('../publishBridge');
  hybrid: HybridCryptoMock;
}> {
  vi.resetModules();
  const publishBridge = await import('../publishBridge');
  const hybrid = (await import('../../auth/hybridCrypto')) as unknown as HybridCryptoMock;
  return { publishBridge, hybrid };
}

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron;
  vi.resetModules();
  vi.clearAllMocks();
});

describe('adoption permanente de publish:key-adopted (B1)', () => {
  it("s'installe au simple chargement du module, sans aucun écran monté", async () => {
    const { handlers } = installFakeBridge();
    await loadFreshModules();
    // Aucune modale, aucun composant React : l'abonnement doit exister quand
    // même. C'est LA garantie qui couvre la reprise au démarrage.
    expect(adoptedHandlers(handlers)).toHaveLength(1);
  });

  it('recharge la FEK par le même chemin que commitKeySwitch, puis les clés retirées', async () => {
    const { bridge, handlers } = installFakeBridge();
    const { hybrid } = await loadFreshModules();

    adoptedHandlers(handlers).forEach((h) => h());
    await flushAdoption();

    expect(bridge.invoke).toHaveBeenCalledWith('hybrid:loadFEK');
    expect(hybrid.importFEKRaw).toHaveBeenCalledTimes(1);
    expect(hybrid.importFEKRaw).toHaveBeenCalledWith(new Uint8Array(FEK_BYTES));
    // Les clés retirées suivent : c'est l'instant exact où la clé active cesse
    // d'ouvrir le contenu déjà présent.
    expect(hybrid.refreshRetiredFeks).toHaveBeenCalledTimes(1);
  });

  it("n'importe pas de clé quand hybrid:loadFEK ne rend rien, mais rafraîchit quand même les clés retirées", async () => {
    const { handlers } = installFakeBridge(null);
    const { hybrid } = await loadFreshModules();

    adoptedHandlers(handlers).forEach((h) => h());
    await flushAdoption();

    expect(hybrid.importFEKRaw).not.toHaveBeenCalled();
    expect(hybrid.refreshRetiredFeks).toHaveBeenCalledTimes(1);
  });

  it('est idempotent : rappeler l’installeur n’ajoute pas de second abonnement', async () => {
    const { handlers } = installFakeBridge();
    const { publishBridge } = await loadFreshModules();

    publishBridge.initPublishKeyAdoption();
    publishBridge.initPublishKeyAdoption();

    expect(adoptedHandlers(handlers)).toHaveLength(1);
  });

  it("un échec d'adoption ne lève pas et ne journalise aucun octet de clé", async () => {
    const { handlers } = installFakeBridge();
    const { hybrid } = await loadFreshModules();
    hybrid.importFEKRaw.mockRejectedValueOnce(new Error('trousseau indisponible'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      adoptedHandlers(handlers).forEach((h) => h());
      await flushAdoption();

      expect(consoleError).toHaveBeenCalled();
      // Le journal ne doit porter AUCUNE trace des octets de la clé.
      const logged = consoleError.mock.calls.map((args) => args.join(' ')).join(' ');
      expect(logged).not.toContain(FEK_BYTES.join(','));
    } finally {
      consoleError.mockRestore();
    }
  });
});
