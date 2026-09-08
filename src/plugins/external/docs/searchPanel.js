/**
 * searchPanel — la barre de recherche, et ses deux touches piégées.
 *
 * ÉCHAP NE DOIT PAS REMONTER. L'éditeur vit dans une `Modal` de l'hôte, qui
 * écoute Échap sur `document` pour se fermer. Sans `stopPropagation`, fermer
 * la recherche fermerait l'ÉDITEUR ENTIER — et en salle, sans même la
 * confirmation « modifications non enregistrées », puisque le document CRDT
 * est réputé sauvegardé ailleurs.
 *
 * CTRL+F NON PLUS. Sur le web, il ouvre la recherche du NAVIGATEUR, qui ne
 * connaît ni les décorations ni le remplacement, et qui cherche aussi dans la
 * barre d'outils. `preventDefault` est le seul moyen d'avoir la nôtre.
 */
import { getSearchState, replaceAll, replaceCurrent, revealCurrent, setSearch, stepMatch, } from './searchReplace';
export function createSearchPanel(opts) {
    const { i18n } = opts;
    const element = document.createElement('div');
    element.className = 'fdocs-search';
    element.setAttribute('role', 'search');
    element.setAttribute('aria-label', i18n.t('search.panel'));
    element.hidden = true;
    const champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'fdocs-search-input';
    champ.placeholder = i18n.t('search.placeholder');
    champ.setAttribute('aria-label', i18n.t('search.placeholder'));
    const compteur = document.createElement('span');
    compteur.className = 'fdocs-search-count';
    // Le compteur est une INFORMATION VIVANTE : un lecteur d'écran doit
    // l'entendre changer sans avoir à aller le chercher.
    compteur.setAttribute('role', 'status');
    compteur.setAttribute('aria-live', 'polite');
    const bouton = (titre, libelle, action) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = libelle;
        b.title = titre;
        b.setAttribute('aria-label', titre);
        b.addEventListener('click', action);
        return b;
    };
    const casse = bouton(i18n.t('search.matchCaseTitle'), i18n.t('search.matchCase'), () => {
        casse.classList.toggle('actif');
        casse.setAttribute('aria-pressed', String(casse.classList.contains('actif')));
        appliquer();
    });
    casse.dataset.action = 'match-case';
    casse.setAttribute('aria-pressed', 'false');
    const precedent = bouton(i18n.t('search.previous'), '↑', () => pas(-1));
    precedent.dataset.action = 'previous';
    const suivant = bouton(i18n.t('search.next'), '↓', () => pas(1));
    suivant.dataset.action = 'next';
    const fermer = bouton(i18n.t('search.close'), '×', () => close());
    fermer.dataset.action = 'close';
    element.append(champ, compteur, precedent, suivant, casse);
    const champRemplacement = document.createElement('input');
    if (opts.editable) {
        champRemplacement.type = 'text';
        champRemplacement.className = 'fdocs-search-input';
        champRemplacement.placeholder = i18n.t('search.replacePlaceholder');
        champRemplacement.setAttribute('aria-label', i18n.t('search.replacePlaceholder'));
        const remplacer = bouton(i18n.t('search.replace'), i18n.t('search.replace'), () => {
            const view = opts.view();
            if (!view)
                return;
            if (replaceCurrent(view, champRemplacement.value))
                refresh();
        });
        remplacer.dataset.action = 'replace';
        const toutRemplacer = bouton(i18n.t('search.replaceAll'), i18n.t('search.replaceAll'), () => {
            const view = opts.view();
            if (!view)
                return;
            // Par TRANCHES : une transaction unique en salle peut produire une trame
            // au-delà du maximum du relais, et une trame trop grosse est abandonnée
            // sans retransmission (voir searchReplace.ts).
            void replaceAll(view, champRemplacement.value).then((nombre) => {
                refresh();
                if (nombre > 0)
                    opts.onNotify(i18n.t('search.replacedAll', { count: nombre }));
            });
        });
        toutRemplacer.dataset.action = 'replace-all';
        element.append(champRemplacement, remplacer, toutRemplacer);
    }
    element.append(fermer);
    const appliquer = () => {
        const view = opts.view();
        if (!view)
            return;
        setSearch(view, champ.value, casse.classList.contains('actif'));
        refresh();
    };
    const pas = (delta) => {
        const view = opts.view();
        if (!view)
            return;
        stepMatch(view, delta);
        refresh();
    };
    const refresh = () => {
        const view = opts.view();
        const etat = view ? getSearchState(view.state) : undefined;
        if (!etat || !etat.query) {
            compteur.textContent = '';
            return;
        }
        compteur.textContent =
            etat.matches.length === 0
                ? i18n.t('search.none')
                : i18n.t('search.count', { current: etat.index + 1, total: etat.matches.length });
    };
    champ.addEventListener('input', appliquer);
    const surTouche = (e) => {
        if (e.key === 'Escape') {
            // La Modal de l'hôte écoute Échap sur document : sans ce stopPropagation
            // elle fermerait l'éditeur ENTIER.
            e.preventDefault();
            e.stopPropagation();
            close();
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            pas(e.shiftKey ? -1 : 1);
        }
    };
    element.addEventListener('keydown', surTouche);
    const open = () => {
        element.hidden = false;
        champ.focus();
        champ.select();
        appliquer();
    };
    const close = () => {
        element.hidden = true;
        const view = opts.view();
        // Les décorations meurent avec le panneau : laisser du surlignage orphelin
        // dans le document serait un mensonge visuel.
        if (view)
            setSearch(view, '', casse.classList.contains('actif'));
        compteur.textContent = '';
        view?.focus();
    };
    return {
        element,
        open,
        close,
        isOpen: () => !element.hidden,
        refresh: () => {
            if (!element.hidden) {
                refresh();
                const view = opts.view();
                if (view)
                    revealCurrent(view);
            }
        },
        destroy: () => {
            element.removeEventListener('keydown', surTouche);
            element.remove();
        },
    };
}
