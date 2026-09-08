/**
 * MarketplaceView — la coquille de la place de marché.
 *
 * ── CE QUE CET ÉCRAN A ARRÊTÉ DE FAIRE ──────────────────────────────────────
 *
 * Il s'ouvrait sur un titre de seize pixels, trois onglets (« Parcourir »,
 * « Installés », « Publier ») et rien qui dise ce qu'est une extension Filarr ni
 * ce qu'on peut faire ici. La première ligne d'information réelle qu'un visiteur
 * rencontrait était une empreinte cryptographique de trente chiffres.
 *
 * ── LA STRUCTURE ────────────────────────────────────────────────────────────
 *
 *   · un TITRE et une phrase qui répond à « qu'est-ce que je peux faire ici » ;
 *   · un premier étage : le TYPE D'OBJET (extensions aujourd'hui, modèles de
 *     mise en page demain — voir `artifactKinds.ts`, la couture existe déjà) ;
 *   · un second étage : la SECTION (découvrir / mes extensions / publier), avec
 *     ses compteurs — le nombre de mises à jour en attente ne vivait que dans la
 *     pastille de la barre latérale, jamais dans l'écran concerné ;
 *   · le corps, et à droite la FICHE, qui n'écrase pas la liste.
 *
 * ── LES DONNÉES SERVIES SONT HOSTILES ───────────────────────────────────────
 *
 * name/description/icon/category viennent du serveur : rendu en texte brut
 * (React échappe), jamais de HTML ; l'icône passe par un <bdi> et un écrêtage en
 * points de code ; la catégorie est normalisée AVANT de devenir une clé i18n.
 * Ces règles n'ont pas changé — elles sont seulement descendues dans les
 * composants qui affichent (`PluginCard`, `PluginDetailPanel`).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import {
  fetchMarketplaceCatalog,
  refreshInstalledPlugins,
  checkPluginUpdates,
  marketplaceUpdatesInvalidated,
} from '../../../store/slices/marketplaceSlice';
import {
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  type InstallOptions,
} from '../../../services/plugins/installedPlugins';
import { PluginVerifyError } from '../../../services/plugins/pluginSigning';
import {
  marketplaceErrorCode,
  apiUnlistPlugin,
  apiReportPlugin,
} from '../../../services/plugins/marketplaceApi';
import { getOwnPublicKey } from '../../../services/auth/userKeypair';
import { unregisterSandboxedPlugin } from '../../../services/plugins/pluginRegistry';
import {
  ARTIFACT_KINDS,
  SECTION_LABEL_KEYS,
  artifactKind,
  type ArtifactKindId,
  type MarketplaceSectionId,
} from './artifactKinds';
import { installedEntryState, type CatalogSort } from './entryState';
import { useOnlineStatus } from './useOnlineStatus';
import { DiscoverPanel } from './DiscoverPanel';
import { MyExtensionsPanel, type DevLocalPlugin } from './MyExtensionsPanel';
import { PluginDetailPanel } from './PluginDetailPanel';
import { PublishWizard } from './PublishWizard';
import { LocalTestPanel } from './LocalTestPanel';
import { LayoutTemplatesPanel } from './LayoutTemplatesPanel';
import { LayoutDiscoverPanel } from './LayoutDiscoverPanel';
import { LayoutPublishPanel } from './LayoutPublishPanel';
import { PublisherKeyChangedModal } from './PublisherKeyChangedModal';
import { ReportPluginModal, REPORT_MIN, REPORT_MAX } from './ReportPluginModal';
import { EmptyPanel } from './MarketplaceNotices';
import { BoxGlyph } from './icons';
import './marketplace.css';

/** Le code d'erreur → la clé i18n marketplace.errors.* (repli générique). */
function errorKey(e: unknown): string {
  const code = e instanceof PluginVerifyError ? e.code : (marketplaceErrorCode(e) ?? 'unknown');
  const known = new Set([
    'slug_taken',
    'version_exists',
    'bad_signature',
    'hash_mismatch',
    'fingerprint_mismatch',
    'manifest_mismatch',
    'plugin_not_found',
    'bundle_too_large',
    'version_rollback',
    'rate_limited',
    // Sans eux, un signalement en double et un manifeste refusé tombaient dans
    // « l'opération a échoué » — la seule phrase qui n'apprend rien à qui peut agir.
    'already_reported',
    'bad_manifest',
  ]);
  return known.has(code) ? `marketplace.errors.${code}` : 'marketplace.errors.unknown';
}

export const MarketplaceView: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { error: notifyError, success: notifySuccess } = useNotification();
  const userId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const { catalog, catalogStatus, installed } = useSelector((s: RootState) => s.marketplace);
  const online = useOnlineStatus();

  const [kind, setKind] = useState<ArtifactKindId>('extensions');
  const [section, setSection] = useState<MarketplaceSectionId>('discover');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [sort, setSort] = useState<CatalogSort>('relevance');
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [ownFingerprint, setOwnFingerprint] = useState<string | null>(null);
  /** L'écran « ce n'est plus la même clé qui signe » — re-confirmation explicite. */
  const [keyChange, setKeyChange] = useState<{ slug: string; version: string } | null>(null);
  /** Modale de signalement — la raison ne part qu'au clic, jamais à la frappe. */
  const [reporting, setReporting] = useState<{ slug: string; reason: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  /**
   * Les greffons montés en TEST LOCAL — session seulement. Volontairement hors
   * Redux et hors IndexedDB : rien de tout cela n'est signé, et un rechargement
   * doit repartir d'une ardoise vide.
   */
  const [devLocal, setDevLocal] = useState<DevLocalPlugin[]>([]);

  useEffect(() => {
    void dispatch(fetchMarketplaceCatalog(undefined));
    if (userId) void dispatch(refreshInstalledPlugins(userId));
  }, [dispatch, userId]);

  useEffect(() => {
    void getOwnPublicKey().then((pub) => setOwnFingerprint(pub?.fingerprint ?? null));
  }, []);

  // Recherche débouncée — le q part borné, le worker échappe le LIKE. La
  // CATÉGORIE part avec : c'est un paramètre serveur (filtrer les 50 lignes
  // déjà chargées mentait dès la deuxième page).
  useEffect(() => {
    const timer = setTimeout(() => {
      void dispatch(
        fetchMarketplaceCatalog({
          q: query.trim() || undefined,
          category: category === 'all' ? undefined : category,
        })
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [dispatch, query, category]);

  const installedBySlug = useMemo(() => new Map(installed.map((p) => [p.slug, p])), [installed]);
  const latestBySlug = useMemo(
    () => new Map(catalog.map((p) => [p.slug, p.latestVersion])),
    [catalog]
  );

  /** Combien d'extensions installées attendent une mise à jour — pour le compteur. */
  const pendingUpdates = useMemo(
    () =>
      installed.filter(
        (p) => installedEntryState(p, latestBySlug.get(p.slug) ?? null).state === 'update'
      ).length,
    [installed, latestBySlug]
  );

  /**
   * Recharger le catalogue EN GARDANT les critères à l'écran. Un refetch « nu »
   * après une dépublication ou une publication faisait réapparaître tout le
   * catalogue alors que la chip de catégorie affichait toujours un filtre —
   * l'écran contredisait ses propres commandes.
   */
  const refetchCatalog = useCallback(() => {
    void dispatch(
      fetchMarketplaceCatalog({
        q: query.trim() || undefined,
        category: category === 'all' ? undefined : category,
      })
    );
  }, [dispatch, query, category]);

  /**
   * LE RETOUR DU RÉSEAU RELANCE LA REQUÊTE, une fois.
   *
   * Sans cela, un catalogue ouvert hors ligne restait vide jusqu'à ce que
   * l'utilisateur pense à retaper sa recherche — une corvée demandée à un humain
   * alors que la machine venait d'apprendre que la connexion était revenue.
   *
   * La référence retient l'état PRÉCÉDENT : l'effet ne se déclenche qu'à la
   * TRANSITION hors ligne → en ligne. Un simple `if (online)` aurait relancé une
   * requête à chaque changement de recherche, c'est-à-dire à chaque frappe.
   */
  const wasOnline = useRef(online);
  useEffect(() => {
    const revenu = online && !wasOnline.current;
    wasOnline.current = online;
    if (revenu) refetchCatalog();
  }, [online, refetchCatalog]);

  /** Le compte de la pastille est PÉRIMÉ : on le remet à zéro et on recompte. */
  const recomputeUpdates = useCallback(() => {
    dispatch(marketplaceUpdatesInvalidated());
    if (userId) void dispatch(checkPluginUpdates(userId));
  }, [dispatch, userId]);

  const doInstall = useCallback(
    async (slug: string, version: string, opts: InstallOptions = {}) => {
      if (!userId) return;
      setBusySlug(slug);
      try {
        await installPlugin(userId, slug, version, opts);
        notifySuccess(t('marketplace.installSuccess'));
        void dispatch(refreshInstalledPlugins(userId));
        recomputeUpdates();
      } catch (e) {
        if (e instanceof PluginVerifyError && e.code === 'publisher_key_changed') {
          setKeyChange({ slug, version });
        } else {
          notifyError(t(errorKey(e)));
        }
      } finally {
        setBusySlug(null);
      }
    },
    [userId, dispatch, notifyError, notifySuccess, recomputeUpdates, t]
  );

  /** Tout mettre à jour — une extension à la fois, l'échec de l'une n'arrête
   *  pas les autres (chaque `doInstall` gère déjà son erreur). */
  const doUpdateAll = useCallback(
    async (targets: { slug: string; version: string }[]) => {
      for (const target of targets) {
        await doInstall(target.slug, target.version);
      }
    },
    [doInstall]
  );

  const doUninstall = useCallback(
    async (slug: string) => {
      if (!userId) return;
      setBusySlug(slug);
      try {
        await uninstallPlugin(userId, slug);
        void dispatch(refreshInstalledPlugins(userId));
        recomputeUpdates();
        setSelectedSlug((s) => (s === slug ? null : s));
      } finally {
        setBusySlug(null);
      }
    },
    [userId, dispatch, recomputeUpdates]
  );

  const doToggle = useCallback(
    async (slug: string, enabled: boolean) => {
      if (!userId) return;
      await setPluginEnabled(userId, slug, enabled);
      void dispatch(refreshInstalledPlugins(userId));
      recomputeUpdates();
    },
    [userId, dispatch, recomputeUpdates]
  );

  const doUnlist = useCallback(
    async (slug: string) => {
      try {
        await apiUnlistPlugin(slug);
        notifySuccess(t('marketplace.unpublishSuccess'));
        refetchCatalog();
      } catch (e) {
        notifyError(t(errorKey(e)));
      }
    },
    [refetchCatalog, notifyError, notifySuccess, t]
  );

  const submitReport = useCallback(async () => {
    const cible = reporting;
    if (!cible) return;
    const raison = cible.reason.trim();
    if (raison.length < REPORT_MIN || raison.length > REPORT_MAX) return;
    setReportBusy(true);
    try {
      await apiReportPlugin(cible.slug, raison);
      setReporting(null);
      notifySuccess(t('marketplace.report.success'));
    } catch (e) {
      // `already_reported` a sa propre phrase : redire « échec » à quelqu'un qui
      // a DÉJÀ signalé le ferait recommencer indéfiniment.
      notifyError(t(errorKey(e)));
    } finally {
      setReportBusy(false);
    }
  }, [reporting, notifyError, notifySuccess, t]);

  const clearFilters = useCallback(() => {
    setQuery('');
    setCategory('all');
  }, []);

  /**
   * UNE FICHE EST-ELLE OUVERTE ?
   *
   * Les deux rayons ne rangent pas cette information au même endroit : les
   * greffons ouvrent depuis ici (`selectedSlug`), les modèles depuis leur
   * propre panneau, qui garde son état parce que c'est lui qui porte aussi
   * l'installation et le signalement. Il le REMONTE donc en un seul booléen —
   * c'est tout ce dont la coquille a besoin pour se retirer.
   */
  const [layoutDetailOpen, setLayoutDetailOpen] = useState(false);

  /**
   * ⚠ UNE FICHE OUVERTE SUR L'AUTRE RAYON NE COMPTE PAS. Changer de rayon remet
   * `selectedSlug` à null, mais rien ne remet `layoutDetailOpen` : sans ce
   * garde, revenir aux extensions garderait l'en-tête caché sur une liste.
   */
  const detailOpen = kind === 'layouts' ? layoutDetailOpen : selectedSlug !== null;

  const currentKind = artifactKind(kind);
  const detailName = catalog.find((p) => p.slug === keyChange?.slug)?.name ?? keyChange?.slug ?? '';
  const reportName = catalog.find((p) => p.slug === reporting?.slug)?.name ?? reporting?.slug ?? '';

  /** Le compteur d'une section — `null` quand il n'apprendrait rien. */
  const sectionCount = (id: MarketplaceSectionId): { value: number; attention: boolean } | null => {
    if (kind !== 'extensions') return null;
    if (id === 'mine' && installed.length > 0) {
      return pendingUpdates > 0
        ? { value: pendingUpdates, attention: true }
        : { value: installed.length, attention: false };
    }
    return null;
  };

  const body = () => {
    if (!currentKind.available) {
      return (
        <EmptyPanel
          glyph={<BoxGlyph />}
          title={t('marketplace.soon.title', { kind: t(currentKind.labelKey) })}
          text={t('marketplace.soon.text')}
        />
      );
    }
    // Les MODÈLES DE MISE EN PAGE ont leurs propres panneaux : le routage se
    // fait AVANT celui des extensions, qui suppose partout un catalogue de
    // greffons. Deux étages, deux jeux de panneaux, une seule coquille.
    if (kind === 'layouts') {
      if (section === 'discover')
        return <LayoutDiscoverPanel onDetailChange={setLayoutDetailOpen} />;
      if (section === 'publish') return <LayoutPublishPanel />;
      return <LayoutTemplatesPanel />;
    }
    if (section === 'discover') {
      return (
        <DiscoverPanel
          catalog={catalog}
          catalogStatus={catalogStatus}
          installedBySlug={installedBySlug}
          ownFingerprint={ownFingerprint}
          online={online}
          signedIn={!!userId}
          query={query}
          category={category}
          sort={sort}
          busySlug={busySlug}
          selectedSlug={selectedSlug}
          onQueryChange={setQuery}
          onCategoryChange={setCategory}
          onSortChange={setSort}
          onClearFilters={clearFilters}
          onRetry={refetchCatalog}
          onOpen={(slug) => setSelectedSlug((s) => (s === slug ? null : slug))}
          onInstall={(slug, version) => void doInstall(slug, version)}
          onGoPublish={() => setSection('publish')}
        />
      );
    }
    if (section === 'mine') {
      return (
        <MyExtensionsPanel
          installed={installed}
          latestBySlug={latestBySlug}
          devLocal={devLocal}
          ownFingerprint={ownFingerprint}
          signedIn={!!userId}
          busySlug={busySlug}
          onOpen={(slug) => setSelectedSlug(slug)}
          onInstall={(slug, version) => void doInstall(slug, version)}
          onToggle={(slug, enabled) => void doToggle(slug, enabled)}
          onUninstall={(slug) => void doUninstall(slug)}
          onUpdateAll={(targets) => void doUpdateAll(targets)}
          onRemoveDevLocal={(id) => {
            unregisterSandboxedPlugin(id);
            setDevLocal((l) => l.filter((x) => x.id !== id));
          }}
          onGoDiscover={() => setSection('discover')}
        />
      );
    }
    return (
      <div>
        {/* Essayer AVANT de publier : c'est le premier geste d'un auteur, il
            n'attend donc pas la fin d'un formulaire de huit champs. */}
        <LocalTestPanel
          devLocalCount={devLocal.length}
          onRegistered={(entry) => setDevLocal((l) => [...l, entry])}
        />
        <PublishWizard
          onPublished={() => {
            refetchCatalog();
            setSection('discover');
          }}
        />
      </div>
    );
  };

  return (
    <div className="mkt">
      {/*
        L'EN-TÊTE SE RETIRE QUAND UNE FICHE S'OUVRE.

        Ses trois étages — le titre et sa phrase, les rayons, les sections —
        répondent à « où suis-je, et que puis-je faire ici ». Ce sont de bonnes
        questions TANT QU'ON CHERCHE. Une fois une fiche ouverte, on ne choisit
        plus un rayon : on lit un objet, et ces cent-quatre-vingt-dix pixels ne
        font plus que pousser la capture d'écran sous la ligne de flottaison.

        La fiche pose sa propre barre (`DetailTopBar`), qui tient en une hauteur
        de bouton et garde ce qui sert encore : par où l'on repart.
      */}
      {!detailOpen && (
        <header className="mkt__head">
          <h2 className="mkt__title">{t('marketplace.title')}</h2>
          <p className="mkt__tagline">{t(currentKind.taglineKey)}</p>

          <div className="mkt__kinds" role="tablist" aria-label={t('marketplace.kinds.label')}>
            {ARTIFACT_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="tab"
                aria-selected={kind === k.id}
                className={`mkt__kind${kind === k.id ? ' mkt__kind--active' : ''}`}
                onClick={() => {
                  setKind(k.id);
                  setSelectedSlug(null);
                  // La PREMIÈRE section du type, pas « Découvrir » : tous les
                  // types n'ont pas les mêmes sections, et retomber sur une
                  // section absente laisserait la navigation sans onglet actif.
                  setSection(k.sections[0] ?? 'discover');
                }}
              >
                {t(k.labelKey)}
                {!k.available && (
                  <span className="mkt__kind-soon">{t('marketplace.soon.badge')}</span>
                )}
              </button>
            ))}
          </div>

          <nav className="mkt__nav" aria-label={t('marketplace.sections.label')}>
            {currentKind.sections.map((id) => {
              const count = sectionCount(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-current={section === id ? 'page' : undefined}
                  className={`mkt__nav-item${section === id ? ' mkt__nav-item--active' : ''}`}
                  onClick={() => setSection(id)}
                >
                  {t(currentKind.sectionLabelKeys?.[id] ?? SECTION_LABEL_KEYS[id])}
                  {count && (
                    <span
                      className={`mkt__nav-count${count.attention ? ' mkt__nav-count--attention' : ''}`}
                    >
                      {count.value}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </header>
      )}

      {/*
        LA FICHE PREND LA PAGE, elle ne s'ajoute plus À CÔTÉ.

        Elle vivait dans une seconde colonne, la liste restant visible à gauche.
        L'intention était bonne — garder sa place dans le catalogue — mais le
        résultat était une fiche de 340 px dont la capture d'écran ne pouvait
        rien montrer, et une liste de 340 px inutilisable à côté. Sous 1100 px,
        la feuille de style RECOUVRAIT déjà la liste : la moitié des écrans
        avait donc déjà le comportement qu'on adopte ici partout.

        La place dans le catalogue, elle, ne se perd pas : le retour ramène la
        liste dans l'état où elle était, filtres et recherche compris.
      */}
      <div className="mkt__body">
        <div className={`mkt__pane${detailOpen ? ' mkt__pane--flush' : ''}`}>
          {selectedSlug && kind !== 'layouts' ? (
            <PluginDetailPanel
              slug={selectedSlug}
              online={online}
              ownFingerprint={ownFingerprint}
              busy={busySlug === selectedSlug}
              canInstall={!!userId}
              onClose={() => setSelectedSlug(null)}
              onInstall={(slug, version) => void doInstall(slug, version)}
              onUninstall={(slug) => void doUninstall(slug)}
              onToggle={(slug, enabled) => void doToggle(slug, enabled)}
              onReport={(slug) => setReporting({ slug, reason: '' })}
              onUnlist={(slug) => void doUnlist(slug)}
            />
          ) : (
            body()
          )}
        </div>
      </div>

      {reporting && (
        <ReportPluginModal
          name={reportName}
          reason={reporting.reason}
          busy={reportBusy}
          onChange={(reason) => setReporting({ ...reporting, reason })}
          onCancel={() => setReporting(null)}
          onSubmit={() => void submitReport()}
        />
      )}

      {keyChange && (
        <PublisherKeyChangedModal
          slug={keyChange.slug}
          version={keyChange.version}
          name={detailName}
          onCancel={() => setKeyChange(null)}
          onConfirm={() => {
            const target = keyChange;
            setKeyChange(null);
            void doInstall(target.slug, target.version, { acceptNewPublisherKey: true });
          }}
        />
      )}
    </div>
  );
};

export default MarketplaceView;
