/**
 * PARITÉ DU MOTEUR DE FUSION DE LA MISE EN PAGE — bureau ↔ web.
 *
 * `src/platform/web/sync/layoutMerge.ts` est une COPIE de
 * `electron/sync/layoutMergeCore.ts` (voir l'en-tête des deux fichiers : les
 * deux programmes de compilation ne peuvent pas partager un module). Une copie
 * n'est sûre que tant qu'elle est prouvée conforme.
 *
 * CE QUE LA DIVERGENCE COÛTERAIT, très concrètement : les deux moteurs
 * arbitrent le MÊME conteneur, chacun de son côté du câble. S'ils tranchent
 * différemment — une égalité d'horloge résolue vers l'autre côté, une copie
 * perdante conservée ici et pas là, une horloge illisible prise pour une
 * horloge — alors le bureau et le navigateur écrivent deux `layout.enc`
 * différents à partir des mêmes entrées, et chaque cycle de synchronisation les
 * fait s'écraser l'un l'autre indéfiniment. Ce n'est pas une divergence
 * cosmétique : c'est une boucle de remontée perpétuelle et une disposition qui
 * change toute seule d'un appareil à l'autre.
 *
 * L'EXIGENCE EST DONC L'IDENTITÉ OCTET POUR OCTET du document rendu
 * (`JSON.stringify`, donc l'ORDRE DES CLÉS compte lui aussi : deux documents
 * équivalents mais sérialisés différemment produiraient deux empreintes
 * distinctes, donc deux entrées de manifeste différentes pour le même contenu).
 */

import { describe, expect, it } from 'vitest';

import * as web from '../layoutMerge';
import * as desktop from '../../../../../electron/sync/layoutMergeCore';

// ── Corpus ──────────────────────────────────────────────────────────────────

const T = (iso: string): string => new Date(iso).toISOString();
const T1 = T('2026-08-01T10:00:00.000Z');
const T2 = T('2026-08-02T10:00:00.000Z');
const T3 = T('2026-08-03T10:00:00.000Z');
const NOW = { iso: T('2026-08-04T10:00:00.000Z'), ms: Date.parse('2026-08-04T10:00:00.000Z') };

const slot = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  role: 'recents',
  type: 'recent-notes',
  x: 0,
  y: 0,
  w: 6,
  h: 3,
  ...over,
});

const view = (
  id: string,
  slots: unknown[],
  updatedAt?: string,
  over: Record<string, unknown> = {}
): Record<string, unknown> => ({ id, slots, updatedAt, ...over });

const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  views: {},
  templates: {},
  ...over,
});

/** Une disposition perdante déjà archivée, datée pour piloter l'expiration. */
const superseded = (savedAt: string, side: 'local' | 'remote', slots: unknown[]) => ({
  slots,
  updatedAt: T1,
  savedAt,
  side,
});

/**
 * Chaque cas est une divergence RÉELLE possible entre un bureau et un onglet,
 * pas une combinatoire abstraite. Le nom dit ce qui est en jeu.
 */
const CASES: Array<{ name: string; local: unknown; remote: unknown }> = [
  {
    name: 'deux documents vides',
    local: doc(),
    remote: doc(),
  },
  {
    name: 'le nuage porte une vue que cet appareil ignore',
    local: doc(),
    remote: doc({ views: { home: view('home', [slot('a')], T2) } }),
  },
  {
    name: 'cet appareil porte une vue que le nuage ignore',
    local: doc({ views: { home: view('home', [slot('a')], T2) } }),
    remote: doc(),
  },
  {
    name: 'divergence franche — le distant est plus frais',
    local: doc({ views: { home: view('home', [slot('a', { x: 0 })], T1) } }),
    remote: doc({ views: { home: view('home', [slot('b', { x: 6 })], T3) } }),
  },
  {
    name: 'divergence franche — le local est plus frais',
    local: doc({ views: { home: view('home', [slot('a', { x: 0 })], T3) } }),
    remote: doc({ views: { home: view('home', [slot('b', { x: 6 })], T1) } }),
  },
  {
    name: 'ÉGALITÉ D’HORLOGE sur des contenus différents (le local doit rester)',
    local: doc({ views: { home: view('home', [slot('a')], T2) } }),
    remote: doc({ views: { home: view('home', [slot('b')], T2) } }),
  },
  {
    name: 'horloge distante ABSENTE face à une horloge locale lisible',
    local: doc({ views: { home: view('home', [slot('a')], T1) } }),
    remote: doc({ views: { home: view('home', [slot('b')], undefined) } }),
  },
  {
    name: 'horloge distante ILLISIBLE (chaîne qui n’est pas une date)',
    local: doc({ views: { home: view('home', [slot('a')], T1) } }),
    remote: doc({ views: { home: view('home', [slot('b')], 'pas-une-date') } }),
  },
  {
    name: 'contenus IDENTIQUES, horloges différentes (adoption de la plus fraîche)',
    local: doc({ views: { home: view('home', [slot('a')], T1) } }),
    remote: doc({ views: { home: view('home', [slot('a')], T3) } }),
  },
  {
    name: 'dispositions perdantes des deux côtés — union, dédoublonnage, plafond',
    local: doc({
      views: {
        home: view('home', [slot('a')], T3, {
          superseded: [
            superseded(T2, 'local', [slot('x1')]),
            superseded(T2, 'local', [slot('x1')]), // doublon exact
            superseded(T1, 'remote', [slot('x2')]),
          ],
        }),
      },
    }),
    remote: doc({
      views: {
        home: view('home', [slot('b')], T2, {
          superseded: [
            superseded(T3, 'remote', [slot('x3')]),
            superseded(T2, 'remote', [slot('x4')]),
            superseded(T1, 'local', [slot('x5')]),
            superseded(T1, 'local', [slot('x6')]),
            superseded(T1, 'local', [slot('x7')]),
          ],
        }),
      },
    }),
  },
  {
    name: 'disposition perdante EXPIRÉE (au-delà des 30 jours)',
    local: doc({
      views: {
        home: view('home', [slot('a')], T3, {
          superseded: [superseded(T('2026-01-01T00:00:00.000Z'), 'local', [slot('vieux')])],
        }),
      },
    }),
    remote: doc({ views: { home: view('home', [slot('a')], T3) } }),
  },
  {
    name: 'vues MULTIPLES, chacune arbitrée pour son compte',
    local: doc({
      views: {
        home: view('home', [slot('a')], T3),
        'folder:1111': view('folder:1111', [slot('c')], T1),
        'home:alt': view('home:alt', [slot('e')], T2),
      },
    }),
    remote: doc({
      views: {
        home: view('home', [slot('b')], T1),
        'folder:1111': view('folder:1111', [slot('d')], T3),
        'folder:2222': view('folder:2222', [slot('f')], T2),
      },
    }),
  },
  {
    name: 'gabarits — union, arbitrage au grain du gabarit',
    local: doc({
      templates: {
        t1: { id: 't1', name: 'Mien', slots: [], updatedAt: T3, version: 2, author: 'moi' },
        t2: {
          id: 't2',
          name: 'Commun',
          slots: [{ role: 'stats', type: 'dashboard-stats', x: 0, y: 0, w: 12, h: 2 }],
          updatedAt: T1,
        },
      },
    }),
    remote: doc({
      templates: {
        t1: { id: 't1', name: 'Sien', slots: [], updatedAt: T1 },
        t2: {
          id: 't2',
          name: 'Commun',
          slots: [{ role: 'stats', type: 'dashboard-stats', x: 0, y: 0, w: 12, h: 2 }],
          updatedAt: T3,
        },
        t3: { id: 't3', name: 'Neuf', slots: [], updatedAt: T2 },
      },
    }),
  },
  {
    name: 'marque d’amorçage : la PLUS ANCIENNE gagne',
    local: doc({ seededAt: T3, views: { home: view('home', [slot('a')], T1) } }),
    remote: doc({ seededAt: T1, views: { home: view('home', [slot('a')], T1) } }),
  },
  {
    name: 'marque d’amorçage d’un seul côté',
    local: doc({ views: { home: view('home', [slot('a')], T1) } }),
    remote: doc({ seededAt: T2, views: { home: view('home', [slot('a')], T1) } }),
  },
  {
    name: 'vues AMORCÉES des deux côtés (époque contre époque)',
    local: doc({
      seededAt: T1,
      views: { home: view('home', [slot('seed:stats')], desktop.LAYOUT_SEED_CLOCK) },
    }),
    remote: doc({
      seededAt: T2,
      views: { home: view('home', [slot('seed:recents')], desktop.LAYOUT_SEED_CLOCK) },
    }),
  },
  {
    name: 'rôles, types et options INCONNUS (venus d’une version plus récente)',
    local: doc({
      schema: 1,
      views: {
        home: view(
          'home',
          [
            slot('a', {
              role: 'venu-du-futur',
              type: 'widget-inconnu',
              options: { z: [1, { k: 'v' }] },
            }),
          ],
          T2
        ),
      },
    }),
    remote: doc({
      schema: 7,
      views: { home: view('home', [slot('a', { role: 'autre-inconnu', type: 'x' })], T1) },
    }),
  },
  {
    name: 'attaches locales (binding) et champs hors contrat',
    local: doc({
      views: {
        home: view('home', [slot('a', { binding: { folderId: 'f-1', noteId: 42 } })], T2, {
          templateId: 'tpl-a',
        }),
      },
      updatedAt: T2,
    }),
    remote: doc({
      views: {
        home: view('home', [slot('a', { binding: { folderId: 'f-2' } })], T3, {
          templateId: 'tpl-b',
        }),
      },
      updatedAt: T3,
    }),
  },
  {
    name: 'formes ABÎMÉES : vues qui n’en sont pas, emplacements sans identité',
    local: {
      schema: 'pas-un-nombre',
      views: {
        home: 'chaîne',
        bad: null,
        ok: view('ok', [slot('a'), { role: 'sans-id' }, 42], T1),
      },
      templates: { t: 'chaîne' },
      seededAt: 12,
    },
    remote: doc({ views: { ok: view('ok', [slot('b')], T2) } }),
  },
  {
    name: 'entrées nulles / non-objets au premier niveau',
    local: null,
    remote: doc({ views: { home: view('home', [slot('a')], T2) } }),
  },
];

// ── Parité ──────────────────────────────────────────────────────────────────

describe('parité bureau ↔ web du moteur de fusion de la mise en page', () => {
  it('rend le MÊME document, octet pour octet, sur tout le corpus', () => {
    for (const { name, local, remote } of CASES) {
      const a = desktop.mergeLayoutDocuments(local, remote, NOW);
      const b = web.mergeLayoutDocuments(local, remote, NOW);
      expect(JSON.stringify(b.merged), name).toBe(JSON.stringify(a.merged));
      expect(b.changedFromLocal, name).toBe(a.changedFromLocal);
      expect(b.changedFromRemote, name).toBe(a.changedFromRemote);
      expect(b.conflicts, name).toEqual(a.conflicts);
    }
  });

  it('rend le même document dans le SENS INVERSE aussi (local ↔ distant)', () => {
    // Les deux côtés ne jouent pas le même rôle (l'égalité garde le LOCAL) :
    // inverser les entrées exerce donc des branches différentes, et la parité
    // doit tenir là aussi.
    for (const { name, local, remote } of CASES) {
      const a = desktop.mergeLayoutDocuments(remote, local, NOW);
      const b = web.mergeLayoutDocuments(remote, local, NOW);
      expect(JSON.stringify(b.merged), name).toBe(JSON.stringify(a.merged));
      expect(b.changedFromLocal, name).toBe(a.changedFromLocal);
      expect(b.changedFromRemote, name).toBe(a.changedFromRemote);
    }
  });

  it('normalise à l’identique (c’est ce qui entre dans la fusion ET sur le disque)', () => {
    for (const { name, local, remote } of CASES) {
      expect(JSON.stringify(web.normalizeLayoutDocument(local)), name).toBe(
        JSON.stringify(desktop.normalizeLayoutDocument(local))
      );
      expect(JSON.stringify(web.normalizeLayoutDocument(remote)), name).toBe(
        JSON.stringify(desktop.normalizeLayoutDocument(remote))
      );
    }
  });

  it('expire et plafonne les dispositions perdantes de la même façon', () => {
    // Les fabriques du corpus rendent des formes LIBRES (c'est le sujet : ce
    // module relit du JSON arbitraire) ; ici la signature est typée des deux
    // côtés, et les deux types sont structurellement identiques.
    const entries = [
      superseded(T3, 'remote', [slot('1')]),
      superseded(T2, 'local', [slot('2')]),
      superseded(T2, 'local', [slot('2')]),
      superseded(T1, 'remote', [slot('3')]),
      superseded(T('2025-01-01T00:00:00.000Z'), 'local', [slot('perime')]),
      superseded(T2, 'remote', [slot('4')]),
      superseded(T2, 'remote', [slot('5')]),
      superseded(T2, 'remote', [slot('6')]),
    ] as unknown as desktop.SupersededLayout[];
    expect(JSON.stringify(web.pruneSuperseded(entries, NOW.ms))).toBe(
      JSON.stringify(desktop.pruneSuperseded(entries, NOW.ms))
    );
  });

  it('lit les horloges de la même façon, y compris les illisibles', () => {
    const probes: unknown[] = [
      undefined,
      null,
      42,
      {},
      { updatedAt: null },
      { updatedAt: '' },
      { updatedAt: 'pas-une-date' },
      { updatedAt: T2 },
      { updatedAt: desktop.LAYOUT_SEED_CLOCK },
    ];
    for (const p of probes) {
      expect(web.clockOf(p)).toBe(desktop.clockOf(p));
    }
  });

  it('partage EXACTEMENT les constantes de protocole', () => {
    // Une seule de ces valeurs qui diverge et les deux côtés ne parlent plus du
    // même objet de manifeste, du même fichier, ou de la même durée de garde.
    expect(web.LAYOUT_META_FILE_ID).toBe(desktop.LAYOUT_META_FILE_ID);
    expect(web.LAYOUT_META_RESOURCE_ID).toBe(desktop.LAYOUT_META_RESOURCE_ID);
    expect(web.LAYOUT_BLOB_FILENAME).toBe(desktop.LAYOUT_BLOB_FILENAME);
    expect(web.LAYOUT_SCHEMA_VERSION).toBe(desktop.LAYOUT_SCHEMA_VERSION);
    expect(web.LAYOUT_SEED_CLOCK).toBe(desktop.LAYOUT_SEED_CLOCK);
    expect(web.SUPERSEDED_TTL_MS).toBe(desktop.SUPERSEDED_TTL_MS);
    expect(web.SUPERSEDED_MAX_PER_VIEW).toBe(desktop.SUPERSEDED_MAX_PER_VIEW);
    expect(web.KNOWN_SLOT_ROLES).toEqual(desktop.KNOWN_SLOT_ROLES);
    expect(JSON.stringify(web.createEmptyLayoutDocument())).toBe(
      JSON.stringify(desktop.createEmptyLayoutDocument())
    );
  });

  it('reste identique sur un corpus TIRÉ AU SORT (générateur semé, donc rejouable)', () => {
    // Le corpus nommé couvre ce qu'on a su prévoir ; celui-ci couvre ce qu'on
    // n'a pas prévu. Semé, donc un échec est reproductible à l'identique.
    let seed = 0x5eed_1a70;
    const rnd = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const clocks: unknown[] = [T1, T2, T3, undefined, '', 'nawak', desktop.LAYOUT_SEED_CLOCK];
    const roles = ['recents', 'stats', 'folder-grid', 'inconnu'];

    const randomView = (id: string): Record<string, unknown> => {
      const slots: unknown[] = [];
      const n = Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        slots.push(
          slot(`s${Math.floor(rnd() * 5)}`, {
            role: pick(roles),
            x: Math.floor(rnd() * 12),
            y: Math.floor(rnd() * 12),
            ...(rnd() < 0.3 ? { binding: { folderId: `f${Math.floor(rnd() * 3)}` } } : {}),
          })
        );
      }
      const v = view(id, slots, pick(clocks) as string | undefined);
      if (rnd() < 0.4) {
        v.superseded = [superseded(pick([T1, T2, T3]) as string, pick(['local', 'remote']), slots)];
      }
      return v;
    };

    const randomDoc = (): Record<string, unknown> => {
      const views: Record<string, unknown> = {};
      const ids = ['home', 'home:alt', 'folder:1111', 'folder:2222'];
      for (const id of ids) if (rnd() < 0.6) views[id] = randomView(id);
      return doc({
        views,
        ...(rnd() < 0.5 ? { seededAt: pick([T1, T2, T3]) } : {}),
        ...(rnd() < 0.5 ? { updatedAt: pick([T1, T2, T3]) } : {}),
      });
    };

    for (let i = 0; i < 300; i++) {
      const local = randomDoc();
      const remote = randomDoc();
      const a = desktop.mergeLayoutDocuments(local, remote, NOW);
      const b = web.mergeLayoutDocuments(local, remote, NOW);
      const label = `tirage ${i}`;
      expect(JSON.stringify(b.merged), label).toBe(JSON.stringify(a.merged));
      expect(b.changedFromLocal, label).toBe(a.changedFromLocal);
      expect(b.changedFromRemote, label).toBe(a.changedFromRemote);
      expect(b.conflicts, label).toEqual(a.conflicts);
    }
  });
});
