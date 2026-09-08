/**
 * LayoutPublishPanel — mes publications, et l'assistant qui en ajoute une.
 *
 * ── POURQUOI LA LISTE EST AU-DESSUS ─────────────────────────────────────────
 *
 * Publier n'est pas un geste qu'on refait souvent, mais RETROUVER ce qu'on a
 * publié est une question qu'on se pose sans arrêt : « est-ce que c'est encore
 * en ligne ? », « quelle version ai-je envoyée ? ». Sans cette liste, la seule
 * réponse serait de chercher son propre modèle dans le catalogue public.
 *
 * C'est aussi le seul endroit d'où l'on peut RETIRER une fiche. Le retrait est
 * doux : la fiche disparaît du catalogue, aucune version n'est effacée, et ceux
 * qui l'ont déjà installée peuvent toujours la re-vérifier. On le dit dans la
 * confirmation, parce que « retirer » évoque une suppression qui n'a pas lieu.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from '../ui';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useNotification } from '../ui/Notification';
import type { RootState } from '../../../store';
import {
  apiListLayoutMarket,
  apiUnlistLayoutTemplate,
  type LayoutMarketSummary,
} from '../../../services/layouts/layoutMarketApi';
import { LayoutPublishWizard } from './LayoutPublishWizard';
import { MarketIcon } from './MarketIcon';
import { EmptyPanel, ListSkeleton, Notice } from './MarketplaceNotices';
import { BoxGlyph, InfoGlyph, OfflineGlyph } from './icons';
import { useOnlineStatus } from './useOnlineStatus';
// `layout-transfer__heading` vit dans CETTE feuille : sans elle, les deux
// titres de section retombaient sur le style par défaut d'un `<h3>`.
import '../home/layoutTransfer.css';
import './marketplace.css';

export const LayoutPublishPanel: React.FC = () => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const online = useOnlineStatus();
  const signedIn = useSelector((s: RootState) => s.auth.cloudUser?.id != null);

  const [mine, setMine] = useState<LayoutMarketSummary[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [pendingUnlist, setPendingUnlist] = useState<LayoutMarketSummary | null>(null);
  const [busy, setBusy] = useState(false);
  /** La fiche qu'on s'apprete a mettre a jour, reprise par l'assistant. */
  const [prefill, setPrefill] = useState<LayoutMarketSummary | null>(null);

  /**
   * Le catalogue rend DÉJÀ mes fiches retirées (le worker sert `published` plus
   * les siennes, quel que soit leur statut) : il n'y a pas de route « à moi » à
   * ajouter, seulement un filtre à poser sur ce qu'on reçoit.
   */
  const load = useCallback(async (): Promise<void> => {
    if (!signedIn) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    try {
      const rows = await apiListLayoutMarket({});
      setMine(rows.filter((row) => row.ownedByMe));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, [signedIn]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmUnlist = useCallback(async () => {
    const target = pendingUnlist;
    setPendingUnlist(null);
    if (!target) return;
    setBusy(true);
    try {
      await apiUnlistLayoutTemplate(target.slug);
      notifySuccess(t('layouts.publish.unlisted', { name: target.name }));
      await load();
    } catch {
      notifyError(t('layouts.publish.unlistFailed'));
    } finally {
      setBusy(false);
    }
  }, [pendingUnlist, load, notifySuccess, notifyError, t]);

  if (!signedIn) {
    return (
      <Notice
        glyph={<InfoGlyph />}
        title={t('marketplace.signedOut.title')}
        text={t('layouts.publish.signedOut')}
      />
    );
  }

  return (
    <div>
      {!online && (
        <Notice
          glyph={<OfflineGlyph />}
          title={t('marketplace.offline.title')}
          text={t('layouts.publish.offline')}
        />
      )}

      <section className="layout-publish__mine">
        <h3 className="layout-transfer__heading">{t('layouts.publish.mineTitle')}</h3>
        {status === 'loading' && mine.length === 0 ? (
          <ListSkeleton rows={2} label={t('marketplace.states.loading')} />
        ) : mine.length === 0 ? (
          <EmptyPanel
            glyph={<BoxGlyph />}
            title={t('layouts.publish.mineEmptyTitle')}
            text={t('layouts.publish.mineEmptyText')}
          />
        ) : (
          <ul className="mkt-grid">
            {mine.map((row) => (
              <li key={row.slug} className="mkt-tile">
                <MarketIcon icon={row.icon} className="mkt-tile__thumb" />

                <div className="mkt-tile__head">
                  <span className="mkt-tile__name" title={row.name}>
                    {row.name}
                  </span>
                  {row.status === 'unlisted' && (
                    <span className="mkt-badge mkt-badge--muted">
                      {t('marketplace.unlistedBadge')}
                    </span>
                  )}
                </div>

                {/* Le slug est une ADRESSE : monospace, et jamais tronquee au
                    milieu — c'est ce qu'on recopie pour en parler. */}
                <p className="mkt-tile__desc">
                  <code>{row.slug}</code>
                </p>

                <div className="mkt-tile__foot">
                  <span className="mkt-tile__meta">
                    <span className="mkt-meta">
                      {t('marketplace.card.version', { version: row.latestVersion })}
                    </span>
                    <span className="mkt-meta">
                      {t('marketplace.downloads', { count: row.downloads })}
                    </span>
                  </span>
                  {/* METTRE A JOUR : le geste existait, rien ne le disait. Il
                      fallait deviner qu'on republie en retapant a l'identique un
                      identifiant definitif. */}
                  <Button size="sm" variant="secondary" onClick={() => setPrefill(row)}>
                    {t('layouts.publish.newVersion')}
                  </Button>
                  {row.status === 'published' && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      disabled={busy}
                      onClick={() => setPendingUnlist(row)}
                    >
                      {t('layouts.publish.unlist')}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="layout-publish__wizard">
        <h3 className="layout-transfer__heading">{t('layouts.publish.wizardTitle')}</h3>
        <LayoutPublishWizard
          mine={mine}
          prefill={prefill}
          onPublished={() => {
            setPrefill(null);
            void load();
          }}
        />
      </section>

      <ConfirmModal
        isOpen={pendingUnlist !== null}
        onClose={() => setPendingUnlist(null)}
        onConfirm={() => void confirmUnlist()}
        title={t('layouts.publish.unlistTitle')}
        message={t('layouts.publish.unlistMessage', { name: pendingUnlist?.name ?? '' })}
        confirmText={t('layouts.publish.unlist')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </div>
  );
};

export default LayoutPublishPanel;
