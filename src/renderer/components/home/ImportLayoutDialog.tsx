/**
 * IMPORTER UN MODÈLE — l'aperçu, puis un bouton « Appliquer » explicite.
 *
 * ── OUVRIR N'EST PAS APPLIQUER ──────────────────────────────────────────────
 *
 * Double-cliquer un `.filarrlayout` reçu par courriel ouvre CET écran, et rien
 * d'autre ne se produit. Un fichier venu de l'extérieur qui reconfigurerait
 * l'accueil au seul fait d'avoir été ouvert serait la définition même du piège
 * — et le geste « je regarde ce que c'est » deviendrait irréversible.
 *
 * ── L'APERÇU EST RENDU PAR LE VRAI MOTEUR ───────────────────────────────────
 *
 * `GridSurface`, le même que l'accueil, avec le même solveur : ce qu'on voit
 * ici est exactement la géométrie qui sera posée. Une maquette dessinée à part
 * aurait fini par mentir — c'est arrivé partout où on a essayé.
 *
 * Le CONTENU des tuiles, lui, est un nom de bloc et pas le bloc réel. Monter
 * les vrais widgets afficherait MES notes et MES dossiers dans l'aperçu d'un
 * modèle qui, par construction, n'en contient aucun : on croirait que le
 * fichier les transporte.
 *
 * ── LE RÉCAPITULATIF EST HONNÊTE ────────────────────────────────────────────
 *
 * « 12 appliqués, 1 en attente, 1 ignoré » — les trois nombres, toujours, même
 * quand les deux derniers valent zéro. Un import qui ne dirait que le premier
 * ferait disparaître des blocs en silence.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/Button/Button';
import { Modal, ModalBody, ModalFooter, ModalHeader } from '../ui/Modal';
import { useNotification } from '../ui/Notification';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { setTheme } from '../../../store/slices/uiSlice';
import { GridSurface } from '../grid/GridSurface';
import { GRID_COLUMNS, type GridPlacement } from '../grid/gridTypes';
import { readLayoutFile } from '../../../services/layouts/layoutFileIo';
import {
  compareAppVersions,
  coreWidgetId,
  type LayoutFile,
} from '../../../services/layouts/layoutFormat';
import { saveToLayoutLibrary } from '../../../services/layouts/layoutLibrary';
import { applyAppFont } from '../../../services/platform/appFonts';
import {
  importSummary,
  validateLayoutFile,
  type LayoutValidation,
} from '../../../services/layouts/layoutValidator';
import { currentAppVersion, knownCoreTypes, requiredAppVersion } from './layoutTransfer';
import { useApplyLayoutFile } from './useApplyLayoutFile';
import { resolveWidget } from './widgetRegistry';
import './layoutTransfer.css';

/** Ce qu'on donne à la boîte : du texte brut à valider, ou un modèle déjà relu. */
export type ImportSource =
  | { kind: 'raw'; content: string; fileName: string }
  | { kind: 'file'; file: LayoutFile };

export interface ImportLayoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** `null` ⇒ la boîte ouvre elle-même le sélecteur de fichier. */
  source: ImportSource | null;
  /** Appelé après une application réussie (l'accueil doit être montré). */
  onApplied?: (viewId: string) => void;
}

/** Le nom donné à la mise en page créée : « Accueil — Focus ». */
function viewNameFor(file: LayoutFile, prefix: string): string {
  return `${prefix} — ${file.name}`;
}

export const ImportLayoutDialog: React.FC<ImportLayoutDialogProps> = ({
  isOpen,
  onClose,
  source,
  onApplied,
}) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError, notify } = useNotification();
  const dispatch = useDispatch<AppDispatch>();
  const applyLayout = useApplyLayoutFile();

  const known = useMemo(() => knownCoreTypes(), []);
  const [result, setResult] = useState<LayoutValidation | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * La validation part de la SOURCE, à chaque ouverture. Sans source, on ouvre
   * le sélecteur : c'est le cas de l'entrée « Importer une mise en page… », qui
   * n'a rien à donner tant que l'utilisateur n'a pas choisi son fichier.
   */
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setSourceName('');
      return;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (source?.kind === 'file') {
        // Le fichier vient de la bibliothèque : il a DÉJÀ été validé à
        // l'entrée, et il repasse quand même. Deux raisons : la partition
        // (connu / inconnu) dépend de CETTE version — un bloc inconnu hier peut
        // exister aujourd'hui — et rien ne garantit que ce qui dort dans le
        // stockage du navigateur n'a pas été modifié depuis.
        if (!cancelled) {
          setResult(validateLayoutFile(JSON.stringify(source.file), { knownTypes: known }));
        }
        return;
      }
      if (source?.kind === 'raw') {
        if (!cancelled) {
          setSourceName(source.fileName);
          setResult(validateLayoutFile(source.content, { knownTypes: known }));
        }
        return;
      }
      const read = await readLayoutFile();
      if (cancelled) return;
      if (read.status === 'canceled') {
        onClose();
        return;
      }
      if (read.status === 'error') {
        notifyError(t('layouts.import.readFailed'));
        onClose();
        return;
      }
      setSourceName(read.value.fileName);
      setResult(validateLayoutFile(read.value.content, { knownTypes: known }));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, source, known, onClose, notifyError, t]);

  const ok = result?.status === 'ok' ? result : null;
  const summary = ok ? importSummary(ok) : null;

  /** L'aperçu : la géométrie du fichier, dans le moteur qui la rendra. */
  const placements = useMemo<GridPlacement[]>(
    () =>
      (ok?.file.widgets ?? []).map((widget) => ({
        id: widget.uid,
        x: widget.x,
        y: widget.y,
        w: widget.w,
        h: widget.h,
      })),
    [ok]
  );

  const renderPreviewItem = useCallback(
    (id: string) => {
      const widget = ok?.file.widgets.find((entry) => entry.uid === id);
      if (!widget) return null;
      const coreId = coreWidgetId(widget.type);
      const definition = coreId ? resolveWidget(coreId) : null;
      const label = definition ? t(definition.titleKey) : (widget.title ?? coreId ?? widget.type);
      return (
        <div
          className={['layout-preview__tile', definition ? '' : 'layout-preview__tile--pending']
            .filter(Boolean)
            .join(' ')}
        >
          <span className="layout-preview__label">{label}</span>
          {!definition && (
            <span className="layout-preview__badge">{t('layouts.import.pendingBadge')}</span>
          )}
        </div>
      );
    },
    [ok, t]
  );

  const needsVersion = useMemo(() => {
    if (!ok) return null;
    const required = requiredAppVersion(ok.file);
    if (!required) return null;
    const current = currentAppVersion() ?? '';
    if (current === '') return null;
    return compareAppVersions(required, current) > 0 ? required : null;
  }, [ok]);

  const doApply = useCallback(() => {
    if (!ok) return;
    setBusy(true);
    try {
      const name = viewNameFor(ok.file, t('layouts.import.viewPrefix'));
      const applied = applyLayout(ok.file, name);
      // Appliquer RANGE aussi le modèle : on vient de décider qu'il valait la
      // peine, et le retrouver plus tard ne doit pas demander de retrouver le
      // fichier.
      saveToLayoutLibrary(ok.file, known, sourceName || undefined);
      /**
       * LE THEME EST PROPOSE, PAS APPLIQUE.
       *
       * Un modele peut suggerer un theme et une police. Les poser d'office
       * ferait d'un essai de disposition une reconfiguration de l'application,
       * et il faudrait ensuite deviner comment revenir en arriere. On le met
       * donc dans le message, a portee de clic, et rien ne bouge sans geste.
       */
      if (ok.file.theme) {
        const suggestion = ok.file.theme;
        notify({
          type: 'info',
          message: t('layouts.import.themeOffered'),
          duration: 12_000,
          action: {
            label: t('layouts.import.themeApply'),
            onClick: () => {
              dispatch(setTheme(suggestion.themeId as never));
              // `applyAppFont` VALIDE, POSE et retient. Le code d'avant se
              // contentait d'ecrire la chaine dans le stockage : un identifiant
              // inconnu (une police retiree, ou venue d'une version plus
              // recente) s'y installait sans jamais etre applique, et l'export
              // suivant le propageait. Et meme un identifiant valide ne prenait
              // effet qu'au redemarrage, alors que le bouton dit « Appliquer ».
              applyAppFont(suggestion.fontId);
            },
          },
        });
      }

      notifySuccess(
        t('layouts.import.applied', {
          name: applied.name,
          applied: summary?.applied ?? 0,
          pending: summary?.pending ?? 0,
          ignored: summary?.ignored ?? 0,
        })
      );
      onApplied?.(applied.viewId);
      onClose();
    } finally {
      setBusy(false);
    }
  }, [
    ok,
    applyLayout,
    t,
    known,
    sourceName,
    summary,
    notifySuccess,
    notify,
    dispatch,
    onApplied,
    onClose,
  ]);

  const doKeepOnly = useCallback(() => {
    if (!ok) return;
    saveToLayoutLibrary(ok.file, known, sourceName || undefined);
    notifySuccess(t('layouts.import.stored', { name: ok.file.name }));
    onClose();
  }, [ok, known, sourceName, notifySuccess, t, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg">
      <ModalHeader onClose={onClose}>{t('layouts.import.title')}</ModalHeader>
      <ModalBody>
        {result === null && <p className="layout-transfer__hint">{t('layouts.import.reading')}</p>}

        {result?.status === 'error' && (
          <div className="layout-transfer__error" role="alert">
            <p className="layout-transfer__error-title">{t('layouts.import.refused')}</p>
            {/* La RAISON, jamais « fichier invalide » : chaque code a sa phrase,
                et celui qui a fabriqué le fichier doit pouvoir le corriger. */}
            <p className="layout-transfer__error-reason">
              {t(`layouts.import.errors.${result.code}`)}
            </p>
          </div>
        )}

        {ok && (
          <>
            <div className="layout-transfer__head">
              {ok.file.icon && (
                <span className="layout-transfer__icon" aria-hidden="true">
                  <bdi>{ok.file.icon}</bdi>
                </span>
              )}
              <div>
                <p className="layout-transfer__name">{ok.file.name}</p>
                {ok.file.description !== '' && (
                  <p className="layout-transfer__description">{ok.file.description}</p>
                )}
              </div>
            </div>

            <p className="layout-transfer__summary">
              {t('layouts.import.summary', {
                applied: summary?.applied ?? 0,
                pending: summary?.pending ?? 0,
                ignored: summary?.ignored ?? 0,
              })}
            </p>

            {needsVersion && (
              <p className="layout-transfer__hint">
                {t('layouts.import.needsVersion', { version: needsVersion })}
              </p>
            )}

            {ok.file.theme && (
              // SUGGESTION, jamais imposée : on la dit, et on dit qu'elle n'est
              // pas appliquée. Changer le thème de quelqu'un parce qu'il essaie
              // une disposition serait une reconfiguration qu'il n'a pas demandée.
              <p className="layout-transfer__hint">
                {t('layouts.import.themeSuggestion', {
                  theme: ok.file.theme.themeId,
                  font: ok.file.theme.fontId,
                })}
              </p>
            )}

            <div className="layout-preview">
              <GridSurface
                layout={placements}
                renderItem={renderPreviewItem}
                // DOUZE COLONNES FORCÉES : l'aperçu montre la disposition
                // MAÎTRESSE, celle que l'auteur a dessinée. Laisser la boîte se
                // replier à six montrerait une projection — vraie, mais pas
                // celle qu'on est en train d'accepter.
                columnsOverride={GRID_COLUMNS}
                rowHeight={28}
                gutter={6}
                className="layout-preview__grid"
              />
            </div>

            <p className="layout-transfer__hint">{t('layouts.import.noOverwrite')}</p>
          </>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="tertiary" size="sm" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        {ok && (
          <Button variant="secondary" size="sm" onClick={doKeepOnly} disabled={busy}>
            {t('layouts.import.keepOnly')}
          </Button>
        )}
        {ok && (
          <Button variant="primary" size="sm" onClick={doApply} disabled={busy}>
            {t('layouts.import.apply')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ImportLayoutDialog;
