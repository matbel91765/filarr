/**
 * UN ECHEC DE SYNCHRONISATION DOIT POUVOIR MOURIR.
 *
 * ── CE QUI ETAIT CASSE ──────────────────────────────────────────────────────
 *
 * `markFailed` garde volontairement un element epuise dans la file « pour la
 * visibilite », et RIEN ne l'en retirait jamais : `markSuccess` ne s'appelle
 * qu'avec l'identifiant d'un element qu'on vient de traiter, or un element
 * epuise n'est plus jamais dequeue. La sortie etait a sens unique.
 *
 * Cas reel : une descente de `meta:17741303646699kxl99l` echoue le 13 aout sur
 * un desaccord de somme de controle, trois tentatives, abandon. Un cycle
 * ULTERIEUR fait converger les deux cotes -- la fusion du 1er septembre lit
 * `local: synced/c1a23ae1 remote: synced/c1a23ae1`, identiques. Le badge rouge,
 * lui, est reste allume DIX-NEUF JOURS sur un probleme resolu. Ce n'est pas
 * seulement inutile : un indicateur qui ment en permanence apprend a etre
 * ignore, et il devra un jour signaler une vraie perte.
 *
 * ── CE QUE CETTE SUITE EPINGLE ──────────────────────────────────────────────
 *
 * La regle de retrait, et surtout SES REFUS. Retirer trop peu laisse le badge
 * menteur ; retirer trop efface la trace d'une perte reelle, ce qui est bien
 * pire. Chaque refus ci-dessous est donc une decision, pas un cas limite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// La file ouvre `electron` a l'import et ecrit un JSON sur disque. Faux disque
// en memoire : ce qu'on eprouve ici est la REGLE DE RETRAIT.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/filarr-test' },
}));

const disque = new Map<string, string>();

vi.mock('fs/promises', () => ({
  readFile: vi.fn(async (p: string) => {
    const v = disque.get(p);
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return v;
  }),
  writeFile: vi.fn(async (p: string, c: string) => {
    disque.set(p, c);
  }),
  mkdir: vi.fn(async () => undefined),
  rename: vi.fn(async (a: string, b: string) => {
    const v = disque.get(a);
    if (v !== undefined) {
      disque.set(b, v);
      disque.delete(a);
    }
  }),
  unlink: vi.fn(async (p: string) => {
    disque.delete(p);
  }),
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { join } from 'path';

import * as queue from '../sync/syncQueue';

const PROFIL = 'profil-a';

// Le meme `path.join` que le code teste : sous Windows il produit des
// antislashs, et une cle ecrite a la main ne correspondrait a rien.
const FICHIER = join('/tmp/filarr-test', 'FilarData', 'sync-queue.json');

/** Ecrit directement la file sur le faux disque, dans l'etat voulu. */
async function poserFile(items: Array<Partial<queue.SyncQueueItem>>): Promise<void> {
  const complets = items.map((i, n) => ({
    id: `id-${n}`,
    type: 'download',
    resourceType: 'file',
    resourceId: `res-${n}`,
    profileId: PROFIL,
    priority: 'normal',
    attempts: 3,
    maxAttempts: 3,
    lastAttempt: '2026-08-13T01:19:16.095Z',
    nextRetry: null,
    error: 'Checksum mismatch on buffered download',
    createdAt: '2026-08-13T01:09:14.830Z',
    ...i,
  }));
  disque.clear();
  disque.set(FICHIER, JSON.stringify(complets));
}

async function identifiantsRestants(): Promise<string[]> {
  return (await queue.load()).map((i) => i.resourceId);
}

describe('reapResolvedFailures', () => {
  beforeEach(() => disque.clear());

  it('retire un echec epuise dont la ressource a converge depuis', async () => {
    await poserFile([{ resourceId: 'meta:17741303646699kxl99l' }]);

    const retires = await queue.reapResolvedFailures(PROFIL, () => true);

    expect(retires).toBe(1);
    expect(await identifiantsRestants()).toEqual([]);
  });

  it('GARDE un echec que l appelant ne declare pas resolu', async () => {
    // Le cas qui compte : une vraie perte doit rester visible. Si ce test
    // devenait vert avec un predicat toujours faux, le ramassage effacerait
    // la trace du seul probleme qu'on tienne a montrer.
    await poserFile([{ resourceId: 'meta:toujours-casse' }]);

    const retires = await queue.reapResolvedFailures(PROFIL, () => false);

    expect(retires).toBe(0);
    expect(await identifiantsRestants()).toEqual(['meta:toujours-casse']);
  });

  it("GARDE un element qui n'a pas epuise ses tentatives", async () => {
    // Il n'est pas « en echec », il ATTEND son prochain essai. Le retirer
    // annulerait un travail encore programme -- une perte silencieuse.
    await poserFile([
      { resourceId: 'res-en-cours', attempts: 1, nextRetry: '2099-01-01T00:00:00.000Z' },
    ]);

    const retires = await queue.reapResolvedFailures(PROFIL, () => true);

    expect(retires).toBe(0);
    expect(await identifiantsRestants()).toEqual(['res-en-cours']);
  });

  it("GARDE l'echec d'un AUTRE profil", async () => {
    // Le predicat de l'appelant est construit sur les manifestes du profil
    // qui vient de se synchroniser. L'appliquer a un autre profil serait le
    // juger sur des informations qui ne le concernent pas.
    await poserFile([{ resourceId: 'res-ailleurs', profileId: 'profil-b' }]);

    const retires = await queue.reapResolvedFailures(PROFIL, () => true);

    expect(retires).toBe(0);
    expect(await identifiantsRestants()).toEqual(['res-ailleurs']);
  });

  it('ne retire que les elements vises, et laisse les autres intacts', async () => {
    await poserFile([
      { resourceId: 'resolu-1' },
      { resourceId: 'casse' },
      { resourceId: 'resolu-2' },
    ]);

    const retires = await queue.reapResolvedFailures(PROFIL, (i) =>
      i.resourceId.startsWith('resolu')
    );

    expect(retires).toBe(2);
    expect(await identifiantsRestants()).toEqual(['casse']);
  });

  it("n'ecrit pas la file quand il n'y a rien a retirer", async () => {
    await poserFile([{ resourceId: 'casse' }]);
    const avant = disque.get(FICHIER);

    await queue.reapResolvedFailures(PROFIL, () => false);

    expect(disque.get(FICHIER)).toBe(avant);
  });
});

/**
 * LA PRISE QUE L'UTILISATEUR N'AVAIT PAS.
 *
 * `dequeue` ecarte definitivement tout element dont `attempts >= maxAttempts`.
 * L'ecran disait « Abandonne apres 3 tentatives » et le code du panneau
 * annonçait « l'utilisateur doit relancer lui-meme » -- sauf qu'aucun chemin
 * ne le permettait. La seule sortie etait de vider la file ENTIERE, ce qui
 * emporte aussi le travail encore programme.
 *
 * Les deux refus ci-dessous sont le coeur de la suite : agir sur un element
 * NON epuise annulerait ou rejouerait du travail encore prevu, et ce serait
 * une perte silencieuse maquillee en fonctionnalite.
 */
describe('rearm', () => {
  beforeEach(() => disque.clear());

  it('remet un echec epuise a zero et le rend immediatement eligible', async () => {
    await poserFile([{ resourceId: 'meta:casse', error: 'Checksum mismatch' }]);

    expect(await queue.rearm('id-0')).toBe(true);

    const [item] = await queue.load();
    expect(item.attempts).toBe(0);
    expect(item.error).toBeNull();
    // `nextRetry: null` = eligible tout de suite (voir `dequeue`). Quelqu'un
    // qui appuie sur « Reessayer » demande maintenant, pas dans trente secondes.
    expect(item.nextRetry).toBeNull();
    expect(await queue.dequeue(10)).toHaveLength(1);
  });

  it("REFUSE un element qui n'a pas epuise ses tentatives", async () => {
    // Sinon trois echecs se rejoueraient sans fin tant que quelqu'un clique,
    // et le plafond de tentatives ne voudrait plus rien dire.
    await poserFile([{ resourceId: 'res-en-cours', attempts: 1 }]);

    expect(await queue.rearm('id-0')).toBe(false);

    const [item] = await queue.load();
    expect(item.attempts).toBe(1);
  });

  it('REFUSE un identifiant inconnu, sans rien modifier', async () => {
    await poserFile([{ resourceId: 'res-a' }]);

    expect(await queue.rearm('id-inexistant')).toBe(false);
    expect(await identifiantsRestants()).toEqual(['res-a']);
  });
});

describe('dismiss', () => {
  beforeEach(() => disque.clear());

  it('ecarte un echec epuise', async () => {
    // Certains echecs ne se reparent pas : un objet distant reellement
    // corrompu, un fichier supprime ailleurs. Sans cette sortie, la seule
    // option etait un badge rouge permanent.
    await poserFile([{ resourceId: 'meta:irreparable' }]);

    expect(await queue.dismiss('id-0')).toBe(true);
    expect(await identifiantsRestants()).toEqual([]);
  });

  it("REFUSE un element qui n'a pas epuise ses tentatives", async () => {
    // Celui-la n'a pas echoue, il ATTEND. L'ecarter annulerait en silence un
    // travail encore programme.
    await poserFile([{ resourceId: 'res-en-cours', attempts: 2 }]);

    expect(await queue.dismiss('id-0')).toBe(false);
    expect(await identifiantsRestants()).toEqual(['res-en-cours']);
  });

  it("n'emporte que l'element vise", async () => {
    await poserFile([{ resourceId: 'res-a' }, { resourceId: 'res-b' }]);

    expect(await queue.dismiss('id-1')).toBe(true);
    expect(await identifiantsRestants()).toEqual(['res-a']);
  });
});
