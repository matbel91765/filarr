/**
 * VaultKeypairGate (E3-8) — ensures the E2 keypair is loaded in renderer memory
 * before any vault UI runs. EVERYTHING in a vault needs the private key: decrypting
 * vault names (loadVaults), creating (getOwnPublicKey), inviting (seal to peer),
 * joining (open the sealed K_vault), downloading items. The key is loaded eagerly at
 * a password unlock (initUserKeypair) — but a PIN / safeStorage-restore unlock leaves
 * it absent, which used to surface as "Unlock your account" only at create time.
 *
 * Design (E2-6): the team flow treats a usable keypair as a BLOCKING prerequisite —
 * if it isn't in memory we prompt for the account password once and run
 * ensureUserKeypair(password). A wrong password throws (the wrapped key fails to
 * open) and is surfaced; we never proceed with a bad key.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Button } from '../ui';
import { CredentialUsernameField } from '../ui/CredentialUsernameField';
import { Modal, ModalBody } from '../ui/Modal/Modal';
import { hasUserKeypair } from '../../../services/auth/userKeypair';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { ensureVaultsLoaded } from '../../../store/slices/vaultsSlice';

type GateStatus = 'checking' | 'ready' | 'needs-password';

/**
 * Rend `null` ; n'existe que pour dire « la porte s'est ouverte » à son parent.
 * Le rappel voyage par une ref : c'est le MONTAGE lui-même qui signifie
 * « prêt » (le gate ne monte ses enfants qu'une fois la clé en mémoire), et
 * un rappel qui changerait d'identité ne doit pas le redire.
 */
const KeypairReadyProbe: React.FC<{ onReady: () => void }> = ({ onReady }) => {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current();
  }, []);
  return null;
};

/**
 * LE GATE À LA DEMANDE — la même porte, mais en fenêtre.
 *
 * Lot A (C4/C5) : les coffres n'ont plus de section à part, donc plus d'écran
 * plein cadre où poser le gate en amont. Les gestes qui exigent la paire de
 * clés (créer un coffre depuis l'accueil, télécharger un élément « partagé
 * avec moi » après un déverrouillage par PIN) le demandent au moment du geste :
 *   · si la clé est DÉJÀ en mémoire, `onReady` part sans qu'aucune fenêtre ne
 *     s'ouvre — pas même un instant : un éclair de « Chargement… » dans une
 *     boîte vide serait pire que rien ;
 *   · sinon la fenêtre s'ouvre sur le formulaire de mot de passe existant
 *     (`VaultKeypairGate`, inchangé), et `onReady` part quand il aboutit.
 * `onClose` est le renoncement : la fenêtre se ferme, le geste n'a pas lieu.
 */
export const VaultKeypairGateModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onReady: () => void;
}> = ({ isOpen, onClose, onReady }) => {
  const { t } = useTranslation();
  const [needsGate, setNeedsGate] = useState(false);
  // Par ref : la décision « ouvrir ou non » ne se rejoue qu'à l'OUVERTURE, pas à
  // chaque nouvelle identité du rappel du parent.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!isOpen) {
      setNeedsGate(false);
      return;
    }
    if (hasUserKeypair()) {
      onReadyRef.current();
      return;
    }
    setNeedsGate(true);
  }, [isOpen]);

  if (!isOpen || !needsGate) return null;

  return (
    <Modal isOpen onClose={onClose} size="sm" closeLabel={t('common.close')}>
      <ModalBody>
        <VaultKeypairGate>
          <KeypairReadyProbe onReady={onReady} />
        </VaultKeypairGate>
      </ModalBody>
    </Modal>
  );
};

export const VaultKeypairGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GateStatus>('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: is the keypair already in memory (eager unlock)? If not, prompt.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ensureUserKeypair } = await import('../../../services/auth/userKeypairSync');
        const res = await ensureUserKeypair();
        if (!cancelled) setStatus(res.ok ? 'ready' : 'needs-password');
      } catch {
        if (!cancelled) setStatus('needs-password');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUnlock = useCallback(async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { ensureUserKeypair } = await import('../../../services/auth/userKeypairSync');
      const res = await ensureUserKeypair(password);
      if (!res.ok) {
        setError(t('teamVaults.unlock.wrongPassword'));
        return;
      }
      setPassword('');
      setStatus('ready'); // l’effet ci-dessous redemande le chargement, clé en main
    } catch {
      // unwrapPrivateKey threw → wrong password (or the stored key can't be opened).
      setError(t('teamVaults.unlock.wrongPassword'));
    } finally {
      setBusy(false);
    }
  }, [password, busy, t]);

  // LA PORTE S’OUVRE → LES COFFRES SE DÉVERROUILLENT. Le premier chargement de la
  // liste part au démarrage, sans la paire de clés ; `ensureVaultsLoaded` sait
  // qu’un tel chargement n’est pas définitif et repasse une fois la clé en
  // mémoire — no-op si le dernier chargement l’avait déjà. C’est ici, et non
  // dans chaque écran derrière le gate, que ce rappel a sa place : toutes les
  // surfaces qui exigent la clé passent par cette porte.
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    if (status === 'ready') void dispatch(ensureVaultsLoaded());
  }, [status, dispatch]);

  if (status === 'ready') return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-full p-8">
      {status === 'checking' ? (
        <p className="text-sm text-[var(--color-text-tertiary)]">{t('common.loading')}</p>
      ) : (
        <div className="w-full max-w-sm text-center flex flex-col items-center gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-12 h-12 text-[var(--color-text-tertiary)]"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
            />
          </svg>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)] m-0">
            {t('teamVaults.unlock.title')}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)] m-0">
            {t('teamVaults.unlock.desc')}
          </p>
          {/*
            LE CHAMP IDENTIFIANT, INVISIBLE MAIS PRÉSENT.
            Sans lui, le navigateur voyait un mot de passe SEUL, en déduisait un
            formulaire de connexion, et allait écrire l'identifiant enregistré
            dans la première chose qui y ressemblait sur la page — c'est-à-dire
            les barres de recherche. Voir l'en-tête de `CredentialUsernameField`.
          */}
          <CredentialUsernameField />
          <Input
            type="password"
            // `current-password` et non `off` : on ANNONCE ce qu'est ce champ.
            // Un mot de passe non déclaré est précisément ce qui envoie le
            // navigateur deviner, et deviner mal.
            autoComplete="current-password"
            name="password"
            label={t('teamVaults.unlock.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUnlock();
            }}
            error={error ?? undefined}
            fullWidth
            autoFocus
            disabled={busy}
          />
          <Button
            variant="primary"
            onClick={handleUnlock}
            loading={busy}
            disabled={!password}
            fullWidth
          >
            {busy ? t('teamVaults.unlock.unlocking') : t('teamVaults.unlock.submit')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default VaultKeypairGate;
