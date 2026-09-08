/**
 * Dossiers personnalisables — LE DOSSIER COURANT, vu par un bloc.
 *
 * ── POURQUOI UN CONTEXTE ET PAS UNE ATTACHE ─────────────────────────────────
 *
 * « Récents de ce dossier » doit parler du dossier qu'on REGARDE. Écrire son
 * identifiant dans `LayoutSlot.binding` marcherait — mais alors le bandeau
 * d'un dossier ne serait plus transposable : « Comme le dossier parent »
 * hériterait de blocs qui citent l'ancêtre, et douze sous-dossiers afficheraient
 * tous les récents du parent. Le dossier courant est donc une donnée
 * D'AMBIANCE, pas une donnée de disposition.
 *
 * L'attache garde toutefois la priorité quand elle existe : c'est ce qui permet
 * de poser « Récents d'un dossier » sur l'ACCUEIL, braqué sur un dossier choisi.
 * Le même bloc sert alors les deux usages, et le registre reste unique — c'est
 * exactement ce que demande le chantier (« le MÊME registre que l'accueil »).
 *
 * ── HORS DOSSIER, UN BLOC NE HURLE PAS ──────────────────────────────────────
 *
 * La valeur par défaut est `null`, pas une exception : ces blocs sont montés en
 * APERÇU dans la palette, où il n'y a évidemment pas de dossier. Un bloc sans
 * dossier affiche son vide, il ne casse pas l'écran qui le montre.
 */

import { createContext, useContext } from 'react';

export interface FolderWidgetScope {
  /** Le dossier affiché. */
  folderId: string;
  /** Son nom, pour les blocs qui le citent sans avoir à relire le store. */
  folderName: string;
}

const FolderWidgetScopeContext = createContext<FolderWidgetScope | null>(null);

export const FolderWidgetScopeProvider = FolderWidgetScopeContext.Provider;

/** La portée telle quelle — `null` hors d'un dossier (palette, accueil). */
export function useFolderWidgetScope(): FolderWidgetScope | null {
  return useContext(FolderWidgetScopeContext);
}

/**
 * Le dossier qu'un bloc doit regarder : son attache s'il en a une, sinon le
 * dossier courant, sinon rien.
 */
export function useWidgetFolderId(binding?: Record<string, string>): string | null {
  const scope = useContext(FolderWidgetScopeContext);
  return binding?.folderId ?? scope?.folderId ?? null;
}
