/**
 * « ENREGISTRER COMME… » — les deux endroits où ce geste peut détruire.
 *
 * Le bouton a l'air anodin : on donne un nom, on garde une copie. Deux choses
 * peuvent pourtant faire perdre du travail, et aucune ne se voit à la relecture.
 *
 *   · `makeHomeViewId` est DÉTERMINISTE. Deux mises en page du même nom portent
 *     le même identifiant, et l'écriture de la seconde efface la première. Le
 *     plan doit donc DIRE qu'il remplace, pour que l'écran demande.
 *
 *   · les blocs recopiés doivent porter de NOUVEAUX identifiants. Deux vues qui
 *     partagent les identifiants de leurs blocs sont deux jeux que la fusion
 *     entre appareils peut confondre.
 *
 * Et une chose doit au contraire SURVIVRE : les attaches locales. C'est la
 * différence entre dupliquer chez soi et exporter pour autrui — vider les
 * `binding` produirait une copie qu'il faudrait rebrancher bloc par bloc.
 */

import { describe, it, expect } from 'vitest';

import { duplicateSlotsForView, makeHomeViewId, planSaveAs } from '../homeViews';
import { HOME_VIEW_ID } from '../homeLayout';
import type { LayoutSlot, LayoutView, LayoutViewId } from '../../../../services/layout/layoutTypes';

function view(id: LayoutViewId, slots: LayoutSlot[] = []): LayoutView {
  return { id, slots, updatedAt: '2026-08-31T00:00:00.000Z' };
}

function slot(id: string, over: Partial<LayoutSlot> = {}): LayoutSlot {
  return { id, role: 'stats', type: 'stat-tile', x: 0, y: 0, w: 3, h: 1, ...over };
}

/** Un générateur d'identifiants prévisible — le test compare, il ne devine pas. */
function counter(): () => string {
  let n = 0;
  return () => `neuf-${++n}`;
}

// ==================== 1. Le plan ====================

describe('planSaveAs — dire ce qui va se passer avant de le faire', () => {
  it('un nom libre produit un plan qui ne remplace rien', () => {
    const plan = planSaveAs('Atelier', {});
    expect(plan).toEqual({
      viewId: makeHomeViewId('Atelier'),
      name: 'Atelier',
      replaces: false,
    });
  });

  it('LE PIÈGE : un nom déjà pris est signalé, pas exécuté', () => {
    // Sans ce drapeau, enregistrer « Atelier » une seconde fois écraserait la
    // première sans un mot — `makeHomeViewId` rend le même identifiant.
    const existant = makeHomeViewId('Atelier');
    const plan = planSaveAs('Atelier', { [existant]: view(existant) });
    expect(plan?.replaces).toBe(true);
    expect(plan?.viewId).toBe(existant);
  });

  it('les espaces de bordure ne font pas deux mises en page distinctes', () => {
    const existant = makeHomeViewId('Atelier');
    expect(planSaveAs('  Atelier  ', { [existant]: view(existant) })?.replaces).toBe(true);
  });

  it('un nom vide ou fait d’espaces ne produit AUCUN plan', () => {
    // Le laisser passer créerait une mise en page « Sans nom » que personne n'a
    // demandée — `makeHomeViewId` a ce repli, et il n'a rien à faire ici.
    expect(planSaveAs('', {})).toBeNull();
    expect(planSaveAs('   ', {})).toBeNull();
  });

  it('un nom très long est coupé, et le nom rendu est celui qui sera lu', () => {
    const plan = planSaveAs('x'.repeat(120), {});
    expect(plan?.name).toHaveLength(60);
    // Le nom du plan et l'identifiant doivent parler du MÊME nom : afficher
    // « x…120 » dans la confirmation et enregistrer « x…60 » ferait mentir
    // l'écran sur ce qu'il vient de faire.
    expect(plan?.viewId).toBe(makeHomeViewId(plan?.name ?? ''));
  });

  it('l’accueil par défaut ne peut pas être écrasé par un nom', () => {
    // `home` n'a pas de nom : aucune saisie ne peut produire son identifiant,
    // donc le retour en arrière reste toujours là.
    for (const name of ['Accueil', 'home', 'Home', 'défaut']) {
      expect(planSaveAs(name, {})?.viewId, name).not.toBe(HOME_VIEW_ID);
    }
  });
});

// ==================== 2. La copie des blocs ====================

describe('duplicateSlotsForView — ce qui change, et ce qui survit', () => {
  const source: LayoutSlot[] = [
    slot('a', { options: { metric: 'files' } }),
    slot('b', {
      type: 'folder-grid',
      role: 'folder-grid',
      w: 12,
      h: 4,
      binding: { folder: '3f2a9c17-6b4e-4f1a-9d3c-1e5a7b9c0d2f' },
    }),
  ];

  it('les identifiants sont NEUFS, tout le reste est intact', () => {
    const copie = duplicateSlotsForView(source, counter());
    expect(copie.map((s) => s.id)).toEqual(['neuf-1', 'neuf-2']);
    expect(copie[0].options).toEqual({ metric: 'files' });
    expect(copie[1].w).toBe(12);
    expect(copie[1].type).toBe('folder-grid');
  });

  it('LES ATTACHES LOCALES SURVIVENT — c’est une copie, pas un export', () => {
    // Un export vide les liaisons parce qu'il part chez quelqu'un d'autre. Ici
    // la copie reste sur le même appareil : la vider ferait une disposition
    // qu'il faudrait rebrancher bloc par bloc.
    const copie = duplicateSlotsForView(source, counter());
    expect(copie[1].binding).toEqual({ folder: '3f2a9c17-6b4e-4f1a-9d3c-1e5a7b9c0d2f' });
  });

  it('aucun identifiant de bloc n’est partagé avec la source', () => {
    const copie = duplicateSlotsForView(source, counter());
    const anciens = new Set(source.map((s) => s.id));
    expect(copie.some((s) => anciens.has(s.id))).toBe(false);
  });

  it('la source n’est pas modifiée', () => {
    // Le geste laisse l'accueil courant tel quel : muter les blocs d'origine
    // renommerait les siens au passage.
    duplicateSlotsForView(source, counter());
    expect(source.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('une disposition vide reste vide, sans lever', () => {
    expect(duplicateSlotsForView([], counter())).toEqual([]);
  });
});
