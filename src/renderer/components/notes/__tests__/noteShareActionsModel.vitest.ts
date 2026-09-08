/**
 * Les décisions PURES des gestes de partage d'une note — l'état de l'entrée
 * « Ajouter au coffre partagé… » (droit × cible) et la porte que choisit le
 * bouton de partage selon l'histoire de la note.
 */

import { describe, expect, it } from 'vitest';

import { addToVaultMenuState, noteShareGesture } from '../noteShareActionsModel';

describe('addToVaultMenuState — droit × cible → état de l’entrée de menu', () => {
  it('sans le droit : ABSENTE, même avec des cibles (anti-mur-de-vente)', () => {
    expect(addToVaultMenuState({ canUse: false, hasTargets: false })).toBe('hidden');
    expect(addToVaultMenuState({ canUse: false, hasTargets: true })).toBe('hidden');
  });

  it('avec le droit mais sans coffre déverrouillé accessible : visible, désactivée', () => {
    expect(addToVaultMenuState({ canUse: true, hasTargets: false })).toBe('disabled');
  });

  it('avec le droit et une cible : active', () => {
    expect(addToVaultMenuState({ canUse: true, hasTargets: true })).toBe('enabled');
  });
});

describe('noteShareGesture — la porte du bouton de partage', () => {
  it('une note jamais déposée passe par le dépôt', () => {
    expect(noteShareGesture(0)).toBe('addToVault');
  });

  it('une note déjà déposée ouvre la gestion du partage', () => {
    expect(noteShareGesture(1)).toBe('manageSharing');
    expect(noteShareGesture(3)).toBe('manageSharing');
  });
});
