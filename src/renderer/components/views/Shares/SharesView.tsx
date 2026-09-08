/**
 * SharesView — dedicated route for managing E2EE shares
 *
 * Lives at `/shares` and is reachable from the sidebar. Wraps the
 * SharesManagementSection (used to live in Settings → Shares) with a
 * proper page chrome: title, subtitle, container styling that matches
 * the other top-level views (Trash, Timeline, etc.).
 *
 * Cloud-only: in local mode we show an empty-state explaining sharing
 * needs a cloud account, with a CTA to upgrade.
 */

import React, { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AnyAction } from 'redux';
import type { ThunkDispatch } from 'redux-thunk';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../../store';
import { loadSharesThunk } from '../../../../store/slices/sharesSlice';
import SharesManagementSection from '../../settings/SharesManagementSection';
import './SharesView.css';

export const SharesView: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<ThunkDispatch<RootState, unknown, AnyAction>>();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);

  // Refresh on mount so the user always sees the latest list when
  // navigating into the page. The thunk de-dupes if a load is already
  // in flight; cheap to fire.
  useEffect(() => {
    if (accountMode === 'cloud') {
      void dispatch(loadSharesThunk());
    }
  }, [accountMode, dispatch]);

  return (
    <div className="shares-view">
      <div className="shares-view__container">
        <header className="shares-view__header">
          <div className="shares-view__icon" aria-hidden="true">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          </div>
          <div>
            <h1 className="shares-view__title">
              {t('shares.pageTitle', { defaultValue: 'Encrypted shares' })}
            </h1>
            <p className="shares-view__subtitle">
              {t('shares.pageSubtitle', {
                defaultValue:
                  'End-to-end encrypted share links you created from this device. The decryption key never leaves your browser.',
              })}
            </p>
          </div>
        </header>

        {accountMode !== 'cloud' ? (
          <div className="shares-view__empty">
            <h2 className="shares-view__empty-title">
              {t('shares.localModeTitle', { defaultValue: 'Sharing requires cloud sync' })}
            </h2>
            <p className="shares-view__empty-body">
              {t('shares.localModeBody', {
                defaultValue:
                  'Filarr is currently running in local mode. Enable cloud sync in Settings to start sharing files via encrypted links.',
              })}
            </p>
          </div>
        ) : (
          <SharesManagementSection />
        )}
      </div>
    </div>
  );
};

export default SharesView;
