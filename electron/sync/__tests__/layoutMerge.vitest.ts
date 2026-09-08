/**
 * MISE EN PAGE MODULAIRE — ce qui ne doit JAMAIS arriver.
 *
 * Cinq pannes sont verrouillées ici, chacune constatée ou anticipée en revue :
 *
 *  1. FUSION POSITIONNELLE. Fusionner deux vues widget par widget produit une
 *     disposition avec des chevauchements que PERSONNE n'a voulue. Le grain est
 *     donc la VUE ENTIÈRE, arbitrée en LWW strict — et l'égalité garde le local.
 *
 *  2. HORLOGE ABSENTE PRISE POUR UNE HORLOGE. Un document écrit par une version
 *     qui ignore `updatedAt` pouvait effacer une disposition datée. Une horloge
 *     absente ou illisible n'est PAS autoritaire.
 *
 *  3. PERTE SILENCIEUSE DE LA PERDANTE. L'arbitrage écarte forcément une des
 *     deux dispositions : elle est conservée 30 jours dans `superseded`.
 *
 *  4. DOUBLE AMORÇAGE. Deux appareils qui amorcent chacun le leur produisent
 *     deux documents concurrents. Deux garde-fous : la marque `seededAt` vit
 *     DANS le conteneur (elle survit à un `clearProfile`), et toute vue amorcée
 *     porte l'ÉPOQUE — elle ne peut donc gagner que là où le nuage n'a rien.
 *
 *  5. ÉCRASEMENT DE `meta:layout` PAR LE MANIFESTE. Le blob porte le travail des
 *     deux appareils : `mergeWithRemote` ne doit jamais le programmer en
 *     conflit, ni le laisser écraser dans un sens ou dans l'autre.
 *
 * Le chiffrement est remplacé par un container factice `FAKE:<sel>:<json>` —
 * seul compte ici le fait que deux scellements du MÊME contenu produisent des
 * OCTETS DIFFÉRENTS, exactement comme le sel aléatoire de StorageService.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as nodeCrypto from 'crypto';
import * as os from 'os';
import * as nodePath from 'path';

// ── Mocks (hissés) ──────────────────────────────────────────────────────────

const storage = vi.hoisted(() => ({
  getBaseDir: vi.fn(),
  decrypt: vi.fn(),
  encryptToFile: vi.fn(),
}));

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }));
vi.mock('electron-log', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));
vi.mock('../../storageService', () => ({ default: storage }));

import * as fs from 'fs/promises';
import {
  clockOf,
  mergeLayoutDocuments,
  normalizeLayoutDocument,
  LAYOUT_META_FILE_ID,
  LAYOUT_SEED_CLOCK,
  SUPERSEDED_TTL_MS,
  type LayoutDocument,
  type LayoutSlot,
  type LayoutView,
} from '../layoutMergeCore';
import {
  isSeeded,
  layoutFilePath,
  LayoutKeyUnavailableError,
  loadOrSeedLayout,
  readLayoutDocument,
  seedLayoutDocument,
  writeLayoutDocument,
} from '../layoutStore';
import { mergeWithRemote, type SyncFileEntry, type SyncManifest } from '../syncManifest';

// ── Container factice ───────────────────────────────────────────────────────

/** Deux scellements du même contenu diffèrent — comme le sel de StorageService. */
function seal(payload: unknown): string {
  return `FAKE:${nodeCrypto.randomBytes(8).toString('hex')}:${JSON.stringify(payload)}`;
}

function unseal(container: string): unknown {
  if (!container.startsWith('FAKE:')) {
    throw new Error('Unsupported state or unable to authenticate data');
  }
  return JSON.parse(container.slice(container.indexOf(':', 5) + 1));
}

// ── Décor ───────────────────────────────────────────────────────────────────

const T = (iso: string): string => new Date(iso).toISOString();
const T1 = T('2026-08-01T10:00:00.000Z');
const T2 = T('2026-08-02T10:00:00.000Z');
const T3 = T('2026-08-03T10:00:00.000Z');
const NOW = { iso: T('2026-08-04T10:00:00.000Z'), ms: Date.parse('2026-08-04T10:00:00.000Z') };

const slot = (id: string, over: Partial<LayoutSlot> = {}): LayoutSlot => ({
  id,
  role: 'recents',
  type: 'recent-notes',
  x: 0,
  y: 0,
  w: 6,
  h: 3,
  ...over,
});

const view = (id: string, slots: LayoutSlot[], updatedAt?: string): LayoutView => {
  const v: LayoutView = { id, slots, updatedAt: updatedAt ?? LAYOUT_SEED_CLOCK };
  return v;
};

const doc = (views: Record<string, LayoutView>): LayoutDocument => ({
  schema: 1,
  views,
  templates: {},
});

/** Sépare la lecture du hasard : un document daté, deux dispositions distinctes. */
const localHome = (updatedAt: string | undefined): LayoutDocument =>
  doc({ home: view('home', [slot('a', { x: 0 })], updatedAt) });
const remoteHome = (updatedAt: string | undefined): LayoutDocument =>
  doc({ home: view('home', [slot('b', { x: 6 })], updatedAt) });

let dirA: string;
let dirB: string;

/**
 * Rend le contexte cryptographique cohérent avec le profil visé — c'est ce que
 * fait `profile:activate` en appelant `StorageService.reinitialize`. Chaque
 * profil a SA clé machine : lire le conteneur d'un profil pendant que le
 * service tient la clé d'un autre échoue comme un fichier corrompu, d'où la
 * garde de `layoutStore`.
 */
const useProfile = (dir: string): void => {
  storage.getBaseDir.mockReturnValue(dir);
};

beforeEach(async () => {
  vi.clearAllMocks();
  dirA = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'filarr-layout-a-'));
  dirB = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'filarr-layout-b-'));
  storage.getBaseDir.mockReturnValue(dirA);
  storage.decrypt.mockImplementation(async (container: string) => unseal(container));
  storage.encryptToFile.mockImplementation(async (data: unknown, filePath: string) => {
    await fs.writeFile(filePath, seal(data), 'utf-8');
  });
});

afterEach(async () => {
  await fs.rm(dirA, { recursive: true, force: true });
  await fs.rm(dirB, { recursive: true, force: true });
});

// ── 1. Arbitrage LWW, au grain de la VUE ────────────────────────────────────

describe('fusion — dernier écrivain gagne, au grain de la vue', () => {
  it('distant STRICTEMENT plus frais → il gagne', () => {
    const res = mergeLayoutDocuments(localHome(T1), remoteHome(T2), NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['b']);
    expect(res.merged.views.home.updatedAt).toBe(T2);
    expect(res.changedFromLocal).toBe(true);
  });

  it('distant plus ancien → il perd, le local reste intact', () => {
    const res = mergeLayoutDocuments(localHome(T2), remoteHome(T1), NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['a']);
    expect(res.merged.views.home.updatedAt).toBe(T2);
    expect(res.changedFromRemote).toBe(true); // il faut repousser notre version
  });

  it('ÉGALITÉ D’HORLOGE → le LOCAL reste (jamais le distant)', () => {
    const res = mergeLayoutDocuments(localHome(T2), remoteHome(T2), NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['a']);
  });

  it('AUCUNE fusion positionnelle : la vue gagnante est prise ENTIÈRE', () => {
    // Deux dispositions de trois blocs chacune, aux mêmes coordonnées. Une
    // fusion par emplacement les mélangerait et produirait des chevauchements.
    const l = doc({
      home: view('home', [slot('l1'), slot('l2', { y: 3 }), slot('l3', { y: 6 })], T1),
    });
    const r = doc({
      home: view('home', [slot('r1'), slot('r2', { y: 3 }), slot('r3', { y: 6 })], T2),
    });
    const res = mergeLayoutDocuments(l, r, NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('vue présente d’un seul côté → union, rien ne disparaît', () => {
    const l = doc({ home: view('home', [slot('a')], T1) });
    const r = doc({ 'folder:xyz': view('folder:xyz', [slot('b')], T1) });
    const res = mergeLayoutDocuments(l, r, NOW);
    expect(Object.keys(res.merged.views).sort()).toEqual(['folder:xyz', 'home']);
  });

  it('même disposition, horloges différentes → on adopte la plus fraîche et ça CONVERGE', () => {
    const same = (updatedAt: string): LayoutDocument =>
      doc({ home: view('home', [slot('a')], updatedAt) });
    const res = mergeLayoutDocuments(same(T1), same(T2), NOW);
    expect(res.merged.views.home.updatedAt).toBe(T2);
    expect(res.merged.views.home.superseded).toBeUndefined(); // rien n'a été perdu
    expect(res.changedFromRemote).toBe(false); // plus rien à repousser
    // Deuxième tour : le document ne bouge plus.
    const again = mergeLayoutDocuments(res.merged, same(T2), NOW);
    expect(again.changedFromLocal).toBe(false);
    expect(again.changedFromRemote).toBe(false);
  });
});

// ── 2. Une horloge absente n'est pas autoritaire ────────────────────────────

describe('fusion — horloge absente ou illisible : JAMAIS autoritaire', () => {
  it('distant sans horloge face à un local daté → le local reste', () => {
    const r = doc({ home: { id: 'home', slots: [slot('b')] } as unknown as LayoutView });
    const res = mergeLayoutDocuments(localHome(T1), r, NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['a']);
  });

  it('distant à horloge ILLISIBLE face à un local daté → le local reste', () => {
    const r = doc({ home: view('home', [slot('b')], 'pas-une-date') });
    const res = mergeLayoutDocuments(localHome(T1), r, NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['a']);
    expect(clockOf(r.views.home)).toBe(-Infinity);
  });

  it('local sans horloge face à un distant daté → le distant gagne', () => {
    const l = doc({ home: { id: 'home', slots: [slot('a')] } as unknown as LayoutView });
    const res = mergeLayoutDocuments(l, remoteHome(T1), NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['b']);
  });

  it('AUCUNE horloge des deux côtés → le local reste', () => {
    const l = doc({ home: { id: 'home', slots: [slot('a')] } as unknown as LayoutView });
    const r = doc({ home: { id: 'home', slots: [slot('b')] } as unknown as LayoutView });
    const res = mergeLayoutDocuments(l, r, NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['a']);
  });
});

// ── 3. La disposition perdante est conservée ───────────────────────────────

describe('fusion — la version perdante n’est jamais perdue', () => {
  it('le distant gagne → la disposition LOCALE est conservée', () => {
    const res = mergeLayoutDocuments(localHome(T1), remoteHome(T2), NOW);
    const kept = res.merged.views.home.superseded;
    expect(kept).toHaveLength(1);
    expect(kept?.[0].side).toBe('local');
    expect(kept?.[0].slots.map((s) => s.id)).toEqual(['a']);
    expect(kept?.[0].updatedAt).toBe(T1);
    expect(kept?.[0].savedAt).toBe(NOW.iso);
    expect(res.conflicts).toEqual(['home']);
  });

  it('le local gagne → la disposition DISTANTE est conservée', () => {
    const res = mergeLayoutDocuments(localHome(T2), remoteHome(T1), NOW);
    const kept = res.merged.views.home.superseded;
    expect(kept).toHaveLength(1);
    expect(kept?.[0].side).toBe('remote');
    expect(kept?.[0].slots.map((s) => s.id)).toEqual(['b']);
  });

  it('une convergence ne fabrique AUCUNE copie (sinon une par cycle, sans fin)', () => {
    const same = doc({ home: view('home', [slot('a')], T2) });
    const res = mergeLayoutDocuments(same, same, NOW);
    expect(res.merged.views.home.superseded).toBeUndefined();
    expect(res.conflicts).toEqual([]);
  });

  it('les copies de plus de 30 jours sont oubliées', () => {
    const vieux = {
      slots: [slot('ancien')],
      updatedAt: T1,
      savedAt: new Date(NOW.ms - SUPERSEDED_TTL_MS - 1000).toISOString(),
      side: 'local' as const,
    };
    const l: LayoutDocument = doc({
      home: { ...view('home', [slot('a')], T2), superseded: [vieux] },
    });
    const res = mergeLayoutDocuments(l, doc({}), NOW);
    expect(res.merged.views.home.superseded).toBeUndefined();
  });

  it('une copie de moins de 30 jours survit', () => {
    const recent = {
      slots: [slot('ancien')],
      updatedAt: T1,
      savedAt: new Date(NOW.ms - SUPERSEDED_TTL_MS + 60_000).toISOString(),
      side: 'local' as const,
    };
    const l: LayoutDocument = doc({
      home: { ...view('home', [slot('a')], T2), superseded: [recent] },
    });
    const res = mergeLayoutDocuments(l, doc({}), NOW);
    expect(res.merged.views.home.superseded).toHaveLength(1);
  });
});

// ── 4. Amorçage : une fois, et jamais contre une disposition réelle ─────────

describe('amorçage — jamais deux fois, jamais gagnant', () => {
  it('les vues amorcées portent l’ÉPOQUE, la marque porte l’heure vraie', () => {
    const seeded = seedLayoutDocument({ homeRecentNotes: true }, NOW.iso);
    expect(seeded.views.home.updatedAt).toBe(LAYOUT_SEED_CLOCK);
    expect(seeded.seededAt).toBe(NOW.iso);
    expect(isSeeded(seeded)).toBe(true);
  });

  it('LE PIÈGE : une vue amorcée PERD contre une disposition réelle du nuage', () => {
    const seeded = seedLayoutDocument({}, NOW.iso);
    const reel = doc({ home: view('home', [slot('vrai')], T1) });
    const res = mergeLayoutDocuments(seeded, reel, NOW);
    expect(res.merged.views.home.slots.map((s) => s.id)).toEqual(['vrai']);
  });

  // ⚠ L'ASSERTION PORTE SUR LES TYPES, PAS SUR LES RÔLES. Depuis que la base
  // pose quatre tuiles `stat-tile` et deux blocs de reprise, plusieurs
  // emplacements PARTAGENT un rôle : `toContain('recents')` resterait vrai même
  // si le bloc que la préférence retire avait disparu. Le type (et l'identifiant
  // déterministe) est le seul témoin qui ne ment pas.
  it('les préférences existantes sont LUES (jamais inventées, jamais effacées)', () => {
    const avec = seedLayoutDocument({ homeRecentNotes: true, dashboardCollapsed: false }, NOW.iso);
    expect(avec.views.home.slots.map((s) => s.type)).toEqual([
      'stat-tile',
      'stat-tile',
      'stat-tile',
      'stat-tile',
      'type-donut',
      'resume',
      'recent-notes',
      'folder-grid',
    ]);

    // Les deux refus : plus de rangée de chiffres, plus de notes récentes. Le
    // reste de la base est intact, et il a remonté d'un cran.
    const sans = seedLayoutDocument({ homeRecentNotes: false, dashboardCollapsed: true }, NOW.iso);
    expect(sans.views.home.slots.map((s) => s.type)).toEqual([
      'type-donut',
      'resume',
      'folder-grid',
    ]);
    expect(sans.views.home.slots.map((s) => s.y)).toEqual([0, 0, 2]);

    // Préférence jamais écrite = widget visible (règle de `loadHomeRecentNotes`).
    const defaut = seedLayoutDocument({}, NOW.iso);
    expect(defaut.views.home.slots.map((s) => s.type)).toContain('recent-notes');
  });

  it('deux appels d’affilée n’amorcent QU’UNE fois', async () => {
    const first = await loadOrSeedLayout(dirA, {}, false, NOW);
    expect(first.created).toBe(true);
    expect(first.seeded).toBe(true);

    const second = await loadOrSeedLayout(dirA, {}, false, {
      iso: T('2026-09-01T10:00:00.000Z'),
      ms: Date.parse('2026-09-01T10:00:00.000Z'),
    });
    expect(second.created).toBe(false);
    expect(second.document.seededAt).toBe(NOW.iso); // la marque n'a pas bougé
    expect(storage.encryptToFile).toHaveBeenCalledTimes(1);
  });

  it('GARDE ANTI-DOUBLE-AMORÇAGE : le nuage porte déjà une mise en page → on n’écrit RIEN', async () => {
    const res = await loadOrSeedLayout(dirA, {}, true, NOW);
    expect(res.seeded).toBe(false);
    expect(res.created).toBe(false);
    expect(Object.keys(res.document.views)).toEqual([]);
    expect(storage.encryptToFile).not.toHaveBeenCalled();
    await expect(fs.access(layoutFilePath(dirA))).rejects.toBeTruthy();
  });

  it('la marque d’amorçage la plus ANCIENNE gagne (elle ne peut pas reculer)', () => {
    const l = { ...seedLayoutDocument({}, T2) };
    const r = { ...seedLayoutDocument({}, T1) };
    expect(mergeLayoutDocuments(l, r, NOW).merged.seededAt).toBe(T1);
    expect(mergeLayoutDocuments(r, l, NOW).merged.seededAt).toBe(T1);
  });
});

// ── 5. Isolation par profil ────────────────────────────────────────────────

describe('isolation par profil — un répertoire, un conteneur', () => {
  it('deux profils amorcent deux conteneurs distincts, sans se voir', async () => {
    useProfile(dirA);
    const a = await loadOrSeedLayout(dirA, { homeRecentNotes: true }, false, NOW);
    useProfile(dirB);
    const b = await loadOrSeedLayout(dirB, { homeRecentNotes: false }, false, NOW);

    // Par le TYPE, pas par le rôle : « reprise » et « notes récentes » ne
    // partagent plus le même rôle, mais plusieurs blocs de la base en partagent
    // un — un rôle ne distingue donc plus rien ici.
    expect(a.document.views.home.slots.map((s) => s.type)).toContain('recent-notes');
    expect(b.document.views.home.slots.map((s) => s.type)).not.toContain('recent-notes');

    // Chacun son fichier, à la racine de SON répertoire de profil.
    expect(layoutFilePath(dirA)).toBe(nodePath.join(dirA, 'layout.enc'));
    expect(layoutFilePath(dirB)).toBe(nodePath.join(dirB, 'layout.enc'));
    await expect(fs.access(layoutFilePath(dirA))).resolves.toBeUndefined();
    await expect(fs.access(layoutFilePath(dirB))).resolves.toBeUndefined();
  });

  it('écrire dans un profil ne touche jamais l’autre', async () => {
    useProfile(dirA);
    await loadOrSeedLayout(dirA, {}, false, NOW);
    useProfile(dirB);
    await loadOrSeedLayout(dirB, {}, false, NOW);

    useProfile(dirA);
    await writeLayoutDocument(dirA, doc({ home: view('home', [slot('seulA')], T3) }), NOW);

    const relueA = await readLayoutDocument(dirA);
    const relueB = await readLayoutDocument(dirB);
    expect(relueA?.views.home.slots.map((s) => s.id)).toEqual(['seulA']);
    expect(relueB?.views.home.slots.some((s) => s.id === 'seulA')).toBe(false);
  });

  it('supprimer le répertoire du profil emporte sa mise en page', async () => {
    useProfile(dirB);
    await loadOrSeedLayout(dirB, {}, false, NOW);
    await fs.rm(dirB, { recursive: true, force: true });
    expect(await readLayoutDocument(dirB)).toBeNull();
  });

  it('LE PIÈGE TROUVÉ EN SONDE : clé d’un autre profil → ni lecture, ni écriture, ni amorçage', async () => {
    useProfile(dirA);
    await loadOrSeedLayout(dirA, {}, false, NOW);
    const avant = await fs.readFile(nodePath.join(dirA, 'layout.enc'), 'utf-8');

    // `profile:activate` pose `activeProfileId` AVANT `StorageService.reinitialize` :
    // pendant cette fenêtre, le répertoire visé et la clé ne sont pas du même profil.
    useProfile(dirB);
    const res = await loadOrSeedLayout(dirA, {}, false, NOW);
    expect(res.seeded).toBe(false);
    expect(res.created).toBe(false);
    // Le conteneur d'origine est INTACT : ni mis de côté, ni ré-amorcé.
    expect(await fs.readFile(nodePath.join(dirA, 'layout.enc'), 'utf-8')).toBe(avant);
    expect((await fs.readdir(dirA)).some((f) => f.includes('.unreadable-'))).toBe(false);

    await expect(writeLayoutDocument(dirA, doc({}), NOW)).rejects.toBeInstanceOf(
      LayoutKeyUnavailableError
    );
  });
});

// ── 6. Parité de forme du document écrit ───────────────────────────────────

describe('parité de forme — ce qui est scellé est ce qui est relu', () => {
  it('aller-retour disque : même document, aux champs normalisés près', async () => {
    const source: LayoutDocument = {
      schema: 1,
      views: {
        home: {
          id: 'home',
          slots: [slot('a', { options: { compact: true }, binding: { folderId: 'uuid-1' } })],
          updatedAt: T2,
          templateId: 'tpl-1',
        },
      },
      templates: {
        'tpl-1': {
          id: 'tpl-1',
          name: 'Bureau',
          slots: [{ role: 'stats', type: 'dashboard-stats', x: 0, y: 0, w: 12, h: 2 }],
          updatedAt: T1,
          version: 3,
          author: 'moi',
        },
      },
      seededAt: T1,
    };

    const written = await writeLayoutDocument(dirA, source, NOW);
    const relu = await readLayoutDocument(dirA);

    expect(relu).toEqual(written);
    expect(relu?.views.home.slots[0].binding).toEqual({ folderId: 'uuid-1' });
    expect(relu?.views.home.slots[0].options).toEqual({ compact: true });
    expect(relu?.templates['tpl-1'].version).toBe(3);
    expect(relu?.seededAt).toBe(T1);
    // L'écriture date le CONTENEUR (informatif), jamais les vues.
    expect(relu?.updatedAt).toBe(NOW.iso);
    expect(relu?.views.home.updatedAt).toBe(T2);
  });

  it('un rôle et des options INCONNUS traversent intacts (place de marché)', () => {
    const exotique = normalizeLayoutDocument({
      schema: 1,
      views: {
        home: {
          id: 'home',
          updatedAt: T1,
          slots: [
            {
              id: 'x',
              role: 'role-de-2030',
              type: 'widget-inconnu',
              x: 1,
              y: 2,
              w: 3,
              h: 4,
              options: { k: [1, 2] },
            },
          ],
        },
      },
    });
    expect(exotique.views.home.slots[0].role).toBe('role-de-2030');
    expect(exotique.views.home.slots[0].options).toEqual({ k: [1, 2] });
  });

  it('une forme irrécupérable est écartée, le reste survit', () => {
    const abime = normalizeLayoutDocument({
      views: {
        home: { id: 'home', updatedAt: T1, slots: [{ role: 'recents' }, slot('bon')] },
        casse: 42,
      },
    });
    expect(Object.keys(abime.views)).toEqual(['home']); // `casse` n'est pas un objet
    expect(abime.views.home.slots.map((s) => s.id)).toEqual(['bon']); // le slot sans id part
  });

  it('un conteneur illisible est MIS DE CÔTÉ avant tout ré-amorçage', async () => {
    await fs.writeFile(layoutFilePath(dirA), 'ceci-nest-pas-un-container', 'utf-8');
    const res = await loadOrSeedLayout(dirA, {}, false, NOW);
    expect(res.created).toBe(true);
    const restes = await fs.readdir(dirA);
    expect(restes.some((f) => f.includes('.unreadable-'))).toBe(true);
  });
});

// ── 7. `meta:layout` : jamais d'écrasement, dans aucun sens ─────────────────

const entry = (over: Partial<SyncFileEntry> = {}): SyncFileEntry => ({
  checksum: 'aaa',
  size: 10,
  updatedAt: T1,
  syncedAt: T1,
  chunks: ['chunk_0'],
  status: 'synced',
  ...over,
});

const manifest = (files: Record<string, SyncFileEntry>): SyncManifest => ({
  version: 1,
  profileId: 'p1',
  lastSyncAt: T1,
  files,
  notes: {},
});

describe('manifeste — `meta:layout` est un blob à FUSION', () => {
  const run = (local: SyncFileEntry, remote: SyncFileEntry) =>
    mergeWithRemote(
      manifest({ [LAYOUT_META_FILE_ID]: local }),
      manifest({ [LAYOUT_META_FILE_ID]: remote })
    );

  it('le distant a bougé depuis notre dernière remontée → DESCENTE (fusion), pas conflit', () => {
    const res = run(
      entry({
        checksum: 'local',
        updatedAt: T2,
        syncedAt: T1,
        status: 'pending_upload',
        localPath: 'layout.enc',
      }),
      entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 })
    );
    expect(res.toDownload).toEqual([LAYOUT_META_FILE_ID]);
    expect(res.conflicts).toEqual([]);
    expect(res.toUpload).toEqual([]);
  });

  it('nous sommes strictement en avance → REMONTÉE, sans retélécharger', () => {
    const res = run(
      entry({
        checksum: 'local',
        updatedAt: T3,
        syncedAt: T2,
        status: 'pending_upload',
        localPath: 'layout.enc',
      }),
      // Le distant est NOTRE remontée précédente : il porte l'estampille que
      // nous avons posée (T2) — c'est elle, pas ses horloges, qui dit « à nous ».
      entry({ checksum: 'notre-remontee', updatedAt: T1, syncedAt: T2 })
    );
    expect(res.toUpload).toEqual([LAYOUT_META_FILE_ID]);
    expect(res.toDownload).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('un AUTRE appareil a republié son blob, même vieux → DESCENTE (la boucle du 05/09)', () => {
    const res = run(
      entry({ checksum: 'local', updatedAt: T1, syncedAt: T3, localPath: 'layout.enc' }),
      // Son mtime (T1) est antérieur à notre remontée (T3) — l'ancienne règle
      // concluait « en avance » — mais l'estampille est la sienne (T2).
      entry({ checksum: 'distant', updatedAt: T1, syncedAt: T2 })
    );
    expect(res.toDownload).toEqual([LAYOUT_META_FILE_ID]);
    expect(res.toUpload).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('jamais remonté (syncedAt nul) → descente, JAMAIS un conflit à arbitrer', () => {
    const res = run(
      entry({
        checksum: 'local',
        updatedAt: T3,
        syncedAt: null,
        status: 'pending_upload',
        localPath: 'layout.enc',
      }),
      entry({ checksum: 'distant', updatedAt: T1, syncedAt: T1 })
    );
    expect(res.toDownload).toEqual([LAYOUT_META_FILE_ID]);
    expect(res.conflicts).toEqual([]);
  });

  it('empreintes identiques → rien ne bouge (aucun cycle perpétuel)', () => {
    const res = run(
      entry({ checksum: 'pareil', updatedAt: T3, syncedAt: T1, localPath: 'layout.enc' }),
      entry({ checksum: 'pareil', updatedAt: T2 })
    );
    expect(res.toUpload).toEqual([]);
    expect(res.toDownload).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('un statut `conflict` HÉRITÉ n’immobilise pas l’entrée pour toujours', () => {
    const res = run(
      entry({
        checksum: 'local',
        updatedAt: T2,
        syncedAt: T1,
        status: 'conflict',
        localPath: 'layout.enc',
      }),
      entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 })
    );
    // Sans l'exemption, l'entrée était SAUTÉE : plus aucune fusion, donc plus
    // aucun moyen de sortir du statut.
    expect(res.toDownload).toEqual([LAYOUT_META_FILE_ID]);
  });

  it('présent d’un seul côté → union simple, jamais une suppression', () => {
    const seulLocal = mergeWithRemote(
      manifest({ [LAYOUT_META_FILE_ID]: entry({ localPath: 'layout.enc' }) }),
      manifest({})
    );
    expect(seulLocal.toUpload).toEqual([LAYOUT_META_FILE_ID]);

    const seulDistant = mergeWithRemote(manifest({}), manifest({ [LAYOUT_META_FILE_ID]: entry() }));
    expect(seulDistant.toDownload).toEqual([LAYOUT_META_FILE_ID]);
  });
});

describe('L’ESTAMPILLE NE DÉCLENCHE PAS DE REMONTÉE', () => {
  /*
    LA BOUCLE QUE CECI FERME, MESURÉE LE 2026-09-08.

    `updatedAt` est INFORMATIF, mais il participait à l'égalité qui décide s'il
    faut republier. La fusion garde le plus récent des deux horodatages : le
    poste dont le conteneur est le plus récent trouve donc toujours
    `merged ≠ remote` et pousse. L'autre reçoit, refait la même constatation
    dans l'autre sens, et pousse à son tour.

    Contenu identique, republication sans fin : la version du manifeste montait
    de 24 par minute (12115 → 12298 en sept minutes). Le compare-and-set était
    alors perdu à tous les cycles, et chaque désaccord d'empreinte finissait en
    conflit — avec sa copie sur le disque.
  */
  const doc = (updatedAt: string) => ({
    version: 1 as const,
    views: {},
    updatedAt,
  });

  it('deux estampilles différentes sur un contenu IDENTIQUE ne remontent pas', () => {
    const r = mergeLayoutDocuments(
      doc('2026-09-08T00:10:00.000Z'),
      doc('2026-09-07T22:06:41.477Z'),
      '2026-09-08T00:11:00.000Z',
      Date.parse('2026-09-08T00:11:00.000Z')
    );
    expect(r.changedFromRemote).toBe(false);
  });

  it('la symétrie tient — l’autre poste ne pousse pas non plus', () => {
    // Sans elle, on aurait seulement déplacé la boucle d'un côté.
    const r = mergeLayoutDocuments(
      doc('2026-09-07T22:06:41.477Z'),
      doc('2026-09-08T00:10:00.000Z'),
      '2026-09-08T00:11:00.000Z',
      Date.parse('2026-09-08T00:11:00.000Z')
    );
    expect(r.changedFromRemote).toBe(false);
  });

  it('un contenu RÉELLEMENT différent remonte toujours', () => {
    // La borne de l'autre côté : ne plus rien remonter serait pire que boucler.
    const local = { version: 1 as const, views: { accueil: { blocks: ['a'], clock: 2 } }, updatedAt: 'x' };
    const remote = { version: 1 as const, views: {}, updatedAt: 'x' };
    const r = mergeLayoutDocuments(
      local as never,
      remote as never,
      '2026-09-08T00:11:00.000Z',
      Date.parse('2026-09-08T00:11:00.000Z')
    );
    expect(r.changedFromRemote).toBe(true);
  });
});
