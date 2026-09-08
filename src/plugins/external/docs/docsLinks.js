/**
 * docsLinks — LES LIENS, et la seule garde qui compte.
 *
 * Le contenu d'un fichier de coffre partagé est HOSTILE : il vient d'un
 * collègue, d'un import docx, d'un collage, parfois d'un pair qu'on n'a jamais
 * vu. Un lien y est une arme à trois canons, et ce module ferme les trois.
 *
 *  1. LE SCHÉMA. `isSafeLinkUrl` n'accepte que http: et https:. L'option
 *     `protocols` de tiptap est ADDITIVE — elle ajoute au défaut (ftp, mailto,
 *     tel, sms, xmpp…) et ne retire rien : c'est `isAllowedUri` qui restreint,
 *     et lui seul couvre à la fois les commandes, l'autolink, le collage et le
 *     parseHTML de l'import docx. `mailto:` est retiré délibérément : le
 *     `setWindowOpenHandler` de l'hôte Electron est http(s)-only, un mailto ne
 *     ferait donc RIEN — offrir un lien mort est pire que ne rien offrir.
 *
 *  2. L'OUVERTURE. Jamais au clic. `openOnClick: false` et une bulle où
 *     « Ouvrir » est un geste. L'ouverture passe par
 *     `window.open(url, '_blank', 'noopener')` : ce plugin est BUILTIN, il
 *     s'exécute dans le document de l'hôte — sans `noopener`, la page ouverte
 *     reçoit un `window.opener` vers Filarr. Il n'y a aucun filet côté web.
 *
 *  3. LE CLIC LUI-MÊME, y compris EN LECTURE SEULE. Le clickHandler de tiptap
 *     rend la main dès que `!view.editable` : l'ancre fait alors sa navigation
 *     NATIVE, et un lecteur qui ne peut rien modifier se retrouve emmené
 *     ailleurs. On intercepte donc au niveau DOM, dans les deux régimes.
 *
 * Le href est du texte d'attaquant à l'affichage : `textContent`, jamais
 * `innerHTML`.
 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
/** Les deux seuls schémas que Filarr sait réellement ouvrir. */
const SCHEMAS_SURS = /^https?:$/i;
/**
 * Vrai si l'adresse est une URL ABSOLUE en http(s). Une adresse relative est
 * refusée : au moment de l'ouverture, elle se résoudrait contre le document de
 * l'hôte (app:// sous Electron), ce qu'on ne veut jamais faire naviguer.
 */
export function isSafeLinkUrl(url) {
    try {
        return SCHEMAS_SURS.test(new URL(url).protocol);
    }
    catch {
        return false;
    }
}
/**
 * Le validateur passé à `Link.isAllowedUri` — la forme exacte que tiptap
 * attend. On garde `defaultValidate` (il tient les cas tordus d'unicode et
 * d'espaces) ET on ajoute la restriction de schéma, que l'option `protocols`
 * ne sait pas exprimer. La base 'https://x.invalid' ne sert qu'à laisser
 * passer les adresses relatives que `defaultValidate` a déjà jugées.
 */
export function makeIsAllowedUri() {
    return (url, ctx) => {
        if (!ctx.defaultValidate(url))
            return false;
        try {
            return SCHEMAS_SURS.test(new URL(url, 'https://x.invalid').protocol);
        }
        catch {
            // Une adresse que le parseur d'URL refuse n'est pas une adresse : on la
            // rejette, mais on ne JETTE pas — cette fonction tourne pendant le
            // parsing d'un document entier.
            return false;
        }
    };
}
/**
 * Ce que l'utilisateur tape, transformé en adresse ou refusé. « exemple.org »
 * devient « https://exemple.org/ » (le geste attendu) ; « javascript:… » n'est
 * pas « corrigé », il est REFUSÉ — deviner l'intention derrière un schéma
 * hostile serait la pire des politesses.
 */
export function normalizeLinkHref(raw) {
    const propre = raw.trim();
    if (!propre)
        return null;
    const candidat = propre.startsWith('//')
        ? `https:${propre}`
        : /^[a-z][a-z0-9+.-]*:/i.test(propre)
            ? propre
            : `https://${propre}`;
    try {
        const url = new URL(candidat);
        if (!SCHEMAS_SURS.test(url.protocol))
            return null;
        return url.toString();
    }
    catch {
        return null;
    }
}
export const linkClickPluginKey = new PluginKey('fdocsLinkClick');
/**
 * L'interception du clic, au niveau DOM et dans LES DEUX régimes.
 *
 * `handleDOMEvents` de ProseMirror est un vrai écouteur sur `view.dom` et il
 * tourne même quand la vue n'est pas éditable (contrairement aux `editHandlers`
 * internes) — c'est le seul point où l'on peut couper la navigation native
 * d'une ancre. `handleClick`, lui, ne rend la main qu'au `mouseup` : un
 * preventDefault y arriverait trop tard pour le `click`.
 */
export function linkClickPlugin(onLink) {
    return new Plugin({
        key: linkClickPluginKey,
        props: {
            handleDOMEvents: {
                click: (view, event) => {
                    const evt = event;
                    if (evt.button !== 0 || evt.metaKey || evt.ctrlKey)
                        return false;
                    const cible = evt.target;
                    const ancre = cible?.closest?.('a');
                    if (!ancre || !view.dom.contains(ancre))
                        return false;
                    // L'attribut BRUT, pas la propriété `.href` (déjà résolue par le
                    // navigateur) : c'est ce que le document porte qu'on doit juger.
                    const href = ancre.getAttribute('href') ?? '';
                    evt.preventDefault();
                    onLink(href, ancre);
                    return true;
                },
            },
        },
    });
}
const ouvertureParDefaut = (url) => {
    // `noopener` OBLIGATOIRE : sans lui, la page ouverte tient un window.opener
    // vers le document de l'hôte. Le plugin est builtin, il n'y a pas de filet.
    window.open(url, '_blank', 'noopener');
};
const copieParDefaut = (texte) => {
    void navigator?.clipboard?.writeText?.(texte)?.catch?.(() => {
        /* presse-papiers refusé : le texte reste affiché, l'utilisateur peut le lire */
    });
};
export function createLinkBubble(opts) {
    const { i18n } = opts;
    const element = document.createElement('div');
    element.className = 'fdocs-link-bubble';
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', i18n.t('link.bubble'));
    element.hidden = true;
    let hrefCourant = '';
    const bouton = (action, cle) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.action = action;
        b.textContent = i18n.t(`link.${cle}`);
        const titre = cle === 'open' || cle === 'copy' || cle === 'edit' || cle === 'remove'
            ? i18n.t(`link.${cle}Title`)
            : i18n.t(`link.${cle}`);
        b.title = titre;
        b.setAttribute('aria-label', titre);
        return b;
    };
    const positionner = (at) => {
        if (!at)
            return;
        element.style.left = `${Math.max(0, at.left)}px`;
        element.style.top = `${Math.max(0, at.top)}px`;
    };
    const showActions = (href, at) => {
        hrefCourant = href;
        element.replaceChildren();
        const affichage = document.createElement('span');
        affichage.className = 'fdocs-link-href';
        // textContent, JAMAIS innerHTML : ce href vient du document.
        affichage.textContent = href;
        affichage.title = href;
        element.appendChild(affichage);
        const ouvrir = bouton('open', 'open');
        ouvrir.addEventListener('click', () => {
            // Défense en profondeur : un href hostile a pu entrer par un chemin
            // qu'on n'a pas prévu (fdoc écrit à la main, pair d'une autre version).
            if (!isSafeLinkUrl(hrefCourant)) {
                opts.onNotify(i18n.t('link.invalid'));
                return;
            }
            (opts.openUrl ?? ouvertureParDefaut)(hrefCourant);
        });
        element.appendChild(ouvrir);
        const copier = bouton('copy', 'copy');
        copier.addEventListener('click', () => {
            (opts.copyText ?? copieParDefaut)(hrefCourant);
            opts.onNotify(i18n.t('link.copied'));
        });
        element.appendChild(copier);
        if (opts.editable) {
            const modifier = bouton('edit', 'edit');
            modifier.addEventListener('click', () => showEditor(hrefCourant, at));
            element.appendChild(modifier);
            const retirer = bouton('remove', 'remove');
            retirer.addEventListener('click', () => {
                opts.onRemove();
                hide();
            });
            element.appendChild(retirer);
        }
        positionner(at);
        element.hidden = false;
    };
    const showEditor = (href, at) => {
        hrefCourant = href;
        element.replaceChildren();
        const champ = document.createElement('input');
        champ.type = 'text';
        champ.className = 'fdocs-link-input';
        champ.value = href;
        champ.placeholder = i18n.t('link.promptPlaceholder');
        champ.setAttribute('aria-label', i18n.t('link.promptLabel'));
        element.appendChild(champ);
        const valider = () => {
            const normalise = normalizeLinkHref(champ.value);
            if (!normalise) {
                opts.onNotify(i18n.t('link.invalid'));
                return;
            }
            opts.onApply(normalise);
            hide();
        };
        const apply = bouton('apply', 'apply');
        apply.addEventListener('click', valider);
        element.appendChild(apply);
        const cancel = bouton('cancel', 'cancel');
        cancel.addEventListener('click', () => hide());
        element.appendChild(cancel);
        champ.addEventListener('keydown', (e) => {
            // Échap ne doit PAS remonter : le listener document de la Modal de
            // l'hôte fermerait l'éditeur entier.
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                hide();
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                valider();
            }
        });
        positionner(at);
        element.hidden = false;
        champ.focus();
        champ.select();
    };
    const hide = () => {
        element.hidden = true;
        element.replaceChildren();
        hrefCourant = '';
    };
    return {
        element,
        showActions,
        showEditor,
        hide,
        isOpen: () => !element.hidden,
        destroy: () => {
            element.remove();
        },
    };
}
