/**
 * LayoutMarketCard — une ligne du catalogue de modèles.
 *
 * Même grammaire visuelle que `PluginCard`, et volontairement : les deux étages
 * de la place de marché se parcourent avec le même œil, et deux mises en forme
 * pour la même question (« qu'est-ce que c'est, et est-ce que je l'ai ? »)
 * feraient croire à deux fonctions différentes.
 *
 * ── CE QU'UNE LIGNE DIT, DANS CET ORDRE ─────────────────────────────────────
 *
 *   1. son nom et ce qu'elle fait ;
 *   2. son état chez MOI (installé / mise à jour disponible) ;
 *   3. qui l'a signée, en français ;
 *   4. le reste (version, téléchargements), en gris, à la fin.
 *
 * ── TOUT CE QUI VIENT DU SERVEUR EST DU TEXTE ATTAQUANT ─────────────────────
 *
 * Nom, description, icône et catégorie sont des colonnes NON SIGNÉES de D1 (le
 * worker les duplique pour trier sans analyser cinquante enveloppes). Ils sont
 * donc rendus en texte brut par React, l'icône écrêtée en points de code et
 * isolée dans un `<bdi>` — un emoji peut embarquer des marques
 * bidirectionnelles qui, sans isolation, retournent le texte VOISIN.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui';
import { normalizeLayoutCategory } from '../../../services/layouts/layoutMarketTypes';
import { MarketIcon } from './MarketIcon';
import type { LayoutMarketSummary } from '../../../services/layouts/layoutMarketApi';
import type { LayoutEntryVerdict } from '../../../services/layouts/layoutMarketInstall';
import { PublisherLine } from './PublisherLine';
import { isOfficialPublisher, type PublisherTrust } from './trustModel';
import './marketplace.css';

export interface LayoutMarketCardProps {
  template: LayoutMarketSummary;
  verdict: LayoutEntryVerdict;
  trust: PublisherTrust;
  busy: boolean;
  /** `false` ⇒ pas de compte nuage : l'action principale disparaît, elle mentirait. */
  canInstall: boolean;
  onInstall: () => void;
  onReport: () => void;
  /** Ouvrir la fiche — le nom et la vignette y menent. */
  onOpen: () => void;
}

export const LayoutMarketCard: React.FC<LayoutMarketCardProps> = ({
  template,
  verdict,
  trust,
  busy,
  canInstall,
  onInstall,
  onReport,
  onOpen,
}) => {
  const { t } = useTranslation();
  const category = normalizeLayoutCategory(template.category);
  const official = isOfficialPublisher(template.publisherFingerprint);

  /** Une seule action par ligne, et elle dépend de l'état. */
  const primary =
    verdict.state === 'available'
      ? { label: t('layouts.market.discover.install'), variant: 'secondary' as const }
      : verdict.state === 'update'
        ? { label: t('layouts.market.discover.update'), variant: 'primary' as const }
        : null;

  return (
    <li className={['mkt-row', official ? 'mkt-row--official' : ''].filter(Boolean).join(' ')}>
      <button type="button" className="mkt-row__open" onClick={onOpen}>
        <MarketIcon icon={template.icon} className="mkt-row__icon" />

        <span className="mkt-row__body">
          <span className="mkt-row__title">
            <span className="mkt-row__name">{template.name}</span>
            {verdict.state !== 'available' && (
              <span
                className={`mkt-badge mkt-badge--${verdict.state === 'update' ? 'info' : 'ok'}`}
              >
                {t(`layouts.market.discover.state.${verdict.state}`)}
              </span>
            )}
            {/*
              LE BADGE DIT POUR QUI, ET C'EST TOUT L'ENJEU.

              Le catalogue sert au proprietaire ses PROPRES fiches retirees —
              sinon retirer une fiche reviendrait a la perdre, sans moyen de la
              retrouver pour la republier. Mais un simple « depubliee » sur une
              ligne qui s'affiche encore se lit comme « le retrait n'a pas
              marche ». Dire que personne d'autre ne la voit change tout.
            */}
            {template.status === 'unlisted' && (
              <span className="mkt-badge mkt-badge--muted">
                {t(
                  template.ownedByMe
                    ? 'layouts.market.discover.unlistedOwn'
                    : 'marketplace.unlistedBadge'
                )}
              </span>
            )}
          </span>

          <span className="mkt-row__desc">{template.description}</span>

          <span className="mkt-row__foot">
            <PublisherLine author={template.author} fingerprint={template.publisherFingerprint} />
            <span className="mkt-meta">
              {t('marketplace.card.version', { version: template.latestVersion })}
            </span>
            <span className="mkt-meta">
              {t('marketplace.downloads', { count: template.downloads })}
            </span>
            <span className="mkt-tag">{t(`layouts.market.categories.${category}`)}</span>
            <span className="mkt-tag">{t(`layouts.market.targets.${template.target}`)}</span>
          </span>
        </span>
      </button>

      <span className="mkt-row__aside">
        {primary && canInstall && (
          <Button size="sm" variant={primary.variant} loading={busy} onClick={onInstall}>
            {primary.label}
          </Button>
        )}
      </span>
    </li>
  );
};

export default LayoutMarketCard;
