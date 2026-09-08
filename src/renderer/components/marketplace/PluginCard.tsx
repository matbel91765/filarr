/**
 * PluginCard — une ligne du catalogue.
 *
 * ── CE QU'UNE LIGNE DOIT DIRE, DANS CET ORDRE ───────────────────────────────
 *
 *   1. son nom et ce qu'elle fait (description) ;
 *   2. son état chez MOI (installée / à mettre à jour / cassée / désactivée) ;
 *   3. qui l'a signée, en français ;
 *   4. le reste (téléchargements, version), en gris, à la fin.
 *
 * L'ancienne carte disait 4, 4, 4 et jamais 2 ni 3 : version, téléchargements et
 * empreinte, tous trois en douze pixels monospace sur la même ligne, séparés par
 * des points médians. L'état d'installation se déduisait de la forme du bouton.
 *
 * ── UNE SEULE ACTION PAR LIGNE ──────────────────────────────────────────────
 *
 * « Signaler » et « Dépublier » avaient ici le même poids visuel qu'« Installer ».
 * Une action rare et socialement lourde ne se met pas à portée de clic distrait :
 * elles vivent désormais dans la fiche, où l'on arrive avec une intention.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import {
  clampIcon,
  normalizeCategory,
  type MarketplacePluginSummary,
} from '../../../services/plugins/marketplaceTypes';
import { ENTRY_TONE, type EntryVerdict } from './entryState';
import { EntryBadge } from './EntryBadge';
import { TrustLine } from './TrustLine';
import { isOfficialPublisher, type PublisherTrust } from './trustModel';
import './marketplace.css';

export interface PluginCardProps {
  plugin: MarketplacePluginSummary;
  verdict: EntryVerdict;
  trust: PublisherTrust;
  selected: boolean;
  busy: boolean;
  /** `false` ⇒ pas de compte nuage : l'action principale disparaît, elle mentirait. */
  canInstall: boolean;
  onOpen: () => void;
  onPrimaryAction: () => void;
}

export const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  verdict,
  trust,
  selected,
  busy,
  canInstall,
  onOpen,
  onPrimaryAction,
}) => {
  const { t } = useTranslation();
  const tone = ENTRY_TONE[verdict.state];
  /**
   * L'icône SERVIE est du texte attaquant : écrêtée en points de code, rendue en
   * texte brut par React, et isolée dans un <bdi> — un emoji peut embarquer des
   * marques bidirectionnelles qui, sans isolation, retournent le texte VOISIN.
   */
  const icon = clampIcon(plugin.icon);
  const category = normalizeCategory(plugin.category);

  /** L'action principale dépend de l'état, et il n'y en a jamais deux. */
  const primary =
    verdict.state === 'available'
      ? { label: t('marketplace.install'), variant: 'secondary' as const }
      : verdict.state === 'update'
        ? { label: t('marketplace.update'), variant: 'primary' as const }
        : verdict.state === 'broken'
          ? { label: t('marketplace.action.repair'), variant: 'secondary' as const }
          : null;

  return (
    <li
      className={[
        'mkt-card',
        isOfficialPublisher(plugin.publisherFingerprint) ? 'mkt-row--official' : '',
        selected ? 'mkt-card--selected' : '',
        tone === 'danger' || tone === 'warn' || tone === 'info' ? `mkt-card--${tone}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button type="button" className="mkt-card__open" onClick={onOpen} aria-expanded={selected}>
        <span className="mkt-card__icon" aria-hidden="true">
          {icon ? <bdi>{icon}</bdi> : <bdi>{'▦'}</bdi>}
        </span>
        <span className="mkt-card__main">
          <span className="mkt-card__title-row">
            <span className="mkt-card__name">{plugin.name}</span>
            {/* Le MEME badge que pour les modeles, et adosse a la MEME liste
                d'empreintes : « officiel » ne peut pas vouloir dire deux choses
                selon l'onglet ou l'on se trouve. */}
            {isOfficialPublisher(plugin.publisherFingerprint) && (
              <span className="mkt-publisher__badge">{t('marketplace.publisher.official')}</span>
            )}
            <span className="mkt-tag">{t(`marketplace.categories.${category}`)}</span>
            {plugin.status === 'unlisted' && (
              <span className="mkt-badge mkt-badge--muted">{t('marketplace.unlistedBadge')}</span>
            )}
          </span>
          <span className="mkt-card__desc">{plugin.description}</span>
          <span className="mkt-card__foot">
            <TrustLine trust={trust} />
            <span className="mkt-meta">
              {verdict.state === 'update' && verdict.installedVersion
                ? t('marketplace.card.versionJump', {
                    from: verdict.installedVersion,
                    to: plugin.latestVersion,
                  })
                : t('marketplace.card.version', { version: plugin.latestVersion })}
            </span>
            <span className="mkt-meta">
              {t('marketplace.downloads', { count: plugin.downloads })}
            </span>
          </span>
        </span>
      </button>

      <span className="mkt-card__aside">
        <EntryBadge state={verdict.state} />
        {primary && canInstall && (
          <Button size="sm" variant={primary.variant} loading={busy} onClick={onPrimaryAction}>
            {primary.label}
          </Button>
        )}
      </span>
    </li>
  );
};
