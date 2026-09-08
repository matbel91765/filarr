/**
 * OrgKeyFingerprintPanel (E4-7 UI) — the org escrow key's safety number with its Key-Transparency
 * status, and (when the key changed) an out-of-band accept gate. Written once, reused by the escrow
 * section, the member consent banner, and the Shamir flows so the OOB-verification UX is consistent.
 */

import React, { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type BadgeTone } from './AdminPrimitives';
import { Checkbox } from '../../ui/Checkbox';
import { formatFingerprint } from '../../../utils/formatFingerprint';
import {
  checkOrgKeyTransparency,
  isOrgKeyTrustedForEscrow,
  acceptOrgKeyChange,
} from '../../../../services/org/orgKeyTransparency';
import type { KeyLogEntry } from '../../../../services/vault/keyTransparency';

interface Props {
  orgId: string;
  encPublicKey: string;
  fingerprint: string;
  entries: KeyLogEntry[];
  /** Bubble whether the org key is trusted for escrow (ok / first_seen). */
  onTrustChange?: (trusted: boolean) => void;
}

const TONE: Record<string, BadgeTone> = {
  ok: 'success',
  first_seen: 'info',
  no_log: 'info',
  changed: 'warning',
  served_not_latest: 'error',
  tampered_log: 'error',
};

export const OrgKeyFingerprintPanel: FC<Props> = ({
  orgId,
  encPublicKey,
  fingerprint,
  entries,
  onTrustChange,
}) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const s = await checkOrgKeyTransparency(orgId, { encPublicKey, fingerprint }, entries);
      if (!live) return;
      setStatus(s);
      onTrustChange?.(isOrgKeyTrustedForEscrow(s));
    })();
    return () => {
      live = false;
    };
  }, [orgId, encPublicKey, fingerprint, entries, onTrustChange]);

  const onAccept = async (v: boolean) => {
    setAccepted(v);
    if (!v) return;
    acceptOrgKeyChange(orgId, fingerprint);
    const s = await checkOrgKeyTransparency(orgId, { encPublicKey, fingerprint }, entries);
    setStatus(s);
    onTrustChange?.(isOrgKeyTrustedForEscrow(s));
  };

  return (
    <div>
      <div
        className="ent-mono"
        style={{ fontSize: 13, letterSpacing: '0.06em', wordBreak: 'break-word' }}
      >
        {formatFingerprint(fingerprint)}
      </div>
      {status && (
        <div style={{ marginTop: 'var(--spacing-2)' }}>
          <StatusBadge tone={TONE[status] ?? 'neutral'} dot>
            {t(`org.escrow.fingerprint.${status}`)}
          </StatusBadge>
        </div>
      )}
      {status === 'changed' && (
        <div style={{ marginTop: 'var(--spacing-2)' }}>
          <Checkbox
            checked={accepted}
            onChange={(e) => onAccept(e.target.checked)}
            label={t('org.escrow.fingerprint.acceptChange')}
          />
        </div>
      )}
    </div>
  );
};

export default OrgKeyFingerprintPanel;
