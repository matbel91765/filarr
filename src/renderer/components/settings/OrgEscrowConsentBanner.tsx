/**
 * OrgEscrowConsentBanner (E4-3 / E4-9 UI) — member-facing. When the member's org has escrow on, it
 * explains team-vault recovery, shows the org-key safety number for out-of-band verification, and
 * lets the member GRANT or WITHDRAW consent. Self-contained (reads its own orgId + userId), so it
 * can be mounted anywhere a member lands. Renders nothing when escrow is off.
 *
 * There is no server "my consent status" endpoint, so a local flag (per org+user) drives the
 * granted/ungranted prompt; the server remains the authority (grant/revoke are idempotent).
 */

import React, { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { selectCurrentOrgId } from '../../../store/selectors/authSelectors';
import { InfoCallout } from './enterprise/AdminPrimitives';
import { OrgKeyFingerprintPanel } from './enterprise/OrgKeyFingerprintPanel';
import { Button } from '../ui/Button';
import { useNotification } from '../ui/Notification';
import {
  apiGetOrgPublicKey,
  apiGetOrgKeyLog,
  type OrgPublicKey,
} from '../../../services/org/orgKeysApi';
import type { KeyLogEntry } from '../../../services/vault/keyTransparency';

const flagKey = (orgId: string, userId: string) => `filarr.escrow.consent.${orgId}.${userId}`;

export const OrgEscrowConsentBanner: FC = () => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const orgId = useSelector(selectCurrentOrgId);
  const userId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const [orgPub, setOrgPub] = useState<OrgPublicKey | null>(null);
  const [entries, setEntries] = useState<KeyLogEntry[]>([]);
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!orgId || !userId) return;
    try {
      setGranted(localStorage.getItem(flagKey(orgId, userId)) === '1');
    } catch {
      /* no localStorage */
    }
    let live = true;
    void (async () => {
      try {
        const pub = await apiGetOrgPublicKey(orgId);
        if (!live) return;
        setOrgPub(pub);
        if (pub && pub.escrowPolicy !== 'off') {
          const log = await apiGetOrgKeyLog(orgId).catch(() => [] as KeyLogEntry[]);
          if (live) setEntries(log);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      live = false;
    };
  }, [orgId, userId]);

  if (!orgId || !userId || !orgPub || orgPub.escrowPolicy === 'off' || dismissed) return null;

  const isShamir = orgPub.escrowPolicy === 'shamir';

  const grant = async () => {
    setBusy(true);
    try {
      const { grantEscrowConsent } = await import('../../../services/org/orgKeySync');
      const ok = await grantEscrowConsent(orgId, userId);
      if (ok) {
        try {
          localStorage.setItem(flagKey(orgId, userId), '1');
        } catch {
          /* no localStorage */
        }
        setGranted(true);
        success(t('org.escrow.consent.granted'));
      } else {
        notifyError(t('org.escrow.consent.verifyFirst'));
      }
    } catch {
      notifyError(t('org.escrow.consent.error'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    setBusy(true);
    try {
      const { revokeEscrowConsent } = await import('../../../services/org/orgKeySync');
      const ok = await revokeEscrowConsent(orgId, userId);
      if (ok) {
        try {
          localStorage.removeItem(flagKey(orgId, userId));
        } catch {
          /* no localStorage */
        }
        setGranted(false);
        success(t('org.escrow.consent.revoked'));
      } else {
        notifyError(t('org.escrow.consent.error'));
      }
    } catch {
      notifyError(t('org.escrow.consent.error'));
    } finally {
      setBusy(false);
    }
  };

  if (granted) {
    return (
      <div style={{ marginBottom: 'var(--spacing-4)' }}>
        <InfoCallout tone="success">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'var(--spacing-3)',
            }}
          >
            <span>{t('org.escrow.consent.granted')}</span>
            <Button variant="ghost" size="sm" loading={busy} onClick={revoke}>
              {t('org.escrow.consent.revoke')}
            </Button>
          </div>
        </InfoCallout>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-4)' }}>
      <InfoCallout tone="info">
        <div style={{ display: 'grid', gap: 'var(--spacing-3)' }}>
          <div>
            <strong>{t('org.escrow.consent.title')}</strong>
            <p style={{ margin: '4px 0 0' }}>{t('org.escrow.consent.need')}</p>
            <p style={{ margin: '4px 0 0', opacity: 0.8 }}>
              {isShamir ? t('org.escrow.consent.shamirWarn') : t('org.escrow.consent.orgKeyWarn')}
            </p>
          </div>
          <OrgKeyFingerprintPanel
            orgId={orgId}
            encPublicKey={orgPub.encPublicKey}
            fingerprint={orgPub.fingerprint}
            entries={entries}
            onTrustChange={setTrusted}
          />
          <div style={{ display: 'flex', gap: 'var(--spacing-2)' }}>
            <Button variant="primary" size="sm" loading={busy} disabled={!trusted} onClick={grant}>
              {t('org.escrow.consent.grant')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
              {t('common.dismiss', 'Dismiss')}
            </Button>
          </div>
        </div>
      </InfoCallout>
    </div>
  );
};

export default OrgEscrowConsentBanner;
