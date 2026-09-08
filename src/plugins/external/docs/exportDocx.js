/**
 * Export docx — LA FRONTIÈRE DE SORTIE, fidèle EN SORTIE.
 *
 * Projection du document ProseMirror vers la bibliothèque `docx` :
 * paragraphes, titres, listes, citations, tables, images data-URL, alignement,
 * souligné/barré, couleur, surlignage, LIENS (ExternalHyperlink), BLOCS DE
 * CODE (paragraphe mono ombré), CODE EN LIGNE (run mono) et SÉPARATEURS
 * (paragraphe à bordure basse). « Fidèle en sortie » et pas
 * « symétrique » : mammoth ne réimporte ni alignement ni couleur ni surlignage
 * — un aller-retour ne conserve que la structure (titres/listes/tables/gras/
 * souligné/barré/images). L'export est une PHOTO pour l'échange — le document
 * de travail reste le fdoc.
 */
import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, ImageRun, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, } from 'docx';
import { parseDataUrl, docxImageType } from './imagePipeline';
import { isSafeLinkUrl } from './docsLinks';
/**
 * Le code se VOIT : une police à chasse fixe et un fond discret. Word n'a pas
 * de notion de « bloc de code » — c'est un paragraphe ombré, et c'est tout ce
 * qu'un format d'échange peut promettre honnêtement.
 */
const POLICE_MONO = 'Consolas';
/** Les cases de tâche, en caractères plutôt qu'en contrôles Word (voir taskList). */
const CASE_COCHEE = '☑';
const CASE_VIDE = '☐';
const ESPACE_INSEC = ' ';
const FOND_CODE = 'F3F4F6';
const ALIGN = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
};
function hexOf(color) {
    if (typeof color !== 'string')
        return undefined;
    const hex = color.startsWith('#') ? color.slice(1) : color;
    return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : undefined;
}
function runsOf(node) {
    const runs = [];
    for (const child of node.content ?? []) {
        if (child.type === 'image') {
            const image = imageRunOf(child);
            if (image)
                runs.push(image);
            continue;
        }
        if (child.type !== 'text' || !child.text)
            continue;
        const marks = new Map((child.marks ?? []).map((m) => [m.type, m]));
        const color = hexOf(marks.get('textStyle')?.attrs?.color);
        const highlight = hexOf(marks.get('highlight')?.attrs?.color);
        const mono = marks.has('code');
        const run = new TextRun({
            text: child.text,
            bold: marks.has('bold'),
            italics: marks.has('italic'),
            ...(marks.has('underline') ? { underline: {} } : {}),
            strike: marks.has('strike'),
            ...(color ? { color } : {}),
            // Les noms de highlight docx sont une palette fermée : `shading`
            // porte l'hex exact, lui.
            ...(highlight ? { shading: { type: ShadingType.CLEAR, fill: highlight } } : {}),
            // Le code EN LIGNE : chasse fixe et fond léger, comme à l'écran.
            ...(mono ? { font: POLICE_MONO, shading: { type: ShadingType.CLEAR, fill: FOND_CODE } } : {}),
            // Exposant et indice ont un équivalent EXACT en OOXML : aucune
            // approximation à annoncer pour ces deux-là.
            ...(marks.has('superscript') ? { superScript: true } : {}),
            ...(marks.has('subscript') ? { subScript: true } : {}),
        });
        /**
         * LA MARQUE LINK — elle n'était JAMAIS lue : l'adresse disparaissait à
         * l'export, le texte restait, et personne n'était prévenu. Elle devient un
         * ExternalHyperlink. `isSafeLinkUrl` refait le tri au passage : on
         * n'écrit pas une adresse hostile dans un fichier qu'on envoie à un tiers
         * — dans ce cas le texte part seul, ce qui est la perte la plus honnête.
         */
        const href = marks.get('link')?.attrs?.href;
        if (typeof href === 'string' && isSafeLinkUrl(href)) {
            runs.push(new ExternalHyperlink({ children: [run], link: href }));
        }
        else {
            runs.push(run);
        }
    }
    return runs;
}
/** Le bloc de code : un paragraphe ombré dont chaque ligne est un run mono. */
function codeBlockParagraph(node) {
    // Le contenu d'un codeBlock est un nœud TEXTE — pas des paragraphes. C'est
    // exactement ce que le `default:` récursif ne savait pas voir : il descendait
    // dans un nœud sans cas ET sans contenu, et le bloc s'évaporait, texte
    // compris.
    const brut = (node.content ?? [])
        .map((c) => c.text ?? '')
        .join('');
    const lignes = brut.split('\n');
    return new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: FOND_CODE },
        children: lignes.map((ligne, i) => new TextRun({
            text: ligne,
            font: POLICE_MONO,
            // `break: 1` insère le saut AVANT le run : jamais sur le premier.
            ...(i > 0 ? { break: 1 } : {}),
        })),
    });
}
/** ImageRun depuis une data-URL — null = image sautée (type docx inconnu). */
function imageRunOf(node) {
    const src = node.attrs?.src;
    if (typeof src !== 'string')
        return null;
    const parsed = parseDataUrl(src);
    if (!parsed)
        return null;
    const type = docxImageType(parsed.mime);
    if (!type)
        return null; // jamais un fichier que Word refuserait d'ouvrir
    // Copie possédée (même motif ArrayBuffer que l'import v0.1).
    const owned = new Uint8Array(new ArrayBuffer(parsed.bytes.byteLength));
    owned.set(parsed.bytes);
    const naturalWidth = node.attrs?.width ?? 480;
    const naturalHeight = node.attrs?.height ?? 320;
    const width = Math.min(naturalWidth, 600);
    const height = Math.max(1, Math.round((naturalHeight * width) / naturalWidth));
    return new ImageRun({ type, data: owned, transformation: { width, height } });
}
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
function alignmentOf(node) {
    const align = node.attrs?.textAlign;
    return align && ALIGN[align] ? { alignment: ALIGN[align] } : {};
}
function childrenOf(node, sortie, profondeurListe = 0) {
    switch (node.type) {
        case 'paragraph':
            sortie.push(new Paragraph({ children: runsOf(node), ...alignmentOf(node) }));
            return;
        case 'heading': {
            const niveau = Math.min(Math.max(node.attrs?.level ?? 1, 1), 3) - 1;
            sortie.push(new Paragraph({ children: runsOf(node), heading: HEADINGS[niveau], ...alignmentOf(node) }));
            return;
        }
        case 'codeBlock':
            sortie.push(codeBlockParagraph(node));
            return;
        case 'taskList': {
            /**
             * APPROXIMATION ANNONCÉE. Word a de vraies cases à cocher (contrôles de
             * contenu SDT), mais mammoth ne les réimporte pas : les écrire
             * fabriquerait un aller-retour qui perd l'état coché sans le dire.
             * Un préfixe ☐/☑ montre l'état, se lit partout, et n'affirme rien de
             * faux — c'est la même honnêteté que le bandeau de perte à l'import.
             */
            for (const item of node.content ?? []) {
                const coche = item.attrs?.checked === true;
                const blocs = item.content ?? [];
                let premier = true;
                for (const bloc of blocs) {
                    if (bloc.type === 'paragraph') {
                        sortie.push(new Paragraph({
                            children: [
                                new TextRun({ text: `${premier ? (coche ? CASE_COCHEE : CASE_VIDE) : ESPACE_INSEC} ` }),
                                ...runsOf(bloc),
                            ],
                            ...alignmentOf(bloc),
                            indent: { left: 360 * (profondeurListe + 1) },
                        }));
                        premier = false;
                    }
                    else {
                        // Une sous-liste de tâches, ou tout autre bloc imbriqué.
                        childrenOf(bloc, sortie, profondeurListe + 1);
                    }
                }
            }
            return;
        }
        case 'horizontalRule':
            // Word n'a pas de <hr> : la convention est un paragraphe vide à bordure
            // basse. Sans ce cas, le séparateur — qui n'a AUCUN contenu — tombait
            // dans le `default:` et disparaissait sans un mot.
            sortie.push(new Paragraph({
                border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'AAAAAA' } },
            }));
            return;
        case 'image': {
            // Nœud image BLOC (hors paragraphe) : son propre paragraphe.
            const image = imageRunOf(node);
            if (image)
                sortie.push(new Paragraph({ children: [image] }));
            return;
        }
        case 'bulletList':
        case 'orderedList': {
            for (const item of node.content ?? []) {
                for (const bloc of item.content ?? []) {
                    if (bloc.type === 'paragraph') {
                        sortie.push(new Paragraph({
                            children: runsOf(bloc),
                            ...alignmentOf(bloc),
                            bullet: node.type === 'bulletList' ? { level: profondeurListe } : undefined,
                            numbering: node.type === 'orderedList'
                                ? { reference: 'fdocs-num', level: profondeurListe }
                                : undefined,
                        }));
                    }
                    else {
                        childrenOf(bloc, sortie, profondeurListe + 1);
                    }
                }
            }
            return;
        }
        case 'table': {
            const rows = (node.content ?? []).map((row) => new TableRow({
                children: (row.content ?? []).map((cell) => {
                    const enfants = [];
                    for (const bloc of cell.content ?? [])
                        childrenOf(bloc, enfants, profondeurListe);
                    const paragraphes = enfants.filter((e) => e instanceof Paragraph);
                    return new TableCell({
                        // Une TableCell docx EXIGE au moins un Paragraph — une cellule
                        // vide sans lui produit un .docx que Word refuse d'ouvrir.
                        children: paragraphes.length ? paragraphes : [new Paragraph({})],
                        ...(cell.type === 'tableHeader'
                            ? { shading: { type: ShadingType.CLEAR, fill: 'EEEEEE' } }
                            : {}),
                    });
                }),
            }));
            sortie.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
            return;
        }
        case 'blockquote':
            for (const bloc of node.content ?? [])
                childrenOf(bloc, sortie, profondeurListe);
            return;
        default:
            // Un nœud futur inconnu DÉGRADE en descente récursive — jamais un crash.
            for (const bloc of node.content ?? [])
                childrenOf(bloc, sortie, profondeurListe);
    }
}
/** Exporté pour les tests : la projection sans l'emballage Packer. */
export function buildDocxChildren(pmDoc) {
    const sortie = [];
    childrenOf(pmDoc, sortie);
    return sortie;
}
export async function exportDocx(pmDoc) {
    const doc = new Document({
        numbering: {
            config: [
                {
                    reference: 'fdocs-num',
                    levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: 'left' }],
                },
            ],
        },
        sections: [{ children: buildDocxChildren(pmDoc) }],
    });
    // Node/vitest : Packer.toBuffer (le Blob de jsdom n'a pas arrayBuffer) ;
    // navigateur : toBlob. Même octets, deux emballages.
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(await Packer.toBuffer(doc));
    }
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
}
