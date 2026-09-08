/**
 * Handlers web des canaux métadonnées (dossiers, notes, corbeille) — le miroir
 * IndexedDB du StorageService desktop, palier M2.
 *
 * Modèle : local-first, comme le desktop. Les dossiers sont stockés en clair
 * structurel dans IndexedDB (mêmes objets `Folder` que le renderer manipule) ;
 * les NOTES — le contenu sensible — sont chiffrées avec la FEK via le pipeline
 * de production `encryptFileContent`/`decryptFileContent` (hybridCrypto) avant
 * d'entrer dans IndexedDB, comme `notes.enc` sur le disque desktop. La synchro
 * avec le manifeste cloud chiffré est le chantier M3 : ce store en sera la
 * face locale.
 */

import { decryptFileContent, encryptFileContent } from '../../../services/auth/hybridCrypto';
import { storeGet, storePut, getActiveProfileId } from '../webStore';
import { emitWebEvent } from '../webEventBus';
import { markPendingUpload } from '../sync/pendingUploads';
import { withNotesLock } from '../sync/notesLock';
import {
  applyNotesDelta,
  isEmptyNotesVault,
  isUsableNotesBase,
  isWellFormedNotesDelta,
  selectStaleDeltaEntries,
  type NotesVaultPayload,
} from '../sync/notesDelta';
import { createWebVaultIO } from '../sync/webNotesCycleV2';
import { bootstrapEmptyV2 } from '../sync/notesVaultStore';
import { loadWebVaultV2, saveWebVaultV2 } from '../sync/webNotesVaultV2';
import type { NotesIndex } from '../sync/notesStoreV2';
import { NOTES_DIGEST_KEY, notesPlainDigest } from '../sync/notesDigest';
import { isNotesPushAllowed } from '../sync/readSync';
import { NOTES_META_FILE_ID, NOTES_META_RESOURCE_ID } from '../sync/notesMerge';
import { layoutHandlers } from './layoutHandlers';
import { purgeFolderPermanently } from './webFileHandlers';

interface WebItem extends Record<string, unknown> {
  id?: string;
  name?: string;
  color?: string;
  deletedAt?: string;
}

interface WebFolder {
  id: string;
  name: string;
  items?: WebItem[];
  parentId?: string | null;
  color?: string;
  deletedAt?: string;
  updatedAt?: string;
  __unreadable?: boolean;
  [key: string]: unknown;
}

const FOLDERS_KEY = 'folders';
const NOTES_KEY = 'notes_enc';

/**
 * LE COFFRE v2 EN MÉMOIRE — miroir de `notesV2State` côté bureau.
 *
 * L'index et le clair voyagent ENSEMBLE, dans le même objet, pour ne jamais se
 * désaccorder : appliquer un delta sur un clair qui ne correspond plus à l'index
 * écrirait un coffre qui ment. `null` = ce profil n'est pas en v2 (ou on n'a pas
 * su le lire) : les handlers retombent alors sur `notes_enc`, littéralement le
 * code d'avant.
 *
 * Validé contre le profil ACTIF à chaque usage : le web n'a pas d'événement de
 * verrouillage, et un changement de profil ne doit pas faire écrire le coffre
 * de l'un sous l'index de l'autre.
 */
let webV2State: {
  profileId: string;
  index: NotesIndex;
  payload: NotesVaultPayload;
  /** Notes que l'index cite mais qu'on n'a pas su relire — bloque l'écriture. */
  missing: string[];
} | null = null;

async function webV2ForActiveProfile(): Promise<typeof webV2State> {
  if (!webV2State) return null;
  const pid = await getActiveProfileId();
  if (!pid || pid !== webV2State.profileId) {
    webV2State = null;
    return null;
  }
  return webV2State;
}

/**
 * Réveille la synchronisation après une écriture v2. Le planificateur écoute
 * `web:pending-marked` et n'a besoin d'aucune charge : on émet le signal SANS
 * poser d'entrée au registre des remontées — une entrée que rien n'acquitte y
 * resterait pour la session entière (badge « non synchronisé » permanent). Les
 * objets v2, eux, partent par le cycle des notes, pas par ce registre.
 */
function reveillerLaSync(): void {
  emitWebEvent('web:pending-marked');
}

async function loadFolders(): Promise<Record<string, WebFolder>> {
  return (await storeGet<Record<string, WebFolder>>(FOLDERS_KEY)) ?? {};
}

async function saveFolders(folders: Record<string, WebFolder>): Promise<void> {
  await storePut(FOLDERS_KEY, folders);
  emitWebEvent('folders-updated');
}

/** Marque un dossier modifié pour la remontée cloud (meta:{folderId}). */
async function markFolderDirty(folderId: string): Promise<void> {
  await markPendingUpload(`meta:${folderId}`, { kind: 'meta', folderId }).catch(() => {});
}

/**
 * Vue de lecture d'un dossier — les DEUX transformations de
 * StorageService.getFolder (storageService.ts:1689-1703) : items en corbeille
 * masqués, couleur du dossier héritée par ses items. Sans elles, un fichier
 * supprimé sur le desktop redevenait visible côté web (sa méta arrive du nuage
 * avec `deletedAt`) et les items perdaient leur couleur.
 */
function folderView(folder: WebFolder, includeDeleted = false): WebFolder {
  const items = folder.items ?? [];
  const visible = includeDeleted ? items : items.filter((item) => !item?.deletedAt);
  return {
    ...folder,
    items: visible.map((item) => ({ ...item, color: item?.color || folder.color })),
  };
}

/** Corbeille : bascule `deletedAt` et laisse TOUT en place (blobs compris). */
async function softDeleteFolder(id: string): Promise<void> {
  const folders = await loadFolders();
  const folder = folders[id];
  if (!folder) return;
  const now = new Date().toISOString();
  folder.deletedAt = now;
  folder.updatedAt = now;
  await saveFolders(folders);
  await markFolderDirty(id);
}

interface NotesData {
  byId: Record<string, unknown>;
  allIds: string[];
  templates: unknown[];
  skipVersioning?: boolean;
  /** Carnets et tout champ ajouté plus tard au store notes — voir notes:save */
  [key: string]: unknown;
}

export const webStorageHandlers: Record<string, (...args: unknown[]) => unknown> = {
  // ── Dossiers ──────────────────────────────────────────────────────────────
  saveFolder: async (folderArg: unknown) => {
    const folder = folderArg as WebFolder;
    // Même garde anti-perte que le desktop (storageService.ts:1506-1514) : un
    // dossier marqué illisible ne doit jamais être réécrit.
    if (folder.__unreadable) {
      throw new Error('Refus de réécrire un dossier marqué illisible (__unreadable)');
    }
    const folders = await loadFolders();
    // `getFolder` masque les items en corbeille (comme le desktop) : un
    // appelant qui relit → modifie → sauve les effacerait. On les remet, ils ne
    // partent que par la suppression définitive.
    const kept = (folders[folder.id]?.items ?? []).filter((item) => item?.deletedAt);
    const incoming = folder.items ?? [];
    const missing = kept.filter((item) => !incoming.some((i) => i?.id === item.id));
    folders[folder.id] =
      missing.length > 0 ? { ...folder, items: [...incoming, ...missing] } : folder;
    await saveFolders(folders);
    await markFolderDirty(folder.id);
    return folder;
  },

  getFolders: async () => {
    const folders = await loadFolders();
    return Object.values(folders)
      .filter((f) => !f.deletedAt)
      .map((f) => folderView(f));
  },

  getFolder: async (id: unknown) => {
    const folders = await loadFolders();
    const folder = folders[String(id)];
    if (!folder) throw new Error(`Folder ${String(id)} not found`);
    return folderView(folder);
  },

  getFolderItems: async (folderId: unknown) => {
    const folders = await loadFolders();
    const folder = folders[String(folderId)];
    return folder ? folderView(folder).items : [];
  },

  // Corbeille, comme StorageService.deleteFolder(id) : suppression DOUCE.
  // L'ancien chemin détruisait tout (entrée locale + bascule 'deleted' de la
  // méta ET de chaque fichier dans le manifeste), donc irréversiblement et sur
  // tous les appareils — là où le desktop se contente de la corbeille.
  deleteFolder: async (id: unknown) => {
    await softDeleteFolder(String(id));
    return true;
  },

  // Canal réellement appelé par le renderer (storageAdapter.deleteFolder) :
  // douce par défaut, purge complète si `permanent`.
  'storage:deleteFolder': async (id: unknown, permanent: unknown = false) => {
    if (permanent) await purgeFolderPermanently(String(id));
    else await softDeleteFolder(String(id));
    return true;
  },

  // ── Notes — chiffrées FEK avant IndexedDB ────────────────────────────────
  'notes:save': async (notesDataArg: unknown) => {
    const notesData = notesDataArg as NotesData;
    /** Le clair a-t-il RÉELLEMENT changé ? (voir plus bas, et notesDigest) */
    let changed = true;
    // Garde anti-vidage ET écriture sous le VERROU du store : entre la lecture
    // de garde et l'écriture, le cycle de sync peut écrire sa fusion — elle
    // serait alors écrasée par cette sauvegarde (et réciproquement).
    /** Écrit en v2 (pas de `notes_enc` touché) : la remontée passe par le cycle. */
    let ecritEnV2 = false;
    const guarded = await withNotesLock(async () => {
      // Même garde critique que le desktop (main.ts:6332-6348), y compris son
      // critère de vacuité (ni allIds ni byId). `skipVersioning` ne la
      // court-circuite JAMAIS côté desktop : un import bulk qui échoue et rend
      // zéro note ne doit pas vider le store ici non plus.
      const incomingIsEmpty =
        !notesData?.allIds?.length && Object.keys(notesData?.byId ?? {}).length === 0;

      /**
       * CHEMIN v2 — sortie anticipée, sous le même verrou que la v1.
       *
       * C'est TOUT le gain de la v2 sur le web : jusqu'ici chaque sauvegarde
       * réécrivait `notes_enc` en entier — dix mégaoctets sur un coffre illustré
       * — et le poussait sous `meta:notes`. Ici, seules les notes dont
       * l'empreinte a bougé sont réécrites, et les images en sont sorties.
       *
       * `notes_enc` n'est PAS touché : c'est le cycle qui le réécrit, quand le
       * contenu a changé, pour les appareils restés en v1 — et pour le propre
       * `notes:load` de cet onglet tant qu'il retombe dessus.
       */
      const v2 = await webV2ForActiveProfile();
      if (v2) {
        if (incomingIsEmpty && Object.keys(v2.payload.byId ?? {}).length > 0) {
          console.warn('[notes:save][web] écriture vide refusée (v2) — coffre non vide préservé');
          return true;
        }
        const io = createWebVaultIO();
        try {
          const res = await saveWebVaultV2(
            io,
            notesData as NotesVaultPayload,
            v2.index,
            v2.missing
          );
          webV2State = {
            profileId: v2.profileId,
            index: res.index,
            payload: notesData as NotesVaultPayload,
            missing: [],
          };
          ecritEnV2 = true;
          changed = res.written.length > 0;
          return false;
        } catch (err) {
          // On n'écrit RIEN plutôt qu'à moitié : l'index n'a pas bougé, et le
          // prochain chargement repartira du disque.
          webV2State = null;
          throw err;
        }
      }

      if (incomingIsEmpty) {
        const existing = await storeGet<Uint8Array>(NOTES_KEY);
        if (existing) {
          const prev = JSON.parse(
            new TextDecoder().decode(await decryptFileContent(new Uint8Array(existing)))
          ) as NotesData;
          if (prev?.byId && Object.keys(prev.byId).length > 0) {
            console.warn('[notes:save][web] écriture vide refusée — store non vide préservé');
            return true;
          }
        }
      }
      // Persister le payload EXACTEMENT tel que reçu — miroir STRICT du desktop,
      // qui écrit `notesData` entier (`encryptToFile(notesData)`), `skipVersioning`
      // compris. Toute divergence de forme, fût-ce un champ retiré, fait voir à
      // chaque côté une différence que l'autre ne voit pas : la fusion trouve du
      // « neuf » à chaque cycle et les deux appareils se renvoient le store
      // indéfiniment (ping-pong perpétuel).
      const plainBytes = new TextEncoder().encode(JSON.stringify(notesData));
      // ALLER-RETOUR IDENTIQUE ≠ MODIFICATION. Le rejeu de `notes-updated` chez
      // un onglet SUIVEUR lui fait recharger le store depuis le disque puis le
      // ré-enregistrer tel quel : marquer une remontée là-dessus, c'est faire
      // pousser (et réveiller les autres onglets) depuis un onglet qui n'a rien
      // écrit. On compare les EMPREINTES du clair — pas de déchiffrement du
      // blob stocké, juste un hachage de ce qu'on s'apprêtait déjà à sérialiser.
      const digest = await notesPlainDigest(plainBytes);
      changed = (await storeGet<string>(NOTES_DIGEST_KEY)) !== digest;
      const plain = plainBytes.buffer.slice(
        plainBytes.byteOffset,
        plainBytes.byteOffset + plainBytes.byteLength
      ) as ArrayBuffer;
      const encrypted = await encryptFileContent(plain);
      await storePut(NOTES_KEY, encrypted);
      await storePut(NOTES_DIGEST_KEY, digest);
      return false;
    });
    if (guarded) return { success: false, guarded: true };
    if (ecritEnV2) {
      if (changed) reveillerLaSync();
      return { success: true };
    }
    // Sans cette marque, TOUT ce qui s'écrit sur le web reste dans le
    // navigateur : `meta:notes` n'était jamais mis en attente de remontée.
    // Le cycle de sync fusionne le distant AVANT de pousser (readSync), donc
    // marquer ici ne peut pas écraser les notes d'un autre appareil.
    //
    // Mais on ne marque PAS ce que la remontée refusera : tant qu'aucun desktop
    // à jour ne sert ce profil, la garde d'activation retient `meta:notes` sans
    // jamais l'acquitter — l'entrée resterait au registre pour la session
    // entière (badge « non synchronisé » et avertissement de fermeture d'onglet
    // permanents). Quand la capacité apparaît, le cycle repose la marque
    // lui-même : soit par la fusion (`changedFromRemote`), soit par son repli
    // « nuage sans entrée notes ».
    //
    // Ni ce qui n'a pas bougé : une remontée n'a de sens que s'il y a quelque
    // chose à remonter.
    if (changed && (await isNotesPushAllowed())) {
      await markPendingUpload(NOTES_META_FILE_ID, {
        kind: 'meta',
        folderId: NOTES_META_RESOURCE_ID,
      }).catch(() => {});
    }
    return { success: true };
  },

  /**
   * MIROIR WEB DE LA SAUVEGARDE INCRÉMENTALE (voir le handler desktop dans
   * main.ts et la logique pure dans `sync/notesDelta.ts`).
   *
   * Le web n'a pas de cache mémoire du coffre : il relit et déchiffre la base à
   * chaque delta. Ce n'est pas une optimisation de lecture — c'est le TRANSPORT
   * qui compte ici aussi (le renderer ne sérialise plus le coffre entier vers le
   * dispatcher), et la relecture reste locale, sans pont ni processus tiers.
   *
   * Comme sur le desktop : base absente ou illisible → `needsFull`, jamais une
   * écriture partielle ; garde anti-vidage sur le RÉSULTAT ; verrou partagé avec
   * la fusion du cycle de sync ; marquage de remontée seulement si le clair a
   * réellement changé.
   */
  'notes:saveDelta': async (deltaArg: unknown) => {
    if (!isWellFormedNotesDelta(deltaArg)) return { ok: false, needsFull: true };
    const delta = deltaArg;
    let changed = true;
    let stale: string[] = [];
    let ecritEnV2 = false;
    const verdict = await withNotesLock(async (): Promise<'needs-full' | 'refused' | 'written'> => {
      /**
       * CHEMIN v2 — la base n'est PAS relue du magasin : c'est le clair tenu en
       * mémoire, à jour par le chargement et par chaque écriture, et l'index
       * voyage avec lui. La garde de concurrence optimiste s'applique exactement
       * comme en v1 : une copie périmée du renderer ne passe pas.
       */
      const v2 = await webV2ForActiveProfile();
      if (v2) {
        const base = v2.payload;
        stale = selectStaleDeltaEntries(base, delta);
        const next: NotesVaultPayload = applyNotesDelta(base, delta);
        if (isEmptyNotesVault(next) && Object.keys(base.byId).length > 0) {
          console.warn(
            '[notes:saveDelta][web] écriture vide refusée (v2) — coffre non vide préservé'
          );
          return 'refused';
        }
        const io = createWebVaultIO();
        try {
          const res = await saveWebVaultV2(io, next, v2.index, v2.missing);
          webV2State = { profileId: v2.profileId, index: res.index, payload: next, missing: [] };
          ecritEnV2 = true;
          changed = res.written.length > 0;
          return 'written';
        } catch (err) {
          webV2State = null;
          throw err;
        }
      }

      const existing = await storeGet<Uint8Array>(NOTES_KEY);
      if (!existing) return 'needs-full';
      let base: unknown;
      try {
        base = JSON.parse(
          new TextDecoder().decode(await decryptFileContent(new Uint8Array(existing)))
        );
      } catch {
        return 'needs-full';
      }
      if (!isUsableNotesBase(base)) return 'needs-full';

      const next: NotesVaultPayload = applyNotesDelta(base, delta);
      if (isEmptyNotesVault(next) && Object.keys(base.byId).length > 0) {
        console.warn('[notes:saveDelta][web] écriture vide refusée — store non vide préservé');
        return 'refused';
      }

      const plainBytes = new TextEncoder().encode(JSON.stringify(next));
      const digest = await notesPlainDigest(plainBytes);
      changed = (await storeGet<string>(NOTES_DIGEST_KEY)) !== digest;
      const plain = plainBytes.buffer.slice(
        plainBytes.byteOffset,
        plainBytes.byteOffset + plainBytes.byteLength
      ) as ArrayBuffer;
      await storePut(NOTES_KEY, await encryptFileContent(plain));
      await storePut(NOTES_DIGEST_KEY, digest);
      return 'written';
    });
    if (verdict === 'needs-full') return { ok: false, needsFull: true };
    if (verdict === 'refused') return { ok: false, needsFull: false };
    if (ecritEnV2) {
      /**
       * Des entrées PÉRIMÉES ont été écartées : le renderer est parti d'une
       * version que le magasin a dépassée (la fusion vient de descendre). On le
       * lui dit — c'est un arbitrage assumé, pas une destruction silencieuse.
       */
      if (stale.length > 0) {
        console.warn(
          `[notes:saveDelta][web] ${stale.length} note(s) refusée(s) — le magasin était plus frais`
        );
        emitWebEvent('notes-updated');
      }
      if (changed) reveillerLaSync();
      return { ok: true };
    }
    // Même marquage de remontée que `notes:save` — mêmes conditions, même raison.
    if (changed && (await isNotesPushAllowed())) {
      await markPendingUpload(NOTES_META_FILE_ID, {
        kind: 'meta',
        folderId: NOTES_META_RESOURCE_ID,
      }).catch(() => {});
    }
    return { ok: true };
  },

  'notes:load': async () => {
    /**
     * CHEMIN v2 — en tête, en sortie anticipée : le code v1 qui suit est
     * littéralement celui d'avant. Un échec du chemin v2 ne doit JAMAIS
     * empêcher de lire : `notes_enc` est toujours là (le cycle le réécrit, la
     * migration ne l'efface pas).
     */
    try {
      const charge = await loadWebVaultV2(createWebVaultIO());
      if (charge) {
        const pid = await getActiveProfileId();
        webV2State = pid
          ? {
              profileId: pid,
              index: charge.index,
              payload: charge.payload as NotesVaultPayload,
              missing: charge.missing,
            }
          : null;
        if (charge.missing.length > 0) {
          console.warn(`[notes:load][web] v2 — ${charge.missing.length} note(s) illisible(s)`);
        }
        return charge.payload;
      }
    } catch (err) {
      console.error('[notes:load][web] chemin v2 en échec — repli sur v1 :', err);
    }
    webV2State = null;

    const encrypted = await storeGet<Uint8Array>(NOTES_KEY);
    if (!encrypted) {
      // Profil VIERGE : il naît en v2 (voir bootstrapEmptyV2). Sans clé encore
      // restaurée, l'écriture échoue et l'on réessaiera au prochain chargement.
      try {
        const born = await bootstrapEmptyV2(createWebVaultIO());
        const pid = born ? await getActiveProfileId() : null;
        if (born && pid) {
          const vide = { byId: {}, allIds: [], templates: [], notebooks: {} } as NotesVaultPayload;
          webV2State = { profileId: pid, index: born, payload: vide, missing: [] };
          console.info('[notes:load][web] profil sans note : né en v2');
          return vide;
        }
      } catch (err) {
        console.warn('[notes:load][web] naissance en v2 différée :', err);
      }
      return null;
    }
    const plain = await decryptFileContent(new Uint8Array(encrypted));
    return JSON.parse(new TextDecoder().decode(plain));
  },

  // ── Mise en page modulaire ───────────────────────────────────────────────
  // `layout:load` / `layout:save`, même famille que les notes (un conteneur par
  // profil, fusionné à la descente, remonté par le cycle). Ils vivent dans
  // `layoutHandlers.ts` et sont repris ici pour que le dispatcher n'ait pas à
  // connaître une table de plus.
  ...layoutHandlers,
};
