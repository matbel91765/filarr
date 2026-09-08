/**
 * LA BASCULE — le dernier geste, et le seul qui abandonne l'ancienne clé.
 *
 * ═══ LE PIÈGE QUE CE MODULE EXISTE POUR FERMER ═══
 *
 * Sur le bureau, la FEK est RÉPLIQUÉE. `wrapped_fek.json` et `.fek_safe` vivent
 * dans `StorageService.getBaseDir()`, c'est-à-dire le répertoire du profil
 * ACTIF, et `ensureFEKAvailable` les RECOPIE depuis la racine ou depuis un
 * autre profil quand ils manquent. Il existe donc N+1 copies de la même clé :
 * `FilarData/` plus une par `FilarData/profiles/<id>/`.
 *
 * Et `initWithExistingFEK` n'écrit QUE la racine, tandis que `hybrid:loadFEK`
 * lit LE PROFIL ACTIF D'ABORD — et `ensureFEKAvailable` ne recopie que si le
 * fichier MANQUE, jamais s'il est périmé. Conséquence, constatée par lecture du
 * code : après un appairage, un profil bureau conserve indéfiniment l'ANCIENNE
 * clé, et l'application la charge sans le savoir.
 *
 * D'où la règle de ce module : la bascule écrit TOUS les emplacements, la
 * racine EN PREMIER, et ne détruit rien tant qu'ils ne sont pas tous promus.
 *
 * ═══ LA SÉQUENCE, ET SON PIVOT ═══
 *
 *   S0  RETENIR l'ancienne clé en lecture seule                ★ voir plus bas
 *   S1  journal := SWITCHING, plannedAt := now, ÉCRIRE       (rien n'a bougé)
 *   S2  écrire le matériel entrant sous des noms `*.next`, PARTOUT
 *   S3  journal.switch.staged := true, ÉCRIRE        ★★★ PIVOT ★★★
 *   S4  promouvoir emplacement par emplacement, RACINE D'ABORD
 *   S4b ADOPTER la clé du compte EN MÉMOIRE                    ★ voir plus bas
 *   S5  supprimer la clé entrante et tout résidu `*.next`
 *   S6  journal := DONE
 *
 * Avant S3 : retour en arrière propre (rien n'a été promu, S4 est APRÈS S3).
 * Après S3 : marche avant idempotente (chaque emplacement est réécrit depuis le
 * MÊME matériel, donc un ensemble à moitié promu converge).
 *
 * ═══ S0 — POURQUOI L'ANCIENNE CLÉ EST RETENUE ═══
 *
 * La migration ne rescelle RIEN localement : après la bascule, tout le contenu
 * déjà présent sur l'appareil est encore scellé sous l'ANCIENNE clé. La
 * détruire détruirait le coffre. S0 la met à l'abri en LECTURE SEULE AVANT que
 * quoi que ce soit ne soit promu — et si S0 échoue (trousseau indisponible),
 * rien n'a bougé et la bascule n'a pas lieu. Voir `retiredKey.ts` pour ce que
 * cette conservation coûte.
 *
 * ═══ S4b — POURQUOI L'ADOPTION EN MÉMOIRE EST DANS LA MÊME TRANSACTION ═══
 *
 * La bascule ne touchait que les FICHIERS de clé. À la seconde où l'écran
 * annonçait le succès, la clé de session en mémoire était encore l'ANCIENNE :
 * toute écriture dans cette fenêtre scellait sous une clé absente du trousseau,
 * et les sondes voyaient un coffre incohérent. Promotion et adoption sont donc
 * un seul geste, ici, entre la dernière promotion et l'effacement du matériel
 * entrant.
 *
 * Aucun `electron` ici : le module prend des chemins et des tampons, pour que
 * les morts simulées se testent sur un vrai système de fichiers.
 */

import fs from 'fs/promises';
import path from 'path';
import { writeFileAtomic } from './atomicWrite';
import { assertTransition, decideSwitchResume } from './journalMachine';
import type { PublishJournal } from './types';

export const WRAPPED_FEK_FILE = 'wrapped_fek.json';
export const FEK_SAFE_FILE = '.fek_safe';
export const NEXT_SUFFIX = '.next';

export interface KeyLocation {
  dir: string;
  /** `root` ou `profile:<id>` — ce qui est consigné dans `switch.promoted`. */
  label: string;
}

export interface IncomingKeyMaterial {
  /** Contenu de `incoming_fek.json` : la clé emballée sous le mot de passe. */
  wrapped: Buffer;
  /**
   * Miroir `safeStorage` de la clé entrante. `null` quand le trousseau de l'OS
   * est indisponible : la promotion doit alors SUPPRIMER les `.fek_safe`
   * existants, sinon l'application continuerait de charger l'ANCIENNE clé
   * depuis un miroir périmé — exactement le piège décrit en tête de fichier.
   */
  sealed: Buffer | null;
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * S2 — dépose le matériel entrant sous des noms de PRÉPARATION.
 *
 * Aucun emplacement ACTIF n'est touché : à ce stade, arrêter la migration ne
 * coûte que la suppression de quelques fichiers `.next`.
 */
export async function stageNextKeys(
  locations: readonly KeyLocation[],
  material: IncomingKeyMaterial
): Promise<void> {
  for (const loc of locations) {
    await fs.mkdir(loc.dir, { recursive: true });
    // Atomique jusque sur les fichiers de PRÉPARATION : un `.next` tronqué par
    // une coupure serait promu tel quel par S4 (qui se contente de le renommer),
    // et un `wrapped_fek.json` tronqué est un coffre qu'aucun mot de passe
    // n'ouvre. Vérifier ici coûte une relecture de quelques centaines d'octets.
    await writeFileAtomic(path.join(loc.dir, WRAPPED_FEK_FILE + NEXT_SUFFIX), material.wrapped);
    if (material.sealed) {
      await writeFileAtomic(path.join(loc.dir, FEK_SAFE_FILE + NEXT_SUFFIX), material.sealed);
    }
  }
}

/**
 * Supprime tous les `*.next`.
 *
 * Appelé au retour en arrière ET au démarrage quand un `.next` traîne sans
 * journal, ou avec un journal qui ne dit pas `SWITCHING` : LE JOURNAL FAIT FOI,
 * JAMAIS LE SYSTÈME DE FICHIERS. Un fichier de préparation orphelin n'autorise
 * rien par lui-même.
 */
export async function discardNextKeys(locations: readonly KeyLocation[]): Promise<void> {
  for (const loc of locations) {
    await fs.unlink(path.join(loc.dir, WRAPPED_FEK_FILE + NEXT_SUFFIX)).catch(() => undefined);
    await fs.unlink(path.join(loc.dir, FEK_SAFE_FILE + NEXT_SUFFIX)).catch(() => undefined);
  }
}

/**
 * S4 — promeut un emplacement. Idempotent par construction : si le `.next` a
 * déjà été consommé, l'emplacement est considéré comme promu et on passe.
 */
async function promoteLocation(loc: KeyLocation, material: IncomingKeyMaterial): Promise<void> {
  const nextWrapped = path.join(loc.dir, WRAPPED_FEK_FILE + NEXT_SUFFIX);
  const nextSealed = path.join(loc.dir, FEK_SAFE_FILE + NEXT_SUFFIX);

  if (await exists(nextWrapped)) {
    await fs.rename(nextWrapped, path.join(loc.dir, WRAPPED_FEK_FILE));
  } else {
    // Reprise après une promotion partielle : on réécrit depuis le matériel,
    // qui est le MÊME à chaque passage. C'est ce qui rend S4 rejouable — et
    // l'écriture passe par un fichier d'attente vérifié puis renommé, jamais
    // par-dessus le fichier de clé en place.
    await fs.mkdir(loc.dir, { recursive: true });
    await writeFileAtomic(path.join(loc.dir, WRAPPED_FEK_FILE), material.wrapped);
  }

  if (material.sealed) {
    if (await exists(nextSealed)) {
      await fs.rename(nextSealed, path.join(loc.dir, FEK_SAFE_FILE));
    } else {
      await writeFileAtomic(path.join(loc.dir, FEK_SAFE_FILE), material.sealed);
    }
  } else {
    // Pas de miroir entrant : le miroir existant porte l'ANCIENNE clé et serait
    // lu en priorité. Le supprimer est la seule conduite sûre.
    await fs.unlink(path.join(loc.dir, FEK_SAFE_FILE)).catch(() => undefined);
  }
}

export interface SwitchParams {
  journal: PublishJournal;
  /** Emplacements de clé, RACINE EN PREMIER. */
  locations: readonly KeyLocation[];
  material: IncomingKeyMaterial;
  /** Persiste le journal (temp + rename + fsync). */
  persist(journal: PublishJournal): Promise<void>;
  /** Efface `incoming_fek.json` / `.incoming_fek_safe`. */
  clearIncoming(): Promise<void>;
  /**
   * S0 — met l'ANCIENNE clé à l'abri en LECTURE SEULE, avant toute promotion.
   *
   * OBLIGATOIRE, et non optionnelle : sous C1 rien n'a été rescellé localement,
   * donc après la bascule 100 % du contenu de l'appareil dépend encore de
   * l'ancienne clé. Une bascule qui ne la retiendrait pas rendrait le coffre
   * illisible. Doit LEVER plutôt que d'échouer en silence — l'appelant
   * n'a alors rien promu et l'appareil est exactement dans son état antérieur.
   * Doit être IDEMPOTENTE : la reprise d'une bascule la rejoue.
   */
  retainOldKey(): Promise<void>;
  /**
   * S4b — adopte la clé du compte EN MÉMOIRE, dans la même transaction que la
   * promotion des fichiers. Voir l'en-tête de fichier : sans elle, l'écran
   * annonce un succès pendant que le process écrit encore sous l'ancienne clé.
   */
  adoptInMemory(): Promise<void>;
  /**
   * Déplacements de répertoires de profil, quand un UUID neuf a dû être frappé
   * (répertoire + registre local des profils + profil actif — voir
   * `profileRelocation.ts`). Fait partie de la promotion et suit la même règle
   * d'idempotence.
   *
   * OBLIGATOIRE, et non optionnelle — à dessein. La version mobile déclarait ce
   * crochet optionnel et le contrôleur ne le fournissait pas : la bascule
   * changeait la clé mais pas l'identité du profil, et l'appareil concluait
   * « clé forkée » au premier cycle. Le type interdit désormais cet oubli ; un
   * appelant sans profil déplacé fournit un no-op EXPLICITE.
   */
  relocateProfiles(): Promise<void>;
}

/**
 * Exécute S1 → S6. N'est appelée qu'après `canSwitch` — les trois verrous de
 * [R1] sont vérifiés par l'orchestrateur, pas ici : ce module SAIT basculer,
 * il ne décide pas s'il faut le faire.
 */
export async function performSwitch(params: SwitchParams): Promise<PublishJournal> {
  const j = params.journal;

  // ── S0 ── AVANT TOUT : l'ancienne clé est mise à l'abri en lecture. Si ce
  // geste échoue, on lève ici — aucun `.next` n'a été écrit, aucun emplacement
  // promu, l'appareil est strictement dans son état antérieur.
  await params.retainOldKey();

  // ── S1 ──
  if (j.state !== 'SWITCHING') {
    assertTransition(j.state, 'SWITCHING');
    j.state = 'SWITCHING';
  }
  j.switch.plannedAt = j.switch.plannedAt ?? new Date().toISOString();
  j.switch.staged = false;
  j.switch.promoted = [];
  await params.persist(j);

  // ── S2 ── aucun emplacement actif n'est touché
  await stageNextKeys(params.locations, params.material);

  // ── S3 ── ★ PIVOT ★
  j.switch.staged = true;
  await params.persist(j);

  // ── S4 → S6 ──
  return finishSwitch(params);
}

/**
 * S4 → S6, rejouable de bout en bout. C'est aussi le chemin de reprise après
 * une mort de l'application survenue APRÈS le pivot.
 */
export async function finishSwitch(params: SwitchParams): Promise<PublishJournal> {
  const j = params.journal;
  const promoted = new Set(j.switch.promoted);

  // S0 rejoué — idempotent. La reprise après une mort de l'application entre
  // dans `finishSwitch` sans repasser par `performSwitch` ; sans ce rappel, une
  // bascule reprise pourrait promouvoir sans que l'ancienne clé soit retenue.
  await params.retainOldKey();

  // S4 — racine d'abord : si tout s'arrête ici, c'est la racine qui fera
  // autorité à la reprise, et elle portera déjà la bonne clé.
  for (const loc of params.locations) {
    await promoteLocation(loc, params.material);
    if (!promoted.has(loc.label)) {
      promoted.add(loc.label);
      j.switch.promoted = [...promoted];
      await params.persist(j);
    }
  }

  // Le déplacement d'identité (répertoires + registre) court APRÈS la dernière
  // promotion — ainsi la copie de clé par-profil déjà promue voyage avec son
  // répertoire — et AVANT S4b/S6 : s'il lève, la bascule ne conclut pas, le
  // journal reste `SWITCHING` (pivot posé) et la reprise rejoue tout ceci.
  await params.relocateProfiles();

  // S4b — l'adoption EN MÉMOIRE, dans la même transaction que la promotion.
  // Placée APRÈS la dernière promotion (la mémoire ne doit pas devancer le
  // disque) et AVANT le passage à DONE (l'écran ne doit jamais annoncer un
  // succès pendant que le process écrit encore sous l'ancienne clé).
  await params.adoptInMemory();

  // S5 — le matériel entrant n'est effacé qu'ICI, une fois TOUS les
  // emplacements promus. Effacer plus tôt laisserait une fenêtre sans aucune
  // clé valide. L'ANCIENNE clé, elle, n'est pas effacée du tout : elle a été
  // retenue en lecture seule en S0, et le contenu local en dépend encore.
  await params.clearIncoming();
  await discardNextKeys(params.locations);

  // S6
  j.state = 'DONE';
  j.doneAt = new Date().toISOString();
  j.lastError = null;
  await params.persist(j);
  return j;
}

export type SwitchResumeOutcome = 'rolled-back' | 'completed' | 'failed';

/**
 * Reprise en `SWITCHING`. La décision vient de `switch.staged` — et de rien
 * d'autre. Voir `decideSwitchResume` pour le raisonnement complet.
 */
export async function resumeSwitch(
  params: SwitchParams & {
    incomingKeyPresent: boolean;
    /** VRAI quand `{racine}/wrapped_fek.json` porte déjà le matériel entrant. */
    rootHoldsIncoming: boolean;
  }
): Promise<SwitchResumeOutcome> {
  const action = decideSwitchResume({
    staged: params.journal.switch.staged,
    incomingKeyPresent: params.incomingKeyPresent,
    rootHoldsIncoming: params.rootHoldsIncoming,
  });

  if (action === 'rollback') {
    await discardNextKeys(params.locations);
    params.journal.state = 'PUBLISHING';
    params.journal.switch.plannedAt = null;
    params.journal.switch.promoted = [];
    await params.persist(params.journal);
    return 'rolled-back';
  }

  if (action === 'fail') {
    // La clé entrante a disparu ET la racine porte encore l'ancienne : on ne
    // promeut RIEN. L'ancienne clé reste partout, le coffre fonctionne, et
    // l'utilisateur refera l'appairage. Un trousseau purgé par l'OS ne doit
    // pas coûter un coffre.
    await discardNextKeys(params.locations);
    params.journal.state = 'FAILED';
    params.journal.lastError = { code: 'internal', itemKey: null };
    await params.persist(params.journal);
    return 'failed';
  }

  // 'forward' et 'promote-from-root' partagent le même geste : réécrire chaque
  // emplacement depuis le matériel fourni. Dans le second cas, l'appelant a lu
  // ce matériel DEPUIS LA RACINE, qui fait alors autorité.
  await finishSwitch(params);
  return 'completed';
}
