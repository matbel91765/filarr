/**
 * EXPORTER SA MISE EN PAGE — l'écran d'assainissement.
 *
 * ── L'ÉCRAN EXISTE POUR UNE SEULE RAISON ────────────────────────────────────
 *
 * Une mise en page contient NATURELLEMENT le contenu de son auteur : le dossier
 * qu'il a épinglé, le coffre qu'il regarde, la recherche qu'il a enregistrée.
 * Un export « en un clic » aurait donc été un partage de coffre déguisé en
 * partage de disposition — le pire genre de fuite, celui que personne ne
 * soupçonne parce que l'objet partagé a l'air inoffensif.
 *
 * Le TABLEAU RÉCAPITULATIF est donc obligatoire, et il est montré AVANT que le
 * fichier n'existe. Une ligne par liaison, deux issues :
 *
 *   · VIDER — le bloc arrivera non lié chez l'autre ;
 *   · GARDER COMME EMPLACEMENT NOMMÉ — on transporte un LIBELLÉ (« Votre
 *     dossier de projets ») et ce que l'emplacement accepte, jamais
 *     l'identifiant. Celui qui importe verra un bloc qui demande à être branché.
 *
 * Une requête en TEXTE LIBRE n'a pas le choix : elle est toujours vidée. Un
 * emplacement se remplit en désignant un objet ; une recherche, elle, EST du
 * contenu, et il n'existe aucune façon de la transporter sans la transporter.
 *
 * ── CE QUE CET ÉCRAN NE PROMET PAS ──────────────────────────────────────────
 *
 * Il ne prétend pas être la garantie. La garantie est STRUCTURELLE et vit à
 * l'import (`layoutValidator.ts`), qui refuse tout fichier dont une liaison
 * porterait un identifiant — y compris un fichier écrit à la main qui n'aurait
 * jamais vu cet écran.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from '../ui/Button/Button';
import { Checkbox } from '../ui/Checkbox';
import { Input } from '../ui/Input';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import { useNotification } from '../ui/Notification';
import type { RootState } from '../../../store';
import type { LayoutSlot } from '../../../services/layout/layoutTypes';
import { saveLayoutFile } from '../../../services/layouts/layoutFileIo';
import { exportableAppFontId } from '../../../services/platform/appFonts';
import {
  buildLayoutFile,
  currentAppVersion,
  planLayoutExport,
  type ExportBindingRow,
} from './layoutTransfer';
import './layoutTransfer.css';

export interface ExportLayoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** La disposition à exporter — celle qui est à l'écran, pas celle du disque. */
  slots: readonly LayoutSlot[];
  /** Nom proposé : celui de la mise en page courante. */
  defaultName: string;
}

export const ExportLayoutDialog: React.FC<ExportLayoutDialogProps> = ({
  isOpen,
  onClose,
  slots,
  defaultName,
}) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const theme = useSelector((state: RootState) => state.ui.theme);

  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [suggestTheme, setSuggestTheme] = useState(false);
  const [rows, setRows] = useState<ExportBindingRow[]>([]);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => planLayoutExport(slots, (key) => t(key)),
    // `t` change d'identité au changement de langue, ce qui est exactement quand
    // ce plan doit être recalculé : ses libellés par défaut sont traduits.
    [slots, t]
  );

  /**
   * Les lignes repartent du plan à CHAQUE ouverture. Garder les arbitrages d'un
   * export précédent ferait qu'un second export, sur une disposition modifiée,
   * emporterait des décisions prises pour d'autres blocs — et personne ne
   * relirait un tableau qu'il croit déjà avoir rempli.
   */
  useEffect(() => {
    if (!isOpen) return;
    setRows(plan.rows);
    setName(defaultName);
    setDescription('');
    setSuggestTheme(false);
  }, [isOpen, plan.rows, defaultName]);

  const setRow = useCallback((index: number, patch: Partial<ExportBindingRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const kept = rows.filter((row) => row.choice === 'slot').length;

  const doExport = useCallback(async () => {
    setBusy(true);
    try {
      const file = buildLayoutFile(
        slots,
        rows,
        {
          name: name.trim() || defaultName,
          description,
          target: 'home',
          appVersion: currentAppVersion(),
          ...(suggestTheme ? { theme: { themeId: theme, fontId: exportableAppFontId() } } : {}),
        },
        (key) => t(key)
      );
      const result = await saveLayoutFile(file);
      if (result.status === 'ok') {
        notifySuccess(t('layouts.export.done', { count: file.widgets.length }));
        onClose();
      } else if (result.status === 'error') {
        notifyError(t('layouts.export.failed'));
      }
    } finally {
      setBusy(false);
    }
  }, [
    slots,
    rows,
    name,
    defaultName,
    description,
    suggestTheme,
    theme,
    t,
    notifySuccess,
    notifyError,
    onClose,
  ]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>{t('layouts.export.title')}</ModalHeader>
      <ModalBody>
        <p className="layout-transfer__lead">{t('layouts.export.lead')}</p>

        <div className="layout-transfer__fields">
          <Input
            label={t('layouts.export.nameLabel')}
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            fullWidth
          />
          <Input
            label={t('layouts.export.descriptionLabel')}
            value={description}
            maxLength={600}
            placeholder={t('layouts.export.descriptionPlaceholder')}
            onChange={(event) => setDescription(event.target.value)}
            fullWidth
          />
        </div>

        {/* LE TABLEAU. Il n'apparaît que s'il y a quelque chose à arbitrer —
            une disposition sans la moindre liaison n'a rien à faire relire. */}
        {rows.length > 0 ? (
          <section className="layout-transfer__section">
            <h3 className="layout-transfer__heading">{t('layouts.export.bindingsTitle')}</h3>
            <p className="layout-transfer__hint">{t('layouts.export.bindingsHint')}</p>
            <ul className="layout-transfer__rows">
              {rows.map((row, index) => (
                <li key={`${row.slotId}:${row.key}`} className="layout-transfer__row">
                  <div className="layout-transfer__row-head">
                    <span className="layout-transfer__row-widget">{row.widgetTitle}</span>
                    <span className="layout-transfer__row-key">{row.key}</span>
                  </div>

                  {row.lock ? (
                    // Pas de choix, et la raison est DITE : « toujours vidé »
                    // sans explication ressemblerait à une limitation technique.
                    <p className="layout-transfer__row-locked">
                      {row.lock === 'free-text'
                        ? t('layouts.export.lockedFreeText')
                        : t('layouts.export.lockedUnknown')}
                    </p>
                  ) : (
                    <div className="layout-transfer__row-choice">
                      <Button
                        variant={row.choice === 'clear' ? 'secondary' : 'tertiary'}
                        size="sm"
                        aria-pressed={row.choice === 'clear'}
                        onClick={() => setRow(index, { choice: 'clear' })}
                      >
                        {t('layouts.export.choiceClear')}
                      </Button>
                      <Button
                        variant={row.choice === 'slot' ? 'secondary' : 'tertiary'}
                        size="sm"
                        aria-pressed={row.choice === 'slot'}
                        onClick={() => setRow(index, { choice: 'slot' })}
                      >
                        {t('layouts.export.choiceSlot')}
                      </Button>
                      {row.choice === 'slot' && (
                        <Input
                          aria-label={t('layouts.export.labelAria', { widget: row.widgetTitle })}
                          value={row.label}
                          maxLength={80}
                          size="sm"
                          onChange={(event) => setRow(index, { label: event.target.value })}
                        />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="layout-transfer__hint">{t('layouts.export.noBindings')}</p>
        )}

        <Checkbox
          label={t('layouts.export.suggestTheme')}
          checked={suggestTheme}
          onChange={(event) => setSuggestTheme(event.target.checked)}
        />
        <p className="layout-transfer__hint">{t('layouts.export.suggestThemeHint')}</p>

        {plan.skipped > 0 && (
          <p className="layout-transfer__hint">
            {t('layouts.export.skipped', { count: plan.skipped })}
          </p>
        )}
      </ModalBody>
      <ModalFooter>
        <span className="layout-transfer__summary">
          {t('layouts.export.summary', { widgets: plan.widgets, slots: kept })}
        </span>
        <Button variant="tertiary" size="sm" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" size="sm" onClick={() => void doExport()} disabled={busy}>
          {t('layouts.export.confirm')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ExportLayoutDialog;
