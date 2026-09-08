/**
 * MyExtensionsPanel — ce que J'AI, et ce qui demande quelque chose de moi.
 *
 * ── LE TRI PAR URGENCE ──────────────────────────────────────────────────────
 *
 * L'ancienne liste était plate : une extension cassée, une extension à mettre à
 * jour et une extension parfaitement saine s'y succédaient dans l'ordre
 * d'IndexedDB, avec la même bordure et la même paire de boutons. Rien ne montait
 * en haut, rien n'appelait — il fallait lire chaque ligne pour trouver celle qui
 * avait un problème.
 *
 * Quatre groupes, du plus exigeant au plus tranquille : à réparer, à mettre à
 * jour, actives, désactivées. Un groupe vide ne s'affiche pas.
 *
 * ── LES ÉTATS DÉSESPÉRÉS ONT MAINTENANT UN BOUTON ───────────────────────────
 *
 * `broken_signature` affichait « réinstallez ce plugin » — et retirait le seul
 * bouton restant, laissant l'utilisateur devant une instruction sans commande.
 * Ici, « Réparer » réinstalle la version épinglée en un geste ; l'explication dit
 * ce qui s'est passé, pas seulement que c'est cassé.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import type { LoadedPluginState } from '../../../services/plugins/installedPlugins';
import { servedExtensions } from './capabilities';
import { installedEntryState, ENTRY_TONE, type EntryVerdict } from './entryState';
import { describePublisher } from './trustModel';
import { EntryBadge, CapabilityList } from './EntryBadge';
import { TrustLine } from './TrustLine';
import { EmptyPanel, Notice } from './MarketplaceNotices';
import { BoxGlyph, DownloadGlyph, InfoGlyph, ShieldAlertGlyph, WarnGlyph } from './icons';
import './marketplace.css';

/** Un greffon monté en TEST LOCAL — de la session, jamais du stockage. */
export interface DevLocalPlugin {
  id: string;
  name: string;
  extensions: string[];
}

export interface MyExtensionsPanelProps {
  installed: LoadedPluginState[];
  /** slug → dernière version en ligne (absent = catalogue non chargé). */
  latestBySlug: Map<string, string>;
  devLocal: DevLocalPlugin[];
  ownFingerprint: string | null;
  signedIn: boolean;
  busySlug: string | null;
  onOpen: (slug: string) => void;
  onInstall: (slug: string, version: string) => void;
  onToggle: (slug: string, enabled: boolean) => void;
  onUninstall: (slug: string) => void;
  onUpdateAll: (targets: { slug: string; version: string }[]) => void;
  onRemoveDevLocal: (id: string) => void;
  onGoDiscover: () => void;
}

interface RowProps {
  entry: LoadedPluginState;
  verdict: EntryVerdict;
  ownFingerprint: string | null;
  installed: LoadedPluginState[];
  busy: boolean;
  onOpen: () => void;
  onInstall: () => void;
  onToggle: () => void;
  onUninstall: () => void;
}

const InstalledRow: React.FC<RowProps> = ({
  entry,
  verdict,
  ownFingerprint,
  installed,
  busy,
  onOpen,
  onInstall,
  onToggle,
  onUninstall,
}) => {
  const { t } = useTranslation();
  const tone = ENTRY_TONE[verdict.state];
  /**
   * Les extensions du REGISTRE, pas celles du catalogue : ici, la question n'est
   * pas « qu'annonce l'auteur » mais « qu'ouvre mon application en ce moment ».
   * Une extension désactivée ou en conflit n'en sert aucune, et la liste vide
   * est alors la bonne réponse.
   */
  const served = servedExtensions(entry.slug);
  const trust = describePublisher(
    entry.publisherFingerprint,
    ownFingerprint,
    installed,
    entry.slug
  );

  return (
    <li
      className={[
        'mkt-row',
        tone === 'danger' || tone === 'warn' || tone === 'info' ? `mkt-row--${tone}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <EntryBadge state={verdict.state} />
      <div style={{ minWidth: 0 }}>
        <p className="mkt-row__name">{entry.name}</p>
        <div className="mkt-row__sub">
          <span className="mkt-meta">
            {verdict.state === 'update' && verdict.latestVersion
              ? t('marketplace.card.versionJump', {
                  from: entry.installedVersion,
                  to: verdict.latestVersion,
                })
              : t('marketplace.card.version', { version: entry.installedVersion })}
          </span>
          <TrustLine trust={trust} />
          {served.length > 0 && <CapabilityList extensions={served} max={5} />}
        </div>
        {verdict.state === 'broken' && (
          <p className="mkt-row__fix">{t('marketplace.broken.explain')}</p>
        )}
        {verdict.state === 'conflict' && (
          <p className="mkt-row__fix">{t('marketplace.conflict.explainGeneric')}</p>
        )}
      </div>
      <div className="mkt-row__actions">
        {verdict.state === 'update' && verdict.latestVersion && (
          <Button size="sm" variant="primary" loading={busy} onClick={onInstall}>
            {t('marketplace.update')}
          </Button>
        )}
        {verdict.state === 'broken' && (
          <Button size="sm" variant="secondary" loading={busy} onClick={onInstall}>
            {t('marketplace.action.repair')}
          </Button>
        )}
        {entry.status !== 'broken_signature' && (
          <Button size="sm" variant="ghost" onClick={onToggle}>
            {entry.enabled ? t('marketplace.disable') : t('marketplace.enable')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {t('marketplace.action.details')}
        </Button>
        <Button size="sm" variant="ghost" loading={busy} onClick={onUninstall}>
          {t('marketplace.uninstall')}
        </Button>
      </div>
    </li>
  );
};

export const MyExtensionsPanel: React.FC<MyExtensionsPanelProps> = ({
  installed,
  latestBySlug,
  devLocal,
  ownFingerprint,
  signedIn,
  busySlug,
  onOpen,
  onInstall,
  onToggle,
  onUninstall,
  onUpdateAll,
  onRemoveDevLocal,
  onGoDiscover,
}) => {
  const { t } = useTranslation();

  const verdicts = installed.map((entry) => ({
    entry,
    verdict: installedEntryState(entry, latestBySlug.get(entry.slug) ?? null),
  }));

  const problems = verdicts.filter(
    (v) => v.verdict.state === 'broken' || v.verdict.state === 'conflict'
  );
  const updates = verdicts.filter((v) => v.verdict.state === 'update');
  const active = verdicts.filter((v) => v.verdict.state === 'installed');
  const disabled = verdicts.filter((v) => v.verdict.state === 'disabled');

  const row = (v: { entry: LoadedPluginState; verdict: EntryVerdict }) => (
    <InstalledRow
      key={v.entry.slug}
      entry={v.entry}
      verdict={v.verdict}
      ownFingerprint={ownFingerprint}
      installed={installed}
      busy={busySlug === v.entry.slug}
      onOpen={() => onOpen(v.entry.slug)}
      onInstall={() => onInstall(v.entry.slug, v.verdict.latestVersion ?? v.entry.installedVersion)}
      onToggle={() => onToggle(v.entry.slug, !v.entry.enabled)}
      onUninstall={() => onUninstall(v.entry.slug)}
    />
  );

  const group = (
    key: string,
    title: string,
    rows: { entry: LoadedPluginState; verdict: EntryVerdict }[],
    head?: React.ReactNode
  ) =>
    rows.length === 0 ? null : (
      <section className="mkt-group" key={key}>
        <div className="mkt-group__head">
          <h3 className="mkt-group__title">{title}</h3>
          {head}
        </div>
        <ul className="mkt-list">{rows.map(row)}</ul>
      </section>
    );

  if (!signedIn) {
    return (
      <EmptyPanel
        glyph={<InfoGlyph />}
        title={t('marketplace.signedOut.title')}
        text={t('marketplace.signedOut.explain')}
      />
    );
  }

  return (
    <div>
      {problems.length > 0 && (
        <Notice
          tone="danger"
          live="alert"
          glyph={<ShieldAlertGlyph />}
          title={t('marketplace.mine.problemsTitle', { count: problems.length })}
          text={t('marketplace.mine.problemsText')}
        />
      )}

      {group(
        'problems',
        t('marketplace.mine.groupProblems'),
        problems,
        <span className="mkt-meta">{t('marketplace.mine.groupProblemsHint')}</span>
      )}

      {group(
        'updates',
        t('marketplace.mine.groupUpdates'),
        updates,
        updates.length > 1 ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() =>
              onUpdateAll(
                updates
                  .filter((u) => u.verdict.latestVersion)
                  .map((u) => ({ slug: u.entry.slug, version: u.verdict.latestVersion as string }))
              )
            }
          >
            {t('marketplace.mine.updateAll', { count: updates.length })}
          </Button>
        ) : undefined
      )}

      {group('active', t('marketplace.mine.groupActive'), active)}
      {group('disabled', t('marketplace.mine.groupDisabled'), disabled)}

      {devLocal.length > 0 && (
        <section className="mkt-group">
          <div className="mkt-group__head">
            <h3 className="mkt-group__title">{t('marketplace.devLocal.title')}</h3>
            <span className="mkt-meta">{t('marketplace.devLocal.sessionHint')}</span>
          </div>
          <ul className="mkt-list">
            {devLocal.map((d) => (
              <li className="mkt-row mkt-row--dashed" key={d.id}>
                <span className="mkt-badge mkt-badge--muted">
                  <span className="mkt-badge__dot" aria-hidden="true" />
                  {t('marketplace.devLocal.badge')}
                </span>
                <div style={{ minWidth: 0 }}>
                  <p className="mkt-row__name">{d.name}</p>
                  <div className="mkt-row__sub">
                    <CapabilityList extensions={d.extensions} max={6} />
                  </div>
                </div>
                <div className="mkt-row__actions">
                  <Button size="sm" variant="ghost" onClick={() => onRemoveDevLocal(d.id)}>
                    {t('marketplace.devLocal.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {installed.length === 0 && devLocal.length === 0 && (
        <EmptyPanel
          glyph={<BoxGlyph />}
          title={t('marketplace.mine.emptyTitle')}
          text={t('marketplace.mine.emptyText')}
          actions={[
            { label: t('marketplace.mine.emptyCta'), onClick: onGoDiscover, variant: 'primary' },
          ]}
        />
      )}

      {installed.length > 0 && updates.length === 0 && problems.length === 0 && (
        <p
          className="mkt-meta"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-2)' }}
        >
          <DownloadGlyph className="mkt-trust__glyph" />
          {t('marketplace.mine.allUpToDate')}
        </p>
      )}
    </div>
  );
};
