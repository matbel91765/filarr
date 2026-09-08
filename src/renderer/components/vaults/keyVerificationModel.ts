/**
 * Modèle PUR de la cérémonie de vérification de clé (TOFU + key transparency).
 *
 * Extrait mot pour mot d'InviteMemberModal / ShareItemToPersonModal, où la
 * même machine d'états vivait en double. Ici : zéro React, zéro réseau — juste
 * le calcul des verdicts à partir de ce que le réseau a répondu, pour qu'un
 * test vitest (node, sans DOM) puisse défendre chaque porte de sécurité :
 *
 *   - `tampered_log` / `served_not_latest` BLOQUENT (substitution possible côté
 *     serveur) — aucune case à cocher ne lève ce blocage ;
 *   - `changed` exige l'acceptation explicite « vérifié hors bande », et cette
 *     acceptation vaut pour CETTE empreinte (confirmedFingerprint) ;
 *   - la clé vérifiée doit appartenir à la personne ACTUELLEMENT sélectionnée
 *     (keyMatchesSelection) — ferme la frame synchrone où la sélection a déjà
 *     bougé vers B alors que servedKey est encore celle de A ;
 *   - un résultat de vérification PÉRIMÉ (jeton d'une sélection antérieure)
 *     est ignoré, succès comme échec.
 *
 * Le scellement se fait ensuite à la clé EXACTEMENT vérifiée (`sealArgs.peerKey`),
 * jamais à une clé re-téléchargée : c'est ce qui ferme le TOCTOU entre la
 * vérification et l'enveloppe.
 */

import type { PeerKeyStatus } from '../../../services/vault/keyTransparency';
import type { MemberPublicKeyDTO } from '../../../services/vault/vaultApi';

/** Ce que l'écran garde entre deux vérifications. */
export interface KeyVerificationState {
  verifying: boolean;
  status: PeerKeyStatus | null;
  servedKey: MemberPublicKeyDTO | null;
  acceptedChange: boolean;
}

export const IDLE_VERIFICATION: KeyVerificationState = {
  verifying: false,
  status: null,
  servedKey: null,
  acceptedChange: false,
};

/** Départ d'une vérification : tout ce qui vient d'une sélection précédente est effacé. */
export function beginVerification(): KeyVerificationState {
  return { ...IDLE_VERIFICATION, verifying: true };
}

export type VerifyOutcome =
  | { ok: true; served: MemberPublicKeyDTO; status: PeerKeyStatus }
  | { ok: false };

/**
 * Applique le résultat d'une vérification lancée pour `forUserId`, SI c'est
 * encore la sélection courante (`latestToken`). Sinon `null` : le résultat est
 * périmé et ne doit toucher ni l'état ni l'écran — on afficherait/scellerait
 * la clé d'une personne sous le nom d'une autre.
 */
export function settleVerification(
  latestToken: string,
  forUserId: string,
  outcome: VerifyOutcome
): KeyVerificationState | null {
  if (latestToken !== forUserId) return null;
  if (!outcome.ok) return { ...IDLE_VERIFICATION };
  return {
    verifying: false,
    status: outcome.status,
    servedKey: outcome.served,
    acceptedChange: false,
  };
}

export function isBlockedStatus(status: PeerKeyStatus | null): boolean {
  return status === 'tampered_log' || status === 'served_not_latest';
}

export function needsConfirmStatus(status: PeerKeyStatus | null): boolean {
  return status === 'changed';
}

/** Ce que le scellement reçoit : la clé vérifiée, et l'empreinte acceptée si la clé avait tourné. */
export interface SealArgs {
  peerKey: MemberPublicKeyDTO;
  confirmedFingerprint?: string;
}

export interface KeyVerificationVerdict {
  blocked: boolean;
  needsConfirm: boolean;
  keyMatchesSelection: boolean;
  /** Toutes les portes de la cérémonie franchies (hors « envoi en cours », qui appartient à l'appelant). */
  canProceed: boolean;
  /** Non nul UNIQUEMENT quand canProceed. */
  sealArgs: SealArgs | null;
}

export function computeVerdict(
  state: KeyVerificationState,
  selectedUserId: string | null
): KeyVerificationVerdict {
  const blocked = isBlockedStatus(state.status);
  const needsConfirm = needsConfirmStatus(state.status);
  const keyMatchesSelection =
    !!selectedUserId && !!state.servedKey && state.servedKey.userId === selectedUserId;
  const canProceed =
    keyMatchesSelection && !blocked && (!needsConfirm || state.acceptedChange) && !state.verifying;
  const sealArgs: SealArgs | null =
    canProceed && state.servedKey
      ? {
          peerKey: state.servedKey,
          ...(needsConfirm && state.acceptedChange
            ? { confirmedFingerprint: state.servedKey.fingerprint }
            : {}),
        }
      : null;
  return { blocked, needsConfirm, keyMatchesSelection, canProceed, sealArgs };
}

export type KeyVerificationTone = 'info' | 'warn' | 'block';

/** Clé i18n (teamVaults.fingerprint.*) + ton du message d'état. */
export function statusMessage(
  status: PeerKeyStatus | null
): { key: string; tone: KeyVerificationTone } | null {
  switch (status) {
    case 'first_seen':
      return { key: 'teamVaults.fingerprint.firstSeen', tone: 'info' };
    case 'no_log':
      return { key: 'teamVaults.fingerprint.noLog', tone: 'info' };
    case 'changed':
      return { key: 'teamVaults.fingerprint.changed', tone: 'warn' };
    case 'served_not_latest':
    case 'tampered_log':
      return { key: 'teamVaults.fingerprint.blocked', tone: 'block' };
    default:
      return null;
  }
}
