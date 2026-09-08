/**
 * GovernanceBanner — E9-10 honest "running on cached org policy" indicator.
 *
 * Shows a slim bar while a device is enforcing an org governance policy from its OFFLINE cache (not a
 * fresh fetch). It deliberately discloses that client enforcement is best-effort and that some
 * controls only apply online — the spec forbids implying instant universal enforcement. The degraded
 * state (grace expired) is surfaced by the lock screen instead, so this banner hides when degraded.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import {
  selectPolicyActive,
  selectGovernanceOnline,
  selectIsPolicyDegraded,
  selectPolicyFetchedAt,
  selectPolicyFromCache,
} from '../../../store/slices/governanceSlice';

const GovernanceBanner: React.FC = () => {
  const { t } = useTranslation();
  const active = useSelector(selectPolicyActive);
  const online = useSelector(selectGovernanceOnline);
  const degraded = useSelector(selectIsPolicyDegraded);
  const fetchedAt = useSelector(selectPolicyFetchedAt);
  const fromCache = useSelector(selectPolicyFromCache);

  // Only relevant when actively enforcing a policy offline / from cache. When fully online on a fresh
  // fetch there's nothing to disclose; when degraded the lock screen carries the message.
  if (!active || degraded || (online && !fromCache)) return null;

  const date = fetchedAt ? new Date(fetchedAt).toLocaleString() : '—';

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 16px',
        fontSize: 12,
        lineHeight: 1.4,
        color: 'var(--color-text-secondary)',
        backgroundColor: 'color-mix(in srgb, #f59e0b 12%, var(--color-surface))',
        borderBottom: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          backgroundColor: '#f59e0b',
          flexShrink: 0,
        }}
      />
      <span>
        {t('org.governance.offline.banner', {
          date,
          defaultValue:
            'Offline — enforcing the org policy cached on {{date}}. Some controls (network allowlist, remote sign-out) only apply online; client guards are best-effort.',
        })}
      </span>
    </div>
  );
};

export default GovernanceBanner;
