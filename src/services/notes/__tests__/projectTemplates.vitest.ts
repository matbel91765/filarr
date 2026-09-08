/**
 * Un modèle est du JSON écrit à la main : s'il ne colle pas au schéma,
 * ProseMirror n'échoue pas — il JETTE le nœud fautif en silence. L'utilisateur
 * choisit « Projet », obtient une note à moitié vide, et rien n'explique
 * pourquoi. Ces tests montent le VRAI schéma de l'éditeur et exigent que
 * chaque modèle s'y recharge à l'identique.
 *
 * Le reste vérifie l'autre piège, invisible lui aussi : une base de données
 * dont les cellules pointeraient sur des propriétés ou des options qui
 * n'existent pas — colonnes vides, kanban sans colonnes.
 */

import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Node as PMNode } from '@tiptap/pm/model';
import { CalloutExtension } from '../../../renderer/components/notes/extensions/calloutExtension';
import {
  ColumnExtension,
  ColumnsExtension,
} from '../../../renderer/components/notes/extensions/columnsExtension';
import { InlineDatabaseExtension } from '../../../renderer/components/notes/extensions/inlineDatabaseExtension';
import {
  ToggleExtension,
  ToggleSummaryExtension,
} from '../../../renderer/components/notes/extensions/toggleExtension';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { getProjectTemplates, projectBoardBlocks } from '../projectTemplates';
import { getGeneralTemplates } from '../generalTemplates';
import { getBuiltInTemplates } from '../noteService';

const schema = getSchema([
  StarterKit,
  TaskList,
  TaskItem,
  CalloutExtension,
  ColumnsExtension,
  ColumnExtension,
  InlineDatabaseExtension,
  ToggleExtension,
  ToggleSummaryExtension,
  Table,
  TableRow,
  TableCell,
  TableHeader,
]);

/** Tous les nœuds d'un type donné, à n'importe quelle profondeur. */
function nodesOfType(doc: PMNode, type: string): PMNode[] {
  const found: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === type) found.push(node);
  });
  return found;
}

describe('TOUS les modèles intégrés sont valides pour le schéma de l éditeur', () => {
  // Generaux ET projet : les six modeles historiques ont ete entierement
  // refaits avec des encadres, des colonnes et des tableaux, donc avec la meme
  // exposition au piege du nom de noeud (un `toggle` ecrit pour `toggleBlock`
  // ne leve pas — il est JETE au parse).
  for (const template of [...getGeneralTemplates(), ...getProjectTemplates()]) {
    it(`« ${template.id} » se recharge sans perdre un seul nœud`, () => {
      const json = JSON.parse(template.content);
      const doc = PMNode.fromJSON(schema, json);
      expect(() => doc.check()).not.toThrow();
      // Aller-retour : un nœud refusé par le schéma aurait disparu au passage.
      expect(doc.toJSON()).toEqual(json);
      expect(doc.childCount).toBeGreaterThan(1);
    });
  }

  it('le corps inséré par la commande « / » est valide lui aussi', () => {
    const doc = PMNode.fromJSON(schema, { type: 'doc', content: projectBoardBlocks() });
    expect(() => doc.check()).not.toThrow();
    expect(nodesOfType(doc, 'inlineDatabase')).toHaveLength(1);
    expect(nodesOfType(doc, 'columns')).toHaveLength(1);
  });
});

describe('les bases de données des modèles se tiennent', () => {
  const databases = getProjectTemplates().flatMap((template) =>
    nodesOfType(PMNode.fromJSON(schema, JSON.parse(template.content)), 'inlineDatabase').map(
      (node) => ({ id: template.id, attrs: node.attrs })
    )
  );

  it('il y en a au moins une par modèle qui en promet une', () => {
    expect(databases.length).toBeGreaterThanOrEqual(5);
  });

  for (const db of databases) {
    it(`« ${db.id} » : cellules, défauts et regroupement pointent sur du réel`, () => {
      const data = JSON.parse(db.attrs.data as string);
      const propIds = new Set<string>(data.properties.map((prop: { id: string }) => prop.id));
      const optionIds = new Set<string>(
        data.properties.flatMap((prop: { options?: { id: string }[] }) =>
          (prop.options ?? []).map((option) => option.id)
        )
      );

      // Une cellule orpheline n'affiche rien : la donnée est là, la colonne
      // qui la montrerait n'existe pas.
      for (const row of data.rows) {
        for (const key of Object.keys(row.cells)) {
          expect(propIds.has(key)).toBe(true);
        }
      }

      // Un défaut qui ne pointe sur rien fait naître les lignes hors kanban.
      for (const prop of data.properties) {
        if (prop.defaultOptionId) expect(optionIds.has(prop.defaultOptionId)).toBe(true);
        if (prop.type === 'select') expect((prop.options ?? []).length).toBeGreaterThan(0);
      }

      // Chaque valeur de cellule « select » doit être un identifiant d'option.
      const selectIds = new Set<string>(
        data.properties
          .filter((prop: { type: string }) => prop.type === 'select')
          .map((prop: { id: string }) => prop.id)
      );
      for (const row of data.rows) {
        for (const [key, value] of Object.entries(row.cells)) {
          if (selectIds.has(key)) expect(optionIds.has(value as string)).toBe(true);
        }
      }

      // Vue board : sans `groupBy` valide, le kanban n'a aucune colonne.
      const view = data.views[0];
      expect(data.activeViewId).toBe(view.id);
      if (view.type === 'board') {
        expect(propIds.has(view.groupBy)).toBe(true);
        expect(db.attrs.groupBy).toBe(view.groupBy);
      }
    });
  }

  it('deux modèles ne partagent jamais une identité de base', () => {
    const ids = databases.map((db) => db.attrs.dbId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('catalogue', () => {
  it('le pack projet rejoint les modèles intégrés, sans écraser les anciens', () => {
    const ids = getBuiltInTemplates().map((template) => template.id);
    expect(ids).toContain('tpl-meeting');
    expect(ids).toContain('tpl-project-board');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
