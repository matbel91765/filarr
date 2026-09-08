/**
 * L'éditeur de documents — tiptap monté dans le contrat EditorHost de Filarr.
 *
 * DEUX RÉGIMES, UN SEUL MONTAGE :
 *
 *   · SEUL — le `.fdoc` est chargé depuis les octets de l'hôte, la sauvegarde
 *     repasse par `host.saveBytes` (re-chiffrement + verrou de version, la
 *     propriété du cœur).
 *   · EN SALLE — `host.collab` est présent : le document VIT dans le
 *     Y.XmlFragment 'content', transporté chiffré par le relais aveugle du
 *     cœur. Les octets initiaux ne sèment la salle que si elle est VIDE —
 *     celui qui arrive dans une salle habitée adopte ce qu'elle contient,
 *     jamais l'inverse. La présence (curseurs nommés) vient d'Awareness, déjà
 *     chiffrée par le pipeline.
 *
 * La mise en page « page » (largeur lisible, marges, ombre feuille) est du CSS
 * local au plugin : Filarr n'impose ni ne reçoit aucune feuille de style.
 */
import { Editor } from '@tiptap/core';
import { buildDocsExtensions } from './docsExtensions';
import { compressToBudget, dataUrlByteLength, DOC_COLLAB_MAX_BYTES, MAX_DOC_BYTES, } from './imagePipeline';
import { parseFdoc, serializeFdoc, emptyFdoc, FdocFormatError } from './fdoc';
import { createI18n, detectLang } from './i18n';
import { createLinkBubble, linkClickPlugin } from './docsLinks';
import { announceSchemaCapability, claimSchemaFloor, } from './schemaGuard';
import { renderToolbar } from './toolbar';
import { searchPlugin } from './searchReplace';
import { createSearchPanel } from './searchPanel';
import { buildOutline, createOutlinePanel, debounce } from './outline';
import { importDocx } from './importDocx';
import { exportDocx } from './exportDocx';
const PAGE_CSS = `
.fdocs-root{position:relative;height:100%;display:flex;flex-direction:column;gap:8px}
.fdocs-toolbar{display:flex;gap:4px;flex-wrap:wrap;padding:4px 0}
.fdocs-toolbar button{font:12px/1 system-ui;padding:6px 9px;border:1px solid rgba(128,128,128,.35);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.fdocs-toolbar button.actif{background:rgba(128,128,128,.18)}
.fdocs-toolbar button:disabled{opacity:.4;cursor:not-allowed}
.fdocs-sep{width:1px;align-self:stretch;margin:2px 3px;background:rgba(128,128,128,.35)}
.fdocs-search{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 8px;border:1px solid rgba(128,128,128,.35);border-radius:8px;font:12px/1.3 system-ui}
.fdocs-search[hidden]{display:none}
.fdocs-search-input{min-width:150px;font:12px/1.4 system-ui;padding:4px 6px;border:1px solid rgba(128,128,128,.45);border-radius:5px;background:transparent;color:inherit}
.fdocs-search-count{min-width:92px;opacity:.75}
.fdocs-search button{font:12px/1 system-ui;padding:5px 8px;border:1px solid rgba(128,128,128,.35);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
.fdocs-search button.actif{background:rgba(128,128,128,.18)}
.fdocs-page .ProseMirror .fdocs-match{background:rgba(250,204,21,.45);border-radius:2px}
.fdocs-page .ProseMirror .fdocs-match-actuel{background:rgba(249,115,22,.6)}
.fdocs-corps{flex:1;min-height:0;display:flex;gap:10px}
.fdocs-page-holder{flex:1;min-width:0;overflow:auto;padding:16px}
.fdocs-outline{flex:0 0 210px;overflow:auto;padding:8px 6px;border:1px solid rgba(128,128,128,.3);border-radius:8px;font:12px/1.45 system-ui}
.fdocs-outline[hidden]{display:none}
.fdocs-outline-titre{margin:0 0 6px;font-weight:600;opacity:.8}
.fdocs-outline-liste{list-style:none;margin:0;padding:0}
.fdocs-outline-item{display:block;width:100%;text-align:left;font:12px/1.45 system-ui;padding:3px 6px;border:none;border-radius:5px;background:transparent;color:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fdocs-outline-item:hover{background:rgba(128,128,128,.15)}
.fdocs-outline-n2{padding-left:16px}
.fdocs-outline-n3{padding-left:28px}
.fdocs-outline-vide{opacity:.65;padding:3px 6px}
.fdocs-pied{display:flex;justify-content:flex-end;font:11px/1.4 system-ui;opacity:.7;padding:0 2px}
.fdocs-page .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);float:left;height:0;pointer-events:none;opacity:.45}
.fdocs-page{max-width:760px;margin:0 auto;background:var(--fdocs-page-bg, Canvas);color:CanvasText;box-shadow:0 1px 8px rgba(0,0,0,.14);border-radius:4px;padding:64px 72px;min-height:100%}
.fdocs-page .ProseMirror{outline:none;min-height:60vh;font:16px/1.7 Georgia,'Times New Roman',serif}
.fdocs-page .ProseMirror p{margin:0 0 .8em}
.fdocs-page .ProseMirror h1,.fdocs-page .ProseMirror h2,.fdocs-page .ProseMirror h3{font-family:system-ui,sans-serif;line-height:1.25}
.fdocs-page .ProseMirror table{border-collapse:collapse;width:100%;margin:.6em 0;table-layout:fixed}
.fdocs-page .ProseMirror th,.fdocs-page .ProseMirror td{border:1px solid rgba(128,128,128,.4);padding:6px 8px;vertical-align:top;word-break:break-word}
.fdocs-page .ProseMirror th{background:rgba(128,128,128,.12);font-weight:600}
.fdocs-page .ProseMirror .selectedCell{outline:2px solid rgba(59,130,246,.6);outline-offset:-2px}
.fdocs-page .ProseMirror img{max-width:100%;height:auto;border-radius:2px}
.fdocs-solo-note{font:12px/1.4 system-ui;color:#b45309;background:rgba(245,158,11,.12);border-radius:6px;padding:4px 8px;margin:0 0 6px}
.fdocs-swatch{width:18px;height:18px;border-radius:4px;border:1px solid rgba(128,128,128,.4);padding:0;cursor:pointer}
.fdocs-page .ProseMirror a{color:#1d4ed8;text-decoration:underline;cursor:pointer}
.fdocs-page .ProseMirror ul[data-type="taskList"]{list-style:none;padding-left:.2em}
.fdocs-page .ProseMirror ul[data-type="taskList"] li{display:flex;align-items:flex-start;gap:.5em}
.fdocs-page .ProseMirror ul[data-type="taskList"] li>label{flex:0 0 auto;margin-top:.35em;user-select:none}
.fdocs-page .ProseMirror ul[data-type="taskList"] li>div{flex:1 1 auto;min-width:0}
.fdocs-page .ProseMirror code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;background:rgba(128,128,128,.14);border-radius:3px;padding:.1em .3em}
.fdocs-page .ProseMirror pre{font-family:ui-monospace,Consolas,monospace;font-size:.9em;background:rgba(128,128,128,.12);border-radius:6px;padding:10px 12px;overflow-x:auto}
.fdocs-page .ProseMirror pre code{background:none;padding:0}
.fdocs-page .ProseMirror hr{border:none;border-top:1px solid rgba(128,128,128,.5);margin:1.2em 0}
.fdocs-page .ProseMirror sub,.fdocs-page .ProseMirror sup{line-height:0}
.fdocs-link-bubble{position:absolute;left:12px;top:48px;z-index:5;display:flex;align-items:center;gap:6px;max-width:min(460px,92%);padding:5px 7px;border:1px solid rgba(128,128,128,.4);border-radius:8px;background:Canvas;color:CanvasText;box-shadow:0 4px 14px rgba(0,0,0,.18);font:12px/1.3 system-ui}
.fdocs-link-bubble[hidden]{display:none}
.fdocs-link-href{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.75}
.fdocs-link-input{flex:1;min-width:190px;font:12px/1.4 system-ui;padding:4px 6px;border:1px solid rgba(128,128,128,.45);border-radius:5px;background:transparent;color:inherit}
.fdocs-link-bubble button{font:12px/1 system-ui;padding:5px 8px;border:1px solid rgba(128,128,128,.35);border-radius:6px;background:transparent;color:inherit;cursor:pointer}
/* Les curseurs des autres. La COULEUR vient en style inline depuis l'awareness
   (CollaborationCaret la pose), donc rien ici ne la fixe : ces regles ne font
   que la forme. pointer-events:none partout — un curseur distant ne doit jamais
   intercepter un clic destine au texte. */
.ProseMirror .collaboration-carets__caret{position:relative;margin-left:-1px;margin-right:-1px;border-left:1px solid;border-right:1px solid;word-break:normal;pointer-events:none}
.ProseMirror .collaboration-carets__label{position:absolute;top:-1.45em;left:-1px;padding:1px 6px;border-radius:4px;border-bottom-left-radius:0;font:600 .68rem/1.3 system-ui;white-space:nowrap;color:#fff;text-shadow:0 1px 1px rgba(0,0,0,.35);user-select:none;pointer-events:none;opacity:.95}
.ProseMirror .collaboration-carets__selection{border-radius:2px;mix-blend-mode:multiply}
`;
/**
 * LE FILET DU SEMIS. L'hôte désigne UN pair pour verser le document dans une
 * salle vide (`host.collab.maySeed`) ; si cet élu-là ne verse rien — il a pu
 * monter SOLO de son côté : .docx, salle trop récente, document trop gros —
 * personne ne sèmerait et tout le monde regarderait une page blanche. Passé ce
 * délai, chacun sème. Même valeur que le filet du cœur (COLLAB_SEED_TIMEOUT_MS).
 */
const SEED_FALLBACK_MS = 4000;
export function mountDocsEditor(host) {
    // Le contrat EditorHost ne passe AUCUNE fonction de traduction : la langue
    // est celle du navigateur, lue une fois au montage (voir i18n.ts).
    const i18n = createI18n(detectLang());
    const root = document.createElement('div');
    root.className = 'fdocs-root';
    const style = document.createElement('style');
    style.textContent = PAGE_CSS;
    const holder = document.createElement('div');
    holder.className = 'fdocs-page-holder';
    const page = document.createElement('div');
    page.className = 'fdocs-page';
    holder.appendChild(page);
    // Deux colonnes : le plan à gauche, la page à droite.
    const corps = document.createElement('div');
    corps.className = 'fdocs-corps';
    corps.appendChild(holder);
    const pied = document.createElement('div');
    pied.className = 'fdocs-pied';
    // La barre et le panneau de recherche sont posés plus bas — ils ont besoin
    // de l'éditeur pour leurs specs.
    root.append(style, corps, pied);
    host.container.appendChild(root);
    // ── Le contenu initial : fdoc natif, ou import docx aux frontières ─────────
    const estDocx = host.fileName.toLowerCase().endsWith('.docx');
    let initialContent = null;
    let importPromise = null;
    if (host.initialBytes.byteLength === 0) {
        initialContent = emptyFdoc().content;
    }
    else if (estDocx) {
        // L'import est asynchrone (mammoth) : l'éditeur monte vide puis adopte.
        importPromise = importDocx(host.initialBytes, {
            imageRemovedLabel: i18n.t('import.imageRemoved'),
        });
    }
    else {
        try {
            initialContent = parseFdoc(host.initialBytes).content;
        }
        catch (e) {
            if (e instanceof FdocFormatError)
                throw e;
            throw e;
        }
    }
    /**
     * POLITIQUE COLLAB, deterministe sur les MEMES octets (tous les pairs
     * concluent pareil) :
     *  · JAMAIS en salle pour un .docx — c'est du ZIP : un .docx < 700 Ko peut
     *    produire un JSON de plusieurs Mo, et la trame de semis > 1 Mio serait
     *    JETEE EN SILENCE par le relais (les pairs garderaient une salle vide
     *    qu'un save ecraserait sous version). L'import s'ouvre solo, la premiere
     *    sauvegarde le convertit en fdoc, la salle s'ouvre a la reouverture sur
     *    des octets fdoc dont la taille EST la mesure exacte.
     *  · Au-dela de DOC_COLLAB_MAX_BYTES (700 Ko, marge sous la trame collab de
     *    1 Mio) : montage solo. Le coeur pose la meme garde de son cote
     *    (collabEligible) — defense en profondeur.
     */
    const salleProposee = host.collab?.phase === 'live' &&
        !estDocx &&
        host.initialBytes.byteLength <= DOC_COLLAB_MAX_BYTES;
    /**
     * LE PLANCHER DE LA SALLE — la garde vers l'AVENIR (voir schemaGuard.ts).
     * Une salle ouverte par une version plus récente porte un schéma qu'on ne
     * sait pas rendre : s'y lier détruirait ce qu'elle contient au premier
     * montage. On ne s'y lie donc pas — même doctrine que parseFdoc, refuser
     * plutôt que dégrader. Lu AVANT de construire les extensions : la décision
     * porte sur la liaison CRDT elle-même.
     */
    const plancher = salleProposee ? claimSchemaFloor(host.collab.doc) : null;
    const salleTropRecente = plancher?.mode === 'solo';
    const enSalle = salleProposee && !salleTropRecente;
    const extensions = buildDocsExtensions({
        collabDoc: enSalle ? host.collab.doc : undefined,
        awareness: enSalle ? host.collab.awareness : undefined,
        placeholder: i18n.t('editor.placeholder'),
    });
    // Le bandeau honnete : la salle etait proposee, la politique l'a refusee.
    if (host.collab?.phase === 'live' && !enSalle) {
        const note = document.createElement('p');
        note.className = 'fdocs-solo-note';
        note.textContent = i18n.t(salleTropRecente ? 'banner.newerRoom' : estDocx ? 'banner.docxSolo' : 'banner.tooLarge');
        root.insertBefore(note, corps);
    }
    const editor = new Editor({
        element: page,
        editable: !host.readOnly,
        extensions,
        ...(enSalle ? {} : { content: initialContent ?? undefined }),
        onUpdate: () => host.onDirty(true),
    });
    /**
     * LE DOCUMENT EST-IL VERSÉ ?
     *
     * Un éditeur tiptap fraîchement construit sans contenu n'est pas « un
     * document vide » : c'est un éditeur qui ne sait pas encore ce qu'il édite.
     * Les deux se sérialisent pourtant de la même façon — un unique paragraphe,
     * 114 octets — et rien ne les distinguait au moment d'enregistrer.
     *
     * Trois fenêtres réelles où `getBytes()` rendait ce document vide alors que
     * le fichier avait du contenu, toutes reproduites :
     *  · un .docx dont mammoth n'a pas fini la conversion (mesuré : 828 ms sur un
     *    document de 4000 paragraphes) ;
     *  · un .docx dont la conversion ÉCHOUE — la promesse était sans `.catch`,
     *    et l'échec donnait une page blanche muette ;
     *  · une salle de collaboration pas encore semée (jusqu'à SEED_FALLBACK_MS).
     *
     * Aucune n'était atteignable pour un fichier personnel, mais aucune n'était
     * gardée non plus. Le drapeau ferme les trois d'un coup : tant qu'il est
     * faux, on REFUSE de rendre des octets. L'hôte sait traiter un rejet ; il ne
     * sait pas deviner qu'un document vide n'en est pas un.
     */
    let documentVerse = !importPromise && !enSalle;
    let semisTimer = null;
    if (enSalle) {
        // Semer une salle VIDE seulement — même règle que les notes du cœur.
        const fragment = host.collab.doc.getXmlFragment('content');
        // La salle est RE-TESTÉE au moment de verser : celle qui s'est garnie
        // entre-temps (le rejeu, ou l'élu qui a semé) n'est jamais écrasée.
        const semer = () => {
            if (editor.isDestroyed)
                return;
            // Semer est une DÉCISION, prise une fois : que la salle se soit garnie
            // entre-temps ou qu'on y verse nos octets, le document est déterminé
            // après ce passage, et l'enregistrement redevient légitime.
            if (fragment.length > 0 || !initialContent) {
                documentVerse = true;
                return;
            }
            editor.commands.setContent(initialContent);
            documentVerse = true;
        };
        // La salle peut nous garnir AVANT que l'on ait semé : c'est le cas normal
        // quand un pair est déjà là. Le document est alors versé sans nous.
        fragment.observeDeep(() => {
            if (fragment.length > 0)
                documentVerse = true;
        });
        // UN SEUL PAIR SÈME. Deux copies versées dans un CRDT qui ne perd rien,
        // c'est le document en double, en entier. L'hôte tranche ; nous, on
        // attend, avec le filet ci-dessus pour ne jamais rester blanc.
        if (typeof host.collab.maySeed === 'function' && !host.collab.maySeed()) {
            semisTimer = setTimeout(semer, SEED_FALLBACK_MS);
        }
        else {
            semer();
        }
    }
    if (importPromise) {
        void importPromise
            .then((content) => {
            // enSalle est toujours faux pour un .docx (politique ci-dessus), mais si
            // cette regle bougeait un jour : une salle HABITEE n'est jamais ecrasee
            // par un import qui resout tard.
            const fragmentOccupe = enSalle && (host.collab?.doc.getXmlFragment('content').length ?? 0) > 0;
            if (!editor.isDestroyed && !fragmentOccupe) {
                editor.commands.setContent(content);
                // PERTES ANNONCÉES, une fois, ici : sections, en-têtes, révisions et
                // cases à cocher n'ont pas d'équivalent que mammoth sache rendre.
                // Le dire est la moitié du contrat de frontière.
                signaler(i18n.t('banner.docxLossy'));
                // Un import n'est pas une saisie : le document devient « à enregistrer
                // au format natif », et c'est dit par l'hôte à la première sauvegarde.
                host.onDirty(true);
            }
            // Versé même si la salle était occupée : dans ce cas le contenu vient
            // de la salle, et il est bien là.
            documentVerse = true;
        })
            .catch((erreur) => {
            /**
             * L'ÉCHEC D'UN IMPORT N'EST PAS UN DOCUMENT VIDE.
             *
             * Sans ce `.catch`, un .docx abîmé — ou un .doc simplement renommé —
             * donnait une page blanche muette, impossible à distinguer d'un
             * document vide. Enregistrer par-dessus écrivait alors un fdoc vide
             * SUR le fichier d'origine.
             *
             * `documentVerse` reste faux : la garde de `getBytes` fait le reste.
             */
            signaler(i18n.t('banner.docxFailed'));
            // Journalisé pour le rapport de plantage, mais PAS remonté en panne
            // fatale : un fichier illisible n'est pas un éditeur cassé, et le
            // refus d'enregistrer suffit à protéger le fichier d'origine.
            // eslint-disable-next-line no-console
            console.warn('[docs] import .docx echoue :', erreur);
        });
    }
    // ── La barre d'outils, minimale et honnête ────────────────────────────────
    const HIGHLIGHTS = ['#fff59d', '#a5d6a7', '#90caf9', '#f48fb1', '#eeeeee'];
    /** L'insertion d'image, sous les DEUX budgets (trame collab, document). */
    const insererImage = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png,image/jpeg,image/gif,image/webp';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file)
                return;
            try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const out = await compressToBudget(bytes, file.type || 'image/jpeg');
                const docBytes = serializeFdoc(editor.getJSON()).byteLength;
                const ajout = dataUrlByteLength(out.dataUrl);
                // La garde porte le DOCUMENT RESULTANT, pas l'image seule.
                if (enSalle && docBytes + ajout > DOC_COLLAB_MAX_BYTES) {
                    signaler(i18n.t('banner.imageTooLargeForCollab'));
                    return;
                }
                if (docBytes + out.dataUrl.length > MAX_DOC_BYTES) {
                    signaler(i18n.t('banner.imageTooLarge'));
                    return;
                }
                editor
                    .chain()
                    .focus()
                    .setImage({ src: out.dataUrl, width: out.width, height: out.height })
                    .run();
            }
            catch {
                signaler(i18n.t('banner.imageUnreadable'));
            }
        };
        input.click();
    };
    /** Un message discret dans la barre — pas d'alert(), pas de dependance hote. */
    let signalTimer = null;
    const signaler = (texte) => {
        let note = root.querySelector('.fdocs-solo-note[data-signal]');
        if (!note) {
            note = document.createElement('p');
            note.className = 'fdocs-solo-note';
            note.dataset.signal = '1';
            root.insertBefore(note, corps);
        }
        note.textContent = texte;
        if (signalTimer)
            clearTimeout(signalTimer);
        signalTimer = setTimeout(() => note?.remove(), 5000);
    };
    // ── Les liens : une bulle, jamais une navigation subie ────────────────────
    /**
     * Le clic sur une ancre est intercepté dans les DEUX régimes (voir
     * docsLinks.ts) : en lecture seule, la navigation NATIVE partait sans rien
     * demander à personne. La bulle est le seul chemin vers l'ouverture, et elle
     * passe par window.open(..., 'noopener').
     */
    const bulleLien = createLinkBubble({
        i18n,
        editable: !host.readOnly,
        onApply: (href) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
        },
        onRemove: () => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
        },
        onNotify: (message) => signaler(message),
    });
    root.appendChild(bulleLien.element);
    /** Coordonnées d'un élément DANS le repère de la racine du plugin. */
    const positionDe = (el) => {
        const cible = el.getBoundingClientRect();
        const base = root.getBoundingClientRect();
        return { left: cible.left - base.left, top: cible.bottom - base.top + 6 };
    };
    editor.registerPlugin(linkClickPlugin((href, ancreDom) => bulleLien.showActions(href, positionDe(ancreDom))));
    /** Ctrl+K — poser un lien, ou corriger celui du curseur. */
    const ouvrirEditeurLien = () => {
        if (host.readOnly)
            return;
        const actuel = editor.getAttributes('link').href ?? '';
        let at;
        try {
            const coords = editor.view.coordsAtPos(editor.state.selection.from);
            const base = root.getBoundingClientRect();
            at = { left: coords.left - base.left, top: coords.bottom - base.top + 6 };
        }
        catch {
            // Position indisponible (vue pas encore mesurée) : la bulle prend sa
            // place par défaut plutôt que de ne pas s'ouvrir.
            at = undefined;
        }
        bulleLien.showEditor(actuel, at);
    };
    const surTouche = (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            ouvrirEditeurLien();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
            // preventDefault OBLIGATOIRE : sinon c'est la recherche du NAVIGATEUR
            // qui s'ouvre sur web, et elle ne sait ni décorer ni remplacer.
            e.preventDefault();
            ouvrirRecherche();
        }
    };
    let ouvrirRecherche = () => { };
    root.addEventListener('keydown', surTouche);
    // Un clic ailleurs referme la bulle — sauf DANS la bulle, évidemment.
    const surClicAilleurs = (e) => {
        if (!bulleLien.isOpen())
            return;
        const cible = e.target;
        if (cible && bulleLien.element.contains(cible))
            return;
        bulleLien.hide();
    };
    root.addEventListener('mousedown', surClicAilleurs);
    const choisirCouleur = () => {
        const input = document.createElement('input');
        input.type = 'color';
        input.value = '#c0392b';
        input.onchange = () => {
            editor.chain().focus().setColor(input.value).run();
        };
        input.click();
    };
    /**
     * LA CAPACITÉ D'AWARENESS — la garde vers le PASSÉ (voir schemaGuard.ts).
     * Tant qu'un pair présent n'annonce pas savoir porter le schéma 3, on
     * n'INSÈRE aucun type v3 : un pair d'une version antérieure les détruirait à
     * son prochain montage, et la suppression repartirait vers toute la salle
     * comme une édition légitime. Réévaluée à chaque changement de composition.
     */
    let capacite = null;
    const bandeauVersions = document.createElement('p');
    bandeauVersions.className = 'fdocs-solo-note';
    bandeauVersions.textContent = i18n.t('banner.mixedVersions');
    const majBandeauVersions = () => {
        const mixte = capacite !== null && !capacite.peersReady();
        if (mixte && !bandeauVersions.isConnected)
            root.insertBefore(bandeauVersions, corps);
        else if (!mixte && bandeauVersions.isConnected)
            bandeauVersions.remove();
    };
    /**
     * LA BARRE — une seule liste ordonnée, groupée par séparateurs.
     *
     * L'ordre déclaré ICI est l'ordre à l'écran : les pastilles de surlignage
     * vivent avec les outils de couleur, à leur place, et non plus épinglées en
     * fin de barre par une astuce d'insertion (voir toolbar.ts).
     */
    const v3Permis = () => capacite === null || capacite.peersReady();
    const dansTableau = () => editor.isActive('table');
    const btn = (cle, reste, group) => ({
        kind: 'button',
        group,
        label: i18n.t(`toolbar.${cle}.label`),
        title: i18n.t(`toolbar.${cle}.title`),
        ...reste,
    });
    const specs = [
        /**
         * ANNULER / RÉTABLIR — TOUJOURS VISIBLES, salle comprise.
         *
         * `undoRedo: false` du StarterKit ne coupe que l'historique LOCAL, celui
         * qui détruirait la frappe des autres. En salle, Collaboration installe le
         * yUndoPlugin : Ctrl+Z annule VOS pas à vous, et il marche déjà. Masquer
         * les boutons là où le geste fonctionne serait une IHM menteuse ; on lit
         * donc editor.can() pour le grisé, et rien d'autre.
         */
        btn('undo', { enabled: () => editor.can().undo(), run: () => editor.chain().focus().undo().run() }, 'annuler'),
        btn('redo', { enabled: () => editor.can().redo(), run: () => editor.chain().focus().redo().run() }, 'annuler'),
        { kind: 'separator', group: 'texte' },
        // ── Caractère ───────────────────────────────────────────────────────────
        btn('bold', { isActive: () => editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() }, 'texte'),
        btn('italic', { isActive: () => editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() }, 'texte'),
        btn('underline', { isActive: () => editor.isActive('underline'), run: () => editor.chain().focus().toggleUnderline().run() }, 'texte'),
        btn('strike', { isActive: () => editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() }, 'texte'),
        btn('code', { isActive: () => editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() }, 'texte'),
        btn('superscript', { isActive: () => editor.isActive('superscript'), enabled: v3Permis, run: () => editor.chain().focus().toggleSuperscript().run() }, 'texte'),
        btn('subscript', { isActive: () => editor.isActive('subscript'), enabled: v3Permis, run: () => editor.chain().focus().toggleSubscript().run() }, 'texte'),
        // ── Titres ──────────────────────────────────────────────────────────────
        { kind: 'separator', group: 'titres' },
        btn('h1', { isActive: () => editor.isActive('heading', { level: 1 }), run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() }, 'titres'),
        btn('h2', { isActive: () => editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() }, 'titres'),
        btn('h3', { isActive: () => editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() }, 'titres'),
        // ── Listes ──────────────────────────────────────────────────────────────
        { kind: 'separator', group: 'listes' },
        btn('bulletList', { isActive: () => editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() }, 'listes'),
        btn('orderedList', { isActive: () => editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() }, 'listes'),
        btn('taskList', { isActive: () => editor.isActive('taskList'), enabled: v3Permis, run: () => editor.chain().focus().toggleTaskList().run() }, 'listes'),
        // ── Blocs ───────────────────────────────────────────────────────────────
        { kind: 'separator', group: 'blocs' },
        btn('blockquote', { isActive: () => editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() }, 'blocs'),
        btn('codeBlock', { isActive: () => editor.isActive('codeBlock'), run: () => editor.chain().focus().toggleCodeBlock().run() }, 'blocs'),
        btn('horizontalRule', { run: () => editor.chain().focus().setHorizontalRule().run() }, 'blocs'),
        // ── Alignement ──────────────────────────────────────────────────────────
        { kind: 'separator', group: 'alignement' },
        btn('alignLeft', { isActive: () => editor.isActive({ textAlign: 'left' }), run: () => editor.chain().focus().setTextAlign('left').run() }, 'alignement'),
        btn('alignCenter', { isActive: () => editor.isActive({ textAlign: 'center' }), run: () => editor.chain().focus().setTextAlign('center').run() }, 'alignement'),
        btn('alignRight', { isActive: () => editor.isActive({ textAlign: 'right' }), run: () => editor.chain().focus().setTextAlign('right').run() }, 'alignement'),
        btn('alignJustify', { isActive: () => editor.isActive({ textAlign: 'justify' }), run: () => editor.chain().focus().setTextAlign('justify').run() }, 'alignement'),
        // ── Couleur : les pastilles sont ICI, avec leurs voisines de sens ───────
        { kind: 'separator', group: 'couleur' },
        btn('color', { run: choisirCouleur }, 'couleur'),
        btn('colorClear', { run: () => editor.chain().focus().unsetColor().run() }, 'couleur'),
        ...HIGHLIGHTS.map((couleur) => ({
            kind: 'swatch',
            group: 'couleur',
            color: couleur,
            title: i18n.t('toolbar.highlight.title', { color: couleur }),
            run: () => editor.chain().focus().toggleHighlight({ color: couleur }).run(),
        })),
        {
            kind: 'swatch',
            group: 'couleur',
            color: null,
            label: i18n.t('toolbar.highlightClear.label'),
            title: i18n.t('toolbar.highlightClear.title'),
            run: () => editor.chain().focus().unsetHighlight().run(),
        },
        // ── Liens ───────────────────────────────────────────────────────────────
        { kind: 'separator', group: 'liens' },
        btn('link', { isActive: () => editor.isActive('link'), run: ouvrirEditeurLien }, 'liens'),
        // ── Tableaux : l'insertion, puis les gestes CONTEXTUELS ────────────────
        { kind: 'separator', group: 'tableau' },
        btn('table', { isActive: dansTableau, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }, 'tableau'),
        // Leur séparateur disparaît avec eux : hors tableau, il ne sépare rien.
        { kind: 'separator', group: 'tableau-contexte' },
        btn('rowAfter', { visible: dansTableau, run: () => editor.chain().focus().addRowAfter().run() }, 'tableau-contexte'),
        btn('rowDelete', { visible: dansTableau, run: () => editor.chain().focus().deleteRow().run() }, 'tableau-contexte'),
        btn('colAfter', { visible: dansTableau, run: () => editor.chain().focus().addColumnAfter().run() }, 'tableau-contexte'),
        btn('colDelete', { visible: dansTableau, run: () => editor.chain().focus().deleteColumn().run() }, 'tableau-contexte'),
        btn('tableDelete', { visible: dansTableau, run: () => editor.chain().focus().deleteTable().run() }, 'tableau-contexte'),
        // ── Outils du document ─────────────────────────────────────────────────
        { kind: 'separator', group: 'outils' },
        btn('find', { isActive: () => recherche.isOpen(), run: () => basculerRecherche() }, 'outils'),
        btn('outline', { isActive: () => plan.isOpen(), run: () => { plan.toggle(); majBarre(); } }, 'outils'),
        // ── Insertion et sortie ────────────────────────────────────────────────
        { kind: 'separator', group: 'insertion' },
        btn('image', { run: insererImage }, 'insertion'),
        btn('exportDocx', { run: () => void exporterDocx() }, 'insertion'),
    ];
    /**
     * LA RECHERCHE. Le panneau se construit AVANT que la vue existe : il la
     * résout à l'usage plutôt que de la capturer, sinon un remontage lui
     * laisserait une vue morte entre les mains.
     */
    const recherche = createSearchPanel({
        i18n,
        view: () => (editor.isDestroyed ? null : editor.view),
        editable: !host.readOnly,
        onNotify: (message) => signaler(message),
    });
    editor.registerPlugin(searchPlugin());
    /**
     * LE PLAN. Reconstruit sur transaction mais DÉBOUNCÉ : en salle, les
     * transactions arrivent en rafale et parcourir le document à chacune ferait
     * ramer la frappe des autres.
     */
    const plan = createOutlinePanel({
        i18n,
        onGoTo: (pos) => {
            editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run();
        },
    });
    corps.insertBefore(plan.element, holder);
    const majPlan = debounce(() => {
        if (!editor.isDestroyed)
            plan.update(buildOutline(editor.state.doc));
    }, 300);
    plan.update(buildOutline(editor.state.doc));
    /** Le pied : mots et caractères, depuis la storage de CharacterCount. */
    pied.setAttribute('role', 'status');
    pied.setAttribute('aria-label', i18n.t('counter.label'));
    const majCompteur = () => {
        const compte = editor.storage.characterCount;
        if (!compte)
            return;
        pied.textContent = i18n.t('counter.stats', {
            words: compte.words(),
            characters: compte.characters(),
        });
    };
    majCompteur();
    const barre = renderToolbar(specs, {
        i18n,
        disabledReason: i18n.t('toolbar.disabledMixedVersions'),
    });
    // Juste sous la feuille de style : les bandeaux, eux, s'insèrent devant le
    // porteur de page — donc SOUS la barre, là où on les lit.
    style.after(barre.element);
    barre.element.after(recherche.element);
    ouvrirRecherche = () => {
        if (!recherche.isOpen())
            recherche.open();
        majBarre();
    };
    const basculerRecherche = () => {
        if (recherche.isOpen())
            recherche.close();
        else
            recherche.open();
        majBarre();
    };
    const majBarre = () => barre.refresh();
    if (enSalle && host.collab) {
        capacite = announceSchemaCapability(host.collab.awareness, () => {
            majBarre();
            majBandeauVersions();
        });
        majBandeauVersions();
    }
    majBarre();
    editor.on('selectionUpdate', majBarre);
    editor.on('transaction', () => {
        majBarre();
        recherche.refresh();
        majCompteur();
        majPlan();
    });
    const exporterDocx = async () => {
        const bytes = await exportDocx(editor.getJSON());
        // Copie dans un ArrayBuffer possédé : BlobPart refuse un ArrayBufferLike.
        const possede = new Uint8Array(new ArrayBuffer(bytes.byteLength));
        possede.set(bytes);
        const blob = new Blob([possede], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = host.fileName.replace(/\.(fdoc|docx)$/i, '') + '.docx';
        a.click();
        URL.revokeObjectURL(url);
    };
    return {
        destroy() {
            capacite?.destroy();
            // Le filet du semis AVANT tout le reste : un minuteur qui survit au
            // démontage rappellerait un éditeur détruit.
            if (semisTimer)
                clearTimeout(semisTimer);
            // Le débounceur AVANT tout le reste : un timer qui survit au démontage
            // rappellerait un éditeur détruit.
            majPlan.annuler();
            plan.destroy();
            recherche.destroy();
            barre.destroy();
            root.removeEventListener('keydown', surTouche);
            root.removeEventListener('mousedown', surClicAilleurs);
            bulleLien.destroy();
            editor.destroy();
            root.remove();
        },
        isEmpty() {
            /**
             * Tant que le document n'est pas versé, il EST vide — et le dire
             * permet à l'hôte de refuser un enregistrement même si un jour la
             * garde de getBytes venait à sauter.
             */
            if (!documentVerse)
                return true;
            return editor.isEmpty;
        },
        getBytes() {
            /**
             * REFUSER PLUTÔT QUE RENDRE DU VIDE.
             *
             * C'est la garde décrite plus haut, à son point d'application. Lever ici
             * est SÛR : l'hôte attrape et montre l'erreur, alors qu'un document vide
             * rendu sans bruit écrase le fichier.
             */
            if (!documentVerse)
                throw new Error(i18n.t('error.documentNotLoaded'));
            // La sauvegarde est TOUJOURS du fdoc natif — un docx importé devient un
            // fdoc au premier enregistrement, l'export docx reste un geste explicite.
            return serializeFdoc(editor.getJSON());
        },
    };
}
