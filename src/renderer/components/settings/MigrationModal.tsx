/**
 * MigrationModal — Local → Cloud migration flow
 *
 * 4-step wizard:
 *   1. CloudRegisterStep (inscription)
 *   2. CloudRecoveryStep (sauvegarde codes)
 *   3. CloudVerifyStep (vérification email)
 *   4. Vault migration (rewrap FEK or init)
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import Modal, { ModalBody } from '../ui/Modal/Modal';
import { CloudRegisterStep, CloudRecoveryStep, CloudVerifyStep } from '../auth/cloud';
import { restoreCloudProfiles } from '../../../services/core/cloudProfileRestore';
import { setCloudAuth, setSyncEnabled } from '../../../store/slices/authSlice';
import { rewrapFEK, hasHybridKey, initHybridCrypto } from '../../../services/auth/hybridCrypto';
import * as authApi from '../../../services/auth/authApi';
import type { AppDispatch } from '../../../store';
import type { UserDTO } from '../../../types/auth';

// ── Types ───────────────────────────────────────────────────────────────────

interface MigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type MigrationStep = 1 | 2 | 3 | 4;

const STEP_LABELS_FR = ['Inscription', 'Codes de récupération', 'Vérification', 'Migration'];
const STEP_LABELS_EN = ['Registration', 'Recovery codes', 'Verification', 'Migration'];

// ── Component ───────────────────────────────────────────────────────────────

const MigrationModal: React.FC<MigrationModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const language = (i18n.language?.startsWith('fr') ? 'fr' : 'en') as 'fr' | 'en';

  // Wizard state
  const [step, setStep] = useState<MigrationStep>(1);
  const [user, setUser] = useState<UserDTO | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [accountPassword, setAccountPassword] = useState<string | null>(null);
  const [email, setEmail] = useState('');

  // Step 4 state
  const [vaultNeedsOldPassword, setVaultNeedsOldPassword] = useState(false);
  const [oldVaultPassword, setOldVaultPassword] = useState('');
  const [migrating, setMigrating] = useState(false);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [migrationDone, setMigrationDone] = useState(false);

  const stepLabels = language === 'fr' ? STEP_LABELS_FR : STEP_LABELS_EN;

  // ── Reset on close ──────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    setStep(1);
    setUser(null);
    setRecoveryCodes(null);
    setAccountPassword(null);
    setEmail('');
    setVaultNeedsOldPassword(false);
    setOldVaultPassword('');
    setMigrating(false);
    setMigrationError(null);
    setMigrationDone(false);
    onClose();
  }, [onClose]);

  // ── Step 4: Vault migration logic ───────────────────────────────────────

  const handleVaultMigration = useCallback(
    async (password: string, oldPwd?: string, loginUser?: UserDTO) => {
      setMigrating(true);
      setMigrationError(null);

      try {
        const fekExists = hasHybridKey();

        if (fekExists && oldPwd) {
          // Case B: FEK exists with different password — rewrap
          await rewrapFEK(oldPwd, password);
        } else if (fekExists) {
          // Case A: try to init with account password (same password)
          try {
            await initHybridCrypto(password);
          } catch {
            // Decryption failed — need old vault password
            setMigrating(false);
            setVaultNeedsOldPassword(true);
            return;
          }
        } else {
          // Case C: no FEK — create new one
          await initHybridCrypto(password);
        }

        // Ensure auth state is set
        const effectiveUser = loginUser || user;
        if (effectiveUser) {
          if (!loginUser) {
            // Registration flow — need to login to store tokens
            const loginResult = await authApi.login(effectiveUser.email, password);
            if (loginResult.success && loginResult.user) {
              dispatch(setCloudAuth(loginResult.user));
              await authApi.setSyncEnabled(true);
              dispatch(setSyncEnabled(true));
            }
          } else {
            // Login flow — tokens already stored by authApi.login in CloudRegisterStep
            dispatch(setCloudAuth(effectiveUser));
            await authApi.setSyncEnabled(true);
            dispatch(setSyncEnabled(true));
          }

          /**
           * RAMENER LES PROFILS DU COMPTE — le geste qui manquait à CE chemin.
           *
           * C'est ici que passe une connexion depuis les Réglages, sur une
           * installation déjà en place : le parcours le plus courant, et le seul
           * qui n'avait AUCUN moyen de récupérer ses profils. La seule fonction
           * capable de le faire vivait dans le protocole d'appairage à six
           * chiffres, que ce chemin n'emprunte jamais. On se connectait donc à
           * un compte dont les profils existaient côté serveur, et rien
           * n'arrivait.
           *
           * APRÈS `initHybridCrypto`, jamais avant : les métadonnées d'un profil
           * (son nom, sa couleur) vivent dans un manifeste chiffré, et sans la
           * clé la restauration échouerait profil par profil pour ne rien
           * rendre. Best-effort — une restauration qui échoue ne doit pas faire
           * échouer une migration par ailleurs réussie.
           */
          await restoreCloudProfiles();
        }

        // Cleanup sensitive data
        setAccountPassword(null);
        setRecoveryCodes(null);
        setMigrationDone(true);
      } catch (error) {
        setMigrationError(error instanceof Error ? error.message : 'Migration failed');
      } finally {
        setMigrating(false);
      }
    },
    [user, dispatch]
  );

  // Auto-trigger vault migration when entering step 4
  const handleEnterStep4 = useCallback(() => {
    setStep(4);
    if (accountPassword) {
      handleVaultMigration(accountPassword);
    }
  }, [accountPassword, handleVaultMigration]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="lg">
      <ModalBody>
        {/* Stepper */}
        <div className="flex items-center gap-2 mb-6 px-1">
          {[1, 2, 3, 4].map((s) => (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                  style={{
                    backgroundColor:
                      s <= step ? 'var(--color-primary-600)' : 'var(--color-background-secondary)',
                    color: s <= step ? '#fff' : 'var(--color-text-tertiary)',
                  }}
                >
                  {s < step ? (
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4.5 12.75l6 6 9-13.5"
                      />
                    </svg>
                  ) : (
                    s
                  )}
                </div>
                <span
                  className="text-xs font-medium hidden sm:inline"
                  style={{
                    color: s <= step ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  }}
                >
                  {stepLabels[s - 1]}
                </span>
              </div>
              {s < 4 && (
                <div
                  className="flex-1 h-px"
                  style={{
                    backgroundColor: s < step ? 'var(--color-primary-400)' : 'var(--color-border)',
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Register or Login */}
        {step === 1 && (
          <CloudRegisterStep
            language={language}
            onSuccess={({ user: u, recoveryCodes: codes, password }) => {
              setUser(u);
              setRecoveryCodes(codes);
              setAccountPassword(password);
              setEmail(u.email);
              setStep(2);
            }}
            onLogin={({ user: u, password }) => {
              // Login skips recovery codes + email verification → go straight to vault migration
              setUser(u);
              setAccountPassword(password);
              setEmail(u.email);
              setStep(4);
              // Pass password + user directly — setState is async
              handleVaultMigration(password, undefined, u);
            }}
          />
        )}

        {/* Step 2: Recovery codes */}
        {step === 2 && recoveryCodes && (
          <div>
            <CloudRecoveryStep
              recoveryCodes={recoveryCodes}
              language={language}
              onAcknowledged={() => {}}
            />
            <button
              onClick={() => {
                setRecoveryCodes(null); // cleanup memory
                setStep(3);
              }}
              className="w-full mt-4 px-4 py-2.5 text-sm font-medium rounded-lg text-white"
              style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
            >
              {t('common.next', 'Suivant')}
            </button>
          </div>
        )}

        {/* Step 3: Email verification */}
        {step === 3 && (
          <CloudVerifyStep
            email={email}
            maskedEmail={email.split('@')[0]?.slice(0, 3) + '***@' + (email.split('@')[1] || '')}
            language={language}
            onVerified={handleEnterStep4}
          />
        )}

        {/* Step 4: Vault migration */}
        {step === 4 && (
          <div>
            {migrationDone ? (
              /* Success */
              <div className="text-center py-6">
                <div
                  className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: '#d1fae5' }}
                >
                  <svg
                    className="w-8 h-8"
                    style={{ color: '#059669' }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h2
                  className="text-xl font-bold mb-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('settings.migration.success', 'Synchronisation activée')}
                </h2>
                <p className="text-sm mb-6" style={{ color: 'var(--color-text-secondary)' }}>
                  {t(
                    'settings.migration.successDesc',
                    'Vos fichiers seront synchronisés entre vos appareils.'
                  )}
                </p>
                <button
                  onClick={() => {
                    handleClose();
                    onSuccess();
                  }}
                  className="px-6 py-2.5 text-sm font-medium rounded-lg text-white"
                  style={{ backgroundColor: 'var(--color-primary-600)', cursor: 'pointer' }}
                >
                  {t('settings.migration.finish', 'Terminer')}
                </button>
              </div>
            ) : vaultNeedsOldPassword ? (
              /* Need old vault password */
              <div>
                <h2
                  className="text-xl font-bold mb-2"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {t('settings.migration.vaultTitle', 'Migration de votre vault')}
                </h2>
                <div
                  className="flex items-start gap-2 p-3 rounded-lg mb-4 text-sm"
                  style={{
                    backgroundColor: '#fef3c7',
                    border: '1px solid #fcd34d',
                    color: '#92400e',
                  }}
                >
                  <span className="flex-shrink-0">&#8505;&#65039;</span>
                  <span>
                    {t(
                      'settings.migration.vaultInfo',
                      'Votre vault local utilise un mot de passe différent. Saisissez-le pour migrer vos données.'
                    )}
                  </span>
                </div>
                <div className="mb-4">
                  <label
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: 'var(--color-text-primary)' }}
                  >
                    {t('settings.migration.oldPasswordLabel', 'Mot de passe vault actuel')}
                  </label>
                  <input
                    type="password"
                    value={oldVaultPassword}
                    onChange={(e) => {
                      setOldVaultPassword(e.target.value);
                      setMigrationError(null);
                    }}
                    className="w-full px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2"
                    style={{
                      backgroundColor: 'var(--color-background-secondary)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                    }}
                  />
                </div>
                {migrationError && (
                  <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mb-4">
                    {migrationError}
                  </div>
                )}
                <button
                  onClick={() =>
                    accountPassword && handleVaultMigration(accountPassword, oldVaultPassword)
                  }
                  disabled={!oldVaultPassword || migrating}
                  className="w-full py-2.5 text-sm font-medium rounded-lg text-white flex items-center justify-center gap-2"
                  style={{
                    backgroundColor:
                      oldVaultPassword && !migrating
                        ? 'var(--color-primary-600)'
                        : 'var(--color-neutral-400)',
                    cursor: oldVaultPassword && !migrating ? 'pointer' : 'not-allowed',
                  }}
                >
                  {migrating && (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        opacity="0.25"
                      />
                      <path
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        opacity="0.75"
                      />
                    </svg>
                  )}
                  {migrating
                    ? t('settings.migration.migrating', 'Migration en cours...')
                    : t('settings.migration.migrateButton', 'Migrer')}
                </button>
              </div>
            ) : (
              /* Auto-migrating (spinner) */
              <div className="text-center py-8">
                <svg
                  className="animate-spin w-8 h-8 mx-auto mb-4"
                  style={{ color: 'var(--color-primary-600)' }}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    opacity="0.25"
                  />
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    opacity="0.75"
                  />
                </svg>
                <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  {t('settings.migration.migrating', 'Migration en cours...')}
                </p>
                {migrationError && (
                  <div className="p-3 rounded-lg bg-red-50 border-l-4 border-red-500 text-sm text-red-700 mt-4 text-left">
                    {migrationError}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
};

export default MigrationModal;
