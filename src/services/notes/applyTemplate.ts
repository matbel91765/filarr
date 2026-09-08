/**
 * Appliquer un modèle à la note OUVERTE.
 *
 * Jusqu'ici un modèle ne servait qu'à créer une note depuis la bibliothèque :
 * une note déjà ouverte — celle qu'on vient de créer, justement — ne pouvait
 * rien en faire. C'est le chemin qui manquait pour proposer les modèles au
 * moment où on en a besoin.
 *
 * Les deux précautions du chemin « créer une note » sont reprises telles
 * quelles, parce qu'elles ne sont pas optionnelles :
 *  - les variables `{{title}}` / `{{date}}` sont substituées, sinon
 *    l'utilisateur retrouve les accolades dans son texte ;
 *  - les identifiants de base de données sont RE-FRAPPÉS. Deux notes qui
 *    porteraient la même feraient résoudre une relation sur la mauvaise, sans
 *    rien à l'écran qui le dise.
 */

import type { NoteTemplate } from '../../types/notes';
import { applyTemplateVariables } from './noteService';
import { restampCopiedDbIds } from '../../renderer/components/notes/extensions/inlineDatabase/dbIndex';

export interface AppliedTemplate {
  /** Document prêt pour `setContent`. */
  doc: unknown;
  /** Titre suggéré (celui du modèle), à ne poser que si la note n'en a pas. */
  suggestedTitle: string;
}

/**
 * Prépare le contenu d'un modèle pour la note courante.
 *
 * `now` est injecté : une date figée rend la fonction testable, et le reste du
 * code n'a pas à connaître le format attendu.
 */
export function prepareTemplate(
  template: NoteTemplate,
  options: { title?: string; locale?: string; now?: Date } = {}
): AppliedTemplate | null {
  const suggestedTitle = (options.title ?? '').trim() || template.name;
  const now = options.now ?? new Date();

  const variables: Record<string, string> = {
    title: suggestedTitle,
    date: now.toLocaleDateString(options.locale ?? 'fr-FR'),
  };
  for (const variable of template.variables ?? []) {
    if (variables[variable.name] === undefined) {
      variables[variable.name] = variable.defaultValue ?? '';
    }
  }

  const filled = applyTemplateVariables(template.content, variables);

  try {
    return { doc: JSON.parse(restampCopiedDbIds(filled)), suggestedTitle };
  } catch {
    // Un modèle illisible ne doit pas vider la note de l'utilisateur.
    return null;
  }
}
