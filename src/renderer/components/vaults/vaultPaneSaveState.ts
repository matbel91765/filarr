/**
 * CE QUE LE PANNEAU DIT DE L'ENREGISTREMENT — et c'est le seul endroit où l'on
 * peut PROUVER qu'il ne ment pas.
 *
 * ══ LE DÉFAUT QUE CE MODULE FERME ═══════════════════════════════════════════
 *
 * La note d'un coffre ouverte dans l'onglet Notes reçoit l'habillage de
 * l'éditeur de notes ordinaire : plus de pied de fenêtre, plus de bouton
 * « Enregistrer dans le coffre » planté en bas d'une boîte de dialogue. Or une
 * note de coffre ne s'enregistre PAS toute seule comme une note personnelle.
 * L'écriture différée (`shouldWriteBackVaultNote`) ne tire que dans deux cas :
 * on est le pair ÉLU d'une salle qui s'est effectivement stabilisée, ou l'on est
 * le rédacteur ISOLÉ (`loneVaultSaverEligible` : vingt secondes de silence et un
 * coffre à un seul membre). Relais injoignable, salle jamais vue, conflit
 * ouvert, coffre gelé : rien n'écrit, et le bouton du pied était la SEULE issue.
 *
 * Retirer ce pied sans rien mettre à la place aurait perdu du texte en silence —
 * c'est-à-dire le défaut d'origine, retourné et aggravé. Ce module est la
 * contrepartie : le panneau ne se tait jamais sur l'état de l'enregistrement, et
 * chaque état où du travail n'est pas dans le coffre NOMME ce qui va l'y mettre.
 *
 * ══ POURQUOI UN MODULE PUR, ET PAS UNE POIGNÉE DE TERNAIRES DANS LE RENDU ═══
 *
 * Parce qu'un badge « Enregistré » affiché à tort ne se voit pas : ni à la
 * compilation, ni à l'écran, ni au test de rendu — il se voit une seule fois,
 * chez quelqu'un qui a fermé son panneau en confiance. La règle vit donc ici,
 * sans React, avec deux invariants que les tests tendent :
 *
 *   1. `'saved'` n'est rendu QUE sur un document propre. Aucun chemin ne peut
 *      dire « c'est dans le coffre » alors que ça n'y est pas.
 *   2. TOUT état où du travail est en attente désigne un secours
 *      (`vaultPaneSaveRelief`) : le bouton, l'écran de conflit, l'automatique,
 *      ou l'aveu qu'on ne peut plus écrire ici. Aucun état ne laisse quelqu'un
 *      avec du texte en attente et rien pour l'enregistrer.
 *
 * ══ CE QU'IL N'INVENTE PAS ══════════════════════════════════════════════════
 *
 * L'autorité sur « est-ce que l'automatique va tirer » reste
 * `shouldWriteBackVaultNote` : ce module l'APPELLE plutôt que d'en recopier la
 * liste de vetos. Une parité entre deux dérivés ne garde rien ; seule une
 * confrontation à l'autorité garde quelque chose.
 *
 * ══ UNE CAPACITÉ N'EST PAS UNE PROMESSE ═════════════════════════════════════
 *
 * Et c'est la leçon la plus chère de ce fichier. `shouldWriteBackVaultNote`
 * répond « ai-je le DROIT d'écrire », jamais « quelque chose va-t-il écrire » :
 * le minuteur, lui, est armé à la main, à chaque modification, par les appels à
 * `scheduleAutoSave` de `VaultNoteEditor`. Tant que ce module déduisait la
 * couverture de la seule capacité, il a suffi qu'un chemin de modification
 * oublie d'armer — c'était le cas du TITRE, qui montait `dirty` sans jamais
 * lancer de minuteur — pour que le badge annonce « enregistrement pris en
 * charge » sur du texte que rien n'écrirait jamais.
 *
 * `vaultPaneAutoSaveCovers` reçoit donc un FAIT (`autoSaveArmed` : un minuteur
 * court en ce moment) et non une déduction. Un chemin qui oublierait d'armer
 * dégrade désormais vers le bouton — visible, et sans perte — au lieu de mentir.
 */

import { shouldWriteBackVaultNote, type VaultWriteBackInput } from './vaultNoteCollab';

// ─────────────────────────────────────────────────────────────────────────────
// « Quelque chose d'autre que mon clic va-t-il écrire ce document ? »
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les vetos d'écriture automatique, PRIVÉS de leurs trois entrées transitoires.
 *
 * `dirty`, `saving` et `hasConflict` décrivent l'instant, pas la CAPACITÉ : ils
 * sont représentés à part dans l'état affiché (« enregistrement… », « conflit »,
 * « enregistré »), et les laisser ici ferait dire « l'automatique ne couvre
 * pas » à un document simplement propre.
 */
export type VaultAutoSaveCapability = Omit<VaultWriteBackInput, 'dirty' | 'saving' | 'hasConflict'>;

export interface VaultPaneAutoSaveInput {
  /**
   * UN MINUTEUR D'ÉCRITURE DIFFÉRÉE COURT EN CE MOMENT — le fait, pas la
   * capacité. C'est la première question, et elle ne concerne pas le droit
   * d'écrire mais l'existence du déclencheur : le minuteur n'existe que si un
   * chemin de modification l'a ARMÉ (`scheduleAutoSave`), ce qu'aucun veto ne
   * dit et qu'aucune déduction ne remplace.
   */
  autoSaveArmed: boolean;
  /** La salle a rendu son verdict (`vaultRoomSettled`) — le rejeu est fini. */
  settled: boolean;
  /**
   * UN AUTRE PAIR TIENT LE STYLO (`participant.isSaver && !isLocal`).
   *
   * C'est le second chemin, et il est indispensable : dans une salle vivante, un
   * pair NON élu est en permanence « sale » (son texte n'est pas encore commis)
   * sans qu'aucun geste de sa part n'y change rien. Lui montrer « modifications
   * non enregistrées » avec un bouton, ce serait l'inviter à écrire par-dessus
   * l'élu et à récolter un 409 — alors que son texte est déjà en route vers
   * celui qui commite, et que le commit annoncé effacera son attente.
   */
  otherSaverPresent: boolean;
  /**
   * NOTRE TITRE DIFFÈRE DE CELUI QUE LE COFFRE DÉTIENT — et le titre n'est PAS
   * dans le document partagé (il part dans les métadonnées de l'élément, avec
   * celui qui commite). Le pair qui tient le stylo enregistrera donc le texte de
   * la salle avec SON titre, jamais avec le nôtre : sur ce chemin-là, sa
   * couverture s'arrête au corps. Le taire, c'était afficher « enregistrement
   * pris en charge » à quelqu'un dont le renommage allait être écrasé.
   */
  titlePending: boolean;
  /**
   * Le relais nous a dégradés en lecteur (coffre gelé, rétrogradation). Il
   * annule les DEUX chemins : ni nous ni l'élu n'écrirons dans ce coffre-là.
   */
  serverReadOnly: boolean;
  /** Ce que l'autorité répond pour NOUS, transitoires neutralisés. */
  capability: VaultAutoSaveCapability;
}

/**
 * Y a-t-il, en dehors d'un clic explicite, quelque chose qui écrira ce document
 * dans le coffre ? La réponse commande le mot affiché ET la présence du bouton.
 *
 * DEUX CHEMINS, ET ILS NE COUVRENT PAS LA MÊME CHOSE : le nôtre (un minuteur
 * armé + le droit d'écrire) emporte le corps ET le titre, puisque c'est notre
 * commit ; celui de l'élu n'emporte que ce que le CRDT lui a porté.
 */
export function vaultPaneAutoSaveCovers(input: VaultPaneAutoSaveInput): boolean {
  if (input.serverReadOnly) return false;
  if (
    input.autoSaveArmed &&
    shouldWriteBackVaultNote({
      ...input.capability,
      // Le document EST supposé sale : la question posée ici est « si je tape,
      // est-ce que ça partira ? », pas « est-ce que ça part en ce moment ».
      dirty: true,
      saving: false,
      hasConflict: false,
    })
  ) {
    return true;
  }
  if (input.titlePending) return false;
  return input.settled && input.otherSaverPresent;
}

// ─────────────────────────────────────────────────────────────────────────────
// L'état affiché
// ─────────────────────────────────────────────────────────────────────────────

/**
 * · `read-only`       — on ne peut pas écrire, et rien n'est en attente.
 * · `blocked-unsaved` — on ne peut plus écrire ALORS QUE du travail attend. Cet
 *                       état existe parce que « lecture seule » tout court
 *                       serait un demi-aveu : le gel ou la révocation arrive
 *                       souvent SUR quelqu'un qui écrivait, et il doit
 *                       apprendre que son texte ne partira pas d'ici.
 * · `saving`          — un commit est en vol.
 * · `conflict`        — un 409 possède l'écran, et il porte « enregistrer ma
 *                       version » : le geste existe, il est juste ailleurs.
 * · `conflict-gone`   — l'élément a été SUPPRIMÉ pendant l'édition. Le même 409,
 *                       et pourtant l'inverse : l'écran de conflit n'offre plus
 *                       que « Fermer », parce qu'il n'y a plus rien sur quoi se
 *                       rebaser. Les confondre faisait promettre au badge un
 *                       geste que personne ne trouverait.
 * · `saved`           — tout est dans le coffre.
 * · `offline-pending` — LA REQUÊTE N'A RENCONTRÉ PERSONNE, et une reprise est
 *                       ARMÉE. Cet état existe parce que « rien ne les
 *                       enregistrera tout seul » était faux (une reprise est
 *                       prévue) et « enregistrement pris en charge » l'était
 *                       tout autant (l'automatique de la salle n'y est pour
 *                       rien) : ni l'un ni l'autre ne disait la CAUSE, et
 *                       aucun des deux n'avouait que le brouillon n'est stocké
 *                       nulle part. Il ne peut PAS se déduire d'un
 *                       `navigator.onLine` : il faut une tentative qui a
 *                       réellement échoué (voir `classifyVaultSaveFailure`) ET
 *                       une reprise réellement armée.
 * · `unsaved-auto`    — en attente, et quelque chose d'autre va l'écrire.
 * · `unsaved-manual`  — en attente, et RIEN ne l'écrira : le bouton est la
 *                       seule issue. C'est l'état pour lequel ce module existe.
 */
export type VaultPaneSaveState =
  | 'read-only'
  | 'blocked-unsaved'
  | 'saving'
  | 'conflict'
  | 'conflict-gone'
  | 'saved'
  | 'offline-pending'
  | 'unsaved-auto'
  | 'unsaved-manual';

/**
 * LES DEUX 409 NE SE RESSEMBLENT QUE DE LOIN.
 *
 * `'open'` : quelqu'un a écrit avant nous, l'élément existe, sa version est
 * connue — l'écran de conflit porte « enregistrer ma version par-dessus ».
 * `'gone'` : `conflict.serverVersion === null`, l'élément a été supprimé pendant
 * l'édition. Il n'y a plus de version sur laquelle se rebaser, l'écran n'offre
 * que « Fermer », et un badge qui renverrait vers un geste inexistant enverrait
 * chercher un bouton absent au lieu de dire de copier son texte.
 */
export type VaultPaneConflict = 'none' | 'open' | 'gone';

export interface VaultPaneSaveStateInput {
  /** Notre rôle permet d'écrire ET la salle ne nous a pas dégradés. */
  mayWrite: boolean;
  /** Le veto venu d'en face (jeton `viewer` sur coffre gelé). */
  serverReadOnly: boolean;
  /** Un conflit non résolu est à l'écran, et LEQUEL. */
  conflict: VaultPaneConflict;
  /** Un enregistrement est en vol. */
  saving: boolean;
  /**
   * LE DOCUMENT DIFFÈRE DE CE QUE LE COFFRE DÉTIENT — `dirty`, pas `unsaved`.
   *
   * Le choix est délibéré et c'est le plus important de ce fichier. `unsaved` ne
   * couvre que NOS frappes ; `dirty` couvre aussi celles qui sont arrivées par
   * le CRDT et le titre. Le second est un sur-ensemble du premier, donc le
   * choisir ne peut produire qu'une erreur dans le sens sûr : au pire on
   * annonce « non enregistré » sur le travail d'un autre (qui est réellement
   * non enregistré, et que `unsaved-auto` explique), jamais « enregistré » sur
   * un document qui ne l'est pas.
   */
  dirty: boolean;
  /** Le verdict de `vaultPaneAutoSaveCovers`. */
  autoSaveCovers: boolean;
  /**
   * UNE TENTATIVE A ÉCHOUÉ FAUTE DE RÉSEAU, ET UNE REPRISE EST ARMÉE — deux
   * faits, pas une supposition, et c'est tout le sujet.
   *
   * Le premier vient d'un enregistrement RÉELLEMENT parti et RÉELLEMENT revenu
   * sans réponse ; le second, d'un minuteur qui court en ce moment. Le lire
   * d'un `navigator.onLine` aurait fait promettre une reprise sur un
   * navigateur qui se croit hors ligne alors que tout fonctionne — la même
   * faute que « une capacité n'est pas une promesse », par une autre porte.
   *
   * Faux dès que la reprise s'épuise : l'état redescend alors à
   * `unsaved-manual`, avec son bouton, plutôt que de continuer à annoncer une
   * reprise qui n'aura pas lieu.
   */
  offlineRetryArmed: boolean;
}

/**
 * L'ORDRE DES QUESTIONS EST LA RÈGLE, et chaque rang se justifie :
 *
 *  1. `saving` d'abord — un commit en vol est un FAIT, et il reste vrai même si
 *     un gel arrive au milieu. Le reléguer derrière la lecture seule ferait
 *     afficher « lecture seule » sur un envoi qui, lui, va aboutir ou échouer
 *     avec son propre message.
 *  2. l'incapacité d'écrire ensuite, en DEUX états selon qu'il y a du travail
 *     en attente ou non — voir `blocked-unsaved`.
 *  3. le conflit avant la propreté : tant qu'un 409 est à l'écran, la question
 *     « est-ce enregistré » a une réponse, et c'est non. Répondre « enregistré »
 *     parce que les compteurs sont retombés contredirait le bandeau juste
 *     au-dessus.
 *  4. `dirty` enfin, et c'est le seul chemin vers `'saved'`.
 *  5. et, sur un document sale, LA COUPURE AVANT L'ESPOIR : une tentative qui a
 *     échoué faute de réseau est un fait établi, `autoSaveCovers` n'est qu'une
 *     capacité — l'ordre inverse aurait fait dire « enregistrement pris en
 *     charge » juste après un envoi qui vient de ne rencontrer personne.
 */
export function vaultPaneSaveState(input: VaultPaneSaveStateInput): VaultPaneSaveState {
  if (input.saving) return 'saving';
  if (!input.mayWrite || input.serverReadOnly) {
    return input.dirty ? 'blocked-unsaved' : 'read-only';
  }
  if (input.conflict === 'gone') return 'conflict-gone';
  if (input.conflict === 'open') return 'conflict';
  if (!input.dirty) return 'saved';
  if (input.offlineRetryArmed) return 'offline-pending';
  return input.autoSaveCovers ? 'unsaved-auto' : 'unsaved-manual';
}

/** Du travail n'est pas dans le coffre. La moitié de l'invariant. */
export function vaultPaneSaveIsPending(state: VaultPaneSaveState): boolean {
  return state !== 'saved' && state !== 'read-only';
}

/**
 * CE QUI VA METTRE LE TRAVAIL À L'ABRI — l'autre moitié de l'invariant.
 *
 * Un état en attente DOIT nommer son secours, et le test l'exige pour chaque
 * valeur de l'énumération : ajouter un état sans le classer ici fait tomber le
 * garde-fou plutôt que de laisser naître un badge qui ne mène nulle part.
 *
 * · `button`         — le geste explicite, offert par l'habillage ;
 * · `in-flight`      — c'est déjà parti ;
 * · `conflict-panel` — l'écran de conflit porte « enregistrer ma version » ;
 * · `automatic`      — l'élu (nous ou un autre) écrira sans qu'on demande ;
 * · `retry`          — la MÊME écriture repartira d'elle-même, et la nuance
 *                      compte : ce n'est pas la salle qui écrit, c'est notre
 *                      propre envoi qui est en attente du réseau. Le nombre de
 *                      tentatives est borné, donc cette promesse a une fin —
 *                      quand elle tombe, l'état passe à `unsaved-manual` et le
 *                      bouton revient ;
 * · `cannot-write`   — AUCUN secours ici, et c'est justement ce qu'il faut
 *                      dire : le message invite à mettre le texte à l'abri
 *                      ailleurs plutôt qu'à cliquer sur un bouton qui échouera ;
 * · `none-needed`    — rien n'attend.
 */
export type VaultPaneSaveRelief =
  | 'button'
  | 'in-flight'
  | 'conflict-panel'
  | 'automatic'
  | 'retry'
  | 'cannot-write'
  | 'none-needed';

export function vaultPaneSaveRelief(state: VaultPaneSaveState): VaultPaneSaveRelief {
  switch (state) {
    case 'unsaved-manual':
      return 'button';
    case 'saving':
      return 'in-flight';
    case 'conflict':
      return 'conflict-panel';
    // L'ÉLÉMENT N'EXISTE PLUS : l'écran de conflit n'offre que « Fermer », et
    // aucun bouton de ce panneau n'écrira jamais dans un objet supprimé. Le seul
    // secours honnête est l'aveu — le même que sous un coffre gelé.
    case 'conflict-gone':
      return 'cannot-write';
    case 'unsaved-auto':
      return 'automatic';
    // PAS DE BOUTON ICI, ET C'EST DÉLIBÉRÉ : tant qu'une reprise est armée, un
    // clic ferait exactement ce qu'elle fera — et échouerait exactement pareil,
    // en rejouant le même message. Le geste revient de lui-même dès que la
    // reprise s'épuise, parce que l'état redevient alors `unsaved-manual`.
    case 'offline-pending':
      return 'retry';
    case 'blocked-unsaved':
      return 'cannot-write';
    case 'saved':
    case 'read-only':
      return 'none-needed';
  }
}

/**
 * L'habillage doit-il poser le bouton d'enregistrement ?
 *
 * `'saving'` le garde À L'ÉCRAN (en cours) plutôt que de le faire disparaître :
 * un bouton qui s'évapore au clic laisse croire qu'on a raté sa cible, et le
 * faire revenir ensuite déplace tout ce qui l'entoure.
 *
 * `'unsaved-auto'` ne l'obtient PAS, et c'est un choix : le proposer à un pair
 * non élu l'inviterait à écrire par-dessus celui qui tient le stylo, pour
 * récolter un 409 sur un état parfaitement sain. Le mot affiché dit alors que
 * l'enregistrement est pris en charge — ce que le modèle vient de PROUVER par
 * l'autorité, et non par une supposition.
 */
export function vaultPaneOffersSave(state: VaultPaneSaveState): boolean {
  return state === 'unsaved-manual' || state === 'saving';
}

/** Le bouton posé est-il actionnable ? En vol, non. */
export function vaultPaneSaveEnabled(state: VaultPaneSaveState): boolean {
  return state === 'unsaved-manual';
}

/**
 * La clé i18n du mot affiché, et la teinte de la pastille. Ici parce que le
 * couple état → phrase fait partie de la promesse : un état sans phrase serait
 * un silence, et c'est contre le silence que ce module est écrit.
 */
export interface VaultPaneSaveLabel {
  /** Sous `teamVaults.noteEditor.pane.` */
  key: string;
  /**
   * Reprend le vocabulaire de `.note-editor__save-dot--*`, à une teinte près :
   * `idle` est ajoutée par `VaultNoteEditor.css` pour l'état « je ne peux pas
   * écrire ici ». Le vert de `synced` y aurait dit « c'est enregistré », ce qui
   * n'est pas la question posée à un lecteur.
   */
  tone: 'synced' | 'saving' | 'pending' | 'error' | 'idle';
}

export function vaultPaneSaveLabel(state: VaultPaneSaveState): VaultPaneSaveLabel {
  switch (state) {
    case 'saved':
      return { key: 'stateSaved', tone: 'synced' };
    case 'saving':
      return { key: 'stateSaving', tone: 'saving' };
    case 'read-only':
      return { key: 'stateReadOnly', tone: 'idle' };
    case 'blocked-unsaved':
      return { key: 'stateBlocked', tone: 'error' };
    case 'conflict':
      return { key: 'stateConflict', tone: 'error' };
    case 'conflict-gone':
      return { key: 'stateConflictGone', tone: 'error' };
    // TEINTE D'ATTENTE, PAS D'ERREUR : rien n'est cassé, rien n'est perdu, et
    // le rouge de `error` ferait lire une coupure comme un refus du coffre —
    // le mensonge exact que cet état existe pour défaire.
    case 'offline-pending':
      return { key: 'stateOffline', tone: 'pending' };
    case 'unsaved-auto':
      return { key: 'stateUnsavedAuto', tone: 'saving' };
    case 'unsaved-manual':
      return { key: 'stateUnsavedManual', tone: 'pending' };
  }
}

/**
 * L'AVEU : « ce brouillon n'est stocké nulle part ».
 *
 * ET C'EST LITTÉRALEMENT VRAI — aucune couche de ce panneau n'écrit le texte en
 * attente sur ce poste : ni `localStorage`, ni IndexedDB, ni fichier. Recharger
 * la page ou fermer l'onglet hors ligne le perd, entier. Tant que la promesse
 * affichée était « ça repartira tout seul », personne n'avait de raison de s'en
 * méfier ; or la reprise ne survit pas au rechargement, elle non plus.
 *
 * RÉSERVÉ À `offline-pending`, et pas étendu à tout état en attente : c'est le
 * seul où l'écran annonce qu'il faut ATTENDRE, donc le seul où quelqu'un est
 * invité à laisser la note de côté — et le seul, donc, où le taire coûterait du
 * texte. Ailleurs, l'écran demande un geste immédiat, et un second avertissement
 * ne ferait qu'affaiblir le premier.
 */
export function vaultPaneWarnsDraftIsNowhere(state: VaultPaneSaveState): boolean {
  return state === 'offline-pending';
}

/** Toutes les valeurs, pour que les tests ne puissent pas en oublier une. */
export const VAULT_PANE_SAVE_STATES: readonly VaultPaneSaveState[] = [
  'read-only',
  'blocked-unsaved',
  'saving',
  'conflict',
  'conflict-gone',
  'saved',
  'offline-pending',
  'unsaved-auto',
  'unsaved-manual',
];

/** Toutes les valeurs de conflit, même raison. */
export const VAULT_PANE_CONFLICTS: readonly VaultPaneConflict[] = ['none', 'open', 'gone'];
