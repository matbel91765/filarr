/**
 * DiscoverPanel — la découverte : chercher, filtrer, trier, ouvrir.
 *
 * ── LES QUATRE VIDES ────────────────────────────────────────────────────────
 *
 * L'ancien écran répondait « Aucun plugin publié pour l'instant. » à quatre
 * situations qui n'ont rien à voir :
 *
 *   · le catalogue est réellement vide       → il faut inviter à publier ;
 *   · la RECHERCHE ne rend rien              → il faut effacer la recherche ;
 *   · la CATÉGORIE filtrée est vide          → il faut lever le filtre ;
 *   · la requête est EN COURS                → il ne faut rien conclure.
 *
 * Chacune a maintenant sa phrase et surtout SA SORTIE. Un état vide sans issue
 * est un cul-de-sac : il transforme un écran en impasse alors qu'un bouton
 * suffisait.
 *
 * S'y ajoutent deux situations que l'écran confondait avec une panne : être hors
 * ligne (rien n'est cassé, les extensions installées fonctionnent) et ne pas
 * avoir de compte nuage (le catalogue est authentifié — l'ancien écran grisait
 * simplement le bouton, sans un mot).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Select } from '../ui';
import {
  MARKETPLACE_CATEGORIES,
  type MarketplacePluginSummary,
} from '../../../services/plugins/marketplaceTypes';
import type { LoadedPluginState } from '../../../services/plugins/installedPlugins';
import { catalogEntryState, CATALOG_SORTS, sortCatalog, type CatalogSort } from './entryState';
import { describePublisher } from './trustModel';
import { PluginCard } from './PluginCard';
import { EmptyPanel, ListSkeleton, Notice } from './MarketplaceNotices';
import { BoxGlyph, InfoGlyph, OfflineGlyph, SearchGlyph, WarnGlyph } from './icons';
import './marketplace.css';

export interface DiscoverPanelProps {
  catalog: MarketplacePluginSummary[];
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error';
  installedBySlug: Map<string, LoadedPluginState>;
  ownFingerprint: string | null;
  online: boolean;
  signedIn: boolean;
  query: string;
  category: string;
  sort: CatalogSort;
  busySlug: string | null;
  selectedSlug: string | null;
  onQueryChange: (q: string) => void;
  onCategoryChange: (c: string) => void;
  onSortChange: (s: CatalogSort) => void;
  onClearFilters: () => void;
  onRetry: () => void;
  onOpen: (slug: string) => void;
  onInstall: (slug: string, version: string) => void;
  onGoPublish: () => void;
}

export const DiscoverPanel: React.FC<DiscoverPanelProps> = ({
  catalog,
  catalogStatus,
  installedBySlug,
  ownFingerprint,
  online,
  signedIn,
  query,
  category,
  sort,
  busySlug,
  selectedSlug,
  onQueryChange,
  onCategoryChange,
  onSortChange,
  onClearFilters,
  onRetry,
  onOpen,
  onInstall,
  onGoPublish,
}) => {
  const { t } = useTranslation();
  const filtering = query.trim() !== '' || category !== 'all';
  const rows = sortCatalog(catalog, sort);

  const sortOptions = CATALOG_SORTS.map((s) => ({
    value: s,
    label: t(`marketplace.sort.${s}`),
  }));

  /** Le corps de liste — un seul endroit décide lequel des six cas s'affiche. */
  const body = (() => {
    if (catalogStatus === 'loading' && catalog.length === 0) {
      return <ListSkeleton rows={5} label={t('marketplace.states.loading')} />;
    }
    if (catalogStatus === 'error' && catalog.length === 0) {
      return online ? (
        <EmptyPanel
          glyph={<WarnGlyph />}
          title={t('marketplace.states.errorTitle')}
          text={t('marketplace.states.errorText')}
          actions={[{ label: t('marketplace.action.retry'), onClick: onRetry, variant: 'primary' }]}
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
              : t('marketplace.states.noResultsCategory')
          }
          text={t('marketplace.states.noResultsText')}
          actions={[
            {
              label: t('marketplace.action.clearFilters'),
              onClick: onClearFilters,
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
          title={t('marketplace.states.emptyCatalogTitle')}
          text={t('marketplace.states.emptyCatalogText')}
          actions={[
            {
              label: t('marketplace.states.emptyCatalogCta'),
              onClick: onGoPublish,
              variant: 'primary',
            },
          ]}
        />
      );
    }
    return (
      <ul className="mkt-list">
        {rows.map((p) => {
          const mine = installedBySlug.get(p.slug);
          return (
            <PluginCard
              key={p.slug}
              plugin={p}
              verdict={catalogEntryState(p.latestVersion, mine)}
              trust={describePublisher(
                p.publisherFingerprint,
                ownFingerprint,
                Array.from(installedBySlug.values()),
                p.slug
              )}
              selected={selectedSlug === p.slug}
              busy={busySlug === p.slug}
              canInstall={signedIn}
              onOpen={() => onOpen(p.slug)}
              onPrimaryAction={() => onInstall(p.slug, p.latestVersion)}
            />
          );
        })}
      </ul>
    );
  })();

  return (
    <div>
      {!signedIn && (
        <Notice
          glyph={<InfoGlyph />}
          title={t('marketplace.signedOut.title')}
          text={t('marketplace.signedOut.explain')}
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
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t('marketplace.searchPlaceholder')}
            aria-label={t('marketplace.searchPlaceholder')}
            leftIcon={<SearchGlyph />}
            fullWidth
          />
        </div>
        <div className="mkt__sort">
          <Select
            options={sortOptions}
            value={sort}
            onChange={(v) => onSortChange((Array.isArray(v) ? v[0] : v) as CatalogSort)}
            ariaLabel={t('marketplace.sort.label')}
            size="md"
            fullWidth
          />
        </div>
      </div>

      <div className="mkt__chips" role="group" aria-label={t('marketplace.categoryFilter')}>
        {(['all', ...MARKETPLACE_CATEGORIES] as const).map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={category === c}
            onClick={() => onCategoryChange(c)}
            className={`mkt__chip${category === c ? ' mkt__chip--active' : ''}`}
          >
            {t(`marketplace.categories.${c}`)}
          </button>
        ))}
      </div>

      {catalog.length > 0 && (
        <p className="mkt__result-count" role="status">
          {t('marketplace.states.resultCount', { count: catalog.length })}
        </p>
      )}

      {body}
    </div>
  );
};
