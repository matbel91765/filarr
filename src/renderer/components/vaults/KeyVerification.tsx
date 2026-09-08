/**
 * KeyVerification — la cérémonie TOFU + key transparency, en UN seul endroit.
 *
 * Avant : InviteMemberModal et ShareItemToPersonModal portaient chacune leur
 * copie de la logique (fetch clé + journal, checkPeerKeyTransparency, jeton
 * anti-résultat périmé) et du cadre d'empreinte. Une divergence entre les deux
 * copies aurait été une faille silencieuse — c'est un invariant de sécurité,
 * il n'existe donc plus qu'une fois :
 *
 *   - `usePeerKeyVerification(userId)` : lance la vérification dès que la
 *     personne sélectionnée change, expose les portes (blocked / needsConfirm /
 *     canProceed) et `sealArgs`, la clé EXACTEMENT vérifiée à passer au
 *     scellement — jamais re-téléchargée ;
 *   - `<KeyVerificationPanel>` : le cadre « numéro de sécurité » (empreinte
 *     formatée, message tonal, case « vérifié hors bande » quand la clé a tourné).
 *
 * Les verdicts eux-mêmes sont calculés par keyVerificationModel.ts (pur, testé).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '../ui';
import { apiGetMemberPublicKey, apiGetKeyLog } from '../../../services/vault/vaultApi';
import {
  checkPeerKeyTransparency,
  acceptPeerKeyChange,
} from '../../../services/vault/keyTransparency';
import { formatFingerprint } from '../../utils/formatFingerprint';
import {
  IDLE_VERIFICATION,
  beginVerification,
  settleVerification,
  computeVerdict,
  statusMessage,
  type KeyVerificationState,
  type KeyVerificationVerdict,
} from './keyVerificationModel';

export interface PeerKeyVerification extends KeyVerificationState, KeyVerificationVerdict {
  setAcceptedChange: (accepted: boolean) => void;
  /**
   * À appeler JUSTE AVANT de sceller : si la clé avait tourné et que l'hôte a
   * coché « vérifié hors bande », l'empreinte acceptée devient la nouvelle
   * base TOFU. Sans effet sinon.
   */
  pinAcceptedChange: () => void;
}

interface HookOptions {
  /** Le destinataire n'a pas de paire de clés publiée (ou la lecture a échoué). */
  onLookupFailed?: () => void;
}

export function usePeerKeyVerification(
  userId: string | null,
  options: HookOptions = {}
): PeerKeyVerification {
  const [state, setState] = useState<KeyVerificationState>(IDLE_VERIFICATION);
  // Jeton de la vérification la plus récente : une vérification plus lente pour
  // une sélection PRÉCÉDENTE ne peut pas poser son résultat sur la nouvelle.
  const verifyTokenRef = useRef('');
  // Le rappel d'échec vit dans une ref pour ne pas relancer la vérification à
  // chaque rendu de l'appelant (les modales le recréent avec `t`).
  const onLookupFailedRef = useRef(options.onLookupFailed);
  onLookupFailedRef.current = options.onLookupFailed;

  const verify = useCallback(async (target: string) => {
    verifyTokenRef.current = target;
    setState(beginVerification());
    try {
      const served = await apiGetMemberPublicKey(target);
      const entries = await apiGetKeyLog(target);
      const st = await checkPeerKeyTransparency(
        target,
        { encPublicKey: served.encPublicKey, fingerprint: served.fingerprint },
        entries
      );
      const next = settleVerification(verifyTokenRef.current, target, {
        ok: true,
        served,
        status: st,
      });
      if (next) setState(next);
    } catch {
      const next = settleVerification(verifyTokenRef.current, target, { ok: false });
      if (!next) return;
      setState(next);
      onLookupFailedRef.current?.();
    }
  }, []);

  // Vérification automatique dès que la sélection devient une personne concrète ;
  // retour à l'état vierge (et invalidation de tout résultat en vol) quand elle
  // se vide — l'écran ne doit jamais garder la clé de quelqu'un qui n'est plus choisi.
  useEffect(() => {
    if (userId) {
      void verify(userId);
    } else {
      verifyTokenRef.current = '';
      setState(IDLE_VERIFICATION);
    }
  }, [userId, verify]);

  const setAcceptedChange = useCallback((accepted: boolean) => {
    setState((s) => ({ ...s, acceptedChange: accepted }));
  }, []);

  const verdict = computeVerdict(state, userId);

  const pinAcceptedChange = useCallback(() => {
    if (verdict.needsConfirm && state.acceptedChange && state.servedKey && userId) {
      acceptPeerKeyChange(userId, state.servedKey.fingerprint);
    }
  }, [verdict.needsConfirm, state.acceptedChange, state.servedKey, userId]);

  return { ...state, ...verdict, setAcceptedChange, pinAcceptedChange };
}

interface PanelProps {
  verification: PeerKeyVerification;
}

/** Le cadre « numéro de sécurité », identique dans toutes les cérémonies de partage. */
export const KeyVerificationPanel: React.FC<PanelProps> = ({ verification }) => {
  const { t } = useTranslation();
  const { verifying, status, servedKey, blocked, needsConfirm, acceptedChange, setAcceptedChange } =
    verification;
  const msg = statusMessage(status);
  const toneClass =
    msg?.tone === 'block'
      ? 'text-[var(--color-error-700,#b91c1c)] bg-[var(--color-error-50,#fef2f2)]'
      : msg?.tone === 'warn'
        ? 'text-[var(--color-warning-700,#b45309)] bg-[var(--color-warning-50,#fffbeb)]'
        : 'text-[var(--color-text-secondary)] bg-[var(--color-background-secondary)]';

  return (
    <div className="rounded-lg border border-[var(--color-border-light)] p-3">
      <p className="text-xs font-medium text-[var(--color-text-primary)] m-0">
        {t('teamVaults.fingerprint.title')}
      </p>
      <p className="text-xs text-[var(--color-text-tertiary)] mt-1 mb-2">
        {t('teamVaults.fingerprint.explain')}
      </p>

      {verifying ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">{t('common.loading')}</p>
      ) : servedKey && !blocked ? (
        <>
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary)] mb-1">
            {t('teamVaults.fingerprint.label')}
          </p>
          <code className="block text-xs font-mono break-all text-[var(--color-text-primary)] bg-[var(--color-background-secondary)] rounded px-2 py-1">
            {formatFingerprint(servedKey.fingerprint)}
          </code>
        </>
      ) : null}

      {msg && (
        <div
          role={msg.tone === 'block' ? 'alert' : undefined}
          className={`mt-2 text-xs rounded px-2 py-1.5 ${toneClass}`}
        >
          {t(msg.key)}
        </div>
      )}

      {needsConfirm && (
        <div className="mt-2">
          <Checkbox
            label={t('teamVaults.fingerprint.confirmChanged')}
            checked={acceptedChange}
            onChange={(e) => setAcceptedChange(e.target.checked)}
          />
        </div>
      )}
    </div>
  );
};
