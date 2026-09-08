/**
 * LA CLÉ RETIRÉE — conservée après la bascule, en LECTURE SEULE.
 *
 * ═══ POURQUOI ELLE EXISTE ═══
 *
 * La migration ne rescelle RIEN localement (voir `itemTransfer.ts`, règle C1) :
 * chaque élément est lu avec la clé active, rechiffré EN MÉMOIRE pour l'envoi,
 * et le fichier au repos ne bouge pas d'un octet. Conséquence directe et
 * assumée : après la bascule, TOUT le contenu déjà présent sur cet appareil est
 * encore scellé sous l'ANCIENNE clé. Si la bascule détruisait cette clé, elle
 * détruirait le coffre — ce serait exactement le défaut que C1 répare, déplacé
 * d'un cran.
 *
 * L'ancienne clé est donc CONSERVÉE. Les octets déjà là continuent de s'ouvrir ;
 * les écritures NOUVELLES emploient la clé du compte. La lecture essaie la clé
 * active, puis retombe sur les clés retirées. C'est ce qui supprime la fenêtre
 * dangereuse au lieu de la gérer.
 *
 * ═══ CE QUE ÇA COÛTE, ÉCRIT PLUTÔT QUE CACHÉ ═══
 *
 * · L'appareil garde DEUX clés de coffre durablement. Quiconque obtient le
 *   trousseau de la session OS obtient les deux. C'est le prix de la sûreté :
 *   l'alternative est un coffre qui devient illisible à la bascule.
 * · Une tentative de déchiffrement supplémentaire sur le seul chemin d'échec
 *   (mauvaise clé ⇒ tag GCM invalide ⇒ candidate suivante). Coût nul sur le
 *   chemin nominal.
 * · Le retrait de l'ancienne clé est PRÉVU (`forgetRetiredKeys`) mais
 *   FACULTATIF et DIFFÉRÉ : il n'a de sens que le jour où plus aucun octet local
 *   n'en dépend, et il n'est surtout PAS sur le chemin de la migration. Rien
 *   dans ce module ne l'appelle.
 *
 * ═══ LES DEUX FICHIERS, ET LEUR RÔLE DISTINCT ═══
 *
 *   {racine}/.retired_fek_safe   ← miroir safeStorage des clés BRUTES.
 *                                  C'est le SEUL que le chemin de lecture
 *                                  utilise. Sans trousseau, pas de repli
 *                                  automatique — d'où le refus de basculer
 *                                  quand le trousseau est indisponible.
 *   {racine}/retired_fek.json    ← les anciens `wrapped_fek.json`, VERBATIM.
 *                                  Ils ne servent à aucun chemin automatique :
 *                                  ils existent pour qu'un humain muni du mot de
 *                                  passe local puisse encore récupérer le
 *                                  contenu si le trousseau de l'OS est perdu.
 *
 * AUCUN de ces deux noms n'est lu par `hybrid:loadFEK`, `loadFEKForPairing`,
 * `getFekRawForSync` ni `ensureFEKAvailable`. Ils ne peuvent donc jamais
 * devenir la clé d'ÉCRITURE par accident — c'est l'invariant central de ce
 * module, et il tient par le nommage, pas par une convention.
 *
 * RACINE UNIQUEMENT : `ensureFEKAvailable` recopie des clés entre profils quand
 * elles manquent ; une copie de clé retirée qui atterrirait dans un répertoire
 * de profil sous un nom actif serait exactement l'accident que tout ce parcours
 * existe pour empêcher.
 */

import fs from 'fs/promises';
import path from 'path';
import { app, safeStorage } from 'electron';
import { writeFileAtomic } from './atomicWrite';

export const RETIRED_SEALED_FILE = '.retired_fek_safe';
export const RETIRED_WRAPPED_FILE = 'retired_fek.json';

/** Borne de garde-fou : au-delà, c'est un bogue, pas un usage. */
const MAX_RETIRED_KEYS = 8;

function rootDir(): string {
  return path.join(app.getPath('userData'), 'FilarData');
}

export function retiredSealedPath(): string {
  return path.join(rootDir(), RETIRED_SEALED_FILE);
}

export function retiredWrappedPath(): string {
  return path.join(rootDir(), RETIRED_WRAPPED_FILE);
}

/**
 * Le trousseau de l'OS est-il disponible ?
 *
 * La bascule en DÉPEND : sans lui, la clé retirée ne peut pas être relue
 * automatiquement, donc le contenu local deviendrait inaccessible à l'instant
 * de la bascule. On refuse alors de basculer plutôt que de « gérer » cette
 * fenêtre — voir `commitKeySwitch`.
 */
export function keychainAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

async function readSealedList(): Promise<string[]> {
  if (!keychainAvailable()) return [];
  const sealed = await fs.readFile(retiredSealedPath()).catch(() => null);
  if (!sealed) return [];
  try {
    const parsed: unknown = JSON.parse(safeStorage.decryptString(sealed));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    // Sceau illisible (autre session OS, trousseau réinitialisé) : traité comme
    // vide. On ne lève pas — lever ici empêcherait l'application de démarrer
    // pour un fichier de REPLI, ce qui serait pire que le repli manquant.
    return [];
  }
}

async function readWrappedList(): Promise<string[]> {
  const raw = await fs.readFile(retiredWrappedPath(), 'utf-8').catch(() => null);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

/**
 * Retient une clé qui cesse d'être active. IDEMPOTENT : la même clé retenue
 * deux fois n'ajoute rien (la reprise d'une bascule rejoue ce geste).
 *
 * Lève quand le trousseau est indisponible : consigner l'ancienne clé UNIQUEMENT
 * sous forme emballée reviendrait à promettre un repli automatique qui
 * n'existerait pas. Mieux vaut que la bascule échoue AVANT d'avoir rien promu.
 */
export async function retainRetiredKey(params: {
  raw: Buffer;
  /** Octets de l'ancien `wrapped_fek.json`, s'ils ont pu être lus. */
  wrapped: Buffer | null;
}): Promise<void> {
  if (!keychainAvailable()) {
    throw new Error(
      '[publish] Trousseau indisponible — impossible de conserver l ancienne clé en lecture'
    );
  }
  await fs.mkdir(rootDir(), { recursive: true });

  const base64 = params.raw.toString('base64');
  const existing = await readSealedList();
  if (!existing.includes(base64)) {
    const next = [...existing, base64].slice(-MAX_RETIRED_KEYS);
    await writeFileAtomic(
      retiredSealedPath(),
      safeStorage.encryptString(JSON.stringify(next))
    );
  }

  if (params.wrapped && params.wrapped.length > 0) {
    const wrappedText = params.wrapped.toString('utf-8');
    const wrappedList = await readWrappedList();
    if (!wrappedList.includes(wrappedText)) {
      const next = [...wrappedList, wrappedText].slice(-MAX_RETIRED_KEYS);
      await writeFileAtomic(
        retiredWrappedPath(),
        Buffer.from(JSON.stringify(next, null, 2), 'utf-8')
      );
    }
  }
}

/**
 * Les clés retirées, en octets bruts. Chargées à l'AMORÇAGE de l'application
 * (règle C7) et posées dans les candidates de LECTURE du coffre — jamais dans
 * celles d'écriture.
 */
export async function loadRetiredRawKeys(): Promise<Buffer[]> {
  const list = await readSealedList();
  return list.map((b64) => Buffer.from(b64, 'base64')).filter((b) => b.length > 0);
}

export async function hasRetiredKeys(): Promise<boolean> {
  return (await readSealedList()).length > 0;
}

/**
 * RETRAIT FACULTATIF ET DIFFÉRÉ de toutes les clés retirées.
 *
 * N'est appelé par AUCUN chemin de migration, et ce n'est pas un oubli : tant
 * qu'un seul octet local dépend d'une clé retirée, l'effacer détruit ce contenu.
 * La décision demande un constat (« plus aucun fichier ne s'ouvre avec elle »)
 * que la migration ne fait pas et n'a pas à faire. La fonction existe pour que
 * ce constat, le jour où il sera outillé, ait un geste à appeler.
 */
export async function forgetRetiredKeys(): Promise<void> {
  await fs.unlink(retiredSealedPath()).catch(() => undefined);
  await fs.unlink(retiredWrappedPath()).catch(() => undefined);
}
