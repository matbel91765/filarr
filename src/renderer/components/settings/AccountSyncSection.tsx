/**
 * AccountSyncSection — Settings section for cloud account & sync management
 *
 * MODE LOCAL:  "Activer la sync cloud" button → opens migration modal
 * MODE CLOUD:  Email, plan badge, sync status, devices, disable sync, delete account
 */

import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../../store';
import { hydrateAuthStatus, setCloudAuth, setSyncEnabled } from '../../../store/slices/authSlice';
import * as authApi from '../../../services/auth/authApi';
import { useSyncStatus } from '../../../hooks/useSyncStatus';
import { useNotification } from '../ui/Notification';
import { Button, Input } from '../ui';
import OrgSwitcher from './OrgSwitcher';
import CloudStorageTargetSection from './CloudStorageTargetSection';
import StorageCleanupRow from './StorageCleanupRow';
import RequestAccountResetModal from './RequestAccountResetModal';
import { selectIsEnterpriseSpace } from '../../../store/selectors/authSelectors';
import { InviteCodeEntry } from '../vaults/InviteCodeEntry';
import { useOrgCoverage } from '../../../hooks/useEffectiveTier';

// ── Types ───────────────────────────────────────────────────────────────────

interface AccountSyncSectionProps {
  onEnableSync: () => void;
  onDisableSync: () => void;
  onManageDevices: () => void;
  onDeleteAccount: () => void;
  onLogout: () => void;
}

// ── Plan Badge ──────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, { bg: string; text: string }> = {
  free: { bg: 'var(--color-neutral-100)', text: 'var(--color-neutral-600)' },
  solo: { bg: '#dbeafe', text: '#1d4ed8' },
  pro: { bg: '#ede9fe', text: '#7c3aed' },
  teams: { bg: '#dcfce7', text: '#15803d' },
  enterprise: { bg: '#fef3c7', text: '#b45309' },
};

const PLAN_LABELS: Record<string, string> = {
  free: 'Gratuit',
  solo: 'Solo',
  pro: 'Pro',
  teams: 'Teams',
  enterprise: 'Enterprise',
};

// ── Component ───────────────────────────────────────────────────────────────

const AccountSyncSection: React.FC<AccountSyncSectionProps> = ({
  onEnableSync,
  onDisableSync,
  onManageDevices,
  onDeleteAccount,
  onLogout,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { success: notifySuccess } = useNotification();
  // Lu ICI, avant tout retour anticipé (règle des hooks) : la section locale
  // rend plus haut sans passer par le bloc nuage.
  const coverage = useOrgCoverage();
  const { accountMode, cloudUser, syncEnabled, profileAttachedTo } = useSelector(
    (state: RootState) => state.auth
  );

  /**
   * CE PROFIL EST-IL RATTACHÉ AU COMPTE DE LA SESSION ?
   *
   * ⚠ Ce n'est PAS la même question que « suis-je connecté ». Sur le web, la
   * session revient toute seule : le cookie de rafraîchissement est posé pour
   * le domaine, donc arriver depuis filarr.com rouvre la session sur
   * app.filarr.com. Le PROFIL, lui, n'est rattaché que par une connexion
   * explicite — et c'est voulu : une session qui passe ne doit pas
   * s'approprier des données locales.
   *
   * Les deux se contredisaient à l'écran. Cette section affichait l'adresse du
   * compte et « Synchronisation : activée » pendant que le moteur refusait
   * chaque cycle avec « ce profil n'est rattaché à aucun compte » — une notion
   * que l'écran n'avait jamais montrée, dans une bulle rouge qui ne disait pas
   * quoi faire.
   */
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachPassword, setAttachPassword] = useState('');
  const [attachNew, setAttachNew] = useState('');
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);

  /**
   * Le rattachement, avec la preuve.
   *
   * Le canal refuse un mot de passe qui n'ouvre pas la clé — et il refuse aussi
   * le mot de passe de CONTRAINTE : accepter celui-ci publierait la clé du
   * coffre leurre comme clé du compte, et la vraie deviendrait inaccessible.
   */
  const runAttach = useCallback(async () => {
    setAttachBusy(true);
    setAttachError(null);
    try {
      const res = (await window.electron?.ipcRenderer?.invoke(
        'profiles:attachToAccount',
        attachPassword,
        attachNew || undefined
      )) as { ok: boolean; code?: string } | undefined;
      if (res?.ok) {
        setAttachOpen(false);
        setAttachPassword('');
        setAttachNew('');
        // L'estampille vient de changer : on relit l'état plutôt que de le
        // deviner, sinon l'encart reste affiché sur un profil désormais
        // rattaché.
        const status = await window.electron?.ipcRenderer?.invoke('auth:getStatus');
        if (status) dispatch(hydrateAuthStatus(status));
      } else {
        setAttachError(t(`settings.accountSync.attachError.${res?.code ?? 'unknown'}`));
      }
    } catch {
      setAttachError(t('settings.accountSync.attachError.unknown'));
    } finally {
      setAttachBusy(false);
    }
  }, [attachPassword, attachNew, dispatch, t]);

  const detached = accountMode === 'cloud' && !!cloudUser && profileAttachedTo === null;
  const { storageUsed, storageLimit } = useSyncStatus();
  // Récupération assistée par l'administrateur (E4-5) — une affaire d'ENTREPRISE :
  // une org détient la clé de séquestre. Le déclencheur vivait au pied de la
  // page des coffres (TeamVaultsView, démontée en C6) ; un geste sur SON compte
  // appartient à l'onglet Compte. Caché dans un espace personnel, où il n'y a
  // aucun administrateur à qui le demander : pas de boîte sans issue.
  const isEnterpriseSpace = useSelector(selectIsEnterpriseSpace);
  const [showRequestReset, setShowRequestReset] = useState(false);

  // Listen for tier change after Stripe checkout
  useEffect(() => {
    const ipc = window.electron?.ipcRenderer;
    if (!ipc) return;

    const onTierChanged = (data: { tier: string; previousTier: string }) => {
      // Refresh user data in Redux
      ipc.invoke('auth:getMe').then((result: any) => {
        if (result.success && result.user) {
          dispatch(setCloudAuth(result.user));
        }
      });
      const tierLabel = data.tier === 'solo' ? 'Solo' : data.tier === 'pro' ? 'Pro' : data.tier;
      notifySuccess(
        t('settings.accountSync.tierChanged', {
          defaultValue: `Plan mis à jour : ${tierLabel} !`,
          tier: tierLabel,
        })
      );
    };

    ipc.on('billing-tier-changed', onTierChanged);
    return () => {
      ipc.removeListener('billing-tier-changed', onTierChanged);
    };
  }, [dispatch, notifySuccess, t]);

  // ── MODE LOCAL ──────────────────────────────────────────────────────────

  if (accountMode === 'local' || !cloudUser) {
    return (
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border-light)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('settings.accountSync.title', 'Compte & Synchronisation')}
              </h2>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {t(
                  'settings.accountSync.localDesc',
                  'Synchronisez vos fichiers entre appareils avec un chiffrement zero-knowledge.'
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                {t(
                  'settings.accountSync.localInfo',
                  'Vos données sont uniquement stockées sur cet appareil. Activez la sync cloud pour sauvegarder et synchroniser vos fichiers chiffrés entre vos appareils.'
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onEnableSync}
            className="mt-4 w-full px-4 py-2.5 text-sm font-medium rounded-lg text-white transition-colors flex items-center justify-center gap-2"
            style={{
              backgroundColor: 'var(--color-primary-600)',
              cursor: 'pointer',
            }}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
              />
            </svg>
            {t('settings.accountSync.enableButton', 'Activer la synchronisation cloud')}
          </button>
        </div>

        {/* ATTEIGNABLE SANS COMPTE, ET C'EST LE POINT. Le site vitrine donne
            l'instruction « Réglages → Compte & Synchronisation → J'ai une
            invitation » sans condition, et le destinataire nominal d'une
            PREMIÈRE invitation n'a précisément pas encore de compte : réservé à
            la branche connectée, le contrôle n'existait pas au moment où il
            sert. Coller ici ne fait qu'ARMER l'invitation ; le porteur est
            durable, et PendingInviteHost la reprend après la connexion. */}
        <div className="border-t border-[var(--color-border-light)]">
          <InviteCodeEntry />
        </div>
      </div>
    );
  }

  // ── MODE CLOUD ──────────────────────────────────────────────────────────

  const plan = cloudUser.subscriptionTier || 'free';
  const planColor = PLAN_COLORS[plan] || PLAN_COLORS.free;
  // Le badge dit le palier PERSONNEL — c'est lui que « Passer à un plan
  // supérieur » concerne. Quand une organisation porte le compte au-dessus,
  // on le DIT à côté, sinon un siège Teams lit « Gratuit » sur une jauge de
  // 150 Go et croit à une erreur.
  const covered = !!coverage?.coveredByOrg && coverage.effectiveTier !== plan;
  const coveredColor = covered ? PLAN_COLORS[coverage!.effectiveTier] || PLAN_COLORS.teams : null;

  return (
    <>
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--color-border-light)]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)]">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
                {t('settings.accountSync.title', 'Compte & Synchronisation')}
              </h2>
            </div>
            {/* Plan badge */}
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: planColor.bg, color: planColor.text }}
            >
              {PLAN_LABELS[plan] || plan}
            </span>
            {covered && coveredColor && (
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: coveredColor.bg, color: coveredColor.text }}
                title={t(
                  'settings.accountSync.coveredHint',
                  'Votre organisation vous donne les limites de cette offre. « Passer à un plan supérieur » ne concerne que votre compte personnel.'
                )}
              >
                {t('settings.accountSync.coveredByOrg', {
                  tier: PLAN_LABELS[coverage!.effectiveTier] || coverage!.effectiveTier,
                  defaultValue: 'Couvert par votre organisation · {{tier}}',
                })}
              </span>
            )}
          </div>
        </div>

        <div className="divide-y divide-[var(--color-border-light)]">
          {/* Email */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.accountSync.email', 'Adresse email')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{cloudUser.email}</p>
            </div>
          </div>

          {/* Organization switcher (E1-6) — renders only for users in an org */}
          <OrgSwitcher />

          {isEnterpriseSpace && (
            <div className="px-6 py-3 text-center">
              <button
                type="button"
                className="text-xs underline text-[var(--color-text-secondary)] bg-transparent border-none cursor-pointer hover:text-[var(--color-text-primary)]"
                onClick={() => setShowRequestReset(true)}
              >
                {t('org.escrow.requestReset.trigger')}
              </button>
            </div>
          )}

          {/* Une invitation reçue par e-mail n'atterrit nulle part sur le bureau :
              aucune URL n'y est captable. C'est ici — accessible en espace
              personnel, sur les deux plateformes — qu'on colle le lien reçu. */}
          <InviteCodeEntry />

          {/* Sync status */}
          <div className="px-6 py-4 flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('settings.accountSync.syncStatus', 'Statut de la synchronisation')}
            </p>
            <span
              className="text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5"
              style={{
                backgroundColor: syncEnabled && !detached ? '#d1fae5' : '#fef3c7',
                color: syncEnabled && !detached ? '#065f46' : '#92400e',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: syncEnabled && !detached ? '#10b981' : '#f59e0b' }}
              />
              {detached
                ? t('settings.accountSync.detachedBadge', 'Profil non rattaché')
                : syncEnabled
                  ? t('settings.accountSync.syncActive', 'Activée')
                  : t('settings.accountSync.syncPaused', 'En pause')}
            </span>
          </div>

          {/* L'AVEU, et le geste qui le repare.
              Un aveu sans geste n'est qu'un reproche : la seule chose qui
              rattache un profil est une connexion EXPLICITE, et personne ne
              peut le deviner depuis « ce profil n'est rattache a aucun
              compte ». */}
          {detached && (
            <div className="px-6 pb-4">
              <div
                className="rounded-lg px-4 py-3 text-sm"
                role="status"
                style={{
                  background: 'var(--color-background-tertiary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <p className="m-0 font-medium text-[var(--color-text-primary)]">
                  {t('settings.accountSync.detachedTitle')}
                </p>
                <p className="mt-1 mb-0 text-[var(--color-text-secondary)]">
                  {t('settings.accountSync.detachedBody', { email: cloudUser?.email ?? '' })}
                </p>

                {/* ── LE GESTE, ET SON AVERTISSEMENT ──
                    Rattacher fait ADOPTER au compte la clé de ce profil : le
                    mot de passe de coffre saisi ici deviendra celui qui
                    déverrouille le compte sur tous ses appareils. On le dit
                    AVANT le champ, pas après. */}
                {!attachOpen ? (
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold text-[var(--color-link)] hover:underline"
                    onClick={() => setAttachOpen(true)}
                  >
                    {t('settings.accountSync.attachAction')}
                  </button>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    <p className="m-0 text-[var(--color-text-secondary)]">
                      {t('settings.accountSync.attachWarning')}
                    </p>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      label={t('settings.accountSync.attachCurrent')}
                      value={attachPassword}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAttachPassword(e.target.value)
                      }
                      error={attachError ?? undefined}
                      fullWidth
                    />
                    <Input
                      type="password"
                      autoComplete="new-password"
                      label={t('settings.accountSync.attachNew')}
                      helperText={t('settings.accountSync.attachNewHelp')}
                      value={attachNew}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setAttachNew(e.target.value)
                      }
                      fullWidth
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" loading={attachBusy} onClick={runAttach}>
                        {t('settings.accountSync.attachConfirm')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAttachOpen(false)}>
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Storage quota */}
          {storageLimit > 0 &&
            (() => {
              const percent = Math.round((storageUsed / storageLimit) * 100);
              const barColor =
                percent > 90 ? '#ef4444' : percent > 80 ? '#f97316' : 'var(--color-primary-500)';
              const formatBytes = (bytes: number): string => {
                if (bytes < 1024) return `${bytes} B`;
                if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
              };
              return (
                <div className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-[var(--color-text-primary)]">
                      {t('settings.accountSync.storage', 'Stockage cloud')}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {formatBytes(storageUsed)} / {formatBytes(storageLimit)} ({percent}%)
                    </p>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--color-background-secondary)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  {/* Ce que le ramassage automatique ne visite jamais : un
                      fichier disparu du manifeste sans passer par la
                      suppression. Compte d'abord, ne supprime que sur
                      demande. */}
                  <StorageCleanupRow />
                  {percent > 90 && (
                    <p className="text-xs mt-1.5" style={{ color: '#ef4444' }}>
                      {t(
                        'settings.accountSync.quotaWarning',
                        'Quota presque atteint — pensez à upgrader.'
                      )}
                    </p>
                  )}
                </div>
              );
            })()}

          {/* Pas de `plan` : le droit BYOS vient du serveur (canConfigure),
              parce qu'un membre d'org Teams reste `free` côté personnel. */}
          <CloudStorageTargetSection />

          {/* Upgrade / Manage subscription */}
          <SubscriptionActions plan={plan} />

          {/* Manage devices */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.accountSync.devices', 'Appareils connectés')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {t('settings.accountSync.devicesDesc', 'Gérez les appareils liés à votre compte.')}
              </p>
            </div>
            <button
              onClick={onManageDevices}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              {t('settings.accountSync.manageDevices', 'Gérer')}
            </button>
          </div>

          {/* Disable / Resume sync — single row, contextual on syncEnabled */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {syncEnabled
                  ? t('settings.accountSync.disableTitle', 'Désactiver la synchronisation')
                  : t('settings.accountSync.resumeTitle', 'Reprendre la synchronisation')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {syncEnabled
                  ? t('settings.accountSync.disableDesc', 'Vos données locales seront conservées.')
                  : t(
                      'settings.accountSync.resumeDesc',
                      'Reprendre la synchronisation cloud avec votre compte.'
                    )}
              </p>
            </div>
            {syncEnabled ? (
              <button
                onClick={onDisableSync}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                style={{
                  border: '1px solid #fca5a5',
                  color: '#dc2626',
                  backgroundColor: 'transparent',
                  cursor: 'pointer',
                }}
              >
                {t('settings.accountSync.disableButton', 'Désactiver')}
              </button>
            ) : (
              <button
                onClick={async () => {
                  await authApi.setSyncEnabled(true);
                  dispatch(setSyncEnabled(true));
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-white transition-colors"
                style={{
                  backgroundColor: 'var(--color-primary-600)',
                  cursor: 'pointer',
                }}
              >
                {t('settings.accountSync.resumeButton', 'Reprendre')}
              </button>
            )}
          </div>

          {/* Logout — disconnect from this device without deleting the account */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('settings.accountSync.logoutTitle', 'Se déconnecter')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {t(
                  'settings.accountSync.logoutDesc',
                  'Déconnectez cet appareil de votre compte. Vos données locales sont conservées. Vous pourrez vous reconnecter (avec ce compte ou un autre) depuis Paramètres.'
                )}
              </p>
            </div>
            <button
              onClick={onLogout}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              {t('settings.accountSync.logoutButton', 'Se déconnecter')}
            </button>
          </div>

          {/* Delete account */}
          <div className="px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: '#dc2626' }}>
                {t('settings.accountSync.deleteTitle', 'Supprimer mon compte')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                {t(
                  'settings.accountSync.deleteDesc',
                  'Supprime votre compte et toutes les données cloud. Irréversible.'
                )}
              </p>
            </div>
            <button
              onClick={onDeleteAccount}
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
              style={{
                border: '1px solid #dc2626',
                color: '#fff',
                backgroundColor: '#dc2626',
                cursor: 'pointer',
              }}
            >
              {t('settings.accountSync.deleteButton', 'Supprimer')}
            </button>
          </div>
        </div>
      </div>
      <RequestAccountResetModal
        isOpen={showRequestReset}
        onClose={() => setShowRequestReset(false)}
      />
    </>
  );
};

// ── Subscription Actions ────────────────────────────────────────────────────

/**
 * Le parcours de paiement, et ce qu'il dit quand il échoue.
 *
 * Les deux gestes se contentaient d'un `console.error` : sur le web, où le canal
 * n'était servi par aucun handler, le bouton clignotait et rien ne se passait —
 * pas un mot, pour la seule action qui débloque les coffres partagés. Un échec est
 * désormais affiché, et le cas particulier du bloqueur de fenêtres surgissantes
 * (l'onglet n'a pas pu s'ouvrir, mais l'URL est valide) rend le lien plutôt qu'une
 * erreur : la session Stripe existe, il ne manque que le clic.
 */
const SubscriptionActions: React.FC<{ plan: string }> = ({ plan }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  const runBillingJourney = async (
    channel: 'billing:checkout' | 'billing:portal',
    key: string,
    arg?: string
  ) => {
    setLoading(key);
    setFailure(null);
    setBlockedUrl(null);
    try {
      const result = await window.electron.ipcRenderer.invoke(channel, arg);
      if (!result?.success) {
        setFailure(
          t(
            'settings.accountSync.billingFailed',
            "Impossible d'ouvrir la page de paiement. Réessayez dans un instant."
          )
        );
        return;
      }
      // Le handler web rend l'URL quand l'onglet a été bloqué (le bureau, lui,
      // ouvre le navigateur lui-même et ne renseigne pas ce champ).
      if (result.data && result.data.opened === false && result.data.url) {
        setBlockedUrl(result.data.url as string);
      }
    } catch {
      setFailure(
        t(
          'settings.accountSync.billingUnavailable',
          "Le paiement n'est pas disponible ici pour le moment."
        )
      );
    } finally {
      setLoading(null);
    }
  };

  const handleUpgrade = (targetPlan: 'solo' | 'pro') =>
    runBillingJourney('billing:checkout', targetPlan, targetPlan);

  const handleManageSubscription = () => runBillingJourney('billing:portal', 'portal');

  const billingFeedback =
    failure || blockedUrl ? (
      <div className="mt-3 text-xs" role="status">
        {failure && <p style={{ color: 'var(--color-error-600)' }}>{failure}</p>}
        {blockedUrl && (
          <p style={{ color: 'var(--color-text-secondary)' }}>
            {t(
              'settings.accountSync.billingPopupBlocked',
              "Votre navigateur a bloqué l'ouverture de l'onglet."
            )}{' '}
            <a
              href={blockedUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--color-primary-600)', textDecoration: 'underline' }}
            >
              {t('settings.accountSync.billingOpenManually', 'Ouvrir la page de paiement')}
            </a>
          </p>
        )}
      </div>
    ) : null;

  if (plan === 'free') {
    return (
      <div className="px-6 py-4">
        <p className="text-sm font-medium text-[var(--color-text-primary)] mb-3">
          {t('settings.accountSync.upgradePlan', 'Passer à un plan supérieur')}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleUpgrade('solo')}
            disabled={loading !== null}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg text-white transition-colors"
            style={{
              backgroundColor: loading === 'solo' ? '#93c5fd' : '#2563eb',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'solo'
              ? t('common.loading', 'Chargement...')
              : t('settings.accountSync.upgradeSolo', 'Solo — 4€/mois')}
          </button>
          <button
            onClick={() => handleUpgrade('pro')}
            disabled={loading !== null}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg text-white transition-colors"
            style={{
              backgroundColor: loading === 'pro' ? '#c4b5fd' : '#7c3aed',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'pro'
              ? t('common.loading', 'Chargement...')
              : t('settings.accountSync.upgradePro', 'Pro — 8€/mois')}
          </button>
        </div>
        {billingFeedback}
      </div>
    );
  }

  if (plan === 'solo') {
    return (
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.accountSync.subscription', 'Abonnement')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleUpgrade('pro')}
            disabled={loading !== null}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg text-white transition-colors"
            style={{
              backgroundColor: loading === 'pro' ? '#c4b5fd' : '#7c3aed',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'pro'
              ? t('common.loading', 'Chargement...')
              : t('settings.accountSync.upgradePro', 'Pro — 8€/mois')}
          </button>
          <button
            onClick={handleManageSubscription}
            disabled={loading !== null}
            className="flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors"
            style={{
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-primary)',
              backgroundColor: 'var(--color-surface)',
              cursor: loading !== null ? 'not-allowed' : 'pointer',
            }}
          >
            {loading === 'portal'
              ? t('common.loading', 'Chargement...')
              : t('settings.accountSync.manageSubscription', 'Gérer')}
          </button>
        </div>
        {billingFeedback}
      </div>
    );
  }

  // Pro plan — manage only
  return (
    <div className="px-6 py-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.accountSync.subscription', 'Abonnement')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t(
              'settings.accountSync.manageDesc',
              'Gérez votre abonnement, moyen de paiement ou annulez.'
            )}
          </p>
        </div>
        <button
          onClick={handleManageSubscription}
          disabled={loading !== null}
          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
          style={{
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            backgroundColor: 'var(--color-surface)',
            cursor: loading !== null ? 'not-allowed' : 'pointer',
          }}
        >
          {loading === 'portal'
            ? t('common.loading', 'Chargement...')
            : t('settings.accountSync.manageSubscription', 'Gérer')}
        </button>
      </div>
      {billingFeedback}
    </div>
  );
};

export default AccountSyncSection;
