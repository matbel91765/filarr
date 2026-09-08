/**
 * PairingJoinModal — rôle B du protocole d'appairage v2.
 *
 * B saisit les six chiffres affichés sur l'autre appareil, puis compare le
 * NOMBRE DE VÉRIFICATION avant que la clé du coffre ne soit réclamée. Tant que
 * l'utilisateur n'a pas confirmé, cet appareil ne sonde même pas la route qui
 * porte la clé emballée : ne pas déballer suffirait à la sécurité du coffre,
 * mais laisserait la clé emballée résider dans la mémoire de cet appareil
 * pendant que l'humain hésite encore.
 *
 * SUR LE BUREAU, LA JONCTION EST TOUJOURS EN MODE MANUEL : il n'y a pas de
 * caméra, donc pas de secret transporté par le QR. Le nombre de vérification y
 * est la SEULE protection contre un serveur qui s'interposerait — d'où
 * l'encadré d'avertissement que `PairingSasConfirm` affiche dans ce mode.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import PairingSasConfirm from './PairingSasConfirm';
import PublishVaultModal from './PublishVaultModal';
import { pairingFailureIsTerminal, pairingFailureMessage } from './pairingMessages';

type JoinState =
  | 'input'
  | 'connecting'
  // Attente humaine : le nombre est à l'écran, rien n'est réclamé tant que
  // l'utilisateur n'a pas tranché.
  | 'sas'
  | 'receiving'
  | 'syncing'
  | 'success'
  | 'error';

interface PairingJoinModalProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
}

const Spinner: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg
    className={`animate-spin ${className}`}
    style={{ color: 'var(--color-primary-600)' }}
    viewBox="0 0 24 24"
    fill="none"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
  </svg>
);

const PairingJoinModal: React.FC<PairingJoinModalProps> = ({ isOpen, onClose, profileId }) => {
  const { t } = useTranslation();
  const [state, setState] = useState<JoinState>('input');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [password, setPassword] = useState('');
  const [hasExistingKey, setHasExistingKey] = useState<boolean | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorReason, setErrorReason] = useState<string | undefined>(undefined);
  const [sasDisplay, setSasDisplay] = useState('');
  const [sasMode, setSasMode] = useState<'qr' | 'manual'>('manual');
  const [peerDeviceName, setPeerDeviceName] = useState('');
  const [sasBusy, setSasBusy] = useState(false);
  /**
   * Renseigné quand la garde d'adoption a bifurqué vers la publication. Ce
   * n'est PAS un échec : la clé du compte est arrivée, elle est vérifiée, et
   * elle est conservée en attente. C'est la porte de sortie que le refus n'avait
   * pas — et c'est le seul instant où elle existe, puisque l'appareil détient
   * alors les deux clés.
   */
  const [publishIntro, setPublishIntro] = useState<{
    itemCount: number;
    byteCount: number;
  } | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Check if Device B already has a FEK
  useEffect(() => {
    if (!isOpen) return;
    setHasExistingKey(null);
    window.electron.ipcRenderer
      .invoke('hybrid:hasKey')
      .then((has: boolean) => setHasExistingKey(has))
      .catch(() => setHasExistingKey(false));
  }, [isOpen]);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setState('input');
      setDigits(['', '', '', '', '', '']);
      setPassword('');
      setHasExistingKey(null);
      setConfirmOverwrite(false);
      setErrorMsg('');
      setErrorReason(undefined);
      setSasDisplay('');
      setPeerDeviceName('');
      setSasBusy(false);
      setPublishIntro(null);
    }
  }, [isOpen]);

  /**
   * Le process principal publie le nombre de vérification dès qu'il l'a
   * calculé — et pas avant. On n'affiche jamais de gabarit « ● ● ● ● ● ● » :
   * un espace réservé entraînerait l'utilisateur à confirmer avant d'avoir lu,
   * ce qui viderait la comparaison de son seul contenu.
   *
   * L'appel `pairing:join` reste en cours pendant tout ce temps : c'est lui
   * qui attend le verdict côté process principal, puis reprend.
   */
  useEffect(() => {
    if (!isOpen) return;
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const onSas = (data: {
      role: 'A' | 'B';
      sasDisplay: string;
      mode: 'qr' | 'manual';
      peerDeviceName: string;
    }) => {
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
  }, [isOpen]);

  // Auto-focus first input on open
  useEffect(() => {
    if (isOpen && state === 'input') {
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [isOpen, state]);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      // Only accept digits
      const digit = value.replace(/\D/g, '').slice(-1);
      const newDigits = [...digits];
      newDigits[index] = digit;
      setDigits(newDigits);

      // Auto-advance to next input
      if (digit && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits]
  );

  const handleKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        // Move back on backspace when current is empty
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
  const codeComplete = code.length === 6;
  const canSubmit =
    codeComplete && password.length > 0 && (hasExistingKey ? confirmOverwrite : true);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    // `connecting` couvre tout ce qui précède l'attente humaine : lecture de
    // la session, refus d'un pair trop ancien, publication de la clé publique,
    // vérification de l'engagement. L'appel ne rend la main qu'à la toute fin
    // — l'écran de comparaison, lui, arrive par l'événement `pairing-sas`.
    setState('connecting');
    try {
      // Le mot de passe est nécessaire dans TOUS les cas : il sert à ré-emballer
      // localement la clé reçue dans `.fek_safe`. Il n'est jamais transmis au
      // serveur ni mêlé au protocole d'appairage.
      const result = await window.electron.ipcRenderer.invoke(
        'pairing:join',
        code,
        profileId,
        password
      );

      if (result.success) {
        setState('success');
      } else if (result.reason === 'publish-required') {
        // Bifurcation, pas échec : on ouvre le parcours de publication.
        setPublishIntro(result.publish ?? { itemCount: 0, byteCount: 0 });
      } else {
        // Le motif prime sur le texte : un « erreur réseau » générique après
        // une divergence de nombres cacherait à l'utilisateur qu'on a peut-être
        // tenté de s'interposer entre ses deux appareils.
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
  }, [canSubmit, code, profileId, password, t]);

  /**
   * Verdict humain. Confirmer autorise le process principal à réclamer puis
   * déballer la clé ; refuser détruit la session et n'installe rien.
   */
  const handleSasConfirm = useCallback(async () => {
    setSasBusy(true);
    setState('receiving');
    await window.electron.ipcRenderer.invoke('pairing:confirmSas', code).catch(() => {});
  }, [code]);

  const handleSasReject = useCallback(async () => {
    setSasBusy(true);
    await window.electron.ipcRenderer.invoke('pairing:rejectSas', code).catch(() => {});
  }, [code]);

  /**
   * Pendant l'attente humaine, fermer vaut REFUS : on relaie le « non » au
   * process principal, qui détruit la session et n'installe rien. Il n'existe
   * pas de confirmation implicite, ni par le temps ni par un geste flou.
   * Pendant les phases réseau, la fermeture est simplement inopérante — couper
   * au milieu d'une installation de clé laisserait un coffre à moitié monté.
   */
  const handleModalClose = useCallback(() => {
    if (state === 'sas') {
      void handleSasReject();
      return;
    }
    if (state === 'input' || state === 'error' || state === 'success') onClose();
  }, [state, handleSasReject, onClose]);

  const handleRetry = useCallback(() => {
    setState('input');
    setDigits(['', '', '', '', '', '']);
    setPassword('');
    setConfirmOverwrite(false);
    setErrorMsg('');
    setErrorReason(undefined);
    // Une session détruite n'est jamais reprise : il faut un code NEUF, généré
    // par l'autre appareil. On repart donc de la saisie vide.
    setSasDisplay('');
    setPeerDeviceName('');
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  }, []);

  // La bifurcation prend toute la place : l'appairage est terminé (la clé est
  // arrivée et conservée), c'est la publication qui doit maintenant être menée.
  if (publishIntro) {
    return (
      <PublishVaultModal
        isOpen={isOpen}
        onClose={() => {
          setPublishIntro(null);
          onClose();
        }}
        intro={publishIntro}
      />
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleModalClose}
      title={t('pairing.join.title', 'Rejoindre un appareil')}
      size="sm"
    >
      <ModalBody>
        {/* INPUT */}
        {state === 'input' && (
          <div className="py-2">
            <p
              className="text-sm mb-5 text-center"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {t('pairing.join.description', 'Saisissez le code affiché sur votre autre appareil')}
            </p>

            {/* 6-digit code input */}
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

            {/*
              CE COFFRE PORTE DÉJÀ UNE CLÉ.

              L'ancien libellé annonçait un remplacement des données locales par
              celles du compte — ce qui n'a jamais été vrai : rien n'était
              remplacé, le contenu local devenait simplement ILLISIBLE. On dit
              donc ce qui se passe réellement, et surtout qu'une sortie existe :
              si l'appareil porte du contenu, la garde d'adoption bifurquera vers
              « Publier ce coffre sur le compte » au lieu de refuser.
            */}
            {hasExistingKey === true && (
              <div
                className="rounded-lg p-3 mb-4"
                style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b' }}
              >
                <p className="text-xs font-medium mb-2" style={{ color: '#92400e' }}>
                  {t(
                    'pairing.join.existingKeyNotice',
                    'Ce coffre possède déjà sa propre clé. Si cet appareil contient des fichiers, Filarr proposera de les publier sur votre compte avant de changer de clé — rien ne sera effacé.'
                  )}
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmOverwrite}
                    onChange={(e) => setConfirmOverwrite(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-xs" style={{ color: '#92400e' }}>
                    {t('pairing.join.confirmOverwrite', "J'ai compris, continuer")}
                  </span>
                </label>
              </div>
            )}

            {/* Password field — needed to wrap the FEK locally */}
            <div className="mb-2">
              <label
                className="block text-xs font-medium mb-1.5"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t('pairing.join.passwordLabel', 'Mot de passe de votre compte Filarr')}
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                {t(
                  'pairing.join.passwordHint',
                  'Le même mot de passe que celui utilisé sur votre autre appareil.'
                )}
              </p>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('pairing.join.passwordPlaceholder', 'Votre mot de passe')}
                className="w-full px-3 py-2 text-sm rounded-lg outline-none"
                style={{
                  backgroundColor: 'var(--color-background-secondary)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          </div>
        )}

        {/* CONNECTING */}
        {state === 'connecting' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('pairing.join.connecting', 'Connexion en cours...')}
            </p>
          </div>
        )}

        {/*
          ATTENTE HUMAINE. Aucune requête vers la clé emballée n'a été émise :
          elle ne partira qu'après le clic sur « identiques ».
        */}
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
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('pairing.join.receiving', 'Réception des clés chiffrées...')}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('pairing.join.doNotClose', 'Ne fermez pas cette fenêtre')}
            </p>
          </div>
        )}

        {/* SYNCING */}
        {state === 'syncing' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('pairing.join.syncing', 'Synchronisation initiale...')}
            </p>
          </div>
        )}

        {/* SUCCESS */}
        {state === 'success' && (
          <div className="text-center py-6">
            <div
              className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ backgroundColor: '#d1fae5' }}
            >
              <svg
                className="w-6 h-6"
                style={{ color: '#059669' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-2" style={{ color: 'var(--color-text-primary)' }}>
              {t('pairing.join.success', 'Jumelage réussi !')}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t(
                'pairing.join.successDesc',
                'Vos fichiers sont maintenant synchronisés sur cet appareil.'
              )}
            </p>
          </div>
        )}

        {/* ERROR */}
        {state === 'error' && (
          <div className="text-center py-6">
            <div
              className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ backgroundColor: '#fee2e2' }}
            >
              <svg
                className="w-6 h-6"
                style={{ color: '#dc2626' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm" style={{ color: '#dc2626' }}>
              {errorMsg}
            </p>
          </div>
        )}
      </ModalBody>

      <ModalFooter>
        <div className="flex justify-end gap-2">
          {state === 'input' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.cancel', 'Annuler')}
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm font-medium rounded-lg text-white"
                style={{
                  backgroundColor: canSubmit
                    ? 'var(--color-primary-600)'
                    : 'var(--color-primary-300)',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  opacity: canSubmit ? 1 : 0.6,
                }}
              >
                {t('pairing.join.confirm', 'Confirmer')}
              </button>
            </>
          )}
          {state === 'error' && (
            <>
              {/*
                Motif TERMINAL ⇒ pas de « Réessayer » : contre un pair en
                version ancienne, rejouer ne peut rien changer tant que l'autre
                appareil n'a pas été mis à jour ; après un engagement rompu ou
                un rôle déjà pris, le code est brûlé côté serveur. Et il n'y a
                nulle part de « continuer quand même » — un repli vers
                l'ancien protocole serait un repli vers « le serveur peut lire
                la clé de votre coffre ».
              */}
              {!pairingFailureIsTerminal(errorReason) && (
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 text-sm font-medium rounded-lg text-white"
                  style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
                >
                  {t('common.retry', 'Réessayer')}
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg"
                style={{
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                }}
              >
                {t('common.close', 'Fermer')}
              </button>
            </>
          )}
          {state === 'success' && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
            >
              {t('common.close', 'Fermer')}
            </button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default PairingJoinModal;
