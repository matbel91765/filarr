/**
 * outlineNavigation — ancres de défilement vers un titre, partagées.
 *
 * POURQUOI CE MODULE EXISTE — le dépôt a longtemps porté CINQ extracteurs de
 * titres indépendants (sommaire latéral, bloc /toc, carte mentale, sélecteur
 * rapide, autocomplétion `![[Note#`). Deux vues du même document donnaient
 * donc deux listes de titres différentes, et deux ancres de défilement
 * différentes pour le même titre. L'extraction est désormais unique
 * (`extractHeadings`, services/notes/transclusionHelpers) ; ce module ferme
 * l'autre moitié du problème : la RÉSOLUTION d'un titre vers son élément DOM.
 *
 * Deux pièges que toute copie locale a systématiquement ratés :
 *   1. un titre VIDE existe dans le document et dans le DOM (`<h2></h2>`) mais
 *      n'a rien à montrer dans une liste — le filtrer sans préserver le rang
 *      décale toutes les ancres suivantes ;
 *   2. une transclusion injecte dans NOTRE DOM les titres d'une AUTRE note,
 *      absents de notre document — les compter décale tout ce qui suit.
 */

import type { HeadingEntry } from '../../../services/notes/transclusionHelpers';

/** Un titre affichable, avec de quoi le retrouver dans le DOM. */
export interface OutlineItem {
  id: string;
  text: string;
  level: number;
  /** Rang dans l'ordre du document, titres vides compris (cf. `HeadingEntry`). */
  index: number;
  /** Rang parmi les titres de MÊME niveau et MÊME texte — ancre de repli. */
  occurrence: number;
}

/**
 * Entrées brutes → titres affichables.
 *
 * Un titre vide est retiré de l'AFFICHAGE sans jamais toucher à `index`.
 */
export function toOutlineItems(entries: HeadingEntry[]): OutlineItem[] {
  const seen = new Map<string, number>();
  const items: OutlineItem[] = [];
  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    const key = `${entry.level}::${text}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    items.push({
      id: `heading-${entry.index}`,
      text,
      level: entry.level,
      index: entry.index,
      occurrence,
    });
  }
  return items;
}

/** L'élément est-il bien le titre attendu ? (niveau ET texte) */
export function matchesHeading(el: Element, item: OutlineItem): boolean {
  return el.tagName === `H${item.level}` && (el.textContent || '').trim() === item.text;
}

/**
 * Retrouve le `<hN>` d'un titre dans l'éditeur monté.
 *
 * Le rang dans le document est l'ancre principale, mais elle ne suffit pas
 * seule : on écarte d'abord les titres transclus (`[data-transclusion]`), puis
 * on VÉRIFIE que l'élément trouvé est bien le bon titre — sinon on retombe sur
 * une recherche par niveau + texte, qui reste juste même quand le rendu a
 * bougé sous nos pieds.
 */
export function findHeadingElement(item: OutlineItem): Element | null {
  const editorEl = document.querySelector('.note-editor__body .ProseMirror');
  if (!editorEl) return null;
  const all = Array.from(editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(
    (el) => !el.closest('[data-transclusion]')
  );

  const byIndex = all[item.index];
  if (byIndex && matchesHeading(byIndex, item)) return byIndex;

  let seen = 0;
  for (const el of all) {
    if (!matchesHeading(el, item)) continue;
    if (seen === item.occurrence) return el;
    seen += 1;
  }
  return null;
}

/**
 * Fait défiler jusqu'au titre et le souligne brièvement. Rend `false` quand
 * l'ancre n'a pas été retrouvée — l'appelant peut alors se taire plutôt que
 * de faire sauter la vue au mauvais endroit.
 */
export function scrollToOutlineItem(item: OutlineItem): boolean {
  const target = findHeadingElement(item);
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('outline-highlight');
  setTimeout(() => target.classList.remove('outline-highlight'), 1500);
  return true;
}
