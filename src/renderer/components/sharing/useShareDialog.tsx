/**
 * useShareDialog — ouvrir le dialogue de partage unifié depuis n'importe quel
 * écran, sur le patron de `useVaultCardMenu` : l'hôte appelle `open(target)`
 * depuis un geste (menu contextuel « Gérer l'accès », bouton d'en-tête…) et
 * rend `overlays` UNE fois dans son arbre.
 *
 * MODE LOCAL (règle 13) : `open` est un no-op et `overlays` vaut `null`. Rien
 * de ce que le dialogue montre n'existe hors nuage — ni coffre, ni espace, ni
 * lien — et un dialogue vide qui s'ouvrirait quand même serait un mur de
 * vente déguisé en fonctionnalité. Un passage en mode local PENDANT que la
 * boîte est ouverte la referme pour la même raison.
 *
 * `key` sur la cible : changer de cible depuis un dialogue déjà ouvert
 * remonte le composant à neuf (saisies, cérémonie, seconds niveaux), au lieu
 * de laisser une adresse à moitié tapée sur un autre coffre.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import { ShareDialog } from './ShareDialog';
import type { ShareTarget } from './shareDialogModel';

export interface ShareDialogOpenOptions {
  /** Le contenu LOCAL a changé (déplacement vers un coffre) : l'hôte relit. */
  onLocalChanged?: () => void;
  /**
   * Où poser le focus à l'ouverture. `'invite'` = la ligne d'invitation (cible
   * `vault`) ou le corps « partager avec une personne » (cible `vaultItem`) :
   * c'est ce que promet le raccourci « Partager avec une personne » du menu —
   * le même dialogue, mais la main déjà sur le bon champ.
   */
  initialFocus?: 'invite';
}

/** Une clé stable par cible — le remontage se décide dessus. */
function targetKey(target: ShareTarget): string {
  switch (target.kind) {
    case 'vault':
      return `vault:${target.vaultId}`;
    case 'vaultItem':
      return `vaultItem:${target.vaultId}:${target.item.id}`;
    case 'vaultItems':
      // Tous les ids : deux lots de même taille sur des fichiers différents
      // sont deux cibles, et doivent remonter le dialogue à neuf.
      return `vaultItems:${target.vaultId}:${target.items.map((i) => i.id).join(',')}`;
    case 'personalFile':
      return `file:${target.folderId}:${target.file.id}`;
    default:
      return `note:${target.noteId}`;
  }
}

export function useShareDialog(): {
  open: (target: ShareTarget, options?: ShareDialogOpenOptions) => void;
  overlays: React.ReactNode;
  /** Le dialogue est à l'écran — l'hôte suspend ses raccourcis clavier. */
  isOpen: boolean;
} {
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const isCloud = accountMode === 'cloud';
  const [state, setState] = useState<{
    target: ShareTarget;
    options?: ShareDialogOpenOptions;
  } | null>(null);

  const open = useCallback(
    (target: ShareTarget, options?: ShareDialogOpenOptions) => {
      if (!isCloud) return;
      setState({ target, options });
    },
    [isCloud]
  );
  const close = useCallback(() => setState(null), []);

  useEffect(() => {
    if (!isCloud) setState(null);
  }, [isCloud]);

  const isOpen = isCloud && state !== null;
  const overlays =
    isCloud && state ? (
      <ShareDialog
        key={targetKey(state.target)}
        target={state.target}
        onClose={close}
        onLocalChanged={state.options?.onLocalChanged}
        initialFocus={state.options?.initialFocus}
      />
    ) : null;

  return { open, overlays, isOpen };
}

export default useShareDialog;
