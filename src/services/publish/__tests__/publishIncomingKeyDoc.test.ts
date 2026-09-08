/**
 * B2 — LE CONTRAT DOCUMENTÉ DE LA CLÉ ENTRANTE NE DOIT PAS RÉGRESSER.
 *
 * Le défaut fermé : des commentaires de `storageService.ts` décrivaient encore
 * le rescellement local supprimé par C1 (« un blob re-scellé deviendrait
 * illisible… »), contredits par le même fichier vingt lignes plus bas. Un
 * commentaire qui affirme une propriété que le code ne tient pas est un
 * défaut au même titre qu'un bogue : c'est lui qu'un futur lecteur croira.
 *
 * On ne peut pas tester de la prose par son comportement ; on la teste donc
 * par son TEXTE. Ces assertions échouent si quelqu'un réintroduit les
 * formulations d'avant C1, ou retire l'énoncé corrigé (la clé entrante ne
 * sert en lecture que le contenu DESCENDU du compte pendant la fenêtre de
 * migration — jamais un blob local re-scellé, il n'y en a plus).
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync(
  path.join(__dirname, '../../../../electron/storageService.ts'),
  'utf-8'
);

describe('storageService — commentaires de la clé entrante (B2)', () => {
  it('ne décrit plus le rescellement local supprimé par C1', () => {
    // Les deux formulations d'avant C1, mot pour mot. Les revoir apparaître
    // signifierait qu'on documente à nouveau un mécanisme qui n'existe plus.
    expect(source).not.toContain('ouvre ce qui n’a pas encore été re-scellé');
    expect(source).not.toContain("ouvre ce qui n'a pas encore été re-scellé");
    expect(source).not.toContain('un blob déjà re-scellé n’ouvre que sous elle');
    expect(source).not.toContain("un blob déjà re-scellé n'ouvre que sous elle");
  });

  it('porte l’énoncé corrigé : lecture du contenu descendu du compte uniquement', () => {
    expect(source).toContain('contenu DESCENDU du');
    // Le rappel de C1 doit rester accroché à la clé entrante elle-même.
    expect(source).toContain('La migration ne rescelle RIEN localement');
  });
});
