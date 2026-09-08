/**
 * ColumnsNodeView — barre d'outils d'un bloc de colonnes.
 *
 * POURQUOI — le bloc n'avait AUCUNE commande : une fois posé, impossible
 * d'ajouter une colonne, d'en retirer une, ni de revenir à du texte normal.
 * La poignée de bloc supprime le bloc entier (avec son contenu), ce qui est
 * la seule issue qui existait, et la plus brutale.
 *
 * La barre n'apparaît qu'au survol / quand le curseur est dedans :
 * `contentEditable={false}` la sort du document, sinon ProseMirror la
 * traiterait comme du texte et la sauvegarderait.
 */

import React from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { MAX_COLUMNS } from './columnOps';

interface ColumnsNodeViewProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
  deleteNode: () => void;
}

export const ColumnsNodeView: React.FC<ColumnsNodeViewProps> = ({
  node,
  editor,
  getPos,
  deleteNode,
}) => {
  const { t } = useTranslation();
  const count = node.childCount;
  const canAdd = count < MAX_COLUMNS;

  // La position est relue à CHAQUE clic : le document a pu bouger depuis le
  // rendu (frappe dans une autre colonne, collaboration en direct).
  const posNow = () => {
    const pos = getPos();
    return typeof pos === 'number' ? pos : null;
  };

  // Rendu d'une version archivée, README de dossier : le document est LU, pas
  // écrit. Des boutons qui modifient n'y ont rien à faire.
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="columns-block">
        <NodeViewContent className={`columns columns--${count}`} />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="columns-block">
      <div className="columns-block__toolbar" contentEditable={false}>
        <button
          type="button"
          className="columns-block__action"
          disabled={!canAdd}
          title={
            canAdd
              ? t('notes.columns.add', { defaultValue: 'Add a column' })
              : t('notes.columns.addMax', { defaultValue: 'Four columns maximum' })
          }
          onClick={() => {
            const pos = posNow();
            if (pos !== null) editor.commands.addColumn(pos);
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{t('notes.columns.add', { defaultValue: 'Add a column' })}</span>
        </button>

        <button
          type="button"
          className="columns-block__action"
          title={t('notes.columns.dissolveHint', {
            defaultValue: 'Remove the layout, keep every block',
          })}
          onClick={() => {
            const pos = posNow();
            if (pos !== null) editor.commands.dissolveColumns(pos);
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span>{t('notes.columns.dissolve', { defaultValue: 'Convert to text' })}</span>
        </button>

        <button
          type="button"
          className="columns-block__action columns-block__action--danger"
          title={t('notes.columns.deleteHint', {
            defaultValue: 'Delete the layout AND everything inside',
          })}
          onClick={() => deleteNode()}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <polyline points="3,6 5,6 21,6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          <span>{t('notes.columns.delete', { defaultValue: 'Delete layout' })}</span>
        </button>
      </div>

      <NodeViewContent className={`columns columns--${count}`} />
    </NodeViewWrapper>
  );
};
