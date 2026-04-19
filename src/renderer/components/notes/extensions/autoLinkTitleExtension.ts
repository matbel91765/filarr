/**
 * Auto Link Title Extension — Filarr Notes
 *
 * When pasting a URL, inserts it as a link and asynchronously fetches
 * the page title to replace the link text.
 * Uses Electron IPC to bypass CORS restrictions, with fetch() fallback.
 */

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

const URL_REGEX = /^https?:\/\/[^\s]+$/;

async function fetchPageTitle(url: string): Promise<string | null> {
  try {
    // Try Electron IPC first (bypasses CORS)
    if (window.electron?.ipcRenderer?.invoke) {
      const title = await window.electron.ipcRenderer.invoke('fetchPageTitle', url);
      if (title) return title;
    }
  } catch {
    // IPC not available or failed, fall through
  }

  try {
    // Fallback: direct fetch (may fail due to CORS)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/html' },
    });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

export const AutoLinkTitleExtension = Extension.create({
  name: 'autoLinkTitle',

  addProseMirrorPlugins() {
    const editorRef = this.editor;

    return [
      new Plugin({
        props: {
          handlePaste(view, event) {
            const clipboardText = event.clipboardData?.getData('text/plain')?.trim();
            if (!clipboardText || !URL_REGEX.test(clipboardText)) return false;

            // Don't interfere if there's HTML content being pasted
            const htmlContent = event.clipboardData?.getData('text/html');
            if (htmlContent) return false;

            event.preventDefault();

            const { state } = view;
            const { from, to } = state.selection;

            // If there's selected text, wrap it as a link
            if (from !== to) {
              editorRef.chain().focus().setLink({ href: clipboardText }).run();
              return true;
            }

            // Insert URL as link text, then try to fetch the title
            const linkMark = state.schema.marks.link?.create({ href: clipboardText });
            if (!linkMark) return false;

            const textNode = state.schema.text(clipboardText, [linkMark]);
            const tr = state.tr.replaceSelectionWith(textNode, false);
            view.dispatch(tr);

            // Asynchronously fetch the page title and update the link text
            const insertPos = from;
            const insertEnd = from + clipboardText.length;

            fetchPageTitle(clipboardText).then((title) => {
              if (!title) return;

              // Find the link in the current document state
              const { doc } = view.state;
              let linkFrom = -1;
              let linkTo = -1;
              let linkUrl = '';

              doc.descendants((node, pos): boolean => {
                if (linkFrom >= 0) return false;
                const mark = node.marks.find(
                  (m) => m.type.name === 'link' && m.attrs.href === clipboardText
                );
                if (mark && pos >= insertPos - 5 && pos <= insertEnd + 5) {
                  linkFrom = pos;
                  linkTo = pos + node.nodeSize;
                  linkUrl = mark.attrs.href;
                  return false;
                }
                return true;
              });

              if (linkFrom < 0 || linkFrom >= doc.content.size) return;

              // Replace the URL text with the title, keeping the link mark
              const newLinkMark = view.state.schema.marks.link?.create({ href: linkUrl });
              if (!newLinkMark) return;

              const newTextNode = view.state.schema.text(title, [newLinkMark]);
              const updateTr = view.state.tr.replaceWith(linkFrom, linkTo, newTextNode);
              view.dispatch(updateTr);
            });

            return true;
          },
        },
      }),
    ];
  },
});
