/**
 * Garde : l identifiant de dossier du processus principal est ALEATOIRE, et de
 * la meme forme que celui du renderer.
 *
 * ── CE QUE CE TEST DEFEND, ET POURQUOI IL EXISTE ────────────────────────────
 *
 * `folder.id` n est pas une cle locale sans consequence. Il devient le nom du
 * repertoire sur le disque, PUIS l entree de la derivation qui produit la cle
 * d objet distante : `fileId = sha256("<folderId>/<nomFichier>")` tronque a 32
 * hex (`scanFileIdOf`, syncService). Cette derivation n est pas salee. Sa
 * resistance repose donc ENTIEREMENT sur l imprevisibilite de `folder.id`.
 *
 * Le repli de `saveFolder` posait `Date.now().toString()` : un horodatage en
 * millisecondes se retrouve par force brute sur une fenetre de l ordre de
 * 10^11, et une fois l identifiant connu, tous les noms de fichiers du dossier
 * se devinent au dictionnaire. Ce chemin ne se declenchait pas en usage normal
 * — le renderer fournit toujours un id — et c est exactement ce qui le rendait
 * dangereux : personne ne l aurait vu produire des dossiers enumerables.
 *
 * ── L AUTORITE ──────────────────────────────────────────────────────────────
 *
 * L autorite de FORME est `generateUniqueId()` du renderer
 * (`src/utils/idGenerator.ts`), qui remplit le meme role sur l autre chemin de
 * creation. On la reimplemente ici a l identique plutot que de l importer : les
 * deux bundles ne partagent pas de module, et un test qui importerait le
 * renderer masquerait justement une divergence entre les deux.
 *
 * Si ces assertions echouent apres un changement de `generateUniqueId()`, la
 * reponse n est PAS d assouplir le test : c est de faire suivre l autre cote.
 */

import { describe, it, expect } from 'vitest';
import { ensureFolderId } from '../storageService';

/** LE chemin reel de saveFolder : un dossier sans id passe par ici. */
const randomFolderId = () => ensureFolderId({});

/** Forme rendue par `generateUniqueId()` du renderer : 22 caracteres base36. */
const FORME_RENDERER = /^[0-9a-z]{22}$/;

describe('ensureFolderId — le repli de saveFolder ne pose plus d horodatage', () => {
  it('ne rend JAMAIS un horodatage en millisecondes', () => {
    for (let i = 0; i < 200; i++) {
      const id = randomFolderId();
      // La forme exacte que le repli produisait avant : 13 chiffres nus.
      expect(id).not.toMatch(/^\d{13}$/);
      // Et, plus large : un identifiant entierement numerique reintroduirait
      // une fenetre de force brute, quelle que soit sa longueur.
      expect(id).not.toMatch(/^\d+$/);
    }
  });

  it('a la forme de l identifiant du renderer', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomFolderId()).toMatch(FORME_RENDERER);
    }
  });

  it('ne se repete pas — c est un aleatoire, pas un compteur', () => {
    const n = 2000;
    const vus = new Set<string>();
    for (let i = 0; i < n; i++) vus.add(randomFolderId());
    // 16 octets d aleatoire : une seule collision sur 2000 tirages serait deja
    // le signe d une source degradee (compteur, horloge, graine fixe).
    expect(vus.size).toBe(n);
  });

  it('ne porte pas le temps : deux appels successifs ne partagent pas de prefixe', () => {
    // Un identifiant derive de l horloge partage ses premiers caracteres entre
    // deux appels rapproches. C est precisement ce signal qui rendait l ancien
    // repli enumerable, et il doit avoir disparu.
    let prefixesPartages = 0;
    for (let i = 0; i < 200; i++) {
      const a = randomFolderId();
      const b = randomFolderId();
      if (a.slice(0, 6) === b.slice(0, 6)) prefixesPartages++;
    }
    expect(prefixesPartages).toBe(0);
  });
});

describe('ensureFolderId — un identifiant deja pose est respecte', () => {
  it('conserve un id existant sans le retirer au hasard', () => {
    expect(ensureFolderId({ id: '1774130363714k3x' })).toBe('1774130363714k3x');
  });

  it('normalise un id numerique en chaine, sans le remplacer', () => {
    // Le code historique faisait `folder.id.toString()` : des dossiers portent
    // encore des ids numeriques, et les renumeroter casserait leur chemin sur
    // le disque ET leur cle d objet distante.
    expect(ensureFolderId({ id: 1774130363714 })).toBe('1774130363714');
  });

  it('traite la chaine vide comme une absence, pas comme un id', () => {
    expect(ensureFolderId({ id: '' })).toMatch(/^[0-9a-z]{22}$/);
  });
});
