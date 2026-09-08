/**
 * L'ICÔNE D'UNE FICHE — ce qu'on accepte, et surtout ce qu'on refuse.
 *
 * Une icône est le seul champ d'une enveloppe qui devienne une BALISE dans la
 * page de quelqu'un d'autre. C'est donc le seul qui mérite d'être attaqué :
 *
 *   · un SVG est un DOCUMENT (script, références externes) — jamais accepté,
 *     quoi que prétende son en-tête ;
 *   · un `data:` qui annonce une image sans en porter la signature ne doit pas
 *     passer : l'en-tête est écrit par l'émetteur, les octets ne mentent pas ;
 *   · le plafond doit être tenu SANS décoder — cinquante vignettes dans une
 *     page de catalogue, c'est ce qui décide qu'elle se charge ou non.
 */

import { describe, it, expect } from 'vitest';

import { LAYOUT_ICON_MAX_BYTES, isEmojiOnly, isIconValue, isImageIcon } from '../layoutMarketTypes';

/** Les premiers octets d'un vrai PNG, en base64 — la signature `\x89PNG`. */
const PNG_HEAD = 'iVBORw0KGgoAAAANSUhEUg';
/** Ceux d'un conteneur RIFF/WebP. */
const WEBP_HEAD = 'UklGRiQAAABXRUJQVlA4';

const png = (payload = PNG_HEAD) => `data:image/png;base64,${payload}`;
const webp = (payload = WEBP_HEAD) => `data:image/webp;base64,${payload}`;

/** Une charge base64 valide de `bytes` octets, commençant par `head`. */
function padded(head: string, bytes: number): string {
  const chars = Math.ceil((bytes * 4) / 3);
  return head + 'A'.repeat(Math.max(0, chars - head.length));
}

// ==================== 1. Ce qui passe ====================

describe('les deux formes légitimes', () => {
  it('un emoji reste une icône', () => {
    expect(isIconValue('🗂️')).toBe(true);
    expect(isIconValue('👨‍👩‍👧‍👦')).toBe(true);
  });

  it('un PNG et un WebP bien formés passent', () => {
    expect(isImageIcon(png())).toBe(true);
    expect(isImageIcon(webp())).toBe(true);
    expect(isIconValue(png())).toBe(true);
  });

  it('une vignette PILE à la borne passe', () => {
    expect(isImageIcon(png(padded(PNG_HEAD, LAYOUT_ICON_MAX_BYTES)))).toBe(true);
  });
});

// ==================== 2. Le SVG, et rien que le SVG ====================

describe('LE SVG NE PASSE JAMAIS', () => {
  it('même annoncé comme une image, même avec une charge valide', () => {
    // Un SVG peut porter `<script>` et des références externes. Le rendre dans
    // une application qui manipule des clés serait ouvrir une porte pour une
    // icône — et l'en-tête `data:` est écrit par celui qui publie.
    expect(isImageIcon('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isImageIcon('data:image/svg+xml,<svg onload=alert(1)>')).toBe(false);
    expect(isIconValue('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
  });
});

// ==================== 3. Ce que l'en-tête prétend ====================

describe('l’en-tête ne suffit pas — les octets décident', () => {
  it('un PNG annoncé sans la signature d’un PNG est refusé', () => {
    // Le cas qui compte : quelqu'un met n'importe quoi et écrit `image/png`
    // devant. La signature base64 d'un vrai PNG commence par `iVBORw0KGgo`.
    expect(isImageIcon('data:image/png;base64,QUJDREVGRw==')).toBe(false);
  });

  it('un WebP annoncé avec une signature de PNG est refusé', () => {
    expect(isImageIcon(webp(PNG_HEAD))).toBe(false);
  });

  it('une charge qui n’est pas du base64 est refusée', () => {
    expect(isImageIcon('data:image/png;base64,iVBORw0KGgo!!!')).toBe(false);
    expect(isImageIcon('data:image/png;base64,')).toBe(false);
  });

  it('un autre type d’image, même raster, n’est pas admis', () => {
    // La liste est FERMÉE : deux formats suffisent, et chacun en plus est une
    // surface de décodage de plus dans le navigateur de qui installe.
    expect(isImageIcon('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe(false);
    expect(isImageIcon('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(false);
  });

  it('une URL distante n’est pas une icône', () => {
    // Une icône servie par un tiers dirait à cet hôte QUI regarde le catalogue,
    // et quand. La CSP la bloquerait, mais on ne compte pas dessus.
    expect(isImageIcon('https://exemple.test/icone.png')).toBe(false);
    expect(isIconValue('https://exemple.test/icone.png')).toBe(false);
  });
});

// ==================== 4. Le plafond ====================

describe('le plafond, tenu sans rien décoder', () => {
  it('une vignette au-delà de la borne est refusée', () => {
    expect(isImageIcon(png(padded(PNG_HEAD, LAYOUT_ICON_MAX_BYTES + 64)))).toBe(false);
  });

  it('la borne porte sur les OCTETS, pas sur la longueur du texte', () => {
    // Quatre caractères base64 portent trois octets : compter les caractères
    // refuserait une image d'un quart plus petite que la limite réelle.
    const justeSous = padded(PNG_HEAD, LAYOUT_ICON_MAX_BYTES - 3);
    expect(justeSous.length).toBeGreaterThan(LAYOUT_ICON_MAX_BYTES);
    expect(isImageIcon(png(justeSous))).toBe(true);
  });
});

// ==================== 5. Les deux mondes ne se confondent pas ====================

describe('emoji et vignette restent distincts', () => {
  it('une vignette n’est pas un emoji, et réciproquement', () => {
    expect(isEmojiOnly(png())).toBe(false);
    expect(isImageIcon('🗂️')).toBe(false);
  });

  it('du texte ordinaire n’est ni l’un ni l’autre', () => {
    for (const bad of ['A', 'icone', '<img src=x>', '', '   ']) {
      expect(isIconValue(bad), bad).toBe(false);
    }
  });
});
