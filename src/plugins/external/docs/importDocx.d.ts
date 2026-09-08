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
export declare const STYLE_MAP: string[];
/** L'étiquette d'une image irréductible — traduite par l'appelant. */
export declare const ETIQUETTE_IMAGE_RETIREE_PAR_DEFAUT = "[image retir\u00E9e : trop volumineuse]";
export type NormalizeImage = (src: string) => Promise<{
    src: string;
    width: number | null;
    height: number | null;
} | null>;
/**
 * Le walker du sweep d'images — PUR et injectable pour les tests. Visite
 * chaque nœud `image`, applique `normalize` ; null = image remplacée par le
 * paragraphe d'annonce.
 */
export declare function sweepImages(doc: Record<string, unknown>, normalize: NormalizeImage, removedLabel: string): Promise<Record<string, unknown>>;
export interface ImportDocxOptions {
    /** Ce qui remplace une image irréductible — un message, donc traduit. */
    imageRemovedLabel?: string;
}
export declare function marquerAlignement(paragraphe: {
    alignment?: string | null;
    styleId?: string | null;
    styleName?: string | null;
    /**
     * La numérotation Word — présente sur TOUT élément de liste, à puces comme
     * numéroté. C'est le garde-fou le plus important de cette fonction : voir
     * ci-dessous.
     */
    numbering?: unknown;
}): typeof paragraphe;
/**
 * Traduire les classes d'alignement en `text-align`.
 *
 * TextAlign lit `style="text-align: …"` et RIEN d'autre : une classe lui est
 * invisible. On passe par le DOM plutôt que par une substitution de texte —
 * une expression régulière sur du HTML se trompe dès qu'un attribut contient
 * un chevron.
 */
export declare function poserAlignements(html: string): string;
export declare function importDocx(bytes: Uint8Array, opts?: ImportDocxOptions): Promise<Record<string, unknown>>;
