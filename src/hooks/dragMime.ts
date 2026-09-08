/**
 * Les MARQUEURS d'un glisser-déposer interne, et la lecture de leur intention.
 *
 * ── POURQUOI UN MODULE À PART ───────────────────────────────────────────────
 *
 * Trois gestes de glisser cohabitent dans l'explorateur de dossier : un
 * fichier ou un dossier de la liste (`useDragAndDrop`), un bloc tiré de la
 * palette du bandeau (`WidgetPalette`), et des fichiers venus du bureau. Ils
 * traversent le MÊME conteneur, qui n'a que `dataTransfer.types` pour les
 * distinguer pendant le survol (le contenu, lui, n'est lisible qu'au dépôt).
 * Un marqueur absent laisse le conteneur croire à un import : c'est ainsi que
 * glisser un bloc allumait « Déposez vos fichiers ici ».
 *
 * Ce module est PUR — pas de React, pas de service — pour que la discrimination
 * soit éprouvable en vitest et importable depuis le bandeau comme depuis la
 * liste sans tirer tout `useDragAndDrop` avec elle.
 */

/** Un fichier ou un dossier de Filarr est en train d'être déplacé. */
export const FILARR_FILE_MIME = 'application/x-filarr-file';

/** Un BLOC de la palette de mise en page est en train d'être glissé. */
export const FILARR_WIDGET_MIME = 'application/x-filarr-widget';

/**
 * Ce que le navigateur annonce quand des fichiers du SYSTÈME traversent la
 * fenêtre. C'est le seul type qu'un import réel porte toujours, et le seul
 * moment où « Déposez vos fichiers ici » a un sens.
 */
export const NATIVE_FILES_TYPE = 'Files';

export type DragIntent =
  /** Un bloc de la palette : le geste appartient au bandeau, pas à la liste. */
  | 'widget'
  /** Un élément de Filarr : déplacement interne, géré par les cartes. */
  | 'internal'
  /** Des fichiers du bureau : c'est un import. */
  | 'files'
  /** Rien d'identifiable (un glisser sans charge utile) : on ne réagit pas. */
  | 'none';

/**
 * Lit l'intention d'un glisser d'après ses types. Le bloc passe AVANT tout le
 * reste : la palette pose aussi un `text/plain` (sans lequel le dépôt HTML5
 * n'arrive jamais), et ce `text/plain` ne doit pas faire croire à autre chose.
 */
export function classifyDragTypes(types: readonly string[] | DOMStringList): DragIntent {
  const list = Array.from(types as Iterable<string>);
  if (list.includes(FILARR_WIDGET_MIME)) return 'widget';
  if (list.includes(FILARR_FILE_MIME)) return 'internal';
  if (list.includes(NATIVE_FILES_TYPE)) return 'files';
  return 'none';
}
