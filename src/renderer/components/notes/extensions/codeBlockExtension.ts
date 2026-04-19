/**
 * Enhanced Code Block Extension — Filarr Notes
 *
 * Extends CodeBlockLowlight with a custom React NodeView that provides:
 * - Language selector dropdown
 * - Copy-to-clipboard button
 * - Better visual styling
 */

import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { CodeBlockNodeView } from './CodeBlockNodeView';

export const EnhancedCodeBlockExtension = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView);
  },
});
