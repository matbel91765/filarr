/**
 * ShareFileModal — E2EE share creation dialog
 *
 * States:
 *   - "form"     : configure expiry / max views / password
 *   - "creating" : actively reading the file + uploading chunks (with progress)
 *   - "success"  : share is ready, displays the URL with copy button
 *   - "error"    : something failed during creation
 *
 * Built on the project's design system (Modal/Button/Checkbox) so all accent
 * and theme colors come from CSS variables — works with every theme the
 * user picks in Appearance settings, in both light and dark modes.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal/Modal';
import { Button } from '../ui/Button/Button';
import { Checkbox } from '../ui/Checkbox/Checkbox';
import type { RootState } from '../../../store';
import { createShareThunk, clearLastCreated, clearError } from '../../../store/slices/sharesSlice';
import type { FileItem } from '../../../types';
import { formatBytes } from '../../../constants/limits';
import { buildShareMailto, openMailto } from '../../../services/sharing/mailtoLink';
import { useNotification } from '../ui/Notification';
import { useEffectiveTier } from '../../../hooks/useEffectiveTier';
import './ShareFileModal.css';

interface ShareFileModalProps {
  file: FileItem;
  folderId: string;
  onClose: () => void;
}

type ExpiryPreset = '1h' | '24h' | '7d' | '14d' | '90d' | '365d';

const EXPIRY_PRESETS: Record<ExpiryPreset, number> = {
  '1h': 60 * 60,
  '24h': 24 * 60 * 60,
  '7d': 7 * 24 * 60 * 60,
  '14d': 14 * 24 * 60 * 60,
  '90d': 90 * 24 * 60 * 60,
  '365d': 365 * 24 * 60 * 60,
};

/**
 * Per-tier ceilings — must stay in sync with PLAN_LIMITS in
 * infra/cloudflare-worker/src/share.ts. The server is authoritative;
 * we use these to grey out options at the UI level for better UX.
 */
const TIER_LIMITS: Record<string, { maxExpiry: ExpiryPreset; passwordAllowed: boolean }> = {
  free: { maxExpiry: '14d', passwordAllowed: false },
  solo: { maxExpiry: '90d', passwordAllowed: true },
  pro: { maxExpiry: '365d', passwordAllowed: true },
  // Les sièges d'organisation : monotones au-dessus de pro, comme sur le
  // serveur. Sans ces lignes, un palier effectif 'teams' retombait sur free.
  teams: { maxExpiry: '365d', passwordAllowed: true },
  enterprise: { maxExpiry: '365d', passwordAllowed: true },
};

const PRESET_ORDER: ExpiryPreset[] = ['1h', '24h', '7d', '14d', '90d', '365d'];

const ShareFileModal: React.FC<ShareFileModalProps> = ({ file, folderId, onClose }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<ThunkDispatch<RootState, unknown, AnyAction>>();
  const { creating, lastCreated, error, progress } = useSelector((s: RootState) => s.shares);
  // Le palier EFFECTIF (siège d'organisation compris), pas la photo du jeton :
  // un siège Teams a 'free' sur sa ligne, et se voyait griser le mot de passe.
  const userTier = useEffectiveTier();
  const tierLimits = TIER_LIMITS[userTier] ?? TIER_LIMITS.free;
  const maxAllowedIndex = PRESET_ORDER.indexOf(tierLimits.maxExpiry);

  const [expiry, setExpiry] = useState<ExpiryPreset>(tierLimits.maxExpiry);
  const [enableMaxViews, setEnableMaxViews] = useState(false);
  const [maxViews, setMaxViews] = useState(10);
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [oneDownloadPerIp, setOneDownloadPerIp] = useState(false);
  const [copied, setCopied] = useState(false);

  const mimeType = file.type || 'application/octet-stream';

  const handleCreate = useCallback(async () => {
    await dispatch(
      createShareThunk({
        folderId,
        fileName: file.name,
        mimeType,
        expiresInSeconds: EXPIRY_PRESETS[expiry],
        maxViews: enableMaxViews ? maxViews : null,
        password: enablePassword && tierLimits.passwordAllowed ? password : null,
        oneDownloadPerIp,
      })
    );
  }, [
    dispatch,
    folderId,
    file.name,
    mimeType,
    expiry,
    enableMaxViews,
    maxViews,
    enablePassword,
    password,
    oneDownloadPerIp,
    tierLimits.passwordAllowed,
  ]);

  const handleCopyUrl = useCallback(async () => {
    if (!lastCreated?.publicUrl) return;
    await navigator.clipboard.writeText(lastCreated.publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [lastCreated?.publicUrl]);

  /**
   * « ENVOYER PAR E-MAIL » — par la messagerie de l'expéditeur, jamais par nous.
   * La clé est dans le lien : la faire transiter par notre serveur et notre
   * prestataire d'e-mail casserait la promesse. Un `mailto:` la garde sur
   * l'appareil, et c'est SON e-mail qui la porte. Sans messagerie configurée
   * rien ne s'ouvre : on le dit, et « Copier le lien » reste le chemin complet.
   */
  const { error: notifyError } = useNotification();
  const handleEmail = useCallback(() => {
    if (!lastCreated?.publicUrl) return;
    const name = file.name;
    const mailto = buildShareMailto({
      url: lastCreated.publicUrl,
      subject: t('sharing.email.subject', { name, defaultValue: '{{name}} — shared with Filarr' }),
      intro: t('sharing.email.intro', {
        name,
        defaultValue: 'Here is the link to get "{{name}}":',
      }),
      expiry: t('sharing.email.expiry', {
        date: new Date(lastCreated.expiresAt).toLocaleDateString(),
        defaultValue: 'This link expires on {{date}}.',
      }),
      keyNote: t('sharing.email.keyNote', {
        defaultValue:
          'The decryption key is part of the link: forward it only to the person it is meant for.',
      }),
    });
    if (!mailto || !openMailto(mailto)) {
      notifyError(
        t('sharing.email.unavailable', {
          defaultValue: 'No mail app is set up on this device: copy the link instead.',
        })
      );
    }
  }, [lastCreated?.publicUrl, lastCreated?.expiresAt, file.name, t, notifyError]);

  const handleClose = useCallback(() => {
    // Don't allow closing mid-upload — interrupted chunks leave a 'pending'
    // share row on the server. We let the GC clean those up but it's still
    // a confusing state for users. If they really want out they can cancel
    // via the OS (closing the app); otherwise wait the few seconds.
    if (creating) return;
    dispatch(clearLastCreated());
    dispatch(clearError());
    onClose();
  }, [creating, dispatch, onClose]);

  const expiryLabel = useMemo<Record<ExpiryPreset, string>>(
    () => ({
      '1h': t('sharing.expiry.1h', { defaultValue: '1 hour' }),
      '24h': t('sharing.expiry.24h', { defaultValue: '24 hours' }),
      '7d': t('sharing.expiry.7d', { defaultValue: '7 days' }),
      '14d': t('sharing.expiry.14d', { defaultValue: '14 days' }),
      '90d': t('sharing.expiry.90d', { defaultValue: '90 days' }),
      '365d': t('sharing.expiry.365d', { defaultValue: '1 year' }),
    }),
    [t]
  );

  // ── Render branches ─────────────────────────────────────────────────────

  const renderCreating = () => {
    // Progress can be {0,0} before the first chunk reports — guard against
    // dividing by zero so the bar starts at 0% rather than NaN%.
    const total = progress?.total ?? 0;
    const uploaded = progress?.uploaded ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((uploaded / total) * 100)) : 0;
    return (
      <ModalBody>
        <p className="share-modal__filename">{file.name}</p>
        <div className="share-modal__progress">
          <div className="share-modal__progress-track">
            <div
              className="share-modal__progress-fill"
              style={{ width: `${pct}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="share-modal__progress-meta">
            <span>{pct}%</span>
            <span>
              {formatBytes(uploaded)} / {formatBytes(total || 1)}
            </span>
          </div>
        </div>
        <div className="share-modal__note">
          {t('sharing.creating.note', {
            defaultValue:
              'Encrypting and uploading your file. This window will close itself when done.',
          })}
        </div>
      </ModalBody>
    );
  };

  const renderSuccess = () => (
    <>
      <ModalBody>
        <div className="share-modal__success-header">
          <div className="share-modal__success-icon" aria-hidden="true">
            ✓
          </div>
          <div>
            <h3 className="share-modal__success-title">
              {t('sharing.success.title', { defaultValue: 'Share link ready' })}
            </h3>
            <p className="share-modal__success-subtitle">
              {t('sharing.success.subtitle', {
                defaultValue: 'Send this URL to anyone — it decrypts in their browser.',
              })}
            </p>
          </div>
        </div>

        <div className="share-modal__url-box">
          <input
            type="text"
            readOnly
            value={lastCreated?.publicUrl ?? ''}
            onClick={(e) => (e.target as HTMLInputElement).select()}
            className="share-modal__url-input"
            aria-label={t('sharing.success.urlAria', { defaultValue: 'Share URL' })}
          />
        </div>

        <Button
          variant="primary"
          onClick={handleCopyUrl}
          fullWidth
          className="share-modal__section"
        >
          {copied
            ? t('sharing.success.copied', { defaultValue: '✓ Copied' })
            : t('sharing.success.copy', { defaultValue: 'Copy link' })}
        </Button>

        <Button
          variant="secondary"
          onClick={handleEmail}
          fullWidth
          className="share-modal__section"
        >
          {t('sharing.email.button', { defaultValue: 'Send by email' })}
        </Button>

        <div className="share-modal__note share-modal__note--warning">
          <strong>{t('sharing.success.warningTitle', { defaultValue: 'Important' })}</strong>
          {t('sharing.success.warningBody', {
            defaultValue:
              'The decryption key is in the URL after #. Anyone with this full URL can decrypt the file — share it only via a secure channel.',
          })}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={handleClose} fullWidth>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
      </ModalFooter>
    </>
  );

  const renderForm = () => {
    const passwordSelected = enablePassword && tierLimits.passwordAllowed;
    const canSubmit = !creating && (!passwordSelected || password.length > 0);

    return (
      <>
        <ModalBody>
          <p className="share-modal__filename">{file.name}</p>

          {/* ── Expiry preset selector ── */}
          <div className="share-modal__section">
            <label className="share-modal__label">
              {t('sharing.create.expiry', { defaultValue: 'Link expires after' })}
            </label>
            <div className="share-modal__expiry-row" role="group">
              {PRESET_ORDER.map((preset, idx) => {
                const disabled = idx > maxAllowedIndex;
                return (
                  <button
                    key={preset}
                    type="button"
                    disabled={disabled}
                    onClick={() => setExpiry(preset)}
                    title={
                      disabled
                        ? t('sharing.create.upgradeForExpiry', {
                            defaultValue: 'Upgrade your plan for longer expiry',
                          })
                        : undefined
                    }
                    aria-pressed={expiry === preset}
                    className={[
                      'share-modal__expiry-btn',
                      expiry === preset ? 'share-modal__expiry-btn--active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {expiryLabel[preset]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Max views toggle (no plan gate, plain feature) ── */}
          <div
            className={[
              'share-modal__option',
              'share-modal__section',
              enableMaxViews ? 'share-modal__option--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(e) => {
              if (
                (e.target as HTMLElement).tagName === 'INPUT' &&
                (e.target as HTMLInputElement).type === 'number'
              )
                return;
              setEnableMaxViews((v) => !v);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setEnableMaxViews((v) => !v);
              }
            }}
          >
            <div className="share-modal__option-row">
              <Checkbox
                checked={enableMaxViews}
                onChange={(e) => setEnableMaxViews(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                size="md"
              />
              <span className="share-modal__option-label">
                {t('sharing.create.limitViews', {
                  defaultValue: 'Limit number of downloads',
                })}
              </span>
            </div>
            {enableMaxViews && (
              <input
                type="number"
                min={1}
                max={1000}
                value={maxViews}
                onChange={(e) => setMaxViews(Math.max(1, parseInt(e.target.value, 10) || 1))}
                onClick={(e) => e.stopPropagation()}
                className="share-modal__option-input share-modal__option-input--narrow"
                aria-label={t('sharing.create.maxViewsAria', {
                  defaultValue: 'Maximum number of downloads',
                })}
              />
            )}
          </div>

          {/* ── One download per IP toggle ── */}
          <div
            className={[
              'share-modal__option',
              'share-modal__section',
              oneDownloadPerIp ? 'share-modal__option--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setOneDownloadPerIp((v) => !v)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setOneDownloadPerIp((v) => !v);
              }
            }}
          >
            <div className="share-modal__option-row">
              <Checkbox
                checked={oneDownloadPerIp}
                onChange={(e) => setOneDownloadPerIp(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                size="md"
              />
              <span className="share-modal__option-label">
                {t('sharing.create.oneDownloadPerIp', {
                  defaultValue: 'Allow only one download per IP',
                })}
              </span>
            </div>
            {oneDownloadPerIp && (
              <p className="share-modal__option-hint">
                {t('sharing.create.oneDownloadPerIpHint', {
                  defaultValue:
                    'Each recipient network (/16 subnet) can download the file once. Useful to prevent re-distribution. People behind the same NAT (offices, schools) will share the limit.',
                })}
              </p>
            )}
          </div>

          {/* ── Password toggle (Solo+ only) ── */}
          <div
            className={[
              'share-modal__option',
              'share-modal__section',
              !tierLimits.passwordAllowed ? 'share-modal__option--disabled' : '',
              passwordSelected ? 'share-modal__option--active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(e) => {
              if (!tierLimits.passwordAllowed) return;
              if (
                (e.target as HTMLElement).tagName === 'INPUT' &&
                (e.target as HTMLInputElement).type === 'password'
              )
                return;
              setEnablePassword((v) => !v);
            }}
            role="button"
            tabIndex={tierLimits.passwordAllowed ? 0 : -1}
            aria-disabled={!tierLimits.passwordAllowed}
            onKeyDown={(e) => {
              if (!tierLimits.passwordAllowed) return;
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                setEnablePassword((v) => !v);
              }
            }}
            title={
              !tierLimits.passwordAllowed
                ? t('sharing.create.passwordSoloPlus', {
                    defaultValue: 'Available on Solo and Pro plans',
                  })
                : undefined
            }
          >
            <div className="share-modal__option-row">
              <Checkbox
                checked={passwordSelected}
                disabled={!tierLimits.passwordAllowed}
                onChange={(e) => setEnablePassword(e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                size="md"
              />
              <span className="share-modal__option-label">
                {t('sharing.create.password', { defaultValue: 'Require a password' })}
                {!tierLimits.passwordAllowed && (
                  <span className="share-modal__pro-badge">Solo</span>
                )}
              </span>
            </div>
            {passwordSelected && (
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('sharing.create.passwordPlaceholder', {
                  defaultValue: 'Strong password (recipient will need this)',
                })}
                onClick={(e) => e.stopPropagation()}
                className="share-modal__option-input"
                autoComplete="new-password"
              />
            )}
          </div>

          {/* ── Privacy note ── */}
          <div className="share-modal__note share-modal__section">
            {t('sharing.create.privacyNote', {
              defaultValue:
                'The decryption key is generated in your browser and embedded in the URL fragment (#). Our servers only see encrypted bytes — they cannot read this file.',
            })}
          </div>

          {error && <div className="share-modal__error">{error}</div>}
        </ModalBody>

        <ModalFooter>
          <Button variant="secondary" onClick={handleClose}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canSubmit} loading={creating}>
            {t('sharing.create.createButton', { defaultValue: 'Create link' })}
          </Button>
        </ModalFooter>
      </>
    );
  };

  const title = lastCreated
    ? t('sharing.success.title', { defaultValue: 'Share link ready' })
    : creating
      ? t('sharing.creating.title', { defaultValue: 'Creating share…' })
      : t('sharing.create.title', { defaultValue: 'Share file' });

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      size="sm"
      closeOnBackdrop={!creating}
      closeOnEsc={!creating}
    >
      <ModalHeader onClose={handleClose} showCloseButton={!creating}>
        {title}
      </ModalHeader>
      {creating ? renderCreating() : lastCreated ? renderSuccess() : renderForm()}
    </Modal>
  );
};

export default ShareFileModal;
