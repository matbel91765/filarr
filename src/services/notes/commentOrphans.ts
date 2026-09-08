/**
 * Les marques de commentaire ORPHELINES — détecter, pour nettoyer.
 *
 * Avant la réparation des commentaires, le TEXTE vivait dans un état d'écran
 * jamais persisté, pendant que la MARQUE TipTap (data-comment-id) était
 * persistée avec le document. Chaque note commentée porte donc des marques
 * dont le texte n'a jamais existé sur disque : rien à récupérer — un
 * placeholder serait du bruit —, on nettoie, paresseusement, à l'ouverture,
 * une note à la fois.
 *
 * Module PUR : du JSON TipTap en entrée, des identifiants en sortie. Le
 * balayage lui-même (retrait des marques dans l'éditeur) vit dans NoteEditor,
 * qui connaît les gardes de session.
 */

interface TipTapNode {
  type?: string;
  marks?: Array<{ type?: string; attrs?: { commentId?: string } }>;
  content?: TipTapNode[];
}

/** Tous les identifiants de marque `comment` présents dans le document. */
export function collectCommentMarkIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  const visite = (node: TipTapNode | undefined): void => {
    if (!node || typeof node !== 'object') return;
    for (const mark of node.marks ?? []) {
      const id = mark?.type === 'comment' ? mark.attrs?.commentId : undefined;
      if (typeof id === 'string' && id) ids.add(id);
    }
    // La descente couvre tableaux, colonnes, légendes — tout ce qui a un
    // `content`, sans connaître la liste des types de blocs.
    for (const enfant of node.content ?? []) visite(enfant);
  };
  visite(doc as TipTapNode);
  return ids;
}

/**
 * Les marques dont AUCUN commentaire ne porte le texte. `skipIds` protège le
 * commentaire en cours de saisie : sa marque existe déjà, son texte pas encore.
 */
export function findOrphanCommentIds(
  doc: unknown,
  comments: Record<string, { id: string }>,
  skipIds: string[] = []
): string[] {
  const skip = new Set(skipIds);
  const orphans: string[] = [];
  for (const id of collectCommentMarkIds(doc)) {
    if (!skip.has(id) && !comments[id]) orphans.push(id);
  }
  return orphans;
}
