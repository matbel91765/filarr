/**
 * imagePipeline — le BUDGET des images intégrées, et le col d'étranglement.
 *
 * Une image vit DANS le JSON fdoc, en data-URL — chiffrée avec le document,
 * re-chiffrée à chaque sauvegarde par le pipeline du cœur. Jamais d'objet
 * séparé, jamais d'URL réseau (un `src` http collé depuis le web serait un
 * pixel espion : fuite d'IP et d'heure d'ouverture à un tiers à chaque rendu —
 * violation E2EE frontale ; la garde vit dans le SCHÉMA, voir fdocImage.ts).
 *
 * LES TROIS BORNES, conditions d'existence de la fonctionnalité :
 *   · 500 Ko binaire PAR IMAGE après compression (data-URL ≈ 683 Ko) ;
 *   · 700 Ko PAR DOCUMENT pour l'édition à plusieurs — marge sous la trame
 *     collab de 1 Mio (COLLAB_MAX_SEND_BYTES, collabProtocol.ts du cœur), que
 *     le relais ABANDONNE EN SILENCE au-delà : divergence puis perte de
 *     données quand l'élu sauvegarde ;
 *   · 20 Mo par document en solo (2 chunks de 16 Mio via updateVaultItem,
 *     loin du plafond serveur de 24 Mio + 128 par chunk).
 */
export declare const MAX_IMAGE_BINARY_BYTES: number;
export declare const MAX_DOC_BYTES: number;
/** Marge sous COLLAB_MAX_SEND_BYTES = 1 Mio (collabProtocol.ts du cœur). */
export declare const DOC_COLLAB_MAX_BYTES: number;
/** Une data-URL image → {mime, bytes} ; null pour tout autre `src`. */
export declare function parseDataUrl(url: string): {
    mime: string;
    bytes: Uint8Array;
} | null;
/** Octets BINAIRES portés par une data-URL (0 si ce n'en est pas une). */
export declare function dataUrlByteLength(url: string): number;
/** Le `type` qu'ImageRun (docx 9.6+) exige — null = image à SAUTER à l'export. */
export declare function docxImageType(mime: string): 'png' | 'jpg' | 'gif' | 'bmp' | null;
export interface CompressedImage {
    dataUrl: string;
    width: number;
    height: number;
}
/**
 * Compression NAVIGATEUR vers le budget : décodage blob→Image, downscale à
 * 1600 px max de côté, ré-encodage JPEG en qualité décroissante (0.85 → 0.7 →
 * 0.55). Un PNG déjà sous budget reste PNG (alpha préservé). Jette
 * Error('image_too_large') si rien n'y suffit.
 */
export declare function compressToBudget(bytes: Uint8Array, mime: string): Promise<CompressedImage>;
