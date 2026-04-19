/**
 * Profile Page
 *
 * Page de gestion du profil utilisateur (mode local uniquement).
 * Lit/écrit le profil actif via profilesSlice (IPC manifest).
 */

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector, useDispatch } from 'react-redux';
import ProfileAvatar from '../../profiles/ProfileAvatar';
import type { RootState, AppDispatch } from '../../../../store';
import { updateProfile, fetchManifest, verifyPin } from '../../../../store/slices/profilesSlice';

const AVATAR_COLORS = [
  // Blues
  '#4682B4',
  '#3498DB',
  '#2563EB',
  '#1D4ED8',
  '#0EA5E9',
  // Greens
  '#2ECC71',
  '#16A34A',
  '#059669',
  '#1ABC9C',
  '#10B981',
  // Reds / Pinks
  '#E74C3C',
  '#DC2626',
  '#E91E63',
  '#EC4899',
  '#F43F5E',
  // Oranges / Yellows
  '#F39C12',
  '#E67E22',
  '#FF5722',
  '#F59E0B',
  '#EAB308',
  // Purples
  '#9B59B6',
  '#8B5CF6',
  '#7C3AED',
  '#A855F7',
  '#6366F1',
  // Teals / Cyans
  '#00BCD4',
  '#06B6D4',
  '#14B8A6',
  '#0D9488',
  // Neutrals
  '#64748B',
  '#475569',
  '#78716C',
  '#6B7280',
];

export const Profile: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  // Read active profile from the profiles manifest (single source of truth)
  const manifest = useSelector((state: RootState) => state.profiles.manifest);
  const activeProfile = manifest?.profiles.find((p) => p.id === manifest.activeProfileId) ?? null;

  const [name, setName] = useState(activeProfile?.name || '');
  const [avatarColor, setAvatarColor] = useState(activeProfile?.avatarColor || AVATAR_COLORS[0]);
  const [avatarImage, setAvatarImage] = useState<string | undefined>(activeProfile?.avatarImage);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PIN state
  const [showPinSetup, setShowPinSetup] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [allowPinReset, setAllowPinReset] = useState(activeProfile?.allowPinReset ?? false);

  const hasPinConfigured = !!activeProfile?.pinHash;

  const handleAvatarImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate: image only, max 512KB source
    if (!file.type.startsWith('image/')) return;
    if (file.size > 512 * 1024) return;

    const reader = new FileReader();
    reader.onload = () => {
      // Resize to 128x128 to keep manifest small
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // Center crop
        const s = Math.min(img.width, img.height);
        const sx = (img.width - s) / 2;
        const sy = (img.height - s) / 2;
        ctx.drawImage(img, sx, sy, s, s, 0, 0, 128, 128);
        setAvatarImage(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  }, []);

  const handleRemoveAvatarImage = useCallback(() => {
    setAvatarImage(undefined);
  }, []);

  const handleSaveProfile = useCallback(async () => {
    if (!name.trim() || !activeProfile) return;
    setSaving(true);
    try {
      await dispatch(
        updateProfile({
          profileId: activeProfile.id,
          updates: {
            name: name.trim(),
            avatarColor,
            avatarImage:
              avatarImage === undefined
                ? activeProfile.avatarImage
                  ? null
                  : undefined
                : avatarImage,
          },
        })
      ).unwrap();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to update profile:', err);
    } finally {
      setSaving(false);
    }
  }, [name, avatarColor, avatarImage, activeProfile, dispatch]);

  const handleSetPin = useCallback(async () => {
    if (!activeProfile) return;
    setPinError('');
    setPinSuccess('');

    // Verify current PIN first if one is already set
    if (hasPinConfigured) {
      if (!currentPin) {
        setPinError(t('pin.currentRequired', 'Entrez votre PIN actuel'));
        return;
      }
      try {
        await dispatch(verifyPin({ profileId: activeProfile.id, pin: currentPin })).unwrap();
      } catch {
        setPinError(t('pin.currentIncorrect', 'PIN actuel incorrect'));
        return;
      }
    }

    if (newPin.length < 4) {
      setPinError(t('pin.tooShort'));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t('pin.mismatch'));
      return;
    }

    try {
      await dispatch(
        updateProfile({
          profileId: activeProfile.id,
          updates: { pin: newPin },
        })
      ).unwrap();
      setShowPinSetup(false);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setPinSuccess(hasPinConfigured ? t('pin.pinChanged') : t('pin.pinSet'));
      setTimeout(() => setPinSuccess(''), 3000);
    } catch (err) {
      console.error('Failed to set PIN:', err);
      setPinError(t('pin.error'));
    }
  }, [currentPin, newPin, confirmPin, activeProfile, hasPinConfigured, dispatch, t]);

  const handleToggleAllowPinReset = useCallback(async () => {
    if (!activeProfile) return;
    const newValue = !allowPinReset;
    try {
      await dispatch(
        updateProfile({
          profileId: activeProfile.id,
          updates: { allowPinReset: newValue },
        })
      ).unwrap();
      setAllowPinReset(newValue);
    } catch (err) {
      console.error('Failed to toggle allowPinReset:', err);
    }
  }, [allowPinReset, activeProfile, dispatch]);

  const handleRemovePin = useCallback(async () => {
    if (!activeProfile) return;
    try {
      await dispatch(
        updateProfile({
          profileId: activeProfile.id,
          updates: { pin: null },
        })
      ).unwrap();
      setShowPinSetup(false);
      setPinSuccess(t('pin.pinRemoved'));
      setTimeout(() => setPinSuccess(''), 3000);
    } catch (err) {
      console.error('Failed to remove PIN:', err);
    }
  }, [activeProfile, dispatch, t]);

  const handleResetProfile = useCallback(async () => {
    if (!activeProfile) return;
    if (!confirm(t('profile.resetProfileConfirm'))) return;
    try {
      await dispatch(
        updateProfile({
          profileId: activeProfile.id,
          updates: { name: 'User', avatarColor: AVATAR_COLORS[0], pin: null },
        })
      ).unwrap();
      setName('User');
      setAvatarColor(AVATAR_COLORS[0]);
      // Re-fetch manifest to sync everything
      dispatch(fetchManifest());
    } catch (err) {
      console.error('Failed to reset profile:', err);
    }
  }, [activeProfile, dispatch, t]);

  if (!activeProfile) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-6">
        <p className="text-[var(--color-text-tertiary)]">
          {t('profile.noActiveProfile', 'Aucun profil actif')}
        </p>
      </div>
    );
  }

  const inputClass =
    'w-full px-4 py-2.5 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-400)]';
  const sectionClass =
    'bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-6';

  return (
    <div className="max-w-2xl mx-auto py-8 px-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          {t('profile.title')}
        </h1>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1">{t('profile.subtitle')}</p>
      </div>

      {/* Avatar & Name Section */}
      <div className={sectionClass}>
        <div className="flex items-start gap-6">
          {/* Avatar with upload overlay */}
          <div className="relative group shrink-0">
            <ProfileAvatar
              name={name}
              avatarColor={avatarColor}
              avatarImage={avatarImage}
              size={80}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
              title={t('profile.uploadAvatar', 'Changer la photo')}
            >
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarImageUpload}
            />
            {avatarImage && (
              <button
                onClick={handleRemoveAvatarImage}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-xs hover:bg-red-600 transition-colors"
                title={t('profile.removeAvatar', 'Supprimer la photo')}
              >
                &times;
              </button>
            )}
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">
                {t('profile.nameLabel')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('profile.namePlaceholder')}
                maxLength={50}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2">
                {t('profile.avatarColor')}
              </label>
              <div className="flex flex-wrap gap-2">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => setAvatarColor(color)}
                    className={`w-8 h-8 rounded-full transition-all ${
                      avatarColor === color
                        ? 'ring-2 ring-offset-2 ring-[var(--color-primary-500)] scale-110'
                        : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveProfile}
              disabled={
                saving ||
                !name.trim() ||
                (name === activeProfile.name &&
                  avatarColor === activeProfile.avatarColor &&
                  avatarImage === activeProfile.avatarImage)
              }
              className="px-5 py-2 text-sm font-medium rounded-lg text-white
                bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)]
                disabled:opacity-50 transition-all"
            >
              {saved ? t('profile.saved') : t('profile.save')}
            </button>
          </div>
        </div>
      </div>

      {/* PIN Section */}
      <div className={sectionClass}>
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">
          {t('profile.pinSection')}
        </h3>
        <p className="text-xs text-[var(--color-text-tertiary)] mb-4">{t('profile.pinDesc')}</p>

        {pinSuccess && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-xs text-green-700">
            {pinSuccess}
          </div>
        )}

        {!showPinSetup ? (
          <>
            <div className="flex items-center gap-3">
              <div
                className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                  hasPinConfigured
                    ? 'bg-green-100 text-green-700'
                    : 'bg-[var(--color-background-secondary)] text-[var(--color-text-tertiary)]'
                }`}
              >
                {hasPinConfigured ? t('pin.enabled') : t('pin.disabled')}
              </div>
              <button
                onClick={() => {
                  setShowPinSetup(true);
                  setPinError('');
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-[var(--color-border)]
                  text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] transition-colors"
              >
                {hasPinConfigured ? t('pin.change') : t('pin.setup')}
              </button>
              {hasPinConfigured && (
                <button
                  onClick={handleRemovePin}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-red-200
                    text-red-600 hover:bg-red-50 transition-colors"
                >
                  {t('pin.remove')}
                </button>
              )}
            </div>

            {hasPinConfigured && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--color-border)]">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                    {t('profiles.allowPinReset')}
                  </p>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                    {t('profiles.allowPinResetDesc')}
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={allowPinReset}
                  onClick={handleToggleAllowPinReset}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
                    border-2 border-transparent transition-colors duration-200 ease-in-out
                    focus:outline-none focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:ring-offset-2
                    ${allowPinReset ? 'bg-[var(--color-primary-600)]' : 'bg-[var(--color-neutral-300)]'}`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 rounded-full
                      bg-white shadow transform transition duration-200
                      ${allowPinReset ? 'translate-x-4' : 'translate-x-0'}`}
                  />
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3 max-w-sm">
            {hasPinConfigured && (
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  {t('pin.current', 'PIN actuel')}
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={currentPin}
                  onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="****"
                  className={inputClass}
                  autoFocus
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {t('pin.new')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="****"
                className={inputClass}
                autoFocus={!hasPinConfigured}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                {t('pin.confirm')}
              </label>
              <input
                type="password"
                inputMode="numeric"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="****"
                className={inputClass}
              />
            </div>

            {pinError && <p className="text-xs text-red-500">{pinError}</p>}

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSetPin}
                className="px-4 py-2 text-xs font-medium rounded-lg text-white
                  bg-[var(--color-primary-600)] hover:bg-[var(--color-primary-700)] transition-colors"
              >
                {hasPinConfigured ? t('pin.change') : t('pin.setup')}
              </button>
              {hasPinConfigured && (
                <button
                  onClick={handleRemovePin}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-red-200
                    text-red-600 hover:bg-red-50 transition-colors"
                >
                  {t('pin.remove')}
                </button>
              )}
              <button
                onClick={() => {
                  setShowPinSetup(false);
                  setPinError('');
                  setCurrentPin('');
                  setNewPin('');
                  setConfirmPin('');
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg text-[var(--color-text-tertiary)]
                  hover:bg-[var(--color-hover-overlay)] transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className={`${sectionClass} border-red-200`}>
        <h3 className="text-sm font-semibold text-red-600 mb-3">{t('profile.dangerZone')}</h3>
        <button
          onClick={handleResetProfile}
          className="px-4 py-2 text-xs font-medium rounded-lg border border-red-200
            text-red-600 hover:bg-red-50 transition-colors"
        >
          {t('profile.resetProfile')}
        </button>
      </div>
    </div>
  );
};

export default Profile;
