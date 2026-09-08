/**
 * OnboardingPairingStep — jonction d'appairage pendant l'intégration.
 *
 * C'est le TROISIÈME endroit d'où le bureau peut jouer le rôle B, et il tombe
 * sous exactement la même règle que les deux autres : la clé du coffre n'est
 * réclamée qu'APRÈS que l'utilisateur a comparé le nombre de vérification avec
 * celui affiché sur l'autre appareil. Un écran d'intégration n'est pas une
 * excuse pour sauter l'étape — c'est même le moment où l'utilisateur est le
 * plus enclin à cliquer sans lire, donc celui où la mesure compte le plus.
 *
 * L'écran de comparaison est le composant PARTAGÉ `PairingSasConfirm` : les
 * deux appareils doivent rendre la même chaîne au caractère près, ce qu'une
 * seconde implémentation de l'affichage ne garantirait pas.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import PairingSasConfirm from '../settings/PairingSasConfirm';
import { pairingFailureIsTerminal, pairingFailureMessage } from '../settings/pairingMessages';

type PairingStepState = 'input' | 'connecting' | 'sas' | 'receiving' | 'success' | 'error';

interface OnboardingPairingStepProps {
  language: 'en' | 'fr';
  cloudPassword: string;
  onComplete: () => void;
}

const Spinner: React.FC = () => (
  <svg
    className="animate-spin w-6 h-6"
    style={{ color: 'var(--color-primary-600)' }}
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
  </svg>
);

const OnboardingPairingStep: React.FC<OnboardingPairingStepProps> = ({
  cloudPassword,
  onComplete,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<PairingStepState>('input');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorReason, setErrorReason] = useState<string | undefined>(undefined);
  const [sasDisplay, setSasDisplay] = useState('');
  const [sasMode, setSasMode] = useState<'qr' | 'manual'>('manual');
  const [peerDeviceName, setPeerDeviceName] = useState('');
  const [sasBusy, setSasBusy] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /**
   * Le nombre de vérification arrive par événement, une fois RÉELLEMENT
   * calculé par le process principal. Jamais de gabarit d'attente : un
   * « ● ● ● ● ● ● » entraînerait à confirmer avant d'avoir lu.
   */
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return undefined;

    const onSas = (data: { sasDisplay: string; mode: 'qr' | 'manual'; peerDeviceName: string }) => {
      setSasDisplay(data.sasDisplay);
      setSasMode(data.mode);
      setPeerDeviceName(data.peerDeviceName);
      setSasBusy(false);
      setState('sas');
    };

    ipc.on('pairing-sas', onSas);
    return () => {
      ipc.removeListener('pairing-sas', onSas);
    };
  }, []);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      const digit = value.replace(/\D/g, '').slice(-1);
      const newDigits = [...digits];
      newDigits[index] = digit;
      setDigits(newDigits);
      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        const newDigits = [...digits];
        newDigits[index - 1] = '';
        setDigits(newDigits);
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setDigits(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  }, []);

  const code = digits.join('');
  const canSubmit = code.length === 6;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setState('connecting');

    try {
      // profileId will be empty string — pairingService handles it
      const result = await window.electron.ipcRenderer.invoke(
        'pairing:join',
        code,
        '', // profileId — not yet created
        cloudPassword // vault password = cloud account password
      );

      if (result.success) {
        setState('success');
        // Auto-advance after a short delay
        setTimeout(onComplete, 1500);
      } else {
        // Le motif prime sur le texte : dire « erreur réseau » après une
        // divergence de nombres cacherait une tentative d'interposition.
        setErrorMsg(
          pairingFailureMessage(
            t,
            result.reason,
            result.error || t('pairing.join.networkError', 'Erreur réseau')
          )
        );
        setErrorReason(result.reason);
        setState('error');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState('error');
    }
  }, [canSubmit, code, cloudPassword, onComplete, t]);

  /** Verdict humain — le seul geste qui autorise la réception de la clé. */
  const handleSasConfirm = useCallback(async () => {
    setSasBusy(true);
    setState('receiving');
    await window.electron.ipcRenderer.invoke('pairing:confirmSas', code).catch(() => {});
  }, [code]);

  const handleSasReject = useCallback(async () => {
    setSasBusy(true);
    await window.electron.ipcRenderer.invoke('pairing:rejectSas', code).catch(() => {});
  }, [code]);

  const handleRetry = useCallback(() => {
    setState('input');
    setDigits(['', '', '', '', '', '']);
    setErrorMsg('');
    setErrorReason(undefined);
    // Une session détruite n'est jamais reprise : il faut un code NEUF, généré
    // par l'autre appareil.
    setSasDisplay('');
    setPeerDeviceName('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  return (
    <div>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>
        {t('onboarding.pairing.title', 'Jumelage avec votre appareil')}
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
        {t(
          'onboarding.pairing.description',
          'Saisissez le code affiché sur votre autre appareil pour transférer vos clés de chiffrement.'
        )}
      </p>

      {/* INPUT */}
      {state === 'input' && (
        <>
          <div className="flex justify-center gap-2 mb-5" onPaste={handlePaste}>
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputRefs.current[i] = el;
                }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-11 h-13 text-center text-xl font-bold rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: `2px solid ${digit ? 'var(--color-primary-600)' : 'var(--color-border)'}`,
                  color: 'var(--color-text-primary)',
                  fontFamily: 'monospace',
                }}
              />
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 text-sm font-medium rounded-lg text-white"
            style={{
              backgroundColor: canSubmit ? 'var(--color-primary-600)' : 'var(--color-neutral-400)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {t('pairing.join.confirm', 'Confirmer')}
          </button>
        </>
      )}

      {/* CONNECTING — tout ce qui précède l'attente humaine */}
      {state === 'connecting' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Spinner />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {t('pairing.join.connecting', 'Connexion en cours...')}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('pairing.join.doNotClose', 'Ne fermez pas cette fenêtre')}
          </p>
        </div>
      )}

      {/* ATTENTE HUMAINE — rien n'est réclamé tant que l'utilisateur n'a pas tranché */}
      {state === 'sas' && (
        <PairingSasConfirm
          sasDisplay={sasDisplay}
          mode={sasMode}
          peerDeviceName={peerDeviceName}
          busy={sasBusy}
          onConfirm={handleSasConfirm}
          onReject={handleSasReject}
        />
      )}

      {/* RECEIVING — après confirmation seulement */}
      {state === 'receiving' && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Spinner />
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {t('pairing.join.receiving', 'Réception des clés chiffrées...')}
          </p>
          <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('pairing.join.doNotClose', 'Ne fermez pas cette fenêtre')}
          </p>
        </div>
      )}

      {/* SUCCESS */}
      {state === 'success' && (
        <div className="text-center py-10">
          <div
            className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#d1fae5' }}
          >
            <svg
              className="w-7 h-7"
              style={{ color: '#059669' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {t('pairing.join.success', 'Jumelage réussi !')}
          </p>
        </div>
      )}

      {/* ERROR */}
      {state === 'error' && (
        <div className="text-center py-8">
          <div
            className="w-14 h-14 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: '#fee2e2' }}
          >
            <svg
              className="w-7 h-7"
              style={{ color: '#dc2626' }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-sm mb-4" style={{ color: '#dc2626' }}>
            {errorMsg}
          </p>
          {/*
            Motif TERMINAL ⇒ pas de « Réessayer ». Contre un pair en version
            ancienne la seule issue est la mise à jour de l'autre appareil ;
            après un engagement rompu, insister reviendrait à réessayer face à
            quelqu'un qui s'interpose.
          */}
          {!pairingFailureIsTerminal(errorReason) && (
            <button
              onClick={handleRetry}
              className="px-5 py-2 text-sm font-medium rounded-lg text-white"
              style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
            >
              {t('common.retry', 'Réessayer')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default OnboardingPairingStep;
