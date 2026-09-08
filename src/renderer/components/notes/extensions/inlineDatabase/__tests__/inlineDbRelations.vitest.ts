/**
 * Relations et agrégats entre bases inline.
 *
 * Ce qui est vérifié ici ne se voit ni à la compilation ni à l'œil : l'identité
 * d'une base d'AVANT les relations (une dérivation instable casserait
 * silencieusement tous les liens), l'index des notes (contenus illisibles,
 * notes supprimées, doublons), chaque agrégat jusqu'aux cas dégénérés, et la
 * règle qui gouverne tout le reste — une cible introuvable ne fait JAMAIS
 * perdre la valeur stockée.
 */

import { describe, it, expect } from 'vitest';
import type { DbProperty, DbRow, DbView, InlineDbData } from '../types';
import { deriveDbId, parseDbData, relationIds, resolveDbId, serializeDbData } from '../types';
import type { DbEnv, DbLinkContext, DbTarget } from '../relations';
import {
  computeRollup,
  formatRollupValue,
  makeLinkContext,
  relationText,
  resolveRelation,
  rollupNumber,
  rowTitleOf,
  titlePropertyOf,
} from '../relations';
import { collectInlineDbs } from '../dbIndex';
import {
  applyFilters,
  applySorts,
  applyView,
  isEmptyCell,
  opsForType,
  prefillCellsForView,
  sanitizeSchema,
} from '../viewEngine';

/* ==================== Fixtures ==================== */

/** Base « Tâches » : celle qui PORTE les relations */
const relProp: DbProperty = {
  id: 'p-rel',
  name: 'Projet',
  type: 'relation',
  targetDbId: 'db@v:projets',
};

const tacheTitre: DbProperty = { id: 'p-t-titre', name: 'Tâche', type: 'text' };

/** Base « Projets » : celle qui est VISÉE */
const projTitre: DbProperty = { id: 'p-p-titre', name: 'Nom', type: 'text' };
const projBudget: DbProperty = { id: 'p-p-budget', name: 'Budget', type: 'number' };
const projFait: DbProperty = { id: 'p-p-fait', name: 'Livré', type: 'checkbox' };
const projNote: DbProperty = { id: 'p-p-note', name: 'Note', type: 'rating' };
const projTexte: DbProperty = { id: 'p-p-txt', name: 'Client', type: 'text' };

const projets: DbTarget = {
  properties: [projTitre, projBudget, projFait, projNote, projTexte],
  rows: [
    {
      id: 'r-alpha',
      cells: {
        [projTitre.id]: 'Alpha',
        [projBudget.id]: 100,
        [projFait.id]: true,
        [projNote.id]: 4,
        [projTexte.id]: 'Acme',
      },
    },
    {
      id: 'r-beta',
      cells: {
        [projTitre.id]: 'Beta',
        [projBudget.id]: 50,
        [projFait.id]: false,
        [projNote.id]: 2,
      },
    },
    {
      id: 'r-gamma',
      cells: {
        [projTitre.id]: 'Gamma',
        // Budget d'un type inattendu : ignoré par les agrégats numériques
        [projBudget.id]: 'beaucoup',
        [projFait.id]: true,
      },
    },
  ],
};

function ctxOf(map: Record<string, DbTarget>): DbLinkContext {
  return { getDb: (id: string) => map[id] };
}

const CTX = ctxOf({ 'db@v:projets': projets });

function envOf(properties: DbProperty[], ctx?: DbLinkContext): DbEnv {
  return { properties, ...(ctx ? { ctx } : {}) };
}

function tacheRow(id: string, links: unknown, extra: Record<string, unknown> = {}): DbRow {
  return { id, cells: { [relProp.id]: links, ...extra } };
}

function rollup(patch: Partial<DbProperty>): DbProperty {
  return {
    id: 'p-roll',
    name: 'Agrégat',
    type: 'rollup',
    viaPropertyId: relProp.id,
    ...patch,
  };
}

/* ==================== Identité d'une base ==================== */

describe('identité stable (dbId)', () => {
  const view: DbView = { id: 'v-1', name: 'Vue', type: 'table', filters: [], sorts: [] };

  it('dérive de la première vue en priorité', () => {
    const data: InlineDbData = {
      properties: [{ id: 'p-1', name: 'A', type: 'text' }],
      rows: [{ id: 'r-1', cells: {} }],
      views: [view],
    };
    expect(deriveDbId(data)).toBe('db@v:v-1');
  });

  it('retombe sur la première propriété puis sur la première ligne', () => {
    expect(deriveDbId({ properties: [{ id: 'p-1', name: 'A', type: 'text' }], rows: [] })).toBe(
      'db@p:p-1'
    );
    expect(deriveDbId({ properties: [], rows: [{ id: 'r-1', cells: {} }] })).toBe('db@r:r-1');
  });

  it('rend une identité vide quand la base n’a aucune graine', () => {
    expect(deriveDbId({ properties: [], rows: [] })).toBe('');
  });

  it('ne bouge pas quand les lignes ou les propriétés suivantes changent', () => {
    const before: InlineDbData = {
      properties: [{ id: 'p-1', name: 'A', type: 'text' }],
      rows: [{ id: 'r-1', cells: {} }],
      views: [view],
    };
    const after: InlineDbData = {
      ...before,
      properties: [...before.properties, { id: 'p-2', name: 'B', type: 'number' }],
      rows: [{ id: 'r-9', cells: { 'p-1': 'x' } }],
    };
    expect(deriveDbId(after)).toBe(deriveDbId(before));
  });

  it('l’attribut frappé prime, et le frapper ne change pas la valeur dérivée', () => {
    const data: InlineDbData = { properties: [], rows: [], views: [view] };
    const derived = deriveDbId(data);
    // Avant la frappe : dérivé. Après : le même identifiant, à l'octet près.
    expect(resolveDbId('', data)).toBe(derived);
    expect(resolveDbId(derived, data)).toBe(derived);
    // Un attribut explicite l'emporte même si les données bougent ensuite
    expect(resolveDbId('db-frappe', { properties: [], rows: [], views: [view] })).toBe('db-frappe');
    expect(resolveDbId('   ', data)).toBe(derived);
    expect(resolveDbId(undefined, data)).toBe(derived);
  });
});

/* ==================== Index des bases ==================== */

function noteWithDb(
  noteId: string,
  data: InlineDbData,
  attrs: Record<string, unknown> = {},
  noteTitle = ''
) {
  return {
    id: noteId,
    title: noteTitle,
    content: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'avant' }] },
        {
          type: 'inlineDatabase',
          attrs: { title: '', view: 'table', groupBy: '', data: serializeDbData(data), ...attrs },
        },
      ],
    }),
  };
}

const projetsData: InlineDbData = {
  properties: projets.properties,
  rows: projets.rows,
  views: [{ id: 'projets', name: 'Vue', type: 'table', filters: [], sorts: [] }],
};

describe('index des bases inline', () => {
  it('indexe les bases de plusieurs notes, avec leur schéma et leurs lignes', () => {
    const other: InlineDbData = {
      properties: [tacheTitre, relProp],
      rows: [tacheRow('r-t1', ['r-alpha'])],
      views: [{ id: 'taches', name: 'Vue', type: 'table', filters: [], sorts: [] }],
    };
    const index = collectInlineDbs([
      noteWithDb('n1', projetsData, { title: 'Projets' }, 'Note projets'),
      noteWithDb('n2', other, {}, 'Note tâches'),
    ]);

    expect([...index.keys()].sort()).toEqual(['db@v:projets', 'db@v:taches']);
    const p = index.get('db@v:projets');
    expect(p?.noteId).toBe('n1');
    expect(p?.title).toBe('Projets');
    expect(p?.rows).toHaveLength(3);
    expect(p?.properties.map((x) => x.id)).toContain(projBudget.id);
    // Titre du bloc absent : celui de la note prend le relais
    expect(index.get('db@v:taches')?.title).toBe('Note tâches');
  });

  it('ignore un contenu illisible sans lancer, et poursuit avec les autres notes', () => {
    const index = collectInlineDbs([
      { id: 'cassee', title: 'x', content: '{"type":"doc","content":[{"type":"inlineDatabase"' },
      noteWithDb('n1', projetsData),
    ]);
    expect(index.size).toBe(1);
    expect(index.has('db@v:projets')).toBe(true);
  });

  it('ignore une note supprimée, une note vide et une note sans bloc base', () => {
    const index = collectInlineDbs([
      { ...noteWithDb('n1', projetsData), deletedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'vide', title: '', content: null },
      { id: 'texte', title: '', content: JSON.stringify({ type: 'doc', content: [] }) },
    ]);
    expect(index.size).toBe(0);
  });

  it('à identité égale (bloc dupliqué), la première note l’emporte — index déterministe', () => {
    const index = collectInlineDbs([
      noteWithDb('n1', projetsData, {}, 'Original'),
      noteWithDb('n2', projetsData, {}, 'Copie'),
    ]);
    expect(index.size).toBe(1);
    expect(index.get('db@v:projets')?.noteId).toBe('n1');
  });

  it('deux blocs de MÊME identité dans une note : celui du haut gagne (ordre du document)', () => {
    const note = {
      id: 'n1',
      title: '',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'inlineDatabase',
            attrs: { dbId: 'db-jumeau', title: 'Haut', data: serializeDbData(projetsData) },
          },
          {
            type: 'inlineDatabase',
            attrs: { dbId: 'db-jumeau', title: 'Bas', data: serializeDbData(projetsData) },
          },
        ],
      }),
    };
    expect(collectInlineDbs([note]).get('db-jumeau')?.title).toBe('Haut');
  });

  it('MIGRATION : une base sans attribut dbId est indexée sous son identité dérivée', () => {
    // Base d'avant les relations : ni `dbId`, ni `views` (d'avant les vues)
    const legacy: InlineDbData = {
      properties: [projTitre, projBudget],
      rows: [{ id: 'r-legacy', cells: { [projTitre.id]: 'Ancien' } }],
    };
    const index = collectInlineDbs([noteWithDb('n1', legacy)]);
    const expected = deriveDbId(legacy);
    expect(expected).toBe(`db@p:${projTitre.id}`);
    expect(index.has(expected)).toBe(true);

    // Et une fois l'identité FRAPPÉE dans l'attribut, elle ne bouge pas
    const stamped = collectInlineDbs([noteWithDb('n1', legacy, { dbId: expected })]);
    expect([...stamped.keys()]).toEqual([expected]);
  });

  it('trouve une base imbriquée (callout, colonnes…) et non pas seulement au premier niveau', () => {
    const nested = {
      id: 'n1',
      title: 'Imbriquée',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'callout',
            content: [
              {
                type: 'inlineDatabase',
                attrs: { data: serializeDbData(projetsData) },
              },
            ],
          },
        ],
      }),
    };
    expect(collectInlineDbs([nested]).has('db@v:projets')).toBe(true);
  });

  it('ignore un bloc dont les données sont illisibles plutôt que de tout perdre', () => {
    const note = {
      id: 'n1',
      title: '',
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'inlineDatabase', attrs: { data: '{{{ pas du JSON' } },
          { type: 'inlineDatabase', attrs: { data: serializeDbData(projetsData) } },
        ],
      }),
    };
    const index = collectInlineDbs([note]);
    // Le bloc cassé n'a aucune graine, donc aucune identité ; l'autre est bien là
    expect([...index.keys()]).toEqual(['db@v:projets']);
  });
});

/* ==================== Résolution d'une relation ==================== */

describe('résolution d’une relation', () => {
  const env = envOf([tacheTitre, relProp], CTX);

  it('rend les lignes visées, dans l’ordre de la cellule, avec leur titre', () => {
    const res = resolveRelation(relProp, tacheRow('r1', ['r-beta', 'r-alpha']), env);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links.map((l) => l.title)).toEqual(['Beta', 'Alpha']);
    expect(res.rows.map((r) => r.id)).toEqual(['r-beta', 'r-alpha']);
    expect(res.missing).toEqual([]);
  });

  it('le titre est la PREMIÈRE propriété texte de la cible', () => {
    expect(titlePropertyOf(projets.properties)?.id).toBe(projTitre.id);
    expect(rowTitleOf(projets.properties, projets.rows[0])).toBe('Alpha');
    // Cible sans colonne texte : pas de titre, mais pas d'erreur non plus
    expect(rowTitleOf([projBudget], projets.rows[0])).toBe('');
  });

  it('sans cible configurée : « non configurée », jamais un plantage', () => {
    const nu: DbProperty = { id: 'p-rel', name: 'X', type: 'relation' };
    expect(resolveRelation(nu, tacheRow('r1', ['r-alpha']), env).status).toBe('unset');
  });

  it('base visée introuvable : valeur CONSERVÉE et état lisible', () => {
    const res = resolveRelation(
      relProp,
      tacheRow('r1', ['r-alpha', 'r-beta']),
      envOf([], ctxOf({}))
    );
    expect(res.status).toBe('unavailable');
    if (res.status !== 'unavailable') return;
    expect(res.ids).toEqual(['r-alpha', 'r-beta']);
  });

  it('sans contexte du tout (moteur nu) : indisponible, pas vide', () => {
    const res = resolveRelation(relProp, tacheRow('r1', ['r-alpha']), undefined);
    expect(res.status).toBe('unavailable');
  });

  it('ligne visée supprimée : le lien est GARDÉ et signalé introuvable', () => {
    const res = resolveRelation(relProp, tacheRow('r1', ['r-alpha', 'r-disparue']), env);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links.map((l) => l.rowId)).toEqual(['r-alpha']);
    expect(res.missing).toEqual(['r-disparue']);
    // La cellule stocke toujours les deux : rien n'a été effacé au passage
    expect(res.ids).toEqual(['r-alpha', 'r-disparue']);
  });

  it('valeur d’un type inattendu ou doublons : lecture douce', () => {
    expect(relationIds('r-alpha')).toEqual([]);
    expect(relationIds([1, '', 'r-alpha', 'r-alpha', null])).toEqual(['r-alpha']);
    const res = resolveRelation(relProp, tacheRow('r1', 'pas-un-tableau'), env);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links).toEqual([]);
  });

  it('makeLinkContext ne bâtit la table des lignes visées QU’UNE fois', () => {
    // Cette résolution est appelée par cellule rendue, par agrégat et par ligne
    // filtrée : sans mémoïsation, chacune reparcourt toutes les lignes visées.
    let builds = 0;
    const ctx = makeLinkContext((id) => {
      builds += 1;
      return id === 'db@v:projets' ? projets : undefined;
    });
    const env = envOf([tacheTitre, relProp], ctx);
    const row = tacheRow('r1', ['r-alpha', 'r-beta']);
    const first = resolveRelation(relProp, row, env);
    resolveRelation(relProp, row, env);
    resolveRelation(relProp, tacheRow('r2', ['r-gamma']), env);
    expect(first.status).toBe('ok');
    expect(ctx.getRowIndex?.('db@v:projets')).toBe(ctx.getRowIndex?.('db@v:projets'));
    // Une base introuvable est mémoïsée elle aussi (pas de nouvel essai par appel)
    ctx.getRowIndex?.('db-inconnue');
    ctx.getRowIndex?.('db-inconnue');
    // Une seule visite par base visée, quel que soit le nombre de résolutions
    expect(builds).toBe(2);
  });

  it('sans table mémoïsée, la résolution reste exacte (contrat facultatif)', () => {
    const nu: DbLinkContext = { getDb: (id) => (id === 'db@v:projets' ? projets : undefined) };
    const res = resolveRelation(relProp, tacheRow('r1', ['r-beta']), envOf([relProp], nu));
    expect(res.status === 'ok' && res.links[0].title).toBe('Beta');
  });

  it('relationText : titres mis bout à bout, null quand la cible est inconnue', () => {
    expect(relationText(relProp, tacheRow('r1', ['r-alpha', 'r-beta']), env)).toBe('Alpha Beta');
    expect(relationText(relProp, tacheRow('r1', ['r-alpha']), envOf([], ctxOf({})))).toBeNull();
  });
});

/* ==================== Agrégats ==================== */

describe('agrégats (rollup)', () => {
  const props = [tacheTitre, relProp];
  const env = envOf(props, CTX);
  const row = tacheRow('r1', ['r-alpha', 'r-beta', 'r-gamma']);

  it('count compte les lignes RETROUVÉES', () => {
    expect(computeRollup(rollup({ aggregate: 'count' }), row, env)).toEqual({
      status: 'ok',
      value: 3,
    });
    // Un lien vers une ligne supprimée ne compte pas
    expect(
      computeRollup(rollup({ aggregate: 'count' }), tacheRow('r2', ['r-alpha', 'r-nope']), env)
    ).toEqual({ status: 'ok', value: 1 });
    // Aucune ligne liée : zéro est ici la bonne réponse, pas « vide »
    expect(computeRollup(rollup({ aggregate: 'count' }), tacheRow('r3', []), env)).toEqual({
      status: 'ok',
      value: 0,
    });
  });

  it('sum / avg / min / max ignorent les valeurs d’un autre type', () => {
    const base = { targetPropertyId: projBudget.id };
    expect(computeRollup(rollup({ ...base, aggregate: 'sum' }), row, env)).toEqual({
      status: 'ok',
      value: 150,
    });
    expect(computeRollup(rollup({ ...base, aggregate: 'avg' }), row, env)).toEqual({
      status: 'ok',
      value: 75,
    });
    expect(computeRollup(rollup({ ...base, aggregate: 'min' }), row, env)).toEqual({
      status: 'ok',
      value: 50,
    });
    expect(computeRollup(rollup({ ...base, aggregate: 'max' }), row, env)).toEqual({
      status: 'ok',
      value: 100,
    });
  });

  it('aucune valeur numérique à agréger : vide, JAMAIS zéro', () => {
    const only = tacheRow('r1', ['r-gamma']); // budget = 'beaucoup'
    expect(
      computeRollup(rollup({ aggregate: 'sum', targetPropertyId: projBudget.id }), only, env)
    ).toEqual({ status: 'empty' });
    expect(
      computeRollup(
        rollup({ aggregate: 'avg', targetPropertyId: projBudget.id }),
        tacheRow('r2', []),
        env
      )
    ).toEqual({ status: 'empty' });
  });

  it('propriété cible non numérique : vide (types incompatibles)', () => {
    expect(
      computeRollup(rollup({ aggregate: 'sum', targetPropertyId: projTexte.id }), row, env)
    ).toEqual({ status: 'empty' });
  });

  it('checked ne compte que sur une case à cocher', () => {
    expect(
      computeRollup(rollup({ aggregate: 'checked', targetPropertyId: projFait.id }), row, env)
    ).toEqual({ status: 'ok', value: 2 });
    expect(
      computeRollup(rollup({ aggregate: 'checked', targetPropertyId: projBudget.id }), row, env)
    ).toEqual({ status: 'empty' });
  });

  it('notEmpty compte les cellules réellement remplies', () => {
    expect(
      computeRollup(rollup({ aggregate: 'notEmpty', targetPropertyId: projTexte.id }), row, env)
    ).toEqual({ status: 'ok', value: 1 });
    expect(
      computeRollup(rollup({ aggregate: 'notEmpty', targetPropertyId: projNote.id }), row, env)
    ).toEqual({ status: 'ok', value: 2 });
  });

  it('propriété cible absente de la base visée : vide', () => {
    expect(
      computeRollup(rollup({ aggregate: 'sum', targetPropertyId: 'p-inconnue' }), row, env)
    ).toEqual({ status: 'empty' });
    // …mais count n'en a pas besoin
    expect(
      computeRollup(rollup({ aggregate: 'count', targetPropertyId: 'p-inconnue' }), row, env)
    ).toEqual({ status: 'ok', value: 3 });
  });

  it('relation supprimée, ou devenue un autre type : vide', () => {
    expect(computeRollup(rollup({ viaPropertyId: 'p-nexiste-pas' }), row, env)).toEqual({
      status: 'empty',
    });
    const texte: DbProperty = { id: relProp.id, name: 'Projet', type: 'text' };
    expect(computeRollup(rollup({}), row, envOf([tacheTitre, texte], CTX))).toEqual({
      status: 'empty',
    });
    expect(computeRollup(rollup({ viaPropertyId: undefined }), row, env)).toEqual({
      status: 'empty',
    });
  });

  it('base visée introuvable : « indisponible » et non pas zéro', () => {
    const blind = envOf(props, ctxOf({}));
    expect(computeRollup(rollup({ aggregate: 'count' }), row, blind)).toEqual({
      status: 'unavailable',
    });
    expect(rollupNumber(rollup({ aggregate: 'count' }), row, blind)).toBeNull();
  });

  it('agrégat d’agrégat : rien à lire, donc vide', () => {
    const nested: DbProperty = { id: 'p-p-roll', name: 'Sous-agrégat', type: 'rollup' };
    const withNested = ctxOf({
      'db@v:projets': { properties: [...projets.properties, nested], rows: projets.rows },
    });
    expect(
      computeRollup(
        rollup({ aggregate: 'sum', targetPropertyId: nested.id }),
        row,
        envOf(props, withNested)
      )
    ).toEqual({ status: 'empty' });
  });

  it('une propriété qui n’est pas un rollup ne calcule rien', () => {
    expect(computeRollup(tacheTitre, row, env)).toEqual({ status: 'empty' });
  });

  it('formatage : deux décimales au plus, sans zéros inutiles', () => {
    expect(formatRollupValue(3)).toBe('3');
    expect(formatRollupValue(2 / 3)).toBe('0.67');
    expect(formatRollupValue(1.5)).toBe('1.5');
    expect(formatRollupValue(Number.NaN)).toBe('');
  });
});

/* ==================== Filtres et tris ==================== */

describe('filtres et tris sur relation et agrégat', () => {
  const agg = rollup({ aggregate: 'sum', targetPropertyId: projBudget.id });
  const properties = [tacheTitre, relProp, agg];
  const rows: DbRow[] = [
    tacheRow('r-vide', undefined, { [tacheTitre.id]: 'Sans lien' }),
    tacheRow('r-alpha', ['r-alpha'], { [tacheTitre.id]: 'Une' }),
    tacheRow('r-deux', ['r-alpha', 'r-beta'], { [tacheTitre.id]: 'Deux' }),
    tacheRow('r-fantome', ['r-nope'], { [tacheTitre.id]: 'Fantôme' }),
  ];
  const data: InlineDbData = { properties, rows };

  it('les opérateurs proposés collent aux deux familles', () => {
    expect(opsForType('relation')).toEqual(['contains', 'notContains', 'isEmpty', 'isNotEmpty']);
    expect(opsForType('rollup')).toEqual([
      'eq',
      'neq',
      'gt',
      'lt',
      'gte',
      'lte',
      'isEmpty',
      'isNotEmpty',
    ]);
  });

  it('relation : vide / non vide se jugent sur les liens RÉSOLUS', () => {
    const vide = applyFilters(data, [{ id: 'f', propertyId: relProp.id, op: 'isEmpty' }], CTX).map(
      (r) => r.id
    );
    // La ligne au lien fantôme n'affiche rien : elle est vide, comme à l'écran
    expect(vide).toEqual(['r-vide', 'r-fantome']);

    const pleines = applyFilters(
      data,
      [{ id: 'f', propertyId: relProp.id, op: 'isNotEmpty' }],
      CTX
    ).map((r) => r.id);
    expect(pleines).toEqual(['r-alpha', 'r-deux']);
  });

  it('relation : « contient » porte sur les titres des lignes liées', () => {
    const f = { id: 'f', propertyId: relProp.id, op: 'contains' as const, value: 'beta' };
    expect(applyFilters(data, [f], CTX).map((r) => r.id)).toEqual(['r-deux']);
    const nf = { ...f, op: 'notContains' as const };
    expect(applyFilters(data, [nf], CTX).map((r) => r.id)).toEqual([
      'r-vide',
      'r-alpha',
      'r-fantome',
    ]);
    // Terme absent : filtre INERTE (il ne masque rien)
    expect(applyFilters(data, [{ ...f, value: undefined }], CTX)).toHaveLength(4);
  });

  it('relation : base indisponible → cellule NON vide et filtre « contient » inerte', () => {
    const blind = { getDb: () => undefined };
    expect(
      applyFilters(data, [{ id: 'f', propertyId: relProp.id, op: 'isEmpty' }], blind).map(
        (r) => r.id
      )
    ).toEqual(['r-vide']);
    expect(
      applyFilters(
        data,
        [{ id: 'f', propertyId: relProp.id, op: 'contains', value: 'beta' }],
        blind
      )
    ).toHaveLength(4);
  });

  it('agrégat : comparé comme un nombre, vide quand il ne rend rien', () => {
    const gt = { id: 'f', propertyId: agg.id, op: 'gt' as const, value: 60 };
    expect(applyFilters(data, [gt], CTX).map((r) => r.id)).toEqual(['r-alpha', 'r-deux']);
    const eq = { id: 'f', propertyId: agg.id, op: 'eq' as const, value: 150 };
    expect(applyFilters(data, [eq], CTX).map((r) => r.id)).toEqual(['r-deux']);
    // « ≠ » accepte les cellules sans valeur, comme pour un nombre
    const neq = { id: 'f', propertyId: agg.id, op: 'neq' as const, value: 150 };
    expect(applyFilters(data, [neq], CTX).map((r) => r.id)).toEqual([
      'r-vide',
      'r-alpha',
      'r-fantome',
    ]);
    expect(
      applyFilters(data, [{ id: 'f', propertyId: agg.id, op: 'isNotEmpty' }], CTX).map((r) => r.id)
    ).toEqual(['r-alpha', 'r-deux']);
  });

  it('sans contexte, relation et agrégat ne masquent RIEN par accident', () => {
    // Aucun ctx : les valeurs sont illisibles, pas vides
    expect(applyFilters(data, [{ id: 'f', propertyId: agg.id, op: 'isEmpty' }])).toHaveLength(4);
  });

  it('tri : relation par titres liés, agrégat par valeur, vides en dernier', () => {
    const parRelation = applySorts(
      data,
      data.rows,
      [{ propertyId: relProp.id, direction: 'asc' }],
      CTX
    ).map((r) => r.id);
    expect(parRelation).toEqual(['r-alpha', 'r-deux', 'r-vide', 'r-fantome']);

    const parAgregat = applySorts(
      data,
      data.rows,
      [{ propertyId: agg.id, direction: 'desc' }],
      CTX
    ).map((r) => r.id);
    expect(parAgregat.slice(0, 2)).toEqual(['r-deux', 'r-alpha']);
    // Les vides restent en fin, quel que soit le sens
    expect(parAgregat.slice(2)).toEqual(['r-vide', 'r-fantome']);
  });

  it('applyView enchaîne filtre puis tri avec le même contexte', () => {
    const view: DbView = {
      id: 'v',
      name: 'Vue',
      type: 'table',
      filters: [{ id: 'f', propertyId: relProp.id, op: 'isNotEmpty' }],
      sorts: [{ propertyId: agg.id, direction: 'asc' }],
    };
    expect(applyView(data, view, CTX).map((r) => r.id)).toEqual(['r-alpha', 'r-deux']);
  });

  it('isEmptyCell juge une relation sur ses liens RÉSOLUS', () => {
    const env = envOf(properties, CTX);
    expect(isEmptyCell(relProp, tacheRow('r1', []), env)).toBe(true);
    expect(isEmptyCell(relProp, tacheRow('r1', ['r-alpha']), env)).toBe(false);
    expect(isEmptyCell(relProp, tacheRow('r1', ['r-nope']), env)).toBe(true);
    expect(isEmptyCell(relProp, tacheRow('r1', ['r-alpha']), envOf(properties, ctxOf({})))).toBe(
      false
    );
  });

  it('isEmptyCell juge un agrégat sur la VRAIE ligne, relation comprise', () => {
    const env = envOf(properties, CTX);
    // La cellule d'un agrégat est toujours absente (rien n'est stocké) : c'est
    // la relation VOISINE de la ligne qui décide. Une ligne de circonstance,
    // qui ne porterait que la cellule jugée, ferait rendre 0 au `count` et
    // déclarerait la cellule vide à tort.
    expect(isEmptyCell(agg, tacheRow('r-deux', ['r-alpha', 'r-beta']), env)).toBe(false);
    const compte = rollup({ aggregate: 'count' });
    const envCompte = envOf([tacheTitre, relProp, compte], CTX);
    expect(isEmptyCell(compte, tacheRow('r-deux', ['r-alpha', 'r-beta']), envCompte)).toBe(false);
    // Aucun lien : le compte vaut zéro, ce qui EST une valeur — donc pas vide
    expect(isEmptyCell(compte, tacheRow('r-vide', []), envCompte)).toBe(false);
    // Base visée introuvable : l'agrégat ne rend aucun nombre, donc vide (rien
    // n'est stocké dans cette cellule, contrairement à une relation)
    expect(
      isEmptyCell(compte, tacheRow('r-deux', ['r-alpha']), envOf([tacheTitre, relProp], ctxOf({})))
    ).toBe(true);
  });

  it('aucune cellule n’est pré-remplie pour une relation ou un agrégat', () => {
    const view: DbView = {
      id: 'v',
      name: 'Vue',
      type: 'table',
      filters: [
        { id: 'f1', propertyId: relProp.id, op: 'isEmpty' },
        { id: 'f2', propertyId: agg.id, op: 'isEmpty' },
        { id: 'f3', propertyId: tacheTitre.id, op: 'contains', value: 'Rapport' },
      ],
      sorts: [],
    };
    const cells = prefillCellsForView(view, properties);
    expect(Object.keys(cells)).toEqual([tacheTitre.id]);
  });
});

/* ==================== Cohérence du schéma ==================== */

describe('sanitizeSchema', () => {
  it('un agrégat qui suivait une relation supprimée est nettoyé', () => {
    const data: InlineDbData = {
      properties: [tacheTitre, rollup({ targetPropertyId: projBudget.id, aggregate: 'sum' })],
      rows: [tacheRow('r1', ['r-alpha'])],
    };
    const out = sanitizeSchema(data);
    const agg = out.properties[1];
    expect(agg.viaPropertyId).toBeUndefined();
    expect(agg.targetPropertyId).toBeUndefined();
    // L'agrégat lui-même reste choisi : seule la cible est retombée
    expect(agg.aggregate).toBe('sum');
    // Les LIGNES ne sont jamais touchées
    expect(out.rows).toEqual(data.rows);
  });

  it('une relation devenue texte fait tomber les agrégats qui la suivaient', () => {
    const texte: DbProperty = { id: relProp.id, name: 'Projet', type: 'text' };
    const out = sanitizeSchema({
      properties: [texte, rollup({ aggregate: 'count' })],
      rows: [],
    });
    expect(out.properties[1].viaPropertyId).toBeUndefined();
  });

  it('la cible d’une relation VIVANTE est conservée, même introuvable à cet instant', () => {
    const data: InlineDbData = { properties: [relProp], rows: [] };
    expect(sanitizeSchema(data).properties[0].targetDbId).toBe('db@v:projets');
  });

  it('une propriété qui n’est plus une relation lâche sa cible', () => {
    const out = sanitizeSchema({
      properties: [{ id: 'p', name: 'X', type: 'text', targetDbId: 'db@v:projets' }],
      rows: [],
    });
    expect(out.properties[0].targetDbId).toBeUndefined();
  });

  it('une propriété qui n’est plus un agrégat lâche sa configuration', () => {
    const out = sanitizeSchema({
      properties: [
        relProp,
        {
          id: 'p',
          name: 'X',
          type: 'number',
          viaPropertyId: relProp.id,
          targetPropertyId: projBudget.id,
          aggregate: 'sum',
        },
      ],
      rows: [],
    });
    expect(out.properties[1].viaPropertyId).toBeUndefined();
    expect(out.properties[1].aggregate).toBeUndefined();
  });

  it('rien à nettoyer : l’objet d’origine est rendu tel quel (aucune écriture inutile)', () => {
    const data: InlineDbData = {
      properties: [tacheTitre, relProp, rollup({ aggregate: 'count' })],
      rows: [tacheRow('r1', ['r-alpha'])],
    };
    expect(sanitizeSchema(data)).toBe(data);
  });
});

/* ==================== Sérialisation ==================== */

describe('parse tolérant des nouvelles propriétés', () => {
  it('conserve cible, relation suivie et agrégat', () => {
    const data: InlineDbData = {
      properties: [relProp, rollup({ targetPropertyId: projBudget.id, aggregate: 'avg' })],
      rows: [tacheRow('r1', ['r-alpha', 'r-beta'])],
    };
    const back = parseDbData(serializeDbData(data));
    expect(back.properties[0].targetDbId).toBe('db@v:projets');
    expect(back.properties[1].aggregate).toBe('avg');
    expect(back.properties[1].viaPropertyId).toBe(relProp.id);
    expect(back.rows[0].cells[relProp.id]).toEqual(['r-alpha', 'r-beta']);
  });

  it('un agrégat inconnu est jeté, une cible douteuse aussi — sans casser la base', () => {
    const raw = JSON.stringify({
      properties: [
        { id: 'p1', name: 'R', type: 'relation', targetDbId: 42 },
        { id: 'p2', name: 'A', type: 'rollup', aggregate: 'mediane', viaPropertyId: 7 },
      ],
      rows: [{ id: 'r1', cells: { p1: 'pas-un-tableau' } }],
    });
    const back = parseDbData(raw);
    expect(back.properties[0].targetDbId).toBeUndefined();
    expect(back.properties[1].aggregate).toBeUndefined();
    expect(back.properties[1].viaPropertyId).toBeUndefined();
    expect(back.rows).toHaveLength(1);
  });

  it('les types relation et rollup survivent au parse (pas de repli sur text)', () => {
    const back = parseDbData(
      JSON.stringify({
        properties: [
          { id: 'p1', name: 'R', type: 'relation' },
          { id: 'p2', name: 'A', type: 'rollup' },
          { id: 'p3', name: 'Z', type: 'zorglub' },
        ],
        rows: [],
      })
    );
    expect(back.properties.map((p) => p.type)).toEqual(['relation', 'rollup', 'text']);
  });
});
