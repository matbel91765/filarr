/**
 * OrgStorageSection — BYOS d'ORGANISATION : le bucket de l'entreprise pour les
 * coffres d'équipe (routes /org/:orgId/storage-target, MANAGE_SETTINGS).
 *
 * Miroir admin de CloudStorageTargetSection (compte perso) : mêmes presets,
 * même recette IAM bornée, même discipline — sonder avant d'enregistrer, le
 * secret ne redescend jamais, migration coffre par coffre avec purge vérifiée.
 * Le composant est AUTONOME : il se monte d'une ligne dans OrgDashboard
 * (`<OrgStorageSection orgId={org.id} />`).
 */

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminSection, InfoCallout } from './AdminPrimitives';
import { Button, Input, Select, ProgressBar, ConfirmModal } from '../../ui';
import { buildIamRecipe } from '../../../../services/storage/iamPolicy';
import {
  fetchStoragePresets,
  StorageTargetApiError,
  type StoragePreset,
  type StorageProvider,
  type StorageAddressing,
  type StorageTargetInput,
} from '../../../../services/storage/storageTargetApi';
import {
  apiGetOrgStorageTarget,
  apiTestOrgStorageTarget,
  apiSaveOrgStorageTarget,
  apiDeleteOrgStorageTarget,
  apiCheckOrgStorageTarget,
  apiOrgMigrationStatus,
  apiOrgMigrationStep,
  apiOrgMigrationPurgeSource,
  type OrgStorageTargetDto,
  type OrgStorageTargetByos,
  type OrgMigrationStatusDto,
} from '../../../../services/org/orgStorageApi';

interface Props {
  orgId: string;
}

const isByos = (t: OrgStorageTargetDto | null): t is OrgStorageTargetByos => t?.mode === 'byos';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ['Kio', 'Mio', 'Gio', 'Tio'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

const OrgStorageSection: FC<Props> = ({ orgId }) => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<OrgStorageTargetDto | null>(null);
  const [presets, setPresets] = useState<StoragePreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | 'check' | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [provider, setProvider] = useState<StorageProvider>('r2');
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('auto');
  const [bucket, setBucket] = useState('');
  const [addressing, setAddressing] = useState<StorageAddressing>('path');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');

  const [migrationStatus, setMigrationStatus] = useState<OrgMigrationStatusDto | null>(null);
  const [migrating, setMigrating] = useState<{
    copied: number;
    direction: 'to-byos' | 'to-filarr';
  } | null>(null);
  const cancelRef = useRef(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [backOpen, setBackOpen] = useState(false);

  const preset = useMemo(() => presets.find((p) => p.provider === provider), [presets, provider]);
  // La recette IAM d'un bucket d'org couvre tout le préfixe vaults/ : les
  // identifiants des coffres sont opaques, pas de sous-préfixe par utilisateur.
  const iamRecipe = useMemo(
    () => buildIamRecipe(provider, bucket.trim(), null),
    [provider, bucket]
  );
  const [iamCopied, setIamCopied] = useState(false);

  const mapError = useCallback(
    (err: unknown): string => {
      const code = err instanceof StorageTargetApiError ? err.code : undefined;
      if (code === 'upgrade_required') return t('org.storage.upgradeRequired');
      if (code === 'cooldown') return t('settings.accountSync.byos.cooldown');
      if (code === 'storage_unreachable') return t('settings.accountSync.byos.unreachable');
      if (code === 'invalid_endpoint') return t('settings.accountSync.byos.invalidEndpoint');
      if (err instanceof Error && err.message) return err.message;
      return t('settings.accountSync.byos.saveError');
    },
    [t]
  );

  const applyPreset = useCallback((p: StoragePreset) => {
    setProvider(p.provider);
    setRegion(p.defaultRegion);
    setAddressing(p.defaultAddressing);
    setEndpoint(p.endpointHint.includes('{') ? '' : p.endpointHint);
  }, []);

  const hydrate = useCallback(
    (dto: OrgStorageTargetDto, list: StoragePreset[]) => {
      setTarget(dto);
      if (dto.mode === 'byos') {
        setProvider(dto.provider);
        setEndpoint(dto.endpoint);
        setRegion(dto.region);
        setBucket(dto.bucket);
        setAddressing(dto.addressing);
      } else {
        const r2 = list.find((p) => p.provider === 'r2') ?? list[0];
        if (r2) applyPreset(r2);
        setBucket('');
      }
      setAccessKeyId('');
      setSecretAccessKey('');
      setShowForm(false);
    },
    [applyPreset]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [dto, catalog] = await Promise.all([
          apiGetOrgStorageTarget(orgId),
          fetchStoragePresets(),
        ]);
        if (cancelled) return;
        setPresets(catalog.presets);
        hydrate(dto, catalog.presets);
      } catch (err) {
        if (!cancelled) setError(mapError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, hydrate, mapError]);

  const refreshMigrationStatus = useCallback(async () => {
    try {
      setMigrationStatus(await apiOrgMigrationStatus(orgId, 'to-byos'));
    } catch {
      setMigrationStatus(null);
    }
  }, [orgId]);

  useEffect(() => {
    if (!isByos(target)) {
      setMigrationStatus(null);
      return;
    }
    void refreshMigrationStatus();
  }, [target, refreshMigrationStatus]);

  const buildInput = (): StorageTargetInput | null => {
    if (!endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      setError(t('settings.accountSync.byos.missingFields'));
      return null;
    }
    return {
      provider,
      endpoint: endpoint.trim(),
      region: region.trim() || 'auto',
      bucket: bucket.trim(),
      addressing,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey,
    };
  };

  const onTest = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy('test');
    setError(null);
    setOkMsg(null);
    try {
      await apiTestOrgStorageTarget(orgId, input);
      setOkMsg(t('settings.accountSync.byos.testOk'));
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy('save');
    setError(null);
    setOkMsg(null);
    try {
      const dto = await apiSaveOrgStorageTarget(orgId, input);
      hydrate(dto, presets);
      setOkMsg(t('org.storage.saved'));
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async () => {
    setBusy('delete');
    setError(null);
    try {
      const dto = await apiDeleteOrgStorageTarget(orgId);
      hydrate(dto, presets);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(null);
    }
  };

  const onCheck = async () => {
    setBusy('check');
    setError(null);
    try {
      const h = await apiCheckOrgStorageTarget(orgId);
      setTarget((prev) =>
        isByos(prev)
          ? {
              ...prev,
              lastCheckAt: h.lastCheckAt,
              lastCheckOk: h.ok,
              consecutiveFailures: h.consecutiveFailures,
              lastCheckLatencyMs: h.latencyMs,
            }
          : prev
      );
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(null);
    }
  };

  /** Boucle de pas : chaque pas serveur traite un coffre, jusqu'à `done`. */
  const runMigration = async (direction: 'to-byos' | 'to-filarr'): Promise<boolean> => {
    cancelRef.current = false;
    setError(null);
    setOkMsg(null);
    setMigrating({ copied: 0, direction });
    let copied = 0;
    try {
      while (!cancelRef.current) {
        const step = await apiOrgMigrationStep(orgId, direction);
        copied += step.copied;
        setMigrating({ copied, direction });
        if (step.done) {
          setOkMsg(t('org.storage.migrateDone', { count: copied }));
          return true;
        }
      }
      return false;
    } catch (err) {
      setError(mapError(err));
      return false;
    } finally {
      setMigrating(null);
      void refreshMigrationStatus();
    }
  };

  const doPurge = async (force: boolean) => {
    setBusy('delete');
    setError(null);
    try {
      for (let pass = 0; pass < 40; pass++) {
        try {
          const res = await apiOrgMigrationPurgeSource(orgId, 'to-byos', force);
          setOkMsg(t('settings.accountSync.byos.purgeDone', { count: res.deleted }));
          break;
        } catch (err) {
          const code = err instanceof StorageTargetApiError ? err.code : undefined;
          if (code === 'deletion_incomplete') continue;
          throw err;
        }
      }
      await refreshMigrationStatus();
    } catch (err) {
      const code = err instanceof StorageTargetApiError ? err.code : undefined;
      if (code === 'differing_objects') {
        setError(t('org.storage.purgeDiffering'));
      } else if (code === 'not_verified') {
        setError(
          t('settings.accountSync.byos.purgeNotVerified', { count: migrationStatus?.missing ?? 0 })
        );
      } else {
        setError(mapError(err));
      }
    } finally {
      setBusy(null);
    }
  };

  const backCopyThenSwitch = async () => {
    setBackOpen(false);
    const complete = await runMigration('to-filarr');
    if (complete) await onDelete();
  };

  const canConfigure = !!target?.canConfigure;
  const healthLine = (() => {
    if (!isByos(target)) return null;
    if (target.lastCheckAt == null) return t('settings.accountSync.byos.healthNever');
    const when = new Date(target.lastCheckAt).toLocaleString();
    const base = target.lastCheckOk
      ? t('settings.accountSync.byos.healthOk', { when })
      : t('settings.accountSync.byos.healthFail', { when, count: target.consecutiveFailures ?? 1 });
    return target.lastCheckLatencyMs != null
      ? `${base} · ${t('settings.accountSync.byos.healthLatency', { ms: target.lastCheckLatencyMs })}`
      : base;
  })();

  const statusDotClass = !isByos(target)
    ? 'bg-[var(--color-text-tertiary)]'
    : target.status === 'disabled' || target.lastCheckOk === false
      ? 'bg-[var(--color-error-500)]'
      : target.status === 'grace'
        ? 'bg-[var(--color-warning-500)]'
        : 'bg-[var(--color-success-500)]';

  return (
    <AdminSection title={t('org.storage.title')}>
      <p className="text-xs mt-0 mb-3 text-[var(--color-text-tertiary)]">{t('org.storage.desc')}</p>

      {loading ? (
        <p className="text-xs text-[var(--color-text-tertiary)]">
          {t('settings.accountSync.byos.loading')}
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${statusDotClass}`} />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {isByos(target)
                  ? `${presets.find((p) => p.provider === target.provider)?.label ?? target.provider} · ${target.bucket}`
                  : t('org.storage.filarrCloud')}
              </span>
              {isByos(target) && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  {target.status === 'grace'
                    ? t('settings.accountSync.byos.statusGrace')
                    : target.status === 'disabled'
                      ? t('settings.accountSync.byos.statusDisabled')
                      : t('settings.accountSync.byos.statusActive')}
                </span>
              )}
            </div>
            {isByos(target) && (
              <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                {target.endpoint} · {target.accessKeyIdLast4}
              </p>
            )}
            {isByos(target) && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                <p
                  className={`text-xs m-0 ${target.lastCheckOk === false ? 'text-[var(--color-error-500)]' : 'text-[var(--color-text-secondary)]'}`}
                  role="status"
                >
                  {healthLine}
                </p>
                <Button size="sm" variant="ghost" loading={busy === 'check'} onClick={onCheck}>
                  {t('settings.accountSync.byos.checkNow')}
                </Button>
              </div>
            )}
          </div>

          {!canConfigure && !isByos(target) ? (
            <InfoCallout tone="info">{t('org.storage.upgradeRequired')}</InfoCallout>
          ) : (
            <>
              {!showForm && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canConfigure && (
                    <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
                      {isByos(target)
                        ? t('settings.accountSync.byos.edit')
                        : t('org.storage.useOwn')}
                    </Button>
                  )}
                  {isByos(target) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === 'delete'}
                      disabled={migrating !== null}
                      onClick={() => setBackOpen(true)}
                    >
                      {t('settings.accountSync.byos.backToFilarr')}
                    </Button>
                  )}
                </div>
              )}

              {!showForm && isByos(target) && migrationStatus && (
                <div className="mt-4 rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-2">
                  <p className="text-sm font-medium m-0 text-[var(--color-text-primary)]">
                    {t('org.storage.migrateTitle')}
                  </p>
                  {migrating ? (
                    <>
                      <ProgressBar
                        size="sm"
                        indeterminate
                        label={t('org.storage.migrateRunning', { copied: migrating.copied })}
                      />
                      <div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => (cancelRef.current = true)}
                        >
                          {t('settings.accountSync.byos.migrateCancel')}
                        </Button>
                      </div>
                    </>
                  ) : migrationStatus.remaining > 0 ? (
                    <>
                      <p className="text-xs m-0 text-[var(--color-text-secondary)]">
                        {t('org.storage.migrateNeeded', {
                          count: migrationStatus.remaining,
                          size: formatBytes(migrationStatus.remainingBytes),
                          vaults: migrationStatus.vaults,
                        })}
                      </p>
                      <div>
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy !== null}
                          onClick={() => void runMigration('to-byos')}
                        >
                          {t('settings.accountSync.byos.migrateStart')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-xs m-0 text-[var(--color-text-secondary)]" role="status">
                        {t('settings.accountSync.byos.migrateNothing')}
                      </p>
                      {migrationStatus.total > 0 && (
                        <div>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === 'delete'}
                            onClick={() => setPurgeOpen(true)}
                          >
                            {t('settings.accountSync.byos.purgeButton')}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {showForm && canConfigure && (
                <div className="mt-3 flex flex-col gap-3">
                  <Select
                    label={t('settings.accountSync.byos.provider')}
                    value={provider}
                    options={presets.map((p) => ({ value: p.provider, label: p.label }))}
                    onChange={(v) => {
                      const next = (Array.isArray(v) ? v[0] : v) as StorageProvider;
                      const p = presets.find((x) => x.provider === next);
                      if (p) applyPreset(p);
                      else setProvider(next);
                    }}
                  />
                  <Input
                    label={t('settings.accountSync.byos.endpoint')}
                    helperText={preset?.endpointHint}
                    value={endpoint}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setEndpoint(e.target.value)
                    }
                    autoComplete="off"
                    fullWidth
                  />
                  <Input
                    label={t('settings.accountSync.byos.region')}
                    value={region}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegion(e.target.value)}
                    autoComplete="off"
                    fullWidth
                  />
                  <Input
                    label={t('settings.accountSync.byos.bucket')}
                    value={bucket}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBucket(e.target.value)}
                    autoComplete="off"
                    fullWidth
                  />
                  <Select
                    label={t('settings.accountSync.byos.addressing')}
                    value={addressing}
                    options={[
                      { value: 'path', label: t('settings.accountSync.byos.addressingPath') },
                      {
                        value: 'virtual-hosted',
                        label: t('settings.accountSync.byos.addressingVirtual'),
                      },
                    ]}
                    onChange={(v) =>
                      setAddressing((Array.isArray(v) ? v[0] : v) as StorageAddressing)
                    }
                  />
                  {iamRecipe && (
                    <div className="rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-2">
                      <p className="text-xs font-medium m-0 text-[var(--color-text-primary)]">
                        {t('settings.accountSync.byos.iamTitle')}
                      </p>
                      <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                        {t(`settings.accountSync.byos.${iamRecipe.noteKey}`)}
                      </p>
                      {iamRecipe.content && (
                        <>
                          <pre className="text-[11px] m-0 p-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-border)] overflow-x-auto whitespace-pre">
                            {iamRecipe.content}
                          </pre>
                          <div>
                            <Button
                              size="sm"
                              variant="tertiary"
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(iamRecipe.content ?? '');
                                  setIamCopied(true);
                                  window.setTimeout(() => setIamCopied(false), 2000);
                                } catch {
                                  setIamCopied(false);
                                }
                              }}
                            >
                              {iamCopied
                                ? t('settings.accountSync.byos.iamCopied')
                                : t('settings.accountSync.byos.iamCopy')}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <Input
                    label={t('settings.accountSync.byos.accessKey')}
                    value={accessKeyId}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setAccessKeyId(e.target.value)
                    }
                    autoComplete="off"
                    fullWidth
                  />
                  <Input
                    type="password"
                    label={t('settings.accountSync.byos.secretKey')}
                    value={secretAccessKey}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setSecretAccessKey(e.target.value)
                    }
                    autoComplete="new-password"
                    fullWidth
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={busy === 'test'}
                      onClick={onTest}
                    >
                      {t('settings.accountSync.byos.test')}
                    </Button>
                    <Button size="sm" variant="primary" loading={busy === 'save'} onClick={onSave}>
                      {t('settings.accountSync.byos.save')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && (
        <p className="text-xs mt-2 text-[var(--color-error-500)]" role="alert">
          {error}
        </p>
      )}
      {okMsg && !error && (
        <p className="text-xs mt-2 text-[var(--color-text-secondary)]" role="status">
          {okMsg}
        </p>
      )}

      <ConfirmModal
        isOpen={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => {
          setPurgeOpen(false);
          void doPurge(false);
        }}
        title={t('settings.accountSync.byos.purgeTitle')}
        message={t('org.storage.purgeConfirm')}
        confirmText={t('settings.accountSync.byos.purgeButton')}
        cancelText={t('common.cancel')}
        variant="danger"
      />
      <ConfirmModal
        isOpen={backOpen}
        onClose={() => setBackOpen(false)}
        onConfirm={() => void backCopyThenSwitch()}
        title={t('settings.accountSync.byos.backTitle')}
        message={t('org.storage.backConfirm')}
        confirmText={t('settings.accountSync.byos.backCopyFirst')}
        cancelText={t('common.cancel')}
      />
    </AdminSection>
  );
};

export default OrgStorageSection;
export { OrgStorageSection };
