/**
 * FABRIQUER LA VIGNETTE D'UNE FICHE — et pourquoi on ne prend pas le fichier.
 *
 * ── ON RÉENCODE, ON N'ACCEPTE PAS ───────────────────────────────────────────
 *
 * La tentation serait de lire le fichier choisi, de le passer en base64 et de
 * refuser s'il dépasse. Ce serait mettre la borne du mauvais côté : la personne
 * choisit une capture d'écran de 2 Mo, on la refuse, elle ne sait pas quoi
 * faire, et elle abandonne.
 *
 * Ici le navigateur REDESSINE l'image dans un canevas de 96×96 et la réencode.
 * La taille est alors bornée PAR CONSTRUCTION, quelle que soit l'entrée — et
 * l'auteur peut déposer ce qu'il veut.
 *
 * ── ET ÇA FERME LE SVG SANS AVOIR À LE DIRE ─────────────────────────────────
 *
 * Un SVG est un DOCUMENT : il peut porter des scripts et des références
 * externes, et le rendre dans une page qui manipule des clés serait ouvrir une
 * porte pour une icône. Passer par un canevas rend le problème sans objet : ce
 * qui SORT est toujours du raster, quoi qu'il soit entré.
 *
 * ── LE FORMAT SERVI N'EST PAS CELUI QU'ON DEMANDE ───────────────────────────
 *
 * `toDataURL('image/webp')` rend un PNG, SANS ERREUR, sur un navigateur qui ne
 * sait pas encoder le WebP. On vérifie donc ce qui est SORTI plutôt que ce
 * qu'on a demandé — c'est le genre de repli silencieux qui produit une vignette
 * trois fois trop lourde sans que rien ne le signale.
 */

import {
  LAYOUT_ICON_MAX_BYTES,
  LAYOUT_PREVIEW_MAX_BYTES,
  isImageIcon,
  isPreviewImage,
} from './layoutMarketTypes';

/**
 * Le côté de la vignette, en pixels.
 *
 * 96 et non 64 : les cartes de catalogue rendent l'icône autour de 40 px, et un
 * écran à deux ou trois fois la densité la réclame nette. 96 couvre le ×2 sans
 * discussion et reste sous le plafond même en PNG.
 */
export const LAYOUT_ICON_SIZE = 96;

/**
 * Les qualités essayées, de la meilleure à la plus basse.
 *
 * On s'arrête à la PREMIÈRE qui tient sous le plafond : descendre plus bas que
 * nécessaire abîmerait l'image pour rien.
 */
const QUALITIES = [0.9, 0.75, 0.6, 0.45, 0.3] as const;

export type IconThumbnailError = 'not-an-image' | 'unreadable' | 'too-large';

export class IconThumbnailFailure extends Error {
  readonly code: IconThumbnailError;
  constructor(code: IconThumbnailError) {
    super(code);
    this.name = 'IconThumbnailFailure';
    this.code = code;
  }
}

/** Charge le fichier dans une image — et rend la main dans tous les cas. */
function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (fn: () => void): void => {
      // L'URL d'objet est révoquée dans les DEUX issues : une fuite par image
      // refusée finirait par retenir des mégaoctets sur un formulaire qu'on
      // remplit à tâtons.
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new IconThumbnailFailure('unreadable')));
    img.src = url;
  });
}

/**
 * Dessine l'image CENTRÉE et RECADRÉE dans un carré.
 *
 * Le recadrage « couvre » plutôt que « contient » : une bannière 16:9 réduite à
 * l'intérieur d'un carré donnerait une vignette aux trois quarts vide, qu'on
 * lirait comme un défaut d'affichage. On prend le carré central.
 */
function drawSquare(img: HTMLImageElement, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new IconThumbnailFailure('unreadable');

  const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  if (side <= 0) throw new IconThumbnailFailure('unreadable');
  const sx = ((img.naturalWidth || img.width) - side) / 2;
  const sy = ((img.naturalHeight || img.height) - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas;
}

/** Les octets d'une URL de données, sans la décoder. */
function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  if (comma < 0) return Number.POSITIVE_INFINITY;
  return Math.floor(((url.length - comma - 1) * 3) / 4);
}

/**
 * Fabrique la vignette d'une fiche à partir d'un fichier choisi.
 *
 * Rend une URL de données que `isImageIcon` accepte — la vérification finale
 * est faite ici, contre la MÊME fonction que le worker : ce que ce module
 * produit ne peut pas être refusé à la publication pour une raison de forme.
 */
export async function makeIconThumbnail(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new IconThumbnailFailure('not-an-image');

  const img = await loadImage(file);

  // Deux tailles, et la seconde n'est atteinte que si la première ne tient pas
  // même au minimum de qualité — un cas que seule une image très bruitée
  // encodée en PNG produit.
  for (const size of [LAYOUT_ICON_SIZE, 64]) {
    const canvas = drawSquare(img, size);
    for (const quality of QUALITIES) {
      const url = canvas.toDataURL('image/webp', quality);
      // ⚠ On regarde ce qui est SORTI : un navigateur sans encodeur WebP rend
      // un PNG sans le dire, et un PNG ne réagit pas à la qualité — insister
      // ferait cinq fois le même résultat trop lourd.
      const isWebp = url.startsWith('data:image/webp');
      if (dataUrlBytes(url) <= LAYOUT_ICON_MAX_BYTES && isImageIcon(url)) return url;
      if (!isWebp) break;
    }
    const png = canvas.toDataURL('image/png');
    if (dataUrlBytes(png) <= LAYOUT_ICON_MAX_BYTES && isImageIcon(png)) return png;
  }

  throw new IconThumbnailFailure('too-large');
}

/**
 * La taille de l'aperçu. 16/9, comme une capture d'écran.
 *
 * ⚠ ELLE EST DEVENUE UNE TAILLE DE LECTURE, PAS UNE VIGNETTE. Tant que la fiche
 * n'affichait l'image que dans un cadre de quelques centaines de pixels, 640×360
 * suffisait. Depuis que la capture s'ouvre EN GRAND (voir `ShotLightbox`), la
 * même image est étirée sur la moitié d'un écran de portable : à 640 de large
 * elle devient une bouillie, et la visionneuse promet alors quelque chose
 * qu'elle ne tient pas.
 *
 * 1280×720 est le premier palier qui reste net sur un écran ordinaire sans
 * faire exploser l'enveloppe signée (voir `LAYOUT_MARKET_MAX_ENVELOPE_BYTES`,
 * borné par la ligne D1 qui la range).
 */
export const LAYOUT_PREVIEW_WIDTH = 1280;
export const LAYOUT_PREVIEW_HEIGHT = 720;

/**
 * Les tailles ESSAYÉES, dans l'ordre.
 *
 * On descend plutôt que de refuser : une capture très bruitée (un fond
 * photographique, du grain) peut ne pas tenir dans le plafond même au minimum
 * de qualité en 1280 de large. Mieux vaut alors une image plus petite qu'un
 * message d'erreur — la fiche perdrait sa seule illustration pour une raison
 * que son auteur ne peut pas corriger.
 */
const PREVIEW_SIZES: readonly (readonly [number, number])[] = [
  [LAYOUT_PREVIEW_WIDTH, LAYOUT_PREVIEW_HEIGHT],
  [960, 540],
  [640, 360],
];

/** Dessine l'image recadrée « couvre » dans un rectangle. */
function drawCover(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new IconThumbnailFailure('unreadable');

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (iw <= 0 || ih <= 0) throw new IconThumbnailFailure('unreadable');

  // « Couvre » : on garde le rectangle central au bon rapport. Une capture
  // d'écran contenue dans un cadre 16/9 laisserait deux bandes vides, qu'on
  // lirait comme un défaut d'affichage.
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas;
}

/**
 * Fabrique les DEUX images d'une fiche à partir d'un seul fichier.
 *
 * Un seul geste, deux objets : l'auteur dépose sa capture, on en tire l'icône
 * carrée du catalogue ET l'aperçu large de la fiche. Lui demander deux fichiers
 * pour la même image serait lui faire faire notre travail.
 */
export async function makeListingImages(file: File): Promise<{ icon: string; preview: string }> {
  if (!file.type.startsWith('image/')) throw new IconThumbnailFailure('not-an-image');
  const img = await loadImage(file);

  // L'icône : le carré central, petit.
  let icon = '';
  for (const size of [LAYOUT_ICON_SIZE, 64]) {
    const canvas = drawSquare(img, size);
    for (const quality of QUALITIES) {
      const url = canvas.toDataURL('image/webp', quality);
      const isWebp = url.startsWith('data:image/webp');
      if (dataUrlBytes(url) <= LAYOUT_ICON_MAX_BYTES && isImageIcon(url)) {
        icon = url;
        break;
      }
      if (!isWebp) break;
    }
    if (icon) break;
    const png = canvas.toDataURL('image/png');
    if (dataUrlBytes(png) <= LAYOUT_ICON_MAX_BYTES && isImageIcon(png)) {
      icon = png;
      break;
    }
  }
  if (!icon) throw new IconThumbnailFailure('too-large');

  // L'aperçu : le rectangle 16/9, large.
  let preview = '';
  for (const [w, h] of PREVIEW_SIZES) {
    const canvas = drawCover(img, w, h);
    for (const quality of QUALITIES) {
      const url = canvas.toDataURL('image/webp', quality);
      const isWebp = url.startsWith('data:image/webp');
      if (dataUrlBytes(url) <= LAYOUT_PREVIEW_MAX_BYTES && isPreviewImage(url)) {
        preview = url;
        break;
      }
      if (!isWebp) break;
    }
    if (preview) break;
  }
  // Un aperçu manquant n'est pas fatal : la fiche retombe sur la géométrie.
  return { icon, preview };
}

/**
 * Une capture SEULE, pour agrandir une galerie.
 *
 * `makeListingImages` fabrique le couple (icône, aperçu) à partir de la
 * PREMIÈRE image déposée : c'est elle qui donne son visage à la fiche dans le
 * catalogue. Les suivantes n'ont pas à redéfinir l'icône — les redessiner en
 * 96×96 pour jeter le résultat serait du travail pur perte, et laisser la
 * quatrième capture décider de la pastille serait surtout très surprenant.
 */
export async function makePreviewImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new IconThumbnailFailure('not-an-image');
  const img = await loadImage(file);

  for (const [w, h] of PREVIEW_SIZES) {
    const canvas = drawCover(img, w, h);
    for (const quality of QUALITIES) {
      const url = canvas.toDataURL('image/webp', quality);
      const isWebp = url.startsWith('data:image/webp');
      if (dataUrlBytes(url) <= LAYOUT_PREVIEW_MAX_BYTES && isPreviewImage(url)) return url;
      if (!isWebp) break;
    }
  }
  throw new IconThumbnailFailure('too-large');
}
