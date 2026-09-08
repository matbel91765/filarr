/**
 * LE SÉLECTEUR DE MISES EN PAGE — le retour en arrière, en un clic.
 *
 * Il n'existe que parce qu'appliquer un modèle ne remplace rien : chaque
 * application crée une mise en page nommée. Sans cet écran, ces mises en page
 * s'empileraient sans que personne ne puisse revenir à la sienne — la promesse
 * « rien n'est écrasé » se serait retournée en « rien n'est retrouvable ».
 *
 * Trois gestes, pas un de plus : voir, basculer, supprimer. Renommer viendra
 * quand quelqu'un le demandera ; le nom vit dans l'identifiant de la vue, le
 * changer voudrait dire déplacer l'entrée, et ce n'est pas le sujet du jour.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { Button } from '../ui/Button/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Modal, ModalBody, ModalHeader } from '../ui/Modal';
import type { AppDispatch, RootState } from '../../../store';
import { removeView, saveLayoutToDisk } from '../../../store/slices/layoutSlice';
import type { LayoutViewId } from '../../../services/layout/layoutTypes';
import { HOME_VIEW_ID } from './homeLayout';
import { listHomeViews, writeActiveHomeViewId } from './homeViews';
import './layoutTransfer.css';

export interface HomeViewSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  activeViewId: LayoutViewId;
}

export const HomeViewSwitcher: React.FC<HomeViewSwitcherProps> = ({
  isOpen,
  onClose,
  activeViewId,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const views = useSelector((state: RootState) => state.layout.document.views);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  const defaultName = t('layouts.views.default');
  const entries = useMemo(() => listHomeViews(views, defaultName), [views, defaultName]);

  const select = useCallback(
    (id: LayoutViewId) => {
      writeActiveHomeViewId(id);
      onClose();
    },
    [onClose]
  );

  const confirmDelete = useCallback(() => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (!target) return;
    // On bascule AVANT de retirer : supprimer la vue affichée laisserait
    // l'accueil sur un identifiant qui ne désigne plus rien le temps d'un rendu.
    if (target.id === activeViewId) writeActiveHomeViewId(HOME_VIEW_ID);
    dispatch(removeView(target.id));
    void dispatch(saveLayoutToDisk());
  }, [pendingDelete, activeViewId, dispatch]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="md">
        <ModalHeader onClose={onClose}>{t('layouts.views.title')}</ModalHeader>
        <ModalBody>
          <p className="layout-transfer__hint">{t('layouts.views.hint')}</p>
          <ul className="layout-views">
            {entries.map((entry) => (
              <li key={entry.id} className="layout-views__row">
                <button
                  type="button"
                  className={[
                    'layout-views__pick',
                    entry.id === activeViewId ? 'layout-views__pick--active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={entry.id === activeViewId ? 'true' : undefined}
                  onClick={() => select(entry.id)}
                >
                  <span className="layout-views__name">{entry.name}</span>
                  <span className="layout-views__count">
                    {t('layouts.views.blocks', { count: entry.slots })}
                  </span>
                </button>
                {entry.id !== HOME_VIEW_ID && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPendingDelete({ id: entry.id, name: entry.name })}
                  >
                    {t('common.delete')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </ModalBody>
      </Modal>

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t('layouts.views.deleteTitle')}
        message={t('layouts.views.deleteMessage', { name: pendingDelete?.name ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="warning"
      />
    </>
  );
};

export default HomeViewSwitcher;
