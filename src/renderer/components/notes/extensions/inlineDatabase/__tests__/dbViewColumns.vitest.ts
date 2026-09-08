/**
 * Colonnes masquables/réordonnables par vue, et recherche rapide.
 *
 * Les deux pièges couverts ici sont des pertes SILENCIEUSES :
 *  - une colonne ajoutée après le réglage d'une vue disparaîtrait de cette vue
 *    si l'ordre enregistré faisait autorité à lui seul ;
 *  - masquer la dernière colonne visible laisserait une table sans rien à
 *    l'écran, donc sans aucun moyen de revenir en arrière.
 */

import { describe, it, expect } from 'vitest';
import {
  applySearch,
  applyView,
  movePropertyInView,
  normalizeSearch,
  orderedVisibleProperties,
  reorderPropertyInView,
  setAllPropertiesVisible,
  togglePropertyVisibility,
} from '../viewEngine';
import { makeDefaultView, parseDbData, serializeDbData } from '../types';
import type { DbProperty, DbRow, DbView, InlineDbData } from '../types';

const prop = (id: string, type: DbProperty['type'] = 'text', options?: DbProperty['options']) =>
  ({ id, name: id, type, ...(options ? { options } : {}) }) as DbProperty;

const PROPS: DbProperty[] = [
  prop('name'),
  prop('status', 'select', [
    { id: 'o-todo', label: 'À faire', color: 'gray' },
    { id: 'o-urgent', label: 'Urgent', color: 'red' },
  ]),
  prop('due', 'date'),
];

const view = (patch: Partial<DbView> = {}): DbView => ({ ...makeDefaultView('table'), ...patch });

describe('orderedVisibleProperties', () => {
  it('sans réglage, rend le schéma tel quel', () => {
    expect(orderedVisibleProperties(PROPS, view()).map((p) => p.id)).toEqual([
      'name',
      'status',
      'due',
    ]);
  });

  it('applique l ordre de la vue', () => {
    const ordered = orderedVisibleProperties(PROPS, view({ propertyOrder: ['due', 'name'] }));
    // « status », absent de l'ordre, passe à la FIN — il ne disparaît pas.
    expect(ordered.map((p) => p.id)).toEqual(['due', 'name', 'status']);
  });

  it('masque ce que la vue masque, sans toucher au schéma', () => {
    const ordered = orderedVisibleProperties(PROPS, view({ hiddenPropertyIds: ['status'] }));
    expect(ordered.map((p) => p.id)).toEqual(['name', 'due']);
    expect(PROPS).toHaveLength(3);
  });

  it('ignore un identifiant qui ne désigne plus rien', () => {
    const ordered = orderedVisibleProperties(
      PROPS,
      view({ propertyOrder: ['supprimee', 'due'], hiddenPropertyIds: ['aussi-supprimee'] })
    );
    expect(ordered.map((p) => p.id)).toEqual(['due', 'name', 'status']);
  });
});

describe('togglePropertyVisibility', () => {
  it('masque puis ré-affiche', () => {
    const hidden = togglePropertyVisibility(view(), PROPS, 'due');
    expect(hidden.hiddenPropertyIds).toEqual(['due']);
    const shown = togglePropertyVisibility(hidden, PROPS, 'due');
    expect(shown.hiddenPropertyIds ?? []).toEqual([]);
  });

  it('REFUSE de masquer la dernière colonne visible', () => {
    const twoHidden = view({ hiddenPropertyIds: ['status', 'due'] });
    const attempt = togglePropertyVisibility(twoHidden, PROPS, 'name');
    expect(attempt).toBe(twoHidden);
    expect(orderedVisibleProperties(PROPS, attempt)).toHaveLength(1);
  });
});

describe('movePropertyInView', () => {
  it('déplace d un cran et fige l ordre complet', () => {
    const moved = movePropertyInView(view(), PROPS, 'due', -1);
    expect(moved.propertyOrder).toEqual(['name', 'due', 'status']);
  });

  it('ne sort pas des bornes', () => {
    const start = view();
    expect(movePropertyInView(start, PROPS, 'name', -1)).toBe(start);
    expect(movePropertyInView(start, PROPS, 'due', 1)).toBe(start);
  });

  it('compte les colonnes MASQUÉES dans le déplacement', () => {
    // Sinon, ré-afficher une colonne la ferait réapparaître à une place
    // arbitraire, sans rapport avec l'ordre que l'utilisateur a réglé.
    const hidden = view({ hiddenPropertyIds: ['status'] });
    const moved = movePropertyInView(hidden, PROPS, 'due', -1);
    expect(moved.propertyOrder).toEqual(['name', 'due', 'status']);
  });
});

describe('recherche rapide', () => {
  const rows: DbRow[] = [
    { id: 'r1', cells: { name: 'Cadrage du projet', status: 'o-urgent', due: '2026-03-05' } },
    { id: 'r2', cells: { name: 'Rédiger le plan', status: 'o-todo' } },
    { id: 'r3', cells: { name: 'Bilan', due: '2026-05-02' } },
  ];

  it('cherche dans le texte des cellules', () => {
    expect(applySearch(rows, PROPS, 'plan').map((r) => r.id)).toEqual(['r2']);
  });

  it('ignore casse et accents', () => {
    expect(applySearch(rows, PROPS, 'REDIGER').map((r) => r.id)).toEqual(['r2']);
    expect(normalizeSearch('Éphémère ')).toBe('ephemere');
  });

  it('trouve par le LIBELLÉ d une option, pas par son identifiant', () => {
    // Une cellule de choix stocke `o-urgent` : chercher « urgent » doit
    // marcher, chercher « o-urgent » n'a aucun sens pour l'utilisateur.
    expect(applySearch(rows, PROPS, 'urgent').map((r) => r.id)).toEqual(['r1']);
  });

  it('cherche aussi dans les dates telles qu elles sont stockées', () => {
    expect(applySearch(rows, PROPS, '2026-05').map((r) => r.id)).toEqual(['r3']);
  });

  it('une recherche vide ne filtre rien', () => {
    expect(applySearch(rows, PROPS, '   ')).toBe(rows);
  });

  it('applyView combine filtres et recherche', () => {
    const data: InlineDbData = { properties: PROPS, rows };
    expect(applyView(data, view(), null, 'bilan').map((r) => r.id)).toEqual(['r3']);
    expect(applyView(data, view(), null, '').map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });
});

describe('persistance', () => {
  it('les réglages de colonnes survivent à un aller-retour de sérialisation', () => {
    // Le parse JETTE tout champ qu'il ne connaît pas : sans cette prise en
    // charge, le réglage disparaîtrait au rechargement de la note.
    const data: InlineDbData = {
      properties: PROPS,
      rows: [],
      views: [view({ hiddenPropertyIds: ['due'], propertyOrder: ['status', 'name', 'due'] })],
    };
    const round = parseDbData(serializeDbData(data));
    expect(round.views?.[0].hiddenPropertyIds).toEqual(['due']);
    expect(round.views?.[0].propertyOrder).toEqual(['status', 'name', 'due']);
  });

  it('dédoublonne et écarte les entrées vides', () => {
    const raw = JSON.stringify({
      properties: [],
      rows: [],
      views: [
        {
          id: 'v1',
          name: 'v',
          type: 'table',
          filters: [],
          sorts: [],
          hiddenPropertyIds: ['a', 'a', '', 5],
          propertyOrder: [],
        },
      ],
    });
    const round = parseDbData(raw);
    expect(round.views?.[0].hiddenPropertyIds).toEqual(['a']);
    expect(round.views?.[0].propertyOrder).toBeUndefined();
  });
});

describe('glisser-déposer et actions de lot', () => {
  it('dépose une colonne à la place d une autre', () => {
    const moved = reorderPropertyInView(view(), PROPS, 'due', 'name');
    expect(moved.propertyOrder).toEqual(['due', 'name', 'status']);
  });

  it('ne bouge rien quand la cible est la source', () => {
    const start = view();
    expect(reorderPropertyInView(start, PROPS, 'due', 'due')).toBe(start);
    expect(reorderPropertyInView(start, PROPS, 'inconnue', 'name')).toBe(start);
  });

  it('déplace en tenant compte des colonnes masquées', () => {
    const hidden = view({ hiddenPropertyIds: ['status'] });
    const moved = reorderPropertyInView(hidden, PROPS, 'due', 'name');
    // « status » garde sa place dans l'ordre complet, même invisible.
    expect(moved.propertyOrder).toEqual(['due', 'name', 'status']);
  });

  it('« tout afficher » efface la liste des masquées', () => {
    const shown = setAllPropertiesVisible(view({ hiddenPropertyIds: ['due'] }), PROPS, true);
    expect(shown.hiddenPropertyIds).toBeUndefined();
    expect(orderedVisibleProperties(PROPS, shown)).toHaveLength(3);
  });

  it('« tout masquer » en GARDE une — sinon la table devient un cul-de-sac', () => {
    const hidden = setAllPropertiesVisible(view(), PROPS, false);
    const visible = orderedVisibleProperties(PROPS, hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('name');
  });

  it('« tout masquer » respecte l ordre de la vue', () => {
    const reordered = view({ propertyOrder: ['due', 'name', 'status'] });
    const hidden = setAllPropertiesVisible(reordered, PROPS, false);
    expect(orderedVisibleProperties(PROPS, hidden)[0].id).toBe('due');
  });
});

describe('galerie et modèles de ligne — persistance', () => {
  it('le type de vue « galerie » survit à un aller-retour', () => {
    const data: InlineDbData = {
      properties: PROPS,
      rows: [],
      views: [{ ...makeDefaultView('table'), type: 'gallery' }],
    };
    expect(parseDbData(serializeDbData(data)).views?.[0].type).toBe('gallery');
  });

  it('un type de vue inconnu retombe sur la table', () => {
    // Un document écrit par un client plus récent ne doit pas afficher du vide.
    const raw = JSON.stringify({
      properties: [],
      rows: [],
      views: [{ id: 'v', name: 'v', type: 'hologramme', filters: [], sorts: [] }],
    });
    expect(parseDbData(raw).views?.[0].type).toBe('table');
  });

  it('les modèles de ligne survivent, sans les entrées bancales', () => {
    const raw = JSON.stringify({
      properties: [],
      rows: [],
      rowTemplates: [
        { id: 't1', name: 'Bogue critique', cells: { status: 'o-1' } },
        { id: 't2', name: '   ' },
        { name: 'sans identifiant', cells: {} },
      ],
    });
    const round = parseDbData(raw);
    expect(round.rowTemplates).toHaveLength(1);
    expect(round.rowTemplates?.[0]).toEqual({
      id: 't1',
      name: 'Bogue critique',
      cells: { status: 'o-1' },
    });
  });
});
