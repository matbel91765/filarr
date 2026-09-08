/**
 * APPLIQUER UN MODÈLE — le geste, et la règle qui le rend essayable.
 *
 * ── IL N'ÉCRASE JAMAIS ──────────────────────────────────────────────────────
 *
 * Appliquer CRÉE une mise en page nommée (« Accueil — Focus ») et bascule
 * dessus. L'accueil d'avant est intact, à un clic, dans le sélecteur de mises
 * en page. C'est la différence entre essayer et parier : tant que le geste
 * écrase, on regarde la carte du modèle et on ne clique pas.
 *
 * Ce crochet est le SEUL chemin d'application, et il est partagé par les deux
 * portes (la boîte d'import de l'accueil, l'onglet « Modèles » de la place de
 * marché). Deux implémentations auraient fini par diverger sur la seule chose
 * qui compte ici : ce qu'il advient de la mise en page qu'on avait déjà.
 */

import { useCallback } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../../store';
import { saveLayoutToDisk, setView, upsertTemplate } from '../../../store/slices/layoutSlice';
import { instantiate, type LayoutViewId } from '../../../services/layout/layoutTypes';
import type { LayoutFile } from '../../../services/layouts/layoutFormat';
import { newPresetSlotId } from './presets/homePresets';
import { templateFromLayoutFile } from './layoutTransfer';
import { makeHomeViewId, writeActiveHomeViewId } from './homeViews';
import { markFreshView } from './freshView';

export interface ApplyLayoutResult {
  viewId: LayoutViewId;
  /** Le nom donné à la mise en page créée — c'est ce que le message doit citer. */
  name: string;
  slots: number;
}

export function useApplyLayoutFile(): (file: LayoutFile, viewName: string) => ApplyLayoutResult {
  const dispatch = useDispatch<AppDispatch>();

  return useCallback(
    (file: LayoutFile, viewName: string): ApplyLayoutResult => {
      const template = templateFromLayoutFile(file);
      const viewId = makeHomeViewId(viewName);
      const view = instantiate(template, {
        viewId,
        newSlotId: newPresetSlotId,
        now: new Date().toISOString(),
        // AUCUNE résolution d'attache. Un emplacement nommé décrit ce qu'il
        // attend, il ne l'a pas : deviner ici brancherait un bloc reçu de
        // l'extérieur sur un dossier que personne n'a désigné.
      });

      dispatch(setView(view));
      // Ses blocs vides resteront visibles jusqu'a la premiere edition : voir
      // `freshView`. Sans ca, un modele de huit blocs peut en montrer deux.
      markFreshView(viewId);
      // Le gabarit est rangé dans le document pour que « Repartir d'un modèle »
      // le retrouve. Il y perdra sa description et son icône (le conteneur ne
      // garde que le nom, les emplacements et la version) — c'est pourquoi la
      // bibliothèque locale, elle, garde le fichier entier.
      dispatch(upsertTemplate(template));
      void dispatch(saveLayoutToDisk());
      writeActiveHomeViewId(viewId);

      return { viewId, name: viewName, slots: view.slots.length };
    },
    [dispatch]
  );
}
