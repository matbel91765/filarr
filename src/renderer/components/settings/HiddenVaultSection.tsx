/**
 * Hidden Vault Settings Section (roadmap #6)
 *
 * Configures Veracrypt-style decoy mode: a second "duress" password that, when
 * entered on the lock screen, opens a separate bland decoy profile instead of
 * the real vault. Plan gating: Solo+.
 *
 * Honest-limitations note shown to the user: this is decoy-on-coercion
 * convenience, NOT cryptographic deniability — vault size and usage patterns
 * can still hint that a hidden vault exists.
 */

import { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button } from '../ui/Button/Button';
import { Input } from '../ui/Input/Input';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { selectCanUseHiddenVault } from '../../../store/selectors/authSelectors';
import {
  getDecoyVaultInfo,
  removeDecoyVault,
  setupDecoyVault,
  hasHybridKey,
} from '../../../services/auth/hybridCrypto';

const HiddenVaultSection: FC = () => {
  const { t } = useTranslation();
  const canUse = useSelector(selectCanUseHiddenVault);

  const [enabled, setEnabled] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [decoyName, setDecoyName] = useState('');
  const [duress, setDuress] = useState('');
  const [duressConfirm, setDuressConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await getDecoyVaultInfo();
      setEnabled(info.enabled);
    } catch {
      setEnabled(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const closeModal = () => {
    setModalOpen(false);
    setDecoyName('');
    setDuress('');
    setDuressConfirm('');
    setError(null);
  };

  const handleSetup = async () => {
    if (busy) return;
    setError(null);

    if (duress.length < 8) {
      setError(
        t(
          'settings.hiddenVault.duressTooShort',
          'Le mot de passe leurre doit faire au moins 8 caractères.'
        ) as string
      );
      return;
    }
    if (duress !== duressConfirm) {
      setError(
        t(
          'settings.hiddenVault.duressMismatch',
          'Les mots de passe ne correspondent pas.'
        ) as string
      );
      return;
    }
    if (!hasHybridKey()) {
      setError(
        t(
          'settings.hiddenVault.vaultLocked',
          'Déverrouillez le vault avant de configurer le vault caché.'
        ) as string
      );
      return;
    }

    setBusy(true);
    try {
      // 1. Create the decoy profile — it shows up in the picker as a perfectly
      //    normal profile, which is the point (no visible "hidden vault" menu).
      const profile = await window.electron.ipcRenderer.invoke('profile:create', {
        name: decoyName || t('settings.hiddenVault.defaultDecoyName', 'Perso'),
        avatarColor: '#64748b',
      });
      if (!profile?.id) throw new Error('Profile creation failed');

      // 2. Generate the decoy FEK, register the duress wrap on this profile,
      //    seed the decoy profile's own wrapped key. All inside hybridCrypto.
      await setupDecoyVault(duress, profile.id);

      await refresh();
      closeModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (
      !confirm(
        t(
          'settings.hiddenVault.confirmRemove',
          'Désactiver le vault caché ? Le profil leurre et ses fichiers ne seront pas supprimés.'
        ) as string
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await removeDecoyVault();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!canUse) {
    return (
      <div className="px-6 py-4 text-sm italic text-[var(--color-text-tertiary)]">
        {t('settings.hiddenVault.upgradeNote', 'Disponible à partir du plan Solo.')}
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border-light)]">
      {error && !modalOpen && (
        <div className="px-6 py-3 text-xs text-red-600 bg-red-50">{error}</div>
      )}

      <div className="px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-[var(--color-text-primary)]">
            {enabled
              ? t('settings.hiddenVault.enabled', 'Vault caché configuré sur cet appareil')
              : t('settings.hiddenVault.notEnabled', 'Aucun vault caché configuré')}
          </div>
          <div className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t(
              'settings.hiddenVault.explain',
              'Un second mot de passe ouvre un profil leurre à la place du vrai vault. Aucun menu visible : juste un mot de passe différent sur l’écran de verrouillage.'
            )}
          </div>
        </div>
        {enabled ? (
          <Button variant="danger" size="sm" onClick={handleRemove} disabled={busy}>
            {t('settings.hiddenVault.remove', 'Désactiver')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={() => setModalOpen(true)} disabled={busy}>
            {t('settings.hiddenVault.setup', 'Configurer')}
          </Button>
        )}
      </div>

      {/* Honest limitations — required by the roadmap spec, do not oversell */}
      <div className="px-6 py-3 text-xs text-[var(--color-text-tertiary)] bg-[var(--color-background-secondary)]">
        ⚠️{' '}
        {t(
          'settings.hiddenVault.limitations',
          'Limites honnêtes : le déni plausible est faible. La taille totale du vault et les habitudes d’usage peuvent suggérer l’existence d’un second vault. Protection de confort en cas de contrainte, pas une garantie cryptographique.'
        )}
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={t('settings.hiddenVault.modalTitle', 'Configurer le vault caché')}
        size="sm"
      >
        <ModalBody>
          <div className="flex flex-col gap-3">
            <Input
              label={t('settings.hiddenVault.decoyNameLabel', 'Nom du profil leurre') as string}
              value={decoyName}
              onChange={(e) => setDecoyName(e.target.value)}
              placeholder={t('settings.hiddenVault.defaultDecoyName', 'Perso') as string}
              helperText={
                t(
                  'settings.hiddenVault.decoyNameHint',
                  'Apparaîtra comme un profil normal dans le sélecteur.'
                ) as string
              }
              fullWidth
            />
            <Input
              label={t('settings.hiddenVault.duressLabel', 'Mot de passe leurre') as string}
              type="password"
              value={duress}
              onChange={(e) => setDuress(e.target.value)}
              helperText={
                t(
                  'settings.hiddenVault.duressHint',
                  'Différent de votre mot de passe vault. 8 caractères minimum.'
                ) as string
              }
              fullWidth
            />
            <Input
              label={
                t(
                  'settings.hiddenVault.duressConfirmLabel',
                  'Confirmer le mot de passe leurre'
                ) as string
              }
              type="password"
              value={duressConfirm}
              onChange={(e) => setDuressConfirm(e.target.value)}
              fullWidth
            />
            {error && (
              <div className="text-xs" style={{ color: '#f87171' }}>
                {error}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={closeModal} disabled={busy}>
            {t('common.cancel', 'Annuler')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSetup}
            disabled={busy || !duress || !duressConfirm}
          >
            {busy
              ? t('settings.hiddenVault.creating', 'Création…')
              : t('settings.hiddenVault.create', 'Créer le vault caché')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default HiddenVaultSection;
