/**
 * Fabriques de blocs pour les modèles de notes.
 *
 * Source UNIQUE : les modèles généraux et le pack projet écrivent le même JSON,
 * avec les mêmes noms de nœuds. C'est ce qui évite la divergence qui a déjà
 * coûté un bloc entier (un `toggle` écrit à la place de `toggleBlock` n'échoue
 * pas — ProseMirror le JETTE au parse, en silence).
 *
 * Les libellés passent par i18n à la CONSTRUCTION, avec repli anglais.
 */

import i18n from '../../i18n/config';

export type Json = Record<string, unknown>;

export const text = (value: string): Json => ({ type: 'text', text: value });

export const p = (value = ''): Json => ({
  type: 'paragraph',
  ...(value ? { content: [text(value)] } : {}),
});

export const boldP = (bold: string, rest = ''): Json => ({
  type: 'paragraph',
  content: [{ type: 'text', marks: [{ type: 'bold' }], text: bold }, ...(rest ? [text(rest)] : [])],
});

export const h = (level: number, value: string): Json => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});

export const bullets = (...items: string[]): Json => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [p(item)] })),
});

export const numbered = (...items: string[]): Json => ({
  type: 'orderedList',
  // `type: null` fait partie des attributs d'office du schema : l'omettre ne
  // casse rien, mais fait diverger le document ecrit ici de celui que rend
  // l'editeur — et c'est cette divergence-la qui masque les vraies pertes.
  attrs: { start: 1, type: null },
  content: items.map((item) => ({ type: 'listItem', content: [p(item)] })),
});

export const tasks = (...items: string[]): Json => ({
  type: 'taskList',
  content: items.map((item) => ({
    type: 'taskItem',
    attrs: { checked: false },
    content: [p(item)],
  })),
});

export const quote = (value: string): Json => ({
  type: 'blockquote',
  content: [p(value)],
});

export const callout = (type: string, title: string, body: string): Json => ({
  type: 'callout',
  attrs: { type, collapsed: false, title },
  content: [p(body)],
});

export const columns = (...cols: Json[][]): Json => ({
  type: 'columns',
  attrs: { count: cols.length },
  content: cols.map((blocks) => ({ type: 'column', content: blocks })),
});

/** `toggleBlock`, jamais `toggle` : c'est le nom que porte le schéma. */
export const toggle = (summary: string, ...body: Json[]): Json => ({
  type: 'toggleBlock',
  attrs: { open: false },
  content: [
    { type: 'toggleSummary', content: [text(summary)] },
    ...(body.length > 0 ? body : [p()]),
  ],
});

export const divider = (): Json => ({ type: 'horizontalRule' });

/**
 * Tableau à en-tête.
 *
 * Toutes les rangées sont ramenées à la largeur de l'en-tête : une rangée plus
 * courte rend le nœud invalide, et ProseMirror rejette alors le tableau ENTIER.
 */
export const table = (header: string[], ...rows: string[][]): Json => {
  const cell = (kind: 'tableHeader' | 'tableCell', value: string): Json => ({
    type: kind,
    attrs: { colspan: 1, rowspan: 1, colwidth: null },
    content: [p(value)],
  });
  const width = header.length;
  return {
    type: 'table',
    content: [
      { type: 'tableRow', content: header.map((value) => cell('tableHeader', value)) },
      ...rows.map((row) => ({
        type: 'tableRow',
        content: Array.from({ length: width }, (_, i) => cell('tableCell', row[i] ?? '')),
      })),
    ],
  };
};

export const doc = (...content: Json[]): string => JSON.stringify({ type: 'doc', content });

/** Résolveur i18n d'un espace de noms de modèles. */
export function makeT(namespace: string) {
  return (key: string, fallback: string): string =>
    i18n.t(`${namespace}.${key}`, { defaultValue: fallback });
}

/** Horodatage commun : un modèle intégré n'a pas de date de création propre. */
export const BUILT_IN_STAMP = {
  isBuiltIn: true as const,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

/** Variable `{{title}}`, présente dans presque tous les modèles. */
export const titleVar = (label: string, fallback: string) => [
  { name: 'title', label, type: 'text' as const, defaultValue: fallback },
];
