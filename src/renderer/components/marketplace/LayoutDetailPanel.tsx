/**
 * LA FICHE D'UN MODÈLE — ce qu'il fait, qui l'a signé, et quoi d'autre du même.
 *
 * ── CE QUE LA CARTE NE POUVAIT PAS DIRE ─────────────────────────────────────
 *
 * Une tuile de catalogue tient en six lignes : un nom, deux étiquettes, une
 * version. Elle ne peut pas montrer À QUOI RESSEMBLE la disposition, ni dire
 * qui est l'auteur au-delà d'une phrase, ni ce qu'il a publié d'autre. Sans cet
 * écran, installer était un pari sur un nom.
 *
 * ── L'APERÇU EST VÉRIFIÉ AVANT D'ÊTRE DESSINÉ ───────────────────────────────
 *
 * La géométrie vient de l'enveloppe, donc du serveur. On la passe par la MÊME
 * vérification que l'installation — signature, anti-substitution, empreinte —
 * avant d'en tracer un seul rectangle. Dessiner d'abord et vérifier ensuite
 * aurait montré la forme d'un modèle dont on refuse le contenu : la plus
 * trompeuse des impressions.
 *
 * Un échec n'est donc pas une case vide, c'est un avertissement nommé.
 *
 * ── ET LE COMPTEUR RESTE HONNÊTE ────────────────────────────────────────────
 *
 * L'enveloppe est demandée en mode `preview`, que le worker ne compte pas. Sans
 * ça, chaque coup d'œil vaudrait une installation, et le nombre affiché serait
 * d'autant plus faux que la fiche est regardée sans être prise.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui';
import {
  apiGetLayoutMarketEnvelope,
  apiGetLayoutMarketTemplate,
  type LayoutMarketDetail,
  type LayoutMarketSummary,
} from '../../../services/layouts/layoutMarketApi';
import { verifyPublishedLayout } from '../../../services/layouts/layoutMarketSigning';
import { validateLayoutFile } from '../../../services/layouts/layoutValidator';
import type { LayoutFileWidget } from '../../../services/layouts/layoutFormat';
import {
  layoutEntryState,
  type LayoutEntryVerdict,
} from '../../../services/layouts/layoutMarketInstall';
import type { LibraryOrigin } from '../../../services/layouts/layoutLibrary';
import { normalizeLayoutCategory } from '../../../services/layouts/layoutMarketTypes';
import { TemplateMap } from '../home/presets/TemplateMap';
import { knownCoreTypes } from '../home/layoutTransfer';
import { previewsOf } from '../../../services/layouts/layoutMarketTypes';
import { LAYOUT_LIMITS, coreWidgetId } from '../../../services/layouts/layoutFormat';
import { resolveWidget } from '../home/widgetRegistry';
import { MarketIcon } from './MarketIcon';
import { DetailTopBar } from './DetailTopBar';
import { ShotLightbox } from './ShotLightbox';
import { formatBytes, formatDate } from './marketplaceFormat';
import { TrustLine } from './TrustLine';
import { PublisherLine } from './PublisherLine';
import { describePublisher, fingerprintGroups, sameFingerprint } from './trustModel';
import type { InstalledTrustFact } from './trustModel';
import { EmptyPanel, ListSkeleton, Notice } from './MarketplaceNotices';
import { WarnGlyph } from './icons';
/**
 * ⚠ PRÉFIXE `mkt-ldetail`, ET PAS `mkt-detail`.
 *
 * La fiche des GREFFONS possède déjà `.mkt-detail`, `.mkt-detail__title`,
 * `.mkt-detail__desc`… avec d'autres significations — chez elle, `__title` est
 * le NOM du greffon, ici c'est un titre de section. Réutiliser ces noms aurait
 * fait deux cascades qui s'écrasent, et le symptôme serait apparu sur l'écran
 * qu'on n'était pas en train de regarder.
 */
import '../home/presets/homePresets.css';
import './marketplace.css';

export interface LayoutDetailPanelProps {
  slug: string;
  /** Le catalogue déjà chargé — d'où viennent les autres fiches de l'auteur. */
  catalog: readonly LayoutMarketSummary[];
  installedOrigin: LibraryOrigin | undefined;
  ownFingerprint: string | null;
  trustFacts: readonly InstalledTrustFact[];
  busy: boolean;
  canInstall: boolean;
  onBack: () => void;
  onInstall: (row: LayoutMarketSummary) => void;
  onReport: (row: LayoutMarketSummary) => void;
  onOpen: (slug: string) => void;
}

type Status = 'loading' | 'ready' | 'error';

export const LayoutDetailPanel: React.FC<LayoutDetailPanelProps> = ({
  slug,
  catalog,
  installedOrigin,
  ownFingerprint,
  trustFacts,
  busy,
  canInstall,
  onBack,
  onInstall,
  onReport,
  onOpen,
}) => {
  const { t, i18n } = useTranslation();
  const known = useMemo(() => knownCoreTypes(), []);

  const [detail, setDetail] = useState<LayoutMarketDetail | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  /** `null` tant qu'on n'a pas essayé ; `false` = vérification refusée. */
  const [preview, setPreview] = useState<LayoutFileWidget[] | null | false>(null);
  /** La capture large, tiree de l'enveloppe. */
  const [shots, setShots] = useState<readonly string[]>([]);
  /** L'image montrée en grand. Un INDICE et non l'image : la galerie peut
   *  changer sous le pied (une autre version chargée), et un indice hors
   *  bornes se rattrape, alors qu'une URL orpheline laisse un cadre vide. */
  const [shotIndex, setShotIndex] = useState(0);
  /** La visionneuse est-elle ouverte ? Voir `ShotLightbox`. */
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setDetail(null);
    setPreview(null);
    setShots([]);
    setShotIndex(0);
    // Passer d'une fiche à l'autre (« du même auteur ») ne doit pas laisser
    // ouverte une visionneuse qui montrerait encore la capture précédente.
    setZoomed(false);

    void (async () => {
      try {
        const row = await apiGetLayoutMarketTemplate(slug);
        if (cancelled) return;
        setDetail(row);
        setStatus('ready');

        // L'aperçu vient APRÈS la fiche : il est facultatif, et le faire
        // attendre retarderait tout ce qui est déjà lisible.
        const dto = await apiGetLayoutMarketEnvelope(slug, row.latestVersion, true);
        if (cancelled) return;
        const inspection = await verifyPublishedLayout({
          envelopeJson: dto.envelopeJson,
          signature: dto.signature,
          signPublicKey: dto.signPublicKey,
          expected: { slug, version: row.latestVersion },
          knownTypes: known,
        });
        // Le fichier RECONSTRUIT, jamais celui du réseau : ce qu'on dessine est
        // ce qui serait réellement posé.
        const file = validateLayoutFile(JSON.stringify(inspection.validation.file), {
          knownTypes: known,
        });
        if (!cancelled) {
          setPreview(file.status === 'ok' ? file.file.widgets : false);
          setShots(previewsOf(inspection.envelope));
          setShotIndex(0);
        }
      } catch {
        if (!cancelled) {
          // Une fiche illisible et un aperçu invérifiable ne se disent pas
          // pareil : le premier vide l'écran, le second n'enlève que l'image.
          setPreview(false);
          setStatus((s) => (s === 'loading' ? 'error' : s));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug, known]);

  /** La ligne du catalogue, pour les actions qui l'attendent. */
  const row = useMemo(() => catalog.find((entry) => entry.slug === slug), [catalog, slug]);

  const verdict: LayoutEntryVerdict | null = detail
    ? layoutEntryState(detail.latestVersion, installedOrigin)
    : null;

  /**
   * LES AUTRES FICHES DU MÊME AUTEUR.
   *
   * Le rapprochement se fait sur l'EMPREINTE, pas sur un nom de compte : c'est
   * la seule identité qui ne se prête pas. Deux fiches signées par la même clé
   * viennent de la même personne, quoi qu'annonce leur intitulé.
   *
   * ⚠ Cherché dans le catalogue DÉJÀ CHARGÉ, donc au plus cinquante lignes. Un
   * auteur prolifique en aurait au-delà, et il faudrait alors un filtre serveur
   * sur l'empreinte. Dire « aucune autre » serait faux ; on n'affiche donc la
   * section que s'il y a quelque chose à montrer.
   */
  const alsoBy = useMemo(() => {
    if (!detail) return [];
    return catalog.filter(
      (entry) =>
        entry.slug !== slug &&
        sameFingerprint(entry.publisherFingerprint, detail.publisherFingerprint)
    );
  }, [catalog, detail, slug]);

  const trust = useMemo(
    () =>
      detail
        ? describePublisher(detail.publisherFingerprint, ownFingerprint, trustFacts, slug)
        : null,
    [detail, ownFingerprint, trustFacts, slug]
  );

  /** La version servie — celle dont on affiche la date et le poids. */
  const latest = useMemo(() => {
    const versions = detail?.versions ?? [];
    return versions.find((v) => v.version === detail?.latestVersion) ?? versions[0] ?? null;
  }, [detail]);

  /**
   * LES BLOCS DU MODÈLE, NOMMÉS — et lesquels ce binaire ne connaît pas.
   *
   * `resolveWidget` est la MÊME lecture que fait la carte de géométrie : un
   * bloc qui n'y répond pas est un bloc que l'installation écartera. Compter
   * ici ce qui sera écarté là-bas, c'est déplacer l'information avant le geste
   * au lieu de la livrer après, dans un récapitulatif que personne ne lit.
   *
   * ⚠ LE PRÉFIXE `core:` TOMBE AVANT LA RECHERCHE — le registre est indexé par
   * identifiant nu. Chercher la forme préfixée ne trouve JAMAIS rien, et
   * déclarerait tous les blocs inconnus.
   */
  const chips = useMemo(() => {
    if (!preview) return [];
    return preview.map((widget) => {
      const definition = resolveWidget(coreWidgetId(widget.type) ?? widget.type);
      return {
        label: definition ? t(definition.titleKey) : widget.title || widget.type,
        known: definition != null,
      };
    });
  }, [preview, t]);

  /** Le verdict, en deux nombres. `null` tant que l'aperçu n'a pas abouti. */
  const compat = useMemo(
    () =>
      chips.length > 0
        ? { total: chips.length, unknown: chips.filter((chip) => !chip.known).length }
        : null,
    [chips]
  );

  const primaryLabel = useCallback(() => {
    if (!verdict) return null;
    if (verdict.state === 'available') return t('layouts.market.discover.install');
    if (verdict.state === 'update') return t('layouts.market.discover.update');
    return null;
  }, [verdict, t]);

  /** La barre, identique dans les trois états — y compris pendant le chargement. */
  const topBar = (
    <DetailTopBar
      backLabel={t('marketplace.detail.back')}
      crumb={t('marketplace.kinds.layouts.label')}
      onBack={onBack}
    />
  );

  if (status === 'loading' && !detail) {
    return (
      <>
        {topBar}
        <div className="mkt-ldetail__scroll">
          <ListSkeleton rows={3} label={t('marketplace.states.loading')} />
        </div>
      </>
    );
  }

  if (status === 'error' || !detail) {
    return (
      <>
        {topBar}
        <div className="mkt-ldetail__scroll">
          <EmptyPanel
            glyph={<WarnGlyph />}
            title={t('marketplace.states.errorTitle')}
            text={t('marketplace.states.errorText')}
          />
        </div>
      </>
    );
  }

  const category = normalizeLayoutCategory(detail.category);
  const label = primaryLabel();
  const shotIndexSafe = shots.length > 0 ? Math.min(shotIndex, shots.length - 1) : 0;

  return (
    <>
      {topBar}
      <div className="mkt-ldetail__scroll">
        <div className="mkt-ldetail">
          {/* ── L'EN-TÊTE : la capture, et ce qu'il faut savoir avant d'installer ── */}
          <div className="mkt-ldetail__hero">
            <div className="mkt-ldetail__gallery">
              {shots.length > 0 ? (
                <>
                  {/* LA CAPTURE OUVRE LA VISIONNEUSE. C'est un bouton, pas une
                      image cliquable : voir `.mkt-ldetail__shot` et
                      `ShotLightbox`. */}
                  <button
                    type="button"
                    className="mkt-ldetail__shot"
                    onClick={() => setZoomed(true)}
                    aria-label={t('marketplace.gallery.open', {
                      name: detail.name,
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

                  {/* Les vignettes n'apparaissent QU'À PARTIR DE DEUX images : une
                      rangée d'une seule vignette sous sa propre grande version ne
                      propose aucun choix, elle occupe juste de la place. */}
                  {shots.length > 1 && (
                    <div className="mkt-ldetail__thumbs">
                      {shots.map((image, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`mkt-ldetail__thumb${i === shotIndexSafe ? ' is-current' : ''}`}
                          onClick={() => setShotIndex(i)}
                          aria-label={t('layouts.market.detail.shotNth', {
                            index: i + 1,
                            total: shots.length,
                          })}
                          aria-current={i === shotIndexSafe}
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
                /* SANS CAPTURE, PAS DE CADRE VIDE. Un rectangle gris de la taille
                   d'une image dirait « il manque quelque chose » ; une phrase dit
                   ce qui se passe, et à qui il revient d'y remédier. */
                <p className="mkt-ldetail__noshot">
                  {t(
                    'marketplace.gallery.none',
                    "Ce modèle n'a pas de capture. Son auteur peut en ajouter jusqu'à quatre à sa prochaine version."
                  )}
                </p>
              )}
            </div>

            <div className="mkt-ldetail__rail">
              <div className="mkt-ldetail__card">
                <div className="mkt-ldetail__head">
                  <MarketIcon icon={detail.icon} className="mkt-ldetail__icon" />
                  <div className="mkt-ldetail__identity">
                    <h2 className="mkt-ldetail__name">{detail.name}</h2>
                    <div className="mkt-tile__tags">
                      <span className="mkt-tag">{t(`layouts.market.categories.${category}`)}</span>
                      <span className="mkt-tag">
                        {t(`layouts.market.targets.${detail.target}`)}
                      </span>
                      {detail.status === 'unlisted' && (
                        <span className="mkt-badge mkt-badge--muted">
                          {t('marketplace.unlistedBadge')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {detail.description !== '' && (
                  <p className="mkt-ldetail__desc">{detail.description}</p>
                )}

                {label && canInstall && row && (
                  <Button
                    variant={verdict?.state === 'update' ? 'primary' : 'secondary'}
                    fullWidth
                    loading={busy}
                    onClick={() => onInstall(row)}
                  >
                    {label}
                  </Button>
                )}

                {/* LE VERDICT DE COMPATIBILITÉ.
                    L'application calculait déjà ce nombre pour dessiner la carte
                    de géométrie ; elle ne le DISAIT pas. Or c'est exactement la
                    question qu'on se pose devant un modèle publié par un
                    inconnu : est-ce que ça marchera chez moi ? */}
                {compat && (
                  <div
                    className={`mkt-ldetail__verdict mkt-ldetail__verdict--${
                      compat.unknown === 0 ? 'ok' : 'warn'
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      {compat.unknown === 0 ? (
                        <path
                          d="M20 6 9 17l-5-5"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      ) : (
                        <path
                          d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      )}
                    </svg>
                    <span className="mkt-ldetail__verdict-body">
                      <span className="mkt-ldetail__verdict-title">
                        {compat.unknown === 0
                          ? t('layouts.market.detail.compatibleTitle', 'Compatible avec ta version')
                          : t('layouts.market.detail.partialTitle', 'Partiellement compatible')}
                      </span>
                      <span className="mkt-ldetail__verdict-text">
                        {compat.unknown === 0
                          ? t('layouts.market.detail.compatibleText', {
                              count: compat.total,
                              defaultValue:
                                'Les {{count}} blocs du modèle existent chez toi. Rien ne sera ignoré à l’installation.',
                            })
                          : t('layouts.market.detail.partialText', {
                              count: compat.unknown,
                              total: compat.total,
                              defaultValue:
                                '{{count}} bloc(s) sur {{total}} sont inconnus de cette version et seront ignorés à l’installation.',
                            })}
                      </span>
                    </span>
                  </div>
                )}

                <div className="mkt-ldetail__rule" />

                {/* LES FAITS. Tous étaient déjà servis par le worker ; la fiche
                    n'en montrait que deux. */}
                <dl className="mkt-ldetail__facts">
                  <div className="mkt-ldetail__fact">
                    <dt>{t('layouts.market.detail.factVersion', 'Version')}</dt>
                    <dd>{detail.latestVersion}</dd>
                  </div>
                  {latest && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factPublished', 'Publiée le')}</dt>
                      <dd>{formatDate(latest.createdAt, i18n.language)}</dd>
                    </div>
                  )}
                  {latest && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factSize', 'Poids')}</dt>
                      <dd>{formatBytes(latest.sizeBytes, i18n.language)}</dd>
                    </div>
                  )}
                  <div className="mkt-ldetail__fact">
                    <dt>{t('layouts.market.detail.factDownloads', 'Installations')}</dt>
                    <dd>{detail.downloads}</dd>
                  </div>
                  {compat && (
                    <div className="mkt-ldetail__fact">
                      <dt>{t('layouts.market.detail.factGrid', 'Grille')}</dt>
                      <dd>
                        {t('layouts.market.detail.gridValue', {
                          count: compat.total,
                          columns: LAYOUT_LIMITS.columns,
                          defaultValue: '{{count}} blocs sur {{columns}} colonnes',
                        })}
                      </dd>
                    </div>
                  )}
                  <div className="mkt-ldetail__fact">
                    <dt>{t('layouts.market.detail.factSlug', 'Identifiant')}</dt>
                    <dd className="is-mono">{detail.slug}</dd>
                  </div>
                </dl>
              </div>

              <p className="mkt-ldetail__hint">
                {t(
                  'layouts.market.detail.installMeaning',
                  'Installer ajoute le modèle à « Mes modèles ». C’est de là qu’on l’applique à son accueil.'
                )}
              </p>
            </div>
          </div>

          {/* ── LE BAS : la géométrie à gauche, l'auteur et les versions à droite ── */}
          <div className="mkt-ldetail__lower">
            <section className="mkt-ldetail__section">
              <h3 className="mkt-ldetail__title">{t('layouts.market.detail.previewTitle')}</h3>
              {preview === null ? (
                <ListSkeleton rows={2} label={t('marketplace.states.loading')} />
              ) : preview === false ? (
                <Notice
                  glyph={<WarnGlyph />}
                  title={t('layouts.market.detail.previewFailedTitle')}
                  text={t('layouts.market.detail.previewFailed')}
                />
              ) : (
                <>
                  {/* LES NOMS DES BLOCS, AVANT LEUR GÉOMÉTRIE. La carte dit où ils
                      sont ; ces puces disent ce que c'est — et un modèle se choisit
                      d'abord sur ce qu'il apporte. */}
                  {chips.length > 0 && (
                    <div className="mkt-ldetail__chips">
                      {chips.map((chip, i) => (
                        <span
                          key={`${chip.label}-${i}`}
                          className={`mkt-ldetail__chip${
                            chip.known ? '' : ' mkt-ldetail__chip--unknown'
                          }`}
                          title={
                            chip.known
                              ? undefined
                              : t(
                                  'layouts.market.detail.unknownBlock',
                                  'Ce bloc n’existe pas dans cette version : il sera ignoré.'
                                )
                          }
                        >
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mkt-ldetail__hint">
                    {t('layouts.market.blocks', { count: preview.length })}
                  </p>
                  <TemplateMap slots={preview} />
                </>
              )}
            </section>

            <div className="mkt-ldetail__rail">
              <div className="mkt-ldetail__card">
                <h3 className="mkt-ldetail__card-title">
                  {t('layouts.market.detail.authorTitle')}
                </h3>
                <PublisherLine author={detail.author} fingerprint={detail.publisherFingerprint} />
                {trust && <TrustLine trust={trust} />}
                <p className="mkt-ldetail__hint">{t('layouts.market.detail.fingerprintHint')}</p>
                {/* Six groupes de cinq chiffres, en grille : une empreinte se LIT et se
                    compare, et trente chiffres d'affilée ne se comparent pas. */}
                <div className="mkt-ldetail__fingerprint">
                  {fingerprintGroups(detail.publisherFingerprint).map((group, i) => (
                    <span key={`${group}-${i}`}>{group}</span>
                  ))}
                </div>

                {alsoBy.length > 0 && (
                  <>
                    <p className="mkt-ldetail__hint">{t('layouts.market.detail.alsoBy')}</p>
                    <ul className="mkt-ldetail__also">
                      {alsoBy.map((entry) => (
                        <li key={entry.slug}>
                          <button type="button" onClick={() => onOpen(entry.slug)}>
                            <MarketIcon icon={entry.icon} className="mkt-ldetail__also-icon" />
                            <span>{entry.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>

              <div className="mkt-ldetail__card">
                <h3 className="mkt-ldetail__card-title">
                  {t('layouts.market.detail.versionsTitle')}
                </h3>
                <p className="mkt-ldetail__hint">{t('layouts.market.detail.versionsHint')}</p>
                <ul className="mkt-ldetail__versions">
                  {detail.versions.map((v) => (
                    <li key={v.version}>
                      <strong>{v.version}</strong>
                      <span>
                        {formatDate(v.createdAt, i18n.language)} ·{' '}
                        {formatBytes(v.sizeBytes, i18n.language)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {canInstall && !detail.ownedByMe && row && (
            <button
              type="button"
              className="mkt-card__report mkt-ldetail__report"
              onClick={() => onReport(row)}
            >
              {t('layouts.market.report.action')}
            </button>
          )}
        </div>
      </div>

      {zoomed && shots.length > 0 && (
        <ShotLightbox
          shots={shots}
          index={shotIndexSafe}
          title={detail.name}
          onIndex={setShotIndex}
          onClose={() => setZoomed(false)}
        />
      )}
    </>
  );
};

export default LayoutDetailPanel;
