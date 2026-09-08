/**
 * PLACE DE MARCHÉ — l'étage « Modèles de mise en page ».
 *
 * ── CE QU'IL EST EN v1, ET CE QU'IL SERA ────────────────────────────────────
 *
 * Il n'y a PAS de serveur pour les modèles. Le partage se fait par fichier
 * (`.filarrlayout`) : on exporte le sien, on l'envoie comme on veut, l'autre
 * l'ouvre. Cet écran liste donc ce qu'on a IMPORTÉ, localement — et il le dit,
 * plutôt que de faire semblant d'être un catalogue vide.
 *
 * La v2 en ligne (table D1 + points d'entrée) viendra se brancher ici sans rien
 * réécrire : la coquille (`artifactKinds`), la validation
 * (`services/layouts/layoutValidator.ts`, déjà pure et partageable avec le
 * worker) et l'application (`useApplyLayoutFile`) sont les mêmes. Ce qui
 * changera est la SOURCE de la liste, et rien d'autre.
 *
 * ── AUCUNE DONNÉE SERVIE N'EST DE CONFIANCE ─────────────────────────────────
 *
 * Nom, description, icône, catégorie viennent d'un fichier écrit par quelqu'un
 * d'autre. Rendus en texte brut (React échappe), jamais en HTML ; l'icône passe
 * par un `<bdi>` — même règle que les fiches d'extensions.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { Button } from '../ui/Button/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { ImportLayoutDialog, type ImportSource } from '../home/ImportLayoutDialog';
import { knownCoreTypes } from '../home/layoutTransfer';
import {
  listLayoutLibrary,
  removeFromLayoutLibrary,
  subscribeLayoutLibrary,
  type LibraryEntry,
} from '../../../services/layouts/layoutLibrary';
import { EmptyPanel } from './MarketplaceNotices';
import { BoxGlyph } from './icons';
import './marketplace.css';

export const LayoutTemplatesPanel: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const known = useMemo(() => knownCoreTypes(), []);

  const [entries, setEntries] = useState<LibraryEntry[]>(() => listLayoutLibrary(known));
  const [dialog, setDialog] = useState<{ open: boolean; source: ImportSource | null }>({
    open: false,
    source: null,
  });
  const [pendingRemove, setPendingRemove] = useState<LibraryEntry | null>(null);

  // La bibliothèque est écrite depuis DEUX écrans (celui-ci et la boîte
  // d'import de l'accueil) : un rafraîchissement au montage seul aurait laissé
  // cette liste périmée après un import fait ailleurs.
  useEffect(() => {
    const refresh = (): void => setEntries(listLayoutLibrary(known));
    refresh();
    return subscribeLayoutLibrary(refresh);
  }, [known]);

  const openFile = useCallback(() => setDialog({ open: true, source: null }), []);

  const preview = useCallback(
    (entry: LibraryEntry) => setDialog({ open: true, source: { kind: 'file', file: entry.file } }),
    []
  );

  const confirmRemove = useCallback(() => {
    const target = pendingRemove;
    setPendingRemove(null);
    if (!target) return;
    removeFromLayoutLibrary(target.file.id, known);
    setEntries(listLayoutLibrary(known));
  }, [pendingRemove, known]);

  return (
    <div className="mkt-layouts">
      <div className="mkt-layouts__bar">
        <p className="mkt-layouts__lead">{t('layouts.market.lead')}</p>
        <Button variant="primary" size="sm" onClick={openFile}>
          {t('layouts.market.importFile')}
        </Button>
      </div>

      {entries.length === 0 ? (
        <EmptyPanel
          glyph={<BoxGlyph />}
          title={t('layouts.market.emptyTitle')}
          text={t('layouts.market.emptyText')}
          actions={[{ label: t('layouts.market.importFile'), onClick: openFile }]}
        />
      ) : (
        <ul className="mkt-layouts__grid">
          {entries.map((entry) => (
            <li key={entry.file.id} className="mkt-layouts__card">
              <div className="mkt-layouts__head">
                {entry.file.icon && (
                  <span className="mkt-layouts__icon" aria-hidden="true">
                    <bdi>{entry.file.icon}</bdi>
                  </span>
                )}
                <div className="mkt-layouts__identity">
                  <p className="mkt-layouts__name">{entry.file.name}</p>
                  <p className="mkt-layouts__meta">
                    {t('layouts.market.blocks', { count: entry.file.widgets.length })}
                    {entry.file.category ? ` · ${entry.file.category}` : ''}
                  </p>
                </div>
              </div>
              {entry.file.description !== '' && (
                <p className="mkt-layouts__description">{entry.file.description}</p>
              )}
              <div className="mkt-layouts__actions">
                <Button variant="secondary" size="sm" onClick={() => preview(entry)}>
                  {t('layouts.market.preview')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingRemove(entry)}>
                  {t('layouts.market.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ImportLayoutDialog
        isOpen={dialog.open}
        source={dialog.source}
        onClose={() => setDialog({ open: false, source: null })}
        // Appliquer depuis ici doit MONTRER le résultat : rester sur la place de
        // marché après avoir changé d'accueil laisserait croire que rien ne
        // s'est passé.
        onApplied={() => navigate('/')}
      />

      <ConfirmModal
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={confirmRemove}
        title={t('layouts.market.removeTitle')}
        message={t('layouts.market.removeMessage', { name: pendingRemove?.file.name ?? '' })}
        confirmText={t('layouts.market.remove')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </div>
  );
};

export default LayoutTemplatesPanel;
