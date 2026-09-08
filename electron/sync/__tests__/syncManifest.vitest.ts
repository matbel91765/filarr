/**
 * `mergeWithRemote` — qui monte, qui descend, qui part en conflit.
 *
 * Le défaut verrouillé ici : un `toDownload` RÉÉCRIT le fichier local en place
 * (syncService.downloadFile). Quand l'entrée locale porte des modifications
 * jamais remontées — `updatedAt > syncedAt`, exactement ce que pose
 * `scanLocalFiles` en marquant `pending_upload` —, cette réécriture détruit la
 * seule copie existante. La règle « conflit » d'origine exigeait que les DEUX
 * côtés aient bougé depuis la synchro d'en face, ce qui est faux dès que le
 * local est simplement en retard d'horloge.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Le module importe `electron` (app.getPath) et `electron-log` au chargement :
// aucun des deux n'existe hors du processus principal. Seule la fonction PURE
// `mergeWithRemote` est testée ici.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }));
vi.mock('electron-log', () => ({
  default: { info: () => undefined, warn: () => undefined, error: () => undefined },
}));

import { mergeWithRemote, type SyncFileEntry, type SyncManifest,
  shouldRepublishManifest,
  renameWithRetry,
  RENAME_RETRY_DELAYS_MS,
} from '../syncManifest';
import { NOTES_META_FILE_ID } from '../notesMergeCore';

const T = (iso: string): string => new Date(iso).toISOString();
const T1 = T('2026-08-01T10:00:00.000Z');
const T2 = T('2026-08-02T10:00:00.000Z');
const T3 = T('2026-08-03T10:00:00.000Z');

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

let local: Record<string, SyncFileEntry>;
let remote: Record<string, SyncFileEntry>;

beforeEach(() => {
  local = {};
  remote = {};
});

const merge = () => mergeWithRemote(manifest(local), manifest(remote));

describe('garde — un local jamais remonté n’est jamais écrasé', () => {
  it('LE DÉFAUT : local en attente de remontée + distant plus récent → conflit, pas descente', () => {
    // Desktop hors ligne : le fichier a été modifié à T2, jamais poussé
    // (syncedAt reste T1). Le nuage a bougé à T3 depuis un autre appareil.
    local.f1 = entry({ checksum: 'local', updatedAt: T2, syncedAt: T1, status: 'pending_upload' });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();

    expect(res.conflicts).toEqual(['f1']);
    expect(res.toDownload).toEqual([]); // ← sans la garde, f1 était ici et écrasait le local
    expect(res.toUpload).toEqual([]);
  });

  it('jamais synchronisé du tout (syncedAt nul) → conflit plutôt que « le distant gagne »', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T2, syncedAt: null, status: 'pending_upload' });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    expect(merge().conflicts).toEqual(['f1']);
  });

  it('deux côtés jamais synchronisés, distant plus récent → conflit (le local existe bel et bien)', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T1, syncedAt: null });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T2, syncedAt: null });

    expect(merge().conflicts).toEqual(['f1']);
  });

  it('local à jour (updatedAt ≤ syncedAt) : la descente reste une descente', () => {
    // Rien d'inédit localement : le fichier local est exactement ce qui a été
    // remonté. Le remplacer par la version distante ne perd rien.
    local.f1 = entry({ checksum: 'local', updatedAt: T1, syncedAt: T2 });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();
    expect(res.toDownload).toEqual(['f1']);
    expect(res.conflicts).toEqual([]);
  });

  it('horodatage local illisible : dans le doute, conflit', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: 'jamais', syncedAt: T1 });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    expect(merge().conflicts).toEqual(['f1']);
  });

  it('un conflit déjà ouvert n’est pas repris à chaque cycle (pas de copies en rafale)', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T2, syncedAt: T1, status: 'conflict' });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();
    expect(res).toEqual({ toUpload: [], toDownload: [], conflicts: [] });
  });
});

describe('comportements préservés', () => {
  it('fichier absent du local → descente (pas de conflit inventé)', () => {
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });
    expect(merge().toDownload).toEqual(['f1']);
  });

  it('fichier absent du distant → remontée', () => {
    local.f1 = entry({ checksum: 'local', status: 'pending_upload', syncedAt: null });
    expect(merge().toUpload).toEqual(['f1']);
  });

  it('même contenu des deux côtés → rien à faire', () => {
    local.f1 = entry({ checksum: 'pareil', updatedAt: T2, syncedAt: T1 });
    remote.f1 = entry({ checksum: 'pareil', updatedAt: T3, syncedAt: T3 });
    expect(merge()).toEqual({ toUpload: [], toDownload: [], conflicts: [] });
  });

  it('seul le local a bougé → remontée', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T3, syncedAt: T2 });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T1, syncedAt: T1 });
    expect(merge().toUpload).toEqual(['f1']);
  });

  it('les deux ont bougé depuis la synchro d’en face → conflit (règle d’origine)', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T3, syncedAt: T1 });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T1 });
    expect(merge().conflicts).toEqual(['f1']);
  });

  it('entrées supprimées ou local_only : toujours ignorées', () => {
    local.supprime = entry({ status: 'deleted' });
    remote.supprime = entry({ checksum: 'distant' });
    local.gros = entry({ checksum: 'local', status: 'local_only', updatedAt: T3, syncedAt: null });
    remote.gros = entry({ checksum: 'distant', updatedAt: T3 });
    remote.efface = entry({ status: 'deleted' });

    expect(merge()).toEqual({ toUpload: [], toDownload: [], conflicts: [] });
  });

  it('empreinte du CLAIR prioritaire quand les deux côtés la portent (fichiers delta)', () => {
    local.f1 = entry({ checksum: 'chiffré-ici', plaintextChecksum: 'clair', updatedAt: T3, syncedAt: T1 });
    remote.f1 = entry({ checksum: 'chiffré-ailleurs', plaintextChecksum: 'clair', updatedAt: T3 });
    expect(merge()).toEqual({ toUpload: [], toDownload: [], conflicts: [] });
  });
});

describe('meta:notes — toujours la fusion, jamais le conflit ni l’écrasement', () => {
  it('local en attente + distant qui a bougé → DESCENTE (chemin de fusion), pas conflit', () => {
    // Le cas mortel du blob de notes : les deux côtés ont écrit des notes
    // différentes. La descente est non destructrice (downloadAndMergeNotes),
    // donc c'est elle qu'il faut, pas une copie de conflit que personne ne relit.
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'local',
      updatedAt: T2,
      syncedAt: T1,
      status: 'pending_upload',
      localPath: 'notes.enc',
    });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();
    expect(res.toDownload).toEqual([NOTES_META_FILE_ID]);
    expect(res.conflicts).toEqual([]);
    expect(res.toUpload).toEqual([]);
  });

  it('distant immobile depuis notre dernière remontée → remontée directe (pas de descente inutile)', () => {
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'local',
      updatedAt: T3,
      syncedAt: T2,
      status: 'pending_upload',
    });
    // « Immobile » = c'est NOTRE remontée précédente qui est là-haut : même
    // estampille `syncedAt` (T2). Ses horloges de modification ne comptent pas.
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'notre-remontee', updatedAt: T1, syncedAt: T2 });

    const res = merge();
    expect(res.toUpload).toEqual([NOTES_META_FILE_ID]);
    expect(res.toDownload).toEqual([]);
  });

  it('jamais remonté depuis cet appareil → descente (fusion) avant toute remontée', () => {
    local[NOTES_META_FILE_ID] = entry({ checksum: 'local', updatedAt: T3, syncedAt: null });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'distant', updatedAt: T1, syncedAt: T1 });

    expect(merge().toDownload).toEqual([NOTES_META_FILE_ID]);
  });

  it('contenu identique → aucun trafic', () => {
    local[NOTES_META_FILE_ID] = entry({ checksum: 'pareil', updatedAt: T3, syncedAt: T1 });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'pareil', updatedAt: T2 });
    expect(merge()).toEqual({ toUpload: [], toDownload: [], conflicts: [] });
  });

  it('LE DÉFAUT : une entrée notes restée en `conflict` REPASSE par la fusion', () => {
    // La garde « un conflit ouvert attend l'arbitrage » vaut pour les fichiers
    // ordinaires. Appliquée aux notes, elle les figeait POUR TOUJOURS : plus
    // aucune fusion, donc plus aucun moyen de quitter le statut `conflict` —
    // les notes ne se synchronisaient plus jamais, dans aucun sens.
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'local',
      updatedAt: T2,
      syncedAt: T1,
      status: 'conflict',
      localPath: 'notes.enc',
    });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();
    expect(res.toDownload).toEqual([NOTES_META_FILE_ID]); // ← la fusion, qui EST la résolution
    expect(res.conflicts).toEqual([]);
  });

  it('entrée notes en `conflict` et distant immobile → remontée (jamais figée non plus)', () => {
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'local',
      updatedAt: T3,
      syncedAt: T2,
      status: 'conflict',
    });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'notre-remontee', updatedAt: T1, syncedAt: T2 });

    expect(merge().toUpload).toEqual([NOTES_META_FILE_ID]);
  });

  it('un fichier ORDINAIRE en conflit reste, lui, en attente d’arbitrage', () => {
    local.f1 = entry({ checksum: 'local', updatedAt: T2, syncedAt: T1, status: 'conflict' });
    remote.f1 = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });
    local[NOTES_META_FILE_ID] = entry({ checksum: 'local', updatedAt: T2, syncedAt: T1, status: 'conflict' });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'distant', updatedAt: T3, syncedAt: T3 });

    const res = merge();
    expect(res.toDownload).toEqual([NOTES_META_FILE_ID]);
    expect(res.toUpload).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });
});

// ── LA BOUCLE DU 05/09/2026 : deux bureaux, deux chiffrés, zéro nouveauté ────
//
// Prod et dev tournaient sur le même profil. Chacun tenait SON `notes.enc`
// (mêmes notes, sel différent, donc empreinte différente) et republiait le
// sien toutes les 20 s : plus de 100 envois, ~720 Mo en une heure. La règle
// jugeait « en avance » quiconque avait remonté APRÈS le mtime du fichier de
// l'autre — vrai des deux côtés à la fois, donc perpétuel. L'identité de
// l'entrée distante (son estampille, ou des octets à nous) tranche ; ses
// horloges non.

describe('meta:notes — qui a écrit l’entrée distante décide, pas ses horloges', () => {
  /** Notre fichier date d'il y a longtemps (T1), notre remontée est récente (T3). */
  const notreEntree = (): SyncFileEntry =>
    entry({
      checksum: 'bureau-A',
      updatedAt: T1,
      syncedAt: T3,
      status: 'synced',
      localPath: 'notes.enc',
    });

  it('LA BOUCLE : l’autre bureau republie SON blob, mtime ancien → DESCENTE, pas remontée aveugle', () => {
    local[NOTES_META_FILE_ID] = notreEntree();
    // Son fichier est vieux (T1 ≤ notre syncedAt T3 : « il n'a pas bougé
    // depuis ma remontée », concluait l'ancienne règle) mais l'estampille est
    // LA SIENNE (T2 ≠ T3) : quelqu'un d'autre a écrit.
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'bureau-B', updatedAt: T1, syncedAt: T2 });

    const res = merge();
    expect(res.toDownload).toEqual([NOTES_META_FILE_ID]);
    expect(res.toUpload).toEqual([]);
    expect(res.conflicts).toEqual([]);
  });

  it('notre remontée qui revient (même estampille), fichier changé depuis → remontée directe', () => {
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'nouveau',
      updatedAt: T3,
      syncedAt: T2,
      status: 'pending_upload',
    });
    remote[NOTES_META_FILE_ID] = entry({
      checksum: 'ce-que-nous-avions-remonte',
      updatedAt: T1,
      syncedAt: T2,
    });

    const res = merge();
    expect(res.toUpload).toEqual([NOTES_META_FILE_ID]);
    expect(res.toDownload).toEqual([]);
  });

  it('l’autre a ADOPTÉ nos octets sous son estampille → toujours « à nous », remontée directe', () => {
    local[NOTES_META_FILE_ID] = entry({
      checksum: 'nouveau',
      updatedAt: T3,
      syncedAt: T1,
      status: 'pending_upload',
    });
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'nos-octets', updatedAt: T2, syncedAt: T2 });

    const res = mergeWithRemote(manifest(local), manifest(remote), {
      isOwnUpload: (fileId, checksum) => fileId === NOTES_META_FILE_ID && checksum === 'nos-octets',
    });
    expect(res.toUpload).toEqual([NOTES_META_FILE_ID]);
    expect(res.toDownload).toEqual([]);
  });

  it('sans estampille distante, on ne suppose rien : descente', () => {
    local[NOTES_META_FILE_ID] = notreEntree();
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'bureau-B', updatedAt: T1, syncedAt: null });

    expect(merge().toDownload).toEqual([NOTES_META_FILE_ID]);
  });

  it('le prédicat ne s’applique qu’au fichier demandé', () => {
    local[NOTES_META_FILE_ID] = notreEntree();
    remote[NOTES_META_FILE_ID] = entry({ checksum: 'bureau-B', updatedAt: T1, syncedAt: T2 });

    const res = mergeWithRemote(manifest(local), manifest(remote), {
      isOwnUpload: (fileId) => fileId === 'autre-fichier',
    });
    expect(res.toDownload).toEqual([NOTES_META_FILE_ID]);
  });
});

// ── `save` : le renommage atomique se heurte à un lecteur concurrent ─────
//
// Windows refuse (EPERM) de renommer PAR-DESSUS un fichier ouvert. Le canal
// instantané annonce notre propre publication ~1 ms après `putManifest` ; le
// cycle déclenché tombe sur « déjà en cours » et rend `getSyncStatus()`, qui
// lit `sync-manifest.json` — pendant que `save` le renomme. 19 cycles sur 50
// perdus le 05/09/2026, chacun suivi d'une remontée en double.

describe('renameWithRetry — une collision de quelques ms n’est pas un échec', () => {
  const erreur = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: operation not permitted`), { code });

  const harnais = (echecs: string[]) => {
    const appels: number[] = [];
    const attentes: number[] = [];
    let i = 0;
    const rename = async (): Promise<void> => {
      appels.push(i);
      const code = echecs[i++];
      if (code) throw erreur(code);
    };
    const sleep = async (ms: number): Promise<void> => {
      attentes.push(ms);
    };
    return { appels, attentes, rename, sleep };
  };

  it('EPERM deux fois puis succès → 3e essai, après 20 puis 40 ms', async () => {
    const h = harnais(['EPERM', 'EPERM']);
    await expect(renameWithRetry('a.tmp', 'a', h)).resolves.toBe(3);
    expect(h.appels).toHaveLength(3);
    expect(h.attentes).toEqual([20, 40]);
  });

  it('du premier coup → 1 essai, aucune attente', async () => {
    const h = harnais([]);
    await expect(renameWithRetry('a.tmp', 'a', h)).resolves.toBe(1);
    expect(h.attentes).toEqual([]);
  });

  it('une autre erreur (ENOENT) remonte IMMÉDIATEMENT, sans réessai', async () => {
    const h = harnais(['ENOENT']);
    await expect(renameWithRetry('a.tmp', 'a', h)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(h.appels).toHaveLength(1);
    expect(h.attentes).toEqual([]);
  });

  it('EPERM persistant → abandon après les délais, l’erreur d’origine remonte', async () => {
    const h = harnais(new Array<string>(RENAME_RETRY_DELAYS_MS.length + 1).fill('EPERM'));
    await expect(renameWithRetry('a.tmp', 'a', h)).rejects.toMatchObject({ code: 'EPERM' });
    expect(h.appels).toHaveLength(RENAME_RETRY_DELAYS_MS.length + 1);
    expect(h.attentes).toEqual([...RENAME_RETRY_DELAYS_MS]);
  });

  it('EACCES et EBUSY sont des collisions aussi ; délais bornés (< 1 s)', async () => {
    const h = harnais(['EACCES', 'EBUSY']);
    await expect(renameWithRetry('a.tmp', 'a', h)).resolves.toBe(3);
    expect(RENAME_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
  });
});

// ── Republication du manifeste : la garde qui empeche une boucle ────────────
//
// Le manifeste etait republie a CHAQUE cycle, meme vide (`lastSyncAt` vaut
// « maintenant » a chaque passage). Sans consequence tant que personne
// n'ecoutait — mais le canal de notification se declenche sur l'avancee de
// cette version. Deux appareils suffisaient alors a fabriquer une boucle
// perpetuelle : A publie, le canal reveille B, B publie, le canal reveille A.

describe('shouldRepublishManifest', () => {
  const files = { 'meta:notes': { checksum: 'c' } } as never;
  const base = {
    uploads: 0,
    downloads: 0,
    conflicts: 0,
    deletions: 0,
    notesPublished: false,
    notesMergeVersion: 1,
    remote: { files, profileMeta: undefined, notesMergeVersion: 1 },
    publishedFiles: files,
    profileMeta: undefined,
  } as never as Parameters<typeof shouldRepublishManifest>[0];

  it('cycle parfaitement vide : NE republie PAS', () => {
    expect(shouldRepublishManifest(base)).toBe(false);
  });

  it('republie des que quelque chose a bouge', () => {
    for (const champ of ['uploads', 'downloads', 'conflicts', 'deletions'] as const) {
      expect(shouldRepublishManifest({ ...base, [champ]: 1 })).toBe(true);
    }
    expect(shouldRepublishManifest({ ...base, notesPublished: true })).toBe(true);
  });

  it('republie quand le nuage n’a pas encore notre marqueur de capacite', () => {
    expect(
      shouldRepublishManifest({
        ...base,
        remote: { ...base.remote, notesMergeVersion: undefined },
      })
    ).toBe(true);
  });

  it('republie quand l’ensemble publie differe de celui du nuage', () => {
    expect(
      shouldRepublishManifest({
        ...base,
        publishedFiles: { autre: { checksum: 'x' } } as never,
      })
    ).toBe(true);
  });

  it('republie quand les metadonnees de profil ont change', () => {
    expect(
      shouldRepublishManifest({ ...base, profileMeta: { name: 'Renomme' } as never })
    ).toBe(true);
  });

  it('LE PIÈGE DU 304 : un talon bâti sur un local SANS notesMergeVersion ni profileMeta republie à chaque cycle', () => {
    // Quand le serveur répond 304, la « vue distante » est le manifeste LOCAL.
    // S'il ne porte pas ce que le nuage porte, la garde conclut « le nuage n'a
    // pas notre marqueur » à chaque passage : 68 publications pour 0
    // « inchangé » le 05/09/2026, chacune réveillant les autres appareils.
    const meta = { name: 'Perso' } as never;
    const talonNu = { files, profileMeta: undefined, notesMergeVersion: undefined };
    expect(
      shouldRepublishManifest({ ...base, remote: talonNu as never, profileMeta: meta })
    ).toBe(true);
    // Le même talon, une fois le local porteur des deux champs : silence.
    const talonFidele = { files, profileMeta: meta, notesMergeVersion: 1 };
    expect(
      shouldRepublishManifest({ ...base, remote: talonFidele as never, profileMeta: meta })
    ).toBe(false);
  });
});
