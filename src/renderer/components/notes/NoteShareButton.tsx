/**
 * NoteShareButton — « Partager » dans la barre d'outils de l'éditeur de notes.
 *
 * AUTOPORTANT, et c'est le point : `NoteEditor` est un fichier de 3 800 lignes
 * en chantier permanent ; ce bouton n'y ajoute qu'un import et une ligne de
 * rendu. Tout le reste — l'état d'ouverture, le dialogue de partage unifié, le
 * dépôt dans un coffre, l'écoute de la palette — vit ici.
 *
 * UN bouton, DEUX portes (`noteShareGesture`, pur) :
 *  — note JAMAIS déposée → `AddToVaultDialog` (choix du coffre, copier/déplacer) ;
 *  — note DÉJÀ déposée → le dialogue de partage unifié (`useShareDialog`,
 *    cible `personalNote`), qui montre où elle est et propose un second dépôt.
 * L'utilisateur n'a pas à connaître l'histoire de la note pour choisir.
 *
 * LA PALETTE parle par un `CustomEvent` fenêtre (`filarr-share-current-note`),
 * sur le patron de `filarr-style-settings-changed` déjà écouté par l'éditeur :
 * la palette ne connaît ni la note ouverte ni ce composant, et n'a pas à les
 * connaître — elle navigue vers les notes puis lance l'événement ; s'il y a un
 * éditeur monté, il répond.
 *
 * MODE LOCAL (règle du dépôt) : rend `null`. Rien de ce que le bouton ouvre
 * n'existe hors nuage, et un bouton qui mène à une boîte vide serait un mur de
 * vente déguisé. De même pour une note qui n'est pas (ou plus) dans le
 * magasin des notes personnelles : seules celles-là se déposent.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { useShareDialog } from '../sharing/useShareDialog';
import { AddToVaultDialog, type AddToVaultSource } from '../vaults/AddToVaultDialog';
import { noteShareGesture } from './noteShareActionsModel';

/** L'événement fenêtre que la palette lance pour « partager la note ouverte ». */
export const SHARE_CURRENT_NOTE_EVENT = 'filarr-share-current-note';

interface NoteShareButtonProps {
  noteId: string;
  title: string;
  /** Le contenu vu par l'éditeur ; à défaut, celui du magasin. */
  content?: string;
}

/** Une flèche qui sort d'une boîte — le trait des autres glyphes de la barre. */
const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7" />
    <polyline points="16,6 12,2 8,6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </svg>
);

export const NoteShareButton: React.FC<NoteShareButtonProps> = ({ noteId, title, content }) => {
  const { t } = useTranslation();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const isCloud = accountMode === 'cloud';
  const exists = useSelector((s: RootState) => !!s.notes.byId[noteId]);
  const sharedCount = useSelector((s: RootState) => s.notes.byId[noteId]?.sharedTo?.length ?? 0);
  const storedContent = useSelector((s: RootState) => s.notes.byId[noteId]?.content ?? '');
  const { open, overlays } = useShareDialog();
  const [addOpen, setAddOpen] = useState(false);

  const name = title || t('notes.untitled', 'Untitled');

  const trigger = useCallback(() => {
    if (!isCloud || !exists) return;
    if (noteShareGesture(sharedCount) === 'manageSharing') {
      open({ kind: 'personalNote', noteId, name });
    } else {
      setAddOpen(true);
    }
  }, [isCloud, exists, sharedCount, open, noteId, name]);

  // La palette : même patron d'abonnement que `filarr-style-settings-changed`.
  useEffect(() => {
    const onShareCurrent = () => trigger();
    window.addEventListener(SHARE_CURRENT_NOTE_EVENT, onShareCurrent);
    return () => window.removeEventListener(SHARE_CURRENT_NOTE_EVENT, onShareCurrent);
  }, [trigger]);

  // Un passage en mode local pendant que la boîte est ouverte la referme —
  // même discipline que `useShareDialog`.
  useEffect(() => {
    if (!isCloud) setAddOpen(false);
  }, [isCloud]);

  const source = useMemo<AddToVaultSource>(
    () => ({ kind: 'note', id: noteId, title: name, content: content ?? storedContent }),
    [noteId, name, content, storedContent]
  );

  if (!isCloud || !exists) return null;

  const shared = sharedCount > 0;
  return (
    <>
      <button
        type="button"
        onClick={trigger}
        className={`note-editor__toolbar-btn ${shared ? 'is-active' : ''}`}
        title={
          shared
            ? t('notes.manageSharing', 'Manage sharing')
            : t('notes.shareToVault', 'Share to a vault')
        }
        aria-haspopup="dialog"
      >
        <ShareIcon />
      </button>
      {overlays}
      <AddToVaultDialog isOpen={addOpen} onClose={() => setAddOpen(false)} source={source} />
    </>
  );
};

export default NoteShareButton;
