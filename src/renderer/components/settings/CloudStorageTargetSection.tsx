/**
 * BYOS — cible S3 perso, dans Compte & Synchronisation.
 * v1 : configuration depuis Filarr Desktop (CSP web inchangée).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../../../store';
import { buildIamRecipe } from '../../../services/storage/iamPolicy';
import { isWebPlatform } from '../../../services/platform/isWebPlatform';
import {
  Button,
  Input,
  Select,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ProgressBar,
  ConfirmModal,
} from '../ui';
import {
  checkStorageTarget,
  deleteStorageTarget,
  fetchMigrationStatus,
  fetchStoragePresets,
  fetchStorageInventory,
  fetchStorageTarget,
  purgeMigrationSource,
  runMigrationStep,
  saveStorageTarget,
  testStorageTarget,
  StorageTargetApiError,
  type MigrationDirection,
  type MigrationStatusDto,
  type StorageAddressing,
  type StoragePreset,
  type StorageProvider,
  type StorageTargetByos,
  type StorageLocality,
  type StorageTargetDto,
  type StorageTargetInput,
} from '../../../services/storage/storageTargetApi';

function isByos(dto: StorageTargetDto | null): dto is StorageTargetByos {
  return !!dto && dto.mode === 'byos';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  const units = ['Kio', 'Mio', 'Gio', 'Tio'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** État d'une copie serveur-à-serveur en cours (voir storage-migration.ts). */
interface MigrationRun {
  phase: 'idle' | 'running' | 'done' | 'error';
  direction: MigrationDirection;
  copied: number;
  total: number;
}

const MIGRATION_IDLE: MigrationRun = { phase: 'idle', direction: 'to-byos', copied: 0, total: 0 };

/**
 * v2 : le parcours COMPLET vit aussi sur app.filarr.com. Config, test, santé
 * et migration ne sont que des appels à api.filarr.com ; le plan de données
 * passe par le relais du Worker (le navigateur ne parle jamais à S3, la CSP
 * web n'a pas bougé d'un octet).
 */
const CloudStorageTargetSection: React.FC = () => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<StorageTargetDto | null>(null);
  /**
   * La PORTÉE regardée : la cible par défaut du COMPTE, ou la surcharge du
   * PROFIL ACTIF (Lot 15 — un bucket par profil). Les appels portent tous la
   * même portée ; 'account' n'envoie rien (compatible d'avant la migration 0084).
   */
  const [scope, setScope] = useState<'account' | 'profile'>('account');
  /**
   * Le droit vient du SERVEUR (`canUsePersonalByos`), pas du tier personnel.
   * Un porteur de siège Teams/Enterprise reste `free` côté perso : l'écran lui
   * proposait « Passez à Pro » alors que l'API l'aurait laissé passer.
   */
  const [canConfigure, setCanConfigure] = useState(false);
  const [presets, setPresets] = useState<StoragePreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'save' | 'delete' | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const [provider, setProvider] = useState<StorageProvider>('r2');
  /**
   * Magasin sur le RÉSEAU de l'utilisateur (NAS, MinIO, Garage) ou endpoint
   * public. Ce n'est pas une préférence d'affichage : la localité décide de qui
   * parle au magasin (le serveur, ou ce poste), donc de ce qui est possible.
   */
  const [locality, setLocality] = useState<StorageLocality>('public');
  /*
    LE NAVIGATEUR NE PEUT PAS JOINDRE UN MAGASIN LOCAL — ON NE LE PROPOSE DONC PAS.

    Ce n'est pas une restriction de politique, c'est une impossibilite technique :
    une page servie en https ne peut pas appeler un endpoint en clair, et un NAS
    domestique n'a pas de certificat ni de CORS. Laisser l'option visible sur le
    web permettrait de configurer une cible que CE client ne pourra jamais
    utiliser — et comme la cible est un reglage de COMPTE, il casserait aussi sa
    propre synchro depuis le navigateur sans comprendre pourquoi.

    Le bureau garde l'option. Voir la fiche 2026-09-06-byos-local-nas-minio,
    section « divergences assumees ».
  */
  const localiteDisponible = !isWebPlatform();
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('auto');
  const [bucket, setBucket] = useState('');
  const [addressing, setAddressing] = useState<StorageAddressing>('path');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [showForm, setShowForm] = useState(false);

  // Santé + migration (desktop seulement : le web n'a pas le droit d'écrire).
  const [checking, setChecking] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatusDto | null>(null);
  const [migration, setMigration] = useState<MigrationRun>(MIGRATION_IDLE);
  const cancelRef = useRef(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDifferingCount, setPurgeDifferingCount] = useState<number | null>(null);
  const [backOpen, setBackOpen] = useState(false);

  const preset = useMemo(() => presets.find((p) => p.provider === provider), [presets, provider]);

  // La recette de clé IAM, bornée au préfixe users/<id>/ — contre le réflexe
  // « je colle ma clé root » (voir services/storage/iamPolicy.ts).
  const cloudUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const activeProfileId = useSelector((s: RootState) => s.profiles.activeProfileId);
  const activeProfileName = useSelector(
    (s: RootState) =>
      s.profiles.manifest?.profiles.find((p) => p.id === s.profiles.activeProfileId)?.name ?? null
  );
  /** '' côté requête = compte ; l'identifiant du profil sinon. */
  const scopeProfileId = scope === 'profile' && activeProfileId ? activeProfileId : undefined;
  const iamRecipe = useMemo(
    () => buildIamRecipe(provider, bucket.trim(), cloudUserId),
    [provider, bucket, cloudUserId]
  );
  const [iamCopied, setIamCopied] = useState(false);
  const copyIam = async () => {
    if (!iamRecipe?.content) return;
    try {
      await navigator.clipboard.writeText(iamRecipe.content);
      setIamCopied(true);
      window.setTimeout(() => setIamCopied(false), 2000);
    } catch {
      setIamCopied(false);
    }
  };

  const mapError = useCallback(
    (err: unknown): string => {
      const code = err instanceof StorageTargetApiError ? err.code : undefined;
      if (code === 'upgrade_required') return t('settings.accountSync.byos.upgradeRequired');
      if (code === 'subscription_inactive') return t('settings.accountSync.byos.inactive');
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

  const hydrateFromTarget = useCallback(
    (dto: StorageTargetDto, list: StoragePreset[]) => {
      setTarget(dto);
      setCanConfigure(!!dto.canConfigure);
      if (dto.mode === 'byos') {
        setProvider(dto.provider);
        setLocality(dto.locality === 'local' ? 'local' : 'public');
        setEndpoint(dto.endpoint);
        setRegion(dto.region);
        setBucket(dto.bucket);
        setAddressing(dto.addressing);
        setShowForm(false);
      } else {
        const r2 = list.find((p) => p.provider === 'r2') ?? list[0];
        if (r2) applyPreset(r2);
        setBucket('');
        setAccessKeyId('');
        setSecretAccessKey('');
        setShowForm(false);
      }
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
          fetchStorageTarget(scopeProfileId),
          fetchStoragePresets(),
        ]);
        if (cancelled) return;
        setPresets(catalog.presets);
        hydrateFromTarget(dto, catalog.presets);
      } catch (err) {
        if (!cancelled) setError(mapError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateFromTarget, mapError, scopeProfileId]);

  const buildInput = (): StorageTargetInput | null => {
    if (!endpoint.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()) {
      setError(t('settings.accountSync.byos.missingFields'));
      return null;
    }
    return {
      provider,
      locality,
      endpoint: endpoint.trim(),
      region: region.trim() || 'auto',
      bucket: bucket.trim(),
      addressing,
      accessKeyId: accessKeyId.trim(),
      secretAccessKey: secretAccessKey,
    };
  };

  const onTest = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy('test');
    setError(null);
    setOkMsg(null);
    try {
      await testStorageTarget(input);
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
      const dto = await saveStorageTarget(input, scopeProfileId);
      setSecretAccessKey('');
      hydrateFromTarget(dto, presets);
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
      const dto = await deleteStorageTarget(scopeProfileId);
      setSecretAccessKey('');
      hydrateFromTarget(dto, presets);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setBusy(null);
    }
  };

  // ── Export de conformité : le JSON signé, remis TEL QUEL (toucher au
  //    document invaliderait sa signature). ──
  const [exporting, setExporting] = useState(false);
  const onExportInventory = async () => {
    setExporting(true);
    setError(null);
    try {
      const inv = await fetchStorageInventory();
      const blob = new Blob([JSON.stringify(inv, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `filarr-storage-inventory-${new Date(inv.generatedAt)
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(mapError(err));
    } finally {
      setExporting(false);
    }
  };

  // ── Santé : sonde avec les identifiants STOCKÉS (aucun secret ne repasse) ──
  const onCheckHealth = async () => {
    setChecking(true);
    setError(null);
    try {
      const h = await checkStorageTarget(scopeProfileId);
      setTarget((prev) =>
        isByos(prev)
          ? {
              ...prev,
              lastCheckAt: h.lastCheckAt,
              lastCheckOk: h.ok,
              consecutiveFailures: h.consecutiveFailures,
              lastCheckLatencyMs: h.latencyMs,
              lastCheckBytes: h.bytes,
              lastCheckObjects: h.objects,
            }
          : prev
      );
    } catch (err) {
      setError(mapError(err));
    } finally {
      setChecking(false);
    }
  };

  // ── Migration : combien reste-t-il à copier ? (lecture seule) ──────────────
  const refreshMigrationStatus = useCallback(async () => {
    try {
      setMigrationStatus(await fetchMigrationStatus('to-byos', scopeProfileId));
    } catch {
      // Un bucket muet rend 503 : l'écran de santé le dit déjà, pas de doublon.
      setMigrationStatus(null);
    }
  }, [scopeProfileId]);

  useEffect(() => {
    if (!isByos(target)) {
      setMigrationStatus(null);
      return;
    }
    void refreshMigrationStatus();
  }, [target, refreshMigrationStatus]);

  /**
   * Boucle de copie : un pas serveur à la fois, jusqu'à `done` ou arrêt. Chaque
   * pas re-liste les deux côtés, donc s'arrêter et reprendre ne perd rien.
   * Retourne true si la copie est allée au bout.
   */
  const runMigration = async (direction: MigrationDirection): Promise<boolean> => {
    cancelRef.current = false;
    setError(null);
    setOkMsg(null);
    setMigration({ phase: 'running', direction, copied: 0, total: 0 });
    let copied = 0;
    try {
      while (!cancelRef.current) {
        const step = await runMigrationStep(direction, scopeProfileId);
        copied += step.copied;
        setMigration({ phase: 'running', direction, copied, total: copied + step.remaining });
        if (step.done) {
          setMigration({ phase: 'done', direction, copied, total: copied });
          return true;
        }
      }
      setMigration({ ...MIGRATION_IDLE, direction });
      return false;
    } catch (err) {
      const code = err instanceof StorageTargetApiError ? err.code : undefined;
      if (code === 'migration_busy') {
        setError(t('settings.accountSync.byos.migrateBusy'));
      } else if (code === 'storage_quota_exceeded') {
        setError(
          t('settings.accountSync.byos.backQuota', {
            size: formatBytes(migrationStatus?.totalBytes ?? 0),
          })
        );
      } else {
        setError(t('settings.accountSync.byos.migrateError', { error: mapError(err) }));
      }
      setMigration({ phase: 'error', direction, copied, total: copied });
      return false;
    } finally {
      void refreshMigrationStatus();
    }
  };

  const cancelMigration = () => {
    cancelRef.current = true;
  };

  // ── Purge de la copie Filarr Cloud, après vérification serveur ─────────────
  const doPurge = async (force: boolean) => {
    setBusy('delete');
    setError(null);
    try {
      // 409 deletion_incomplete = préfixe volumineux, on rappelle.
      for (let pass = 0; pass < 40; pass++) {
        try {
          const res = await purgeMigrationSource('to-byos', force, scopeProfileId);
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
        // Demander explicitement avant de forcer.
        setPurgeDifferingCount(migrationStatus?.differing ?? 0);
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

  // ── Retour à Filarr Cloud : recopier d'abord (recommandé) ou basculer sec ──
  const backCopyThenSwitch = async () => {
    setBackOpen(false);
    const complete = await runMigration('to-filarr');
    // On ne bascule QUE si la recopie est allée au bout : basculer sur une
    // copie partielle laisserait des fichiers invisibles dans le bucket.
    if (complete) await onDelete();
  };

  const backSwitchOnly = async () => {
    setBackOpen(false);
    await onDelete();
  };

  /**
   * La cible ENREGISTRÉE est-elle sur le réseau de l'utilisateur ?
   *
   * On lit `target`, pas l'état `locality` du formulaire : celui-ci suit ce que
   * l'utilisateur est en train de saisir, y compris avant d'enregistrer. Ce qui
   * décide de ce que l'écran affiche, c'est la cible réellement en place.
   */
  const cibleLocale = isByos(target) && target.locality === 'local';

  const healthLine = (() => {
    if (!isByos(target)) return null;
    if (target.lastCheckAt == null) return t('settings.accountSync.byos.healthNever');
    const when = new Date(target.lastCheckAt).toLocaleString();
    return target.lastCheckOk
      ? t('settings.accountSync.byos.healthOk', { when })
      : t('settings.accountSync.byos.healthFail', {
          when,
          count: target.consecutiveFailures ?? 1,
        });
  })();

  // L'inventaire réel (relevé par « Vérifier maintenant ») + la latence de la
  // dernière sonde — le « combien pèse mon bucket, et répond-il vite ? ».
  const healthDetail = (() => {
    if (!isByos(target)) return null;
    const parts: string[] = [];
    if (target.lastCheckObjects != null && target.lastCheckBytes != null) {
      parts.push(
        t('settings.accountSync.byos.healthInventory', {
          objects: target.lastCheckObjects,
          size: formatBytes(target.lastCheckBytes),
        })
      );
    }
    if (target.lastCheckLatencyMs != null) {
      parts.push(t('settings.accountSync.byos.healthLatency', { ms: target.lastCheckLatencyMs }));
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  // Le quota de changements se dit AVANT de mordre (429 cooldown surprise).
  const changesHint = (() => {
    const tc = target?.targetChanges;
    if (!tc) return null;
    if (tc.remaining >= 2) return null; // plein quota : rien à signaler
    return tc.resetAt
      ? t('settings.accountSync.byos.changesLeftReset', {
          count: tc.remaining,
          when: new Date(tc.resetAt).toLocaleDateString(),
        })
      : t('settings.accountSync.byos.changesLeft', { count: tc.remaining });
  })();

  const statusLabel = isByos(target)
    ? target.status === 'grace'
      ? t('settings.accountSync.byos.statusGrace')
      : target.status === 'disabled'
        ? t('settings.accountSync.byos.statusDisabled')
        : t('settings.accountSync.byos.statusActive')
    : t('settings.accountSync.byos.filarrCloud');

  // Pastille d'état : vert = tout va bien, ambre = grâce, rouge = coupé ou
  // bucket muet. Filarr Cloud reste neutre — il n'y a rien à surveiller.
  const statusDotClass = !isByos(target)
    ? 'bg-[var(--color-text-tertiary)]'
    : target.status === 'disabled' || target.lastCheckOk === false
      ? 'bg-[var(--color-error-500)]'
      : target.status === 'grace'
        ? 'bg-[var(--color-warning-500)]'
        : 'bg-[var(--color-success-500)]';

  const providerLabel = isByos(target)
    ? (presets.find((p) => p.provider === target.provider)?.label ?? target.provider)
    : null;

  return (
    <div className="px-6 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {t('settings.accountSync.byos.title')}
          </p>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
            {t('settings.accountSync.byos.desc')}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          {/* Export de conformité : le document « où vivent mes octets »,
              signé par le serveur, téléchargé en JSON. */}
          <button
            type="button"
            className="text-xs font-medium text-[var(--color-link)] hover:underline"
            onClick={() => void onExportInventory()}
            disabled={exporting}
          >
            {exporting
              ? t('settings.accountSync.byos.inventoryExporting')
              : t('settings.accountSync.byos.inventoryExport')}
          </button>
          <button
            type="button"
            className="text-xs font-medium text-[var(--color-link)] hover:underline"
            onClick={() => setGuideOpen(true)}
          >
            {t('settings.accountSync.byos.guideOpen')}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-[var(--color-text-tertiary)] mt-3">
          {t('settings.accountSync.byos.loading')}
        </p>
      ) : (
        <>
          {/* Portée : la cible du COMPTE, ou la surcharge du profil actif. */}
          {canConfigure && activeProfileId && (
            <div
              className="mt-3 inline-flex rounded-lg border border-[var(--color-border)] p-0.5"
              role="tablist"
              aria-label={t('settings.accountSync.byos.scopeLabel')}
            >
              {(['account', 'profile'] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  role="tab"
                  aria-selected={scope === sc}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    scope === sc
                      ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
                      : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
                  }`}
                  onClick={() => setScope(sc)}
                >
                  {sc === 'account'
                    ? t('settings.accountSync.byos.scopeAccount')
                    : t('settings.accountSync.byos.scopeProfile', {
                        name: activeProfileName ?? '',
                      })}
                </button>
              ))}
            </div>
          )}

          {/* Carte d'état : où vivent les octets, en un coup d'œil. */}
          <div className="mt-3 rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span aria-hidden className={`inline-block w-2 h-2 rounded-full ${statusDotClass}`} />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {isByos(target)
                  ? `${providerLabel} · ${target.bucket}`
                  : t('settings.accountSync.byos.filarrCloud')}
              </span>
              {isByos(target) && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                  {statusLabel}
                </span>
              )}
              {/* Vue profil, cible du compte : dire l'héritage, sinon l'écran
                  laisse croire que ce profil a SA cible. */}
              {isByos(target) && scope === 'profile' && target.inherited && (
                <span className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)]">
                  {t('settings.accountSync.byos.scopeInherited')}
                </span>
              )}
            </div>
            {isByos(target) && (
              <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                {target.endpoint} · {target.accessKeyIdLast4}
              </p>
            )}
            {isByos(target) && (
              <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                {t('settings.accountSync.byos.quotaNote')}
              </p>
            )}
            {scope === 'account' && (target?.profileOverrides?.length ?? 0) > 0 && (
              <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                {t('settings.accountSync.byos.scopeOverridesNote', {
                  count: target?.profileOverrides?.length ?? 0,
                })}
              </p>
            )}
            {/* Magasin local : nos serveurs ne le joignent pas, donc il n'y a
                RIEN à surveiller. Afficher une santé vide (« jamais vérifié »)
                et un bouton qui ne peut pas aboutir se lirait comme une panne
                permanente — on dit l'absence à la place. */}
            {cibleLocale && (
              <p
                className="text-xs m-0 pt-1 border-t border-[var(--color-border)] text-[var(--color-text-secondary)]"
                role="status"
              >
                {t('settings.accountSync.byos.localNoticeNoProbe')}
              </p>
            )}
            {/* Santé : ce que le cron a vu en dernier, et une sonde à la demande. */}
            {isByos(target) && !cibleLocale && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[var(--color-border)]">
                <p
                  className={`text-xs m-0 ${
                    target.lastCheckOk === false
                      ? 'text-[var(--color-error-500)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                  role="status"
                >
                  {healthLine}
                  {healthDetail && (
                    <span className="text-[var(--color-text-tertiary)]"> · {healthDetail}</span>
                  )}
                </p>
                <Button size="sm" variant="tertiary" loading={checking} onClick={onCheckHealth}>
                  {t('settings.accountSync.byos.healthCheckNow')}
                </Button>
              </div>
            )}
          </div>

          {changesHint && (
            <p className="text-xs mt-2 m-0 text-[var(--color-warning-600)]" role="status">
              {changesHint}
            </p>
          )}

          {!canConfigure && !isByos(target) ? (
            <p className="text-xs mt-3 text-[var(--color-text-secondary)]">
              {t('settings.accountSync.byos.upgradeCta')}
            </p>
          ) : (
            <>
              {!showForm && (canConfigure || isByos(target)) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canConfigure && (
                    <Button size="sm" variant="secondary" onClick={() => setShowForm(true)}>
                      {isByos(target)
                        ? t('settings.accountSync.byos.edit')
                        : t('settings.accountSync.byos.useOwn')}
                    </Button>
                  )}
                  {isByos(target) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === 'delete'}
                      disabled={migration.phase === 'running'}
                      onClick={() => setBackOpen(true)}
                    >
                      {t('settings.accountSync.byos.backToFilarr')}
                    </Button>
                  )}
                </div>
              )}

              {/* Migration : ce qui dort encore sur Filarr Cloud, et le bouton pour le rapatrier. */}
              {/* Migration : impossible en local — la copie est serveur-à-serveur
                  et une extrémité est hors de portée. Le serveur refuse déjà
                  (`local_target_no_migration`) ; ne pas proposer le geste vaut
                  mieux que de le faire échouer. */}
              {cibleLocale && !showForm && (
                <p className="text-xs m-0 text-[var(--color-text-secondary)]" role="status">
                  {t('settings.accountSync.byos.localNoticeNoMigration')}
                </p>
              )}
              {!showForm && !cibleLocale && isByos(target) && migrationStatus && (
                <div className="mt-4 rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-2">
                  <p className="text-sm font-medium m-0 text-[var(--color-text-primary)]">
                    {t('settings.accountSync.byos.migrateTitle')}
                  </p>
                  {migration.phase === 'running' ? (
                    <>
                      <ProgressBar
                        size="sm"
                        value={migration.total > 0 ? (migration.copied / migration.total) * 100 : 0}
                        indeterminate={migration.total === 0}
                        label={t(
                          migration.direction === 'to-filarr'
                            ? 'settings.accountSync.byos.backRunning'
                            : 'settings.accountSync.byos.migrateRunning',
                          { copied: migration.copied, total: migration.total }
                        )}
                      />
                      <div>
                        <Button size="sm" variant="ghost" onClick={cancelMigration}>
                          {t('settings.accountSync.byos.migrateCancel')}
                        </Button>
                      </div>
                    </>
                  ) : migrationStatus.remaining > 0 ? (
                    <>
                      <p className="text-xs m-0 text-[var(--color-text-secondary)]">
                        {t('settings.accountSync.byos.migrateNeeded', {
                          count: migrationStatus.remaining,
                          size: formatBytes(migrationStatus.remainingBytes),
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
                        {migration.phase === 'done' && migration.direction === 'to-byos'
                          ? t('settings.accountSync.byos.migrateDone', { count: migration.copied })
                          : t('settings.accountSync.byos.migrateNothing')}
                      </p>
                      {migrationStatus.total > 0 && (
                        <>
                          <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                            {t('settings.accountSync.byos.purgeDesc')}
                          </p>
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
                        </>
                      )}
                    </>
                  )}
                  <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                    {t('settings.accountSync.byos.migrateHow')}
                  </p>
                </div>
              )}

              {showForm && canConfigure && (
                <div className="mt-3 flex flex-col gap-3">
                  {localiteDisponible && (
                    <Select
                      label={t('settings.accountSync.byos.locality')}
                      value={locality}
                      options={[
                        {
                          value: 'public',
                          label: t('settings.accountSync.byos.localityPublic'),
                        },
                        { value: 'local', label: t('settings.accountSync.byos.localityLocal') },
                      ]}
                      onChange={(v) => {
                        const next = (Array.isArray(v) ? v[0] : v) as StorageLocality;
                        setLocality(next);
                        // Un preset public (S3, R2, Wasabi…) impose un suffixe de
                        // domaine Internet qu'aucune adresse privée ne satisfait :
                        // le serveur refuserait la cible. `custom` est le seul
                        // fournisseur cohérent avec un magasin local, on l'aligne
                        // plutôt que de laisser l'utilisateur buter dessus.
                        if (next === 'local' && provider !== 'custom') {
                          const custom = presets.find((x) => x.provider === 'custom');
                          if (custom) applyPreset(custom);
                          else setProvider('custom');
                        }
                      }}
                    />
                  )}
                  {locality === 'local' && (
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{
                        backgroundColor: 'var(--color-surface-alt)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <p className="font-medium" style={{ color: 'var(--color-text-primary)' }}>
                        {t('settings.accountSync.byos.localNoticeTitle')}
                      </p>
                      <ul
                        className="mt-2 list-disc pl-5 flex flex-col gap-1"
                        style={{ color: 'var(--color-text-secondary)' }}
                      >
                        {/* Ces trois lignes ne sont pas décoratives : chacune
                            annonce une capacité ABSENTE, qui sans cela se
                            lirait comme une panne (voir la fiche de parité
                            2026-09-06-byos-local-nas-minio). */}
                        <li>{t('settings.accountSync.byos.localNoticeNoProbe')}</li>
                        <li>{t('settings.accountSync.byos.localNoticeNoMigration')}</li>
                        <li>{t('settings.accountSync.byos.localNoticeCleartext')}</li>
                      </ul>
                      <p className="mt-2 font-medium" style={{ color: 'var(--color-warning-600)' }}>
                        {t('settings.accountSync.byos.localNoticeScopedKey')}
                      </p>
                    </div>
                  )}
                  {(locality === 'public' || !localiteDisponible) && (
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
                  )}
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
                            <Button size="sm" variant="tertiary" onClick={copyIam}>
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
                  {isByos(target) && (
                    <p className="text-xs m-0 text-[var(--color-text-tertiary)]">
                      {t('settings.accountSync.byos.keyRotationHint')}
                    </p>
                  )}
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

      {/* Purge de la copie Filarr Cloud : deux confirmations, la seconde seulement
          si le serveur signale des objets qui diffèrent (réécrits dans le bucket). */}
      <ConfirmModal
        isOpen={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        onConfirm={() => {
          setPurgeOpen(false);
          void doPurge(false);
        }}
        title={t('settings.accountSync.byos.purgeTitle')}
        message={t('settings.accountSync.byos.purgeConfirm')}
        confirmText={t('settings.accountSync.byos.purgeButton')}
        cancelText={t('common.cancel')}
        variant="danger"
      />
      <ConfirmModal
        isOpen={purgeDifferingCount !== null}
        onClose={() => setPurgeDifferingCount(null)}
        onConfirm={() => {
          setPurgeDifferingCount(null);
          void doPurge(true);
        }}
        title={t('settings.accountSync.byos.purgeTitle')}
        message={t('settings.accountSync.byos.purgeDiffering', { count: purgeDifferingCount ?? 0 })}
        confirmText={t('settings.accountSync.byos.purgeButton')}
        cancelText={t('common.cancel')}
        variant="danger"
      />
      {/* Retour à Filarr Cloud : recopier puis basculer (recommandé), ou basculer sec. */}
      <ConfirmModal
        isOpen={backOpen}
        onClose={() => setBackOpen(false)}
        onConfirm={() => void backCopyThenSwitch()}
        title={t('settings.accountSync.byos.backTitle')}
        message={`${t('settings.accountSync.byos.backChoose')} ${t(
          'settings.accountSync.byos.backCopy'
        )} — ${t('settings.accountSync.byos.backCopyDesc')} ${t(
          'settings.accountSync.byos.backLeave'
        )} — ${t('settings.accountSync.byos.backLeaveDesc')}`}
        confirmText={t('settings.accountSync.byos.backCopy')}
        cancelText={t('common.cancel')}
        variant="warning"
        extraActions={[
          { label: t('settings.accountSync.byos.backLeave'), onClick: () => void backSwitchOnly() },
        ]}
      />

      <Modal isOpen={guideOpen} onClose={() => setGuideOpen(false)} size="lg">
        <ModalHeader onClose={() => setGuideOpen(false)}>
          {t('settings.accountSync.byos.guideTitle')}
        </ModalHeader>
        <ModalBody>
          {/* Un guide STRUCTURÉ, pas un mur de paragraphes : l'essentiel encadré,
              des étapes numérotées qu'on peut suivre du doigt, l'échec à la fin. */}
          <div className="flex flex-col gap-4 text-sm text-[var(--color-text-secondary)]">
            <p className="m-0 leading-relaxed">{t('settings.accountSync.byos.guideIntro')}</p>

            <div className="rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-1.5 text-xs leading-relaxed">
              <p className="m-0">{t('settings.accountSync.byos.guidePlans')}</p>
              <p className="m-0">{t('settings.accountSync.byos.guideWhere')}</p>
              <p className="m-0">{t('settings.accountSync.byos.guideNotApi')}</p>
            </div>

            <div>
              <p className="m-0 mb-2 font-medium text-[var(--color-text-primary)]">
                {t('settings.accountSync.byos.guideStepsTitle')}
              </p>
              <ol className="m-0 p-0 list-none flex flex-col gap-2">
                {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => (
                  <li key={n} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className="shrink-0 w-5 h-5 mt-px rounded-full border border-[var(--color-border)] text-[10px] font-semibold flex items-center justify-center text-[var(--color-text-secondary)]"
                    >
                      {n}
                    </span>
                    <span className="text-xs leading-relaxed">
                      {t(`settings.accountSync.byos.guideStep${n}`)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-1.5 text-xs leading-relaxed">
              <p className="m-0">{t('settings.accountSync.byos.guideLimits')}</p>
              <p className="m-0">{t('settings.accountSync.byos.guideLapse')}</p>
              <p className="m-0">{t('settings.accountSync.byos.guideNoCors')}</p>
            </div>

            <div>
              <p className="m-0 mb-1.5 font-medium text-[var(--color-text-primary)]">
                {t('settings.accountSync.byos.guideFailTitle')}
              </p>
              <ul className="m-0 pl-4 list-disc flex flex-col gap-1 text-xs leading-relaxed">
                <li>{t('settings.accountSync.byos.guideFailUnreachable')}</li>
                <li>{t('settings.accountSync.byos.guideFailEndpoint')}</li>
                <li>{t('settings.accountSync.byos.guideFailPlan')}</li>
              </ul>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="primary" onClick={() => setGuideOpen(false)}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};

export default CloudStorageTargetSection;
