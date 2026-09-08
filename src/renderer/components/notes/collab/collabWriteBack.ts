/**
 * Retour au stockage — la session écrit dans `notes.enc` par le chemin normal.
 *
 * Le magasin de notes reste la vérité durable ; le CRDT n'est que la vue
 * vivante. On réutilise donc exactement le même `onUpdate` que la frappe
 * locale, avec deux différences seulement :
 *   • un débounce plus long (les mises à jour distantes sont bavardes) ;
 *   • une garde qui interdit d'écraser une note non vide par un document vide
 *     tant que la session n'a pas reçu son contenu.
 */

/** Débounce de la frappe locale — inchangé. */
export const DEFAULT_WRITE_BACK_DELAY_MS = 300;

/** Débounce en session vivante. */
export const COLLAB_WRITE_BACK_DELAY_MS = 2000;

export function writeBackDelayMs(collabActive: boolean): number {
  return collabActive ? COLLAB_WRITE_BACK_DELAY_MS : DEFAULT_WRITE_BACK_DELAY_MS;
}

// ==================== Débounce ====================

export interface WriteBackDebouncer {
  /** (Re)programme l'écriture ; une frappe en attente est remplacée. */
  schedule(fn: () => void, delayMs: number): void;
  /** Annule l'écriture en attente. Renvoie vrai s'il y en avait une. */
  cancelPending(): boolean;
  isPending(): boolean;
}

export function createWriteBackDebouncer(): WriteBackDebouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule(fn, delayMs) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    cancelPending() {
      if (!timer) return false;
      clearTimeout(timer);
      timer = null;
      return true;
    },
    isPending() {
      return timer !== null;
    },
  };
}

// ==================== Garde anti-effacement ====================

/**
 * Délai au bout duquel une session qui n'a toujours pas dit si elle était
 * connectée ou hors ligne est traitée comme tranchée. Sans ce plafond, un canal
 * qui reste indéfiniment en « connexion… » empêcherait toute écriture et les
 * frappes locales seraient perdues à la fermeture.
 */
export const COLLAB_READY_TIMEOUT_MS = 4000;

export interface WriteBackGuardInput {
  collabActive: boolean;
  /**
   * La session a été tranchée : elle est arrivée avec du contenu, on l'a semée
   * depuis le magasin, ou le plafond ci-dessus est passé.
   */
  ready: boolean;
}

/**
 * Vrai quand il ne faut rien écrire du tout.
 *
 * Tant qu'une session n'est pas tranchée, son document ne représente rien de
 * fiable : le vider dans le magasin effacerait la note, l'écrire à moitié la
 * tronquerait. Une fois tranchée, tout passe — y compris une suppression
 * volontaire, qu'un CRDT ne produit jamais par accident.
 */
export function shouldSkipWriteBack(input: WriteBackGuardInput): boolean {
  return input.collabActive && !input.ready;
}

// ==================== Semis de la session ====================

/**
 * Ce qu'il faut faire du document partagé à l'ouverture :
 *   - `wait`  : on ne sait pas encore, et on ne touche à rien ;
 *   - `adopt` : le partagé fait foi tel quel, rien à semer ;
 *   - `seed`  : il est vide et personne ne viendra le remplir — on y verse le
 *               contenu du magasin.
 */
export type CollabSettleDecision = 'wait' | 'adopt' | 'seed';

export interface CollabSettleInput {
  /**
   * État publié par la session. `denied` — le serveur refuse l'accès à la salle —
   * ne sème JAMAIS : semer signifie « la salle est vide, j'y verse mon corps »,
   * et on n'a pas de salle. Il tombe donc dans le `wait` final, ce qui est
   * correct : la phase repasse hors ligne et l'édition locale reprend.
   */
  status: 'connecting' | 'connected' | 'synced' | 'offline' | 'denied';
  /** Le fragment partagé est-il vide À CET INSTANT ? */
  fragmentEmpty: boolean;
  /** La persistance locale (IndexedDB) a-t-elle fini de recharger ? */
  docLoaded: boolean;
  /** Le plafond d'attente est-il passé ? */
  timedOut: boolean;
}

/**
 * LE DÉFAUT LE PLUS GRAVE DU LOT SE JOUE ICI : semer trop tôt DUPLIQUE toute la
 * note. Un second appareil qui rejoint une salle déjà garnie voit un fragment
 * vide tant que le rejeu n'est pas arrivé ; s'il y verse le contenu du magasin,
 * le rejeu ajoute le sien par-dessus et le CRDT — qui ne perd jamais rien —
 * conserve les deux.
 *
 * D'où trois verrous, dans cet ordre :
 *  1. tant que la persistance locale n'a pas rendu la main, un fragment vide ne
 *     prouve rien (le contenu d'IndexedDB est peut-être en route) ;
 *  2. un fragment non vide se contente d'être adopté ;
 *  3. un fragment vide n'est semé que si la fin du rejeu est CONFIRMÉE
 *     (`synced`), ou qu'il n'y aura pas de rejeu du tout (canal hors ligne, et
 *     le plafond d'attente est passé).
 *
 * Le plafond seul n'autorise JAMAIS le semis quand le canal est encore en
 * train de s'établir : mieux vaut retarder l'écriture dans le magasin (le CRDT
 * et sa persistance locale gardent la frappe) que dupliquer la note.
 */
// ==================== Document partagé PÉRIMÉ ====================

/**
 * Clé de la carte partagée où le document note l'horloge du MAGASIN qu'il a
 * vue en dernier — posée à chaque retour au magasin et à chaque écriture
 * externe versée dans le partagé. Elle circule et se persiste avec le document
 * (CRDT + IndexedDB) : tout pair qui rejoint sait de quand date ce qu'il lit.
 */
export const SHARED_META_MAP = 'filarr-meta';
export const SHARED_STORE_STAMP_KEY = 'storeUpdatedAt';

export interface StaleSharedDocInput {
  /** Contenu de la note dans le MAGASIN (ce que la sync et la chronologie ont écrit). */
  storeContent: string | null | undefined;
  /** Contenu du document partagé, tel que rejoué (salle + persistance locale). */
  docContent: string | null | undefined;
  /** `updatedAt` de la note dans le magasin. */
  storeUpdatedAt: string | null | undefined;
  /** Horloge du magasin que le document partagé a vue en dernier (SHARED_STORE_STAMP_KEY). */
  docStoreUpdatedAt: string | null | undefined;
}

export type StaleSharedDocDecision = 'adopt' | 'replace';

/**
 * LE DOCUMENT PARTAGÉ N'EST PAS LA VÉRITÉ, C'EST UNE TROISIÈME COPIE.
 *
 * « La salle arrive garnie, elle fait foi » (decideCollabSettle) suppose que
 * ce qu'elle porte est au moins aussi frais que le magasin. Ce n'est pas
 * garanti : la sync peut avoir descendu une version plus récente d'un autre
 * appareil, la chronologie peut avoir restauré une version — pendant que le
 * document, lui, dort dans IndexedDB et dans la salle avec le texte d'avant.
 * L'adopter alors, c'est l'écrire dans le magasin avec une date neuve, puis
 * l'envoyer : la vieille version gagne partout, sans conflit ni trace
 * (incident du 2026-09-03 : une copie de deux jours a écrasé une restauration
 * faite une minute plus tôt, trois fois de suite).
 *
 * Règle : contenus égaux → rien à trancher, on adopte. Sinon le magasin gagne
 * s'il est daté APRÈS ce que le document a vu de lui — ou si le document ne
 * porte aucune horloge (document d'avant cette règle : le magasin, durable et
 * versionné, est la seule mémoire fiable). Dans les autres cas, le document
 * porte une frappe que le magasin n'a pas encore : on l'adopte.
 */
export function decideStaleSharedDoc(input: StaleSharedDocInput): StaleSharedDocDecision {
  if (!input.storeContent) return 'adopt';
  if (!input.docContent || input.docContent === input.storeContent) return 'adopt';
  const store = Date.parse(input.storeUpdatedAt ?? '');
  if (Number.isNaN(store)) return 'adopt';
  const seen = Date.parse(input.docStoreUpdatedAt ?? '');
  if (Number.isNaN(seen)) return 'replace';
  return store > seen ? 'replace' : 'adopt';
}

export function decideCollabSettle(input: CollabSettleInput): CollabSettleDecision {
  if (!input.docLoaded) return 'wait';
  if (!input.fragmentEmpty) return 'adopt';
  if (input.status === 'synced') return 'seed';
  if (input.status === 'offline' && input.timedOut) return 'seed';
  return 'wait';
}

// ==================== Session en retard d'un rendu ====================

/**
 * La session rendue par le crochet désigne-t-elle une AUTRE note que celle
 * demandée ?
 *
 * LE DÉFAUT QUE CE PRÉDICAT FERME — il fabriquait des notes fantômes qui
 * recopiaient la frappe. `useCollabSession` publie la session par un ÉTAT posé
 * dans un effet : elle change UN RENDU APRÈS `noteId`. La clé de remontage de
 * l'éditeur, elle, était bâtie sur la note DEMANDÉE, qui change tout de suite.
 * Le premier rendu après un changement de note remontait donc l'éditeur pour la
 * note B en le liant au fragment Yjs de la note A — et `useEditor` n'ayant pas
 * de tableau de dépendances, ce lien devenait DÉFINITIF. Le retour au stockage
 * écrivait ensuite dans la note B le texte de l'éditeur, c'est-à-dire celui de
 * la note A : la note B recopiait mot à mot ce qui était tapé en collaboration.
 *
 * Tant que c'est vrai, RIEN de la nouvelle note ne doit descendre dans
 * l'éditeur : ni la note montrée, ni la clé de remontage.
 */
export function isStaleCollabSession(
  sessionNoteId: string | null | undefined,
  noteId: string
): boolean {
  if (sessionNoteId === null || sessionNoteId === undefined) return false;
  return sessionNoteId !== noteId;
}

// ==================== Écriture externe vs écho ====================

export interface ExternalWriteInput {
  /** `note.content` tel que le magasin vient de le rendre. */
  stored: string | undefined;
  /** Dernier contenu ÉCRIT par cette session (retour au stockage). */
  lastWritten: string | null;
  /** Sérialisation courante du document partagé, si la session répond. */
  sessionContent: string | null;
}

/**
 * En session vivante, réinjecter `note.content` dans l'éditeur écraserait le
 * CRDT — c'est pourquoi l'effet de synchronisation était coupé sans condition.
 * Sauf que c'est le SEUL chemin par lequel une restauration de version atteint
 * l'éditeur : la couper, c'est casser la restauration dès qu'une session tourne.
 *
 * On distingue donc les deux :
 *  - l'ÉCHO de notre propre retour au stockage (le magasin nous rend ce qu'on
 *    vient de lui écrire, ou exactement l'état du document partagé) → ignoré ;
 *  - une écriture EXTERNE (restauration de version, import, réparation) → elle
 *    passe, et le CRDT la propage aux autres appareils.
 *
 * Un contenu vide n'est jamais adopté en session : il n'y a aucun geste
 * d'utilisateur qui vide une note par le magasin, alors qu'un magasin
 * temporairement vide (note pas encore écrite) effacerait le partagé.
 */
export function isExternalNoteWrite(input: ExternalWriteInput): boolean {
  const stored = input.stored;
  if (!stored) return false;
  if (stored === input.lastWritten) return false;
  if (stored === input.sessionContent) return false;
  return true;
}

// ==================== Contenu à écrire ====================

export interface WriteBackSources {
  /** `session.getTiptapJson` quand une session est vivante, sinon null. */
  getCollabJson: (() => unknown) | null;
  getEditorJson: () => unknown;
  getPlainText: () => string;
}

export interface WriteBackPayload {
  /** Document ProseMirror retenu. */
  doc: unknown;
  json: string;
  plainText: string;
}

/**
 * Compose ce qui part vers le magasin. En session, la source est le CRDT
 * (`getTiptapJson`) : c'est lui qui a convergé. Le repli sur le document de
 * l'éditeur couvre le cas où le fournisseur ne peut pas répondre.
 */
export function computeWriteBack(sources: WriteBackSources): WriteBackPayload {
  let doc: unknown = null;
  if (sources.getCollabJson) {
    try {
      doc = sources.getCollabJson();
    } catch {
      doc = null;
    }
  }
  if (!doc || typeof doc !== 'object') doc = sources.getEditorJson();
  return { doc, json: JSON.stringify(doc), plainText: sources.getPlainText() };
}
