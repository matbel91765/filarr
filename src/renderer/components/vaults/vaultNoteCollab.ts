/**
 * Vault-note live collaboration — the decisions, kept OUT of the component.
 *
 * Same split as vaultNoteEditorSync.ts, for the same reason: the rules that
 * decide WHEN a room opens and WHO writes back are the ones worth testing, and
 * they must exist in exactly one place. The component only wires them.
 *
 * THE ONE RULE TO KEEP IN MIND, because everything here bends to it: a vault
 * note's durable truth is a single cloud object behind a compare-and-set guard,
 * NOT a local file. A live room converges N peers onto one document, so N peers
 * end up holding an identical text they would all like to save. Exactly one of
 * them may — see `saveElection.ts` for the ballot. Everything below is the
 * plumbing around that: when to even open the room, when a save is allowed to
 * fire, and what to fall back to when any of it is unavailable.
 */

import { roleCanWrite, type CollabRole } from '../../../services/collab/saveElection';

/** Debounce of the collaborative write-back, in ms.
 *
 *  Deliberately far slower than the personal editor's 2 s: every save here is a
 *  full re-encrypt (fresh K_item), a staged revision upload and a compare-and-set
 *  commit. Saving on every lull would burn quota and version numbers for nothing —
 *  the CRDT already holds the text for every peer in the meantime, and the relay's
 *  journal holds it for anyone joining late. */
export const VAULT_COLLAB_SAVE_DEBOUNCE_MS = 6_000;

// ── Opening the room ─────────────────────────────────────────────────────────

export interface VaultRoomGateInput {
  /** Is the item's body decrypted and mounted? A room without a document is noise. */
  bodyReady: boolean;
  /** Vault unlocked in this session (K_vault held for the item's epoch). */
  vaultUnlocked: boolean;
  /** Item kind — only notes have a CRDT document. */
  /** L'appelant affirme que ce contenu est un document CRDT (note, ou éditeur de greffon). */
  collabEligible: boolean;
  /**
   * Epoch of K_vault the MOUNTED body was sealed under. Null until one is, and
   * it is the room key's only input besides the (vault, item) pair — the wrap of
   * the revision is deliberately not, or every save would re-key the room.
   */
  epoch: number | null;
  /** Active local profile — scopes the Y.Doc registry. */
  profileId: string | null;
}

/**
 * Whether to open a room at all.
 *
 * AUCUN DRAPEAU DE RÉGLAGE ICI, ET C'EST UNE CORRECTION, PAS UN OUBLI.
 *
 * Cette garde a longtemps commencé par `filarr-live-collab` — le réglage
 * « Édition vivante entre MES APPAREILS », éteint par défaut. Le défaut que
 * cela produisait a été rapporté après un essai réel, en ces termes : « à deux,
 * l'écriture ne fonctionne pas ». Elle ne fonctionnait pas parce qu'AUCUNE SALLE
 * NE S'OUVRAIT JAMAIS : personne n'avait de raison d'aller allumer, dans les
 * réglages de sécurité, une option qui promet de synchroniser ses propres
 * appareils, pour écrire à deux dans un coffre partagé.
 *
 * Les deux régimes ne posent pas la même question, et c'est pour cela que la
 * réponse diffère :
 *  · une note PERSONNELLE a pour vérité un fichier local. La salle y est un
 *    CONFORT — voir son curseur passer d'une machine à l'autre — et ouvrir un
 *    canal permanent vers un relais mérite un consentement explicite. Le réglage
 *    garde là tout son sens, et `startCollabSession` continue de le lire ;
 *  · un élément de COFFRE a pour vérité un objet nuage unique, gardé par un
 *    compare-and-set. Sans salle, deux membres l'écrivent à l'aveugle : le
 *    second récolte un 409 et découvre le travail de l'autre par un refus.
 *    Éteindre la salle ne rend donc pas la collaboration privée, elle la rend
 *    SILENCIEUSEMENT CONFLICTUELLE. Ce n'est pas un choix qu'on peut offrir sous
 *    l'étiquette d'un confort.
 *
 * Ce que le relais apprend au passage — quel appareil édite quel élément, quand,
 * et la taille des trames — l'API des coffres l'apprend déjà de toute façon à
 * chaque enregistrement. Le CONTENU, lui, reste chiffré de bout en bout des deux
 * côtés.
 *
 * A VIEWER IS NOT EXCLUDED HERE, on purpose. They join, they see the others'
 * cursors, the others see them marked as read-only, and they simply never write.
 * Excluding them would be the easy read of "a reader must never save" — and it
 * would cost them the whole point of the feature (watching the note being
 * written). The write ban is enforced where writes happen, not at the door.
 */
export function shouldOpenVaultRoom(input: VaultRoomGateInput): boolean {
  if (!input.bodyReady) return false;
  if (!input.vaultUnlocked) return false;
  /**
   * ÉLIGIBLE, PAS « NOTE ». Le test `itemType !== 'note'` était LE point de
   * couplage entre le pipeline collaboratif — pourtant générique de bout en
   * bout : le relais est aveugle, la salle est nommée (coffre, élément,
   * époque) sans test de type côté serveur — et un seul format de document.
   * Les greffons d'édition (texte, documents) ouvrent des salles sur des
   * éléments FICHIERS ; c'est à l'appelant de dire si SON contenu est un
   * document CRDT, pas à cette garde de connaître la liste des formats.
   */
  if (!input.collabEligible) return false;
  if (input.epoch === null) return false;
  if (!input.profileId) return false;
  return true;
}

// ── Ce que le canal PROUVE ────────────────────────────────────────

/** L'état du canal, tel que `CollabSession.status` le rend. */
export type VaultRoomStatus = 'connecting' | 'connected' | 'synced' | 'offline' | 'denied';

/**
 * LA SALLE A-T-ELLE MONTRÉ QUI L'HABITE ?
 *
 * C'est la question que pose le scrutin, et « hors ligne » n'y répond PAS.
 *
 * LE DÉFAUT QUE CETTE FONCTION FERME, et il a été rapporté : deux membres ouvrent
 * la même note, l'un écrit, une erreur de conflit apparaît. Le raisonnement
 * fautif tenait en une phrase — « sans canal, nous sommes seuls par
 * construction ». Il est vrai d'une note PERSONNELLE, dont la vérité est un
 * fichier local ; il est faux d'un élément de coffre, dont la vérité est un objet
 * nuage joint par une TOUTE AUTRE voie. Ne pas atteindre le relais (jeton
 * refusé, `COLLAB_ROOM_SECRET` absent, 429, pare-feu, coupure) ne dit rien des
 * autres membres : ils atteignent l'API des coffres, eux, et enregistrent.
 *
 * Tant que « hors ligne » comptait pour stabilisé, chacun se croyait seul, chacun
 * était élu, et chacun poussait un enregistrement automatique sur le même objet
 * — 409 `item_version_conflict` au second, toutes les six secondes. C'est
 * exactement le défaut que le fournisseur avait déjà fermé pour le REFUS d'accès
 * (voir `denied` dans collabProvider.ts) ; il restait ouvert pour la panne.
 *
 * La salle est le seul témoin possible des autres pairs. Sans elle, la position
 * de repli est « je n'enregistre pas tout seul », jamais l'inverse : le texte
 * n'est pas perdu pour autant (il vit dans l'éditeur, la fenêtre refuse de se
 * fermer sur du travail non enregistré, et le bouton « Enregistrer » reste un
 * geste explicite qui, lui, écrit — avec l'écran de conflit derrière).
 */
export function vaultRoomSettled(status: VaultRoomStatus): boolean {
  return status === 'synced';
}

/**
 * Durée d'isolement au-delà de laquelle un pair SANS RELAIS cesse d'attendre.
 *
 * Assez long pour qu'une reconnexion ordinaire (renouvellement de jeton, Wi-Fi
 * qui cligne, salle qui hiberne) ne soit jamais confondue avec un isolement ;
 * assez court pour qu'une personne seule ne tape pas dix minutes sans qu'un
 * seul octet ne parte.
 */
export const LONE_SAVER_ISOLATION_MS = 20_000;

export interface LoneVaultSaverInput {
  /** L'état du canal, tel que la session le rend. */
  status: VaultRoomStatus;
  /** Depuis quand le canal est-il HORS LIGNE sans interruption (ms epoch) ; `null` = il ne l'est pas. */
  offlineSince: number | null;
  /**
   * L'EFFECTIF DU COFFRE, tel que le SERVEUR l'annonce (`GET /vaults/heads`,
   * `shareIndexSlice`). `undefined` quand rien n'a encore été reçu.
   */
  memberCount: number | undefined;
  /** Notre rôle de membre — le veto local, jamais celui d'un jeton. */
  localRole: string | null | undefined;
  now: number;
}

/**
 * PEUT-ON REPRENDRE LE STYLO SANS LA SALLE ?
 *
 * `vaultRoomSettled` a fermé un vrai défaut — « hors ligne » ne prouve pas qu'on
 * est seul — mais au prix d'une conséquence qu'il faut nommer : tant que le
 * relais reste injoignable, PLUS PERSONNE n'est élu, donc l'enregistrement
 * automatique d'une note de coffre ne repart jamais. Seul le bouton
 * « Enregistrer » écrit encore, et rien ne le dit. Une salle qui ne se stabilise
 * jamais ne doit pas coûter le texte de quelqu'un.
 *
 * LE DISCRIMINANT, ET POURQUOI CELUI-LÀ. La question est « quelqu'un d'autre
 * peut-il être en train d'écrire ? », et le relais est justement ce qui manque
 * pour y répondre. Il faut donc une preuve qui ne passe PAS par lui. Trois
 * candidats se présentaient :
 *
 *  · « le relais a-t-il déjà répondu une fois ? » — insuffisant. Avoir été seul
 *    à 10h ne dit rien de 10h05, et une panne ASYMÉTRIQUE (le relais me lâche,
 *    pas l'autre) rendrait deux pairs élus : l'un parce qu'il s'est vu seul
 *    avant la coupure, l'autre parce que la salle lui montre une pièce vide ;
 *  · « un délai de grâce, après quoi l'isolé reprend la main » — SEUL, c'est la
 *    réouverture exacte du défaut d'origine : deux pairs hors ligne attendent le
 *    même délai et se croient tous deux seuls, à la seconde près ;
 *  · « y a-t-il d'autres membres susceptibles d'écrire ? » — celui-ci tient.
 *    L'effectif du coffre vient de `GET /vaults/heads`, c'est-à-dire de l'API
 *    des coffres : la TOUTE AUTRE voie dont l'absence de relais ne dit rien, et
 *    précisément celle par laquelle un autre membre enregistrerait. À UN membre,
 *    il n'existe personne d'autre pour écrire cet objet — dans n'importe quelle
 *    météo réseau. Ce n'est pas une inférence sur la salle, c'est un fait sur le
 *    coffre.
 *
 * Le délai de grâce reste, mais en second rôle : il empêche de pré-empter une
 * salle qui allait répondre. Il ne fonde rien tout seul.
 *
 * CE QUE CETTE FONCTION NE FAIT DÉLIBÉRÉMENT PAS : rendre `true` à plusieurs
 * membres. Un coffre à deux hors relais reste sans enregistrement automatique —
 * c'est la position de repli honnête, et la bande de présence affiche « hors
 * ligne » pour que ce ne soit pas un silence. Une ignorance (`memberCount`
 * inconnu) n'y donne pas droit non plus : on ne tire jamais un verdict d'une
 * absence d'information.
 */
export function nextOfflineSince(
  previous: number | null,
  status: VaultRoomStatus,
  now: number
): number | null {
  /**
   * L'ISOLEMENT SE COMPTE EN SILENCE ININTERROMPU. Tout état qui n'est pas
   * « hors ligne » réarme l'horloge : sans cela, un canal qui tombe et revient
   * toutes les cinq secondes finirait par accumuler son délai et par élire un
   * pair qui n'a jamais été seul une seule seconde.
   *
   * Et une chute déjà datée ne se REDATE pas : le fournisseur repasse par
   * « hors ligne » à chaque tentative de reconnexion, si bien que redater
   * repousserait l'échéance à l'infini — l'isolé n'écrirait jamais.
   */
  if (status !== 'offline') return null;
  return previous ?? now;
}

export function loneVaultSaverEligible(input: LoneVaultSaverInput): boolean {
  // Un lecteur n'enregistre jamais, seul ou pas.
  if (!roleCanWrite(input.localRole)) return false;
  // `denied` est un VERDICT (on n'est plus membre), pas une panne : le confondre
  // avec l'isolement ferait pousser un enregistrement voué au 403. `connecting`
  // et `connected` disent que le relais est là ou revient ; `synced` n'a besoin
  // d'aucun repli.
  if (input.status !== 'offline') return false;
  if (input.offlineSince === null) return false;
  if (input.now - input.offlineSince < LONE_SAVER_ISOLATION_MS) return false;
  // LA PREUVE, et elle vient du serveur, pas de la salle.
  return input.memberCount === 1;
}

// ── Ce qu'un commit couvre ───────────────────────────────────────

/**
 * Le document écrit est-il TOUJOURS celui qui est à l'écran ?
 *
 * Un enregistrement de coffre n'est pas instantané : déclaration de révision,
 * envoi des morceaux chiffrés un à un, rescellement des accès ponctuels, puis
 * commit. Tout ce qui change le document entre la SÉRIALISATION et le succès est
 * absent de ce qui vient d'être écrit — et en salle vivante, ça arrive tout le
 * temps : l'élu enregistre le texte de la salle pendant que la salle continue de
 * taper.
 *
 * Baisser `dirty` sur un commit qui ne couvre pas l'écran, c'est déclarer sauvé
 * ce qui ne l'est pas : plus aucun enregistrement automatique ne repart, et la
 * garde de fermeture laisse partir du travail. On compare donc une SÉQUENCE de
 * changements, pas un contenu — c'est le même procédé que `dirtySeqRef` dans
 * l'éditeur de greffons, où il rend déjà ce service.
 */
export function commitCoversDocument(seqAtSerialize: number, seqNow: number): boolean {
  return seqAtSerialize === seqNow;
}

// ── Writing back ─────────────────────────────────────────────────────────────

export interface VaultWriteBackInput {
  /** Are we the elected saver? False for every other peer, always false for a reader. */
  responsible: boolean;
  /** Our own role, from Redux — the local guard that outranks anything from the wire. */
  localRole: string | null | undefined;
  /** Has the document changed since the last committed save? */
  dirty: boolean;
  /** A save is already in flight. */
  saving: boolean;
  /** An unresolved conflict owns the screen — the user decides, not the timer. */
  hasConflict: boolean;
  /** The version the loaded document was read at. Null = nothing to re-base onto. */
  guardVersion: number | null;
  /** The room has settled (replay done or offline) AND presence has had time to arrive. */
  settled: boolean;
  /**
   * ON EST SEUL, ET ON PEUT LE PROUVER SANS LA SALLE (voir
   * `loneVaultSaverEligible`). C'est le SECOND chemin vers l'écriture, et le
   * seul : il remplace la preuve de solitude que la salle ne peut plus donner,
   * et rien d'autre — tous les autres vetos continuent de s'appliquer.
   */
  loneSaver?: boolean;
  /**
   * LE RELAIS NOUS A DÉGRADÉS EN LECTEUR (F23) — le seul veto de cette liste
   * qui vienne du SERVEUR plutôt que de notre propre état.
   *
   * `POST /collab/token` sur un coffre GELÉ répond 200 avec `role: 'viewer'` :
   * la salle reste ouverte (geler veut dire « lecture seule », pas « on éteint
   * la lumière ») mais elle ne relaiera plus nos écritures. Sans ce veto, le
   * pair élu retente un enregistrement toutes les six secondes jusqu'à ce que
   * le serveur réponde 409 `vault_frozen` — une suite d'échecs affichée pour un
   * état parfaitement normal, alors que le signal était là dès le premier jeton.
   *
   * IL NE REMPLACE PAS `localRole`, il s'y ajoute : notre rôle DE MEMBRE n'a pas
   * changé (le gel se lève, la rétrogradation non), et c'est lui que les autres
   * pairs voient dans la présence. Optionnel, et faux par défaut : une salle qui
   * n'a rien dit se comporte comme avant la fiche.
   */
  serverReadOnly?: boolean;
}

/**
 * Whether an automatic save may fire right now.
 *
 * Reads as a list of veto conditions, which is the point: every single one of
 * them, alone, is a reason NOT to write to a shared cloud object. The positive
 * case is only reached when all of them are clear.
 */
export function shouldWriteBackVaultNote(input: VaultWriteBackInput): boolean {
  // A reader never saves. First and non-negotiable — and checked against OUR
  // role, not against what the room believes about us.
  if (!roleCanWrite(input.localRole)) return false;
  // Le relais nous a dégradés en lecteur (coffre gelé) : la salle ne relaiera
  // rien et le serveur refusera le commit. C'est le seul veto qui vienne d'en
  // face, et il est placé juste après le nôtre pour la même raison — il ne se
  // discute pas.
  if (input.serverReadOnly) return false;
  if (!input.responsible) return false;
  if (!input.dirty) return false;
  if (input.saving) return false;
  // A 409 is being shown: writing again would answer the user's question for them.
  if (input.hasConflict) return false;
  if (input.guardVersion === null) return false;
  // Writing before the room settles is writing with several savers — À MOINS
  // qu'on ait établi, sans elle, qu'il n'y a personne d'autre pour écrire.
  if (!input.settled && !input.loneSaver) return false;
  return true;
}

// ── The guard version, as a room-wide fact ───────────────────────────────────

/**
 * Should we adopt a version the room just announced as committed?
 *
 * WHY THIS EXISTS. The compare-and-set guard is per-peer, but only ONE peer
 * writes. Left alone, every other peer keeps the version its own load returned,
 * for as long as the room lives. The moment the elected peer leaves and someone
 * else is promoted, the newcomer writes with a version several commits behind:
 * 409, banner, retry, 409 again — permanently, because nothing in that loop ever
 * advances their guard. The room's work becomes unwritable exactly when its
 * writer walks away, which is the worst possible time.
 *
 * So the committed version travels with the room (CollabSession.publish/
 * onCommittedVersion) and every peer adopts it. Two rules, and they are the
 * whole function:
 *  · MONOTONIC. A version that does not exceed ours is noise — a stale journal
 *    replayed on join, a CRDT merge that picked the other writer. Ignoring it
 *    is what makes an unordered channel safe to read.
 *  · NEVER A DOWNGRADE OF AN UNKNOWN. With no local version there is nothing to
 *    compare against, and the announcement is strictly better than nothing.
 */
export function adoptCommittedVersion(current: number | null, announced: number): number | null {
  if (!Number.isFinite(announced)) return current;
  if (current !== null && announced <= current) return current;
  return announced;
}

// ── Le titre, qui ne voyage PAS par le document partagé ──────────────────────

export interface CommittedTitleInput {
  /** Le titre affiché ici, rogné — exactement ce qui partirait dans un commit. */
  localTitle: string;
  /** Le titre de la dernière écriture que nous connaissions (chargement ou commit). */
  baseTitle: string;
  /** Le titre que le commit annoncé a écrit. `null` = la salle ne l'a pas dit. */
  committedTitle: string | null;
}

export interface CommittedTitleDecision {
  /** Le titre à ADOPTER à l'écran, ou `null` pour ne toucher à rien. */
  adopt: string | null;
  /** NOTRE titre n'est pas dans ce commit : l'attente ne retombe pas. */
  stillPending: boolean;
}

/**
 * CE QU'UN COMMIT DISTANT A LE DROIT DE DÉCLARER ENREGISTRÉ.
 *
 * ══ LES DEUX PERTES QUE CETTE FONCTION FERME ════════════════════════════════
 *
 * Le corps d'une note de coffre est un CRDT : quand l'élu commite, il commite le
 * texte de tout le monde, et chacun peut donc oublier son attente en apprenant
 * le commit. LE TITRE, LUI, N'EST PAS DANS LE DOCUMENT PARTAGÉ — il part dans
 * les métadonnées de l'élément, et chaque commit emporte celui de SON auteur.
 * Traiter les deux pareil coûtait du texte, deux fois :
 *
 *  · A renomme, B commite : chez A, l'annonce faisait retomber `dirty`, donc
 *    pastille verte « Enregistré dans le coffre » sur un titre qui venait
 *    d'être écrasé par celui de B. L'écran affirmait le contraire de ce qui
 *    s'était passé ;
 *  · B renomme, A ne sait rien du nouveau titre : le prochain commit de A
 *    réécrit l'ancien par-dessus, sans que rien ne l'ait signalé.
 *
 * ══ LA RÈGLE ═══════════════════════════════════════════════════════════════
 *
 * Un commit ne déclare propre que ce qu'il a écrit, et l'ignorance ne vaut
 * jamais pour un oui : sans titre annoncé (pair d'une version antérieure), un
 * renommage local reste EN ATTENTE plutôt que d'être déclaré parti. Et quand on
 * n'a rien retouché, le titre du commit est la vérité : l'adopter est le seul
 * moyen de ne pas le réécrire par-dessus au prochain enregistrement.
 */
export function reconcileCommittedTitle(input: CommittedTitleInput): CommittedTitleDecision {
  const renamed = input.localTitle !== input.baseTitle;
  if (input.committedTitle === null) return { adopt: null, stillPending: renamed };
  // Notre titre EST celui qui a été écrit (notre propre commit, ou la même
  // retouche des deux côtés) : plus rien n'attend.
  if (input.committedTitle === input.localTitle) return { adopt: null, stillPending: false };
  // Renommé ici, autre chose écrit là-bas : on garde notre texte À L'ÉCRAN — rien
  // n'est jeté — et on continue de dire qu'il n'est pas dans le coffre.
  if (renamed) return { adopt: null, stillPending: true };
  return { adopt: input.committedTitle, stillPending: false };
}

// ── Presence ─────────────────────────────────────────────────────────────────

/**
 * Minimal shape of what a peer publishes about itself. Everything is optional
 * because it comes off the wire: a peer may be mid-handshake, from an older
 * build, or simply lying. Nothing here is trusted for authorization.
 */
export interface VaultAwarenessUser {
  name?: unknown;
  color?: unknown;
  role?: unknown;
  memberId?: unknown;
}

export interface VaultParticipant {
  clientId: number;
  /** Vault-member label (their account email), not a device name. */
  name: string;
  color: string;
  initial: string;
  isLocal: boolean;
  /** Vault role as the peer announced it, `null` when it hasn't said. */
  role: CollabRole | null;
  /** Shown as read-only in the presence strip. */
  isReader: boolean;
  /** True for the peer currently responsible for saving. */
  isSaver: boolean;
  /** « Untel ecrit… » — jamais vrai pour le pair local (sa frappe ne s'affiche pas). */
  isTyping: boolean;
}

// ── Typing : reception immunisee au decalage d'horloge ───────────────────────

/** TTL cote RECEPTEUR : un pair disparu en pleine frappe s'eteint tout seul. */
export const TYPING_TTL_MS = 6_000;

export interface TypingReceipt {
  /** La derniere valeur vue — un nonce, jamais comparee a notre horloge. */
  value: number;
  /** QUAND NOUS avons vu cette valeur changer — notre horloge a nous. */
  seenAt: number;
}

/**
 * Met a jour les recus de frappe : un CHANGEMENT de valeur date le recu a
 * `now` (notre horloge), une valeur identique conserve l'ancien recu, un champ
 * null/absent — ou un pair disparu — retire l'entree. L'horodatage du pair
 * n'est JAMAIS compare au notre : un pair dont l'horloge avance de 30 s
 * « ecrirait » eternellement, ou jamais.
 */
export function updateTypingReceipts(
  prev: ReadonlyMap<number, TypingReceipt>,
  states: ReadonlyMap<number, { typing?: unknown } | undefined>,
  now: number
): Map<number, TypingReceipt> {
  const next = new Map<number, TypingReceipt>();
  states.forEach((state, clientId) => {
    const value = state?.typing;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const before = prev.get(clientId);
    next.set(clientId, before && before.value === value ? before : { value, seenAt: now });
  });
  return next;
}

export function isTypingNow(receipt: TypingReceipt | undefined, now: number): boolean {
  return !!receipt && now - receipt.seenAt < TYPING_TTL_MS;
}

// ── Session d'edition : resolution et meta chiffree ──────────────────────────

/** Au-dela de ce silence entre deux saves, la session est renouvelee. */
export const EDIT_SESSION_GAP_MS = 30 * 60_000;
/** Plafond de participants embarques dans la meta (garde MAX_META_B64). */
export const EDIT_SESSION_MAX_PARTICIPANTS = 8;

/** Ce que la meta chiffree porte par commit — voir VaultItemMeta.editSession. */
export interface EditSessionMeta {
  id: string;
  at: number;
  participants: string[];
}

/**
 * L'id de session a ecrire : celui de la salle s'il est FRAIS (moins de
 * EDIT_SESSION_GAP_MS depuis le dernier save — un lastSaveAt dans le FUTUR est
 * l'horloge d'un autre sauveur en avance : on garde la session, c'est pourquoi
 * la condition n'est PAS en valeur absolue), un neuf sinon.
 */
export function resolveEditSessionId(
  existing: { id: string; lastSaveAt: number } | null,
  now: number,
  mintId: () => string
): { id: string; renewed: boolean } {
  if (existing !== null && now - existing.lastSaveAt < EDIT_SESSION_GAP_MS) {
    return { id: existing.id, renewed: false };
  }
  return { id: mintId(), renewed: true };
}

/** La meta de session : noms dedupliques, doublement plafonnes (8 × 64 chars). */
export function buildEditSessionMeta(
  id: string,
  participants: readonly { name: string }[],
  now: number
): EditSessionMeta {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of participants) {
    const name = (p.name ?? '').trim().slice(0, 64);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= EDIT_SESSION_MAX_PARTICIPANTS) break;
  }
  return { id, at: now, participants: names };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRole(value: unknown): CollabRole | null {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer'
    ? value
    : null;
}

/** First visible character of a label, uppercased; "?" when there is none. */
export function participantInitial(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return Array.from(trimmed)[0].toLocaleUpperCase();
}

/**
 * Turn raw awareness into the list the presence strip renders.
 *
 * Two things this does that the personal-note version does not, and both are
 * the whole point of phase 2:
 *  · it shows MEMBERS. A vault room is other people, so the label is their
 *    account identity — never "Desktop" / "Web", which would be meaningless
 *    ("who is Desktop?") the moment a room has more than one human in it;
 *  · it marks a READER as such. Someone whose text will never be saved must be
 *    visibly distinct from someone whose text will, or the room silently lies
 *    about what is happening to their typing.
 */
export function deriveVaultPresence(
  states: ReadonlyMap<number, { user?: VaultAwarenessUser | null; typing?: unknown } | undefined>,
  localClientId: number,
  fallback: { name: string; color: string },
  responsibleClientId: number | null,
  typingClientIds: ReadonlySet<number> = new Set()
): VaultParticipant[] {
  const participants: VaultParticipant[] = [];

  states.forEach((state, clientId) => {
    const user = state?.user ?? null;
    const isLocal = clientId === localClientId;
    const name = readText(user?.name) ?? (isLocal ? fallback.name : `#${clientId}`);
    const color = readText(user?.color) ?? fallback.color;
    const role = readRole(user?.role);
    participants.push({
      clientId,
      name,
      color,
      initial: participantInitial(name),
      isLocal,
      role,
      // Unknown role reads as reader: an unannounced peer is not credited with
      // write access it never claimed.
      isReader: !roleCanWrite(role ?? undefined),
      isSaver: responsibleClientId !== null && clientId === responsibleClientId,
      // Notre propre frappe ne s'affiche jamais : on SAIT qu'on ecrit.
      isTyping: typingClientIds.has(clientId) && !isLocal,
    });
  });

  participants.sort((a, b) => {
    if (a.isLocal !== b.isLocal) return a.isLocal ? -1 : 1;
    return a.clientId - b.clientId;
  });
  return participants;
}

/** Two lists showing exactly the same thing? Guards against pointless re-renders. */
export function sameVaultPresence(a: VaultParticipant[], b: VaultParticipant[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].clientId !== b[i].clientId ||
      a[i].name !== b[i].name ||
      a[i].color !== b[i].color ||
      a[i].isLocal !== b[i].isLocal ||
      a[i].isReader !== b[i].isReader ||
      a[i].isSaver !== b[i].isSaver ||
      a[i].isTyping !== b[i].isTyping
    ) {
      return false;
    }
  }
  return true;
}

/**
 * The label this member publishes about itself.
 *
 * Their account email is what other members recognise — it is the identity the
 * vault roster is built on. The fallbacks only matter for a local-only or
 * half-signed-in state, where no room can open anyway.
 */
export function vaultMemberLabel(input: {
  email?: string | null;
  profileName?: string | null;
  userId?: string | null;
}): string {
  return (
    (input.email ?? '').trim() ||
    (input.profileName ?? '').trim() ||
    (input.userId ?? '').trim() ||
    'Member'
  );
}
