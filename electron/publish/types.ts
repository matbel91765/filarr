/**
 * « Publier ce coffre sur le compte » — vocabulaire partagé.
 *
 * POURQUOI CE FICHIER : le parcours traverse cinq modules (garde, plan,
 * registre, preuve, bascule) qui doivent parler des MÊMES objets. Un type
 * dupliqué d'un module à l'autre finirait par diverger, et la divergence se
 * paierait sur des données d'utilisateur — un compteur qui ment, un profil
 * oublié, une bascule autorisée sur une preuve incomplète.
 *
 * Rien ici n'importe `electron` ni `fs` : ces types voyagent jusque dans le
 * renderer (écrans 0 à 5) et dans les tests unitaires, qui tournent sous jest
 * sans process principal.
 */

// ── Machine à états ─────────────────────────────────────────────────────────

/**
 * L'état de la migration. `FAILED` N'EST PAS terminal : il porte une cause et
 * retourne en `PUBLISHING` dès qu'elle disparaît (automatiquement pour le
 * réseau, sur geste pour le quota).
 */
export type PublishState =
  | 'PREPARING'
  | 'READY'
  | 'PUBLISHING'
  | 'VERIFYING'
  | 'SWITCHING'
  | 'DONE'
  | 'FAILED'
  | 'ABANDONED';

/**
 * Les causes d'arrêt, typées — parce que la conduite à tenir en dépend
 * entièrement : `network` se reprend tout seul, `key-diverged` efface la clé
 * entrante et n'offre AUCUNE bascule.
 */
export type PublishErrorCode =
  | 'network'
  | 'quota-exceeded'
  | 'key-diverged'
  | 'verify-failed'
  | 'internal';

// ── Garde d'adoption ────────────────────────────────────────────────────────

/** Le seul refus qui subsiste : on ne migre jamais ce qu'on ne peut pas lire. */
export type FekAdoptionRefusal = 'unverifiable-local-key';

/**
 * Le verdict de la garde. `publish` est l'issue NOUVELLE : elle n'existe que
 * parce qu'à cet instant l'appareil détient les DEUX clés — celle qui lit son
 * contenu et celle du compte qui vient d'arriver.
 */
export type FekAdoptionDecision =
  | { kind: 'adopt'; reason: 'no-local-key' | 'empty-vault' | 'same-key' }
  | { kind: 'publish'; reason: 'content-under-other-key' }
  | { kind: 'refuse'; reason: FekAdoptionRefusal };

// ── Inventaire ──────────────────────────────────────────────────────────────

/**
 * Les trois unités migrables atomiques. Un `blob` porte des octets de fichier ;
 * une `folder-meta` porte l'arborescence d'un dossier (`metadata.json`) ; le
 * `notes-bundle` porte `notes.enc`.
 */
export type PublishItemKind = 'blob' | 'folder-meta' | 'notes-bundle';

/**
 * Quelle clé ouvre l'élément AUJOURD'HUI, sur cet appareil.
 *
 * C'est la distinction qui borne la migration côté bureau : `machine` survit
 * intact à la bascule (il n'est pas scellé sous la FEK), `active` est à risque
 * et compte dans le total qui garde la bascule, `none` est déjà perdu.
 */
export type PublishKeyClass = 'machine' | 'active' | 'none';

export interface PublishItem {
  /**
   * Clé d'élément — l'identifiant sous lequel l'élément voyage vers R2 :
   * `meta:{folderId}`, `meta:notes`, ou `sha256(folderId + '/' + fileName)`
   * tronqué à 32 caractères hexadécimaux (exactement la dérivation de
   * `scanLocalFiles`, pour qu'un cycle ordinaire ultérieur reconnaisse
   * l'entrée au lieu de la re-téléverser).
   */
  key: string;
  kind: PublishItemKind;
  localProfileId: string;
  /** Chemin RELATIF au répertoire du profil (`<folderId>/<fileName>`). */
  localPath: string;
  size: number;
  /** ISO — mtime du fichier. Sert au tirage « le plus ancien » de la preuve. */
  updatedAt: string;
  keyClass: PublishKeyClass;
  /** Renseigné pour `blob` et `folder-meta`. */
  folderId?: string;
}

/** Un profil local, tel que la migration a besoin de le connaître. */
export interface PublishLocalProfile {
  id: string;
  name: string;
  order: number;
  isDefault: boolean;
  createdAt: string;
  avatarColor?: string;
  avatarEmoji?: string;
  avatarImage?: string;
  pinHash?: string;
  pinSalt?: string;
  allowPinReset?: boolean;
  pinUpdatedAt?: string;
  /**
   * VRAI quand le répertoire existe sur le disque mais que le profil ne figure
   * PAS dans `profiles.json`. Le cas est réel (profil supprimé, réinstallation
   * par-dessus des données) et il DOIT être montré, jamais deviné.
   */
  orphan?: boolean;
}

// ── Journal ─────────────────────────────────────────────────────────────────

export interface PublishTargetProfile {
  localProfileId: string;
  /**
   * Le profil NEUF du compte. Vaut `localProfileId` quand le manifeste distant
   * de cet identifiant est nul — le chemin de loin préférable : aucun
   * déplacement de répertoire, aucune réécriture d'identifiant.
   */
  targetProfileId: string;
  targetName: string;
  itemCount: number;
  byteCount: number;
  notesBundle: boolean;
  /**
   * VRAI quand un UUID neuf a dû être frappé : la promotion (S4) devra alors
   * AUSSI déplacer le répertoire de blobs et l'entrée de manifeste.
   */
  relocated: boolean;
}

export interface PublishAbandonedProfile {
  localProfileId: string;
  name: string;
  itemCount: number;
  byteCount: number;
  acceptedAt: string;
}

/**
 * Un obstacle à la bascule — et JAMAIS un cul-de-sac.
 *
 * Chaque forme d'obstacle doit mener à un geste NOMMÉ à l'écran (règle C8) :
 * la version précédente désactivait le bouton « Publier » sur un fichier trop
 * gros sans offrir la moindre action, ce qui refermait l'impasse au lieu de
 * l'ouvrir. Le type est un union discriminé pour que l'écran soit OBLIGÉ de
 * traiter chaque cas — un `kind` ajouté sans son action ne compile pas.
 */
export type PublishBlocker =
  | {
      /**
       * Élément trop volumineux pour l'outillage de la plateforme. N'existe PAS
       * sur le bureau : le transcodage V3 streame et l'envoi passe en multipart,
       * donc `maxItemBytes` y vaut `null` et aucun `oversize` ne peut naître.
       * Le cas reste typé parce que le plan est partagé.
       */
      kind: 'oversize';
      localProfileId: string;
      itemKey: string;
      /** Nom de fichier — déjà en clair dans l'état persisté de l'application. */
      name: string;
      size: number;
    }
  | {
      /**
       * Le trousseau de l'OS est indisponible. La bascule en DÉPEND : sans lui,
       * l'ancienne clé ne peut pas être conservée en lecture (voir
       * `retiredKey.ts`), donc tout le contenu déjà présent deviendrait
       * inaccessible à l'instant de la bascule. Le geste nommé est « rendre le
       * trousseau disponible, puis reprendre » — jamais « basculer quand même ».
       */
      kind: 'keychain-unavailable';
    };

export interface PublishCounters {
  totalItems: number;
  doneItems: number;
  damagedItems: number;
  totalBytes: number;
  doneBytes: number;
}

export interface PublishJournal {
  schema: 1;
  migrationId: string;
  state: PublishState;
  startedAt: string;
  updatedAt: string;
  /** Le compte pour lequel cette migration a été ouverte. */
  accountUserId: string;
  /**
   * Condensat À CLÉ de la clé entrante (HMAC-SHA-256, clé = `migrationId`).
   * Jamais `sha256(clé)` nu : ce journal est un fichier, et un condensat nu
   * d'un secret est un oracle hors ligne. Sert au seul verdict `key-diverged`.
   */
  accountKeyDigest: string;
  /** SHA-256 des OCTETS de `incoming_fek.json` — du chiffré, donc publiable. */
  wrappedDigest: string;
  targetProfiles: PublishTargetProfile[];
  abandonedProfiles: PublishAbandonedProfile[];
  blockers: PublishBlocker[];
  counters: PublishCounters;
  verify: {
    /** Plan d'échantillon, calculé UNE fois et rejoué à l'identique. */
    plan: string[];
    ok: number;
    failed: string[];
    /** Palier 3 demandé (retéléchargement intégral). */
    full: boolean;
  };
  switch: {
    plannedAt: string | null;
    /** ★ LE PIVOT. `false` ⇒ retour en arrière ; `true` ⇒ marche avant. */
    staged: boolean;
    /** Emplacements de clé déjà promus, pour une reprise idempotente. */
    promoted: string[];
  };
  cleanup: {
    pendingDeletes: number;
    lastAttemptAt: string | null;
  };
  lastError: { code: PublishErrorCode; itemKey: string | null } | null;
  abandonedAt?: string;
  doneAt?: string;
}

// ── Registre (append-only, une ligne par transition) ────────────────────────

/**
 * `uploaded` n'est PLUS ÉCRIT depuis C1.
 *
 * Il servait à distinguer « envoyé » de « re-scellé localement » — un
 * découpage qui n'a plus d'objet puisque plus rien n'est re-scellé localement.
 * Le traitement d'un élément produit désormais UNE seule ligne, autosuffisante.
 * L'état reste reconnu en LECTURE pour qu'un registre écrit par une version
 * antérieure se conclue proprement au lieu de tout refaire.
 */
export type LedgerState = 'uploaded' | 'done' | 'damaged' | 'oversize';

export interface LedgerLine {
  /** Clé d'élément. */
  k: string;
  s: LedgerState;
  /** SHA-256 du CLAIR — calculé une fois, réutilisé par la preuve. */
  c?: string;
  /** SHA-256 du CHIFFRÉ monté — l'`checksum` du manifeste. */
  r?: string;
  /** Octets du chiffré. */
  n?: number;
  /** Nombre de morceaux de transport. */
  ch?: number;
  /**
   * Clés d'objet rendues par le worker, telles quelles. Bornées par
   * construction : au-delà de 64 Mio le transfert passe en multipart et ne
   * produit qu'UNE clé logique ; en deçà, 64 Mio / 4 Mio = 16 clés au plus.
   * Les stocker évite de reconstituer des chaînes que le cycle ordinaire
   * inspecte (il y distingue les blocs delta).
   */
  ks?: string[];
  why?: 'corrupt' | 'unreadable';
  t: string;
}

/** État implicite d'un élément absent du registre. */
export type LedgerItemState = 'pending' | LedgerState;
