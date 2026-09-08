/**
 * Import docx — LA FRONTIÈRE D'ENTRÉE, avec pertes annoncées.
 *
 * mammoth convertit le docx en HTML sémantique ; tiptap l'avale via la MÊME
 * liste d'extensions que l'éditeur (buildDocsExtensions) — sinon tables et
 * images seraient jetées en silence au parsing. Ce qui n'a pas d'équivalent —
 * sections, en-têtes/pieds, révisions, alignements et couleurs (mammoth ne les
 * importe pas) — est PERDU À L'IMPORT, une fois, visiblement.
 *
 * IMAGES : mammoth livre les ORIGINAUX en base64 (souvent > 5 Mo pièce). Le
 * sweep post-import repasse chaque image par le même pipeline de compression
 * que l'insertion manuelle — sans ce col d'étranglement, le premier
 * enregistrement fabriquerait un fdoc géant et tuerait l'éligibilité collab.
 * Une image irréductible est REMPLACÉE par un paragraphe d'annonce : perte
 * annoncée, doctrine de la frontière.
 */
import mammoth from 'mammoth';
import { generateJSON } from '@tiptap/core';
import { buildDocsExtensions } from './docsExtensions';
import { parseDataUrl, compressToBudget } from './imagePipeline';
/** Les familles de bloc dont on sait transporter l'alignement. */
const FAMILLES = { P: 'p', H1: 'h1', H2: 'h2', H3: 'h3' };
/** Word → notre vocabulaire. `both` est le nom OOXML du justifié. */
const SENS = {
    center: 'Center',
    right: 'Right',
    both: 'Justify',
    justify: 'Justify',
};
const ENTREES_ALIGNEMENT = Object.entries(FAMILLES).flatMap(([famille, balise]) => ['Center', 'Right', 'Justify'].map((sens) => `p[style-name='FilarrAlign${famille}${sens}'] => ${balise}.filarr-align-${sens.toLowerCase()}:fresh`));
/**
 * Le mapping des styles NOMMÉS que le défaut de mammoth n'apporte pas —
 * titres/listes/tables/gras/italique/barré y sont déjà ; seul `u` est omis.
 *
 * EXPOSANT ET INDICE, DEUX CHEMINS. Word les écrit de deux façons : en
 * FORMATAGE DIRECT (`w:vertAlign`), que mammoth traduit tout seul en
 * `<sup>`/`<sub>` ; et en STYLE DE CARACTÈRE NOMMÉ (« Superscript »,
 * « Exposant »…), qui arrive comme un styleId inconnu et se perd en silence.
 * Le second chemin a besoin de ces lignes ; le premier marchait déjà.
 */
export const STYLE_MAP = [
    'u => u',
    "p[style-name='Title'] => h1:fresh",
    "p[style-name='Titre'] => h1:fresh",
    "p[style-name='Subtitle'] => h2:fresh",
    "p[style-name='Sous-titre'] => h2:fresh",
    "p[style-name='Quote'] => blockquote:fresh",
    "p[style-name='Citation'] => blockquote:fresh",
    "p[style-name='Intense Quote'] => blockquote:fresh",
    "r[style-name='Superscript'] => sup",
    "r[style-name='Exposant'] => sup",
    "r[style-name='Subscript'] => sub",
    "r[style-name='Indice'] => sub",
    /**
     * LE SURLIGNEUR DE WORD.
     *
     * mammoth expose nativement le `w:highlight` sous le nom de matcher
     * `highlight`, mais ne l'émet pas par défaut : sans cette ligne, un texte
     * surligné arrivait en texte nu. Or l'éditeur sait le représenter —
     * l'extension Highlight est enregistrée depuis toujours — et `<mark>` est
     * exactement ce que sa lecture HTML attend.
     *
     * L'aller-retour DEPUIS Filarr, lui, reste ouvert : notre export écrit un
     * `w:shd` pour garder l'hex exact, et mammoth ne lit pas le `w:shd`.
     * Fermer cette boucle imposerait la palette fermée de Word à l'export,
     * donc de perdre la couleur exacte pour gagner le retour : le compromis
     * n'a pas paru bon.
     */
    'highlight => mark',
    /**
     * LES ALIGNEMENTS, UNE ENTRÉE PAR FAMILLE ET PAR SENS.
     *
     * `marquerAlignement` pose ces noms de style juste avant la conversion.
     * mammoth ne sait pas émettre un style en ligne : il émet une CLASSE, que
     * `poserAlignements` traduit ensuite en `text-align` — la seule forme que
     * l'extension TextAlign de tiptap sait relire.
     *
     * Pourquoi une entrée par NIVEAU DE TITRE plutôt qu'une seule pour tout ?
     * Parce que le nom de style porte AUSSI le niveau : un titre qui reçoit un
     * style d'alignement perd son `Heading 1` au passage, et redescendrait en
     * paragraphe. Chaque entrée réémet donc l'élément qu'il faut — `h1`, `h2`,
     * `h3` ou `p` — avec la classe d'alignement.
     */
    ...ENTREES_ALIGNEMENT,
];
/** L'étiquette d'une image irréductible — traduite par l'appelant. */
export const ETIQUETTE_IMAGE_RETIREE_PAR_DEFAUT = '[image retirée : trop volumineuse]';
/**
 * Le walker du sweep d'images — PUR et injectable pour les tests. Visite
 * chaque nœud `image`, applique `normalize` ; null = image remplacée par le
 * paragraphe d'annonce.
 */
export async function sweepImages(doc, normalize, removedLabel) {
    async function walk(node) {
        if (node.type === 'image') {
            const src = node.attrs?.src;
            const normalized = typeof src === 'string' ? await normalize(src) : null;
            if (!normalized) {
                return {
                    type: 'paragraph',
                    content: [{ type: 'text', text: removedLabel }],
                };
            }
            return {
                ...node,
                attrs: {
                    ...node.attrs,
                    src: normalized.src,
                    width: normalized.width,
                    height: normalized.height,
                },
            };
        }
        if (Array.isArray(node.content)) {
            const content = [];
            for (const child of node.content) {
                content.push(await walk(child));
            }
            return { ...node, content };
        }
        return node;
    }
    return walk(doc);
}
/**
 * Les styles de titre que l'on sait REMPLACER sans rien perdre.
 *
 * La clé est le style Word normalisé (minuscules, sans espace ni accent) ; la
 * valeur est la famille de bloc que la conversion doit produire. Tout style
 * absent de cette table est laissé INTACT : mieux vaut perdre un alignement
 * que transformer un style qu'on n'a pas compris.
 *
 * Les noms français y sont parce que Word localise ses styles intégrés : un
 * document rédigé sur un Word français porte « Titre 1 », pas « Heading 1 ».
 */
const TITRES = {
    heading1: 'H1',
    titre1: 'H1',
    title: 'H1',
    titre: 'H1',
    heading2: 'H2',
    titre2: 'H2',
    subtitle: 'H2',
    soustitre: 'H2',
    'sous-titre': 'H2',
    heading3: 'H3',
    titre3: 'H3',
};
/** Normaliser un nom de style Word pour la table ci-dessus. */
function normaliser(nom) {
    return nom
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, '');
}
/**
 * FAIRE PASSER L'ALIGNEMENT DES PARAGRAPHES.
 *
 * mammoth ne transporte AUCUN formatage direct de paragraphe : un titre
 * centré et une adresse alignée à droite revenaient tous les deux à gauche,
 * et c'est la perte de mise en page la plus visible à l'ouverture — celle
 * qu'on remarque avant même de lire le texte.
 *
 * L'alignement, lui, EST exposé dans l'arbre du document. On s'en sert pour
 * poser un nom de style que le `styleMap` sait rendre. Le paragraphe qui
 * porte DÉJÀ un style nommé n'est pas touché : son style a préséance, et
 * l'écraser ferait perdre un titre pour gagner un alignement.
 */
/**
 * `mammoth.transforms` EXISTE à l'exécution et est documenté, mais il manque
 * des définitions de types livrées avec la bibliothèque (vérifié en 1.12.0).
 * On l'expose ici sous une forme étroite plutôt que d'assouplir le typage de
 * tout l'appel : ce qu'on utilise reste vérifié.
 */
const transforms = mammoth.transforms;
/**
 * À quelle famille appartient ce paragraphe, et a-t-on le droit d'y toucher ?
 *
 * `null` = on n'y touche pas. C'est le cas de tout style nommé qu'on ne sait
 * pas reproduire : le laisser tranquille garde le style, au prix de son
 * alignement, et c'est le bon compromis.
 */
function familleDe(styleId, styleName) {
    if (!styleId && !styleName)
        return 'P';
    for (const brut of [styleName, styleId]) {
        if (!brut)
            continue;
        const famille = TITRES[normaliser(brut)];
        if (famille)
            return famille;
    }
    return null;
}
export function marquerAlignement(paragraphe) {
    /**
     * TROIS RAISONS DE NE RIEN FAIRE, et la troisième a coûté cher.
     *
     * Un style NOMMÉ a préséance : lui substituer un style d'alignement ferait
     * gagner un centrage en perdant un niveau de titre.
     *
     * La NUMÉROTATION est la raison sérieuse. mammoth reconnaît un élément de
     * liste par la conjonction de sa numérotation ET de son style ; lui imposer
     * un style d'alignement le fait sortir de sa liste, et la liste se COUPE en
     * deux à cet endroit. Mesuré sur un document réel de l'utilisateur : 519
     * éléments de liste tombés à 34, 94 listes à puces tombées à 4, 55 listes
     * numérotées tombées à 5. Un balayage de 75 documents montre 7672
     * paragraphes numérotés SANS style nommé — le déclencheur est partout, il
     * se trouve simplement que ni Word ni notre propre export ne le produisent,
     * ce qui l'avait rendu invisible aux tests.
     */
    if (paragraphe.numbering)
        return paragraphe;
    const sens = SENS[paragraphe.alignment ?? ''];
    if (!sens)
        return paragraphe;
    const famille = familleDe(paragraphe.styleId, paragraphe.styleName);
    if (!famille)
        return paragraphe;
    const nom = `FilarrAlign${famille}${sens}`;
    return { ...paragraphe, styleId: nom, styleName: nom };
}
/**
 * Traduire les classes d'alignement en `text-align`.
 *
 * TextAlign lit `style="text-align: …"` et RIEN d'autre : une classe lui est
 * invisible. On passe par le DOM plutôt que par une substitution de texte —
 * une expression régulière sur du HTML se trompe dès qu'un attribut contient
 * un chevron.
 */
export function poserAlignements(html) {
    if (typeof DOMParser === 'undefined' || !html.includes('filarr-align-'))
        return html;
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    for (const sens of ['center', 'right', 'justify']) {
        // Le sélecteur ne se limite PAS à `p` : les titres alignés sortent en
        // `h1`/`h2`/`h3`, et un sélecteur trop étroit les laissait sans style
        // tout en leur laissant la classe — visible dans le HTML, invisible à
        // l'écran.
        for (const el of Array.from(doc.body.querySelectorAll(`.filarr-align-${sens}`))) {
            el.style.textAlign = sens;
            el.classList.remove(`filarr-align-${sens}`);
            if (el.classList.length === 0)
                el.removeAttribute('class');
        }
    }
    return doc.body.innerHTML;
}
export async function importDocx(bytes, opts = {}) {
    // Copie possédée : `buffer.slice` d'un ArrayBufferLike peut rendre un
    // SharedArrayBuffer, que mammoth refuse au typage.
    const possede = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(possede).set(bytes);
    // Les DEUX clés : le build navigateur de mammoth lit `arrayBuffer`, l'entrée
    // node (vitest, scripts) lit `buffer` — fournir les deux évite toute config
    // d'environnement.
    const { value: html } = await mammoth.convertToHtml({
        arrayBuffer: possede,
        ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(possede) } : {}),
    }, {
        styleMap: STYLE_MAP,
        transformDocument: transforms.paragraph(marquerAlignement),
    });
    const raw = generateJSON(poserAlignements(html), buildDocsExtensions({}));
    return sweepImages(raw, defaultNormalizeImage, opts.imageRemovedLabel ?? ETIQUETTE_IMAGE_RETIREE_PAR_DEFAUT);
}
/** L'implémentation navigateur du normalizeur : data-URL → compression budget. */
async function defaultNormalizeImage(src) {
    const parsed = parseDataUrl(src);
    if (!parsed)
        return null; // src réseau ou illisible : jamais dans un fdoc
    try {
        const out = await compressToBudget(parsed.bytes, parsed.mime);
        return { src: out.dataUrl, width: out.width, height: out.height };
    }
    catch {
        return null; // irréductible : remplacée par l'annonce
    }
}
