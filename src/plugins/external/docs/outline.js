/**
 * outline — le plan du document, construit depuis les titres.
 *
 * DEUX PRÉCAUTIONS, ET ELLES COMPTENT.
 *
 *  1. Le texte d'un titre est du CONTENU DE DOCUMENT — donc du texte
 *     d'attaquant, exactement comme un href. Il n'entre dans le plan que par
 *     `textContent` ; `innerHTML` transformerait un titre en surface de rendu.
 *  2. La reconstruction est DÉBOUNCÉE par l'appelant (300 ms). Reconstruire à
 *     chaque transaction, c'est reconstruire à chaque frappe — la sienne comme
 *     celle des pairs en salle, où les transactions arrivent en rafale.
 */
/** Les titres du document, dans l'ordre de lecture. */
export function buildOutline(doc) {
    const out = [];
    doc.descendants((node, pos) => {
        if (node.type.name !== 'heading')
            return true;
        const brut = Number(node.attrs.level);
        out.push({
            level: Math.min(Math.max(Number.isFinite(brut) ? brut : 1, 1), 3),
            text: node.textContent.trim(),
            pos,
        });
        // Un titre ne contient pas de titre : inutile de descendre.
        return false;
    });
    return out;
}
export function createOutlinePanel(opts) {
    const { i18n } = opts;
    const element = document.createElement('nav');
    element.className = 'fdocs-outline';
    element.setAttribute('aria-label', i18n.t('outline.title'));
    element.hidden = true;
    const titre = document.createElement('p');
    titre.className = 'fdocs-outline-titre';
    titre.textContent = i18n.t('outline.title');
    const liste = document.createElement('ul');
    liste.className = 'fdocs-outline-liste';
    element.append(titre, liste);
    let ouvert = false;
    let dernieres = [];
    const rendre = () => {
        liste.replaceChildren();
        if (dernieres.length === 0) {
            const vide = document.createElement('li');
            vide.className = 'fdocs-outline-vide';
            vide.textContent = i18n.t('outline.empty');
            liste.appendChild(vide);
            return;
        }
        for (const entree of dernieres) {
            const li = document.createElement('li');
            const b = document.createElement('button');
            b.type = 'button';
            b.className = `fdocs-outline-item fdocs-outline-n${entree.level}`;
            // textContent : le titre vient du DOCUMENT.
            const libelle = entree.text || i18n.t('outline.untitled');
            b.textContent = libelle;
            const titreAccessible = i18n.t('outline.goTo', { title: libelle });
            b.title = titreAccessible;
            b.setAttribute('aria-label', titreAccessible);
            b.dataset.pos = String(entree.pos);
            b.addEventListener('click', () => opts.onGoTo(entree.pos));
            li.appendChild(b);
            liste.appendChild(li);
        }
    };
    const appliquerVisibilite = () => {
        element.hidden = !ouvert;
    };
    rendre();
    return {
        element,
        update(entries) {
            dernieres = entries;
            rendre();
            appliquerVisibilite();
        },
        open() {
            ouvert = true;
            appliquerVisibilite();
        },
        close() {
            ouvert = false;
            appliquerVisibilite();
        },
        toggle() {
            ouvert = !ouvert;
            appliquerVisibilite();
        },
        isOpen: () => ouvert,
        destroy() {
            element.remove();
        },
    };
}
/**
 * Un débounceur minuscule, exporté pour être testé sans horloge réelle.
 * `annuler()` est indispensable : un timer qui survit au démontage rappelle
 * un éditeur détruit.
 */
export function debounce(fn, delai) {
    let timer = null;
    const enveloppe = (...args) => {
        if (timer)
            clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delai);
    };
    enveloppe.annuler = () => {
        if (timer)
            clearTimeout(timer);
        timer = null;
    };
    return enveloppe;
}
