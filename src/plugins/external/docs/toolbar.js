/**
 * toolbar — UNE liste ordonnée de specs, et rien d'autre.
 *
 * CE QUI NE MARCHAIT PAS. La barre v0.2 construisait les pastilles de
 * surlignage d'abord, puis insérait chaque bouton avec
 * `insertBefore(b, toolbar.querySelector('.fdocs-swatch'))`. Deux
 * conséquences, toutes deux vécues :
 *
 *  · les pastilles étaient ÉPINGLÉES en fin de barre, quoi qu'on veuille. On
 *    ne pouvait pas les ranger avec les autres outils de couleur, donc pas
 *    grouper la barre du tout.
 *  · le rafraîchissement couplait `boutonEls[i]` à `boutons[i]`. Tant que les
 *    deux listes se correspondaient un pour un, ça tenait ; le jour où un
 *    séparateur — un élément SANS spec de bouton — entre dans la barre, tout
 *    l'appariement glisse d'un cran et les états actifs se posent sur les
 *    mauvais boutons.
 *
 * D'où : une SEULE liste, parcourue en `appendChild` dans l'ordre déclaré, et
 * un rafraîchissement qui travaille sur des PAIRES `{spec, el}` — jamais sur
 * des index parallèles.
 *
 * LES SÉPARATEURS SONT VIVANTS. Un séparateur introduit un groupe ; il se
 * masque quand tout son groupe est masqué. Sans cette règle, sortir d'un
 * tableau laissait un trait qui ne séparait plus rien.
 */
export function renderToolbar(specs, opts) {
    const element = document.createElement('div');
    element.className = 'fdocs-toolbar';
    element.setAttribute('role', 'toolbar');
    element.setAttribute('aria-label', opts.i18n.t('toolbar.label'));
    const paires = [];
    for (const spec of specs) {
        const el = creer(spec);
        // appendChild, dans l'ordre déclaré : c'est la liste qui commande la
        // disposition, plus une astuce d'insertion.
        element.appendChild(el);
        paires.push({ spec, el });
    }
    const refresh = () => {
        /** Un groupe est vivant si au moins un de ses éléments non-séparateur l'est. */
        const groupesVivants = new Set();
        for (const { spec, el } of paires) {
            if (spec.kind === 'separator')
                continue;
            const visible = spec.kind === 'button' ? (spec.visible?.() ?? true) : true;
            el.style.display = visible ? '' : 'none';
            if (visible)
                groupesVivants.add(spec.group);
            if (spec.kind !== 'button')
                continue;
            const bouton = el;
            if (spec.isActive)
                bouton.classList.toggle('actif', spec.isActive());
            const permis = spec.enabled?.() ?? true;
            bouton.disabled = !permis;
            // Un bouton grisé DIT pourquoi. « Indisponible » sans raison est une
            // punition, pas une information.
            const texte = permis ? spec.title : `${spec.title} — ${opts.disabledReason}`;
            bouton.title = texte;
            bouton.setAttribute('aria-label', texte);
            bouton.setAttribute('aria-pressed', String(spec.isActive?.() ?? false));
        }
        for (const { spec, el } of paires) {
            if (spec.kind !== 'separator')
                continue;
            el.style.display = groupesVivants.has(spec.group) ? '' : 'none';
        }
    };
    refresh();
    return {
        element,
        refresh,
        destroy: () => {
            element.remove();
            paires.length = 0;
        },
    };
}
function creer(spec) {
    if (spec.kind === 'separator') {
        const sep = document.createElement('span');
        sep.className = 'fdocs-sep';
        // Décoratif : un lecteur d'écran n'a rien à annoncer d'un trait.
        sep.setAttribute('aria-hidden', 'true');
        sep.dataset.group = spec.group;
        return sep;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.title = spec.title;
    b.setAttribute('aria-label', spec.title);
    b.dataset.group = spec.group;
    if (spec.kind === 'swatch') {
        b.className = 'fdocs-swatch';
        if (spec.color)
            b.style.background = spec.color;
        if (spec.label)
            b.textContent = spec.label;
        b.addEventListener('click', () => spec.run());
        return b;
    }
    b.textContent = spec.label;
    b.addEventListener('click', () => {
        // Un bouton grisé qui reste cliquable est un bouton menteur.
        if (b.disabled)
            return;
        spec.run();
    });
    return b;
}
