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
import type { I18n } from './i18n';
/**
 * Vrai si l'adresse est une URL ABSOLUE en http(s). Une adresse relative est
 * refusée : au moment de l'ouverture, elle se résoudrait contre le document de
 * l'hôte (app:// sous Electron), ce qu'on ne veut jamais faire naviguer.
 */
export declare function isSafeLinkUrl(url: string): boolean;
/**
 * Le validateur passé à `Link.isAllowedUri` — la forme exacte que tiptap
 * attend. On garde `defaultValidate` (il tient les cas tordus d'unicode et
 * d'espaces) ET on ajoute la restriction de schéma, que l'option `protocols`
 * ne sait pas exprimer. La base 'https://x.invalid' ne sert qu'à laisser
 * passer les adresses relatives que `defaultValidate` a déjà jugées.
 */
export declare function makeIsAllowedUri(): (url: string, ctx: {
    defaultValidate: (url: string) => boolean;
}) => boolean;
/**
 * Ce que l'utilisateur tape, transformé en adresse ou refusé. « exemple.org »
 * devient « https://exemple.org/ » (le geste attendu) ; « javascript:… » n'est
 * pas « corrigé », il est REFUSÉ — deviner l'intention derrière un schéma
 * hostile serait la pire des politesses.
 */
export declare function normalizeLinkHref(raw: string): string | null;
export declare const linkClickPluginKey: PluginKey<any>;
/**
 * L'interception du clic, au niveau DOM et dans LES DEUX régimes.
 *
 * `handleDOMEvents` de ProseMirror est un vrai écouteur sur `view.dom` et il
 * tourne même quand la vue n'est pas éditable (contrairement aux `editHandlers`
 * internes) — c'est le seul point où l'on peut couper la navigation native
 * d'une ancre. `handleClick`, lui, ne rend la main qu'au `mouseup` : un
 * preventDefault y arriverait trop tard pour le `click`.
 */
export declare function linkClickPlugin(onLink: (href: string, anchor: HTMLAnchorElement) => void): Plugin;
export interface LinkBubbleHandle {
    readonly element: HTMLElement;
    /** Le menu d'un lien existant : Ouvrir / Copier / Modifier / Retirer. */
    showActions(href: string, at?: {
        left: number;
        top: number;
    }): void;
    /** Le formulaire de pose ou de correction d'adresse. */
    showEditor(href: string, at?: {
        left: number;
        top: number;
    }): void;
    hide(): void;
    isOpen(): boolean;
    destroy(): void;
}
export interface LinkBubbleOptions {
    i18n: I18n;
    /** Un lecteur peut Ouvrir et Copier ; lui seul ne peut ni Modifier ni Retirer. */
    editable: boolean;
    onApply(href: string): void;
    onRemove(): void;
    onNotify(message: string): void;
    /** Injectables pour les tests — les défauts sont la vraie implémentation. */
    openUrl?: (url: string) => void;
    copyText?: (text: string) => void;
}
export declare function createLinkBubble(opts: LinkBubbleOptions): LinkBubbleHandle;
