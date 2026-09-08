/**
 * Liaison Y.Text ↔ <textarea> — le strict nécessaire, dans les deux sens.
 *
 * Il n'existe pas de liaison officielle pour un textarea (les éditeurs riches
 * ont les leurs). Celle-ci fait deux choses, et rien d'autre :
 *
 *   · SORTANT — à chaque saisie locale, on calcule L'UNIQUE épissure entre
 *     l'ancienne et la nouvelle valeur (préfixe commun, suffixe commun, le
 *     milieu remplacé) et on l'applique au Y.Text en une transaction. Un
 *     textarea ne produit qu'une épissure à la fois (frappe, collage,
 *     sélection remplacée) : le diff minimal est donc EXACT, pas approché.
 *   · ENTRANT — à chaque changement distant, on réécrit la valeur et on
 *     replace le curseur en le décalant de ce qui a été inséré/retiré avant
 *     lui. Le curseur ne saute pas sous la frappe d'un autre.
 *
 * L'origine des transactions locales est marquée pour que l'observateur les
 * ignore — sans quoi chaque frappe reviendrait s'écrire elle-même.
 */

import type * as Y from 'yjs';

export interface YTextareaBinding {
  destroy(): void;
}

export function bindYTextToTextarea(
  ytext: Y.Text,
  textarea: HTMLTextAreaElement
): YTextareaBinding {
  const ORIGINE_LOCALE = Symbol('saisie-locale');
  textarea.value = ytext.toString();

  const surSaisie = () => {
    const avant = ytext.toString();
    const apres = textarea.value;
    if (avant === apres) return;
    // L'épissure unique : préfixe commun, puis suffixe commun sur le reste.
    let debut = 0;
    const minLen = Math.min(avant.length, apres.length);
    while (debut < minLen && avant[debut] === apres[debut]) debut++;
    let finAvant = avant.length;
    let finApres = apres.length;
    while (finAvant > debut && finApres > debut && avant[finAvant - 1] === apres[finApres - 1]) {
      finAvant--;
      finApres--;
    }
    ytext.doc?.transact(() => {
      if (finAvant > debut) ytext.delete(debut, finAvant - debut);
      if (finApres > debut) ytext.insert(debut, apres.slice(debut, finApres));
    }, ORIGINE_LOCALE);
  };

  const surDistant = (event: Y.YTextEvent, tx: Y.Transaction) => {
    if (tx.origin === ORIGINE_LOCALE) return;
    const curseur = textarea.selectionStart;
    let decalage = 0;
    // Le delta est ordonné : on cumule ce qui bouge AVANT le curseur.
    let position = 0;
    for (const op of event.delta) {
      if ('retain' in op && typeof op.retain === 'number') {
        position += op.retain;
      } else if ('insert' in op && typeof op.insert === 'string') {
        if (position <= curseur) decalage += op.insert.length;
        position += op.insert.length;
      } else if ('delete' in op && typeof op.delete === 'number') {
        if (position < curseur) decalage -= Math.min(op.delete, curseur - position);
      }
    }
    textarea.value = ytext.toString();
    const nouveau = Math.max(0, curseur + decalage);
    textarea.setSelectionRange(nouveau, nouveau);
  };

  textarea.addEventListener('input', surSaisie);
  ytext.observe(surDistant);

  return {
    destroy() {
      textarea.removeEventListener('input', surSaisie);
      ytext.unobserve(surDistant);
    },
  };
}
