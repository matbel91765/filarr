/**
 * VersionRender
 *
 * Read-only TipTap render of a single note version. Used by Scrapbook
 * and Scrubber to show what the note looked like at a snapshot.
 *
 * Implementation notes:
 *   - We mount the actual TipTap editor inside an inner component keyed
 *     on `content`. This forces a fresh editor instance whenever the
 *     caller swaps versions, sidestepping the class of bugs where
 *     `setContent` on a reused editor doesn't repaint (observed with
 *     TipTap v3 when content contains custom node types).
 *   - The extension list mirrors NoteEditor via `buildReadOnlyExtensions()`.
 *     If that set doesn't cover a node used in the stored JSON, the
 *     fallback banner kicks in with the plain-text rendering.
 */

import React, { useEffect, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { buildReadOnlyExtensions } from './readOnlyExtensions';

interface VersionRenderProps {
  content: string;
  className?: string;
  plainTextFallback?: string;
}

function isEffectivelyEmpty(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return true;
  const doc = parsed as { type?: string; content?: unknown[] };
  if (doc.type !== 'doc') return true;
  if (!Array.isArray(doc.content) || doc.content.length === 0) return true;

  const stack: unknown[] = [...doc.content];
  while (stack.length) {
    const node = stack.pop() as { type?: string; text?: string; content?: unknown[] } | null;
    if (!node || typeof node !== 'object') continue;
    if (typeof node.text === 'string' && node.text.length > 0) return false;
    if (
      node.type &&
      ['image', 'horizontalRule', 'table', 'codeBlock', 'enhancedCodeBlock'].includes(node.type)
    ) {
      return false;
    }
    if (Array.isArray(node.content)) stack.push(...node.content);
  }
  return true;
}

/**
 * Inner component with the actual editor. Kept separate from the
 * public component so a `key` prop swap can force a full remount.
 */
const VersionRenderEditor: React.FC<{ doc: unknown; className?: string }> = ({
  doc,
  className,
}) => {
  const editor = useEditor({
    extensions: buildReadOnlyExtensions(),
    content: doc as any,
    editable: false,
  });

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
};

export const VersionRender: React.FC<VersionRenderProps> = React.memo(function VersionRender({
  content,
  className,
  plainTextFallback,
}) {
  const parsed = useMemo<unknown>(() => {
    if (!content) return null;
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [content]);

  const empty = isEffectivelyEmpty(parsed);
  const fallback = plainTextFallback?.trim() ?? '';

  if (empty && fallback.length > 0) {
    return (
      <div className={className}>
        <div className="version-render__fallback-banner">
          Rendu indisponible — affichage du texte brut
        </div>
        <pre className="version-render__fallback">{plainTextFallback}</pre>
      </div>
    );
  }

  if (empty) {
    return (
      <div className={className}>
        <div className="version-render__fallback-banner">Aucun contenu à afficher</div>
      </div>
    );
  }

  // `key={content}` forces React to unmount the previous editor and
  // mount a fresh one whenever content changes. This is the nuclear
  // option but it's the only way to guarantee a clean render when
  // the content schema can contain any of the 20+ custom nodes.
  return <VersionRenderEditor key={content} doc={parsed} className={className} />;
});

export default VersionRender;
