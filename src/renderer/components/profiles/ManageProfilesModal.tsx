/**
 * ManageProfilesModal — Edit and delete profiles
 *
 * Lists all profiles with edit (name, color, PIN) and delete capabilities.
 * Delete requires typing the profile name for confirmation.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { avatarGradient } from '../../../utils/avatarGradient';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../../../store';
import {
  deleteProfile,
  updateProfile,
  fetchManifest,
  resetPin,
  verifyPin,
} from '../../../store/slices/profilesSlice';
import type { ProfileMetadata, UpdateProfileParams } from '../../../types/profiles';
import { cloudOnlyProfiles, megabytes } from './cloudOnlyProfiles';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal/Modal';

const AVATAR_COLORS = [
  '#4682B4',
  '#E74C3C',
  '#2ECC71',
  '#F39C12',
  '#9B59B6',
  '#1ABC9C',
  '#E67E22',
  '#3498DB',
  '#E91E63',
  '#00BCD4',
  '#8BC34A',
  '#FF5722',
];

interface ManageProfilesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Une ligne de `GET /sync/profiles`, telle que l'IPC la rend telle quelle. */
interface CloudProfileRow {
  profileId: string;
  manifestVersion?: number;
  storageUsed?: number;
  lastSyncAt?: string | null;
  /** Pierre tombale : le profil a été supprimé du nuage depuis un autre appareil. */
  deletedAt?: string | null;
}

/** Ce que le nuage sait d'un profil local — et « rien », qui est un état à part. */
type CloudState = 'unknown' | 'synced' | 'never' | 'deleted';

const ManageProfilesModal: React.FC<ManageProfilesModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const profiles = useSelector((state: RootState) => state.profiles.manifest?.profiles ?? []);
  const activeProfileId = useSelector((state: RootState) => state.profiles.activeProfileId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Two-step delete when the target profile has a PIN: first `pin`, then
  // `confirm`. Profiles without a PIN jump straight to `confirm` (name
  // typing). Prevents a drive-by delete of a PIN-protected profile by
  // someone who just has physical access to the ProfilePicker screen.
  const [deleteStep, setDeleteStep] = useState<'pin' | 'confirm'>('confirm');
  const [deletePinInput, setDeletePinInput] = useState('');
  const [deletePinError, setDeletePinError] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resetPinId, setResetPinId] = useState<string | null>(null);
  const [resetPinInput, setResetPinInput] = useState('');
  const [resetPinError, setResetPinError] = useState<string | null>(null);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  // Full reset state (for last profile — wipe everything + re-onboard)
  const [resetProfileId, setResetProfileId] = useState<string | null>(null);
  const [resetStep, setResetStep] = useState<'pin' | 'confirm'>('pin');
  const [resetPinCode, setResetPinCode] = useState('');
  const [resetConfirmName, setResetConfirmName] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetInProgress, setResetInProgress] = useState(false);
  const resetInputRef = useRef<HTMLInputElement>(null);

  /**
   * L'ÉTAT NUAGE DE CHAQUE PROFIL — lu une fois à l'ouverture, jamais deviné.
   *
   * `null` = on n'a pas la liste (hors ligne, non connecté, appel en échec).
   * C'est un état distinct de « liste vide » : ne pas les distinguer ferait
   * badger « jamais synchronisé » l'intégralité des profils de quelqu'un qui a
   * simplement coupé le réseau.
   */
  const [cloudRows, setCloudRows] = useState<CloudProfileRow[] | null>(null);
  // Profils « dans le nuage seulement » : suppression depuis cette fenêtre.
  const [cloudDeletingId, setCloudDeletingId] = useState<string | null>(null);
  const [cloudDeleteBusy, setCloudDeleteBusy] = useState(false);
  const [cloudDeleteError, setCloudDeleteError] = useState<string | null>(null);
  /** Incrémenté après une suppression : relit la liste du nuage. */
  const [cloudReload, setCloudReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (isOpen) {
      void (async () => {
        try {
          const res = await window.electron?.ipcRenderer?.invoke('sync:getCloudProfiles');
          if (!cancelled) {
            // « Appel échoué » n'est pas « aucun profil » : un réseau qui
            // cligne ne doit pas badger tous les profils « jamais synchronisé ».
            setCloudRows(
              res && !res.error && Array.isArray(res.profiles)
                ? (res.profiles as CloudProfileRow[])
                : null
            );
          }
        } catch {
          if (!cancelled) setCloudRows(null);
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, cloudReload]);

  const cloudById = useMemo(() => {
    const map = new Map<string, CloudProfileRow>();
    for (const row of cloudRows ?? []) map.set(row.profileId, row);
    return map;
  }, [cloudRows]);

  /**
   * PAS DE VERDICT SANS PREUVE. Une absence de la liste ne dit « jamais
   * synchronisé » que si l'on est sûr de PARLER AU BON COMPTE : soit la liste
   * rend au moins un profil (le jeton est donc valide), soit ce profil-ci porte
   * un compte lié. Sinon on ne dit rien — mieux vaut aucun badge qu'un badge
   * faux.
   *
   * Un profil purement local n'est pas « en retard » : il n'a jamais demandé le
   * nuage, et rien ne doit le lui reprocher.
   */
  const cloudState = useCallback(
    (profile: ProfileMetadata): CloudState => {
      if (!cloudRows) return 'unknown';
      const row = cloudById.get(profile.id);
      if (row?.deletedAt) return 'deleted';
      const trustworthy = cloudRows.length > 0 || !!profile.cloudAccount;
      if (!trustworthy) return 'unknown';
      if (!row || !row.manifestVersion) return 'never';
      return 'synced';
    },
    [cloudRows, cloudById]
  );

  // Focus the delete confirmation input when it appears
  useEffect(() => {
    if (deletingId && deleteInputRef.current) {
      setTimeout(() => deleteInputRef.current?.focus(), 50);
    }
  }, [deletingId]);

  // Focus the reset input when it appears
  useEffect(() => {
    if (resetProfileId && resetInputRef.current) {
      setTimeout(() => resetInputRef.current?.focus(), 50);
    }
  }, [resetProfileId, resetStep]);

  const startFullReset = useCallback((profile: ProfileMetadata) => {
    setResetProfileId(profile.id);
    setResetStep(profile.pinHash ? 'pin' : 'confirm');
    setResetPinCode('');
    setResetConfirmName('');
    setResetError(null);
    setEditingId(null);
    setDeletingId(null);
  }, []);

  const verifyResetPin = useCallback(async () => {
    if (!resetProfileId || !resetPinCode) return;
    try {
      await dispatch(verifyPin({ profileId: resetProfileId, pin: resetPinCode })).unwrap();
      setResetStep('confirm');
      setResetError(null);
      setResetPinCode('');
    } catch {
      setResetError(t('profiles.incorrectPin'));
      setResetPinCode('');
    }
  }, [resetProfileId, resetPinCode, dispatch, t]);

  const confirmFullReset = useCallback(async () => {
    if (!resetProfileId) return;
    const profile = profiles.find((p) => p.id === resetProfileId);
    if (!profile) return;

    // Verify name matches
    if (resetConfirmName.trim() !== profile.name) {
      setResetError(t('profiles.errorDeleteNameMismatch'));
      return;
    }

    setResetInProgress(true);
    setResetError(null);

    try {
      // Clear onboarding flag from disk (survives localStorage resets)
      await window.electron?.ipcRenderer?.invoke('flag:set', 'onboarding-complete', '');

      // Delete the profile via IPC (this also deletes the profile directory)
      await window.electron?.ipcRenderer?.invoke('profile:fullReset');

      // Wipe ALL localStorage — profile data, persist:root, prefixed keys, everything
      localStorage.clear();

      // Force reload the app to restart from scratch
      window.location.reload();
    } catch (err: any) {
      console.error('[ManageProfiles] Full reset failed:', err);
      setResetError(err?.message || t('profiles.errorDeleting'));
      setResetInProgress(false);
    }
  }, [resetProfileId, resetConfirmName, profiles, t]);

  const startEdit = useCallback((profile: ProfileMetadata) => {
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditColor(profile.avatarColor);
    setDeletingId(null);
    setError(null);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setError(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed.length > 50) {
      setError(t('profiles.errorNameRequired'));
      return;
    }

    try {
      const updates: UpdateProfileParams = { name: trimmed, avatarColor: editColor };
      await dispatch(updateProfile({ profileId: editingId, updates })).unwrap();
      await dispatch(fetchManifest());
      setEditingId(null);
      setError(null);
    } catch (err: any) {
      setError(err?.message || t('profiles.errorUpdating'));
    }
  }, [editingId, editName, editColor, dispatch, t]);

  const startDelete = useCallback((profile: ProfileMetadata) => {
    setDeletingId(profile.id);
    // Gate the delete behind the PIN if one exists — otherwise fall through
    // to the name-confirmation step which is already good enough for an
    // intentionally-unprotected profile.
    setDeleteStep(profile.pinHash ? 'pin' : 'confirm');
    setDeletePinInput('');
    setDeletePinError(null);
    setDeleteConfirmName('');
    setEditingId(null);
    setError(null);
  }, []);

  const verifyDeletePin = useCallback(async () => {
    if (!deletingId || !deletePinInput) return;
    try {
      await dispatch(verifyPin({ profileId: deletingId, pin: deletePinInput })).unwrap();
      setDeleteStep('confirm');
      setDeletePinInput('');
      setDeletePinError(null);
    } catch {
      setDeletePinError(t('profiles.incorrectPin', 'PIN incorrect'));
      setDeletePinInput('');
    }
  }, [deletingId, deletePinInput, dispatch, t]);

  const confirmDelete = useCallback(async () => {
    if (!deletingId) return;
    const profile = profiles.find((p) => p.id === deletingId);
    if (!profile) return;

    // Defense-in-depth: if the profile has a PIN, refuse to proceed past
    // `confirm` unless the PIN step has been cleared (step transition from
    // `pin` → `confirm` is only done by verifyDeletePin on success).
    if (profile.pinHash && deleteStep !== 'confirm') {
      setError(t('profiles.pinRequiredToDelete', 'PIN requis pour supprimer ce profil'));
      return;
    }

    if (deleteConfirmName.trim() !== profile.name) {
      setError(t('profiles.errorDeleteNameMismatch'));
      return;
    }

    try {
      const wasActive = deletingId === activeProfileId;
      await dispatch(deleteProfile(deletingId)).unwrap();
      await dispatch(fetchManifest());
      setDeletingId(null);
      setError(null);
      // If we deleted the active profile, close modal — ProfilePicker will show
      // because activeProfileId is now null in Redux
      if (wasActive) {
        onClose();
      }
    } catch (err: any) {
      setError(err?.message || t('profiles.errorDeleting'));
    }
  }, [deletingId, deleteStep, deleteConfirmName, profiles, activeProfileId, dispatch, t, onClose]);

  const startResetPin = useCallback((profileId: string) => {
    setResetPinId(profileId);
    setResetPinInput('');
    setResetPinError(null);
    setEditingId(null);
    setDeletingId(null);
  }, []);

  const cancelResetPin = useCallback(() => {
    setResetPinId(null);
    setResetPinInput('');
    setResetPinError(null);
  }, []);

  const confirmResetPin = useCallback(async () => {
    if (!resetPinId || !resetPinInput) return;
    try {
      await dispatch(verifyPin({ profileId: resetPinId, pin: resetPinInput })).unwrap();
      const resetProfile = profiles.find((p) => p.id === resetPinId);
      await dispatch(
        resetPin({ profileId: resetPinId, confirmName: resetProfile?.name || '' })
      ).unwrap();
      await dispatch(fetchManifest());
      setResetPinId(null);
      setResetPinInput('');
      setResetPinError(null);
    } catch (err: any) {
      setResetPinError(err?.error || t('profiles.incorrectPin', 'PIN incorrect'));
      setResetPinInput('');
    }
  }, [resetPinId, resetPinInput, dispatch, t]);

  /**
   * Ce que le nuage porte et que cet appareil n'a pas — un essai d'une ancienne
   * installation, un profil scellé sous une clé que le compte n'a plus. Rien
   * ne permettait de s'en séparer ; il encombrait pourtant chaque lancement.
   */
  const cloudOnly = useMemo(
    () =>
      cloudOnlyProfiles(
        cloudRows,
        profiles.map((p) => p.id)
      ),
    [cloudRows, profiles]
  );

  const confirmCloudDelete = useCallback(async () => {
    if (!cloudDeletingId) return;
    setCloudDeleteBusy(true);
    setCloudDeleteError(null);
    try {
      const ipc = window.electron?.ipcRenderer;
      const out = (await ipc?.invoke('sync:deleteCloudProfile', cloudDeletingId)) as
        | { success?: boolean; error?: string }
        | undefined;
      // Canal absent (`out` vide) = pas une réussite : on le dit.
      if (!out || out.success === false) {
        setCloudDeleteError(t('profiles.deleteFromCloudError', { error: out?.error ?? '?' }));
        return;
      }
      setCloudDeletingId(null);
      setCloudReload((n) => n + 1);
    } catch (err) {
      setCloudDeleteError(t('profiles.deleteFromCloudError', { error: (err as Error).message }));
    } finally {
      setCloudDeleteBusy(false);
    }
  }, [cloudDeletingId, t]);

  const deletingProfile = profiles.find((p) => p.id === deletingId);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader onClose={onClose}>{t('profiles.manageTitle')}</ModalHeader>

      <ModalBody>
        <div className="flex flex-col gap-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center gap-3 p-3 rounded-xl
                border border-[var(--color-border-light)]
                bg-[var(--color-surface)]"
            >
              {editingId === profile.id ? (
                /* Edit mode */
                <div className="flex-1 flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                      style={{ backgroundColor: editColor }}
                    >
                      <span className="text-white text-sm font-bold">
                        {editName.trim() ? editName.trim().charAt(0).toUpperCase() : '?'}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={50}
                      autoFocus
                      className="flex-1 px-3 py-1.5 rounded-lg text-sm
                        bg-[var(--color-background)]
                        border border-[var(--color-border)]
                        text-[var(--color-text-primary)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {AVATAR_COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setEditColor(color)}
                        className="w-7 h-7 rounded-full border-2 transition-all duration-150
                          hover:scale-110"
                        style={{
                          backgroundColor: color,
                          borderColor:
                            editColor === color ? 'var(--color-text-primary)' : 'transparent',
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1 rounded-lg text-xs font-medium
                        text-[var(--color-text-secondary)]
                        hover:bg-[var(--color-surface-hover)]"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1 rounded-lg text-xs font-medium text-white
                        bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]"
                    >
                      {t('common.save')}
                    </button>
                  </div>
                </div>
              ) : (
                /* View mode */
                <>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: avatarGradient(profile.avatarColor) }}
                  >
                    <span className="text-white text-sm font-bold">
                      {profile.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                      {profile.name}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)]">
                      {profile.isDefault && t('profiles.default')}
                      {profile.pinHash &&
                        (profile.isDefault ? ' · ' : '') + t('profiles.pinEnabled')}
                    </p>
                    {/*
                      Badge d'état nuage — discret, informatif, jamais alarmant :
                      il ne signale pas une panne mais une chose que la personne
                      seule peut faire (ouvrir le profil, ou trancher le sort
                      d'un profil supprimé ailleurs). Rien n'est supprimé ici
                      automatiquement.
                    */}
                    {cloudState(profile) === 'never' && (
                      <span
                        title={t('profiles.cloudNeverSyncedHint')}
                        className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] leading-tight
                          text-[var(--color-text-tertiary)]
                          border border-[var(--color-border-light)]"
                      >
                        {t('profiles.cloudNeverSynced')}
                      </span>
                    )}
                    {cloudState(profile) === 'deleted' && (
                      <span
                        title={t('profiles.cloudDeletedHint')}
                        className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] leading-tight
                          text-[var(--color-warning-700)]
                          border border-[var(--color-warning-200)]
                          bg-[var(--color-warning-50)]"
                      >
                        {t('profiles.cloudDeleted')}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {profile.pinHash && profile.allowPinReset && (
                      <button
                        onClick={() => startResetPin(profile.id)}
                        title={t('profiles.removePin')}
                        className="p-1.5 rounded-lg text-[var(--color-text-tertiary)]
                          hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]
                          transition-colors"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => startEdit(profile)}
                      title={t('common.edit')}
                      className="p-1.5 rounded-lg text-[var(--color-text-tertiary)]
                        hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-secondary)]
                        transition-colors"
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    {profiles.length > 1 ? (
                      <button
                        onClick={() => startDelete(profile)}
                        title={t('common.delete')}
                        className="p-1.5 rounded-lg text-[var(--color-text-tertiary)]
                          hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-500)]
                          transition-colors"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => startFullReset(profile)}
                        title={t('profiles.resetTitle', 'Reinitialiser')}
                        className="p-1.5 rounded-lg text-[var(--color-text-tertiary)]
                          hover:bg-[var(--color-error-50)] hover:text-[var(--color-error-500)]
                          transition-colors"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Profils présents dans le nuage seulement — suppression possible d'ici. */}
          {cloudOnly.length > 0 && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-tertiary)]">
                {t('profiles.cloudOnlyTitle')}
              </p>
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t('profiles.cloudOnlyHint')}
              </p>
              {cloudOnly.map((row) => (
                <div
                  key={row.profileId}
                  className="flex flex-col gap-2 p-3 rounded-xl
                    border border-[var(--color-border-light)]
                    bg-[var(--color-surface)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate font-mono">
                        {row.shortId}…
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)]">
                        {row.lastSyncAt
                          ? t('profiles.cloudOnlyLastSync', {
                              date: new Date(row.lastSyncAt).toLocaleDateString(),
                            })
                          : t('profiles.cloudOnlyNeverSynced')}
                        {' · '}
                        {t('profiles.cloudOnlySize', { mb: megabytes(row.storageUsed) })}
                      </p>
                    </div>
                    {cloudDeletingId !== row.profileId && (
                      <button
                        onClick={() => {
                          setCloudDeletingId(row.profileId);
                          setCloudDeleteError(null);
                        }}
                        className="px-3 py-1 rounded-lg text-xs font-medium
                          text-[var(--color-error-500)]
                          hover:bg-[var(--color-error-50)]
                          transition-colors"
                      >
                        {t('profiles.deleteFromCloud')}
                      </button>
                    )}
                  </div>
                  {cloudDeletingId === row.profileId && (
                    <div
                      className="p-3 rounded-lg border border-[var(--color-error-200)]
                        bg-[var(--color-error-50)]"
                    >
                      <p className="text-sm text-[var(--color-error-700)] mb-2">
                        {t('profiles.deleteFromCloudConfirm')}
                      </p>
                      {cloudDeleteError && (
                        <p className="text-xs text-[var(--color-error-500)] mb-2">
                          {cloudDeleteError}
                        </p>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setCloudDeletingId(null);
                            setCloudDeleteError(null);
                          }}
                          disabled={cloudDeleteBusy}
                          className="px-3 py-1 rounded-lg text-xs font-medium
                            text-[var(--color-text-secondary)]
                            hover:bg-white/50 disabled:opacity-50"
                        >
                          {t('common.cancel')}
                        </button>
                        <button
                          onClick={confirmCloudDelete}
                          disabled={cloudDeleteBusy}
                          className="px-3 py-1 rounded-lg text-xs font-medium text-white
                            bg-[var(--color-error-500)] hover:bg-[var(--color-error-600)]
                            disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('profiles.deleteFromCloud')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Delete confirmation — PIN gate first (if PIN set), then name. */}
          {deletingId && deletingProfile && (
            <div
              className="p-4 rounded-xl border border-[var(--color-error-200)]
              bg-[var(--color-error-50)]"
            >
              {deleteStep === 'pin' ? (
                <>
                  <p className="text-sm font-semibold text-[var(--color-error-700)] mb-1">
                    {t('profiles.deletePinTitle', 'Vérification du PIN')}
                  </p>
                  <p className="text-xs text-[var(--color-error-600)] mb-2">
                    {t(
                      'profiles.deletePinPrompt',
                      'Entrez le PIN de « {{name}} » pour confirmer la suppression.',
                      { name: deletingProfile.name }
                    )}
                  </p>
                  <input
                    ref={deleteInputRef}
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={deletePinInput}
                    onChange={(e) => {
                      setDeletePinInput(e.target.value.replace(/\D/g, ''));
                      if (deletePinError) setDeletePinError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && deletePinInput.length >= 4) verifyDeletePin();
                    }}
                    placeholder="PIN"
                    autoFocus
                    className="w-full px-3 py-1.5 rounded-lg text-sm mb-2 text-center tracking-[0.5em]
                      bg-white border border-[var(--color-error-300)]
                      text-[var(--color-text-primary)]
                      focus:outline-none focus:ring-2 focus:ring-[var(--color-error-300)]"
                  />
                  {deletePinError && (
                    <p className="text-xs text-[var(--color-error-500)] mb-2">{deletePinError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setDeletingId(null);
                        setError(null);
                      }}
                      className="px-3 py-1 rounded-lg text-xs font-medium
                        text-[var(--color-text-secondary)]
                        hover:bg-white/50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={verifyDeletePin}
                      disabled={deletePinInput.length < 4}
                      className="px-3 py-1 rounded-lg text-xs font-medium text-white
                        bg-[var(--color-error-500)] hover:bg-[var(--color-error-600)]
                        disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('common.next', 'Suivant')}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-[var(--color-error-700)] mb-2">
                    {t('profiles.deleteConfirmText', { name: deletingProfile.name })}
                  </p>
                  <input
                    ref={deleteInputRef}
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={deletingProfile.name}
                    className="w-full px-3 py-1.5 rounded-lg text-sm mb-2
                      bg-white border border-[var(--color-error-300)]
                      text-[var(--color-text-primary)]
                      focus:outline-none focus:ring-2 focus:ring-[var(--color-error-300)]"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setDeletingId(null);
                        setError(null);
                      }}
                      className="px-3 py-1 rounded-lg text-xs font-medium
                        text-[var(--color-text-secondary)]
                        hover:bg-white/50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      onClick={confirmDelete}
                      disabled={deleteConfirmName.trim() !== deletingProfile.name}
                      className="px-3 py-1 rounded-lg text-xs font-medium text-white
                        bg-[var(--color-error-500)] hover:bg-[var(--color-error-600)]
                        disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('profiles.deleteConfirmButton')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Full reset (last profile only) */}
          {resetProfileId &&
            (() => {
              const profile = profiles.find((p) => p.id === resetProfileId);
              if (!profile) return null;
              return (
                <div className="p-4 rounded-xl border border-[var(--color-error-200)] bg-[var(--color-error-50)]">
                  <p className="text-sm font-semibold text-[var(--color-error-700)] mb-1">
                    {t('profiles.resetTitle', 'Reinitialiser le profil')}
                  </p>
                  <p className="text-xs text-[var(--color-error-600)] mb-3">
                    {t(
                      'profiles.resetWarning',
                      "Cette action supprimera definitivement toutes vos donnees (fichiers, notes, dossiers, parametres). L'application redemarrera comme au premier lancement."
                    )}
                  </p>

                  {resetStep === 'pin' && (
                    <div>
                      <p className="text-xs text-[var(--color-text-secondary)] mb-1.5">
                        {t('profiles.resetPinPrompt', 'Entrez le PIN du profil pour continuer :')}
                      </p>
                      <input
                        ref={resetInputRef}
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={resetPinCode}
                        onChange={(e) => {
                          setResetPinCode(e.target.value.replace(/\D/g, ''));
                          setResetError(null);
                        }}
                        placeholder="PIN"
                        className="w-full px-3 py-1.5 rounded-lg text-sm mb-2
                        bg-white border border-[var(--color-error-300)]
                        text-[var(--color-text-primary)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-error-300)]"
                      />
                    </div>
                  )}

                  {resetStep === 'confirm' && (
                    <div>
                      <p className="text-xs text-[var(--color-text-secondary)] mb-1.5">
                        {t('profiles.resetConfirmText', { name: profile.name })}
                      </p>
                      <input
                        ref={resetInputRef}
                        type="text"
                        value={resetConfirmName}
                        onChange={(e) => {
                          setResetConfirmName(e.target.value);
                          setResetError(null);
                        }}
                        placeholder={profile.name}
                        className="w-full px-3 py-1.5 rounded-lg text-sm mb-2
                        bg-white border border-[var(--color-error-300)]
                        text-[var(--color-text-primary)]
                        focus:outline-none focus:ring-2 focus:ring-[var(--color-error-300)]"
                      />
                    </div>
                  )}

                  {resetError && (
                    <p className="text-xs text-[var(--color-error-500)] mb-2">{resetError}</p>
                  )}

                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        setResetProfileId(null);
                        setResetError(null);
                      }}
                      className="px-3 py-1 rounded-lg text-xs font-medium
                      text-[var(--color-text-secondary)] hover:bg-white/50"
                    >
                      {t('common.cancel')}
                    </button>
                    {resetStep === 'pin' ? (
                      <button
                        onClick={verifyResetPin}
                        disabled={resetPinCode.length < 4}
                        className="px-3 py-1 rounded-lg text-xs font-medium text-white
                        bg-[var(--color-error-500)] hover:bg-[var(--color-error-600)]
                        disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {t('common.next', 'Suivant')}
                      </button>
                    ) : (
                      <button
                        onClick={confirmFullReset}
                        disabled={resetInProgress || resetConfirmName.trim() !== profile.name}
                        className="px-3 py-1 rounded-lg text-xs font-medium text-white
                        bg-[var(--color-error-500)] hover:bg-[var(--color-error-600)]
                        disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resetInProgress
                          ? t('profiles.resetting', 'Reinitialisation...')
                          : t('profiles.resetConfirmButton', 'Reinitialiser definitivement')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

          {/* PIN verification for reset */}
          {resetPinId && (
            <div
              className="p-4 rounded-xl border border-[var(--color-warning-200)]
              bg-[var(--color-warning-50)]"
            >
              <p className="text-sm text-[var(--color-warning-700)] mb-2">
                {t('profiles.enterPinToRemove', 'Entrez le PIN actuel pour retirer la protection')}
              </p>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={resetPinInput}
                onChange={(e) => {
                  setResetPinInput(e.target.value.replace(/\D/g, ''));
                  if (resetPinError) setResetPinError(null);
                }}
                placeholder="PIN"
                autoFocus
                className="w-full px-3 py-1.5 rounded-lg text-sm mb-2 text-center tracking-[0.5em]
                  bg-white border border-[var(--color-warning-300)]
                  text-[var(--color-text-primary)]
                  focus:outline-none focus:ring-2 focus:ring-[var(--color-warning-300)]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && resetPinInput.length >= 4) confirmResetPin();
                }}
              />
              {resetPinError && (
                <p className="text-xs text-[var(--color-error-500)] mb-2">{resetPinError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={cancelResetPin}
                  className="px-3 py-1 rounded-lg text-xs font-medium
                    text-[var(--color-text-secondary)]
                    hover:bg-white/50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={confirmResetPin}
                  disabled={resetPinInput.length < 4}
                  className="px-3 py-1 rounded-lg text-xs font-medium text-white
                    bg-[var(--color-warning-500)] hover:bg-[var(--color-warning-600)]
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t('profiles.removePin')}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && <p className="text-sm text-[var(--color-error-500)] text-center">{error}</p>}
        </div>
      </ModalBody>

      <ModalFooter>
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg text-sm font-medium
            text-[var(--color-text-secondary)]
            hover:bg-[var(--color-surface-hover)]
            transition-colors"
        >
          {t('common.close')}
        </button>
      </ModalFooter>
    </Modal>
  );
};

export default ManageProfilesModal;
