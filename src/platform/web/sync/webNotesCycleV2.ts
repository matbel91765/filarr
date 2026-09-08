/**
 * LE COFFRE v2 SUR LE WEB — les deux adaptateurs, et le cycle qui les relie.
 *
 * Tout le raisonnement est déjà écrit et éprouvé : `notesVaultStore` range,
 * `notesSyncV2` décide, et les deux sont PURS, avec leurs entrées/sorties
 * injectées. Le web n'a donc rien à réinventer — il n'a qu'à leur fournir un
 * disque et un réseau. C'est tout ce fichier.
 *
 * ═══ LE « DISQUE », ICI, C'EST INDEXEDDB ═══
 *
 *   notes.enc            → clé `notes_enc`      (le blob v1, inchangé)
 *   notes/index.enc      → clé `notes_index`
 *   notes/<objectId>.enc → clé `note_<objectId>`
 *
 * Le chemin relatif que la couche de rangement manipule est traduit en clé de
 * magasin, et rien d'autre ne change : l'ordre d'écriture (les notes, puis
 * l'index), l'atomicité qui en découle, les gardes anti-vidage — tout vient des
 * modules partagés et se comporte à l'identique.
 *
 * ═══ IL MIGRE, ET C'EST NEUF ═══
 *
 * Le web a bien un `notes.enc` — dans IndexedDB, sous `notes_enc`. Il n'y avait
 * donc aucune raison technique de lui refuser la bascule : `migrateToV2` prend
 * un `VaultIO`, et le sien en est un. La vraie raison était une phrase écrite
 * ici (« la bascule est un geste de bureau ») qui décrivait une commodité comme
 * une conception.
 *
 * Conséquence de ce refus : quelqu'un qui n'utilise Filarr QUE dans son
 * navigateur ne pouvait pas atteindre la v2 du tout. Il lui aurait fallu
 * installer l'application de bureau pour ranger des notes qu'il n'y ouvrira
 * jamais.
 *
 * `migrateWebVaultToV2` applique EXACTEMENT le même garde-fou que le bureau :
 * on ne migre pas pendant qu'un autre appareil écrit encore en v1
 * (`decideLegacyVerdict`), et l'ignorance vaut refus.
 */

import { apiFetch, resolveApiBase, ensureAccessToken } from '../webApiBase';
import { storeGet, storePut, storeDelete, getActiveProfileId } from '../webStore';
import { idbKeys } from '../idb';
import { decryptFileContent, encryptFileContent } from '../../../services/auth/hybridCrypto';
import { decryptMachineContainerText } from './containerCrypto';
import {
  decideLegacyVerdict,
  detectFormat,
  loadVaultV1,
  loadVaultV2,
  migrateToV2,
  readNoteObject,
  legacyObservationOf,
  bootstrapEmptyV2,
  reconcileLegacyBlob,
  shouldWriteBackLegacy,
  writeIndex,
  writeNoteObject,
  type LegacyVerdict,
  type VaultFormat,
  type VaultIO,
} from './notesVaultStore';
import {
  indexForCloud,
  legacyVaultDigest,
  normalizeIndex,
  NOTES_DIR,
  type NoteRecord,
  type NotesIndex,
} from './notesStoreV2';
import { syncNotesV2, type LocalVaultView, type NotesTransport } from './notesSyncV2';
import {
  blobPath,
  referencedBlobs,
  selectSweepableBlobs,
  BLOBS_DIR,
  BLOB_SWEEP_GRACE_MS,
  CLOUD_BLOB_SWEEP_GRACE_MS,
  CLOUD_BLOB_SWEEP_MAX_PER_CYCLE,
} from './noteBlobs';
import { inlineFromWebStore } from './webNotesVaultV2';
import { makeSplitDeps } from './webNotesHash';
import { markPendingUpload } from './pendingUploads';
import { NOTES_META_FILE_ID, NOTES_META_RESOURCE_ID } from './notesMerge';
import { NOTES_DIGEST_KEY, notesPlainDigest } from './notesDigest';

/** Une fois par jour au plus : le balayage exige de relire TOUTES les notes. */
const BLOB_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Entrée du manifeste qui porte l'index — miroir exact du bureau. */
export const NOTES_INDEX_FILE_ID = 'meta:notes-index';

/** Clé d'un objet de note dans le nuage — miroir exact du bureau. */
export function noteFileId(objectId: string): string {
  return `note:${objectId}`;
}

// ── Le disque ───────────────────────────────────────────────────────────────

/**
 * Traduit un chemin relatif en clé de magasin.
 *
 * Le préfixe `note_` est INTENTIONNELLEMENT distinct de tout ce qui existe :
 * ces clés cohabitent avec le reste du profil dans le même magasin, et une
 * collision de nom mélangerait des notes avec autre chose.
 */
/**
 * La tranche EXACTE d'un `Uint8Array`, en `ArrayBuffer`.
 *
 * `.buffer` seul rendrait le tampon SOUS-JACENT, qui peut etre plus grand que
 * la vue (un `TextEncoder` reutilise ses tampons) : on chiffrerait alors des
 * octets voisins, et le dechiffrement rendrait du JSON invalide.
 */
function asArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function keyOf(relPath: string): string | null {
  if (relPath === 'notes.enc') return 'notes_enc';
  if (relPath === 'notes/index.enc') return 'notes_index';
  /**
   * ⚠ LES IMAGES MANQUAIENT À CETTE CARTE. `notes/blobs/<empreinte>.enc` rendait
   * `null`, donc `write` JETAIT (« chemin refusé ») — et comme la couche de
   * décision pose les images AVANT la note qui les cite, toute descente d'une
   * note illustrée échouait sur le web. Sans une ligne d'erreur qui le dise :
   * un transfert en échec, retenté au cycle suivant, indéfiniment.
   */
  const b = /^notes\/blobs\/([0-9a-f]{16,64})\.enc$/.exec(relPath);
  if (b) return `blob_${b[1]}`;
  const m = /^notes\/([A-Za-z0-9_-]{1,64})\.enc$/.exec(relPath);
  return m ? `note_${m[1]}` : null;
}

/**
 * Entrées/sorties du coffre sur IndexedDB.
 *
 * UNE LECTURE NE JETTE JAMAIS : absente, illisible, chiffrée avec une autre
 * clé — tout rend `null`. La couche du dessus sait quoi faire d'une absence
 * (`missing`, refus d'écrire) ; elle ne saurait pas quoi faire d'une exception
 * surgie au milieu du chargement de trois cents notes.
 */
export function createWebVaultIO(): VaultIO {
  return {
    async read(relPath: string): Promise<unknown | null> {
      const key = keyOf(relPath);
      if (!key) return null;
      try {
        const enc = await storeGet<Uint8Array>(key);
        if (!enc) return null;
        const plain = await decryptFileContent(new Uint8Array(enc));
        return JSON.parse(new TextDecoder().decode(plain));
      } catch {
        return null;
      }
    },

    async write(relPath: string, plain: unknown): Promise<void> {
      const key = keyOf(relPath);
      if (!key) throw new Error(`webVaultIO: chemin refusé : ${relPath}`);
      const bytes = new TextEncoder().encode(JSON.stringify(plain));
      await storePut(key, await encryptFileContent(asArrayBuffer(bytes)));
    },

    async remove(relPath: string): Promise<void> {
      const key = keyOf(relPath);
      if (!key) return;
      await storeDelete(key).catch(() => {
        /* déjà absent : c'est le résultat voulu */
      });
    },

    async list(relDir: string): Promise<string[]> {
      if (relDir !== 'notes' && relDir !== 'notes/blobs') return [];
      // Les clés du magasin sont préfixées par le profil (`p:<id>:`) : on
      // reconstitue ce préfixe plutôt que d'ajouter une API au magasin pour un
      // seul appelant, dont le seul usage est de repérer des orphelins.
      const pid = await getActiveProfileId();
      if (!pid) return [];
      const prefix = `p:${pid}:`;
      const keys = await idbKeys().catch(() => [] as string[]);
      const out: string[] = [];
      for (const raw of keys) {
        if (!raw.startsWith(prefix)) continue;
        const k = raw.slice(prefix.length);
        if (relDir === 'notes/blobs') {
          if (k.startsWith('blob_')) out.push(`${k.slice(5)}.enc`);
          continue;
        }
        if (k === 'notes_index') out.push('index.enc');
        else if (k.startsWith('note_')) out.push(`${k.slice(5)}.enc`);
      }
      return out;
    },

    /**
     * IndexedDB n'a pas de `stat`. L'empreinte est donc l'EMPREINTE DU CONTENU
     * chiffré — c'est plus cher qu'une taille et une date, mais ça reste très
     * loin d'un déchiffrement, et ça répond à la même question : « ce blob v1
     * a-t-il bougé depuis la dernière réinjection ? »
     */
    async stat(relPath: string): Promise<string | null> {
      const key = keyOf(relPath);
      if (!key) return null;
      const enc = await storeGet<Uint8Array>(key).catch(() => null);
      if (!enc) return null;
      const bytes = new Uint8Array(enc);
      const digest = await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes));
      return `${bytes.byteLength}:${[...new Uint8Array(digest).slice(0, 8)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}`;
    },
  };
}

// ── Le réseau ───────────────────────────────────────────────────────────────

/** Scelle un objet dans le même conteneur que le reste du coffre web. */
async function seal(plain: unknown): Promise<Uint8Array> {
  return encryptFileContent(asArrayBuffer(new TextEncoder().encode(JSON.stringify(plain))));
}

/**
 * La clé MACHINE du profil, celle dont le bureau scelle ses objets. Elle voyage
 * dans le manifeste (`encryptionKey`, base64) — décodée ici, jamais dérivée.
 *
 * `null` = aucun ordinateur n'a encore publié pour ce profil, donc aucun objet
 * de la famille machine ne peut s'y trouver.
 *
 * Import DYNAMIQUE : `readSync` est le gros module de synchronisation, et le
 * charger statiquement d'ici ferait un cycle d'imports. Le même détour que
 * `syncScheduler` prend pour appeler ce fichier.
 */
async function machineKeyOfProfile(): Promise<Uint8Array | null> {
  try {
    const { loadCachedManifest } = await import('./readSync');
    const manifest = await loadCachedManifest();
    const b64 = manifest?.encryptionKey;
    if (!b64) return null;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * Ouvre un conteneur, QUELLE QUE SOIT SA FAMILLE. `null` sur tout ce qui n'est
 * pas exploitable — un objet illisible n'est pas une exception à faire remonter
 * jusqu'au cycle, c'est une réponse : « je n'ai pas ça ».
 *
 * ⚠ DEUX FAMILLES COHABITENT DANS LE MÊME COFFRE, et c'est le nominal :
 *
 *   · le CLIENT WEB scelle sous la FEK (`encryptFileContent`) ;
 *   · l'ORDINATEUR scelle en « v2: » (clé machine, `StorageService.encrypt`).
 *
 * Aucun des deux ne lisait l'autre. Un coffre ouvert des deux côtés voyait donc
 * les objets d'en face comme illisibles, donc comme ABSENTS : la note écrite sur
 * l'ordinateur n'apparaissait jamais dans le navigateur, sans la moindre erreur
 * affichée. Le mobile, lui, lit déjà les deux.
 *
 * ON NE CHANGE PAS CE QU'ON ÉCRIT : `seal` continue de produire du FEK.
 * Rescelller dans l'autre famille rendrait les objets illisibles par les
 * versions déjà installées.
 *
 * L'ORDRE est celui de la fréquence : ce navigateur relit surtout ses propres
 * objets. La famille machine se reconnaît de toute façon à son préfixe texte,
 * donc son échec est immédiat quand ce n'en est pas une.
 */
async function open(bytes: Uint8Array): Promise<unknown | null> {
  if (bytes.byteLength === 0) return null;
  try {
    const plain = await decryptFileContent(bytes);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    // Pas notre famille — on tente celle du bureau.
  }
  try {
    const text = new TextDecoder().decode(bytes);
    if (!text.startsWith('v3:') && !text.startsWith('v2:') && !text.startsWith('v1:')) return null;
    const machineKey = await machineKeyOfProfile();
    if (!machineKey) return null;
    return await decryptMachineContainerText(text, machineKey);
  } catch {
    return null;
  }
}

/**
 * Transport R2 vu du navigateur : jeton présigné, puis octets.
 *
 * AUCUNE MÉTHODE N'AVALE SES ERREURS — `syncNotesV2` compte dessus pour
 * distinguer une descente ratée (sans conséquence) d'une remontée ratée (qui
 * annule la publication). Un transport qui rendrait `null` au lieu de jeter lui
 * ferait prendre l'une pour l'autre.
 */
export function createWebNotesTransport(profileId: string): NotesTransport {
  const download = async (fileId: string): Promise<Uint8Array | null> => {
    const token = await apiFetch<{ data?: { downloadUrl?: string } }>('/sync/presign/download', {
      method: 'POST',
      body: { profileId, fileId, chunkIndex: 0 },
    });
    const url = token.body?.data?.downloadUrl;
    if (!token.body?.success || !url) {
      if (token.status === 404) return null;
      throw new Error(token.body?.error || `presign download HTTP ${token.status}`);
    }
    const access = await ensureAccessToken();
    const res = await fetch(`${resolveApiBase()}${url}`, {
      headers: access ? { Authorization: `Bearer ${access}` } : undefined,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };

  const upload = async (fileId: string, bytes: Uint8Array): Promise<void> => {
    const token = await apiFetch<{ data?: { uploadUrl?: string } }>('/sync/presign/upload', {
      method: 'POST',
      body: { profileId, fileId, chunkIndex: 0, size: bytes.byteLength },
    });
    const url = token.body?.data?.uploadUrl;
    if (!token.body?.success || !url) {
      throw new Error(token.body?.error || `presign upload HTTP ${token.status}`);
    }
    const res = await fetch(`${resolveApiBase()}${url}`, {
      method: 'PUT',
      body: bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    if (!res.ok) throw new Error(`upload HTTP ${res.status}`);
  };

  return {
    async getRemoteIndex(): Promise<NotesIndex | null> {
      const bytes = await download(NOTES_INDEX_FILE_ID);
      // Absent = le nuage n'a pas encore d'index v2. État NORMAL au premier
      // cycle, pas une panne : le cycle publiera le nôtre.
      if (!bytes) return null;
      const plain = await open(bytes);
      return plain === null ? null : normalizeIndex(plain);
    },

    async getNote(objectId: string): Promise<NoteRecord | null> {
      const bytes = await download(noteFileId(objectId));
      if (!bytes) return null;
      const plain = await open(bytes);
      if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return null;
      return plain as NoteRecord;
    },

    async putNote(objectId: string, note: NoteRecord): Promise<void> {
      await upload(noteFileId(objectId), await seal(note));
    },

    // Les images : des objets comme les autres, sous `blob:<empreinte>`.
    // L'empreinte vient d'un contenu de note, donc d'une DONNÉE : on la valide
    // avant d'en faire une clé de requête.
    async getBlob(hash: string): Promise<string | null> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error('empreinte refusée');
      const bytes = await download(`blob:${hash}`);
      if (!bytes) return null;
      const plain = await open(bytes);
      return typeof plain === 'string' ? plain : null;
    },

    async putBlob(hash: string, base64: string): Promise<void> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error('empreinte refusée');
      await upload(`blob:${hash}`, await seal(base64));
    },

    /**
     * LA SEULE MÉTHODE DESTRUCTRICE — jamais appelée par `syncNotesV2`, seulement
     * par le cycle après un balayage complet, sous une pierre tombale qui rend
     * le geste réversible. Une image déjà absente est le résultat voulu.
     */
    async deleteBlob(hash: string): Promise<void> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error('empreinte refusée');
      const res = await apiFetch(`/sync/file/${profileId}/blob:${hash}`, { method: 'DELETE' });
      if (res.status === 404 || res.body?.success) return;
      throw new Error(res.body?.error || `delete HTTP ${res.status}`);
    },

    async putIndex(index: NotesIndex): Promise<void> {
      await upload(NOTES_INDEX_FILE_ID, await seal(index));
    },
  };
}

// ── Le cycle ────────────────────────────────────────────────────────────────

export interface WebNotesCycleResult {
  ran: boolean;
  downloaded: number;
  uploaded: number;
  contentChanged: boolean;
  failures: number;
  published: boolean;
}

const IDLE: WebNotesCycleResult = {
  ran: false,
  downloaded: 0,
  uploaded: 0,
  contentChanged: false,
  failures: 0,
  published: false,
};

/**
 * UN CYCLE DE NOTES v2 DANS LE NAVIGATEUR.
 *
 * Rend `{ ran: false }` tant que ce profil n'est pas en v2 — c'est-à-dire tant
 * qu'aucun ordinateur ne l'a migré. Le coût de ce refus est UNE lecture de clé
 * absente.
 *
 * NE JETTE PAS : un cycle de notes en échec ne doit pas emporter celui des
 * fichiers, qui n'a rien à voir avec ça.
 */
export async function runWebNotesCycleV2(
  profileId: string,
  overrides?: { transport?: NotesTransport; io?: VaultIO }
): Promise<WebNotesCycleResult> {
  const io = overrides?.io ?? createWebVaultIO();

  if ((await detectFormat(io)) !== 'v2') return IDLE;

  const rawIndex = await io.read('notes/index.enc');
  if (rawIndex === null) return IDLE;
  let index: NotesIndex = normalizeIndex(rawIndex);

  // ── Réinjection d'un appareil resté en v1 (même règle que le bureau) ──────
  try {
    const blob = await io.read('notes.enc');
    if (blob && typeof blob === 'object') {
      const byId = (blob as { byId?: Record<string, NoteRecord> }).byId ?? {};
      const legacy = await reconcileLegacyBlob(
        io,
        index,
        await makeSplitDeps(byId),
        index.legacyStamp ?? null
      );
      /**
       * ⚠ `changedFromLocal` AUTANT QUE `toFetch`, comme le bureau. Cette copie
       * ne regardait que `toFetch` : un appareil resté en v1 qui SUPPRIME une
       * note, en purge une, ou change l'ordre, ne donne rien à descendre — mais
       * l'index fusionné diffère du local. Sans cette écriture, le navigateur
       * continuait d'afficher la note supprimée, et ne notait pas l'empreinte du
       * blob : il le relisait donc EN ENTIER à chaque cycle, indéfiniment.
       */
      if (legacy && (legacy.plan.changedFromLocal || legacy.plan.toFetch.length > 0)) {
        for (const noteId of legacy.plan.toFetch) {
          const entry = legacy.plan.merged.notes[noteId];
          const note = legacy.notes[noteId];
          if (entry && note) await writeNoteObject(io, entry.objectId, note);
        }
        index = { ...legacy.plan.merged, legacyStamp: legacy.stamp };
        await writeIndex(io, index);
        console.warn(
          `[webNotes] ${legacy.plan.toFetch.length} note(s) reprise(s) d'un appareil resté en v1`
        );
      } else if (legacy && legacy.stamp !== (index.legacyStamp ?? null)) {
        index = { ...index, legacyStamp: legacy.stamp };
        await writeIndex(io, index);
      }
    }
  } catch (err) {
    console.error('[webNotes] réinjection v1 échouée (non bloquant) :', err);
  }

  const local: LocalVaultView = {
    index,
    readNote: async (noteId) => {
      const entry = index.notes[noteId];
      return entry ? readNoteObject(io, entry.objectId) : null;
    },
    readBlob: async (hash) => {
      const chemin = blobPath(NOTES_DIR, hash);
      if (!chemin) return null;
      const brut = await io.read(chemin);
      return typeof brut === 'string' ? brut : null;
    },
    writeBlob: async (hash, base64) => {
      const chemin = blobPath(NOTES_DIR, hash);
      if (!chemin) throw new Error('empreinte refusée');
      await io.write(chemin, base64);
    },
  };

  const transport = overrides?.transport ?? createWebNotesTransport(profileId);

  let result;
  try {
    result = await syncNotesV2(local, transport);
  } catch (err) {
    console.error('[webNotes] cycle v2 abandonné :', err);
    return { ...IDLE, ran: true, failures: 1 };
  }

  // Les notes descendues, PUIS l'index — même ordre, même raison.
  const posees: string[] = [];
  for (const [noteId, note] of Object.entries(result.fetched)) {
    const entry = result.localIndex.notes[noteId];
    if (!entry) continue;
    try {
      await writeNoteObject(io, entry.objectId, note);
      posees.push(noteId);
    } catch {
      const mine = index.notes[noteId];
      if (mine) result.localIndex.notes[noteId] = mine;
      else delete result.localIndex.notes[noteId];
    }
  }

  /**
   * LES NOTES DONT LA CLÉ D'OBJET A CHANGÉ — même règle que le bureau, et même
   * raison : sans ce déplacement, l'index cite une clé que ce navigateur n'a
   * pas, le contenu dort sous l'ancienne, et la note disparaît sans erreur.
   * Si le déplacement échoue, on retire l'entrée : le cycle suivant la
   * redemandera au nuage plutôt que de promettre un objet absent.
   */
  for (const { noteId, from, to } of result.plan.rekeyed) {
    if (result.fetched[noteId]) continue;
    try {
      if ((await readNoteObject(io, to)) !== null) continue;
      const contenu = await readNoteObject(io, from);
      if (contenu === null) {
        delete result.localIndex.notes[noteId];
        continue;
      }
      await writeNoteObject(io, to, contenu);
      await io.remove(`${NOTES_DIR}/${from}.enc`);
    } catch {
      delete result.localIndex.notes[noteId];
    }
  }

  if (result.changedLocal) {
    try {
      await writeIndex(io, result.localIndex);
    } catch (err) {
      console.error('[webNotes] index local non écrit :', err);
      return { ...IDLE, ran: true, failures: result.failures.length + 1 };
    }
  }

  /**
   * ── MÉNAGE DES IMAGES : MAGASIN ET NUAGE — même règle que le bureau ──────
   *
   * Le web n'avait AUCUN balayage : une image supprimée avec sa note restait
   * dans IndexedDB et dans R2 pour toujours. Mêmes gardes qu'au bureau — toutes
   * les notes lues, aucun transfert en échec, délai de grâce, âge inconnu
   * protégé — et pour le nuage, la pierre est publiée AVANT la suppression.
   */
  const dernier = result.localIndex.blobSweepAt ?? null;
  const dueMs = dernier ? Date.parse(dernier) : NaN;
  const aBalayer =
    result.failures.length === 0 &&
    (!Number.isFinite(dueMs) || Date.now() - dueMs > BLOB_SWEEP_INTERVAL_MS);

  if (aBalayer) {
    try {
      const fichiers = await io.list(`${NOTES_DIR}/${BLOBS_DIR}`);
      const present = fichiers.filter((f) => f.endsWith('.enc')).map((f) => f.slice(0, -4));

      const referenced = new Set<string>();
      let lues = 0;
      for (const entry of Object.values(result.localIndex.notes)) {
        const note = await readNoteObject(io, entry.objectId);
        if (!note) continue;
        referencedBlobs(note, referenced);
        lues++;
      }
      const registre = result.localIndex.blobs ?? {};
      const age = (hash: string): number | null => {
        const ms = Date.parse(registre[hash] ?? '');
        return Number.isFinite(ms) ? Date.now() - ms : null;
      };
      const expectedNotes = Object.keys(result.localIndex.notes).length;

      const local = selectSweepableBlobs({
        present,
        referenced,
        scannedNotes: lues,
        expectedNotes,
        ageMs: age,
        graceMs: BLOB_SWEEP_GRACE_MS,
      });
      for (const hash of local) {
        const chemin = blobPath(NOTES_DIR, hash);
        if (chemin) await io.remove(chemin);
      }

      const auNuage = selectSweepableBlobs({
        present: Object.keys(registre),
        referenced,
        scannedNotes: lues,
        expectedNotes,
        ageMs: age,
        graceMs: CLOUD_BLOB_SWEEP_GRACE_MS,
      }).slice(0, CLOUD_BLOB_SWEEP_MAX_PER_CYCLE);
      if (auNuage.length > 0) {
        const quand = new Date().toISOString();
        const reste: Record<string, string> = { ...registre };
        const pierres: Record<string, string> = { ...(result.localIndex.blobTombstones ?? {}) };
        for (const hash of auNuage) {
          delete reste[hash];
          pierres[hash] = quand;
        }
        result.localIndex = { ...result.localIndex, blobs: reste, blobTombstones: pierres };
        await transport.putIndex(indexForCloud(result.localIndex));
        await writeIndex(io, result.localIndex);
        for (const hash of auNuage) await transport.deleteBlob(hash);
        console.info(`[webNotes] ${auNuage.length} image(s) orpheline(s) retirée(s) du nuage`);
      }

      result.localIndex = { ...result.localIndex, blobSweepAt: new Date().toISOString() };
      await writeIndex(io, result.localIndex);
      if (local.length > 0) {
        console.info(`[webNotes] ${local.length} image(s) orpheline(s) retirée(s) du magasin`);
      }
    } catch (err) {
      console.warn('[webNotes] ménage des images ignoré :', err);
    }
  }

  /**
   * ── RÉÉCRITURE DU BLOB v1 — même règle que le bureau ─────────────────────
   *
   * Tant que le web ÉCRIVAIT en v1, `notes_enc` restait à jour tout seul et
   * cette réécriture n'avait pas lieu d'être. Maintenant qu'une sauvegarde v2
   * n'écrit que des objets, un appareil resté en v1 — et le PROPRE `notes:load`
   * de cet onglet, tant qu'il lit `notes_enc` — ne verrait plus rien de neuf.
   *
   * Mêmes refus qu'au bureau (pas de blob, note illisible, index vide, rien
   * n'a changé), et deux gestes de plus, propres au web : l'empreinte du clair
   * suit l'écriture (sinon le renderer qui recharge puis ré-enregistre cette
   * même fusion passerait pour un modificateur), et `meta:notes` est mis en
   * attente de remontée, pour que le cycle de fichiers ordinaire le porte.
   *
   * L'empreinte d'index est une MÉMOIRE D'APPAREIL, jamais publiée : elle n'a
   * pas à valoir celle du bureau, seulement à être stable ici.
   */
  try {
    const present = io.stat ? (await io.stat('notes.enc')) !== null : false;
    const empreinte = legacyVaultDigest(result.localIndex, (v) => JSON.stringify(v));
    const noteCount = Object.keys(result.localIndex.notes).length;
    if (
      shouldWriteBackLegacy({
        blobPresent: present,
        digest: empreinte,
        lastDigest: result.localIndex.legacyDigest,
        missing: 0,
        noteCount,
      })
    ) {
      const charge = await loadVaultV2(io);
      if (
        charge &&
        shouldWriteBackLegacy({
          blobPresent: true,
          digest: empreinte,
          lastDigest: result.localIndex.legacyDigest,
          missing: charge.missing.length,
          noteCount,
        })
      ) {
        const { payload } = await inlineFromWebStore(io, charge.payload);
        await io.write('notes.enc', payload);
        const clair = new TextEncoder().encode(JSON.stringify(payload));
        await storePut(NOTES_DIGEST_KEY, await notesPlainDigest(clair));
        const stamp = io.stat ? await io.stat('notes.enc') : null;
        result.localIndex = { ...result.localIndex, legacyDigest: empreinte, legacyStamp: stamp };
        await writeIndex(io, result.localIndex);
        await markPendingUpload(NOTES_META_FILE_ID, {
          kind: 'meta',
          folderId: NOTES_META_RESOURCE_ID,
          // Le pont, pas une écriture v1 : le manifeste le dira (voir readSync).
          legacyWriteBack: true,
        }).catch(() => {});
        console.info(`[webNotes] blob v1 réécrit (${noteCount} note(s))`);
      }
    }
  } catch (err) {
    console.warn('[webNotes] réécriture du blob v1 ignorée :', err);
  }

  return {
    ran: true,
    downloaded: posees.length,
    uploaded: result.uploaded.length,
    contentChanged: posees.length > 0,
    failures: result.failures.length,
    published: result.published,
  };
}

// ── La bascule v1 → v2, depuis le navigateur ────────────────────────────────

/**
 * PEUT-ON MIGRER, VU DU NAVIGATEUR ?
 *
 * Exactement la règle du bureau (`legacyNotesVerdict`), appliquée à la même
 * observation : la date de dernière écriture de `meta:notes` DANS LE MANIFESTE
 * DISTANT. Trois réponses, une seule autorise.
 *
 * ⚠ AUCUN MANIFESTE EN CACHE VAUT `unknown`, DONC REFUS. C'est l'état au
 * démarrage d'un onglet : on ne sait pas encore ce que le nuage porte, et migrer
 * sans le savoir est précisément le geste qu'on ne veut pas. Un onglet tout
 * juste ouvert doit donc attendre son premier cycle — le bouton le dit.
 *
 * `manifest` est injectable pour que la règle s'éprouve sans réseau.
 */
export function webLegacyNotesVerdict(
  manifest: {
    files?: Record<
      string,
      { status?: string; updatedAt?: string; legacyWriteBack?: boolean } | undefined
    >;
  } | null,
  nowMs: number = Date.now()
): LegacyVerdict {
  if (!manifest) return decideLegacyVerdict(undefined, nowMs);
  // Un blob réécrit par un appareil v2 ne compte pas comme un écrivain v1.
  return decideLegacyVerdict(legacyObservationOf(manifest.files?.[NOTES_META_FILE_ID]), nowMs);
}

/** Le format que porte ce profil dans le navigateur, sans rien charger de gros. */
export async function webVaultFormat(io: VaultIO = createWebVaultIO()): Promise<VaultFormat> {
  return detectFormat(io);
}

/**
 * MIGRE LE COFFRE DU NAVIGATEUR VERS LA v2.
 *
 * Miroir de `migrateNow` côté bureau, au mot près sur les refus — c'est la
 * même décision, elle doit se prendre pareil.
 *
 * ═══ POURQUOI LE COFFRE EST CHARGÉ AVANT LA MIGRATION ═══
 *
 * `SplitDeps.digestOf` est SYNCHRONE (le bureau a `node:crypto`), alors que
 * `crypto.subtle` ne l'est pas. Les empreintes se pré-calculent donc, et pour
 * les pré-calculer il faut connaître les notes. `migrateToV2` relit ensuite le
 * blob lui-même : un déchiffrement de plus, une seule fois, sur un geste que
 * quelqu'un vient de demander — c'est le bon endroit pour payer ça.
 *
 * `notes.enc` N'EST PAS SUPPRIMÉ : il reste le chemin de retour, et ce que lit
 * un appareil resté en v1.
 */
export async function migrateWebVaultToV2(
  legacy: LegacyVerdict,
  io: VaultIO = createWebVaultIO(),
  opts: { acknowledgeLegacyWriter?: boolean } = {}
): Promise<{ ok: boolean; why?: string; noteCount?: number }> {
  // Meme regle que le bureau (notesVaultFacade.migrateNow) : ne jamais bouger
  // sans avoir vu le nuage ; un ecrivain v1 actif se franchit en connaissance
  // de cause, le pont continue de le servir.
  if (legacy === 'unknown') return { ok: false, why: 'cloud-not-seen' };
  if (legacy === 'legacy-active' && !opts.acknowledgeLegacyWriter) {
    return { ok: false, why: 'legacy-active' };
  }
  const format = await detectFormat(io);
  if (format === 'v2') return { ok: false, why: 'already-v2' };
  if (format === 'none') {
    // Rien à déplacer : on pose l'index vide, le profil est en v2.
    await bootstrapEmptyV2(io);
    return { ok: true, noteCount: 0 };
  }

  const payload = await loadVaultV1(io);
  if (!payload) return { ok: false, why: 'no-notes' };
  const byId = (payload.byId ?? {}) as Record<string, NoteRecord>;

  const res = await migrateToV2(io, await makeSplitDeps(byId));
  if (!res.ok) return { ok: false, why: res.why };
  console.warn(
    `[webNotes] MIGRÉ en v2 — ${res.noteCount} note(s). notes_enc est conservé tel quel.`
  );
  return { ok: true, noteCount: res.noteCount };
}
