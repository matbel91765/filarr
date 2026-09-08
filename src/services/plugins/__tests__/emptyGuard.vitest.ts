/**
 * LA RÈGLE QUI SE TIENT ENTRE UN ÉDITEUR VIDE ET LE FICHIER.
 *
 * Elle décide d'une écriture destructrice, et elle peut se tromper dans les
 * deux sens — chacun a son coût :
 *
 *  · trop stricte, elle pose une question à chaque enregistrement et on
 *    apprend à cliquer « oui » sans lire, ce qui la rend inutile ;
 *  · trop permissive, elle laisse passer exactement l'écrasement qu'elle
 *    existe pour empêcher.
 *
 * Un fait mesuré en enquête donne l'échelle : sur le profil de l'utilisateur,
 * un `.fdoc` est passé de 303 octets de contenu à un document vide de 114
 * octets de structure. Rien dans ces deux nombres ne dit lequel est plein.
 */

import { describe, it, expect } from 'vitest';
import { viderait, type EtatAvantEcriture } from '../emptyGuard';

const etat = (over: Partial<EtatAvantEcriture> = {}): EtatAvantEcriture => ({
  contenuAuDepart: true,
  octetsPrecedents: 303,
  estVideMaintenant: true,
  conversion: false,
  ...over,
});

describe('quand il faut demander', () => {
  it('un document plein devenu vide', () => {
    expect(viderait(etat())).toBe(true);
  });

  it('même pour un tout petit contenu — un octet perdu reste perdu', () => {
    expect(viderait(etat({ octetsPrecedents: 1 }))).toBe(true);
  });
});

describe('quand il ne faut PAS demander', () => {
  it('le document a encore du contenu', () => {
    expect(viderait(etat({ estVideMaintenant: false }))).toBe(false);
  });

  it('il était DÉJÀ vide à l’ouverture — il n’y a rien à perdre', () => {
    // Le cas d'un fichier créé vide, ouvert puis réenregistré. Poser la
    // question ici serait du bruit à chaque Ctrl+S.
    expect(viderait(etat({ contenuAuDepart: false }))).toBe(false);
  });

  it('il n’y avait aucun octet à remplacer', () => {
    expect(viderait(etat({ octetsPrecedents: 0 }))).toBe(false);
  });

  it('une CONVERSION en cours ne touche pas l’original', () => {
    // Le premier enregistrement d'un .docx ouvert pour import crée un fichier
    // NEUF ; le .docx reste intact sur le disque. Il n'y a rien à écraser, et
    // demander égarerait sur ce qui va se passer.
    expect(viderait(etat({ conversion: true }))).toBe(false);
  });
});

describe('le greffon qui ne répond pas', () => {
  it('undefined n’est pas un « non » — mais ne déclenche rien non plus', () => {
    /**
     * `isEmpty` est FACULTATIF. Un greffon tiers qui ne l'implémente pas rend
     * `undefined`, et l'hôte n'invente pas de réponse à sa place : il ne garde
     * pas. Traiter `undefined` comme « vide » ferait poser la question sur
     * tous les enregistrements de ce greffon.
     */
    expect(viderait(etat({ estVideMaintenant: undefined }))).toBe(false);
  });

  it('ne se laisse pas berner par une valeur approchante', () => {
    // La comparaison est STRICTE : seul `true` déclenche. Une implémentation
    // qui rendrait une chaîne ou un nombre ne doit pas armer la garde par
    // accident de véracité.
    const bancal = etat({ estVideMaintenant: 'oui' as unknown as boolean });
    expect(viderait(bancal)).toBe(false);
  });
});
