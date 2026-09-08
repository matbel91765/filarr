/**
 * LE CYCLE DE NOTES v2, BRANCHE AU DISQUE ET AU RESEAU.
 *
 * Assemble les trois morceaux deja eprouves separement : la couche de rangement
 * (`notesVaultStore`), la decision (`notesSyncV2`), et le reseau
 * (`notesTransportR2`). Ce fichier n'ajoute aucune regle — il enchaine, il
 * ecrit, il journalise.
 *
 * ═══ QUAND IL NE FAIT RIEN, ET C'EST LE CAS NORMAL AUJOURD'HUI ═══
 *
 * Il rend `{ ran: false }` des que le profil n'est pas en v2 sur le disque —
 * donc pour tout le monde tant que `FILARR_NOTES_V2` n'a pas ete pose et que la
 * migration n'a pas tourne. Le cout de ce refus est UNE lecture d'index absent :
 * quelques octets.
 *
 * ═══ L'ORDRE D'ECRITURE, POUR LA TROISIEME FOIS ═══
 *
 * Les notes descendues sont posees sur le disque AVANT l'index qui les cite.
 * Meme regle que `saveVaultV2`, meme raison : une coupure entre les deux laisse
 * un index qui designe l'ancien etat, coherent, plutot qu'un index qui promet
 * des notes absentes.
 */

import log from 'electron-log';

import { createVaultIO } from './notesVaultIO';
import {
  detectFormat,
  findOrphanObjects,
  loadVaultV2,
  readNoteObject,
  reconcileLegacyBlob,
  shouldWriteBackLegacy,
  writeIndex,
  writeNoteObject,
  V1_BLOB_FILENAME,
  type LegacyVerdict,
} from './notesVaultStore';
import { inlineFromStore, splitDeps } from './notesVaultFacade';
import {
  indexForCloud,
  legacyVaultDigest,
  isNotesIndexShape,
  normalizeIndex,
  type NotesIndex,
} from './notesStoreV2';
import {
  blobPath,
  referencedBlobs,
  selectSweepableBlobs,
  BLOBS_DIR,
  BLOB_SWEEP_GRACE_MS,
  CLOUD_BLOB_SWEEP_GRACE_MS,
  CLOUD_BLOB_SWEEP_MAX_PER_CYCLE,
} from './noteBlobs';

/** Une fois par jour au plus : le balayage exige de relire TOUTES les notes. */
const BLOB_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
import { syncNotesV2, type LocalVaultView, type NotesTransport } from './notesSyncV2';
import { readBounded, type VaultIO } from './notesVaultStore';
import { createR2NotesTransport } from './notesTransportR2';
import { NOTES_DIR, NOTES_INDEX_FILENAME } from './notesStoreV2';

export interface NotesCycleResult {
  /** Faux = ce profil n'est pas en v2, rien n'a ete tente. */
  ran: boolean;
  downloaded: number;
  uploaded: number;
  /** Des notes sont arrivees : le renderer doit relire son coffre. */
  contentChanged: boolean;
  failures: number;
  published: boolean;
  /**
   * `notes.enc` A ETE REECRIT par ce cycle, pour l'appareil reste en v1.
   *
   * L'appelant DOIT alors notifier `meta:notes` : la reecriture se fait APRES
   * le balayage local et apres la phase de remontee du cycle englobant, donc
   * rien de ce cycle-ci ne la fait partir. Sans signal, le blob frais restait
   * sur le disque jusqu'a ce qu'un evenement sans rapport declenche un autre
   * cycle — c'est-a-dire, sur une machine tranquille, jamais. Le vieil appareil
   * continuait d'afficher un coffre fige, exactement la panne que la reecriture
   * etait censee reparer.
   */
  legacyBlobRewritten: boolean;
  /**
   * Images citées par les notes, absentes du disque au chargement, et RETROUVÉES
   * là-haut pendant ce cycle — voir `rememberMissingBlobs`.
   */
  blobsRecovered: number;
}

const IDLE: NotesCycleResult = {
  ran: false,
  downloaded: 0,
  uploaded: 0,
  contentChanged: false,
  failures: 0,
  published: false,
  legacyBlobRewritten: false,
  blobsRecovered: 0,
};

/**
 * UN CYCLE COMPLET POUR LES NOTES D'UN PROFIL EN v2.
 *
 * `transport` est injectable pour les tests ; en production c'est R2.
 *
 * NE JETTE PAS. Un cycle de notes qui echoue ne doit pas faire echouer le cycle
 * de synchronisation qui l'englobe : les fichiers ordinaires, eux, n'ont rien a
 * voir avec ca. L'echec est journalise et compte, et le cycle suivant reessaiera.
 */
/**
 * Profils pour lesquels la suspension du pont v1 a deja ete journalisee.
 * Sans cela, la ligne reviendrait a chaque cycle — toutes les cinq minutes —
 * pour redire la meme chose.
 */
const legacyBridgeSuspendedLogged = new Set<string>();

/**
 * Age au-dela duquel le blob v1 est rafraichi MEME sous verdict `'safe'`.
 *
 * Le pont ne peut pas s eteindre tout a fait : l APPAIRAGE d un nouvel appareil
 * mobile s hydrate exclusivement depuis `meta:notes` (`join-device.tsx` ->
 * `hydrateNotesFromCloudThunk` -> `downloadNotesBundle`), verifie par la session
 * mobile le 2026-09-05. Un blob fige pour toujours, c est un telephone appaire
 * trois semaines plus tard qui demarre sur un etat gele.
 *
 * Une heure borne cet ecart : au plus un renvoi de 3,5 Mo par heure d edition
 * au lieu de quatre par note, et un appareil neuf ne voit jamais plus d une
 * heure de retard avant que son cycle v2 ne le rattrape. C est le compromis
 * (b) propose par le mobile ; le (c) — hydrater l appairage depuis les objets
 * v2 — est chez lui et attend l arbitrage de Mathis.
 */
export const LEGACY_BLOB_REFRESH_MS = 60 * 60 * 1000;

/**
 * Age du blob d apres son identite `taille:mtimeMs`, ou `null` si on ne sait
 * pas. `null` n est jamais lu comme « frais » : dans le doute, on rafraichit.
 */
export function legacyBlobAgeMs(stamp: string | null, nowMs: number): number | null {
  if (!stamp) return null;
  const parts = stamp.split(':');
  const mtimeMs = Number(parts[parts.length - 1]);
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return null;
  const age = nowMs - mtimeMs;
  return age < 0 ? null : age;
}

/**
 * IMAGES MANQUANTES SIGNALÉES PAR LE CHARGEMENT.
 *
 * Le cycle ne descend une image qu'avec la note qu'il télécharge LUI-MÊME. Une
 * note arrivée autrement — réinjectée depuis le blob v1 d'un autre appareil,
 * ou descendue un jour où l'image n'était pas encore là-haut — garde une
 * référence vers une image absente du disque, pour toujours : rien ne revenait
 * la chercher. Mesuré le 05/09/2026 : 8 images « introuvables » sur un
 * appareil, toutes présentes dans R2 (vérifié objet par objet).
 *
 * `inlineFromStore` sait exactement lesquelles manquent au moment où il inline
 * les images ; le chargement les dépose ici, et le cycle suivant les demande au
 * nuage. Un signalement est CONSOMMÉ par le cycle qui le traite : une image
 * absente là-haut aussi n'est pas redemandée à chaque cycle — le prochain
 * chargement la re-signalera, si la note la cite toujours.
 */
const missingBlobHints = new Map<string, Set<string>>();
/** Images demandées de front au nuage — chacune pèse souvent 0,5 à 1 Mo. */
const BLOB_RECOVERY_CONCURRENCY = 4;

export function rememberMissingBlobs(profileId: string, hashes: readonly string[]): void {
  if (hashes.length === 0) return;
  const set = missingBlobHints.get(profileId) ?? new Set<string>();
  for (const h of hashes) set.add(h);
  missingBlobHints.set(profileId, set);
}

/** Récupère du nuage les images signalées ; rend le nombre écrit sur le disque. */
async function recoverMissingBlobs(
  profileId: string,
  local: Pick<LocalVaultView, 'readBlob' | 'writeBlob'>,
  transport: Pick<NotesTransport, 'getBlob'>
): Promise<number> {
  const hints = missingBlobHints.get(profileId);
  if (!hints || hints.size === 0) return 0;
  missingBlobHints.delete(profileId);
  let recovered = 0;
  let absentes = 0;
  await readBounded([...hints], BLOB_RECOVERY_CONCURRENCY, async (hash) => {
    // Une empreinte vient d'un contenu de note, donc d'une DONNÉE : refusée si
    // elle n'a pas la forme attendue, jamais transformée en chemin.
    if (!blobPath(NOTES_DIR, hash)) return;
    try {
      if ((await local.readBlob(hash)) !== null) return;
      const base64 = await transport.getBlob(hash);
      if (base64 === null) {
        absentes++;
        return;
      }
      await local.writeBlob(hash, base64);
      recovered++;
    } catch (err) {
      log.warn(
        `[notesCycle] image ${hash.slice(0, 12)}… non récupérée : ${(err as Error).message}`
      );
    }
  });
  if (recovered > 0 || absentes > 0) {
    log.info(
      `[notesCycle] ${recovered} image(s) manquante(s) récupérée(s) du nuage` +
        (absentes > 0 ? `, ${absentes} absente(s) là-haut aussi` : '')
    );
  }
  return recovered;
}

export async function runNotesCycleV2(
  profileId: string,
  dataDir: string,
  overrides?: {
    transport?: NotesTransport;
    io?: VaultIO;
    /**
     * Ne pas balayer les images CE cycle. Le balayage relit chaque objet de note
     * (une derivation PBKDF2 chacun) : lance pendant que `notes:load` fait la
     * meme chose au demarrage, il partage les quatre fils du pool avec lui et
     * double le temps d'ouverture des notes (12,5 s au lieu de ~3 s, mesure le
     * 06/09/2026). L'appelant le pose pendant les premieres minutes du processus ;
     * le balayage, du au plus une fois par jour, attend le cycle suivant.
     */
    skipBlobSweep?: boolean;
    /**
     * Y a-t-il encore un appareil v1 a servir ? `'safe'` = aucun ecrivain v1
     * observe depuis trente jours : le pont v1 est alors SUSPENDU (voir la
     * reecriture du blob plus bas). Absent = `'unknown'` = on garde le pont,
     * par prudence.
     */
    legacyVerdict?: LegacyVerdict;
    /** Horloge injectable — les suites ne doivent pas attendre une heure. */
    nowMs?: number;
  }
): Promise<NotesCycleResult> {
  // Les E/S sont injectables pour que l'ASSEMBLAGE des trois couches soit
  // eprouvable — c'est ici qu'elles se rencontrent, donc ici que les erreurs
  // de branchement se logent, et un test qui ne couvrirait que les couches
  // separement ne les verrait jamais.
  const io = overrides?.io ?? createVaultIO(dataDir);
  const transport = overrides?.transport ?? createR2NotesTransport(profileId);

  const format = await detectFormat(io);

  /**
   * UN COFFRE v1 LOCAL NE BASCULE PAS TOUT SEUL. La migration réécrit le
   * rangement complet et se refuse tant qu'un autre appareil écrit encore en
   * v1 : c'est une DÉCISION, prise dans les réglages, pas un effet de bord d'un
   * cycle de fond.
   */
  if (format === 'v1') return IDLE;

  let localIndex: NotesIndex;

  if (format === 'none') {
    /**
     * ── UN APPAREIL NEUF REJOINT UN COFFRE DÉJÀ RANGÉ ───────────────────────
     *
     * ⚠ SANS CECI, UN SECOND APPAREIL NE VOYAIT JAMAIS RIEN. Le cycle sortait
     * sur « ce disque n'est pas en v2 » — ce qui est vrai d'une installation
     * neuve, d'une nouvelle connexion, d'un profil qu'on vient d'ajouter. Le
     * nuage portait le coffre entier, l'appareil restait vide, et rien ne
     * s'affichait nulle part. Trouvé par la suite à deux appareils, jamais par
     * un test d'un seul côté : chacun avait raison de son point de vue.
     *
     * Ce n'est PAS une migration. Il n'y a rien à convertir : ce disque n'a
     * aucune note. On pose un index vide, et le cycle ordinaire descend tout —
     * la fusion est une UNION, l'absence locale n'a jamais valu suppression.
     *
     * COÛT QUAND IL N'Y A RIEN : une requête d'index par cycle, pour un profil
     * qui n'a de notes NULLE PART. Elle cesse dès qu'il en existe une.
     */
    let distant: NotesIndex | null;
    try {
      distant = await transport.getRemoteIndex();
    } catch (err) {
      // Réseau muet : on ne conclut pas, on réessaiera au prochain cycle.
      log.warn(`[notesCycle] index distant illisible : ${(err as Error).message}`);
      return IDLE;
    }
    if (!distant) return IDLE;

    localIndex = normalizeIndex({});
    try {
      await writeIndex(io, localIndex);
    } catch (err) {
      log.error(`[notesCycle] adoption v2 impossible : ${(err as Error).message}`);
      return IDLE;
    }
    log.info('[notesCycle] cet appareil rejoint un coffre v2 deja range');
  } else {
    const rawIndex = await io.read(`${NOTES_DIR}/${NOTES_INDEX_FILENAME}`);
    if (rawIndex === null) return IDLE;
    /**
     * GARDE DE FORME — voir `isNotesIndexShape`. `normalizeIndex` aurait rendu
     * un index VIDE ET VALIDE pour tout objet : le cycle serait parti fusionner
     * un coffre local « sans notes » contre le nuage. On ne conclut pas sur ce
     * qu'on n'a pas su lire ; le cycle suivant reessaiera.
     */
    if (!isNotesIndexShape(rawIndex)) {
      log.error('[notesCycle] index local sans la forme attendue — cycle abandonne');
      return IDLE;
    }
    localIndex = normalizeIndex(rawIndex);
  }

  /**
   * ── RÉINJECTION D'UN APPAREIL RESTÉ EN v1, AVANT TOUT LE RESTE ────────────
   *
   * Le cycle ordinaire descend et fusionne `meta:notes` dans le `notes.enc`
   * local — ce chemin n'a pas bougé. Après migration ce fichier n'est plus lu :
   * les notes d'un appareil resté en v1 arrivent sur le disque et n'apparaissent
   * NULLE PART. Silencieusement, ce qui est la forme de perte que tout ce
   * chantier poursuit.
   *
   * On relit donc ce que le cycle a déjà posé, et seulement s'il a bougé
   * (empreinte taille+date : relire dix mégaoctets à chaque cycle pour découvrir
   * qu'un appareil éteint est toujours éteint coûterait plus que la v2 ne gagne).
   *
   * AVANT le cycle réseau, pour que ce que le vieil appareil a écrit parte dans
   * la foulée au lieu d'attendre un tour de plus.
   */
  let index = localIndex;
  try {
    const legacy = await reconcileLegacyBlob(
      io,
      index,
      splitDeps(),
      index.legacyStamp ?? null
    );
    if (legacy && (legacy.plan.changedFromLocal || legacy.plan.toFetch.length > 0)) {
      for (const noteId of legacy.plan.toFetch) {
        const entry = legacy.plan.merged.notes[noteId];
        const note = legacy.notes[noteId];
        if (!entry || !note) continue;
        await writeNoteObject(io, entry.objectId, note);
      }
      index = { ...legacy.plan.merged, legacyStamp: legacy.stamp };
      await writeIndex(io, index);
      log.warn(
        `[notesCycle] ${legacy.plan.toFetch.length} note(s) reprise(s) d'un appareil reste en v1`
      );
    } else if (legacy && legacy.stamp !== (index.legacyStamp ?? null)) {
      // Rien de neuf dans le blob, mais il a bouge : on note l'empreinte pour
      // ne pas le relire au prochain cycle.
      index = { ...index, legacyStamp: legacy.stamp };
      await writeIndex(io, index);
    }
  } catch (err) {
    log.error(`[notesCycle] reinjection v1 echouee (non bloquant) : ${(err as Error).message}`);
  }

  const local: LocalVaultView = {
    index,
    readNote: async (noteId) => {
      const entry = index.notes[noteId];
      if (!entry) return null;
      return readNoteObject(io, entry.objectId);
    },
    readBlob: async (hash) => {
      const chemin = blobPath(NOTES_DIR, hash);
      if (!chemin) return null;
      const brut = await io.read(chemin);
      return typeof brut === 'string' ? brut : null;
    },
    writeBlob: async (hash, base64) => {
      const chemin = blobPath(NOTES_DIR, hash);
      // Empreinte refusee : elle vient d'un contenu qui peut venir du nuage,
      // et fabriquer un chemin depuis une donnee est exactement ce qu'on evite.
      if (!chemin) throw new Error(`empreinte refusee : ${String(hash).slice(0, 32)}`);
      await io.write(chemin, base64);
    },
  };

  let result;
  try {
    result = await syncNotesV2(local, transport);
  } catch (err) {
    log.error(`[notesCycle] cycle v2 abandonne : ${(err as Error).message}`);
    return { ...IDLE, ran: true, failures: 1 };
  }

  // ── Les notes descendues, PUIS l'index. ───────────────────────────────────
  const posees: string[] = [];
  for (const [noteId, note] of Object.entries(result.fetched)) {
    const entry = result.localIndex.notes[noteId];
    if (!entry) continue;
    try {
      await writeNoteObject(io, entry.objectId, note);
      posees.push(noteId);
    } catch (err) {
      // Une note qu'on n'a pas su ecrire ne doit pas etre citee comme detenue :
      // on remet l'entree locale d'avant, et le cycle suivant la redemandera.
      log.warn(`[notesCycle] ecriture locale refusee pour ${noteId} : ${(err as Error).message}`);
      const mine = index.notes[noteId];
      if (mine) result.localIndex.notes[noteId] = mine;
      else delete result.localIndex.notes[noteId];
    }
  }

  /**
   * ── LES NOTES DONT LA CLÉ D'OBJET A CHANGÉ ────────────────────────────────
   *
   * ⚠ CE BLOC EXISTE PARCE QUE SON ABSENCE EFFAÇAIT DES NOTES. `mergeIndexes`
   * signale un `rekeyed` quand les deux côtés ont indexé la même note sans se
   * voir : chacun a minté sa propre clé d'objet, et celle du NUAGE fait foi.
   * L'index local se met donc à citer une clé sous laquelle ce disque n'a rien,
   * pendant que le contenu dort sous l'ancienne — que plus aucune entrée ne
   * réclame. Le ménage des orphelins, quelques lignes plus bas, le supprimait
   * alors très proprement.
   *
   * Résultat observé : un index qui cite deux notes, un disque qui n'en a
   * aucune, zéro erreur affichée. Trouvé par la suite à deux appareils — un
   * seul côté ne peut pas voir un désaccord de clés.
   *
   * LE CONTENU EST IDENTIQUE (sinon la note serait dans `toFetch`) : il n'y a
   * rien à retélécharger, seulement à ranger sous la clé qui fait foi. Et si on
   * n'y arrive pas, on RETIRE l'entrée de l'index local plutôt que de promettre
   * un objet absent : le cycle suivant verra « le nuage l'a, pas moi » et la
   * redemandera proprement.
   *
   * AVANT l'écriture de l'index, comme partout ailleurs ici.
   */
  for (const { noteId, from, to } of result.plan.rekeyed) {
    if (result.fetched[noteId]) continue; // déjà posée sous sa nouvelle clé
    try {
      if ((await readNoteObject(io, to)) !== null) continue;
      const contenu = await readNoteObject(io, from);
      if (contenu === null) {
        delete result.localIndex.notes[noteId];
        continue;
      }
      await writeNoteObject(io, to, contenu);
      await io.remove(`${NOTES_DIR}/${from}.enc`);
    } catch (err) {
      log.warn(`[notesCycle] re-clé impossible pour ${noteId} : ${(err as Error).message}`);
      delete result.localIndex.notes[noteId];
    }
  }

  if (result.changedLocal) {
    try {
      await writeIndex(io, result.localIndex);
    } catch (err) {
      // L'index n'a pas bouge : le disque porte toujours l'etat d'avant, plus
      // d'eventuels objets orphelins qui ne genent personne.
      log.error(`[notesCycle] index local non ecrit : ${(err as Error).message}`);
      return { ...IDLE, ran: true, failures: result.failures.length + 1 };
    }
  }

  if (result.failures.length > 0) {
    log.warn(
      `[notesCycle] ${result.failures.length} transfert(s) en echec : ` +
        result.failures
          .slice(0, 5)
          .map((f) => `${f.noteId}(${f.direction})`)
          .join(', ')
    );
  }
  if (result.overwritten.length > 0) {
    log.warn(
      `[notesCycle] ${result.overwritten.length} note(s) dont l'arbitrage a ecarte ` +
        `un contenu divergent`
    );
  }
  log.info(
    `[notesCycle] v2 — ${posees.length} descendue(s), ${result.uploaded.length} remontee(s), ` +
      `index ${result.published ? 'publie' : 'non publie'}`
  );

  /**
   * ── MENAGE DES OBJETS ORPHELINS ─────────────────────────────────────────
   *
   * Un objet que plus aucune entree d'index ne reclame vient d'une ecriture
   * interrompue : les notes sont posees AVANT l'index, donc une coupure entre
   * les deux laisse des fichiers que rien ne designe. Ils sont inoffensifs —
   * personne ne les lit — mais ils s'accumulent, et sur un coffre charge
   * d'images ca finit par se compter en dizaines de megaoctets.
   *
   * TROIS GARDES, parce que supprimer est la seule chose irreversible ici :
   *  - APRES l'ecriture de l'index seulement (il fait autorite sur ce qui est
   *    reclame, et il vient d'etre mis a jour) ;
   *  - JAMAIS si un transfert a echoue : l'index publie pourrait encore bouger,
   *    et un objet qu'on croit orphelin pourrait etre reclame au cycle suivant ;
   *  - JAMAIS si `writeIndex` a echoue (on est deja sorti plus haut).
   *
   * Best-effort et silencieux : ne pas faire le menage ne casse rien.
   */
  // Images signalées manquantes par le dernier chargement — voir
  // `rememberMissingBlobs`. Après les transferts, avant tout ménage.
  const blobsRecovered = await recoverMissingBlobs(profileId, local, transport);

  if (result.failures.length === 0) {
    try {
      const orphelins = await findOrphanObjects(io, result.localIndex);
      for (const nom of orphelins) {
        await io.remove(`${NOTES_DIR}/${nom}`);
      }
      if (orphelins.length > 0) {
        log.info(`[notesCycle] ${orphelins.length} objet(s) orphelin(s) retire(s) du disque`);
      }
    } catch (err) {
      log.warn(`[notesCycle] menage des orphelins ignore : ${(err as Error).message}`);
    }
  }

  /**
   * ── MENAGE DES IMAGES ORPHELINES ────────────────────────────────────────
   *
   * Sans lui, une image supprimee avec sa note reste sur le disque et dans le
   * nuage POUR TOUJOURS. Ce n'est pas dangereux, mais ca fuit indefiniment.
   *
   * IL EXIGE DE RELIRE TOUTES LES NOTES, et c'est cher : en v2 elles sont
   * chiffrees une par une. D'ou la cadence d'un jour, et d'ou le refus TOTAL de
   * `selectSweepableBlobs` des qu'une seule note n'a pas pu etre lue — une
   * image vivante peut n'etre citee que par celle-la.
   *
   * L'AGE VIENT DU REGISTRE, pas du disque : `index.blobs[hash]` porte la date
   * ou le nuage l'a recue. Une image que le registre ne connait pas a un age
   * INCONNU, donc elle est protegee — ce qui couvre exactement les images tout
   * juste extraites et pas encore remontees.
   */
  const dernier = result.localIndex.blobSweepAt ?? null;
  const dueMs = dernier ? Date.parse(dernier) : NaN;
  const aBalayer =
    !overrides?.skipBlobSweep &&
    result.failures.length === 0 &&
    (!Number.isFinite(dueMs) || Date.now() - dueMs > BLOB_SWEEP_INTERVAL_MS);

  if (aBalayer) {
    try {
      const fichiers = await io.list(`${NOTES_DIR}/${BLOBS_DIR}`);
      const present = fichiers
        .filter((f) => f.endsWith('.enc'))
        .map((f) => f.slice(0, -'.enc'.length));

      const referenced = new Set<string>();
      let lues = 0;
      for (const [noteId, entry] of Object.entries(result.localIndex.notes)) {
        const note = await readNoteObject(io, entry.objectId);
        if (!note) continue;
        referencedBlobs(note, referenced);
        lues++;
        void noteId;
      }

      const registre = result.localIndex.blobs ?? {};
      const aRetirer = selectSweepableBlobs({
        present,
        referenced,
        scannedNotes: lues,
        expectedNotes: Object.keys(result.localIndex.notes).length,
        ageMs: (hash) => {
          const vu = registre[hash];
          const ms = vu ? Date.parse(vu) : NaN;
          return Number.isFinite(ms) ? Date.now() - ms : null;
        },
        graceMs: BLOB_SWEEP_GRACE_MS,
      });

      for (const hash of aRetirer) {
        const chemin = blobPath(NOTES_DIR, hash);
        if (chemin) await io.remove(chemin);
      }

      /**
       * ── ET LE NUAGE, SOUS PIERRE TOMBALE ────────────────────────────────
       *
       * Jusqu'ici une image supprimee avec sa note restait dans R2 POUR
       * TOUJOURS, et comptait contre le quota. Supprimer la-haut engage tous
       * les appareils, d'ou trois choses que le disque n'exigeait pas :
       *
       *  - UNE PIERRE (`blobTombstones`), publiee AVANT la suppression. Si
       *    l'ordre etait inverse, une coupure entre les deux laisserait un
       *    registre qui promet une image que R2 n'a plus — et aucun appareil
       *    ne la renverrait jamais, puisque le registre dit « deja la-haut ».
       *    Dans ce sens-ci, une coupure laisse une image sous pierre mais
       *    encore presente : inoffensif.
       *  - UN DELAI DE GRACE de sept jours, et non un : un appareil hors ligne
       *    qui cite encore l'image la renverra a son retour (la remontee
       *    ressuscite, voir `reconcileBlobRegistry`), mais autant ne pas lui
       *    faire payer ce transfert pour une image d'hier.
       *  - PAR LOTS : le Worker borne les suppressions par compte.
       *
       * `present` est ici le REGISTRE, pas le disque : c'est ce que le nuage
       * detient, et c'est lui qu'on nettoie. Les gardes (toutes les notes
       * lues, aucun transfert en echec) sont celles du balayage local — elles
       * valent pour le nuage parce qu'avec zero echec, l'index local EST
       * l'index fusionne, donc l'union de ce que tous les appareils ont publie.
       */
      const auNuage = selectSweepableBlobs({
        present: Object.keys(registre),
        referenced,
        scannedNotes: lues,
        expectedNotes: Object.keys(result.localIndex.notes).length,
        ageMs: (hash) => {
          const ms = Date.parse(registre[hash] ?? '');
          return Number.isFinite(ms) ? Date.now() - ms : null;
        },
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
        // La pierre d'abord, sur le nuage ET sur le disque ; les octets ensuite.
        await transport.putIndex(indexForCloud(result.localIndex));
        await writeIndex(io, result.localIndex);
        for (const hash of auNuage) {
          await transport.deleteBlob(hash);
        }
        log.info(`[notesCycle] ${auNuage.length} image(s) orpheline(s) retiree(s) du nuage`);
      }

      // La date part meme quand rien n'a ete retire : ce qui coute, c'est la
      // relecture, et elle a bien eu lieu.
      result.localIndex = { ...result.localIndex, blobSweepAt: new Date().toISOString() };
      await writeIndex(io, result.localIndex);
      if (aRetirer.length > 0) {
        log.info(`[notesCycle] ${aRetirer.length} image(s) orpheline(s) retiree(s) du disque`);
      }
    } catch (err) {
      log.warn(`[notesCycle] menage des images ignore : ${(err as Error).message}`);
    }
  }

  /**
   * ── REECRITURE DU BLOB v1, POUR QUE LE VIEIL APPAREIL VOIE CE QU'ON ECRIT ──
   *
   * La reinjection du haut de ce fichier ne va que dans UN SENS : elle LIT ce
   * qu'un appareil reste en v1 a ecrit. Une note creee ici, en v2, ne
   * l'atteignait donc jamais — il affichait un coffre fige au jour de la
   * migration, sans la moindre erreur. Encore la meme forme de perte, et cette
   * fois c'est moi qui l'avais laissee.
   *
   * On reecrit `notes.enc` avec le coffre v2 assemble ; le cycle de
   * synchronisation ORDINAIRE le fait monter sous `meta:notes`, la ou le vieil
   * appareil le cherche. AUCUN code de transport n'est touche.
   *
   * TROIS PRECAUTIONS, et c'est `shouldWriteBackLegacy` qui les tient :
   *
   *  - LES IMAGES SONT REMISES EN LIGNE. Un appareil en v1 ne sait pas resoudre
   *    `filarr-blob:` : il afficherait des images cassees, et les renverrait
   *    telles quelles.
   *  - ON N'ECRIT QUE SI ON A TOUT LU. Une note manquante au blob reecrit serait
   *    lue comme SUPPRIMEE par le vieil appareil, qui propagerait la
   *    suppression. Un echec de lecture deviendrait une perte.
   *  - L'EMPREINTE EST POSEE APRES L'ECRITURE, et `legacyStamp` avec elle : sans
   *    ce second geste, le cycle suivant verrait un blob « qui a bouge » et
   *    relirait dix megaoctets pour se decouvrir d'accord avec lui-meme.
   */
  let legacyBlobRewritten = false;
  try {
    const presentStamp = io.stat ? await io.stat(V1_BLOB_FILENAME) : null;
    const present = io.stat ? presentStamp !== null : false;
    // `digestOf` serialise a CLES TRIEES : deux appareils qui ont construit le
    // meme index par des chemins differents doivent en tirer la meme empreinte,
    // sans quoi chacun reecrirait le blob a chaque cycle.
    const empreinte = legacyVaultDigest(result.localIndex, splitDeps().digestOf);
    const wouldRewrite = shouldWriteBackLegacy({
      blobPresent: present,
      digest: empreinte,
      lastDigest: result.localIndex.legacyDigest,
      // On ne sait pas encore ce qui manque : la lecture n'a pas eu lieu. Ce
      // premier passage ne filtre que le gratuit — pas de blob, rien change.
      missing: 0,
      noteCount: Object.keys(result.localIndex.notes).length,
    });
    /*
      LE PONT NE SERT QUE S IL Y A QUELQU UN DE L AUTRE COTE.

      Chaque reecriture de `notes.enc` derive une cle neuve d un sel neuf : le
      chiffre change entierement, l empreinte aussi, et le cycle suivant le
      REMONTE — 3,5 Mo pour cet utilisateur, a chaque modification d une note,
      observe le 2026-09-05 (quatre envois pour une seule note). C est le prix
      d un appareil v1 qui lirait encore ce blob.

      Or le produit sait deja s il en reste un : `legacyNotesVerdict` rend
      `'safe'` quand aucun ecrivain v1 n a ete observe depuis trente jours —
      c est la regle qui autorise deja la migration. Le pont l ignorait, et
      payait pour personne.

      Seule la REECRITURE est suspendue. La lecture (`reconcileLegacyBlob`)
      continue : si un appareil v1 ecrit `notes.enc`, son entree distante sans
      `legacyWriteBack` fait retomber le verdict a `'legacy-active'` au cycle
      suivant, et le pont reprend de lui-meme. `'unknown'` (aucun manifeste
      distant encore lu) garde le pont : dans le doute, on sert.
    */
    const verdict: LegacyVerdict = overrides?.legacyVerdict ?? 'unknown';
    /*
      DIFFERER, PAS SUSPENDRE. Sous `'safe'`, le blob n est rafraichi que s il a
      plus de LEGACY_BLOB_REFRESH_MS — voir la constante. Un age inconnu compte
      comme perime : on ne fige jamais un blob dont on ne sait pas la date.
    */
    const ageMs = legacyBlobAgeMs(presentStamp, overrides?.nowMs ?? Date.now());
    const deferred = verdict === 'safe' && ageMs !== null && ageMs < LEGACY_BLOB_REFRESH_MS;
    if (wouldRewrite && deferred) {
      if (!legacyBridgeSuspendedLogged.has(profileId)) {
        legacyBridgeSuspendedLogged.add(profileId);
        log.info(
          `[notesCycle] pont v1 differe : aucun appareil v1 observe depuis 30 jours, ` +
            `notes.enc n est rafraichi qu une fois par heure (${Object.keys(result.localIndex.notes).length} note(s))`
        );
      }
    } else if (wouldRewrite) {
      const charge = await loadVaultV2(io);
      if (charge && shouldWriteBackLegacy({
        blobPresent: true,
        digest: empreinte,
        lastDigest: result.localIndex.legacyDigest,
        missing: charge.missing.length,
        noteCount: Object.keys(result.localIndex.notes).length,
      })) {
        const enLigne = await inlineFromStore(io, charge.payload);
        await io.write(V1_BLOB_FILENAME, enLigne);
        legacyBlobRewritten = true;
        // L'empreinte ET l'identite du fichier, dans la meme ecriture d'index :
        // c'est nous qui venons de le faire bouger, pas le vieil appareil.
        const stamp = io.stat ? await io.stat(V1_BLOB_FILENAME) : null;
        result.localIndex = { ...result.localIndex, legacyDigest: empreinte, legacyStamp: stamp };
        await writeIndex(io, result.localIndex);
        log.info(
          `[notesCycle] blob v1 reecrit (${Object.keys(result.localIndex.notes).length} note(s)) ` +
            `pour un appareil reste en v1`
        );
      } else if (charge && charge.missing.length > 0) {
        log.warn(
          `[notesCycle] reecriture v1 refusee : ${charge.missing.length} note(s) illisible(s) — ` +
            `un blob ampute serait lu comme des suppressions`
        );
      }
    }
  } catch (err) {
    log.warn(`[notesCycle] reecriture du blob v1 ignoree : ${(err as Error).message}`);
  }

  return {
    ran: true,
    downloaded: posees.length,
    uploaded: result.uploaded.length,
    contentChanged: posees.length > 0,
    failures: result.failures.length,
    published: result.published,
    legacyBlobRewritten,
    blobsRecovered,
  };
}
