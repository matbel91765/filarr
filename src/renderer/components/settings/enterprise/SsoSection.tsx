/**
 * SsoSection (E5-3 UI) — owner/admin screen to configure org SSO (OIDC). Sets the IdP connection
 * (issuer + client id/secret, JIT), verifies email domains via a DNS-TXT record, and flips the
 * connection live. Zero-knowledge: the IdP only authenticates identity; it never sees a vault key.
 * Calls the reviewed /org/:id/sso endpoints; the client_secret is write-only (never read back).
 */

import React, { FC, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, StatusBadge, InfoCallout, CopyableId } from './AdminPrimitives';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toggle } from '../../ui/Toggle';
import { Select } from '../../ui/Dropdown';
import { useNotification } from '../../ui/Notification';
import {
  apiGetSsoConfig,
  apiSaveSsoConfig,
  apiEnableSso,
  apiListSsoDomains,
  apiAddSsoDomain,
  apiVerifySsoDomain,
  type SsoConfig,
  type SsoDomain,
} from '../../../../services/org/ssoApi';

interface Props {
  orgId: string;
}

const errMsg = (e: unknown, fallback: string): string =>
  (e as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;

const SsoSection: FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();
  const { success, error: notifyError } = useNotification();
  const [config, setConfig] = useState<SsoConfig | null>(null);
  const [domains, setDomains] = useState<SsoDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [issuer, setIssuer] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [jitEnabled, setJitEnabled] = useState(false);
  const [jitRole, setJitRole] = useState('viewer');
  const [newDomain, setNewDomain] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, doms] = await Promise.all([
        apiGetSsoConfig(orgId),
        apiListSsoDomains(orgId).catch(() => [] as SsoDomain[]),
      ]);
      setConfig(cfg);
      setDomains(doms);
      if (cfg) {
        setIssuer(cfg.oidcIssuer ?? '');
        setClientId(cfg.oidcClientId ?? '');
        setJitEnabled(cfg.jitEnabled);
        setJitRole(cfg.jitDefaultRole);
      }
    } catch {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!issuer.trim() || !clientId.trim()) {
      notifyError(t('org.sso.errors.required'));
      return;
    }
    setBusy(true);
    try {
      await apiSaveSsoConfig(orgId, {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret || undefined,
        jitEnabled,
        jitDefaultRole: jitRole,
      });
      setClientSecret('');
      success(t('org.sso.saved'));
      await load();
    } catch (e) {
      notifyError(errMsg(e, t('org.sso.errors.saveFailed')));
    } finally {
      setBusy(false);
    }
  };

  const addDomain = async () => {
    if (!newDomain.trim()) return;
    setBusy(true);
    try {
      await apiAddSsoDomain(orgId, newDomain.trim());
      setNewDomain('');
      success(t('org.sso.domainAdded'));
      await load();
    } catch (e) {
      notifyError(errMsg(e, t('org.sso.errors.domainFailed')));
    } finally {
      setBusy(false);
    }
  };

  const verifyDomain = async (domain: string) => {
    setBusy(true);
    try {
      const ok = await apiVerifySsoDomain(orgId, domain);
      if (ok) {
        success(t('org.sso.domainVerified'));
        await load();
      } else {
        notifyError(t('org.sso.errors.txtNotFound'));
      }
    } catch (e) {
      notifyError(errMsg(e, t('org.sso.errors.txtNotFound')));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await apiEnableSso(orgId, !config.enabled);
      success(config.enabled ? t('org.sso.disabled') : t('org.sso.enabled'));
      await load();
    } catch (e) {
      notifyError(errMsg(e, t('org.sso.errors.enableFailed')));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p style={{ opacity: 0.6, padding: 'var(--spacing-4)' }}>{t('common.loading', 'Loading…')}</p>
    );
  }

  const hasVerifiedDomain = domains.some((d) => d.verified);
  const configured = !!config?.oidcIssuer && !!config?.oidcClientId;

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-5)' }}>
      <AdminSection
        title={t('org.sso.title')}
        description={t('org.sso.desc')}
        actions={
          <StatusBadge tone={config?.enabled ? 'success' : 'neutral'} dot>
            {config?.enabled ? t('org.sso.statusEnabled') : t('org.sso.statusDisabled')}
          </StatusBadge>
        }
      >
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          <InfoCallout tone="info">{t('org.sso.zkNote')}</InfoCallout>
          <Input
            label={t('org.sso.issuer')}
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
            placeholder="https://accounts.google.com"
            maxLength={512}
          />
          <Input
            label={t('org.sso.clientId')}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            maxLength={256}
          />
          <Input
            label={t('org.sso.clientSecret')}
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={config?.hasClientSecret ? '•••••••• (set)' : ''}
            helperText={t('org.sso.clientSecretHint')}
            maxLength={512}
          />
          <Toggle
            label={t('org.sso.jit')}
            checked={jitEnabled}
            onChange={(e) => setJitEnabled(e.target.checked)}
          />
          {jitEnabled && (
            <Select
              label={t('org.sso.jitRole')}
              options={[
                { value: 'viewer', label: t('org.sso.role.viewer') },
                { value: 'editor', label: t('org.sso.role.editor') },
              ]}
              value={jitRole}
              onChange={(v) => setJitRole(Array.isArray(v) ? v[0] : v)}
            />
          )}
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center' }}>
            <Button variant="primary" loading={busy} onClick={save}>
              {t('org.sso.save')}
            </Button>
            {configured && (
              <Button
                variant={config?.enabled ? 'danger' : 'secondary'}
                disabled={busy || (!config?.enabled && !hasVerifiedDomain)}
                onClick={toggleEnabled}
              >
                {config?.enabled ? t('org.sso.disable') : t('org.sso.enable')}
              </Button>
            )}
          </div>
          {configured && !hasVerifiedDomain && (
            <InfoCallout tone="danger">{t('org.sso.enableNeedsDomain')}</InfoCallout>
          )}
          {config?.authorizationEndpoint && (
            <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
              {t('org.sso.discovered')}: {config.tokenEndpoint}
            </p>
          )}
        </div>
      </AdminSection>

      <AdminSection title={t('org.sso.domains.title')} description={t('org.sso.domains.desc')}>
        <div style={{ display: 'grid', gap: 'var(--spacing-4)' }}>
          {domains.length === 0 && (
            <InfoCallout tone="info">{t('org.sso.domains.empty')}</InfoCallout>
          )}
          {domains.map((d) => (
            <div
              key={d.domain}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 'var(--spacing-3)',
                display: 'grid',
                gap: 'var(--spacing-2)',
              }}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <strong>{d.domain}</strong>
                <StatusBadge tone={d.verified ? 'success' : 'warning'} dot>
                  {d.verified ? t('org.sso.domains.verified') : t('org.sso.domains.pending')}
                </StatusBadge>
              </div>
              {!d.verified && (
                <div style={{ display: 'grid', gap: 'var(--spacing-2)' }}>
                  <p style={{ margin: 0, fontSize: 13 }}>{t('org.sso.domains.publishHint')}</p>
                  <div style={{ fontSize: 12 }}>
                    <div>
                      {t('org.sso.domains.record')}: <CopyableId value={d.dnsRecord} />
                    </div>
                    <div>
                      {t('org.sso.domains.value')}: <CopyableId value={d.dnsValue} />
                    </div>
                  </div>
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => verifyDomain(d.domain)}
                    >
                      {t('org.sso.domains.verify')}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'flex-end' }}>
            <Input
              label={t('org.sso.domains.add')}
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="acme.com"
              maxLength={253}
              containerClassName="flex-1"
            />
            <Button
              variant="secondary"
              loading={busy}
              disabled={!newDomain.trim()}
              onClick={addDomain}
            >
              {t('org.sso.domains.addBtn')}
            </Button>
          </div>
        </div>
      </AdminSection>
    </div>
  );
};

export default SsoSection;
