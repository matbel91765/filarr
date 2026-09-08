/**
 * PluginDetailPanel — la fiche d'une extension.
 *
 * ── POURQUOI ELLE N'EXISTAIT PAS ────────────────────────────────────────────
 *
 * Le thunk `fetchMarketplacePluginDetail` et le dictionnaire `detailBySlug`
 * étaient déjà dans le slice — et AUCUN écran ne les appelait. Toute la
 * connaissance d'une extension (ses versions, leur taille, leur date, les octets
 * signés) était donc téléchargeable et jamais montrée. On installait un objet
 * dont on ne pouvait rien savoir.
 *
 * ── L'ORDRE DE LA FICHE ─────────────────────────────────────────────────────
 *
 *   1. CE QU'ELLE FAIT       — les types de fichiers qu'elle ouvre ;
 *   2. CE QU'ELLE NE PEUT PAS FAIRE — les limites du bac à sable, en clair ;
 *   3. QUI L'A SIGNÉE        — en français, l'empreinte repliée dessous ;
 *   4. LES VERSIONS          — taille, date, celle qui est installée ;
 *   5. LE RESTE              — signaler, dépublier.
 *
 * Les métadonnées viennent APRÈS les capacités, jamais avant : un numéro de
 * version ne dit pas à quoi sert un outil.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import { fetchMarketplacePluginDetail } from '../../../store/slices/marketplaceSlice';
import {
  clampIcon,
  compareSemver,
  normalizeCategory,
} from '../../../services/plugins/marketplaceTypes';
import { getAppVersion } from '../../../services/platform/appVersion';
import {
  appVersionSatisfies,
  extensionConflicts,
  readCapabilities,
  readPreviews,
} from './capabilities';
import { DetailTopBar } from './DetailTopBar';
import { ShotLightbox } from './ShotLightbox';
import { formatBytes, formatDate } from './marketplaceFormat';
import { catalogEntryState } from './entryState';
import { describePublisher } from './trustModel';
import { EntryBadge, CapabilityList } from './EntryBadge';
import { TrustLine, FingerprintDisclosure } from './TrustLine';
import { Notice, ListSkeleton } from './MarketplaceNotices';
import { BlockedGlyph, CheckGlyph, OfflineGlyph, ShieldAlertGlyph, WarnGlyph } from './icons';
import './marketplace.css';

export interface PluginDetailPanelProps {
  slug: string;
  online: boolean;
  ownFingerprint: string | null;
  busy: boolean;
  canInstall: boolean;
  onClose: () => void;
  onInstall: (slug: string, version: string) => void;
  onUninstall: (slug: string) => void;
  onToggle: (slug: string, enabled: boolean) => void;
  onReport: (slug: string) => void;
  onUnlist: (slug: string) => void;
}

export const PluginDetailPanel: React.FC<PluginDetailPanelProps> = ({
  slug,
  online,
  ownFingerprint,
  busy,
  canInstall,
  onClose,
  onInstall,
  onUninstall,
  onToggle,
  onReport,
  onUnlist,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const detail = useSelector((s: RootState) => s.marketplace.detailBySlug[slug]);
  const summary = useSelector((s: RootState) => s.marketplace.catalog.find((p) => p.slug === slug));
  const installed = useSelector((s: RootState) => s.marketplace.installed);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  /** L'image montrée en grand — un INDICE, jamais l'URL : voir `ShotLightbox`. */
  const [shotIndex, setShotIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);

  /**
   * Changer de fiche remet la galerie à zéro. Sans cela, ouvrir une extension à
   * une image après en avoir lu une à quatre laisserait un indice hors bornes —
   * et, pire, une visionneuse ouverte sur la capture d'une autre extension.
   */
  useEffect(() => {
    setShotIndex(0);
    setZoomed(false);
  }, [slug]);

  /**
   * Le statut ne parle QUE de la requête en cours ; il ne prétend pas savoir si
   * un contenu est déjà là. C'est le rendu qui croise les deux (`status` ET
   * `detail`), et c'est ce qui permet à une fiche déjà lue de rester à l'écran
   * pendant un rafraîchissement — ou après son échec — au lieu de se vider.
   *
   * Écrit ainsi, `load` ne dépend que de `dispatch` et du slug : le mettre à
   * dépendre de `detail`, qui change à chaque chargement réussi, aurait fabriqué
   * une boucle de requêtes.
   */
  const load = useCallback(() => {
    setStatus('loading');
    void dispatch(fetchMarketplacePluginDetail(slug))
      .unwrap()
      .then(() => setStatus('ready'))
      .catch(() => setStatus('error'));
  }, [dispatch, slug]);

  useEffect(() => {
    load();
  }, [load]);

  const mine = installed.find((p) => p.slug === slug);
  /** La fiche vit même sans ligne de catalogue (extension dépubliée, hors ligne). */
  const name = summary?.name ?? detail?.name ?? mine?.name ?? slug;
  const description = summary?.description ?? detail?.description ?? '';
  const icon = clampIcon(summary?.icon ?? detail?.icon);
  const latestVersion =
    summary?.latestVersion ?? detail?.latestVersion ?? mine?.installedVersion ?? null;

  /** Les versions, de la plus récente à la plus ancienne. */
  const versions = useMemo(() => {
    const rows = detail?.versions ?? [];
    return rows.slice().sort((a, b) => compareSemver(b.version, a.version));
  }, [detail]);

  const newest = versions[0] ?? null;
  const capabilities = useMemo(() => readCapabilities(newest?.manifestJson), [newest]);

  /**
   * LES CAPTURES, lues dans le manifeste de la version la plus récente.
   *
   * Elles voyagent DANS les octets signés — donc elles ne peuvent pas être
   * changées après coup sans casser la signature. Mais elles sont lues ICI
   * avant toute vérification (on ouvre une fiche sans installer) : `readPreviews`
   * refait donc la validation de forme sur chaque image. Voir son en-tête.
   */
  const shots = useMemo(() => readPreviews(newest?.manifestJson), [newest]);
  const shotIndexSafe = shots.length > 0 ? Math.min(shotIndex, shots.length - 1) : 0;
  const conflicts = useMemo(
    () => extensionConflicts(capabilities.extensions, slug),
    [capabilities.extensions, slug]
  );
  const appOk = appVersionSatisfies(capabilities.minAppVersion, getAppVersion());

  const fingerprint = summary?.publisherFingerprint ?? mine?.publisherFingerprint ?? '';
  const trust = useMemo(
    () => describePublisher(fingerprint, ownFingerprint, installed, slug),
    [fingerprint, ownFingerprint, installed, slug]
  );
  const verdict = catalogEntryState(latestVersion ?? mine?.installedVersion ?? '0.0.0', mine);
  const ownedByMe = summary?.ownedByMe === true;

  const primaryLabel =
    verdict.state === 'available'
      ? t('marketplace.install')
      : verdict.state === 'update'
        ? t('marketplace.update')
        : verdict.state === 'broken'
          ? t('marketplace.action.repair')
          : null;

  return (
    <>
      <DetailTopBar
        backLabel={t('marketplace.detail.back')}
        crumb={t('marketplace.kinds.extensions.label')}
        onBack={onClose}
      />
      <div className="mkt-ldetail__scroll">
        <div className="mkt-detail">
          {/* ── L'EN-TÊTE : les captures, et l'identité à côté ── */}
          <div className="mkt-ldetail__hero">
            <div className="mkt-ldetail__gallery">
              {shots.length > 0 ? (
                <>
                  <button
                    type="button"
                    className="mkt-ldetail__shot"
                    onClick={() => setZoomed(true)}
                    aria-label={t('marketplace.gallery.open', {
                      name,
                      defaultValue: 'Agrandir les captures de {{name}}',
                    })}
                  >
                    <img src={shots[shotIndexSafe]} alt="" />
                    <span className="mkt-ldetail__zoom">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {t('marketplace.gallery.zoom', 'Agrandir')}
                    </span>
                  </button>
                  {shots.length > 1 && (
                    <div className="mkt-ldetail__thumbs">
                      {shots.map((image, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`mkt-ldetail__thumb${i === shotIndexSafe ? ' is-current' : ''}`}
                          onClick={() => setShotIndex(i)}
                          aria-current={i === shotIndexSafe}
                          aria-label={t('layouts.market.detail.shotNth', {
                            index: i + 1,
                            total: shots.length,
                          })}
                        >
                          <img src={image} alt="" />
                        </button>
                      ))}
                      <span className="mkt-ldetail__count">
                        {t('marketplace.gallery.counter', {
                          index: shotIndexSafe + 1,
                          total: shots.length,
                          defaultValue: '{{index}} / {{total}}',
                        })}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                /* SANS CAPTURE, PAS DE CADRE VIDE : une phrase dit ce qui se
                   passe, et à qui il revient d'y remédier. */
                <p className="mkt-ldetail__noshot">
                  {t(
                    'marketplace.gallery.noneExtension',
                    "Cette extension n'a pas de capture. Son auteur peut en ajouter jusqu'à quatre à sa prochaine version."
                  )}
                </p>
              )}
            </div>

            <div className="mkt-ldetail__rail">
              <div className="mkt-ldetail__card">
                <div className="mkt-detail__top">
                  <span className="mkt-detail__icon" aria-hidden="true">
                    <bdi>{icon ?? '▦'}</bdi>
                  </span>
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <h3 className="mkt-detail__title">{name}</h3>
                    <div className="mkt-card__foot">
                      <EntryBadge state={verdict.state} />
                      <span className="mkt-tag">
                        {t(
                          `marketplace.categories.${normalizeCategory(summary?.category ?? detail?.category)}`
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {description && <p className="mkt-detail__desc">{description}</p>}

                {/* ── Les actions ── */}
                <div className="mkt-detail__actions">
                  {primaryLabel && canInstall && latestVersion && (
                    <Button
                      variant={verdict.state === 'update' ? 'primary' : 'secondary'}
                      loading={busy}
                      disabled={!appOk}
                      onClick={() => onInstall(slug, latestVersion)}
                    >
                      {primaryLabel}
                    </Button>
                  )}
                  {mine && mine.status !== 'broken_signature' && (
                    <Button variant="ghost" onClick={() => onToggle(slug, !mine.enabled)}>
                      {mine.enabled ? t('marketplace.disable') : t('marketplace.enable')}
                    </Button>
                  )}
                  {mine && (
                    <Button variant="ghost" loading={busy} onClick={() => onUninstall(slug)}>
                      {t('marketplace.uninstall')}
                    </Button>
                  )}
                </div>

                {!canInstall && (
                  <Notice
                    glyph={<OfflineGlyph />}
                    title={t('marketplace.signedOut.title')}
                    text={t('marketplace.signedOut.explain')}
                  />
                )}

                <div className="mkt-ldetail__rule" />

                {/* LES FAITS. Le worker les servait déjà tous ; la fiche n'en
                    montrait qu'un, glissé au milieu des étiquettes. */}
                <dl className="mkt-ldetail__facts">
                  {latestVersion && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factVersion', 'Version')}</dt>
                      <dd>{latestVersion}</dd>
                    </div>
                  )}
                  {newest && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factPublished', 'Publiée le')}</dt>
                      <dd>{formatDate(newest.createdAt, i18n.language)}</dd>
                    </div>
                  )}
                  {newest && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factSize', 'Poids')}</dt>
                      <dd>{formatBytes(newest.sizeBytes, i18n.language)}</dd>
                    </div>
                  )}
                  {summary && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factDownloads', 'Installations')}</dt>
                      <dd>{summary.downloads}</dd>
                    </div>
                  )}
                  <div className="mkt-ldetail__fact">
                    <dt>{t('marketplace.detail.factSlug')}</dt>
                    <dd className="is-mono">{slug}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          {/* ── Les états qui commandent AVANT toute action ── */}

          {verdict.state === 'broken' && (
            <Notice
              tone="danger"
              live="alert"
              glyph={<ShieldAlertGlyph />}
              title={t('marketplace.broken.title')}
              text={t('marketplace.broken.explain')}
            />
          )}
          {verdict.state === 'conflict' && conflicts.length === 0 && (
            <Notice
              tone="warn"
              glyph={<WarnGlyph />}
              title={t('marketplace.conflict.title')}
              text={t('marketplace.conflict.explainGeneric')}
            />
          )}
          {conflicts.length > 0 && (
            <Notice
              tone="warn"
              glyph={<WarnGlyph />}
              title={t('marketplace.conflict.title')}
              text={t('marketplace.conflict.explain', {
                list: conflicts.map((c) => `.${c.ext} (${c.heldBy})`).join(', '),
              })}
            />
          )}
          {!appOk && capabilities.minAppVersion && (
            <Notice
              tone="warn"
              glyph={<WarnGlyph />}
              title={t('marketplace.incompatible.title')}
              text={t('marketplace.incompatible.explain', {
                required: capabilities.minAppVersion,
                current: getAppVersion(),
              })}
            />
          )}

          {/*
            LE BAS DE LA FICHE : ce qu'elle fait à gauche, qui l'a signée à
            droite. La colonne de droite reprend le rail de l'en-tête, si bien
            que l'œil suit une seule verticale au lieu de deux.
          */}
          <div className="mkt-ldetail__lower">
            <div>
              {/* ── 1. Ce qu'elle fait ── */}

              <section>
                <h4 className="mkt-section__title">{t('marketplace.detail.capabilitiesTitle')}</h4>
                {status === 'loading' && !detail ? (
                  <ListSkeleton rows={1} label={t('marketplace.detail.loading')} />
                ) : capabilities.extensions.length > 0 ? (
                  <>
                    <p className="mkt-section__lead">
                      {t('marketplace.detail.opensFiles', {
                        count: capabilities.extensions.length,
                        list: capabilities.extensions.map((e) => `.${e}`).join(', '),
                      })}
                    </p>
                    <CapabilityList extensions={capabilities.extensions} max={12} />
                  </>
                ) : (
                  <p className="mkt-section__lead">{t('marketplace.detail.capabilitiesUnknown')}</p>
                )}
              </section>

              {/* ── 2. Ce qu'elle ne peut PAS faire ── */}

              <section>
                <h4 className="mkt-section__title">{t('marketplace.detail.limitsTitle')}</h4>
                <ul className="mkt-limits">
                  {['network', 'files', 'account', 'windows'].map((k) => (
                    <li className="mkt-limits__item" key={k}>
                      <BlockedGlyph className="mkt-limits__glyph" />
                      {t(`marketplace.detail.limits.${k}`)}
                    </li>
                  ))}
                  <li className="mkt-limits__item">
                    <WarnGlyph className="mkt-limits__glyph mkt-limits__glyph--warn" />
                    {t('marketplace.detail.limits.canWrite')}
                  </li>
                </ul>
              </section>
            </div>

            <div className="mkt-ldetail__rail">
              {/* ── 3. Qui l'a signée ── */}

              <section>
                <h4 className="mkt-section__title">{t('marketplace.detail.authorTitle')}</h4>
                <p className="mkt-section__lead">
                  <TrustLine trust={trust} />
                </p>
                <ul className="mkt-limits">
                  <li className="mkt-limits__item">
                    <CheckGlyph className="mkt-limits__glyph" />
                    {t('marketplace.detail.signatureExplained')}
                  </li>
                </ul>
                <FingerprintDisclosure
                  fingerprint={fingerprint}
                  facts={[
                    { label: t('marketplace.detail.factSlug'), value: slug, mono: true },
                    ...(newest
                      ? [
                          {
                            label: t('marketplace.detail.factHash'),
                            value: newest.bundleHash,
                            mono: true,
                          },
                        ]
                      : []),
                  ]}
                />
              </section>

              {/* ── 4. Les versions ── */}

              <section>
                <h4 className="mkt-section__title">{t('marketplace.detail.versionsTitle')}</h4>
                {status === 'error' && !detail ? (
                  <Notice
                    tone={online ? 'danger' : 'neutral'}
                    glyph={online ? <WarnGlyph /> : <OfflineGlyph />}
                    title={
                      online ? t('marketplace.detail.loadFailed') : t('marketplace.offline.title')
                    }
                    text={online ? undefined : t('marketplace.offline.explain')}
                    actions={
                      online ? [{ label: t('marketplace.action.retry'), onClick: load }] : undefined
                    }
                  />
                ) : status === 'loading' && versions.length === 0 ? (
                  <ListSkeleton rows={2} label={t('marketplace.detail.loading')} />
                ) : versions.length === 0 ? (
                  <p className="mkt-section__lead">{t('marketplace.detail.noVersions')}</p>
                ) : (
                  <ul className="mkt-versions">
                    {versions.map((v) => (
                      <li
                        className={`mkt-version${mine?.installedVersion === v.version ? ' mkt-version--current' : ''}`}
                        key={v.version}
                      >
                        <span className="mkt-version__num">v{v.version}</span>
                        <span>
                          {formatBytes(v.sizeBytes, i18n.language)} ·{' '}
                          {formatDate(v.createdAt, i18n.language)}
                          {mine?.installedVersion === v.version
                            ? ` · ${t('marketplace.detail.yourVersion')}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ── 5. Le reste ── */}

              <section>
                <h4 className="mkt-section__title">{t('marketplace.detail.moreTitle')}</h4>
                <div className="mkt-detail__actions">
                  {ownedByMe ? (
                    summary?.status === 'published' && (
                      <Button size="sm" variant="ghost" onClick={() => onUnlist(slug)}>
                        {t('marketplace.unpublish')}
                      </Button>
                    )
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onReport(slug)}>
                      {t('marketplace.report.action')}
                    </Button>
                  )}
                </div>
                <p className="mkt-adv__hint" style={{ marginTop: 'var(--spacing-2)' }}>
                  {ownedByMe
                    ? t('marketplace.detail.unpublishHint')
                    : t('marketplace.detail.reportHint')}
                </p>
              </section>
            </div>
          </div>
        </div>
      </div>

      {zoomed && shots.length > 0 && (
        <ShotLightbox
          shots={shots}
          index={shotIndexSafe}
          title={name}
          onIndex={setShotIndex}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
};
