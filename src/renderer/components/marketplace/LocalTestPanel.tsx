/**
 * LocalTestPanel — essayer un bundle SANS rien publier.
 *
 * ── POURQUOI C'EST REMONTÉ EN HAUT ──────────────────────────────────────────
 *
 * Cette zone était enterrée sous les huit champs du formulaire de publication,
 * c'est-à-dire APRÈS le geste irréversible qu'elle sert précisément à éviter.
 * Or c'est le PREMIER geste d'un auteur : un slug est définitif, un numéro de
 * version est immuable, et le quota est de dix publications par jour — sans
 * essai local, chaque itération brûlait un numéro de version pour toujours.
 *
 * ── CE QUE ÇA FAIT VRAIMENT ─────────────────────────────────────────────────
 *
 * `registerSandboxedPlugin` ne reçoit qu'une CHAÎNE, jamais exécutée dans
 * l'hôte : le code part dans l'iframe d'origine opaque, CSP sans réseau,
 * exactement comme une extension de la place de marché. Rien n'est signé parce
 * que rien n'est distribué, rien n'est écrit en IndexedDB, et la session referme
 * tout. C'est dit à l'écran, pas seulement en commentaire.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../ui';
import { useNotification } from '../ui/Notification';
import { registerSandboxedPlugin } from '../../../services/plugins/pluginRegistry';
import { extensionConflicts } from './capabilities';
import { EXT_RE, MAX_BUNDLE_BYTES, parseExtensions } from './publishValidation';
import { Notice } from './MarketplaceNotices';
import { FileGlyph, WarnGlyph } from './icons';
import type { DevLocalPlugin } from './MyExtensionsPanel';
import './marketplace.css';

export interface LocalTestPanelProps {
  /** Combien de greffons de session sont déjà montés — numérote `dev-local-<n>`. */
  devLocalCount: number;
  onRegistered: (entry: DevLocalPlugin) => void;
}

export const LocalTestPanel: React.FC<LocalTestPanelProps> = ({ devLocalCount, onRegistered }) => {
  const { t } = useTranslation();
  const { error: notifyError, success: notifySuccess } = useNotification();
  const [bundle, setBundle] = useState<{ name: string; code: string } | null>(null);
  const [extensionsRaw, setExtensionsRaw] = useState('');

  const extList = useMemo(() => parseExtensions(extensionsRaw), [extensionsRaw]);
  const conflicts = useMemo(() => extensionConflicts(extList), [extList]);
  const ready = bundle !== null && extList.length > 0 && extList.every((e) => EXT_RE.test(e));

  const mount = () => {
    if (!bundle || extList.length === 0) return;
    if (!extList.every((e) => EXT_RE.test(e))) {
      notifyError(t('marketplace.devLocal.badExtensions'));
      return;
    }
    const localId = `dev-local-${devLocalCount + 1}`;
    try {
      registerSandboxedPlugin({
        manifest: {
          id: localId,
          name: bundle.name,
          version: '0.0.0-dev',
          trust: 'sandboxed',
          provides: {
            editors: [{ id: `${localId}-editor`, extensions: extList, displayName: bundle.name }],
          },
        },
        code: bundle.code,
      });
    } catch {
      // Le refus le plus probable : une extension déjà revendiquée. Le registre
      // est atomique — rien n'est resté à moitié enregistré.
      notifyError(t('marketplace.devLocal.registerFailed'));
      return;
    }
    onRegistered({ id: localId, name: bundle.name, extensions: extList });
    notifySuccess(t('marketplace.devLocal.mounted'));
    setBundle(null);
    setExtensionsRaw('');
  };

  return (
    <section className="mkt-testbox">
      <h3 className="mkt-group__title">{t('marketplace.devLocal.title')}</h3>
      <p className="mkt-wiz__help" style={{ marginTop: 'var(--spacing-1)' }}>
        {t('marketplace.devLocal.help')}
      </p>

      <div className="mkt-fields" style={{ marginTop: 'var(--spacing-4)' }}>
        <label className={`mkt-drop${bundle ? ' mkt-drop--filled' : ''}`}>
          <FileGlyph className="mkt-drop__glyph" />
          <span className="mkt-drop__title">
            {bundle ? bundle.name : t('marketplace.devLocal.pickBundle')}
          </span>
          <span className="mkt-drop__hint">{t('marketplace.wizard.bundleHint')}</span>
          <input
            type="file"
            accept=".js"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              if (!file) return;
              if (file.size > MAX_BUNDLE_BYTES) {
                notifyError(t('marketplace.errors.bundle_too_large'));
                return;
              }
              void file.text().then((code) => setBundle({ name: file.name, code }));
            }}
          />
        </label>

        <Input
          label={t('marketplace.publish.extensions')}
          value={extensionsRaw}
          onChange={(e) => setExtensionsRaw(e.target.value)}
          placeholder="sbx, memo"
          fullWidth
        />

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

        <div>
          <Button variant="secondary" disabled={!ready} onClick={mount}>
            {t('marketplace.devLocal.mount')}
          </Button>
        </div>
      </div>
    </section>
  );
};
