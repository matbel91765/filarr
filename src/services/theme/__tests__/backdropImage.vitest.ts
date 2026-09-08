/**
 * LA SIGNATURE D'UNE IMAGE — ce que « c'est un GIF » veut dire.
 *
 * Un décor animé ne peut pas être redessiné dans un canevas : ça le figerait.
 * On perd donc la borne PAR CONSTRUCTION qui protège les icônes, et la seule
 * garantie qui reste est celle-ci — la lecture des premiers octets.
 *
 * Ces tests éprouvent donc surtout des REFUS, et notamment ceux qui ressemblent
 * beaucoup à des acceptations : un SVG renommé, un RIFF qui n'est pas du WebP,
 * un PNG dont la moitié de l'en-tête manque.
 */

import { describe, it, expect } from 'vitest';

import { canAnimate, dataUrlBytes, sniffImageType } from '../backdropImage';

/** Des octets à partir d'une chaîne ASCII et de codes bruts. */
function bytes(...parts: (string | number)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === 'number') out.push(part);
    else for (const ch of part) out.push(ch.charCodeAt(0));
  }
  return new Uint8Array(out);
}

const PNG_HEADER = bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a);

describe('sniffImageType — les formats reconnus', () => {
  it('reconnaît les cinq formats', () => {
    expect(sniffImageType(bytes('GIF89a'))).toBe('gif');
    expect(sniffImageType(bytes('GIF87a'))).toBe('gif');
    expect(sniffImageType(PNG_HEADER)).toBe('png');
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('jpeg');
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('webp');
    expect(sniffImageType(bytes(0, 0, 0, 0x20, 'ftypavif'))).toBe('avif');
  });

  it('reconnaît l’AVIF de SÉQUENCE, qui est le cas animé', () => {
    // La marque `avis` — et non `avif` — désigne une séquence d'images. La
    // refuser reviendrait à refuser exactement ce qu'on cherche à permettre.
    expect(sniffImageType(bytes(0, 0, 0, 0x20, 'ftypavis'))).toBe('avif');
  });

  it('GIF et WebP et AVIF peuvent animer ; PNG et JPEG, non', () => {
    expect(canAnimate('gif')).toBe(true);
    expect(canAnimate('webp')).toBe(true);
    expect(canAnimate('avif')).toBe(true);
    expect(canAnimate('png')).toBe(false);
    expect(canAnimate('jpeg')).toBe(false);
  });
});

describe('sniffImageType — LES REFUS QUI COMPTENT', () => {
  it('UN SVG N’EST PAS UNE IMAGE ICI, même renommé en .gif', () => {
    // C'est LE cas qui motive la lecture d'octets. `File.type` se déduit de
    // l'extension : un SVG renommé `fond.gif` se présente comme `image/gif`.
    // Un SVG est un DOCUMENT — il porte des scripts et des références externes,
    // et il serait rendu derrière une application qui manipule des clés.
    expect(sniffImageType(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
    expect(sniffImageType(bytes('<?xml version="1.0"?><svg>'))).toBeNull();
  });

  it('un RIFF qui n’est pas du WebP est refusé', () => {
    // « RIFF » est aussi l'en-tête d'un WAV et d'un AVI. S'arrêter aux quatre
    // premiers octets accepterait un fichier audio comme décor.
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBeNull();
    expect(sniffImageType(bytes('RIFF', 0, 0, 0, 0, 'AVI '))).toBeNull();
  });

  it('un en-tête PNG TRONQUÉ est refusé', () => {
    // Les quatre octets après « PNG » existent pour détecter un transfert
    // abîmé. S'arrêter à « \x89PNG » accepterait un fichier corrompu, que le
    // navigateur refuserait ensuite d'afficher — décor invisible, sans message.
    expect(sniffImageType(bytes(0x89, 'PNG'))).toBeNull();
    expect(sniffImageType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x00, 0x0a))).toBeNull();
  });

  it('un fichier vide ou minuscule ne fait pas lever', () => {
    // La lecture déborde de la fin du tableau ; sans garde, `bytes[i]` rend
    // `undefined` et la comparaison devient silencieusement fausse — ce qui va
    // bien ici, mais seulement par accident. On l'éprouve donc.
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
    expect(sniffImageType(bytes('G'))).toBeNull();
    expect(sniffImageType(bytes(0xff))).toBeNull();
  });

  it('du texte, du HTML et un exécutable sont refusés', () => {
    expect(sniffImageType(bytes('<!DOCTYPE html>'))).toBeNull();
    expect(sniffImageType(bytes('MZ', 0x90, 0x00))).toBeNull();
    expect(sniffImageType(bytes('data:image/gif;base64,R0lGOD'))).toBeNull();
  });

  it('« GIF » suivi d’une version inconnue est refusé', () => {
    // GIF88a n'existe pas. Accepter n'importe quel « GIF8 » laisserait passer
    // un fichier fabriqué dont seuls les quatre premiers octets sont crédibles.
    expect(sniffImageType(bytes('GIF88a'))).toBeNull();
    expect(sniffImageType(bytes('GIF89b'))).toBeNull();
  });
});

describe('dataUrlBytes — le poids réel sans décoder', () => {
  it('estime la taille depuis la longueur du base64', () => {
    // Quatre caractères de base64 valent trois octets.
    expect(dataUrlBytes('data:image/gif;base64,' + 'A'.repeat(400))).toBe(300);
  });

  it('une chaîne sans virgule est traitée comme INFINIE, donc refusée', () => {
    // Rendre 0 ferait passer pour « minuscule » une valeur qu'on n'a pas su
    // lire — c'est-à-dire accepter ce qu'on ne comprend pas.
    expect(dataUrlBytes('pas une url de donnees')).toBe(Number.POSITIVE_INFINITY);
  });
});
