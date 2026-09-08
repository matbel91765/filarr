import { MENTION_NODE_NAME } from '../../renderer/components/notes/extensions/mentionExtension';

/**
 * LES PERSONNES NOMMÉES DANS UN DOCUMENT — logique PURE, testée à part.
 *
 * Parcourt un document ProseMirror et rend les identifiants des nœuds
 * `mention`, dédoublonnés, dans l’ordre de première apparition. Aucun texte,
 * aucun libellé : ce qui part au serveur est une liste d'identifiants, et rien
 * d'autre ne doit pouvoir s'y glisser.
 *
 * Tolère tout : un document nul, une chaîne JSON, un arbre mal formé. Un
 * enregistrement de note ne doit JAMAIS échouer parce qu'on a voulu compter
 * des mentions.
 */
export function scanMentionUserIds(doc: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  let racine: unknown = doc;
  if (typeof racine === 'string') {
    try {
      racine = JSON.parse(racine);
    } catch {
      return out;
    }
  }

  const visiter = (node: unknown, profondeur: number): void => {
    if (profondeur > 200 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const enfant of node) visiter(enfant, profondeur + 1);
      return;
    }
    const n = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (n.type === MENTION_NODE_NAME) {
      const attrs = n.attrs as { userId?: unknown } | undefined;
      const id = typeof attrs?.userId === 'string' ? attrs.userId.trim() : '';
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    if (Array.isArray(n.content)) visiter(n.content, profondeur + 1);
  };

  visiter(racine, 0);
  return out;
}

/**
 * Deux relevés désignent-ils les mêmes personnes ? L'ordre ne compte pas : ce
 * qui décide d'un envoi, c'est un CHANGEMENT d'ensemble, pas un déplacement de
 * puce dans le texte.
 */
export function sameMentionSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((id) => s.has(id));
}
