/**
 * ColumnNodeView — le « × » d'une colonne.
 *
 * Retirer UNE colonne était impossible : il fallait supprimer la disposition
 * entière. Le bouton ne détruit rien — le contenu de la colonne rejoint la
 * voisine (l'infobulle le dit, pour que le geste ne surprenne pas). Sur une
 * disposition à deux colonnes, il n'en resterait qu'une : le bloc se dissout
 * alors, tout le contenu revenant dans le fil du document.
 */

import React from 'react';
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/core';

interface ColumnNodeViewProps {
  editor: Editor;
  getPos: () => number | undefined;
}

export const ColumnNodeView: React.FC<ColumnNodeViewProps> = ({ editor, getPos }) => {
  const { t } = useTranslation();

  const removeThisColumn = () => {
    const pos = getPos();
    if (typeof pos !== 'number') return;
    // Position et indice sont relus au clic : le document a pu bouger depuis
    // le rendu, et un indice figé viserait la mauvaise colonne.
    const resolved = editor.state.doc.resolve(pos);
    const parent = resolved.parent;
    if (parent.type.name !== 'columns') return;
    editor.commands.removeColumn(resolved.before(), resolved.index());
  };

  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="column">
        <NodeViewContent className="column__content" />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="column">
      <button
        type="button"
        className="column__remove"
        contentEditable={false}
        title={t('notes.columns.removeThis', {
          defaultValue: 'Remove this column (its content moves to the next one)',
        })}
        aria-label={t('notes.columns.removeThis', {
          defaultValue: 'Remove this column (its content moves to the next one)',
        })}
        onClick={removeThisColumn}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <NodeViewContent className="column__content" />
    </NodeViewWrapper>
  );
};
