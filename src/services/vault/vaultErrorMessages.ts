/**
 * Worker error `code` → i18n key, for the shared-vault screens.
 *
 * WHY THIS EXISTS AS DATA. Every vault screen used to collapse a refusal into one
 * generic sentence, which is fine for a transport error and wrong for a decision:
 * "your plan is full, upgrade to add more people" and "the network hiccuped" demand
 * opposite reactions from the user, and only the server can tell them apart. Keeping
 * the table here (rather than inline in each modal) means a new server code is
 * translated in ONE place, and can be unit-tested against both locales.
 *
 * The fallback is the CALLER's, because the generic sentence depends on what was
 * being attempted — failing to create a vault doesn't read like failing to invite.
 */
/**
 * « Quelque chose a échoué et personne ne sait quoi. »
 *
 * Le repli de TOUTE couche qui renonce à classifier. Volontairement absent des
 * deux tables ci-dessous : l'appelant garde donc sa phrase générique et son
 * bouton « Réessayer », `isVaultErrorRetryable` le tient pour transitoire et
 * `isDeadInviteError` le refuse — ce qui est la seule chose vraie quand on ne
 * sait rien. Un repli qui nomme un verdict (`invite_invalid`, `org_forbidden`)
 * fait dire à une ignorance ce que seul le serveur peut affirmer.
 */
export const UNKNOWN_FAILURE_CODE = 'request_failed';

export const VAULT_ERROR_KEYS: Readonly<Record<string, string>> = {
  // Plan / entitlement — the two refusals that come with an action to take.
  seat_limit_reached: 'teamVaults.errors.seatLimit',
  personal_seat_limit_reached: 'teamVaults.errors.seatLimit',
  upgrade_required: 'teamVaults.errors.upgradeRequired',
  // Le JUMEAU du précédent, et la distinction vaut d'exister : `upgrade_required`
  // s'adresse à qui n'a JAMAIS eu la fonction, `host_plan_lapsed` à un espace qui
  // l'AVAIT et dont l'abonnement s'est arrêté. L'espace passe en lecture seule —
  // rien n'est détruit, rien n'est verrouillé, il cesse seulement de grandir — et
  // celui qui reçoit le refus n'est pas forcément celui qui paie.
  host_plan_lapsed: 'teamVaults.errors.hostPlanLapsed',
  /**
   * L'organisation n'a pas d'abonnement — c'est le refus que rencontre une
   * organisation fraîchement fondée, qui existe sans donner accès à rien. Il
   * rejoint `upgrade_required` : la fonction n'a jamais été acquise, et la
   * phrase invite à souscrire. Le distinguer de `host_plan_lapsed` compte —
   * l'un n'a jamais eu, l'autre a perdu.
   */
  org_not_subscribed: 'teamVaults.errors.upgradeRequired',
  /**
   * LES DEUX REFUS DE CRÉATION DE COFFRE, ET POURQUOI ILS NE PARTAGENT PAS UNE
   * PHRASE.
   *
   * `vault_creation_restricted` est RÉVERSIBLE : l'organisation a réglé une
   * politique, un owner ou un admin peut créer le coffre à votre place ou
   * changer le réglage. La phrase nomme donc un recours.
   *
   * `vault_creation_viewer` est PERMANENT tant que le rôle ne change pas : un
   * viewer ne créera jamais de coffre, politique ou pas. Lui servir « votre
   * organisation restreint » l'enverrait demander la levée d'un réglage qui
   * n'est pas la cause — il reviendrait refusé, sans comprendre.
   *
   * C'est exactement pourquoi le worker rend deux codes distincts plutôt qu'un.
   * Les fondre ici annulerait cette distinction au dernier mètre.
   */
  /**
   * Le document d'intentions de partage refuse une écriture : trop gros, ou
   * mal formé.
   *
   * IL EST TRAITÉ COMME UNE ERREUR, pas ignoré, et c'est délibéré. Ce document
   * porte les EXCLUSIONS d'un partage de dossier ; une écriture perdue en
   * silence laisserait croire qu'un fichier a été retiré du partage alors qu'il
   * y reste — et le prochain rattrapage le confirmerait.
   */
  invalid_share_intents: 'teamVaults.errors.shareIntentsTooLarge',
  vault_creation_restricted: 'teamVaults.errors.vaultCreationRestricted',
  vault_creation_viewer: 'teamVaults.errors.vaultCreationViewer',
  subscription_inactive: 'teamVaults.errors.hostPlanLapsed',
  /**
   * Les trois refus du réglage des sièges. Ils ne peuvent survenir que dans
   * l'écran de facturation, jamais sur un chemin de coffre — mais ils sont des
   * codes du Worker, et le garde-fou exige une décision pour CHACUN : un code
   * sans décision est un code qui, le jour où il remonte, s'affiche en anglais
   * brut ou pas du tout.
   */
  seats_below_floor: 'teamVaults.errors.seatLimit',
  no_subscription: 'teamVaults.errors.upgradeRequired',
  invalid_seats: 'teamVaults.errors.generic',
  // Authorization. NOT a connectivity problem: the server answered, and said no. The
  // anti-enumeration collapse means "not a member" and "no such space" arrive as the
  // same 403 — so the sentence says what is true of both without guessing which.
  org_forbidden: 'teamVaults.errors.noAccess',
  org_enterprise_only: 'teamVaults.errors.noAccess',
  org_insufficient_role: 'teamVaults.errors.insufficientRole',
  org_read_only: 'teamVaults.errors.readOnly',
  personal_account: 'teamVaults.errors.noAccess',
  session_expired: 'teamVaults.errors.sessionExpired',
  // The two failures that are genuinely NOT the user's doing, kept apart because only
  // one of them is worth checking a router over.
  network_unavailable: 'teamVaults.errors.offline',
  server_error: 'teamVaults.errors.serverError',
  // Storage — a cap, like the seat cap, and answered the same way: say what to do.
  pooled_quota_exceeded: 'teamVaults.errors.storageFull',
  // The vault itself is gone or out of reach.
  vault_not_found: 'teamVaults.errors.vaultGone',
  vault_forbidden: 'teamVaults.errors.noAccess',
  not_a_member: 'teamVaults.errors.noAccess',
  personal_space_owner_only: 'teamVaults.errors.insufficientRole',
  last_owner: 'teamVaults.errors.lastOwner',
  legal_hold_active: 'teamVaults.errors.legalHold',
  // Invitations.
  member_no_key: 'teamVaults.errors.noKey',
  /**
   * UNE GARDE DE SÉCURITÉ, ET ELLE MÉRITE SA PHRASE. Émis par le CLIENT
   * (`inviteMember` / `addMemberDirect`) quand la clé publique qu'on s'apprête à
   * sceller n'appartient pas à la personne sous l'identifiant de qui l'accès
   * serait écrit — une sélection qui a bougé pendant la cérémonie, ou une clé
   * substituée entre le contrôle et le scellé. Sans entrée ici, ce refus tombait
   * dans « impossible d'inviter », c'est-à-dire dans le vocabulaire des pannes :
   * on invitait l'hôte à réessayer un geste qu'il ne faut PAS refaire tel quel.
   */
  peer_key_mismatch: 'teamVaults.errors.peerKeyMismatch',
  /**
   * Une intention d'accès (0073) que le serveur ne trouve plus. Le 404 est
   * UNIFORME — inconnue, d'un autre coffre, déjà honorée, déjà annulée : la
   * réponse ne sert jamais d'oracle — donc la phrase ne prétend pas savoir
   * laquelle des quatre, elle dit ce qui est vrai des quatre.
   */
  intent_not_found: 'teamVaults.errors.intentGone',
  already_member: 'teamVaults.errors.alreadyMember',
  already_invited: 'teamVaults.errors.alreadyInvited',
  invalid_email: 'teamVaults.errors.invalidEmail',
  rate_limited: 'teamVaults.errors.rateLimited',
  not_org_member: 'teamVaults.errors.notInSpace',
  invitee_mismatch: 'teamVaults.errors.notInSpace',
  invite_expired: 'teamVaults.errors.inviteExpired',
  invite_invalid: 'teamVaults.errors.inviteInvalid',
  // La révocation ne trouve rien à retirer : déjà acceptée, déjà révoquée, ou
  // l'identifiant d'un autre coffre. Le refus ne dit jamais lequel des trois.
  invite_not_found: 'teamVaults.errors.inviteGone',
  invite_revoke_failed: 'teamVaults.errors.inviteRevokeFailed',
  vault_delete_failed: 'teamVaults.errors.deleteVault',
  vault_restore_failed: 'teamVaults.errors.deleteVault',
  // Restaurer un coffre vivant : le refus vaut mieux qu'une restauration muette
  // qui n'aurait rien restauré.
  vault_not_deleted: 'teamVaults.errors.vaultNotDeleted',
  leave_failed: 'teamVaults.errors.leave',
  trash_failed: 'teamVaults.errors.trashLoad',
  item_restore_failed: 'teamVaults.errors.itemRestore',
  // Rotation interrompue par la transparence de clés — le garde-fou anti-MITM
  // qui n'existait qu'à l'invitation.
  tampered_log: 'teamVaults.errors.tamperedLog',
  served_not_latest: 'teamVaults.errors.servedNotLatest',
  key_log_unavailable: 'teamVaults.errors.keyLogUnavailable',
  rename_failed: 'teamVaults.errors.renameFailed',
  role_change_failed: 'teamVaults.errors.roleChangeFailed',
  self_role_change: 'teamVaults.errors.selfRoleChange',
  vault_transfer_failed: 'teamVaults.errors.transferFailed',
  transfer_conflict: 'teamVaults.errors.transferConflict',
  already_owner: 'teamVaults.errors.alreadyOwner',
  // Le compte ne peut pas partir en emportant les coffres des autres : la
  // migration 0018 en fait une règle dure, et le refus nomme la sortie.
  vault_owner_must_hand_over: 'teamVaults.errors.ownerMustHandOver',
  invite_email_mismatch: 'teamVaults.errors.inviteInvalid',
  // The org endpoints the personal journey actually lands on. Inviting by email,
  // reading the roster and removing a member are `allowPersonalOrg` routes, so their
  // refusals reach these same screens under their OWN spelling — `invitation_*` here,
  // `invite_*` above — and dropping them into the generic fallback would have told a
  // user whose invitation was revoked to check their connection.
  invitation_not_found: 'teamVaults.errors.inviteGone',
  invitation_expired: 'teamVaults.errors.inviteExpired',
  invitation_already_used: 'teamVaults.errors.inviteInvalid',
  invitation_email_mismatch: 'teamVaults.errors.inviteInvalid',
  owner_only: 'teamVaults.errors.insufficientRole',
  not_vault_member: 'teamVaults.errors.noAccess',
  no_member_key: 'teamVaults.errors.noKey',
  domain_blocked: 'teamVaults.errors.domainBlocked',
  // The shared space couldn't be set up. The client now CREATES one when the account
  // has none (orgSlice.ensurePersonalSpace), so reaching this means the creation
  // itself came back without a usable space — a server-side problem, not the user's
  // connection, and above all not something they can fix by retrying differently.
  shared_vault_no_context: 'teamVaults.errors.noContext',
  org_required: 'teamVaults.errors.noContext',
  // Concurrency.
  /**
   * F14 — LE NOM QU'ON N'A PAS SU LIRE. Émis par le CLIENT
   * (`setVaultAppearance`) : l'apparence est rangée dans la MÊME enveloppe
   * chiffrée que le nom, donc l'écrire réécrit le nom. Un nom vide ne veut pas
   * dire « ce coffre n'a pas de nom », il veut dire que le déchiffrement a
   * échoué — sceller par-dessus détruirait ce qu'un autre membre ouvre encore.
   * Sans entrée ici, ce refus tombait dans « impossible d'enregistrer », donc
   * dans le vocabulaire des pannes : on inviterait à réessayer un geste qu'il
   * ne faut PAS refaire tant que la clé manquante n'est pas revenue.
   */
  vault_name_unreadable: 'teamVaults.appearance.nameUnreadable',
  vault_epoch_conflict: 'teamVaults.errors.conflict',
  item_version_conflict: 'teamVaults.errors.conflict',
  wrap_set_mismatch: 'teamVaults.errors.conflict',
  /**
   * PAS UN CONFLIT — ET C'EST TOUTE LA DIFFÉRENCE (F03). Ce code tombait sur la
   * phrase des concurrences, « quelque chose a changé, réessayez », qui est
   * FAUSSE ici : l'époque d'un coffre ne fait que monter (`rotateVaultKey` :
   * `newEpoch = prevEpoch + 1`, posé par compare-and-set) tandis que celle du
   * scellé est figée à l'émission. Une fois séparées, aucune reprise ne les
   * rejoint : relancer cette invitation ne peut QUE se faire refuser à
   * l'identique. Le seul geste qui aboutit est de la RÉÉMETTRE, sous un scellé
   * neuf — et c'est ce que la phrase dit maintenant.
   */
  invite_stale_epoch: 'teamVaults.errors.inviteStaleEpoch',
  // E3-6 — partage par personne. `already_member` est DEJA mappé plus haut.
  already_granted: 'teamVaults.grants.errors.alreadyGranted',
  grant_set_mismatch: 'teamVaults.errors.conflict',
  grant_stale: 'sharedWithMe.staleBody',
  grant_not_found: 'teamVaults.grants.errors.gone',
  grantee_key_changed: 'teamVaults.grants.errors.granteeKeyChanged',
  revision_in_use: 'teamVaults.errors.conflict',
  /**
   * F13 — LES REFUS QUI VIENNENT DES RÉGLAGES DU COFFRE, et pourquoi ils ont
   * chacun leur phrase plutôt que celle des rôles.
   *
   * `grants_disabled`, `grant_expiry_too_far` et `setting_forbidden` ne disent
   * PAS « vous n'avez pas le droit » : ils disent « ce coffre a décidé cela »,
   * et cette décision se change à l'écran par quelqu'un de nommable. Les faire
   * tomber sur `vault_forbidden` enverrait la personne demander un rôle
   * supérieur alors qu'il faut demander un réglage — deux gestes différents,
   * adressés à des gens différents.
   *
   * `settings_version_conflict` est une CONCURRENCE, comme `vault_epoch_conflict` :
   * quelqu'un a enregistré pendant qu'on éditait, il faut relire puis refaire.
   * C'est le seul des quatre où réessayer a un sens (d'où son absence de
   * TERMINAL_VAULT_ERRORS).
   */
  grants_disabled: 'teamVaults.errors.grantsDisabled',
  grant_expiry_too_far: 'teamVaults.errors.grantExpiryTooFar',
  /**
   * A1-1 — LE RÔLE D'UN ACCÈS PONCTUEL N'EST PAS UN RANG À DEMANDER.
   *
   * Le serveur n'a qu'un rôle à servir ici (`viewer`), et son refus de tout
   * autre n'est pas un « vous n'avez pas le droit » : c'est « ce n'est pas ce
   * que fait un accès ponctuel ». Le titulaire détient K_item scellé à SA clé,
   * jamais K_vault, donc il ne peut produire aucun wrap d'écriture — et
   * l'autoriser quand même rendrait sa propre révocation non cryptographique.
   *
   * D'où sa phrase à lui plutôt que celle des droits : la faire tomber sur
   * `vault_forbidden` enverrait la personne réclamer un rang supérieur, alors
   * que le geste qui donne l'écriture est une INVITATION au coffre. Deux
   * gestes différents, et le message doit nommer le bon.
   */
  role_unsupported: 'teamVaults.errors.roleUnsupported',
  setting_forbidden: 'teamVaults.errors.settingForbidden',
  settings_version_conflict: 'teamVaults.errors.conflict',
  /**
   * MES ÉPINGLES (0096). Le conflit est une CONCURRENCE entre deux de MES
   * appareils — et le hook fusionne puis rejoue avant de le dire ; ce message
   * n'apparaît qu'après trois refus d'affilée. Le blob trop grand ne peut
   * venir que d'un client qui a mal construit sa liste : « pas enregistré ».
   */
  pins_version_conflict: 'teamVaults.favorites.conflict',
  pins_too_large: 'teamVaults.favorites.failed',
  /**
   * F23/F24 — LE GEL, LE PLAFOND DU COFFRE, LE PLAFOND DE L'ESPACE, ET LA PURGE
   * QUI N'A RIEN DÉTRUIT. Quatre refus livrés côté serveur dont la garde de
   * parité disait justement qu'ils n'avaient encore été DÉCIDÉS par personne.
   *
   * Aucun des quatre n'est une histoire de rang, et c'est pour cela qu'aucun ne
   * tombe sur la phrase des droits :
   *   · `vault_frozen` — le coffre est en lecture seule tant que quelqu'un ne le
   *     dégèle pas ; le Worker le distingue exprès de `host_plan_lapsed` et de
   *     `legal_hold_active` parce que les trois se lèvent par trois gestes
   *     différents, et les confondre enverrait payer un abonnement pour un
   *     interrupteur ;
   *   · `vault_quota_exceeded` — le plafond que CE coffre s'impose (réglage
   *     0075), à ne pas confondre avec `pooled_quota_exceeded` : dire « votre
   *     espace est plein » alors qu'il ne l'est pas enverrait acheter des sièges
   *     au lieu de relever un curseur ;
   *   · `retention_over_policy` — la valeur demandée est légitime, c'est
   *     l'espace HÔTE qui la plafonne ; l'écran doit dire lequel des deux
   *     réglages céder, pas prétendre à une saisie mal formée ;
   *   · `purge_failed` — le stockage a refusé, donc RIEN n'a été détruit et
   *     l'élément est toujours dans la corbeille. C'est l'inverse de ce que le
   *     repli de l'appelant (« impossible de supprimer ») laisse craindre, et
   *     c'est la seule phrase des quatre qui invite vraiment à réessayer.
   */
  vault_frozen: 'teamVaults.errors.vaultFrozen',
  vault_quota_exceeded: 'teamVaults.errors.vaultStorageCap',
  retention_over_policy: 'teamVaults.errors.retentionOverPolicy',
  purge_failed: 'teamVaults.errors.purgeFailed',

  /**
   * LE SEUL CODE DE CETTE TABLE QUI NE VIENT PAS DU SERVEUR — et il est ici pour
   * la même raison que les autres : les écrans traduisent un refus par
   * `vaultErrorKey`, et un refus qu'on sait nommer ne doit pas retomber sur le
   * repli générique de l'appelant. Il est levé par `saveExportFile` quand le
   * processus principal refuse d'écrire hors du dossier personnel (la boîte
   * système, elle, laisse choisir n'importe quel lecteur) : « l'export a
   * échoué » envoyait alors chercher une panne là où il n'y avait qu'une règle.
   * Même précédent que `vault_join_needs_space` dans la table d'à côté.
   *
   * La garde de parité regarde l'autre sens (un code du worker sans décision) :
   * une entrée sans worker derrière ne la dérange pas, mais elle doit rester
   * traduite dans les deux langues, ce que la même suite vérifie.
   */
  export_path_not_allowed: 'teamVaults.activity.export.pathNotAllowed',
};

/**
 * Worker codes that deliberately have NO sentence of their own: the caller's own
 * fallback ("Couldn't add the file", "Couldn't save this note") already says the only
 * useful thing, because these describe an upload the client itself got wrong — a
 * malformed request, a chunk that never landed, a revision the user never knew about.
 * Listed rather than left out so the parity test can tell "decided" from "forgotten":
 * a new server code that appears in neither table fails the suite, and someone has to
 * choose what the user is told. That choice is the point.
 */
export const VAULT_CODES_WITHOUT_OWN_MESSAGE: ReadonlySet<string> = new Set([
  'bad_request',
  'chunk_too_large',
  'incomplete_upload',
  'item_not_found',
  'item_not_pending',
  'item_not_ready',
  'revision_not_found',
  'too_many_staged_revisions',
  // Client-side mistakes with no user-facing remedy: the caller's own fallback says
  // the useful half ("couldn't invite them"), and naming the wire-level cause would
  // only puzzle someone who did nothing wrong.
  'invalid_role',
  'not_found',
  // ── Replis du CLIENT, quand le serveur n'a rien nommé ────────────────────────
  // Émis par `throwWithCode` sur les trois étapes d'un envoi (déclaration,
  // morceaux, finalisation) quand la réponse ne porte aucun code : une panne
  // réseau, essentiellement. Le repli de l'appelant dit déjà la moitié utile —
  // « impossible d'ajouter le fichier » — et nommer l'étape technique ne
  // renseignerait personne. Listés pour que leur sort soit décidé plutôt
  // qu'oublié.
  'item_create_failed',
  'item_upload_failed',
  'item_finalize_failed',
  // Repli d'`apiAddVaultMember` quand la réponse ne porte aucun code (panne
  // réseau, passerelle). La phrase de l'appelant — « impossible de donner accès
  // à ce coffre » — dit déjà la moitié utile, et nommer l'étape technique ne
  // renseignerait personne.
  'add_member_failed',
  // Même chose pour l'annulation d'une intention (F04) : le refus NOMMÉ du
  // serveur est `intent_not_found`, qui a sa phrase ; celui-ci n'est que le
  // repli d'une réponse muette, et « impossible d'annuler » suffit.
  'intent_cancel_failed',
  // F23 — les replis de `apiFreezeVault` / `apiUnfreezeVault`. Les VRAIS refus
  // de ces deux routes ont déjà leur phrase (`vault_forbidden` pour le rang,
  // `session_expired`, `network_unavailable`) ; ceux-ci ne couvrent qu'une
  // réponse sans code, et « impossible de geler ce coffre » dit tout ce qu'il y
  // a à dire. Surtout : `vault_frozen` n'apparaît JAMAIS ici — les deux routes
  // ne portent pas `blockWhenFrozen`, précisément pour qu'un coffre gelé puisse
  // toujours être dégelé.
  'vault_freeze_failed',
  'vault_unfreeze_failed',
  // ── Enterprise-only surfaces ──────────────────────────────────────────────────
  // The rest of org.ts serves the admin console, SSO, domain verification, key
  // escrow and Shamir recovery — none of which a personal shared-vault user can
  // reach (ENTERPRISE_ACCESSIBLE === false, and rbac refuses personal orgs on
  // those routes). They are listed rather than left out so the parity test keeps
  // its meaning: an unlisted code is a FORGOTTEN one, and someone has to decide.
  'all_stale',
  'already_shamir',
  'below_threshold',
  'caller_not_included',
  'consent_mismatch',
  'consent_self_only',
  'discovery_failed',
  'dns_failed',
  'domain_taken',
  'duplicate_index',
  'duplicate_recipient',
  'escrow_not_enabled',
  'fingerprint_changed',
  'fingerprint_mismatch',
  'incomplete_rewrap',
  'invalid_logo',
  'invalid_period',
  'invalid_plan',
  'invalid_policy',
  'k_mismatch',
  'no_active_consent',
  'no_admin_wrap',
  'no_billing_account',
  'no_consent',
  'no_org_key',
  'no_recovery_copies',
  'no_recovery_copy_for_vault',
  'no_shamir_session',
  'no_share',
  'no_verified_domain',
  'not_collecting',
  'not_configured',
  'not_coordinator',
  'not_pending',
  'not_pending_deletion',
  'not_shamir',
  'org_key_exists',
  'recipient_not_admin',
  'request_exists',
  'same_key',
  'session_exists',
  'shamir_no_wrap',
  'shamir_ratcheted',
  'shamir_rotate_unsupported',
  'shamir_would_brick_recovery',
  'shares_below_threshold',
  'sso_server_misconfig',
  'txt_not_found',
  'use_shamir_convert',
  'version_conflict',
  'version_mismatch',
  'wipe_owned_by_other_org',
]);

/**
 * Le texte d'un refus, d'où qu'il vienne.
 *
 * DEUX FORMES CIRCULENT DANS CE DOSSIER, et les confondre coûte le message. Un
 * thunk rejeté par `rejectWithValue` remonte une CHAÎNE nue ; un appel d'API
 * direct lève une `Error`. Lire `.message` sur la première rend `undefined`,
 * donc `vaultErrorKey` reçoit une valeur vide et sert son repli générique — la
 * consigne précise du serveur (« transmettez la propriété avant de quitter »)
 * était remplacée par « impossible de quitter le coffre » sur le seul geste où
 * l'utilisateur avait une sortie.
 */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e ?? '');
}

/** The i18n key for `code`, or `fallbackKey` when the code is unknown/absent. */
export function vaultErrorKey(code: string | null | undefined, fallbackKey: string): string {
  if (!code) return fallbackKey;
  // Thunks sometimes suffix a code with `:userId` (removeMember reports which member).
  const bare = code.split(':')[0];
  return VAULT_ERROR_KEYS[bare] ?? fallbackKey;
}

/**
 * The SAME Worker codes, said to the person who is JOINING.
 *
 * WHY A SECOND TABLE RATHER THAN A FIX TO THE FIRST. VAULT_ERROR_KEYS was written
 * for the host: it is their plan, their roster, their invitation. Read out to the
 * person accepting, seven of its sentences are false — "your plan is full" when
 * it is the host's, "this person already has access" when that person is me,
 * "ask to be invited again" when what is actually needed is a different kind of
 * account. Both audiences are legitimate, so both keep their own words, and the
 * accept screen consults this one first.
 *
 * `vault_join_needs_space` is the only entry with no server behind it: the Worker
 * answers `org_forbidden` when a vault invitation is opened before the space one,
 * and that 403 is indistinguishable from any other authorization refusal at the
 * transport level. The client knows better — it just exhausted every tenant it
 * belongs to — so it names the situation the user can actually act on.
 */
export const JOIN_ERROR_KEYS: Readonly<Record<string, string>> = {
  // The host's ceiling, not ours — selling an upgrade here would be a lie.
  personal_seat_limit_reached: 'teamVaults.join.errors.hostSpaceFull',
  seat_limit_reached: 'teamVaults.join.errors.hostSpaceFull',
  // NOT "your plan". `upgrade_required` reaches a JOINER from one place only:
  // rbac.ts `personalFallback`, when a request arrived with no X-Org-Id and the
  // caller had no personal space to provision on a free tier. Read out as
  // "shared vaults need a paid plan" it invoices the guest for a space their HOST
  // pays for — the exact refusal the founder's decision rules out. What actually
  // happened is that no tenant was named, and the tenant arrives with the space
  // invitation, so that is what the sentence asks for.
  upgrade_required: 'teamVaults.join.errors.acceptSpaceFirst',
  // L'abonnement de l'HÔTE s'est arrêté. Proposer une mise à niveau à l'invité
  // enverrait la facture à la seule personne qui n'a rien à acheter — la même
  // erreur que `upgrade_required` ci-dessus, sous un autre code.
  host_plan_lapsed: 'teamVaults.join.errors.hostPlanLapsed',
  // "This person" is me.
  already_member: 'teamVaults.join.errors.alreadyIn',
  // Re-inviting changes nothing: strict account separation is the point (0059).
  personal_account: 'teamVaults.join.errors.needsWorkAccount',
  // THE most likely failure of the whole journey: signed in as the wrong account.
  invitation_email_mismatch: 'teamVaults.join.errors.wrongAccount',
  invite_email_mismatch: 'teamVaults.join.errors.wrongAccount',
  invitee_mismatch: 'teamVaults.join.errors.wrongAccount',
  // The two-step model, surfaced as the step that is missing.
  org_forbidden: 'teamVaults.join.errors.acceptSpaceFirst',
  not_org_member: 'teamVaults.join.errors.acceptSpaceFirst',
  // /me/invitations/:id/accept — même modèle en deux temps, autre code : les
  // gardes du middleware y sont reposées à la main et répondent `not_a_member`.
  not_a_member: 'teamVaults.join.errors.acceptSpaceFirst',
  vault_join_needs_space: 'teamVaults.join.errors.acceptSpaceFirst',
  // Le JUMEAU HONNÊTE du précédent, et l'autre entrée sans serveur derrière. La
  // jointure conclut « acceptez d'abord l'espace » quand elle n'appartient à
  // aucun locataire — mais une liste VIDE dit deux choses à la fois : « aucun
  // espace » et « je n'ai pas pu la lire ». Rendu sur une panne de lecture, ce
  // verdict est faux ET terminal ; celui-ci reste transitoire et le dit.
  vault_join_space_unknown: 'teamVaults.join.errors.spaceListUnknown',
  // Le jeton est VIVANT ; c'est le coffre porté par le LIEN qui ne lui
  // correspond pas — deux e-mails d'invitation mélangés suffisent. Ni mort
  // (rien n'est affirmé de l'invitation) ni réessayable (le même lien redonnera
  // le même refus) : ce qu'il faut, c'est l'autre lien.
  invite_vault_mismatch: 'teamVaults.join.errors.vaultMismatch',
  // Ask the host again — and say so, rather than "check your role".
  invite_expired: 'teamVaults.join.errors.expired',
  invitation_expired: 'teamVaults.join.errors.expired',
  invite_invalid: 'teamVaults.join.errors.revoked',
  invitation_not_found: 'teamVaults.join.errors.revoked',
  invitation_already_used: 'teamVaults.join.errors.alreadyUsed',
  // Un jeton NU collé à la main. Les deux sortes de jeton sont indiscernables —
  // même alphabet, même longueur — et seul le lien porte l'identifiant du coffre,
  // si bien qu'un code seul ne peut être présenté qu'à la route des ESPACES. Le
  // Worker répond alors `invitation_not_found`, dont la phrase (« retirée ou déjà
  // utilisée ») est fausse ET terminale pour quelqu'un qui a simplement recopié
  // le mauvais morceau de son e-mail. Code client, faute d'un serveur capable de
  // distinguer ce qu'il n'a jamais vu.
  invite_code_not_a_space_invite: 'teamVaults.join.errors.codeNotASpaceInvite',
  // A re-key since the invitation was issued: the sealed key is out of date.
  invite_stale_epoch: 'teamVaults.join.errors.staleEpoch',
  vault_not_found: 'teamVaults.join.errors.vaultGone',
  session_expired: 'teamVaults.join.errors.signInAgain',
};

/**
 * The i18n key for a refusal met while ACCEPTING an invitation. Falls back to the
 * host-facing table (which still holds the honest sentence for a plain transport
 * failure) and then to the caller's own fallback.
 */
export function joinErrorKey(code: string | null | undefined, fallbackKey: string): string {
  if (!code) return fallbackKey;
  const bare = code.split(':')[0];
  return JOIN_ERROR_KEYS[bare] ?? vaultErrorKey(bare, fallbackKey);
}

/**
 * Refusals that WILL come back identical however many times you press the button:
 * a decision was taken (plan, role, membership, session) and only doing something
 * else changes it. Offering "Retry" on these is a second lie after the message — it
 * implies the machine might relent. Everything not listed is treated as transient,
 * which is the safe default: a needless retry button costs one wasted click, a
 * missing one strands a user on a screen that would have worked.
 */
const TERMINAL_VAULT_ERRORS: ReadonlySet<string> = new Set([
  'upgrade_required',
  'seat_limit_reached',
  'personal_seat_limit_reached',
  'org_forbidden',
  'org_enterprise_only',
  'org_insufficient_role',
  'org_read_only',
  'personal_account',
  'session_expired',
  'member_no_key',
  'already_member',
  'already_invited',
  'invalid_email',
  'not_org_member',
  'invitee_mismatch',
  'owner_only',
  'not_vault_member',
  'domain_blocked',
  'invitation_not_found',
  'invitation_expired',
  'invitation_already_used',
  'invitation_email_mismatch',
  // Refaire le même geste rescellerait la même clé au même mauvais destinataire,
  // et rouvrirait la même intention introuvable : ni l'un ni l'autre ne cède à
  // l'insistance.
  'peer_key_mismatch',
  'intent_not_found',
  // Côté joignant : une invitation périmée, révoquée, adressée à quelqu'un
  // d'autre ou rendue caduque par une rotation de clé ne se répare qu'en en
  // demandant une nouvelle. Et un coffre proposé avant l'espace exige d'accepter
  // l'espace, pas d'appuyer à nouveau.
  'invite_expired',
  'invite_invalid',
  'invite_email_mismatch',
  'invite_stale_epoch',
  'vault_join_needs_space',
  // Recoller le même code donnera le même refus : ce qu'il faut, c'est le LIEN.
  'invite_code_not_a_space_invite',
  // Rouvrir le même lien redonnera le même refus : ce qu'il faut, c'est l'AUTRE
  // e-mail, celui dont le lien désigne bien le coffre de cette invitation.
  'invite_vault_mismatch',
  // F13 : un RÉGLAGE du coffre ne cède pas davantage à l'insistance qu'un rôle.
  // Ce qui les lève, c'est quelqu'un qui ouvre les réglages — pas le bouton
  // « Réessayer ». (`settings_version_conflict` reste, lui, réessayable : c'est
  // une concurrence, pas une décision.)
  'grants_disabled',
  'grant_expiry_too_far',
  'setting_forbidden',
  // A1-1 : redemander le même rôle donnera le même refus — le serveur n'en sert
  // qu'un, et pour une raison de clés, pas de politique. Ce qui donne
  // l'écriture, c'est une invitation au coffre, pas le bouton « Réessayer ».
  'role_unsupported',
  // F23/F24 : un coffre GELÉ le reste tant que personne ne le dégèle, et une
  // durée de conservation refusée par la politique de l'espace le sera à
  // l'identique au clic suivant — dans les deux cas, ce qu'il faut, c'est
  // quelqu'un qui change un réglage. Les DEUX autres refus de la même famille
  // restent réessayables et ce n'est pas un oubli : `vault_quota_exceeded` cède
  // dès qu'on a fait de la place (comme `pooled_quota_exceeded`, jamais rangé
  // ici non plus), et `purge_failed` est un 503 du stockage, la panne type que
  // le bouton « Réessayer » existe pour rattraper.
  'vault_frozen',
  'retention_over_policy',
  // F19 : une CONSERVATION LÉGALE ne cède à aucune insistance — c'est même tout
  // son objet. Elle manquait ici, et l'écran proposait donc « Réessayer » sur
  // une décision qui ne bougera pas : un second mensonge après le message. Ce
  // qui la lève est un geste d'administrateur d'espace, que la phrase nomme
  // désormais, comme le font déjà `vaultFrozen` et `hostPlanLapsed`.
  'legal_hold_active',
]);

/** True when pressing the same button again could plausibly succeed. */
export function isVaultErrorRetryable(code: string | null | undefined): boolean {
  if (!code) return true;
  return !TERMINAL_VAULT_ERRORS.has(code.split(':')[0]);
}

/**
 * Les refus qui signifient « CETTE INVITATION N'EXISTE PLUS » — et eux seuls.
 *
 * POURQUOI CET ENSEMBLE EST DISTINCT DE `TERMINAL_VAULT_ERRORS`, ET POURQUOI LA
 * DISTINCTION EST LE CŒUR DU PARCOURS D'ACCEPTATION. « Terminal » ne répond qu'à
 * UNE question : faut-il proposer « Réessayer » ? Il ne dit rien de la survie de
 * l'invitation. Or l'écran d'acceptation effaçait le jeton sur tout ce qui était
 * terminal, si bien que les deux échecs les PLUS PROBABLES du parcours le
 * détruisaient :
 *   — `session_expired`, dont la phrase promet « reconnectez-vous, l'invitation
 *     vous attendra » ;
 *   — `invitation_email_mismatch`, dont la phrase demande de se reconnecter avec
 *     l'adresse destinataire.
 * Les deux messages décrivaient donc exactement le contraire de ce que le code
 * faisait. Et comme n'importe quel 403/404 sans code devient `org_forbidden`
 * (`classifyVaultFailure`), un défi Cloudflare ou un mauvais routage suffisait à
 * rentrer par la même porte.
 *
 * LA RÈGLE, une fois pour toutes : ne rejoignent cet ensemble que les refus par
 * lesquels le SERVEUR affirme un fait sur l'invitation elle-même — introuvable,
 * déjà consommée, périmée, ou devenue sans objet parce que l'adhésion existe
 * déjà. Un refus d'autorisation, une panne, une session tombée, un mauvais
 * compte : le jeton est CONSERVÉ, si terminal que soit le refus. En cas de
 * doute, ne pas ajouter — garder un jeton mort coûte une modale à refermer,
 * jeter un jeton vivant coûte l'invitation, et personne ne peut la rendre.
 */
const DEAD_INVITE_CODES: ReadonlySet<string> = new Set([
  // Le serveur ne connaît pas ce jeton (org.ts `resolveInvitation`, 404).
  'invitation_not_found',
  // Le jeton de coffre est inconnu ou déjà consommé (vaults.ts, 404).
  'invite_invalid',
  // Déjà acceptée ou révoquée (org.ts, 409).
  'invitation_already_used',
  // Passé la date d'expiration : 410 des deux côtés.
  'invitation_expired',
  'invite_expired',
  // L'adhésion existe déjà : l'invitation n'a plus rien à produire (409).
  'already_member',
  /**
   * La clé du coffre a tourné depuis l'émission (vaults.ts, 409) : le scellé que
   * l'invitation transporte est daté d'une époque révolue.
   *
   * POURQUOI C'EST BIEN UN FAIT AFFIRMÉ SUR L'INVITATION, malgré les apparences.
   * L'époque du coffre ne fait que MONTER — `rotateVaultKey` ne connaît que
   * `newEpoch = prevEpoch + 1`, posé par un compare-and-set sur l'époque
   * précédente — tandis que celle du scellé est figée à l'émission. Une fois les
   * deux séparées, plus aucune reprise ne peut les faire coïncider : cette
   * invitation-là ne s'ouvrira jamais. Sa propre phrase le dit déjà (« demandez
   * une nouvelle invitation ») ; garder le jeton faisait revenir la même fenêtre
   * à chaque démarrage pendant sept jours, sans qu'aucun geste puisse aboutir.
   *
   * LE VOISIN QU'ON NE RANGE PAS ICI, et pourquoi : `invite_vault_mismatch`
   * (même route, même 404) n'affirme RIEN de l'invitation — le Worker dit
   * lui-même que le jeton est valide et en attente, et que c'est le coffre porté
   * par le lien qui ne lui correspond pas. Le bon lien la fera aboutir.
   * `invite_email_mismatch` et `invitation_email_mismatch` non plus : la bonne
   * adresse les fait aboutir. `invite_stale_epoch` est le seul refus de cette
   * famille qu'AUCUNE action de l'utilisateur ne peut plus dénouer.
   */
  'invite_stale_epoch',
]);

/**
 * True quand le serveur a affirmé que l'invitation elle-même n'existe plus, et
 * que le jeton conservé ne peut donc plus rien produire.
 *
 * C'est la SEULE condition qui autorise l'écran d'acceptation à effacer le
 * porteur. Tout le reste — y compris terminal — le laisse en place.
 */
export function isDeadInviteError(code: string | null | undefined): boolean {
  if (!code) return false;
  return DEAD_INVITE_CODES.has(code.split(':')[0]);
}

/** True when the honest next step is to upgrade the plan, not to retry. */
export function isVaultUpgradeError(code: string | null | undefined): boolean {
  if (!code) return false;
  const bare = code.split(':')[0];
  return (
    bare === 'upgrade_required' ||
    bare === 'seat_limit_reached' ||
    bare === 'personal_seat_limit_reached'
  );
}
