/**
 * Rétroliens, cardinalité et agrégats riches des bases inline.
 *
 * Ce que ces tests gardent, et qui ne se voit ni à la compilation ni à l'œil :
 *  - un rétrolien est CALCULÉ : il ne lit jamais la cellule, ne peut pas
 *    diverger, et se tait dès que la relation d'en face ne pointe plus ici ;
 *  - la contrainte « un seul lien » ne détruit RIEN toute seule : les cellules
 *    qui portaient déjà plusieurs liens les gardent jusqu'à un geste explicite ;
 *  - créer une ligne chez le voisin réécrit sa note au plus près, ou renonce —
 *    jamais une écriture approximative ;
 *  - un agrégat impossible rend vide, jamais un zéro (ni un pourcentage) qui
 *    passerait pour un résultat.
 */

import { describe, it, expect } from 'vitest';
import type { DbProperty, DbRow, InlineDbData } from '../types';
import { formatDbDate, newRow, parseDbData, serializeDbData } from '../types';
import type { DbEnv, DbLinkContext, DbTarget } from '../relations';
import {
  backlinkSourcesFor,
  buildBackIndex,
  computeRollup,
  countMultiLinkRows,
  formatRollupResult,
  formatRollupValue,
  makeLinkContext,
  relationText,
  resolveRelation,
  rollupNumber,
  rowDisplayText,
  secondaryPropertiesOf,
  trimToSingleLinks,
} from '../relations';
import {
  appendPropertyToNoteContent,
  appendRowToNoteContent,
  collectInlineDbs,
  restampCopiedDbIds,
} from '../dbIndex';
import { applyFilters, applySorts, isEmptyCell } from '../viewEngine';

/* ==================== Fixtures ====================
 * Deux bases : « Tâches » porte la relation sortante, « Projets » est visée et
 * lit les rétroliens.
 */

const PROJETS = 'db@v:projets';
const TACHES = 'db@v:taches';

const tacheTitre: DbProperty = { id: 'p-t-titre', name: 'Tâche', type: 'text' };
const tacheProjet: DbProperty = {
  id: 'p-t-projet',
  name: 'Projet',
  type: 'relation',
  targetDbId: PROJETS,
};
const tacheFait: DbProperty = { id: 'p-t-fait', name: 'Fait', type: 'checkbox' };
const tacheStatut: DbProperty = {
  id: 'p-t-statut',
  name: 'Statut',
  type: 'select',
  options: [
    { id: 'o-todo', label: 'À faire', color: 'gray' },
    { id: 'o-done', label: 'Livré', color: 'green' },
  ],
};
const tacheDate: DbProperty = { id: 'p-t-date', name: 'Échéance', type: 'date' };
const tacheNote: DbProperty = { id: 'p-t-note', name: 'Fiche', type: 'note' };

const tacheProps = [tacheTitre, tacheStatut, tacheDate, tacheFait, tacheNote, tacheProjet];

function tache(
  id: string,
  titre: string,
  links: unknown,
  extra: Record<string, unknown> = {}
): DbRow {
  return { id, cells: { [tacheTitre.id]: titre, [tacheProjet.id]: links, ...extra } };
}

const taches: DbTarget = {
  properties: tacheProps,
  rows: [
    tache('r-t1', 'Écrire', ['r-alpha'], {
      [tacheFait.id]: true,
      [tacheStatut.id]: 'o-done',
      [tacheDate.id]: '2026-03-01',
    }),
    tache('r-t2', 'Relire', ['r-alpha', 'r-beta'], { [tacheFait.id]: false }),
    tache('r-t3', 'Publier', ['r-beta'], { [tacheFait.id]: true }),
    tache('r-t4', 'Sans projet', undefined),
  ],
  noteId: 'note-taches',
  noteTitle: 'Note tâches',
  label: 'Tâches',
};

/** Propriété de rétroliens : elle vise la base SOURCE et la relation d'en face */
const projRetro: DbProperty = {
  id: 'p-p-retro',
  name: 'Tâches liées',
  type: 'relation',
  direction: 'in',
  targetDbId: TACHES,
  sourcePropertyId: tacheProjet.id,
};

const projTitre: DbProperty = { id: 'p-p-titre', name: 'Nom', type: 'text' };
const projets: DbTarget = {
  properties: [projTitre, projRetro],
  rows: [
    { id: 'r-alpha', cells: { [projTitre.id]: 'Alpha' } },
    { id: 'r-beta', cells: { [projTitre.id]: 'Beta' } },
    { id: 'r-gamma', cells: { [projTitre.id]: 'Gamma' } },
  ],
  noteId: 'note-projets',
  noteTitle: 'Note projets',
  label: 'Projets',
};

/** Contexte vu DEPUIS la base Projets (celle qui lit ses rétroliens) */
function projectsCtx(overrides: Record<string, DbTarget | undefined> = {}): DbLinkContext {
  return makeLinkContext((id) => {
    if (id in overrides) return overrides[id];
    if (id === TACHES) return taches;
    if (id === PROJETS) return projets;
    return undefined;
  }, PROJETS);
}

function projectsEnv(ctx: DbLinkContext = projectsCtx()): DbEnv {
  return { properties: projets.properties, ctx };
}

function projRow(id: string): DbRow {
  return projets.rows.find((r) => r.id === id) as DbRow;
}

/* ==================== Rétroliens ==================== */

describe('rétroliens (relation de sens « in »)', () => {
  it('liste les lignes d’en face qui pointent ici, dans l’ordre de la base source', () => {
    const res = resolveRelation(projRetro, projRow('r-alpha'), projectsEnv());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links.map((l) => l.title)).toEqual(['Écrire', 'Relire']);
    expect(res.ids).toEqual(['r-t1', 'r-t2']);
    // Rien à réparer : un rétrolien ne peut pas désigner une ligne absente
    expect(res.missing).toEqual([]);
  });

  it('rend une liste vide — et non une erreur — quand personne ne pointe ici', () => {
    const res = resolveRelation(projRetro, projRow('r-gamma'), projectsEnv());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links).toEqual([]);
  });

  it('ne lit JAMAIS la cellule : une valeur stockée là ne change rien', () => {
    const pollué: DbRow = {
      id: 'r-gamma',
      cells: { [projTitre.id]: 'Gamma', [projRetro.id]: ['r-t1', 'r-t2', 'r-t3'] },
    };
    const res = resolveRelation(projRetro, pollué, projectsEnv());
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links).toEqual([]);
  });

  it('se tait quand la relation d’en face a disparu, changé de type ou visé ailleurs', () => {
    const cases: DbTarget[] = [
      // supprimée
      { ...taches, properties: tacheProps.filter((p) => p.id !== tacheProjet.id) },
      // devenue du texte
      {
        ...taches,
        properties: tacheProps.map((p) =>
          p.id === tacheProjet.id ? { ...p, type: 'text' as const } : p
        ),
      },
      // re-dirigée vers une autre base
      {
        ...taches,
        properties: tacheProps.map((p) =>
          p.id === tacheProjet.id ? { ...p, targetDbId: 'db@v:ailleurs' } : p
        ),
      },
      // devenue elle-même un rétrolien (l’envers d’un envers ne désigne rien)
      {
        ...taches,
        properties: tacheProps.map((p) =>
          p.id === tacheProjet.id ? { ...p, direction: 'in' as const } : p
        ),
      },
    ];
    for (const source of cases) {
      const res = resolveRelation(
        projRetro,
        projRow('r-alpha'),
        projectsEnv(projectsCtx({ [TACHES]: source }))
      );
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') continue;
      expect(res.links).toEqual([]);
    }
  });

  it('sans identité de base dans le contexte, la relation d’en face est acceptée telle quelle', () => {
    // Export et tests : le contexte ne sait pas d'où l'on lit. On s'en tient
    // alors à l'appartenance des identifiants de lignes.
    const blind = makeLinkContext((id) => (id === TACHES ? taches : undefined));
    const res = resolveRelation(projRetro, projRow('r-alpha'), {
      properties: projets.properties,
      ctx: blind,
    });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links).toHaveLength(2);
  });

  it('base source introuvable : « indisponible », jamais une liste vide trompeuse', () => {
    const res = resolveRelation(
      projRetro,
      projRow('r-alpha'),
      projectsEnv(projectsCtx({ [TACHES]: undefined }))
    );
    expect(res.status).toBe('unavailable');
  });

  it('source pas encore choisie : « à configurer »', () => {
    const nu: DbProperty = { ...projRetro, sourcePropertyId: undefined };
    expect(resolveRelation(nu, projRow('r-alpha'), projectsEnv()).status).toBe('unset');
    const sansBase: DbProperty = { ...projRetro, targetDbId: undefined };
    expect(resolveRelation(sansBase, projRow('r-alpha'), projectsEnv()).status).toBe('unset');
  });

  it('l’index inverse n’est bâti QU’UNE fois par relation suivie', () => {
    let reads = 0;
    const ctx = makeLinkContext((id) => {
      reads += 1;
      return id === TACHES ? taches : undefined;
    }, PROJETS);
    const env: DbEnv = { properties: projets.properties, ctx };
    for (const row of projets.rows) resolveRelation(projRetro, row, env);
    expect(reads).toBe(1);
    // Et la table inverse elle-même est partagée entre les lignes
    expect(ctx.getBackIndex?.(TACHES, tacheProjet.id)).toBe(
      ctx.getBackIndex?.(TACHES, tacheProjet.id)
    );
  });

  it('buildBackIndex : une ligne visant deux fois la même cible n’y figure qu’une fois', () => {
    const index = buildBackIndex(
      [{ id: 'x', cells: { [tacheProjet.id]: ['r-alpha', 'r-alpha', 'r-beta'] } }],
      tacheProjet.id
    );
    expect(index.get('r-alpha')?.map((r) => r.id)).toEqual(['x']);
    expect(index.get('r-beta')?.map((r) => r.id)).toEqual(['x']);
  });

  it('un rétrolien se filtre et se trie comme ce qu’il MONTRE', () => {
    const data: InlineDbData = { properties: projets.properties, rows: projets.rows };
    const ctx = projectsCtx();
    expect(relationText(projRetro, projRow('r-alpha'), projectsEnv(ctx))).toBe('Écrire Relire');
    expect(isEmptyCell(projRetro, projRow('r-gamma'), projectsEnv(ctx))).toBe(true);
    expect(isEmptyCell(projRetro, projRow('r-alpha'), projectsEnv(ctx))).toBe(false);

    const filtré = applyFilters(
      data,
      [{ id: 'f1', propertyId: projRetro.id, op: 'contains', value: 'Publier' }],
      ctx
    );
    expect(filtré.map((r) => r.id)).toEqual(['r-beta']);

    const nonVide = applyFilters(
      data,
      [{ id: 'f2', propertyId: projRetro.id, op: 'isNotEmpty' }],
      ctx
    );
    expect(nonVide.map((r) => r.id)).toEqual(['r-alpha', 'r-beta']);

    const trié = applySorts(data, data.rows, [{ propertyId: projRetro.id, direction: 'asc' }], ctx);
    // « Écrire Relire » avant « Publier Relire » (accents ignorés par le
    // collateur), et le vide toujours en dernier quel que soit le sens
    expect(trié.map((r) => r.id)).toEqual(['r-alpha', 'r-beta', 'r-gamma']);
    const inverse = applySorts(
      data,
      data.rows,
      [{ propertyId: projRetro.id, direction: 'desc' }],
      ctx
    );
    expect(inverse.map((r) => r.id)).toEqual(['r-beta', 'r-alpha', 'r-gamma']);
  });

  it('un agrégat peut suivre un rétrolien (compter ce qui pointe ici)', () => {
    const rollup: DbProperty = {
      id: 'p-p-nb',
      name: 'Nb tâches',
      type: 'rollup',
      viaPropertyId: projRetro.id,
      aggregate: 'count',
    };
    const env = projectsEnv();
    expect(computeRollup(rollup, projRow('r-alpha'), env)).toEqual({ status: 'ok', value: 2 });
    expect(computeRollup(rollup, projRow('r-gamma'), env)).toEqual({ status: 'ok', value: 0 });

    const pourcent: DbProperty = {
      ...rollup,
      aggregate: 'percentChecked',
      targetPropertyId: tacheFait.id,
    };
    // r-alpha : « Écrire » cochée, « Relire » non → 50 %
    expect(computeRollup(pourcent, projRow('r-alpha'), env)).toEqual({
      status: 'ok',
      value: 50,
      unit: 'percent',
    });
    // Aucune tâche : pas « 0 % », rien
    expect(computeRollup(pourcent, projRow('r-gamma'), env)).toEqual({ status: 'empty' });
  });

  it('une base peut se rétro-lier à ELLE-MÊME (hiérarchie parent/enfants)', () => {
    const parent: DbProperty = {
      id: 'p-parent',
      name: 'Parent',
      type: 'relation',
      targetDbId: 'db@v:arbre',
    };
    const enfants: DbProperty = {
      id: 'p-enfants',
      name: 'Enfants',
      type: 'relation',
      direction: 'in',
      targetDbId: 'db@v:arbre',
      sourcePropertyId: parent.id,
    };
    const titre: DbProperty = { id: 'p-nom', name: 'Nom', type: 'text' };
    const arbre: DbTarget = {
      properties: [titre, parent, enfants],
      rows: [
        { id: 'racine', cells: { [titre.id]: 'Racine' } },
        { id: 'f1', cells: { [titre.id]: 'Fille 1', [parent.id]: ['racine'] } },
        { id: 'f2', cells: { [titre.id]: 'Fille 2', [parent.id]: ['racine'] } },
      ],
    };
    const ctx = makeLinkContext((id) => (id === 'db@v:arbre' ? arbre : undefined), 'db@v:arbre');
    const res = resolveRelation(enfants, arbre.rows[0], { properties: arbre.properties, ctx });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links.map((l) => l.title)).toEqual(['Fille 1', 'Fille 2']);
  });

  it('backlinkSourcesFor ne propose que les relations qui pointent VRAIMENT ici', () => {
    const catalogue = [
      { dbId: TACHES, properties: tacheProps },
      { dbId: PROJETS, properties: projets.properties },
      { dbId: 'db@v:autre', properties: [{ ...tacheProjet, targetDbId: 'db@v:ailleurs' }] },
    ];
    expect(backlinkSourcesFor(catalogue, PROJETS)).toEqual([
      { dbId: TACHES, propertyId: tacheProjet.id },
    ]);
    // Une base sans identité ne peut être visée par personne
    expect(backlinkSourcesFor(catalogue, '')).toEqual([]);
  });
});

/* ==================== Cardinalité ==================== */

describe('contrainte « un seul lien »', () => {
  const rows: DbRow[] = [
    { id: 'a', cells: { [tacheProjet.id]: ['r-alpha', 'r-beta'] } },
    { id: 'b', cells: { [tacheProjet.id]: ['r-alpha'] } },
    { id: 'c', cells: {} },
    { id: 'd', cells: { [tacheProjet.id]: 'pas-un-tableau' } },
  ];

  it('compte les lignes qui portent plus d’un lien', () => {
    expect(countMultiLinkRows(rows, tacheProjet.id)).toBe(1);
  });

  it('la réduction garde le PREMIER lien et ne touche à rien d’autre', () => {
    const { rows: next, changed } = trimToSingleLinks(rows, tacheProjet.id);
    expect(changed).toBe(1);
    expect(next[0].cells[tacheProjet.id]).toEqual(['r-alpha']);
    // Les lignes intactes sont les MÊMES objets (aucun re-rendu inutile)
    expect(next[1]).toBe(rows[1]);
    expect(next[2]).toBe(rows[2]);
    // Une cellule d'un type inattendu n'est pas réécrite
    expect(next[3].cells[tacheProjet.id]).toBe('pas-un-tableau');
  });

  it('rien à réduire : le tableau d’origine est rendu tel quel', () => {
    const only = [rows[1], rows[2]];
    const res = trimToSingleLinks(only, tacheProjet.id);
    expect(res.changed).toBe(0);
    expect(res.rows).toBe(only);
  });

  it('passer une colonne en « un seul lien » n’efface RIEN de lui-même', () => {
    // Cas dégénéré du fondateur : la contrainte arrive après coup, sur des
    // cellules qui portent déjà plusieurs liens. Elles restent lisibles.
    const single: DbProperty = { ...tacheProjet, single: true };
    const ctx = makeLinkContext((id) => (id === PROJETS ? projets : undefined), TACHES);
    const res = resolveRelation(single, rows[0], { properties: tacheProps, ctx });
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.links.map((l) => l.title)).toEqual(['Alpha', 'Beta']);
  });
});

/* ==================== Agrégats riches ==================== */

describe('agrégats « liste des valeurs » et « pourcentage coché »', () => {
  const ctx = makeLinkContext((id) => {
    if (id === TACHES) return taches;
    if (id === PROJETS) return projets;
    return undefined;
  }, PROJETS);
  const env = projectsEnv(ctx);

  function retroRollup(patch: Partial<DbProperty>): DbProperty {
    return {
      id: 'p-p-agg',
      name: 'Agrégat',
      type: 'rollup',
      viaPropertyId: projRetro.id,
      ...patch,
    };
  }

  it('liste : les valeurs mises bout à bout, dans l’ordre des liens', () => {
    const res = computeRollup(
      retroRollup({ aggregate: 'list', targetPropertyId: tacheTitre.id }),
      projRow('r-alpha'),
      env
    );
    expect(res).toEqual({ status: 'text', text: 'Écrire, Relire', count: 2 });
    expect(formatRollupResult(res)).toBe('Écrire, Relire');
  });

  it('liste : libellés d’options, coche des cases, valeurs vides sautées', () => {
    const statuts = computeRollup(
      retroRollup({ aggregate: 'list', targetPropertyId: tacheStatut.id }),
      projRow('r-alpha'),
      env
    );
    // « Relire » n'a pas de statut : elle ne laisse pas de trou
    expect(statuts).toEqual({ status: 'text', text: 'Livré', count: 1 });

    const cases = computeRollup(
      retroRollup({ aggregate: 'list', targetPropertyId: tacheFait.id }),
      projRow('r-alpha'),
      env
    );
    expect(cases).toEqual({ status: 'text', text: '✓', count: 1 });
  });

  it('liste : aucune valeur lisible → vide, jamais une chaîne creuse', () => {
    expect(
      computeRollup(
        retroRollup({ aggregate: 'list', targetPropertyId: tacheNote.id }),
        projRow('r-alpha'),
        env
      )
    ).toEqual({ status: 'empty' });
    expect(
      computeRollup(
        retroRollup({ aggregate: 'list', targetPropertyId: tacheTitre.id }),
        projRow('r-gamma'),
        env
      )
    ).toEqual({ status: 'empty' });
  });

  it('liste : comparée et triée par son NOMBRE de valeurs, donc jamais « vide » à tort', () => {
    const prop = retroRollup({ aggregate: 'list', targetPropertyId: tacheTitre.id });
    expect(rollupNumber(prop, projRow('r-alpha'), env)).toBe(2);
    expect(rollupNumber(prop, projRow('r-gamma'), env)).toBeNull();
    const withRollup: InlineDbData = {
      properties: [...projets.properties, prop],
      rows: projets.rows,
    };
    const listEnv: DbEnv = { properties: withRollup.properties, ctx };
    expect(isEmptyCell(prop, projRow('r-alpha'), listEnv)).toBe(false);
    expect(isEmptyCell(prop, projRow('r-gamma'), listEnv)).toBe(true);
  });

  it('pourcentage coché : une case à cocher, et rien d’autre', () => {
    const ok = computeRollup(
      retroRollup({ aggregate: 'percentChecked', targetPropertyId: tacheFait.id }),
      projRow('r-beta'),
      env
    );
    // r-beta : « Relire » (non) et « Publier » (oui) → 50 %
    expect(ok).toEqual({ status: 'ok', value: 50, unit: 'percent' });
    expect(formatRollupResult(ok)).toBe('50%');
    expect(
      computeRollup(
        retroRollup({ aggregate: 'percentChecked', targetPropertyId: tacheTitre.id }),
        projRow('r-beta'),
        env
      )
    ).toEqual({ status: 'empty' });
  });

  it('le signe % ne se perd pas, et deux décimales suffisent', () => {
    expect(formatRollupValue(66.666666, 'percent')).toBe('66.67%');
    expect(formatRollupValue(50)).toBe('50');
    expect(formatRollupValue(Number.NaN, 'percent')).toBe('');
    expect(formatRollupResult({ status: 'empty' })).toBe('');
    expect(formatRollupResult({ status: 'unavailable' })).toBe('');
  });
});

/* ==================== Lecture affichable ==================== */

describe('valeurs lisibles d’une ligne', () => {
  it('rend ce qu’un humain lit, jamais un identifiant interne', () => {
    const row = taches.rows[0];
    const env: DbEnv = {
      properties: tacheProps,
      ctx: makeLinkContext((id) => (id === PROJETS ? projets : undefined), TACHES),
    };
    expect(rowDisplayText(tacheTitre, row, env)).toBe('Écrire');
    expect(rowDisplayText(tacheStatut, row, env)).toBe('Livré');
    // La date passe par la MISE EN FORME de la langue, comme la cellule : un ISO
    // brut dans une pastille à côté d'une date habillée se remarque tout de suite
    expect(rowDisplayText(tacheDate, row, env)).toBe(formatDbDate('2026-03-01'));
    expect(rowDisplayText(tacheDate, row, env)).not.toBe('2026-03-01');
    expect(rowDisplayText(tacheDate, row, env)).toContain('2026');
    // Une date illisible ne devient jamais du texte approximatif
    expect(rowDisplayText(tacheDate, { id: 'x', cells: { [tacheDate.id]: 'demain' } }, env)).toBe(
      ''
    );
    expect(rowDisplayText(tacheFait, row, env)).toBe('✓');
    expect(rowDisplayText(tacheFait, taches.rows[1], env)).toBe('');
    // Lien vers une note : identifiant opaque, donc rien à montrer
    expect(rowDisplayText(tacheNote, { id: 'x', cells: { [tacheNote.id]: 'note-42' } }, env)).toBe(
      ''
    );
    // Une relation descend d'UN cran : les titres liés
    expect(rowDisplayText(tacheProjet, row, env)).toBe('Alpha');
    // Un agrégat ne se liste pas (rien n'est stocké)
    expect(rowDisplayText({ id: 'p-x', name: 'Agg', type: 'rollup' }, row, env)).toBe('');
  });

  it('les propriétés secondaires du sélecteur : les plus parlantes d’abord', () => {
    // Le titre (1re colonne texte) n'y figure jamais — il est déjà affiché
    expect(secondaryPropertiesOf(tacheProps).map((p) => p.id)).toEqual([
      tacheStatut.id,
      tacheDate.id,
    ]);
    // Ni relation, ni agrégat, ni lien vers une note
    expect(secondaryPropertiesOf([tacheTitre, tacheProjet, tacheNote])).toEqual([]);
    expect(secondaryPropertiesOf(tacheProps, 0)).toEqual([]);
  });
});

/* ==================== Créer une ligne chez le voisin ==================== */

describe('ajout d’une ligne dans la note qui porte la base', () => {
  const data: InlineDbData = {
    properties: [projTitre],
    rows: [{ id: 'r-alpha', cells: { [projTitre.id]: 'Alpha' } }],
    views: [{ id: 'projets', name: 'Vue', type: 'table', filters: [], sorts: [] }],
  };

  function noteContent(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'avant' }] },
        {
          type: 'inlineDatabase',
          attrs: { title: 'Projets', view: 'table', groupBy: '', data: serializeDbData(data) },
        },
        {
          type: 'inlineDatabase',
          attrs: { dbId: 'db-autre', title: 'Autre', data: serializeDbData(data) },
        },
        ...(extra.tail ? [extra.tail] : []),
      ],
    });
  }

  it('ajoute la ligne au bon bloc, en fin de base, et laisse le reste intact', () => {
    const created = newRow([projTitre], { [projTitre.id]: 'Dune' });
    const next = appendRowToNoteContent(noteContent(), PROJETS, created);
    expect(next).not.toBeNull();
    const index = collectInlineDbs([{ id: 'n1', title: 'Note', content: next as string }]);
    const cible = index.get(PROJETS);
    expect(cible?.rows.map((r) => r.id)).toEqual(['r-alpha', created.id]);
    expect(cible?.rows[1].cells[projTitre.id]).toBe('Dune');
    // Le bloc voisin n'a pas bougé d'un octet
    expect(index.get('db-autre')?.rows).toHaveLength(1);
    // Et l'identité de la base visée n'a pas changé au passage
    expect([...index.keys()]).toContain(PROJETS);
  });

  it('garde les champs qu’un client plus récent aurait ajoutés au bloc', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'inlineDatabase',
          attrs: {
            dbId: 'db-x',
            title: 'X',
            data: JSON.stringify({ ...data, futur: { garde: true } }),
          },
        },
      ],
    };
    const next = appendRowToNoteContent(JSON.stringify(doc), 'db-x', newRow([projTitre]));
    expect(next).not.toBeNull();
    const parsed = JSON.parse(next as string);
    const raw = JSON.parse(parsed.content[0].attrs.data);
    expect(raw.futur).toEqual({ garde: true });
    expect(raw.rows).toHaveLength(2);
    // Les vues enregistrées survivent aussi (le JSON est modifié au plus près)
    expect(parseDbData(parsed.content[0].attrs.data).views).toHaveLength(1);
  });

  it('pose la colonne miroir dans la base visée, et une seule fois', () => {
    const miroir: DbProperty = {
      id: 'p-miroir',
      name: 'Tâches',
      type: 'relation',
      direction: 'in',
      targetDbId: TACHES,
      sourcePropertyId: tacheProjet.id,
    };
    const next = appendPropertyToNoteContent(noteContent(), PROJETS, miroir);
    expect(next).not.toBeNull();
    const index = collectInlineDbs([{ id: 'n1', title: 'Note', content: next as string }]);
    expect(index.get(PROJETS)?.properties.map((p) => p.id)).toEqual([projTitre.id, miroir.id]);
    const posée = index.get(PROJETS)?.properties[1];
    expect(posée?.direction).toBe('in');
    expect(posée?.sourcePropertyId).toBe(tacheProjet.id);
    // La colonne posée ne stocke RIEN : aucune cellule n'apparaît sur les lignes
    expect(index.get(PROJETS)?.rows.every((r) => !(miroir.id in r.cells))).toBe(true);
    // Rejouer le même geste ne pose pas de doublon
    expect(appendPropertyToNoteContent(next as string, PROJETS, miroir)).toBeNull();
  });

  it('une base copiée garde son miroir cohérent : la relation suit la copie', () => {
    // Une note dupliquée re-frappe l'identité de ses bases ; le rétrolien vise
    // la base source par `targetDbId`, qui est remappé comme n'importe quelle
    // autre cible — les deux côtés restent d'accord dans la copie.
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'inlineDatabase',
          attrs: { dbId: TACHES, data: serializeDbData({ properties: tacheProps, rows: [] }) },
        },
        {
          type: 'inlineDatabase',
          attrs: {
            dbId: PROJETS,
            data: serializeDbData({ properties: [projTitre, projRetro], rows: [] }),
          },
        },
      ],
    });
    const copie = restampCopiedDbIds(doc);
    const index = collectInlineDbs([{ id: 'n-copie', title: 'Copie', content: copie }]);
    const ids = [...index.keys()];
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain(PROJETS);
    const retro = [...index.values()]
      .flatMap((e) => e.properties)
      .find((p) => p.direction === 'in');
    expect(retro?.targetDbId).toBe(ids[0]);
    expect(retro?.sourcePropertyId).toBe(tacheProjet.id);
  });

  it('renonce — sans rien casser — quand l’écriture n’est pas sûre', () => {
    const row = newRow([projTitre]);
    // Base absente de cette note
    expect(appendRowToNoteContent(noteContent(), 'db-inconnue', row)).toBeNull();
    // Contenu illisible, contenu sans bloc base, identité vide
    expect(appendRowToNoteContent('{"type":"doc"', PROJETS, row)).toBeNull();
    expect(
      appendRowToNoteContent(JSON.stringify({ type: 'doc', content: [] }), PROJETS, row)
    ).toBeNull();
    expect(appendRowToNoteContent(noteContent(), '', row)).toBeNull();
    // Données du bloc abîmées : on n'invente pas une base neuve par-dessus
    const cassé = JSON.stringify({
      type: 'doc',
      content: [{ type: 'inlineDatabase', attrs: { dbId: 'db-x', data: '{oups' } }],
    });
    expect(appendRowToNoteContent(cassé, 'db-x', row)).toBeNull();
  });
});
