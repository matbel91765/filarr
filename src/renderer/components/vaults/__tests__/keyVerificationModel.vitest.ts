/**
 * La machine d'états de la cérémonie de clé — pure, sans React ni réseau.
 *
 * Chaque test est une porte de sécurité : si l'un d'eux tombe, quelqu'un peut
 * sceller une clé de coffre vers une clé substituée. Les composants React
 * (hook + panneau) ne sont pas testables ici (vitest = node sans DOM) ; ils ne
 * font que brancher ce modèle sur le réseau et l'écran.
 */

import { describe, it, expect } from 'vitest';
import {
  IDLE_VERIFICATION,
  beginVerification,
  settleVerification,
  computeVerdict,
  statusMessage,
  type KeyVerificationState,
} from '../keyVerificationModel';
import type { MemberPublicKeyDTO } from '../../../../services/vault/vaultApi';
import type { PeerKeyStatus } from '../../../../services/vault/keyTransparency';

function key(userId = 'alice', fingerprint = 'abcd1234'): MemberPublicKeyDTO {
  return {
    userId,
    encPublicKey: 'enc-' + userId,
    signPublicKey: 'sig-' + userId,
    fingerprint,
    keyAlgo: 'x25519',
    keyVersion: 1,
  };
}

function settled(
  status: PeerKeyStatus,
  served = key(),
  acceptedChange = false
): KeyVerificationState {
  return { verifying: false, status, servedKey: served, acceptedChange };
}

describe('keyVerificationModel — verdicts', () => {
  it('first_seen : passe, scelle à la clé exacte, sans confirmedFingerprint', () => {
    const served = key();
    const v = computeVerdict(settled('first_seen', served), 'alice');
    expect(v.blocked).toBe(false);
    expect(v.needsConfirm).toBe(false);
    expect(v.keyMatchesSelection).toBe(true);
    expect(v.canProceed).toBe(true);
    expect(v.sealArgs).toEqual({ peerKey: served });
    // Identité stricte : on scelle à l’objet vérifié, pas à une copie.
    expect(v.sealArgs?.peerKey).toBe(served);
  });

  it('ok et no_log passent aussi sans confirmation', () => {
    expect(computeVerdict(settled('ok'), 'alice').canProceed).toBe(true);
    expect(computeVerdict(settled('no_log'), 'alice').canProceed).toBe(true);
  });

  it('changed sans acceptation : bloqué, aucun sealArgs', () => {
    const v = computeVerdict(settled('changed'), 'alice');
    expect(v.needsConfirm).toBe(true);
    expect(v.blocked).toBe(false);
    expect(v.canProceed).toBe(false);
    expect(v.sealArgs).toBeNull();
  });

  it('changed accepté : passe, et sealArgs porte l’empreinte confirmée', () => {
    const served = key('alice', 'ffff0000');
    const v = computeVerdict(settled('changed', served, true), 'alice');
    expect(v.canProceed).toBe(true);
    expect(v.sealArgs).toEqual({ peerKey: served, confirmedFingerprint: 'ffff0000' });
    // La clé scellée est l’objet vérifié lui-même — pas une copie re-téléchargée.
    expect(v.sealArgs?.peerKey).toBe(served);
  });

  it('tampered_log : bloqué, même avec la case cochée', () => {
    const v = computeVerdict(settled('tampered_log', key(), true), 'alice');
    expect(v.blocked).toBe(true);
    expect(v.needsConfirm).toBe(false);
    expect(v.canProceed).toBe(false);
    expect(v.sealArgs).toBeNull();
  });

  it('served_not_latest : bloqué, même avec la case cochée', () => {
    const v = computeVerdict(settled('served_not_latest', key(), true), 'alice');
    expect(v.blocked).toBe(true);
    expect(v.canProceed).toBe(false);
    expect(v.sealArgs).toBeNull();
  });

  it('keyMatchesSelection faux : la clé de A sous la sélection B ne scelle pas', () => {
    const v = computeVerdict(settled('ok', key('alice')), 'bob');
    expect(v.keyMatchesSelection).toBe(false);
    expect(v.canProceed).toBe(false);
    expect(v.sealArgs).toBeNull();
  });

  it('aucune sélection ou aucune clé servie : rien ne passe', () => {
    expect(computeVerdict(settled('ok'), null).canProceed).toBe(false);
    expect(computeVerdict({ ...settled('ok'), servedKey: null }, 'alice').canProceed).toBe(false);
    expect(computeVerdict(IDLE_VERIFICATION, 'alice').canProceed).toBe(false);
  });

  it('vérification en cours : bloqué tant que le verdict n’est pas tombé', () => {
    const v = computeVerdict({ ...settled('ok'), verifying: true }, 'alice');
    expect(v.canProceed).toBe(false);
    expect(v.sealArgs).toBeNull();
  });
});

describe('keyVerificationModel — résultat périmé (jeton)', () => {
  it('beginVerification efface tout ce qui venait de la sélection précédente', () => {
    const s = beginVerification();
    expect(s).toEqual({ verifying: true, status: null, servedKey: null, acceptedChange: false });
  });

  it('un succès pour l’ancienne sélection est ignoré', () => {
    const next = settleVerification('bob', 'alice', {
      ok: true,
      served: key('alice'),
      status: 'ok',
    });
    expect(next).toBeNull();
  });

  it('un échec pour l’ancienne sélection est ignoré aussi (pas de toast, pas de reset)', () => {
    expect(settleVerification('bob', 'alice', { ok: false })).toBeNull();
  });

  it('un jeton vidé (sélection effacée) invalide tout résultat en vol', () => {
    expect(settleVerification('', 'alice', { ok: true, served: key(), status: 'ok' })).toBeNull();
  });

  it('le succès pour la sélection courante s’applique, case décochée', () => {
    const served = key('alice');
    const next = settleVerification('alice', 'alice', { ok: true, served, status: 'changed' });
    expect(next).toEqual({
      verifying: false,
      status: 'changed',
      servedKey: served,
      acceptedChange: false,
    });
  });

  it('l’échec pour la sélection courante revient à l’état vierge (aucune clé → pas de scellement)', () => {
    const next = settleVerification('alice', 'alice', { ok: false });
    expect(next).toEqual(IDLE_VERIFICATION);
    expect(computeVerdict(next!, 'alice').canProceed).toBe(false);
  });
});

describe('keyVerificationModel — message d’état', () => {
  it('réutilise les clés i18n teamVaults.fingerprint.* avec le bon ton', () => {
    expect(statusMessage('first_seen')).toEqual({
      key: 'teamVaults.fingerprint.firstSeen',
      tone: 'info',
    });
    expect(statusMessage('no_log')).toEqual({ key: 'teamVaults.fingerprint.noLog', tone: 'info' });
    expect(statusMessage('changed')).toEqual({
      key: 'teamVaults.fingerprint.changed',
      tone: 'warn',
    });
    expect(statusMessage('tampered_log')).toEqual({
      key: 'teamVaults.fingerprint.blocked',
      tone: 'block',
    });
    expect(statusMessage('served_not_latest')).toEqual({
      key: 'teamVaults.fingerprint.blocked',
      tone: 'block',
    });
    expect(statusMessage('ok')).toBeNull();
    expect(statusMessage(null)).toBeNull();
  });
});
