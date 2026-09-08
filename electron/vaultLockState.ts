/**
 * ÉTAT DE VERROUILLAGE DU COFFRE, CÔTÉ MAIN — en un seul endroit.
 *
 * POURQUOI CE MODULE EXISTE
 *
 * Verrouiller n'effaçait qu'une partie de ce qui rend le contenu lisible.
 * `lockVaultFromMain` efface la clé de session (la FEK du compte) et le coffre
 * de notes en clair ; il n'efface pas `StorageService.key`, la clé MACHINE.
 * Après un verrouillage automatique, tout ce qui est chiffré à cette clé restait
 * donc déchiffrable à la demande par la surface IPC.
 *
 * ET L'EFFACER NE RÉGLERAIT RIEN. `loadOrGenerateKey` relit la clé machine
 * depuis `encryption.key.safe` par `safeStorage.decryptString`, sans la moindre
 * interaction : la remettre à `null` la ferait recharger en silence au premier
 * appel qui en a besoin. La clé machine est, par construction, récupérable sans
 * mot de passe — ce n'est pas un secret qu'un verrou peut retirer.
 *
 * Ce qu'un verrou PEUT faire, c'est refuser de s'en servir. D'où ce module :
 * l'état vit à UN endroit, et `assertVaultUnlocked` le fait respecter à
 * l'entrée des canaux IPC qui rendent du clair.
 *
 * CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS — à dire honnêtement, parce
 * que la tentation est grande de vendre ça comme du chiffrement :
 *   · protégé : la surface applicative. Un coffre verrouillé cesse de répondre
 *     aux demandes de déchiffrement, y compris celles d'un client IPC local qui
 *     ne passe pas par notre interface (serveur MCP, greffon, fenêtre mini).
 *   · NON protégé : le disque. Avec le Verrouillage renforcé désactivé,
 *     `encryption.key.safe` et `.fek_safe` restent là, descellables par la
 *     session Windows de l'utilisateur. Qui a les fichiers et la session a le
 *     contenu, verrou ou pas.
 *
 * POURQUOI `null` N'EST PAS TRAITÉ COMME « VERROUILLÉ »
 *
 * L'instinct correct est de fermer par défaut. Il est ici hors sujet, et le
 * coût serait un démarrage cassé par intermittence.
 *
 * `null` veut dire « le renderer n'a encore rien rapporté ». Or c'est
 * exactement l'état du DÉMARRAGE : l'écran de choix de profil doit déchiffrer
 * `profiles.json` avant que le moindre profil soit actif, et `App.tsx` ne pousse
 * son premier rapport (`pushRendererLockState`) qu'après la sélection. Fermer
 * sur `null` refuserait ces lectures-là.
 *
 * Et surtout : fermer sur `null` n'achèterait aucune protection réelle. Les
 * chemins qui perdent la clé — inactivité, verrouillage de session Windows,
 * mise en veille, tray, raccourci global, déconnexion, politique
 * d'organisation — passent TOUS par un signal explicite qui pose `true`. Le seul
 * moyen d'atteindre `null` est de n'avoir jamais verrouillé.
 *
 * Le tray, lui, garde sa lecture prudente à part (`isVaultLockedForDisplay`) :
 * afficher un cadenas de trop n'a jamais fait perdre de données.
 */

import { ERR_VAULT_LOCKED } from './sessionKeyStore';

/**
 * Erreur rendue aux appelants IPC pendant que le coffre est verrouillé.
 * Réexportée depuis `sessionKeyStore` pour que le renderer n'ait QU'UNE chaîne
 * à reconnaître, qu'il ait buté sur la porte ou sur l'absence de FEK.
 */
export { ERR_VAULT_LOCKED };

/** Ce qui a fait basculer l'état — journalisé, jamais montré à l'utilisateur. */
export type VaultLockCause =
  | 'renderer-report'
  | 'main-lock'
  | 'session-key-set'
  | 'session-key-cleared'
  | 'profile-switch';

/**
 * `null` = jamais rapporté dans cette session. Voir l'en-tête : la porte le lit
 * comme « déverrouillé », le tray comme « probablement verrouillé ».
 */
let reported: boolean | null = null;
let lastCause: VaultLockCause | null = null;

/**
 * Ceux qui attendent la PREUVE que le renderer a fini de purger son écriture en
 * attente. Voir `awaitRendererLockReport`.
 */
let pendingLockReportWaiters: Array<(outcome: 'reported' | 'timeout') => void> = [];

/** Rapport poussé par le renderer à chaque transition lockApp/unlockApp. */
export function reportRendererLockState(locked: boolean): void {
  reported = locked;
  lastCause = 'renderer-report';
  if (!locked) return;
  // Un rapport « verrouillé » n'arrive qu'APRÈS `forgetSessionSecrets`, qui
  // purge l'écriture en attente avant de dispatcher `lockApp`. Il vaut donc
  // accusé de réception : le disque porte le travail, la clé peut partir.
  const waiters = pendingLockReportWaiters;
  pendingLockReportWaiters = [];
  for (const resolve of waiters) resolve('reported');
}

/**
 * ATTEND QUE LE RENDERER AIT FINI D'ÉCRIRE, sans jamais bloquer le
 * verrouillage.
 *
 * `lockVaultFromMain` effaçait la clé de session AVANT de prévenir le
 * renderer : sur un profil hybride, la sauvegarde que le debounce de l'auto-save
 * retenait (jusqu'à deux secondes de frappe) n'avait alors plus de clé pour
 * s'écrire, et la frappe était perdue. Le main doit donc demander, attendre, et
 * seulement ensuite effacer.
 *
 * DEUX PIÈGES, tous deux fermés par la forme de cette fonction :
 *
 *   · ARMER AVANT DE DIFFUSER. La promesse est créée par l'appel, pas au
 *     premier `await` : `const ack = awaitRendererLockReport(...)` puis la
 *     diffusion, puis `await ack`. Un rapport très rapide ne peut plus se
 *     glisser entre les deux.
 *   · NE PAS COMPTER UN VIEUX RAPPORT. Par construction : seuls les rapports
 *     POSTÉRIEURS à l'armement résolvent cette promesse — celui d'un
 *     verrouillage précédent a déjà vidé la liste d'attente.
 *
 * Ne rejette jamais, et n'attend jamais indéfiniment. Fenêtre fermée, renderer
 * planté, ou seule la fenêtre mini ouverte (elle ne rapporte pas) : le délai
 * expire et l'appelant efface quand même. Un verrouillage qui n'efface pas
 * serait pire que tout ce que cette attente cherche à sauver.
 */
export function awaitRendererLockReport(timeoutMs: number): Promise<'reported' | 'timeout'> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      pendingLockReportWaiters = pendingLockReportWaiters.filter((w) => w !== onReport);
      resolve('timeout');
    }, timeoutMs);
    // Le minuteur ne doit pas, à lui seul, retenir le processus au moment de
    // quitter — l'effacement de la clé a d'autres chemins que celui-ci.
    (timer as unknown as { unref?: () => void }).unref?.();

    const onReport = (outcome: 'reported' | 'timeout'): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    pendingLockReportWaiters.push(onReport);
  });
}

/**
 * Verrouillage décidé par le main (tray, raccourci, powerMonitor, inactivité).
 * Doit tenir même si le renderer dort : c'est le chemin que la porte protège.
 */
export function noteVaultLockedByMain(): void {
  reported = true;
  lastCause = 'main-lock';
}

/** La FEK vient d'être déposée par le renderer : session déverrouillée. */
export function noteSessionKeySet(): void {
  reported = false;
  lastCause = 'session-key-set';
}

/** La FEK vient d'être retirée : session verrouillée. */
export function noteSessionKeyCleared(): void {
  reported = true;
  lastCause = 'session-key-cleared';
}

/**
 * Changement de profil. Le rapport de l'ancien profil est périmé, et le nouveau
 * n'a pas encore parlé — on revient à `null`.
 *
 * On ne pose PAS `true` ici, et c'est délibéré : choisir un profil est un geste
 * humain qui ne part jamais d'un écran verrouillé (l'écran de déverrouillage
 * couvre toute la fenêtre), et le profil entrant charge dossiers, notes et mise
 * en page dans la foulée. Poser `true` refuserait précisément ces lectures-là.
 */
export function noteProfileSwitch(): void {
  reported = null;
  lastCause = 'profile-switch';
}

/** Le rapport brut, `null` compris — pour le tray et pour les journaux. */
export function getReportedLockState(): boolean | null {
  return reported;
}

/** La dernière cause de bascule, pour les journaux de diagnostic. */
export function getLastLockCause(): VaultLockCause | null {
  return lastCause;
}

/**
 * LA PORTE. Un `null` (rien rapporté) laisse passer — voir l'en-tête.
 */
export function isVaultLocked(): boolean {
  return reported === true;
}

/**
 * Lecture du TRAY, volontairement plus prudente que la porte : sans rapport, on
 * retombe sur la sonde main-side (`hasSessionKey`). Les profils locaux (clé
 * machine) ne chargent jamais de clé de session : tant qu'ils n'ont pas parlé,
 * le tray montre « verrouillé ». Comportement historique, préservé tel quel.
 */
export function isVaultLockedForDisplay(hasSessionKey: boolean): boolean {
  if (reported !== null) return reported;
  return !hasSessionKey;
}

/**
 * Refuse l'opération pendant que le coffre est verrouillé. `channel` n'apparaît
 * QUE dans le journal : le message rendu à l'appelant reste `ERR_VAULT_LOCKED`,
 * identique à celui que `sessionKeyStore` produit déjà, pour que le renderer
 * n'ait qu'une seule chaîne à reconnaître.
 */
export function assertVaultUnlocked(channel: string): void {
  if (!isVaultLocked()) return;
  const err = new Error(ERR_VAULT_LOCKED) as Error & { channel?: string };
  err.channel = channel;
  throw err;
}

/** Remise à zéro — tests uniquement. */
export function resetVaultLockStateForTests(): void {
  reported = null;
  lastCause = null;
  pendingLockReportWaiters = [];
}
