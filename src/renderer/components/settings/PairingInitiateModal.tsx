/**
 * PairingInitiateModal — rôle A du protocole d'appairage v2.
 *
 * A engendre le code, le secret du QR et la paire ECDH éphémère (tout cela
 * dans le process principal — rien de sensible n'est calculé ici), affiche le
 * QR et les six chiffres, puis attend B. Quand B se présente, A affiche le
 * NOMBRE DE VÉRIFICATION et n'emballe la clé du coffre qu'après confirmation
 * humaine explicite : c'est la règle dure du protocole, et cet écran en est le
 * point d'application côté A.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { isPairingQrV2 } from '../../../services/auth/pairingQr';
import PairingSasConfirm from './PairingSasConfirm';
import { pairingFailureIsTerminal, pairingFailureMessage } from './pairingMessages';

/**
 * Taille de rendu du QR, en pixels CSS. Assez grand pour qu'un téléphone
 * accroche à 20-30 cm d'un écran d'ordinateur, assez petit pour tenir dans
 * une modale `sm` sans forcer de défilement.
 */
const QR_SIZE = 200;

type PairingState =
  | 'idle'
  | 'generating'
  | 'waiting'
  | 'device_detected'
  // Attente humaine : les deux nombres sont à l'écran, rien ne bouge tant que
  // l'utilisateur n'a pas tranché. Aucun envoi de clé n'a encore eu lieu.
  | 'sas'
  | 'wrapping'
  | 'success'
  | 'error';

interface PairingInitiateModalProps {
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

const PairingInitiateModal: React.FC<PairingInitiateModalProps> = ({
  isOpen,
  onClose,
  profileId,
}) => {
  const { t } = useTranslation();
  const [state, setState] = useState<PairingState>('idle');
  const [code, setCode] = useState('');
  const [expiresAt, setExpiresAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [deviceName, setDeviceName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorReason, setErrorReason] = useState<string | undefined>(undefined);
  const [qrDataUrl, setQrDataUrl] = useState('');
  /**
   * La charge du QR, construite par le process principal. Elle contient le
   * secret de haute entropie qui ne transite JAMAIS par le serveur : on la
   * garde le temps de graver l'image, jamais au-delà, et on ne la journalise
   * ni ne la recopie nulle part.
   */
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [sasDisplay, setSasDisplay] = useState('');
  const [sasMode, setSasMode] = useState<'qr' | 'manual'>('manual');
  const [sasBusy, setSasBusy] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on close
  useEffect(() => {
    if (!isOpen) {
      setState('idle');
      setCode('');
      setExpiresAt(0);
      setRemaining(0);
      setDeviceName('');
      setErrorMsg('');
      setErrorReason(undefined);
      setSasDisplay('');
      setSasBusy(false);
      // Le secret n'a aucune raison de survivre à la fermeture de la modale.
      setQrPayload(null);
      // On efface le QR en même temps que le code : une image de QR laissée
      // en mémoire reste un code d'appairage lisible, et elle réapparaîtrait
      // au rendu suivant avant que la nouvelle soit générée.
      setQrDataUrl('');
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
  }, [isOpen]);

  // Countdown timer
  useEffect(() => {
    if (state !== 'waiting' || !expiresAt) return;

    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setState('error');
        setErrorMsg(pairingFailureMessage(t, 'expired', t('pairing.expired', 'Code expiré')));
        setErrorReason('expired');
        if (countdownRef.current) clearInterval(countdownRef.current);
      }
    };

    tick();
    countdownRef.current = setInterval(tick, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [state, expiresAt, t]);

  /**
   * Gravure du QR d'appairage.
   *
   * EN v2 LE QR N'EST PLUS UN SIMPLE RACCOURCI DE SAISIE. Il porte, en plus du
   * code, un secret de 32 octets qui ne transite par AUCUNE route serveur et
   * qui entre dans la dérivation de la clé d'emballage. C'est ce qui retire au
   * serveur le pouvoir de lire la clé du coffre : il peut substituer des clés
   * publiques, il ne sait pas dériver la clé d'emballage sans ce secret. Le
   * canal visuel est donc une VRAIE seconde voie — et c'est parce qu'il en est
   * une qu'on y met quelque chose.
   *
   * Le QR ne porte toujours ni la FEK, ni un jeton de session, ni un
   * identifiant de compte. Photographié seul, le secret ne déchiffre rien : il
   * n'est utile qu'associé à un ECDH vivant, dans une fenêtre de cinq minutes,
   * et le rôle B est à écriture unique côté serveur.
   *
   * CONTRASTE IMPOSÉ EN DUR. `color.dark`/`color.light` sont figés en noir et
   * blanc au lieu des jetons de thème : un appareil photo décode par seuillage
   * de luminance, un QR gris-sur-anthracite en thème sombre ne se lit tout
   * simplement pas. C'est une contrainte fonctionnelle, pas esthétique — d'où
   * aussi le fond blanc explicite du conteneur plus bas.
   *
   * ÉCHEC = REPLI SILENCIEUX. Si la génération échoue, on laisse `qrDataUrl`
   * vide : les chiffres restent affichés et l'appairage reste possible. Une
   * erreur bloquante ici priverait l'utilisateur d'un chemin qui fonctionne.
   */
  useEffect(() => {
    if (state !== 'waiting') return;

    // On ne grave que ce qui passe l'analyseur STRICT du format v2. Le
    // renderer ne fabrique pas cette chaîne — il la reçoit — mais il ne doit
    // pas la graver aveuglément : un secret mal encodé serait lu différemment
    // d'un décodeur à l'autre et produirait un échec MUET que personne ne
    // saurait diagnostiquer. Charge invalide ⇒ pas de QR, et les six chiffres
    // (mode manuel) restent un chemin complet.
    const payload = qrPayload;
    if (!payload || !isPairingQrV2(payload)) {
      setQrDataUrl('');
      return;
    }

    // La génération est asynchrone : si la modale se ferme ou le code change
    // entre-temps, on jette le résultat plutôt que d'afficher un QR périmé
    // qui ne correspond plus aux chiffres voisins.
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: QR_SIZE,
      // Zone de silence complète (4 modules) : la norme la juge nécessaire au
      // décodage, et la rogner est le premier motif de scans qui échouent.
      margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [state, qrPayload]);

  // Listen for IPC events from main process
  useEffect(() => {
    if (!isOpen) return;

    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const onDeviceDetected = (data: { deviceName: string }) => {
      setDeviceName(data.deviceName);
      setState('device_detected');
    };

    /**
     * Le process principal a dérivé le nombre de vérification et ATTEND. Rien
     * n'a encore été envoyé qui porte un secret : la clé du coffre n'est
     * emballée qu'après le verdict de l'utilisateur. On n'affiche l'écran
     * qu'une fois le nombre réellement reçu — jamais un gabarit d'attente,
     * qui entraînerait à confirmer avant d'avoir lu.
     */
    const onSas = (data: {
      role: 'A' | 'B';
      sasDisplay: string;
      mode: 'qr' | 'manual';
      peerDeviceName: string;
    }) => {
      setSasDisplay(data.sasDisplay);
      setSasMode(data.mode);
      setDeviceName(data.peerDeviceName);
      setSasBusy(false);
      setState('sas');
    };

    const onComplete = (data: { deviceName: string }) => {
      setDeviceName(data.deviceName);
      setState('success');
    };

    const onError = (data: { error: string; reason?: string }) => {
      setErrorMsg(pairingFailureMessage(t, data.reason, data.error));
      setErrorReason(data.reason);
      setState('error');
    };

    ipc.on('pairing-device-detected', onDeviceDetected);
    ipc.on('pairing-sas', onSas);
    ipc.on('pairing-complete', onComplete);
    ipc.on('pairing-error', onError);

    return () => {
      ipc.removeListener('pairing-device-detected', onDeviceDetected);
      ipc.removeListener('pairing-sas', onSas);
      ipc.removeListener('pairing-complete', onComplete);
      ipc.removeListener('pairing-error', onError);
    };
  }, [isOpen, t]);

  const handleGenerate = useCallback(async () => {
    setState('generating');
    try {
      const result = await window.electron.ipcRenderer.invoke('pairing:initiate', profileId);
      setCode(result.code);
      setExpiresAt(result.expiresAt);
      setQrPayload(result.qrPayload ?? null);
      setState('waiting');
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState('error');
    }
  }, [profileId]);

  /**
   * Verdict humain. C'est le SEUL geste qui autorise l'emballage de la clé du
   * coffre : tant qu'il n'a pas lieu, `wrapFEK` n'est pas appelé côté process
   * principal. On passe en `wrapping` immédiatement pour que le bouton ne
   * puisse pas être actionné deux fois.
   */
  const handleSasConfirm = useCallback(async () => {
    setSasBusy(true);
    setState('wrapping');
    await window.electron.ipcRenderer.invoke('pairing:confirmSas', code).catch(() => {});
  }, [code]);

  const handleSasReject = useCallback(async () => {
    setSasBusy(true);
    await window.electron.ipcRenderer.invoke('pairing:rejectSas', code).catch(() => {});
  }, [code]);

  const handleCancel = useCallback(async () => {
    if (code) {
      await window.electron.ipcRenderer.invoke('pairing:cancel', code).catch(() => {});
    }
    onClose();
  }, [code, onClose]);

  const handleRetry = useCallback(() => {
    setState('idle');
    setCode('');
    setErrorMsg('');
    setErrorReason(undefined);
    setSasDisplay('');
    // Une session détruite n'est JAMAIS reprise : le réessai repart d'un code
    // neuf, d'une paire de clés neuve et d'un SECRET NEUF. Réutiliser l'un des
    // trois serait un défaut de conformité — d'où le retour à `idle` plutôt
    // qu'une relance directe.
    setQrPayload(null);
    // Le QR de la tentative précédente encode un code désormais mort côté
    // worker : le laisser visible ferait scanner un code qui échoue.
    setQrDataUrl('');
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Fermer la modale pendant l'attente humaine vaut REFUS, pas « plus tard » :
  // `handleCancel` détruit la session côté worker et libère le point d'attente
  // sur un « non ». Il n'existe pas de confirmation implicite.
  const closesAsRefusal = state === 'waiting' || state === 'sas';

  return (
    <Modal
      isOpen={isOpen}
      onClose={closesAsRefusal ? handleCancel : onClose}
      title={t('pairing.initiate.title', 'Jumeler un nouvel appareil')}
      size="sm"
    >
      <ModalBody>
        {/* IDLE */}
        {state === 'idle' && (
          <div className="text-center py-4">
            <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
              {t(
                'pairing.initiate.description',
                'Affichez ce code sur cet appareil et saisissez-le sur le nouvel appareil pour partager vos clés de chiffrement.'
              )}
            </p>
            <button
              onClick={handleGenerate}
              className="px-4 py-2 text-sm font-medium rounded-lg text-white"
              style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
            >
              {t('pairing.initiate.generate', 'Générer un code de jumelage')}
            </button>
          </div>
        )}

        {/* GENERATING */}
        {state === 'generating' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {t('pairing.generating', 'Génération en cours...')}
            </p>
          </div>
        )}

        {/* WAITING */}
        {state === 'waiting' && (
          <div className="text-center py-4">
            {/*
              QR d'abord : c'est le chemin rapide et sans faute de frappe.
              Il n'apparaît que tant qu'il reste du temps — à l'expiration
              l'état passe à `error` et tout ce bloc disparaît, mais on garde
              la condition `remaining > 0` pour couvrir la seconde de battement
              entre le zéro affiché et le changement d'état.
            */}
            {qrDataUrl && remaining > 0 && (
              <div className="mb-4">
                <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'pairing.initiate.scanQr',
                    "Scannez ce code QR avec l'application mobile Filarr"
                  )}
                </p>
                {/*
                  Cadre blanc explicite, indépendant du thème : en thème sombre
                  la modale est anthracite, et un QR posé dessus perdrait sa
                  zone de silence — les caméras échoueraient. Le blanc est ici
                  fonctionnel, il ne suit donc PAS les jetons de couleur.
                */}
                <div
                  className="inline-flex items-center justify-center rounded-lg"
                  style={{ backgroundColor: '#ffffff', padding: 12 }}
                >
                  <img
                    src={qrDataUrl}
                    alt={t('pairing.initiate.qrAlt', 'Code QR de jumelage')}
                    width={QR_SIZE}
                    height={QR_SIZE}
                    style={{ display: 'block', width: QR_SIZE, height: QR_SIZE }}
                  />
                </div>
                {/*
                  Le code en chiffres RESTE, et reste annoncé : c'est le repli
                  quand la caméra est refusée, l'écran illisible, ou l'appareil
                  jumelé un autre ordinateur — qui ne scanne pas.
                */}
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-tertiary)' }}>
                  {t('pairing.initiate.orEnterCode', 'ou saisissez ce code manuellement')}
                </p>
              </div>
            )}
            <div
              className="flex justify-center gap-3 mb-4"
              style={{
                fontFamily: 'monospace',
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '0.2em',
              }}
            >
              {code.split('').map((digit, i) => (
                <span
                  key={i}
                  className="w-12 h-14 flex items-center justify-center rounded-lg"
                  style={{
                    backgroundColor: 'var(--color-background-secondary)',
                    border: '2px solid var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {digit}
                </span>
              ))}
            </div>
            <p
              className="text-sm mb-2 font-medium"
              style={{
                color: remaining <= 30 ? '#dc2626' : 'var(--color-text-secondary)',
              }}
            >
              {t('pairing.expiresIn', 'Expire dans')} {formatTime(remaining)}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('pairing.initiate.waiting', 'Saisissez ce code sur votre autre appareil')}
            </p>
          </div>
        )}

        {/* DEVICE DETECTED — B s'est présenté, on dérive le nombre de vérification */}
        {state === 'device_detected' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('pairing.deviceDetected', 'Appareil détecté :')} {deviceName}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('pairing.verifying', 'Calcul du nombre de vérification...')}
            </p>
          </div>
        )}

        {/*
          ATTENTE HUMAINE. Rien n'a encore été envoyé qui porte un secret : la
          clé du coffre n'est emballée qu'après le clic sur « identiques ».
          C'est le seul point du protocole où le logiciel s'arrête et demande.
        */}
        {state === 'sas' && (
          <PairingSasConfirm
            sasDisplay={sasDisplay}
            mode={sasMode}
            peerDeviceName={deviceName}
            busy={sasBusy}
            onConfirm={handleSasConfirm}
            onReject={handleSasReject}
          />
        )}

        {/* WRAPPING — après confirmation seulement */}
        {state === 'wrapping' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Spinner />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
              {t('pairing.deviceDetected', 'Appareil détecté :')} {deviceName}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {t('pairing.wrapping', 'Chiffrement et transfert des clés...')}
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
              {t('pairing.success', 'Jumelage réussi !')}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              {deviceName}{' '}
              {t('pairing.successDesc', 'peut maintenant accéder à vos données chiffrées.')}
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
          {state === 'waiting' && (
            <button
              onClick={handleCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                cursor: 'pointer',
              }}
            >
              {t('common.cancel', 'Annuler')}
            </button>
          )}
          {state === 'error' && (
            <>
              {/*
                Pas de « Réessayer » quand le motif est TERMINAL : contre un
                pair trop ancien, rejouer ne peut rien changer tant que l'autre
                appareil n'a pas été mis à jour, et le proposer laisserait
                croire à un aléa réseau. Il n'y a jamais, nulle part, de
                « continuer quand même » : un repli vers l'ancien protocole
                serait un repli vers « le serveur peut lire la clé du coffre ».
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

export default PairingInitiateModal;
