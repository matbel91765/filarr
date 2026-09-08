/**
 * TRANSPORT DU COFFRE v2 — un cycle de synchronisation qui ne bouge que ce qui
 * a change. Module PUR : le reseau arrive par `NotesTransport`, injecte.
 *
 * ═══ L'ORDRE, ENCORE, ET POUR LA MEME RAISON ═══
 *
 * Sur le disque, l'index est ecrit en dernier. Dans le nuage, c'est pareil et
 * c'est encore plus important : un index publie qui cite un objet que R2 n'a
 * pas fait casser TOUS les autres appareils, pas seulement celui qui a
 * publie — ils descendraient un index, demanderaient les notes, et
 * tomberaient sur du vide. Le depot connait deja cette panne sous une autre
 * forme (« Checksum mismatch » en descendant `meta:notes`).
 *
 * Donc : les notes montent d'abord, l'index ensuite, sans exception.
 *
 * ═══ DEUX INDEX, ET C'EST VOULU ═══
 *
 * Un cycle peut echouer partiellement. Ce qu'on ECRIT SUR LE DISQUE et ce qu'on
 * PUBLIE ne disent alors pas la meme chose, et les confondre serait mentir :
 *
 *  - une DESCENTE qui echoue : le nuage a bien cette note, nous non. L'index
 *    publie peut porter l'entree distante (c'est vrai pour le nuage) ; l'index
 *    LOCAL doit garder la notre, sinon on pretendrait detenir un contenu qu'on
 *    n'a pas — et la prochaine ecriture le propagerait comme une perte.
 *  - une REMONTEE qui echoue : le nuage n'a PAS notre note. Publier un index
 *    qui la cite serait exactement la panne decrite plus haut. On ne publie
 *    donc rien du tout ce cycle-ci, et on retentera.
 *
 * ═══ CE MODULE NE DECIDE PAS QUI GAGNE ═══
 *
 * L'arbitrage appartient a `mergeIndexes` (notesStoreV2), qui le fait sur les
 * index seuls. Ici on execute un PLAN : descendre ceci, remonter cela. La
 * separation compte — elle permet d'eprouver l'arbitrage sans reseau, et le
 * reseau sans arbitrage.
 */

/**
 * ⚠ SOURCE DE VÉRITÉ : `electron/sync/notesSyncV2.ts`.
 *
 * PORTAGE À L'IDENTIQUE, pas une variante. La duplication est imposée par la
 * racine de `electron/tsconfig.json` (voir l'entête de `notesStoreV2.ts`).
 */

import { referencedBlobs } from './noteBlobs';
import {
  indexForCloud,
  mergeIndexes,
  type IndexMergePlan,
  type NoteRecord,
  type NotesIndex,
  type OverwrittenNote,
  reconcileBlobRegistry,
} from './notesStoreV2';

/** Le reseau, vu d'ici. Chaque methode peut jeter : le cycle en tient compte. */
export interface NotesTransport {
  /** L'index distant, ou `null` quand le nuage n'en porte pas encore. */
  getRemoteIndex(): Promise<NotesIndex | null>;
  getNote(objectId: string): Promise<NoteRecord | null>;
  putNote(objectId: string, note: NoteRecord): Promise<void>;
  /**
   * Les IMAGES, adressees par leur contenu. Immuables : une empreinte donnee
   * designe toujours les memes octets, donc un `put` reussi vaut pour toujours
   * et un `get` ne peut pas rendre une version differente.
   */
  getBlob(hash: string): Promise<string | null>;
  putBlob(hash: string, base64: string): Promise<void>;
  /**
   * SUPPRIME une image du nuage. La seule methode destructrice du transport,
   * et `syncNotesV2` ne l'appelle JAMAIS : la decision vit dans le cycle, apres
   * un balayage complet — voir `notesCycleV2`. Absente = deja le resultat voulu.
   */
  deleteBlob(hash: string): Promise<void>;
  /** Publie l'index. L'appelant lui passe deja `indexForCloud(...)`. */
  putIndex(index: NotesIndex): Promise<void>;
}

/** Ce que le disque local sait, au moment ou le cycle commence. */
export interface LocalVaultView {
  index: NotesIndex;
  /** Lit une note locale par son id. `null` = illisible (on ne la remontera pas). */
  readNote(noteId: string): Promise<NoteRecord | null>;
  /** Lit une image locale. `null` = absente. */
  readBlob(hash: string): Promise<string | null>;
  /** Ecrit une image descendue. */
  writeBlob(hash: string, base64: string): Promise<void>;
}

export interface TransferFailure {
  noteId: string;
  direction: 'down' | 'up';
  reason: string;
}

export interface NotesSyncResult {
  /** Index a ECRIRE SUR LE DISQUE. Peut differer de celui qu'on a publie. */
  localIndex: NotesIndex;
  /** Notes descendues, a ecrire localement. */
  fetched: Record<string, NoteRecord>;
  /** L'index local a-t-il change ? Sinon, ne rien reecrire. */
  changedLocal: boolean;
  /** L'index a-t-il ete publie ? Faux si une remontee a echoue. */
  published: boolean;
  uploaded: string[];
  downloaded: string[];
  failures: TransferFailure[];
  /** Entrees dont l'arbitrage a ecarte un contenu VRAIMENT divergent. */
  overwritten: OverwrittenNote[];
  /** Images remontees ce cycle (une fois pour toutes : elles sont immuables). */
  blobsUploaded: string[];
  /** Images descendues ce cycle. */
  blobsDownloaded: string[];
  /** Le plan brut, pour le journal et les tests. */
  plan: IndexMergePlan;
}

/**
 * L'index distant quand le nuage n'en porte pas encore : un index VIDE, pas
 * `null`. Tout le reste du cycle passe alors par le chemin ordinaire — la
 * fusion voit « le distant n'a rien », le plan dit « tout remonter », et il n'y
 * a aucun cas particulier a ecrire. Un premier cycle est un cycle comme un autre.
 */
function emptyRemoteIndex(): NotesIndex {
  return {
    version: 2,
    notes: {},
    allIds: [],
    notebooks: {},
    templates: [],
    purged: {},
    purgedNotebooks: {},
  };
}

/**
 * UN CYCLE DE SYNCHRONISATION DES NOTES EN v2.
 *
 * Cinq temps, dans cet ordre exact :
 *   1. lire l'index distant (quelques Ko) ;
 *   2. arbitrer — `mergeIndexes`, sans lire une seule note ;
 *   3. DESCENDRE les notes que le distant a gagnees ;
 *   4. REMONTER celles que le local a gagnees ;
 *   5. publier l'index, et seulement si tout ce qu'il cite existe la-haut.
 *
 * Rien de ce que ce module rend n'est ecrit par lui : c'est l'appelant qui
 * ecrit, sous son verrou. Une fonction qui decide et une fonction qui ecrit
 * sont deux choses differentes, et les melanger est ce qui rend les pannes
 * partielles impossibles a raisonner.
 */
export async function syncNotesV2(
  local: LocalVaultView,
  transport: NotesTransport,
  nowMs: number = Date.now()
): Promise<NotesSyncResult> {
  const remote = (await transport.getRemoteIndex()) ?? emptyRemoteIndex();
  const plan = mergeIndexes(local.index, remote, nowMs);

  const fetched: Record<string, NoteRecord> = {};
  const downloaded: string[] = [];
  const uploaded: string[] = [];
  const failures: TransferFailure[] = [];
  const blobsUploaded: string[] = [];
  const blobsDownloaded: string[] = [];
  /** Ce que le NUAGE detient deja. Enrichi au fil des remontees. */
  const deja: Record<string, string> = { ...(plan.merged.blobs ?? {}) };

  // ── 3. Descentes ─────────────────────────────────────────────────────────
  // L'entree fusionnee designe la clé d'objet du NUAGE : c'est bien la-bas
  // qu'il faut aller chercher, pas sous la clé locale.
  await mapBounded(plan.toFetch, NOTES_TRANSFER_CONCURRENCY, async (noteId) => {
    const entry = plan.merged.notes[noteId];
    if (!entry) return;
    try {
      const note = await transport.getNote(entry.objectId);
      if (!note) throw new Error('objet absent du nuage');
      fetched[noteId] = note;
      downloaded.push(noteId);
    } catch (err) {
      failures.push({ noteId, direction: 'down', reason: (err as Error).message });
    }
  });

  /**
   * ── 3 bis. LES IMAGES DES NOTES DESCENDUES ────────────────────────────────
   *
   * Une note descendue cite des images par leur empreinte. Sans elles, la note
   * s'affiche avec des cadres vides — et pire, la sauvegarde suivante
   * propagerait ce vide. On les rapatrie donc AVANT que la note ne soit posee.
   *
   * On ne redemande que ce qu'on n'a pas : une image immuable qu'on detient
   * deja ne peut pas avoir change.
   */
  const imagesADescendre: Array<{ hash: string; noteId: string }> = [];
  {
    const vues = new Set<string>();
    for (const noteId of downloaded) {
      for (const hash of referencedBlobs(fetched[noteId])) {
        if (vues.has(hash)) continue;
        vues.add(hash);
        imagesADescendre.push({ hash, noteId });
      }
    }
  }
  await mapBounded(imagesADescendre, NOTES_TRANSFER_CONCURRENCY, async ({ hash, noteId }) => {
    try {
      if ((await local.readBlob(hash)) !== null) return;
      const base64 = await transport.getBlob(hash);
      if (base64 === null) throw new Error('image absente du nuage');
      await local.writeBlob(hash, base64);
      blobsDownloaded.push(hash);
    } catch (err) {
      failures.push({
        noteId,
        direction: 'down',
        reason: `image ${hash}: ${(err as Error).message}`,
      });
    }
  });

  // ── 4. Remontees ─────────────────────────────────────────────────────────
  await mapBounded(plan.toPush, NOTES_TRANSFER_CONCURRENCY, async (noteId) => {
    const entry = plan.merged.notes[noteId];
    if (!entry) return;
    try {
      const note = await local.readNote(noteId);
      if (!note) throw new Error('note locale illisible');

      /**
       * LES IMAGES MONTENT AVANT LA NOTE QUI LES CITE — meme regle que « les
       * notes avant l'index », et pour la meme raison : un objet publie qui
       * designe des octets absents casse l'appareil SUIVANT, pas celui-ci.
       *
       * `deja` est ce que le nuage detient. Une image y figurant n'est JAMAIS
       * remontee a nouveau : c'est tout l'interet de l'adressage par contenu,
       * et c'est ce qui rend une frappe independante du poids de la note.
       */
      for (const hash of referencedBlobs(note)) {
        if (deja[hash]) continue;
        const base64 = await local.readBlob(hash);
        // Image introuvable en local : on ne peut pas la remonter, mais la note
        // part quand meme — la reference vaut mieux que rien, et un autre
        // appareil peut fort bien la detenir.
        if (base64 === null) continue;
        await transport.putBlob(hash, base64);
        deja[hash] = new Date(nowMs).toISOString();
        blobsUploaded.push(hash);
      }

      await transport.putNote(entry.objectId, note);
      uploaded.push(noteId);
    } catch (err) {
      failures.push({ noteId, direction: 'up', reason: (err as Error).message });
    }
  });

  /**
   * ── L'INDEX LOCAL ─────────────────────────────────────────────────────────
   *
   * Une descente ratee ne doit PAS laisser l'entree distante dans notre index :
   * on pretendrait detenir un contenu qu'on n'a pas, et la prochaine ecriture
   * du coffre le propagerait comme une note vide. On remet la notre — et le
   * cycle suivant refera la meme demande.
   *
   * L'ancetre commun n'est pose QUE sur les notes reellement convergees : c'est
   * un accord PROUVE, pas une supposition.
   */
  const localNotes = { ...plan.merged.notes };
  const failedDown = new Set(failures.filter((f) => f.direction === 'down').map((f) => f.noteId));
  for (const noteId of failedDown) {
    const mine = local.index.notes[noteId];
    if (mine) localNotes[noteId] = mine;
    else delete localNotes[noteId];
  }
  for (const noteId of downloaded) {
    const e = localNotes[noteId];
    if (e) localNotes[noteId] = { ...e, syncedDigest: e.digest };
  }
  for (const noteId of uploaded) {
    const e = localNotes[noteId];
    if (e) localNotes[noteId] = { ...e, syncedDigest: e.digest };
  }
  /**
   * ── RESURRECTION ─────────────────────────────────────────────────────────
   *
   * `deja` porte les images REELLEMENT remontees ce cycle, datees de
   * maintenant. Confrontees aux pierres, elles GAGNENT (elles sont plus
   * recentes) : la pierre tombe, l'image revit. C'est ici, et seulement ici,
   * que la suppression d'une image cesse d'etre definitive — un appareil reste
   * hors ligne avec une note qui la cite la renvoie a son retour, parce que le
   * registre fusionne ne la connait plus.
   */
  const registre = reconcileBlobRegistry(deja, plan.merged.blobTombstones ?? {});
  const avecRegistre = (base: NotesIndex): NotesIndex => {
    const out: NotesIndex = { ...base };
    delete out.blobs;
    delete out.blobTombstones;
    if (Object.keys(registre.blobs).length > 0) out.blobs = registre.blobs;
    if (Object.keys(registre.blobTombstones).length > 0) {
      out.blobTombstones = registre.blobTombstones;
    }
    return out;
  };

  const localIndex: NotesIndex = avecRegistre({ ...plan.merged, notes: localNotes });

  /**
   * ── LA PUBLICATION ────────────────────────────────────────────────────────
   *
   * UNE SEULE REMONTEE RATEE SUFFIT A TOUT ANNULER, et c'est volontaire :
   * l'index publie annoncerait un objet que R2 n'a pas, et c'est l'appareil
   * SUIVANT qui casserait — pas celui qui a fauté. Mieux vaut un nuage en
   * retard d'un cycle qu'un nuage qui ment.
   *
   * Les descentes ratees, elles, n'empechent rien : le nuage porte bien ces
   * notes, l'index publie dit donc la verite le concernant.
   */
  const pushFailed = failures.some((f) => f.direction === 'up');
  let published = false;
  if (!pushFailed && plan.changedFromRemote) {
    // L'index publie porte les images REELLEMENT remontees : c'est lui qui
    // apprend aux autres appareils ce qu'ils n'ont plus besoin d'envoyer.
    await transport.putIndex(indexForCloud(avecRegistre(plan.merged)));
    published = true;
  }

  return {
    localIndex,
    fetched,
    changedLocal: plan.changedFromLocal || downloaded.length > 0 || uploaded.length > 0,
    published,
    uploaded,
    downloaded,
    failures,
    overwritten: plan.overwritten,
    blobsUploaded,
    blobsDownloaded,
    plan,
  };
}

/** Objets et images de notes en vol en même temps (descentes comme remontées). */
const NOTES_TRANSFER_CONCURRENCY = 3;

/**
 * FILE TIRÉE À `limit` PLACES — un objet qui finit libère sa place au suivant.
 * Les tâches avalent leurs erreurs (elles les notent dans `failures`) : la
 * file ne s'arrête jamais sur un échec. Les tableaux de résultat sont remplis
 * depuis les tâches ; aucun consommateur n'en dépend de l'ordre.
 */
async function mapBounded<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const size = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = next++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: size }, () => worker()));
}
