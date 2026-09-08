/**
 * Session de collaboration pour UNE salle — la façade que les éditeurs utilisent.
 *
 * Elle assemble deux choses qui existent séparément : le Y.Doc du gestionnaire
 * de documents et le fournisseur chiffré. L'éditeur n'a donc jamais à connaître
 * ni la clé de salle, ni le WebSocket, ni le format des trames.
 *
 * DEUX RÉGIMES, UNE SEULE FAÇADE :
 *   · note PERSONNELLE — `startCollabSession` / `createCollabSession` : clé
 *     dérivée de la FEK, salle interne au compte, document persisté localement ;
 *   · élément de COFFRE — `startVaultCollabSession` : clé dérivée de K_item,
 *     salle partagée `(vaultId, itemId)`, AUCUNE persistance locale.
 * Tout le reste (références, garde de fusion, contenu à la demande, arrêt,
 * purge) est rigoureusement identique — c'est le but : aucun appelant en aval
 * n'a à savoir dans quel régime il se trouve.
 *
 * TROIS INVARIANTS À TENIR CÔTÉ APPELANTS :
 *
 *  1. Le retour au stockage N'EST PAS ICI. Il y avait deux mécanismes — une
 *     file dans la session et un débounceur dans l'éditeur ; le second est le
 *     seul vivant (il connaît le verrou de notes, la bascule de note et le
 *     vidage au flou). La session ne fait que RENDRE le contenu à la demande
 *     (`getTiptapJson`, `getContentJSON`), elle n'écrit jamais.
 *
 *     En régime coffre s'ajoute une question que la note personnelle ne pose
 *     pas : QUI enregistre, puisque la cible est un objet nuage unique gardé
 *     par un contrôle de version. La réponse est un scrutin sans négociation —
 *     `isSaveResponsible()` ici, la règle complète en tête de `saveElection.ts`.
 *
 *  2. Une note en SESSION VIVANTE ne doit pas être écrasée par la fusion.
 *     `isNoteInLiveSession(noteId)` sert au chemin web ; côté desktop la liste
 *     est publiée au processus principal (`collab:setLiveNotes`) puisque la
 *     fusion y tourne hors du renderer.
 *
 *  3. Le registre COMPTE LES RÉFÉRENCES. La même note ouverte dans deux
 *     panneaux partage une session : elle n'est détruite qu'au dernier
 *     relâchement (`release()`), jamais par le premier panneau qui ferme.
 */

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import yDocManager from '../notes/yDocManager';
import { CollabProvider, type CollabProviderOptions, type CollabStatus } from './collabProvider';
import { clearRoomKey, clearRoomKeys, clearVaultRoomKeys, getVaultRoomKey } from './collabKeys';
import { isCollabEnabled } from './collabFlag';
import { setLiveNotes } from './liveNoteRegistry';
import { vaultRoomId, type VaultRoomRef } from './collabRoom';
import { requestVaultRoomTicket } from './collabTicket';
import {
  electSaveResponsible,
  isSaveResponsible,
  roleCanWrite,
  type CollabRole,
  type SaveCandidate,
} from './saveElection';
import { yXmlFragmentToNoteContent, yXmlFragmentToTiptapDoc, type TiptapDoc } from './yToTiptap';

// ==================== Types ====================

export interface CollabPresence {
  /** Nom affiché à côté du curseur distant. */
  name: string;
  /** Couleur du curseur (hex). */
  color: string;
  /** Identifiant d'appareil, pour distinguer deux onglets du même compte. */
  deviceId?: string;
  /**
   * Rôle dans le coffre (régime coffre). Il voyage dans la présence — donc
   * CHIFFRÉ comme le reste — pour deux usages : afficher un lecteur comme tel,
   * et faire tourner l'élection du pair qui enregistre. Il n'AUTORISE rien :
   * c'est le relais qui refuse l'écriture d'un lecteur.
   */
  role?: CollabRole;
  /**
   * Identifiant du membre (compte). Sert à afficher de VRAIS membres plutôt
   * qu'un appareil : deux fenêtres du même membre partagent cette valeur.
   */
  memberId?: string;
}

/** Ce que la salle d'un élément de coffre demande pour s'ouvrir. */
export interface VaultRoomSource extends VaultRoomRef {
  /**
   * Époque de K_vault de la révision chargée — l'entrée de la dérivation. La
   * RÉVISION n'en fait pas partie : la clé de salle ne doit pas bouger d'un
   * enregistrement à l'autre (voir collabKeys.ts).
   */
  epoch: number;
}

/**
 * État publié à l'éditeur — QUATRE valeurs, et `synced` en est une à part
 * entière.
 *
 * Confondre `connected` (le socket est ouvert) et `synced` (le relais a fini de
 * rejouer son journal) coûtait le contenu de la note : un second appareil qui
 * rejoint une salle déjà garnie voyait « connecté », semait le contenu du
 * magasin dans un document encore vide, puis recevait le rejeu — et tout se
 * retrouvait en double. Le semis n'a le droit de partir qu'à `synced`.
 */
export type SessionStatus = 'connecting' | 'connected' | 'synced' | 'offline' | 'denied';

export function toSessionStatus(status: CollabStatus): SessionStatus {
  switch (status) {
    case 'synced':
      return 'synced';
    case 'connected':
      return 'connected';
    case 'idle':
    case 'connecting':
      return 'connecting';
    // Le refus doit REMONTER : confondu avec « hors ligne », il laissait la
    // session compter comme vivante et l'enregistrement automatique repartir.
    case 'denied':
      return 'denied';
    default:
      // 'offline', 'unavailable' (coffre verrouillé), 'destroyed'
      return 'offline';
  }
}

export interface StartSessionOptions {
  noteId: string;
  profileId: string;
  presence?: CollabPresence;
  onStatus?: (status: SessionStatus) => void;
  /** Passe-plat vers le fournisseur — sert aux tests. */
  providerOptions?: Partial<CollabProviderOptions>;
  /** Ouvre la session même si le drapeau est éteint (tests, diagnostics). */
  force?: boolean;
  /**
   * Présent = régime COFFRE. Il change trois choses, et rien d'autre :
   *   · la clé de salle vient de K_item au lieu de la FEK ;
   *   · le billet est demandé pour `(vaultId, itemId)` au lieu de `(profil, note)` ;
   *   · le document N'EST PAS persisté localement (clair d'un coffre partagé).
   * Tout le reste de la session — références, garde de fusion, contenu à la
   * demande, arrêt — est strictement le même dans les deux régimes.
   */
  vault?: VaultRoomSource;
}

/**
 * Palette des curseurs distants — assez contrastée pour le thème sombre, et
 * stable : deux appareils gardent leur couleur d'une session à l'autre.
 */
const PRESENCE_COLORS = [
  '#e8836b',
  '#6bb5e8',
  '#8ee86b',
  '#e8d16b',
  '#c96be8',
  '#6be8c9',
  '#e86b9f',
  '#9f6be8',
];

/**
 * Carte partagée des données de SALLE — tout sauf le document lui-même.
 *
 * Elle vit dans le même Y.Doc que le contenu (donc chiffrée, relayée et
 * journalisée par le même chemin) mais dans un type de premier niveau distinct
 * du fragment `content` : la modifier ne produit aucune transaction ProseMirror,
 * donc n'est jamais confondue avec une frappe.
 */
const ROOM_STATE_MAP = 'filarr:room';
/** Dernière version de l'élément committée depuis cette salle. */
const COMMITTED_VERSION_KEY = 'committedVersion';
/**
 * Titre écrit par ce commit — le titre n'est PAS dans le document partagé, il
 * part dans les métadonnées de l'élément avec celui qui commite. Sans lui, un
 * pair ne peut pas savoir si son propre renommage a été écrit ou perdu.
 */
const COMMITTED_TITLE_KEY = 'committedTitle';
/**
 * Carte partagée des COMMENTAIRES (Temps 2) — même Y.Doc que le contenu, donc
 * chiffrée, relayée et rejouée par le même chemin ; type de premier niveau
 * distinct du fragment : la modifier n'émet aucune transaction ProseMirror.
 */
const COMMENTS_MAP = 'filarr:comments';
/** Origine des transactions de SEMIS de commentaires — l'observateur l'ignore. */
export const COMMENTS_SEED_ORIGIN = 'filarr:comments-seed';
/** Cadence maximale d'emission du signal « ecrit… » (throttle). */
export const TYPING_HEARTBEAT_MS = 2_000;
/** Effacement du signal apres inactivite locale. */
export const TYPING_IDLE_CLEAR_MS = 3_000;
/** Identifiant OPAQUE de la session d'edition en cours dans cette salle. */
const EDIT_SESSION_ID_KEY = 'editSessionId';
/** Horodatage du dernier save de cette session (LWW du CRDT assume). */
const EDIT_SESSION_LAST_SAVE_KEY = 'editSessionLastSaveAt';

export function presenceColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

// ==================== Session ====================

export class CollabSession {
  readonly noteId: string;
  readonly profileId: string;
  /** Élément de coffre visé, ou `null` pour une note personnelle. */
  readonly vault: VaultRoomRef | null;
  readonly doc: Y.Doc;
  readonly fragment: Y.XmlFragment;
  readonly awareness: Awareness;
  readonly provider: CollabProvider;
  /**
   * Résolue quand la persistance locale a fini de recharger le document.
   * L'éditeur DOIT l'attendre avant de décider de semer : un fragment vide
   * parce qu'IndexedDB n'a pas encore répondu n'est pas un fragment vide.
   */
  readonly whenLoaded: Promise<void>;

  private _destroyed = false;
  private _lastEmittedStatus: SessionStatus = 'connecting';
  private _statusListeners = new Set<(status: SessionStatus) => void>();
  /**
   * LE RELAIS NOUS A-T-IL ÉMIS UN JETON DE LECTEUR ? (F23)
   *
   * `POST /collab/token` sur un coffre GELÉ répond 200 avec `role: 'viewer'` :
   * la salle reste ouverte — on lit, on voit les curseurs — mais elle ne
   * relaiera pas nos écritures. C'est le signal le plus PRÉCOCE qu'un écran
   * puisse avoir sur un gel posé pendant qu'il était ouvert : il arrive au
   * premier renouvellement de jeton, bien avant qu'un enregistrement ne récolte
   * son 409 `vault_frozen`.
   *
   * Faux tant qu'aucun jeton n'a rien dit : une salle personnelle n'inscrit
   * aucun rôle (`role: null`), et une absence n'a jamais valu un verdict.
   */
  private _serverReadOnly = false;
  private _readOnlyListeners = new Set<(readOnly: boolean) => void>();
  /** Dernière présence publiée — la source de NOTRE rôle, jamais le réseau. */
  private _presence: CollabPresence | null = null;
  /**
   * LE RÔLE QUE L'ÉCRAN A DÉCLARÉ, et lui seul — jamais celui d'un jeton.
   *
   * Il existe parce que la dégradation d'un gel est SANS RETOUR sans lui : une
   * fois la présence passée à 'viewer', plus rien ne sait à quoi la ramener au
   * dégel. Le rôle de coffre, lui, n'a pas bougé (Redux le rend nu, gel ou pas),
   * mais il n'est republié qu'au changement d'identité — donc jamais. La session
   * garderait un lecteur à vie : l'élection l'écarterait du scrutin,
   * l'enregistrement automatique mourrait en silence, et seul le bouton
   * « Enregistrer » écrirait encore.
   */
  private _declaredRole: CollabRole | null = null;
  /** Throttle du signal « ecrit… ». */
  private _typingLastSentAt = 0;
  private _typingIdleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: StartSessionOptions) {
    this.noteId = options.noteId;
    this.profileId = options.profileId;
    const vault = options.vault ?? null;
    this.vault = vault ? { vaultId: vault.vaultId, itemId: vault.itemId } : null;

    const managed = yDocManager.getDoc(options.noteId, {
      profileId: options.profileId,
      // Le clair d'un élément de coffre ne s'écrit pas sur ce disque.
      persist: vault === null,
    });
    this.doc = managed.yDoc;
    this.fragment = managed.fragment;
    this.awareness = managed.awareness;
    this.whenLoaded = managed.whenLoaded;

    if (options.presence) this.setPresence(options.presence);

    this.provider = new CollabProvider({
      noteId: options.noteId,
      profileId: options.profileId,
      doc: this.doc,
      awareness: this.awareness,
      onStatus: (status) => this._emitStatus(status),
      // Régime coffre : la clé vient de K_item et le billet de (coffre, élément).
      // Placé AVANT `providerOptions` pour qu'un test puisse toujours injecter.
      ...(vault
        ? {
            resolveKey: () => getVaultRoomKey(vault),
            resolveTicket: () =>
              requestVaultRoomTicket(vault.vaultId, vault.itemId, {}, vault.epoch),
            onTicket: (ticket: { role: string | null }) => this._adoptServerRole(ticket.role),
          }
        : {}),
      ...options.providerOptions,
    });

    if (options.onStatus) this._statusListeners.add(options.onStatus);
  }

  /** État à quatre valeurs, celui que l'interface affiche. */
  get status(): SessionStatus {
    return toSessionStatus(this.provider.status);
  }

  /** État détaillé du transport — diagnostic, réglages avancés. */
  get providerStatus(): CollabStatus {
    return this.provider.status;
  }

  /** Le relais a-t-il fini de rejouer son journal ? */
  get synced(): boolean {
    return this.provider.synced;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  /** Compteurs de diagnostic (trames, échecs de déchiffrement, reconnexions). */
  get stats() {
    return this.provider.stats;
  }

  connect(): void {
    if (this._destroyed) return;
    this.provider.connect();
  }

  // ---------- Présence ----------

  /**
   * La présence publiée PAR L'ÉCRAN. C'est la seule voie par laquelle notre rôle
   * de coffre est déclaré : on la retient (`_declaredRole`) pour savoir à quoi
   * revenir quand un gel l'aura dégradée.
   */
  setPresence(presence: CollabPresence): void {
    if (this._destroyed) return;
    this._declaredRole = presence.role ?? null;
    this._setPresenceInternal(presence);
  }

  /**
   * Le corps de `setPresence`, SANS la déclaration. La restauration d'un dégel
   * passe par ici : elle ne doit pas se prendre elle-même pour une annonce du
   * client, sinon le rôle de référence dériverait vers celui du dernier jeton.
   */
  private _setPresenceInternal(presence: CollabPresence): void {
    if (this._destroyed) return;
    this._presence = presence;
    this.awareness.setLocalStateField('user', {
      name: presence.name,
      color: presence.color,
      deviceId: presence.deviceId ?? null,
      role: presence.role ?? null,
      memberId: presence.memberId ?? null,
    });
  }

  /** Présence locale telle qu'on l'a publiée (diagnostic, réémission). */
  getPresence(): CollabPresence | null {
    return this._presence;
  }

  /** Pairs actuellement dans la salle, nous exclus. */
  getPeers(): Array<{ clientId: number; user: CollabPresence | null }> {
    const peers: Array<{ clientId: number; user: CollabPresence | null }> = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const user = (state?.user ?? null) as CollabPresence | null;
      peers.push({ clientId, user });
    });
    return peers;
  }

  // ---------- Élection du pair qui enregistre ----------

  /**
   * La salle entière vue depuis ici, pair local COMPRIS — l'entrée du scrutin.
   * Un pair qui n'a pas encore publié son rôle est compté comme non-écrivain :
   * mieux vaut désigner quelqu'un d'autre que d'attendre un pair muet.
   */
  getSaveCandidates(): SaveCandidate[] {
    const candidates: SaveCandidate[] = [];
    this.awareness.getStates().forEach((state, clientId) => {
      const user = (state?.user ?? null) as { role?: unknown } | null;
      candidates.push({ clientId, canWrite: roleCanWrite(user?.role as string | undefined) });
    });
    if (!candidates.some((c) => c.clientId === this.awareness.clientID)) {
      // La présence locale n'est pas encore posée : on s'ajoute quand même, avec
      // notre rôle réel, sinon on s'exclurait du scrutin qu'on est en train de
      // faire tourner.
      candidates.push({
        clientId: this.awareness.clientID,
        canWrite: roleCanWrite(this._presence?.role),
      });
    }
    return candidates;
  }

  /** Le `clientId` du responsable, ou `null` si personne ne peut écrire. */
  getSaveResponsible(): number | null {
    return electSaveResponsible(this.getSaveCandidates());
  }

  /**
   * QUI SÈME la salle quand elle arrive vide — un second scrutin, distinct.
   *
   * Le problème est le symétrique de celui de l'enregistrement : deux pairs qui
   * ouvrent en même temps un élément dont la salle est vide y verseraient
   * chacun le corps déchiffré, et le CRDT — qui ne perd jamais rien — garderait
   * LES DEUX. La note apparaîtrait en double.
   *
   * Même règle que pour l'enregistrement (le plus petit identifiant), à une
   * différence près, et elle compte : LE RÔLE N'ENTRE PAS DANS CE SCRUTIN. Une
   * salle qui ne contiendrait que des lecteurs n'aurait sinon personne pour la
   * semer, et ils regarderaient tous un document vide au lieu de la note qu'ils
   * ont le droit de lire. Semer n'écrit rien dans le coffre : c'est un geste
   * local, sans permission à demander.
   */
  getSeedResponsible(): number | null {
    let elected: number | null = null;
    for (const candidate of this.getSaveCandidates()) {
      if (!Number.isFinite(candidate.clientId)) continue;
      if (elected === null || candidate.clientId < elected) elected = candidate.clientId;
    }
    return elected;
  }

  /** Est-ce à NOUS de verser le corps déchiffré dans une salle vide ? */
  isSeedResponsible(): boolean {
    return this.getSeedResponsible() === this.awareness.clientID;
  }

  /**
   * Sommes-nous LE pair qui enregistre ?
   *
   * `settled` reste à l'appelant : lui seul sait si la présence a eu le temps
   * d'arriver (voir `SAVE_ELECTION_SETTLE_MS`).
   *
   * LE DÉFAUT DU DÉFAUT — « hors ligne » ne vaut PAS stabilisé pour un élément de
   * coffre. Le raisonnement « sans canal, nous sommes seuls par construction »
   * est vrai d'une note PERSONNELLE, dont la vérité durable est un fichier local
   * que personne d'autre n'écrit. Il est faux d'un élément de coffre : sa vérité
   * est un objet nuage que les autres membres atteignent par une TOUTE AUTRE voie
   * (l'API des coffres), parfaitement joignable pendant que le relais, lui, ne
   * l'est pas. Deux pairs hors ligne se croyaient donc seuls, s'élisaient tous
   * les deux et poussaient tous les deux — 409 `item_version_conflict` au second.
   *
   * C'est le pendant exact de ce que le fournisseur a déjà fermé pour le REFUS
   * d'accès (`denied`, collabProvider.ts) : là aussi, « hors ligne compte comme
   * stabilisé » fabriquait un élu solitaire qui écrivait dans le vide.
   */
  isSaveResponsible(
    settled = this.vault
      ? this.status === 'synced'
      : this.status === 'synced' || this.status === 'offline'
  ): boolean {
    return isSaveResponsible({
      localClientId: this.awareness.clientID,
      candidates: this.getSaveCandidates(),
      localCanWrite: roleCanWrite(this._presence?.role),
      settled,
    });
  }

  // ---------- Version committée, en circulation ----------

  /**
   * LA VERSION DE RÉFÉRENCE EST UNE DONNÉE DE SALLE, PAS UNE DONNÉE DE PAIR.
   *
   * L'écriture d'un élément de coffre est gardée par un contrôle de version
   * (`expectedVersion` → 409). Seul l'élu écrit, donc seul l'élu voyait sa
   * version de référence avancer : les autres restaient sur celle de leur
   * chargement. Promu après le départ de l'élu, un pair repartait alors avec une
   * version périmée — 409 à son premier enregistrement, puis à tous les
   * suivants, indéfiniment. Autrement dit : le travail de la salle devenait
   * INÉCRIVABLE dès que l'élu partait.
   *
   * La version committée circule donc dans une petite carte partagée du même
   * Y.Doc — donc chiffrée comme tout le reste, et REJOUÉE au retardataire
   * puisque le relais la journalise avec les autres mises à jour. Elle ne
   * recule jamais : chaque côté ignore une valeur qui ne dépasse pas la sienne,
   * ce qui rend la fusion CRDT (dernier écrivain gagnant) sans conséquence.
   *
   * Ce n'est pas une autorité : le serveur reste l'arbitre. C'est un raccourci
   * pour éviter à chaque pair de redécouvrir par un 409 ce qu'un autre sait
   * déjà.
   */
  private _roomState(): Y.Map<unknown> {
    return this.doc.getMap(ROOM_STATE_MAP);
  }

  /**
   * Annonce la version que NOUS venons de committer. Régime coffre uniquement.
   *
   * LE TITRE VOYAGE AVEC ELLE, ET C'EST UNE CORRECTION DE PERTE. Le titre d'une
   * note de coffre n'est PAS dans le document partagé : il vit dans les
   * métadonnées de l'élément, et chaque commit emporte celui de son auteur.
   * Annoncer la version seule laissait les autres pairs déclarer « enregistré »
   * un renommage que ce commit n'avait pas écrit — pastille verte sur un titre
   * disparu — et, symétriquement, réécrire au commit suivant le titre qu'ils
   * n'avaient jamais reçu. La valeur est le titre BRUT rogné (jamais le
   * « Sans titre » de repli, qui est traduit : il traverserait la salle dans la
   * langue de son auteur).
   */
  publishCommittedVersion(version: number, title?: string): void {
    if (this._destroyed || !this.vault) return;
    if (!Number.isFinite(version)) return;
    const current = this.getCommittedVersion();
    if (current !== null && version <= current) return;
    // Une seule transaction : un pair ne doit jamais voir la nouvelle version
    // avec l'ancien titre — il conclurait que son renommage est parti.
    this.doc.transact(() => {
      this._roomState().set(COMMITTED_VERSION_KEY, version);
      if (typeof title === 'string') this._roomState().set(COMMITTED_TITLE_KEY, title);
    });
  }

  /** Dernière version committée connue de la salle, ou `null`. */
  getCommittedVersion(): number | null {
    const raw = this._roomState().get(COMMITTED_VERSION_KEY);
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  }

  /**
   * Titre écrit par le dernier commit annoncé, ou `null` — « la salle ne l'a pas
   * dit », ce qui reste vrai face à un pair d'une version antérieure.
   */
  getCommittedTitle(): string | null {
    const raw = this._roomState().get(COMMITTED_TITLE_KEY);
    return typeof raw === 'string' ? raw : null;
  }

  /** S'abonne aux annonces de version — y compris aux nôtres, qui sont idempotentes. */
  onCommittedVersion(listener: (version: number, title: string | null) => void): () => void {
    const map = this._roomState();
    const handler = () => {
      const version = this.getCommittedVersion();
      if (version === null) return;
      try {
        listener(version, this.getCommittedTitle());
      } catch {
        /* un abonné qui lève ne casse pas la salle */
      }
    };
    map.observe(handler);
    return () => {
      try {
        map.unobserve(handler);
      } catch {
        /* document déjà détruit */
      }
    };
  }

  // ---------- Commentaires (Temps 2) ----------

  /** La carte partagée des commentaires — voir COMMENTS_MAP. */
  getCommentsMap(): Y.Map<unknown> {
    return this.doc.getMap(COMMENTS_MAP);
  }

  /** Photo JSON de la carte — à passer par sanitizeCommentMap avant l'écran. */
  getCommentsJSON(): Record<string, unknown> {
    return this.getCommentsMap().toJSON() as Record<string, unknown>;
  }

  /** Écrit/réécrit UN commentaire — l'objet ENTIER (LWW au grain de la clé). */
  setComment(comment: { id: string } & object): void {
    if (this._destroyed) return;
    this.getCommentsMap().set(comment.id, { ...comment });
  }

  /**
   * Verse un lot de commentaires (le SEMIS d'une salle vide) sous l'origine
   * dédiée COMMENTS_SEED_ORIGIN, que l'observateur du poseur ignore — un semis
   * n'est pas une frappe et ne doit jamais retenir sa fenêtre.
   */
  seedComments(comments: Record<string, { id: string } & object>): void {
    if (this._destroyed) return;
    const map = this.getCommentsMap();
    this.doc.transact(() => {
      for (const c of Object.values(comments)) map.set(c.id, { ...c });
    }, COMMENTS_SEED_ORIGIN);
  }

  /**
   * S'abonne aux changements de la carte. `local` = la transaction vient de CE
   * client ; `origin` permet d'écarter le semis. Un abonné qui lève ne casse
   * pas la salle (même contrat qu'onCommittedVersion).
   */
  onComments(listener: (info: { local: boolean; origin: unknown }) => void): () => void {
    const map = this.getCommentsMap();
    const handler = (_event: Y.YMapEvent<unknown>, transaction: Y.Transaction) => {
      try {
        listener({ local: transaction.local, origin: transaction.origin });
      } catch {
        /* un abonné qui lève ne casse pas la salle */
      }
    };
    map.observe(handler);
    return () => {
      try {
        map.unobserve(handler);
      } catch {
        /* document déjà détruit */
      }
    };
  }

  // ---------- « Untel ecrit… » (typing) ----------

  /**
   * Signale que CE client tape. Champ d'awareness DEDIE 'typing' — JAMAIS dans
   * 'user' : setPresence reecrit 'user' en bloc et ecraserait le signal, et
   * l'election (getSaveCandidates) ne lit que 'user', donc reste insensible.
   * La valeur emise n'est qu'un NONCE (Date.now()) : le recepteur date la
   * reception d'un CHANGEMENT avec sa propre horloge, il ne compare jamais
   * l'horloge du pair a la sienne.
   */
  notifyTyping(): void {
    if (this._destroyed) return;
    const now = Date.now();
    if (now - this._typingLastSentAt >= TYPING_HEARTBEAT_MS) {
      this._typingLastSentAt = now;
      try {
        this.awareness.setLocalStateField('typing', now);
      } catch {
        /* awareness deja detruite */
      }
    }
    if (this._typingIdleTimer) clearTimeout(this._typingIdleTimer);
    this._typingIdleTimer = setTimeout(() => {
      this._typingIdleTimer = null;
      if (this._destroyed) return;
      try {
        this.awareness.setLocalStateField('typing', null);
      } catch {
        /* awareness deja detruite */
      }
    }, TYPING_IDLE_CLEAR_MS);
  }

  // ---------- Session d'edition (confort phase 3) ----------

  /**
   * L'identifiant de session que la salle porte — tous les sauveurs successifs
   * ecrivent le MEME id tant que la fraicheur (EDIT_SESSION_GAP_MS, cote
   * appelant) le permet. Regime coffre uniquement, comme committedVersion.
   */
  getRoomEditSession(): { id: string; lastSaveAt: number } | null {
    if (!this.vault) return null;
    const state = this._roomState();
    const id = state.get(EDIT_SESSION_ID_KEY);
    const lastSaveAt = state.get(EDIT_SESSION_LAST_SAVE_KEY);
    if (typeof id !== 'string' || id.length === 0) return null;
    if (typeof lastSaveAt !== 'number' || !Number.isFinite(lastSaveAt)) return null;
    return { id, lastSaveAt };
  }

  /** Publie l'id de session apres un commit reussi (seul l'elu ecrit en regime normal). */
  publishRoomEditSession(id: string, lastSaveAt: number): void {
    if (this._destroyed || !this.vault) return;
    if (typeof id !== 'string' || id.length === 0 || !Number.isFinite(lastSaveAt)) return;
    const state = this._roomState();
    state.set(EDIT_SESSION_ID_KEY, id);
    state.set(EDIT_SESSION_LAST_SAVE_KEY, lastSaveAt);
  }

  // ---------- Contenu, à la demande ----------

  /** Contenu courant sérialisé — la forme de `Note.content`. */
  getContentJSON(): string {
    return yXmlFragmentToNoteContent(this.fragment);
  }

  getContentDoc(): TiptapDoc {
    return yXmlFragmentToTiptapDoc(this.fragment);
  }

  /**
   * Alias attendu par le retour au stockage de l'éditeur : le document TipTap
   * du CRDT, celui qui a convergé, prêt à être sérialisé et écrit dans le
   * magasin de notes. NOUS N'ÉCRIVONS PAS — c'est l'éditeur qui persiste.
   */
  getTiptapJson(): TiptapDoc {
    return yXmlFragmentToTiptapDoc(this.fragment);
  }

  onStatusChange(listener: (status: SessionStatus) => void): () => void {
    this._statusListeners.add(listener);
    return () => {
      this._statusListeners.delete(listener);
    };
  }

  /** Alias court, celui qu'utilise le crochet React de l'éditeur. */
  onStatus(listener: (status: SessionStatus) => void): () => void {
    return this.onStatusChange(listener);
  }

  /**
   * Le relais nous tient-il pour un LECTEUR ? (F23 — coffre gelé.)
   *
   * Lu à l'abonnement autant qu'écouté : une session est PARTAGÉE entre ses
   * détenteurs et le jeton peut être arrivé bien avant qu'un second panneau ne
   * s'abonne. S'en remettre au seul évènement laisserait ce panneau-là en
   * édition sur un coffre gelé, jusqu'au prochain renouvellement de jeton.
   */
  get serverReadOnly(): boolean {
    return this._serverReadOnly;
  }

  onServerReadOnly(listener: (readOnly: boolean) => void): () => void {
    this._readOnlyListeners.add(listener);
    return () => {
      this._readOnlyListeners.delete(listener);
    };
  }

  // ---------- Fin ----------

  /**
   * Rend UNE référence. La session ne meurt qu'au dernier relâchement — c'est
   * ce que doivent appeler les vues (mode scindé compris), jamais `destroy()`.
   */
  release(): void {
    releaseCollabSession(this);
  }

  /**
   * Ferme la session pour de bon, quel que soit le nombre de détenteurs :
   * fournisseur détruit, clé de salle oubliée, document relâché.
   *
   * `keepDoc: true` garde le Y.Doc au chaud dans le gestionnaire (rouverture
   * immédiate de la même note). Le DÉFAUT est de le relâcher : garder le
   * document à chaque changement de note, avec sa persistance IndexedDB, était
   * une fuite pure — aucun appelant ne passait jamais l'option.
   */
  destroy(options: { keepDoc?: boolean } = {}): void {
    if (this._destroyed) return;
    this._destroyed = true;

    // Le signal « ecrit… » ne doit pas survivre a la session : timer coupe,
    // champ efface AVANT la destruction de l'awareness.
    if (this._typingIdleTimer) {
      clearTimeout(this._typingIdleTimer);
      this._typingIdleTimer = null;
    }
    try {
      this.awareness.setLocalStateField('typing', null);
    } catch {
      /* awareness deja detruite */
    }

    this.provider.destroy();
    this._statusListeners.clear();
    this._readOnlyListeners.clear();

    clearRoomKey(this.noteId);
    if (options.keepDoc !== true) {
      yDocManager.releaseDoc(this.noteId, this.profileId);
    }
    _sessions.delete(sessionKey(this.profileId, this.noteId));
    publishLiveSessions();
  }

  // ---------- Interne ----------

  /**
   * Le relais a inscrit un rôle dans le jeton : c'est LUI qui fait autorité sur
   * ce que la salle acceptera de relayer. On ne l'adopte que dans le sens
   * RESTRICTIF — un rôle serveur plus faible que le nôtre nous retire du
   * scrutin. L'inverse (le serveur nous accorde plus que ce que notre état
   * local croit) ne change rien ici : ce n'est pas au client de s'élargir des
   * droits, et notre écriture serait de toute façon arbitrée par le serveur.
   */
  private _adoptServerRole(role: string | null): void {
    if (this._destroyed || !role) return;
    /**
     * LE VERDICT DU SERVEUR EST PUBLIÉ MÊME QUAND NOTRE PRÉSENCE NE BOUGE PAS.
     *
     * Ce sont deux choses distinctes, et les confondre coûtait le signal :
     * `_presence.role` est ce que les AUTRES voient de nous — il ne se dégrade
     * que dans le sens restrictif, et jamais si notre présence n'est pas encore
     * publiée ; `_serverReadOnly` est un fait sur la SALLE, vrai pour tous ses
     * membres à la fois quand le coffre est gelé. L'écran a besoin du second
     * pour passer en lecture seule sans attendre un refus d'écriture.
     *
     * Il se lève DANS LES DEUX SENS : un dégel rend un jeton de membre au
     * renouvellement suivant, et l'éditeur doit se rouvrir tout seul — un état
     * de lecture seule qu'aucun signal ne peut annuler serait une session à
     * fermer et rouvrir à la main.
     */
    const readOnly = !roleCanWrite(role);
    if (readOnly !== this._serverReadOnly) {
      this._serverReadOnly = readOnly;
      for (const listener of this._readOnlyListeners) {
        try {
          listener(readOnly);
        } catch {
          /* un abonné qui lève ne casse pas la session */
        }
      }
    }
    /**
     * LA PRÉSENCE AUSSI SE LÈVE DANS LES DEUX SENS, et pour la même raison : ce
     * qu'elle porte n'est pas décoratif, c'est l'entrée du scrutin
     * (`getSaveCandidates`, `isSaveResponsible`). Descendue à 'viewer' par un
     * gel et jamais relevée, elle laisse un admin dégelé taper dans un éditeur
     * ré-ouvert dont plus aucun enregistrement automatique ne part.
     *
     * On remonte au rôle DÉCLARÉ, jamais à celui du jeton : le serveur dit ce
     * qu'on a le droit de faire MAINTENANT, pas quel rang on tient — et se
     * hisser au rang qu'il annonce serait exactement l'élargissement que le
     * sens restrictif refuse.
     */
    if (!this._presence) return;
    if (roleCanWrite(this._presence.role) && !roleCanWrite(role)) {
      this._setPresenceInternal({ ...this._presence, role: role as CollabRole });
    } else if (
      !roleCanWrite(this._presence.role) &&
      roleCanWrite(role) &&
      roleCanWrite(this._declaredRole)
    ) {
      this._setPresenceInternal({ ...this._presence, role: this._declaredRole as CollabRole });
    }
  }

  private _emitStatus(status: CollabStatus): void {
    const mapped = toSessionStatus(status);
    if (mapped === this._lastEmittedStatus) return;
    this._lastEmittedStatus = mapped;
    for (const listener of this._statusListeners) {
      try {
        listener(mapped);
      } catch {
        /* un abonné qui lève ne casse pas la session */
      }
    }
  }
}

// ==================== Registre ====================

interface SessionEntry {
  session: CollabSession;
  /** Détenteurs — deux panneaux sur la même note en comptent deux. */
  refs: number;
}

/**
 * Indexé par `{profileId}:{noteId}` et pas par le seul noteId : après un
 * changement de profil, la même note n'est pas la même note.
 */
const _sessions = new Map<string, SessionEntry>();

function sessionKey(profileId: string, noteId: string): string {
  return `${profileId}:${noteId}`;
}

function findEntryByNote(noteId: string): SessionEntry | null {
  for (const entry of _sessions.values()) {
    if (entry.session.noteId === noteId) return entry;
  }
  return null;
}

/**
 * Ouvre (ou récupère) la session d'une note, EN COMPTANT UNE RÉFÉRENCE.
 * Retourne `null` quand le drapeau est éteint — l'appelant retombe alors sur le
 * mode actuel sans rien changer. Chaque appel doit être soldé par `release()`.
 */
export function startCollabSession(options: StartSessionOptions): CollabSession | null {
  /**
   * LE DRAPEAU NE GOUVERNE QUE LE RÉGIME PERSONNEL, et c'est ce que son
   * intitulé promet depuis le premier jour : « Édition vivante entre MES
   * APPAREILS ». Une note personnelle a pour vérité un fichier local ; la salle
   * y est un confort, et ouvrir un canal permanent vers un relais mérite un
   * consentement — le réglage reste donc entier pour elle.
   *
   * Un élément de COFFRE ne pose pas la même question. Sa vérité est un objet
   * nuage unique gardé par un compare-and-set : sans salle, deux membres
   * l'écrivent à l'aveugle et le second découvre le travail du premier par un
   * 409. Le défaut a été rapporté tel quel après un essai réel — « à deux,
   * l'écriture ne fonctionne pas » — et sa cause était ici : la salle
   * n'existait jamais, faute d'un interrupteur que rien n'invitait à allumer.
   * La raison d'être du réglage (« ce relais apprend quels appareils éditent
   * quoi ») ne s'applique d'ailleurs pas de la même façon : l'API des coffres
   * apprend déjà chaque enregistrement, son instant et sa taille.
   */
  const governedByFlag = !options.vault;
  if (!options.force && governedByFlag && !isCollabEnabled()) return null;

  const key = sessionKey(options.profileId, options.noteId);
  const existing = _sessions.get(key);
  if (existing) {
    existing.refs += 1;
    if (options.presence) existing.session.setPresence(options.presence);
    // `onStatus` n'est PAS ré-abonné ici : il n'aurait pas de désabonnement, et
    // un second panneau doit passer par `onStatusChange` (qui en rend un).
    return existing.session;
  }

  const session = new CollabSession(options);
  _sessions.set(key, { session, refs: 1 });
  session.connect();
  publishLiveSessions();
  return session;
}

/**
 * Fabrique attendue par l'éditeur (`useCollabSession`).
 *
 * Même chose que `startCollabSession` avec la forme d'appel du crochet React —
 * `user: { name, color }` plutôt qu'un objet de présence. Retourne `null` quand
 * le drapeau est éteint ou qu'aucun profil n'est actif : l'appelant retombe
 * alors sur le mode actuel, sans qu'aucune édition ne soit empêchée.
 */
export function createCollabSession(input: {
  noteId: string;
  profileId: string;
  user: { name: string; color: string; deviceId?: string };
  providerOptions?: Partial<CollabProviderOptions>;
  force?: boolean;
}): CollabSession | null {
  if (!input.noteId || !input.profileId) return null;
  return startCollabSession({
    noteId: input.noteId,
    profileId: input.profileId,
    presence: {
      name: input.user.name,
      color: input.user.color,
      deviceId: input.user.deviceId,
    },
    providerOptions: input.providerOptions,
    force: input.force,
  });
}

/**
 * Ouvre (ou récupère) la session d'un ÉLÉMENT DE COFFRE.
 *
 * Même façade, même comptage de références, même garde de fusion : seule
 * l'identité de la salle et l'origine de la clé changent. Retourne `null`
 * quand le drapeau est éteint, qu'aucun profil n'est actif, ou que les
 * identifiants ne composent pas un nom de salle valide — dans tous les cas
 * l'appelant retombe sur l'édition locale, qui n'est jamais empêchée.
 */
export function startVaultCollabSession(input: {
  vaultId: string;
  itemId: string;
  epoch: number;
  profileId: string;
  presence?: CollabPresence;
  onStatus?: (status: SessionStatus) => void;
  providerOptions?: Partial<CollabProviderOptions>;
  force?: boolean;
}): CollabSession | null {
  if (!input.profileId) return null;
  let roomId: string;
  try {
    roomId = vaultRoomId(input.vaultId, input.itemId);
  } catch {
    return null;
  }
  return startCollabSession({
    noteId: roomId,
    profileId: input.profileId,
    presence: input.presence,
    onStatus: input.onStatus,
    providerOptions: input.providerOptions,
    force: input.force,
    vault: {
      vaultId: input.vaultId,
      itemId: input.itemId,
      epoch: input.epoch,
    },
  });
}

export function getCollabSession(noteId: string): CollabSession | null {
  return findEntryByNote(noteId)?.session ?? null;
}

/** La session d'un élément de coffre, si elle existe. */
export function getVaultCollabSession(vaultId: string, itemId: string): CollabSession | null {
  try {
    return getCollabSession(vaultRoomId(vaultId, itemId));
  } catch {
    return null;
  }
}

/** Détenteurs d'une session (diagnostic et tests du mode scindé). */
export function collabSessionRefCount(noteId: string): number {
  return findEntryByNote(noteId)?.refs ?? 0;
}

/**
 * Rend une référence. Le dernier relâchement détruit vraiment la session ; les
 * précédents ne font que décompter — c'est la règle du mode scindé.
 */
export function releaseCollabSession(target: CollabSession | string): void {
  const entry =
    typeof target === 'string'
      ? findEntryByNote(target)
      : (_sessions.get(sessionKey(target.profileId, target.noteId)) ?? null);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  entry.session.destroy();
}

/** Ferme une session quel que soit le nombre de détenteurs (verrouillage, tests). */
export function stopCollabSession(noteId: string, options?: { keepDoc?: boolean }): void {
  const entry = findEntryByNote(noteId);
  if (!entry) return;
  entry.session.destroy(options);
}

export function stopAllCollabSessions(options?: { keepDoc?: boolean }): void {
  for (const entry of Array.from(_sessions.values())) {
    entry.session.destroy(options);
  }
  _sessions.clear();
  publishLiveSessions();
}

/**
 * LA GARDE DE LA FUSION.
 *
 * Vraie quand une note est en session vivante : son contenu durable est en
 * train d'être produit par le CRDT, et un chemin de fusion qui la réécrirait
 * depuis un instantané nuage ferait perdre les frappes en cours.
 *
 * Câblée des deux côtés :
 *   - web     : `src/platform/web/sync/readSync.ts` → `installNotes` ;
 *   - desktop : la liste part au processus principal (`collab:setLiveNotes`),
 *               et `electron/sync/syncService.ts` la fait respecter.
 * Une note vivante n'est jamais remplacée par le résultat d'une fusion :
 * l'arbitrage est REPORTÉ au premier cycle qui suit la fin de la session.
 */
export function isNoteInLiveSession(noteId: string): boolean {
  const entry = findEntryByNote(noteId);
  return !!entry && !entry.session.destroyed && entry.session.providerStatus !== 'destroyed';
}

/**
 * Identifiants des NOTES PERSONNELLES en session vivante (garde de fusion).
 *
 * Les salles de coffre en sont exclues, pour deux raisons : la fusion
 * `notes.enc` ne les concerne pas (leur vérité est l'élément nuage, gardé par
 * son contrôle de version), et cette liste part au processus principal — un
 * identifiant de coffre n'a rien à y faire.
 */
export function liveSessionNoteIds(): string[] {
  const ids: string[] = [];
  for (const entry of _sessions.values()) {
    if (entry.session.destroyed) continue;
    if (entry.session.vault) continue;
    ids.push(entry.session.noteId);
  }
  return ids;
}

// ==================== Publication vers le processus principal ====================

/**
 * Côté desktop, la fusion tourne dans le processus principal : il ne peut pas
 * interroger ce registre. La liste lui est donc POUSSÉE à chaque démarrage et
 * à chaque arrêt de session, et rafraîchie périodiquement tant qu'une session
 * vit — un renderer qui meurt en cours d'édition laisserait sinon une garde
 * éternelle côté main (voir la péremption dans `electron/sync/liveNotes.ts`).
 */
const LIVE_NOTES_HEARTBEAT_MS = 45_000;
let _heartbeat: ReturnType<typeof setInterval> | null = null;

function liveNotesBridge(): { invoke: (channel: string, ...args: unknown[]) => unknown } | null {
  try {
    const ipc = typeof window !== 'undefined' ? window.electron?.ipcRenderer : undefined;
    if (!ipc || typeof ipc.invoke !== 'function') return null;
    return ipc as unknown as { invoke: (channel: string, ...args: unknown[]) => unknown };
  } catch {
    return null;
  }
}

export function publishLiveSessions(): void {
  const ids = liveSessionNoteIds();
  // Miroir local d'abord : c'est lui que lit la fusion du moteur web, et il ne
  // dépend d'aucun pont IPC.
  setLiveNotes(ids);

  const bridge = liveNotesBridge();
  if (!bridge) return;
  try {
    void Promise.resolve(bridge.invoke('collab:setLiveNotes', ids)).catch(() => undefined);
  } catch {
    /* canal absent de l'allowlist preload : la garde desktop reste inactive */
  }
  if (ids.length === 0) {
    if (_heartbeat !== null) {
      clearInterval(_heartbeat);
      _heartbeat = null;
    }
    return;
  }
  if (_heartbeat === null) {
    _heartbeat = setInterval(() => publishLiveSessions(), LIVE_NOTES_HEARTBEAT_MS);
  }
}

// ==================== Purge ====================

/**
 * À appeler PARTOUT où la FEK quitte la mémoire — verrouillage, changement de
 * profil, effacement à distance, déconnexion.
 *
 * Sans elle, les clés de salle survivaient au verrouillage (elles dérivent de
 * la FEK, donc les garder revenait à garder de quoi déchiffrer le trafic) et
 * les sessions continuaient d'émettre le contenu d'un coffre censé être fermé.
 */
/**
 * À appeler PARTOUT où K_vault d'UN coffre quitte la mémoire — `lockVault()` :
 * départ du coffre, retrait constaté au rafraîchissement, auto-retrait.
 *
 * Le pendant, à l'échelle d'un coffre, de `purgeCollabOnKeyLoss()`. Sans elle,
 * verrouiller un coffre laissait ses salles ouvertes (elles continuaient
 * d'émettre le contenu d'un coffre censé être fermé) et leurs clés en mémoire,
 * alors que l'en-tête de `collabKeys.ts` promet exactement l'inverse. Les
 * salles personnelles et celles des AUTRES coffres ne sont pas touchées.
 */
export function purgeVaultCollab(vaultId: string): void {
  if (!vaultId) return;
  for (const entry of Array.from(_sessions.values())) {
    if (entry.session.vault?.vaultId !== vaultId) continue;
    try {
      entry.session.destroy();
    } catch {
      /* une session déjà cassée ne doit pas empêcher la purge des clés */
    }
  }
  clearVaultRoomKeys(vaultId);
}

export function purgeCollabOnKeyLoss(): void {
  try {
    stopAllCollabSessions();
  } catch {
    /* une session déjà cassée ne doit pas empêcher la purge des clés */
  }
  try {
    // Filet : un document ouvert hors session (aperçu, note fermée trop vite).
    yDocManager.destroyAll();
  } catch {
    /* rien à détruire */
  }
  clearRoomKeys();
}
