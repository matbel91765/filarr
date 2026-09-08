/**
 * L'IMAGE DE FOND D'UN THÈME — y compris ANIMÉE.
 *
 * ── POURQUOI ON NE PEUT PAS FAIRE COMME POUR LES ICÔNES ─────────────────────
 *
 * L'icône d'une fiche de la place de marché est REDESSINÉE dans un canevas : la
 * taille devient bornée par construction, et le SVG — un document qui peut
 * porter des scripts — cesse d'être un sujet, puisque ce qui SORT est toujours
 * du raster.
 *
 * Un décor animé ne supporte pas ce traitement. Un canevas ne rend qu'une seule
 * image : réencoder un GIF le fige. Or « ajouter une image animée » est
 * exactement ce qui est demandé.
 *
 * ── DEUX RÉGIMES, ET CE N'EST PAS UN COMPROMIS ──────────────────────────────
 *
 *   · IMAGE FIXE (PNG, JPEG) — réencodée dans un canevas, comme les icônes.
 *     Bornée par construction, et le SVG ne peut pas en ressortir.
 *   · IMAGE ANIMÉE (GIF, WebP, AVIF) — gardée telle quelle, parce qu'il n'y a
 *     pas d'autre choix. La garantie change donc de nature : on ne borne plus
 *     par construction, on VÉRIFIE LA SIGNATURE et on PLAFONNE la taille.
 *
 * ── LA SIGNATURE, PAS LE TYPE DÉCLARÉ ───────────────────────────────────────
 *
 * `File.type` vient du système de fichiers : il se déduit de l'extension et se
 * renomme d'un clic droit. Un SVG appelé `fond.gif` arrive ici avec
 * `type === 'image/gif'`. On lit donc les PREMIERS OCTETS, qui, eux, ne se
 * renomment pas.
 */

/**
 * Le plafond d'un décor : 2,5 Mo.
 *
 * Ce n'est pas une prudence abstraite, c'est le stockage local. Le thème est
 * retenu par profil dans `localStorage`, dont le quota tourne autour de cinq
 * mégaoctets pour TOUT le profil — et une URL de données pèse un tiers de plus
 * que le fichier. Au-delà de ce plafond, ce n'est pas le décor qui casse, c'est
 * l'écriture de tout ce qui suit.
 */
export const BACKDROP_MAX_BYTES = Math.floor(2.5 * 1024 * 1024);

/** Les formats reconnus. Tout le reste est refusé. */
export type BackdropImageType = 'gif' | 'png' | 'jpeg' | 'webp' | 'avif';

/** Ceux qui peuvent porter une animation, et qu'on garde donc verbatim. */
const ANIMATED_CAPABLE: readonly BackdropImageType[] = ['gif', 'webp', 'avif'];

export function canAnimate(type: BackdropImageType): boolean {
  return ANIMATED_CAPABLE.includes(type);
}

/**
 * Le type RÉEL d'un fichier, lu dans ses premiers octets.
 *
 * Pur et sans DOM : c'est la fonction qu'on peut éprouver sur des octets
 * fabriqués à la main, y compris les cas tordus (un SVG déguisé, un fichier
 * tronqué, un RIFF qui n'est pas du WebP).
 */
export function sniffImageType(bytes: Uint8Array): BackdropImageType | null {
  const at = (i: number): number => (i < bytes.length ? bytes[i] : -1);
  const ascii = (start: number, text: string): boolean =>
    [...text].every((ch, i) => at(start + i) === ch.charCodeAt(0));

  // GIF87a / GIF89a
  if (ascii(0, 'GIF8') && (at(4) === 0x37 || at(4) === 0x39) && at(5) === 0x61) return 'gif';

  // PNG : \x89PNG\r\n\x1a\n — les huit octets, pas les quatre premiers. Les
  // quatre suivants sont là justement pour détecter un transfert abîmé.
  if (
    at(0) === 0x89 &&
    ascii(1, 'PNG') &&
    at(4) === 0x0d &&
    at(5) === 0x0a &&
    at(6) === 0x1a &&
    at(7) === 0x0a
  ) {
    return 'png';
  }

  // JPEG : SOI (FFD8) suivi d'un marqueur (FF..).
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg';

  // WebP : un conteneur RIFF dont le sous-type est WEBP. ⚠ Vérifier « RIFF »
  // seul ne suffit pas — c'est aussi l'en-tête d'un WAV et d'un AVI.
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'webp';

  // AVIF : une boîte ISO-BMFF `ftyp` dont la marque est `avif` ou `avis`
  // (« avis » = séquence, c'est-à-dire précisément le cas animé).
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'avif';

  return null;
}

export type BackdropError = 'unsupported-format' | 'too-large' | 'unreadable';

export class BackdropFailure extends Error {
  readonly code: BackdropError;
  constructor(code: BackdropError) {
    super(code);
    this.name = 'BackdropFailure';
    this.code = code;
  }
}

/** Les octets d'une URL de données, sans la décoder. */
export function dataUrlBytes(url: string): number {
  const comma = url.indexOf(',');
  if (comma < 0) return Number.POSITIVE_INFINITY;
  return Math.floor(((url.length - comma - 1) * 3) / 4);
}

const MIME: Record<BackdropImageType, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
};

function toBase64(bytes: Uint8Array): string {
  // Par tranches : `String.fromCharCode(...bytes)` sur deux millions d'octets
  // dépasse la limite d'arguments d'un appel et lève un RangeError.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** La largeur maximale d'un décor réencodé. Au-delà, on ne gagne rien à l'œil. */
const STILL_MAX_WIDTH = 1920;
const STILL_QUALITIES = [0.82, 0.7, 0.55, 0.4] as const;

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const done = (fn: () => void): void => {
      URL.revokeObjectURL(url);
      fn();
    };
    img.onload = () => done(() => resolve(img));
    img.onerror = () => done(() => reject(new BackdropFailure('unreadable')));
    img.src = url;
  });
}

/**
 * Prépare un fichier choisi pour servir de décor.
 *
 * Rend une URL de données que `normalizeSpec` acceptera. Lève un
 * `BackdropFailure` dont le code se traduit — l'écran doit pouvoir dire ce qui
 * ne va pas, pas afficher « échec ».
 */
export async function readBackdropFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer().catch(() => null);
  if (!buffer) throw new BackdropFailure('unreadable');
  const bytes = new Uint8Array(buffer);

  const type = sniffImageType(bytes);
  // ⚠ Le refus se fonde sur la SIGNATURE. Un SVG renommé `fond.gif` tombe ici,
  // et c'est tout l'intérêt : il n'a pas de signature binaire reconnue.
  if (!type) throw new BackdropFailure('unsupported-format');

  // ---- Régime « animée » : on garde les octets, on plafonne. ----
  if (canAnimate(type)) {
    if (bytes.length > BACKDROP_MAX_BYTES) throw new BackdropFailure('too-large');
    return `data:${MIME[type]};base64,${toBase64(bytes)}`;
  }

  // ---- Régime « fixe » : on redessine, donc la taille est bornée. ----
  const img = await loadImage(new Blob([bytes], { type: MIME[type] }));
  const scale = Math.min(1, STILL_MAX_WIDTH / (img.naturalWidth || img.width || 1));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new BackdropFailure('unreadable');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const quality of STILL_QUALITIES) {
    const url = canvas.toDataURL('image/webp', quality);
    // ⚠ On regarde ce qui est SORTI : un navigateur sans encodeur WebP rend un
    // PNG sans le dire, et un PNG ne réagit pas à la qualité — insister ferait
    // quatre fois le même résultat trop lourd.
    const isWebp = url.startsWith('data:image/webp');
    if (dataUrlBytes(url) <= BACKDROP_MAX_BYTES) return url;
    if (!isWebp) break;
  }

  const jpeg = canvas.toDataURL('image/jpeg', 0.7);
  if (dataUrlBytes(jpeg) <= BACKDROP_MAX_BYTES) return jpeg;
  throw new BackdropFailure('too-large');
}
