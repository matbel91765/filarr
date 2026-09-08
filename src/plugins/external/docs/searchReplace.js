/**
 * searchReplace — la recherche du document, SANS dépendance.
 *
 * Un plugin ProseMirror maison : décorations de surlignage, occurrence
 * courante distincte, compteur x/y, remplacer et tout remplacer. Pas de
 * paquet tiers pour trois cents lignes qu'on doit de toute façon comprendre.
 *
 * TOUT REMPLACER EST BORNÉ, ET CE N'EST PAS DU CONFORT. En salle, une
 * transaction unique qui réécrit dix mille occurrences produit une trame Yjs
 * qui peut dépasser le maximum du relais (1 Mio) — et une trame trop grosse
 * est ABANDONNÉE SANS RETRANSMISSION : les pairs gardent silencieusement un
 * document différent du nôtre, définitivement. Les tranches (50 occurrences,
 * une respiration entre deux) laissent le lot de sortie produire PLUSIEURS
 * trames de taille raisonnable.
 *
 * ON REMPLACE DE LA FIN VERS LE DÉBUT. Les positions calculées une seule fois
 * restent valides tant qu'on ne touche à rien AVANT elles ; c'est aussi ce qui
 * fait terminer un « remplacer "a" par "aa" » qui, recalculé à chaque tour,
 * tournerait pour toujours.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
/** Une tranche de remplacement — voir l'en-tête pour la trame de 1 Mio. */
export const TRANCHE_REMPLACEMENT = 50;
/** Le caractère qui tient la place d'un nœud-feuille (image) dans le texte. */
const REMPLISSAGE_FEUILLE = '￼';
export const searchPluginKey = new PluginKey('fdocsSearch');
/**
 * Toutes les occurrences, en ordre de position.
 *
 * On travaille BLOC DE TEXTE par bloc de texte : une occurrence à cheval sur
 * deux nœuds texte (le mot est en partie gras) doit être trouvée, or les nœuds
 * texte sont découpés par les marques. `textBetween` recolle le bloc, et un
 * caractère de remplissage par nœud-feuille garde les décalages alignés sur
 * les positions du document.
 */
export function findMatches(doc, query, matchCase = false) {
    const out = [];
    if (!query)
        return out;
    // Note : quelques caractères changent de LONGUEUR en minuscules (le İ turc).
    // Sur ceux-là, l'alignement des décalages céderait ; le cas est assez rare
    // pour être assumé, et la recherche sensible à la casse le contourne.
    const besoin = matchCase ? query : query.toLowerCase();
    doc.descendants((node, pos) => {
        if (!node.isTextblock)
            return true;
        const brut = node.textBetween(0, node.content.size, '\n', REMPLISSAGE_FEUILLE);
        const foin = matchCase ? brut : brut.toLowerCase();
        let i = foin.indexOf(besoin);
        while (i !== -1) {
            out.push({ from: pos + 1 + i, to: pos + 1 + i + query.length });
            // Pas de chevauchement : « aa » dans « aaa » compte une fois.
            i = foin.indexOf(besoin, i + Math.max(1, besoin.length));
        }
        return false;
    });
    return out;
}
function decorer(matches, index, doc) {
    if (matches.length === 0)
        return DecorationSet.empty;
    return DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, {
        class: i === index ? 'fdocs-match fdocs-match-actuel' : 'fdocs-match',
    })));
}
function recalculer(doc, query, matchCase, indexSouhaite) {
    const matches = findMatches(doc, query, matchCase);
    const index = matches.length === 0 ? -1 : ((indexSouhaite % matches.length) + matches.length) % matches.length;
    return { query, matchCase, matches, index, decorations: decorer(matches, index, doc) };
}
export function searchPlugin() {
    return new Plugin({
        key: searchPluginKey,
        state: {
            init: () => ({
                query: '',
                matchCase: false,
                matches: [],
                index: -1,
                decorations: DecorationSet.empty,
            }),
            apply(tr, value) {
                const meta = tr.getMeta(searchPluginKey);
                if (meta) {
                    const query = meta.query ?? value.query;
                    const matchCase = meta.matchCase ?? value.matchCase;
                    const souhaite = meta.index !== undefined
                        ? meta.index
                        : meta.step !== undefined
                            ? value.index + meta.step
                            : 0;
                    return recalculer(tr.doc, query, matchCase, souhaite);
                }
                if (!tr.docChanged)
                    return value;
                if (!value.query)
                    return value;
                // Le document a bougé (nous, ou un pair) : les positions d'hier ne
                // valent plus rien. On recalcule plutôt que de mapper — c'est le seul
                // moyen d'être juste quand la frappe vient d'ailleurs.
                return recalculer(tr.doc, value.query, value.matchCase, Math.max(value.index, 0));
            },
        },
        props: {
            decorations: (state) => searchPluginKey.getState(state)?.decorations,
        },
    });
}
export function getSearchState(state) {
    return searchPluginKey.getState(state);
}
/** Pose (ou efface) la recherche courante. */
export function setSearch(view, query, matchCase) {
    view.dispatch(view.state.tr.setMeta(searchPluginKey, { query, matchCase, index: 0 }));
}
/** Avance de ±1 dans les occurrences, en bouclant, et fait défiler jusqu'à elle. */
export function stepMatch(view, delta) {
    view.dispatch(view.state.tr.setMeta(searchPluginKey, { step: delta }));
    revealCurrent(view);
}
/** Amène l'occurrence courante sous les yeux, sans voler le focus au champ. */
export function revealCurrent(view) {
    const etat = searchPluginKey.getState(view.state);
    const courant = etat && etat.index >= 0 ? etat.matches[etat.index] : undefined;
    if (!courant)
        return;
    try {
        const coords = view.coordsAtPos(courant.from);
        const boite = view.dom.getBoundingClientRect();
        if (coords.top < boite.top || coords.bottom > boite.bottom) {
            view.dom.parentElement?.scrollBy?.({ top: coords.top - boite.top - 80 });
        }
    }
    catch {
        /* position pas encore mesurable : le défilement n'est pas un dû */
    }
}
/** Remplace l'occurrence COURANTE. Rend vrai si quelque chose a bougé. */
export function replaceCurrent(view, remplacement) {
    const etat = searchPluginKey.getState(view.state);
    const courant = etat && etat.index >= 0 ? etat.matches[etat.index] : undefined;
    if (!courant)
        return false;
    view.dispatch(view.state.tr.insertText(remplacement, courant.from, courant.to));
    return true;
}
/**
 * Remplace TOUT, par tranches. Rend le nombre d'occurrences remplacées.
 *
 * Les positions sont calculées UNE fois puis traitées de la fin vers le début :
 * rien de ce qu'on remplace ne déplace ce qui reste à faire.
 */
export async function replaceAll(view, remplacement, opts = {}) {
    const etat = searchPluginKey.getState(view.state);
    if (!etat || etat.matches.length === 0)
        return 0;
    const tranche = Math.max(1, opts.tranche ?? TRANCHE_REMPLACEMENT);
    const respirer = opts.respirer ?? (() => new Promise((resoudre) => setTimeout(resoudre, 0)));
    const decroissant = [...etat.matches].sort((a, b) => b.from - a.from);
    let faits = 0;
    for (let i = 0; i < decroissant.length; i += tranche) {
        const lot = decroissant.slice(i, i + tranche);
        const tr = view.state.tr;
        for (const m of lot)
            tr.insertText(remplacement, m.from, m.to);
        view.dispatch(tr);
        faits += lot.length;
        if (i + tranche < decroissant.length)
            await respirer();
    }
    return faits;
}
