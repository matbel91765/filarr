/**
 * Les DESTINATIONS d'« Ajouter au coffre » quand l'une d'elles est GELÉE (F23).
 *
 * LE DÉFAUT QUE CES CAS FERMENT : la liste ne regardait que le rôle. Un coffre
 * gelé restait donc une destination ordinaire, et le refus `vault_frozen`
 * n'arrivait qu'APRÈS le chiffrement et l'envoi des morceaux — sur un fichier de
 * plusieurs gigaoctets, la règle « un client plus permissif ne coûte qu'un refus
 * nommé » ne tient plus : elle coûte tout le téléversement.
 *
 * ET LA CORRECTION NE FILTRE RIEN. Un coffre qui disparaît du menu rend le geste
 * introuvable ; un coffre présent mais inéligible, avec sa raison, l'explique.
 */

import { describe, expect, it } from 'vitest';

import {
  addTargetOptions,
  defaultAddTargetId,
  isFrozenTarget,
  writableAddTargets,
} from '../addToVaultTargets';

const vivant = { id: 'v1', name: 'Projet', role: 'admin', frozenAt: null };
const gele = { id: 'v2', name: 'Archives', role: 'owner', frozenAt: '2026-08-29T10:00:00Z' };

describe('isFrozenTarget', () => {
  it('un instant de gel gèle, une absence ne gèle pas', () => {
    expect(isFrozenTarget(gele)).toBe(true);
    expect(isFrozenTarget(vivant)).toBe(false);
  });

  it('un coffre servi par un worker d’avant le gel n’est PAS déclaré gelé', () => {
    // `frozenAt` absent = on ne sait pas. Le refuser ici rendrait le geste
    // introuvable sur toute une flotte, sur une ignorance.
    expect(isFrozenTarget({ id: 'v3', role: 'member' })).toBe(false);
    expect(isFrozenTarget({ id: 'v4', role: 'member', frozenAt: '' })).toBe(false);
  });
});

describe('writableAddTargets', () => {
  it('ne garde que les coffres où l’on peut RÉELLEMENT déposer', () => {
    expect(writableAddTargets([vivant, gele]).map((v) => v.id)).toEqual(['v1']);
  });

  it('rend une liste vide quand tout est gelé — c’est ce qui décide de l’entrée', () => {
    expect(writableAddTargets([gele])).toEqual([]);
  });
});

describe('defaultAddTargetId', () => {
  it('choisit le premier coffre NON gelé, même s’il n’est pas premier', () => {
    expect(defaultAddTargetId([gele, vivant])).toBe('v1');
  });

  it('ne pré-sélectionne RIEN quand toutes les destinations sont gelées', () => {
    // Une pré-sélection impossible à valider laisserait un bouton actif sur un
    // envoi que le serveur refusera après coup.
    expect(defaultAddTargetId([gele])).toBe('');
  });
});

describe('addTargetOptions', () => {
  const libelles = { untitled: 'Coffre verrouillé', frozen: 'Gelé' };

  it('garde le coffre gelé VISIBLE, inéligible, et dit pourquoi dans son libellé', () => {
    expect(addTargetOptions([vivant, gele], libelles)).toEqual([
      { value: 'v1', label: 'Projet', disabled: false },
      { value: 'v2', label: 'Archives (Gelé)', disabled: true },
    ]);
  });

  it('un coffre sans nom lisible garde le libellé de repli, gelé ou non', () => {
    expect(
      addTargetOptions([{ id: 'v5', role: 'admin', frozenAt: '2026-01-01' }], libelles)
    ).toEqual([{ value: 'v5', label: 'Coffre verrouillé (Gelé)', disabled: true }]);
  });
});
