/**
 * LayoutDiscoverPanel — découvrir des modèles, et en installer un.
 *
 * ── INSTALLER N'EST PAS APPLIQUER ───────────────────────────────────────────
 *
 * Le bouton range le modèle dans la BIBLIOTHÈQUE. Il ne touche pas à l'accueil.
 * Pour l'essayer, on passe par « Mes modèles », où l'aperçu s'ouvre et où
 * appliquer crée une mise en page nommée sans écraser la précédente.
 *
 * Télécharger quelque chose et voir son écran changer dans la foulée est
 * exactement ce qui fait qu'on n'essaie plus rien. Deux gestes, deux décisions —
 * et le message de succès le dit, plutôt que de laisser deviner.
 *
 * ── L'ÉTAT VIT ICI, ET PAS DANS REDUX ───────────────────────────────────────
 *
 * Le catalogue de greffons a sa tranche Redux parce que la barre latérale y lit
 * un compteur de mises à jour. Rien ne lit celui-ci depuis ailleurs : une
 * trente-cinquième tranche pour une liste qu'on parcourt et qu'on quitte serait
 * de la machinerie sans lecteur. La bibliothèque, elle, a déjà son propre
 * mécanisme d'abonnement — c'est lui qui rafraîchit les pastilles.
 *
 * ── LES QUATRE VIDES, COMME POUR LES EXTENSIONS ─────────────────────────────
 *
 * Catalogue réellement vide, recherche sans résultat, filtre sans résultat,
 * requête en cours : quatre situations qui n'ont rien à voir, quatre phrases, et
 * surtout quatre SORTIES. Un état vide sans issue transforme un écran en
 * impasse alors qu'un bouton suffisait.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Input, Select } from '../ui';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useNotification } from '../ui/Notification';
import type { RootState } from '../../../store';
import { getOwnPublicKey } from '../../../services/auth/userKeypair';
import {
  apiListLayoutMarket,
  apiReportLayoutTemplate,
  layoutMarketErrorCode,
  type LayoutMarketSummary,
} from '../../../services/layouts/layoutMarketApi';
import {
  installLayoutTemplate,
  layoutEntryState,
  originsBySlug,
  PublisherKeyChangedError,
} from '../../../services/layouts/layoutMarketInstall';
import { listLayoutLibrary, subscribeLayoutLibrary } from '../../../services/layouts/layoutLibrary';
import {
  LAYOUT_MARKET_CATEGORIES,
  LayoutMarketVerifyError,
} from '../../../services/layouts/layoutMarketTypes';
import { LAYOUT_FILE_TARGETS } from '../../../services/layouts/layoutFormat';
import { knownCoreTypes } from '../home/layoutTransfer';
import { CATALOG_SORTS, sortCatalog, type CatalogSort } from './entryState';
import { errorMessageKey } from './layoutPublishValidation';
import { describePublisher, type InstalledTrustFact } from './trustModel';
import { LayoutMarketCard } from './LayoutMarketCard';
import { LayoutDetailPanel } from './LayoutDetailPanel';
import { ReportPluginModal, type ReportSubjectKeys } from './ReportPluginModal';
import { EmptyPanel, ListSkeleton, Notice } from './MarketplaceNotices';
import { BoxGlyph, InfoGlyph, OfflineGlyph, SearchGlyph, WarnGlyph } from './icons';
import { useOnlineStatus } from './useOnlineStatus';
import './marketplace.css';

type Status = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Les phrases de la modale de signalement, version MODÈLE.
 *
 * La modale est partagée avec les extensions ; seules ces quatre-là nomment
 * l'objet, et servir « cette extension » à propos d'une disposition ferait
 * douter de tout l'écran.
 */
const REPORT_SUBJECT: ReportSubjectKeys = {
  title: 'layouts.market.report.title',
  lead: 'layouts.market.report.lead',
  reason: 'layouts.market.report.reason',
  hint: 'layouts.market.report.hint',
};

/** L'écran « ce n'est plus la même clé qui signe » — les deux empreintes. */
interface KeyChangePrompt {
  slug: string;
  version: string;
  name: string;
  known: string;
  offered: string;
}

export interface LayoutDiscoverPanelProps {
  /**
   * Prévient la coquille qu'une fiche s'ouvre ou se ferme.
   *
   * La fiche RESTE gérée ici : c'est ce panneau qui porte l'installation, le
   * signalement et le changement de clé, et remonter tout cela pour une barre
   * de titre aurait fait voyager quatre fonctions pour un booléen.
   */
  onDetailChange?: (open: boolean) => void;
}

export const LayoutDiscoverPanel: React.FC<LayoutDiscoverPanelProps> = ({ onDetailChange }) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const online = useOnlineStatus();
  const signedIn = useSelector((s: RootState) => s.auth.cloudUser?.id != null);

  const known = useMemo(() => knownCoreTypes(), []);

  const [catalog, setCatalog] = useState<LayoutMarketSummary[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [target, setTarget] = useState<string>('all');
  const [sort, setSort] = useState<CatalogSort>('relevance');
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);
  const [keyChange, setKeyChange] = useState<KeyChangePrompt | null>(null);
  /** Le motif ne part qu'au clic, jamais à la frappe. */
  const [reporting, setReporting] = useState<{ slug: string; name: string; reason: string } | null>(
    null
  );
  const [reportBusy, setReportBusy] = useState(false);
  /** La fiche ouverte, ou `null` quand on est sur la liste. */
  const [openSlug, setOpenSlug] = useState<string | null>(null);

  /**
   * ⚠ `useLayoutEffect`, ET C'EST VISIBLE À L'ŒIL NU.
   *
   * Avec un `useEffect`, la séquence est : clic → rendu de la fiche → PEINTURE
   * → effet → second rendu sans l'en-tête. L'écran affiche donc une image
   * intermédiaire où la fiche est posée SOUS les trois étages d'en-tête, puis
   * tout remonte de cent-quatre-vingt-dix pixels. Un sursaut par ouverture.
   *
   * Ici l'effet passe avant la peinture : le navigateur ne dessine jamais
   * l'état intermédiaire.
   *
   * ⚠ LE DÉMONTAGE DOIT REFERMER, LUI AUSSI. Changer de section pendant qu'une
   * fiche est ouverte démonte ce panneau sans passer par le retour : sans le
   * nettoyage, la coquille garderait son en-tête caché sur un écran qui n'a
   * plus rien d'une fiche.
   */
  useLayoutEffect(() => {
    onDetailChange?.(openSlug !== null);
    return () => onDetailChange?.(false);
  }, [openSlug, onDetailChange]);
  const [library, setLibrary] = useState(() => listLayoutLibrary(known));

  // La bibliothèque est écrite depuis TROIS écrans (celui-ci, « Mes modèles »,
  // la boîte d'import de l'accueil) : sans abonnement, les pastilles
  // « installé » de cette liste seraient périmées dès qu'on installe ailleurs.
  useEffect(() => {
    const refresh = (): void => setLibrary(listLayoutLibrary(known));
    refresh();
    return subscribeLayoutLibrary(refresh);
  }, [known]);

  useEffect(() => {
    void getOwnPublicKey().then((pub) => setOwnFingerprint(pub?.fingerprint ?? null));
  }, []);

  /**
   * Recherche débouncée. La CATÉGORIE et la CIBLE partent avec : ce sont des
   * paramètres serveur, et filtrer les 50 lignes déjà chargées répondrait
   * « aucun modèle d'accueil » dès la deuxième page.
   */
  const load = useCallback(async (): Promise<void> => {
    setStatus('loading');
    try {
      const rows = await apiListLayoutMarket({
        q: query.trim() || undefined,
        category: category === 'all' ? undefined : category,
        target: target === 'all' ? undefined : (target as (typeof LAYOUT_FILE_TARGETS)[number]),
      });
      setCatalog(rows);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [query, category, target]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 300);
    return () => clearTimeout(timer);
  }, [load]);

  const origins = useMemo(() => originsBySlug(library), [library]);

  /**
   * Le carnet d'adresses local : les modèles DÉJÀ installés, avec leur
   * empreinte. C'est la seule base sur laquelle « auteur déjà connu » puisse
   * s'appuyer — il n'y a pas d'autorité centrale, et il n'en faut pas.
   */
  const trustFacts = useMemo<InstalledTrustFact[]>(
    () =>
      library
        .filter((entry) => entry.origin)
        .map((entry) => ({
          slug: entry.origin!.slug,
          name: entry.file.name,
          publisherFingerprint: entry.origin!.publisherFingerprint,
        })),
    [library]
  );

  const runInstall = useCallback(
    async (row: LayoutMarketSummary, acceptKeyChange: boolean): Promise<void> => {
      setBusySlug(row.slug);
      try {
        const result = await installLayoutTemplate({
          slug: row.slug,
          version: row.latestVersion,
          knownTypes: known,
          acceptKeyChange,
        });
        notifySuccess(
          t('layouts.market.discover.installed', {
            name: result.file.name,
            applied: result.summary.applied,
            pending: result.summary.pending,
            ignored: result.summary.ignored,
          })
        );
      } catch (err) {
        if (err instanceof PublisherKeyChangedError) {
          setKeyChange({
            slug: row.slug,
            version: row.latestVersion,
            name: row.name,
            known: err.knownFingerprint,
            offered: err.newFingerprint,
          });
          return;
        }
        /**
         * Un refus de VÉRIFICATION n'est pas une panne réseau, et le dire
         * autrement enverrait chercher au mauvais endroit.
         *
         * Le test porte sur la CLASSE et non sur la présence d'un `.code` :
         * Axios en pose un aussi (`ERR_NETWORK`, `ECONNABORTED`), et un
         * `err.code` lu naïvement ferait passer une coupure de réseau pour un
         * défaut de signature.
         */
        const key = errorMessageKey(
          err instanceof LayoutMarketVerifyError ? err.code : layoutMarketErrorCode(err)
        );
        notifyError(
          t(`layouts.market.discover.errors.${key}`, {
            defaultValue: t('layouts.market.discover.errors.unknown'),
          })
        );
      } finally {
        setBusySlug(null);
      }
    },
    [known, notifySuccess, notifyError, t]
  );

  const submitReport = useCallback(async (): Promise<void> => {
    if (!reporting) return;
    setReportBusy(true);
    try {
      await apiReportLayoutTemplate(reporting.slug, reporting.reason.trim());
      notifySuccess(t('marketplace.report.success'));
      setReporting(null);
    } catch (err) {
      const code = layoutMarketErrorCode(err);
      // `already_reported` n'est PAS un échec : le signalement de ce compte est
      // déjà enregistré, et le dire comme une erreur ferait recommencer.
      if (code === 'already_reported') {
        notifySuccess(t('layouts.market.report.already'));
        setReporting(null);
        return;
      }
      notifyError(
        t(`layouts.market.report.errors.${errorMessageKey(code)}`, {
          defaultValue: t('layouts.market.report.errors.unknown'),
        })
      );
    } finally {
      setReportBusy(false);
    }
  }, [reporting, notifySuccess, notifyError, t]);

  const confirmKeyChange = useCallback(() => {
    const pending = keyChange;
    setKeyChange(null);
    if (!pending) return;
    const row = catalog.find((entry) => entry.slug === pending.slug);
    if (row) void runInstall(row, true);
  }, [keyChange, catalog, runInstall]);

  const filtering = query.trim() !== '' || category !== 'all' || target !== 'all';
  const rows = sortCatalog(catalog, sort);
  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory('all');
    setTarget('all');
  }, []);

  /** Un seul endroit décide lequel des cinq cas s'affiche. */
  const body = (() => {
    if (status === 'loading' && catalog.length === 0) {
      return <ListSkeleton rows={4} label={t('marketplace.states.loading')} />;
    }
    if (status === 'error' && catalog.length === 0) {
      return online ? (
        <EmptyPanel
          glyph={<WarnGlyph />}
          title={t('marketplace.states.errorTitle')}
          text={t('marketplace.states.errorText')}
          actions={[
            {
              label: t('marketplace.action.retry'),
              onClick: () => void load(),
              variant: 'primary',
            },
          ]}
        />
      ) : (
        <EmptyPanel
          glyph={<OfflineGlyph />}
          title={t('marketplace.offline.title')}
          text={t('marketplace.offline.explain')}
        />
      );
    }
    if (catalog.length === 0 && filtering) {
      return (
        <EmptyPanel
          glyph={<SearchGlyph />}
          title={
            query.trim()
              ? t('marketplace.states.noResultsFor', { query: query.trim() })
              : t('layouts.market.discover.noResultsFilter')
          }
          text={t('marketplace.states.noResultsText')}
          actions={[
            {
              label: t('marketplace.action.clearFilters'),
              onClick: clearFilters,
              variant: 'primary',
            },
          ]}
        />
      );
    }
    if (catalog.length === 0) {
      return (
        <EmptyPanel
          glyph={<BoxGlyph />}
          title={t('layouts.market.discover.emptyTitle')}
          text={t('layouts.market.discover.emptyText')}
        />
      );
    }
    return (
      <ul className="mkt-rows">
        {rows.map((row) => (
          <LayoutMarketCard
            key={row.slug}
            template={row}
            verdict={layoutEntryState(row.latestVersion, origins.get(row.slug))}
            trust={describePublisher(
              row.publisherFingerprint,
              ownFingerprint,
              trustFacts,
              row.slug
            )}
            busy={busySlug === row.slug}
            canInstall={signedIn}
            onInstall={() => void runInstall(row, false)}
            onReport={() => setReporting({ slug: row.slug, name: row.name, reason: '' })}
            onOpen={() => setOpenSlug(row.slug)}
          />
        ))}
      </ul>
    );
  })();

  if (openSlug) {
    return (
      <>
        <LayoutDetailPanel
          slug={openSlug}
          catalog={catalog}
          installedOrigin={origins.get(openSlug)}
          ownFingerprint={ownFingerprint}
          trustFacts={trustFacts}
          busy={busySlug === openSlug}
          canInstall={signedIn}
          onBack={() => setOpenSlug(null)}
          onInstall={(row) => void runInstall(row, false)}
          onReport={(row) => setReporting({ slug: row.slug, name: row.name, reason: '' })}
          onOpen={(slug) => setOpenSlug(slug)}
        />

        {/* La modale de signalement vit AUSSI ici : ouvrir une fiche ne doit pas
            retirer une action qu'on vient d'y trouver. */}
        {reporting && (
          <ReportPluginModal
            name={reporting.name}
            reason={reporting.reason}
            busy={reportBusy}
            subject={REPORT_SUBJECT}
            onChange={(reason) => setReporting((r) => (r ? { ...r, reason } : r))}
            onCancel={() => setReporting(null)}
            onSubmit={() => void submitReport()}
          />
        )}
      </>
    );
  }

  return (
    <div>
      {!signedIn && (
        <Notice
          glyph={<InfoGlyph />}
          title={t('marketplace.signedOut.title')}
          text={t('layouts.market.discover.signedOut')}
        />
      )}
      {!online && catalog.length > 0 && (
        <Notice
          glyph={<OfflineGlyph />}
          title={t('marketplace.offline.title')}
          text={t('marketplace.offline.staleExplain')}
        />
      )}

      <div className="mkt__toolbar">
        <div className="mkt__search">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('layouts.market.discover.searchPlaceholder')}
            aria-label={t('layouts.market.discover.searchPlaceholder')}
            leftIcon={<SearchGlyph />}
            fullWidth
          />
        </div>
        <div className="mkt__sort">
          <Select
            options={CATALOG_SORTS.map((s) => ({ value: s, label: t(`marketplace.sort.${s}`) }))}
            value={sort}
            onChange={(v) => setSort((Array.isArray(v) ? v[0] : v) as CatalogSort)}
            ariaLabel={t('marketplace.sort.label')}
            size="md"
            fullWidth
          />
        </div>
      </div>

      <div
        className="mkt__chips"
        role="group"
        aria-label={t('layouts.market.discover.targetFilter')}
      >
        {(['all', ...LAYOUT_FILE_TARGETS] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={target === value}
            onClick={() => setTarget(value)}
            className={`mkt__chip${target === value ? ' mkt__chip--active' : ''}`}
          >
            {t(`layouts.market.targets.${value}`)}
          </button>
        ))}
      </div>

      <div className="mkt__chips" role="group" aria-label={t('marketplace.categoryFilter')}>
        {(['all', ...LAYOUT_MARKET_CATEGORIES] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
            className={`mkt__chip${category === value ? ' mkt__chip--active' : ''}`}
          >
            {t(`layouts.market.categories.${value}`)}
          </button>
        ))}
      </div>

      {catalog.length > 0 && (
        <p className="mkt__result-count" role="status">
          {t('layouts.market.discover.resultCount', { count: catalog.length })}
        </p>
      )}

      {body}

      {reporting && (
        <ReportPluginModal
          name={reporting.name}
          reason={reporting.reason}
          busy={reportBusy}
          subject={REPORT_SUBJECT}
          onChange={(reason) => setReporting((r) => (r ? { ...r, reason } : r))}
          onCancel={() => setReporting(null)}
          onSubmit={() => void submitReport()}
        />
      )}

      {/* Les deux empreintes CÔTE À CÔTE : les comparer de mémoire ne marche
          pas, et c'est pourtant tout ce qu'on demandait avant. */}
      <ConfirmModal
        isOpen={keyChange !== null}
        onClose={() => setKeyChange(null)}
        onConfirm={confirmKeyChange}
        title={t('layouts.market.discover.keyChangedTitle')}
        message={t('layouts.market.discover.keyChangedMessage', {
          name: keyChange?.name ?? '',
          known: keyChange?.known ?? '',
          offered: keyChange?.offered ?? '',
        })}
        confirmText={t('layouts.market.discover.keyChangedConfirm')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </div>
  );
};

export default LayoutDiscoverPanel;
