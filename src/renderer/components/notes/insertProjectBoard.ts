/**
 * Blocs du tableau de bord projet, prêts à être insérés dans la note courante.
 *
 * Le modèle porte des identifiants FIGÉS (voir `projectTemplates.ts`) : côté
 * modèle, `createNewNote` les re-frappe à la création de la note. La commande
 * « / », elle, n'entre par aucun de ces chemins — sans ce module, insérer le
 * tableau de bord dans deux notes différentes y poserait deux bases portant la
 * MÊME identité, et une relation viserait l'une pour lire l'autre.
 *
 * On repasse donc par le même outil que la copie de note, sur un document
 * jetable qui n'existe que le temps de la re-frappe.
 */

import { projectBoardBlocks } from '../../../services/notes/projectTemplates';
import { restampCopiedDbIds } from './extensions/inlineDatabase/dbIndex';

export function freshProjectBoardBlocks(): unknown[] {
  const blocks = projectBoardBlocks();
  try {
    const stamped = restampCopiedDbIds(JSON.stringify({ type: 'doc', content: blocks }));
    const parsed = JSON.parse(stamped) as { content?: unknown[] };
    return Array.isArray(parsed.content) ? parsed.content : blocks;
  } catch {
    // Une re-frappe impossible ne doit pas coûter la commande : on insère les
    // blocs tels quels, quitte à ce que le greffon d'identité fasse le reste
    // au prochain geste dans le document.
    return blocks;
  }
}
