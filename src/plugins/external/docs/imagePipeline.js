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
export const MAX_IMAGE_BINARY_BYTES = 500 * 1024;
export const MAX_DOC_BYTES = 20 * 1024 * 1024;
/** Marge sous COLLAB_MAX_SEND_BYTES = 1 Mio (collabProtocol.ts du cœur). */
export const DOC_COLLAB_MAX_BYTES = 700 * 1024;
const DATA_URL_RE = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i;
/** Une data-URL image → {mime, bytes} ; null pour tout autre `src`. */
export function parseDataUrl(url) {
    const m = DATA_URL_RE.exec(url);
    if (!m)
        return null;
    try {
        const raw = atob(m[2]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++)
            bytes[i] = raw.charCodeAt(i);
        return { mime: m[1].toLowerCase(), bytes };
    }
    catch {
        return null;
    }
}
/** Octets BINAIRES portés par une data-URL (0 si ce n'en est pas une). */
export function dataUrlByteLength(url) {
    const m = DATA_URL_RE.exec(url);
    if (!m)
        return 0;
    const b64 = m[2];
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((b64.length * 3) / 4) - padding;
}
/** Le `type` qu'ImageRun (docx 9.6+) exige — null = image à SAUTER à l'export. */
export function docxImageType(mime) {
    switch (mime.toLowerCase()) {
        case 'image/png':
            return 'png';
        case 'image/jpeg':
        case 'image/jpg':
            return 'jpg';
        case 'image/gif':
            return 'gif';
        case 'image/bmp':
            return 'bmp';
        default:
            // webp et consorts ne sont pas des types docx — le pipeline d'insertion
            // ré-encode en JPEG/PNG ; l'export SAUTE plutôt que d'émettre un fichier
            // que Word refuserait d'ouvrir.
            return null;
    }
}
/**
 * Compression NAVIGATEUR vers le budget : décodage blob→Image, downscale à
 * 1600 px max de côté, ré-encodage JPEG en qualité décroissante (0.85 → 0.7 →
 * 0.55). Un PNG déjà sous budget reste PNG (alpha préservé). Jette
 * Error('image_too_large') si rien n'y suffit.
 */
export async function compressToBudget(bytes, mime) {
    const owned = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(owned).set(bytes);
    const blob = new Blob([owned], { type: mime });
    const url = URL.createObjectURL(blob);
    try {
        const img = await new Promise((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('image_unreadable'));
            el.src = url;
        });
        // PNG petit et potentiellement transparent : garder tel quel.
        if (mime === 'image/png' && bytes.byteLength <= MAX_IMAGE_BINARY_BYTES) {
            const dataUrl = await blobToDataUrl(blob);
            return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
        }
        const MAX_SIDE = 1600;
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const width = Math.max(1, Math.round(img.naturalWidth * scale));
        const height = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx)
            throw new Error('image_unreadable');
        ctx.drawImage(img, 0, 0, width, height);
        for (const quality of [0.85, 0.7, 0.55]) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (dataUrlByteLength(dataUrl) <= MAX_IMAGE_BINARY_BYTES) {
                return { dataUrl, width, height };
            }
        }
        throw new Error('image_too_large');
    }
    finally {
        URL.revokeObjectURL(url);
    }
}
function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('image_unreadable'));
        reader.readAsDataURL(blob);
    });
}
