/**
 * VaultNotePicker (E3-8c / E3-3c) — pick a team-vault NOTE to embed (transclude) into
 * a personal note. Pick an unlocked vault, then one of its note items; the caller
 * inserts a transclusion node holding only the `vault:<vaultId>:<itemId>` reference
 * (the body is resolved + decrypted live by TransclusionNodeView, never persisted in
 * the host note).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Modal, ModalBody, ModalFooter, Select, Button } from '../ui';
import type { AppDispatch, RootState } from '../../../store';
import {
  selectVaults,
  selectVaultItems,
  ensureVaultsLoaded,
  loadVaultItems,
} from '../../../store/slices/vaultsSlice';

export interface VaultNotePick {
  vaultId: string;
  itemId: string;
  title: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (pick: VaultNotePick) => void;
}

export const VaultNotePicker: React.FC<Props> = ({ isOpen, onClose, onPick }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const vaults = useSelector(selectVaults);
  const unlockedIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);
  const unlockedVaults = useMemo(
    () => vaults.filter((v) => unlockedIds.includes(v.id)),
    [vaults, unlockedIds]
  );

  const [vaultId, setVaultId] = useState('');
  const [itemId, setItemId] = useState('');

  const items = useSelector((s: RootState) => (vaultId ? selectVaultItems(s, vaultId) : []));
  // Ni les MARQUEURS de dossier ni les FILS de fichier : des 'note' par schema,
  // jamais des notes a transclure.
  const noteItems = useMemo(
    () => items.filter((i) => i.itemType === 'note' && !i.meta.folderMarker && !i.meta.threadFor),
    [items]
  );

  // DEUX effets plutôt qu'un, pour que chacun n'ait QUE ses vraies dépendances.
  useEffect(() => {
    if (!isOpen) return;
    setItemId('');
  }, [isOpen]);

  // `ensureVaultsLoaded`, PAS `loadVaults` nu : la garde « une demande par
  // session » vit dans le slice (`initialLoadRequested`). L'ancienne garde
  // locale `vaults.length === 0` était aveugle à un chargement déjà EN COURS
  // et à un chargement déjà ABOUTI SUR UNE LISTE VIDE — un compte sans coffre
  // relançait la requête à chaque ouverture du sélecteur.
  useEffect(() => {
    if (!isOpen) return;
    void dispatch(ensureVaultsLoaded());
  }, [isOpen, dispatch]);

  // Default to the first unlocked vault once the list is available.
  useEffect(() => {
    if (isOpen && !vaultId && unlockedVaults.length > 0) setVaultId(unlockedVaults[0].id);
  }, [isOpen, vaultId, unlockedVaults]);

  // Load the chosen vault's items so its notes are listed.
  useEffect(() => {
    if (isOpen && vaultId) dispatch(loadVaultItems({ vaultId }));
  }, [isOpen, vaultId, dispatch]);

  const handleInsert = () => {
    const item = noteItems.find((i) => i.id === itemId);
    if (!vaultId || !item) return;
    onPick({ vaultId, itemId: item.id, title: item.meta.title || t('teamVaults.items.untitled') });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('teamVaults.transclusion.pickerTitle')}
      size="sm"
    >
      <ModalBody>
        {unlockedVaults.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t('teamVaults.moveToVault.noVaults')}
          </p>
        ) : (
          <div className="space-y-4">
            <Select
              label={t('teamVaults.transclusion.pickVault')}
              options={unlockedVaults.map((v) => ({
                value: v.id,
                label: v.name || t('teamVaults.locked'),
              }))}
              value={vaultId}
              onChange={(v) => {
                setVaultId(Array.isArray(v) ? (v[0] ?? '') : v);
                setItemId('');
              }}
              fullWidth
            />
            {noteItems.length === 0 ? (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t('teamVaults.transclusion.noNotes')}
              </p>
            ) : (
              <Select
                label={t('teamVaults.transclusion.pickNote')}
                options={noteItems.map((i) => ({
                  value: i.id,
                  label: i.meta.title || t('teamVaults.items.untitled'),
                }))}
                value={itemId}
                onChange={(v) => setItemId(Array.isArray(v) ? (v[0] ?? '') : v)}
                fullWidth
              />
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant="primary" onClick={handleInsert} disabled={!itemId}>
          {t('teamVaults.transclusion.insert')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default VaultNotePicker;
