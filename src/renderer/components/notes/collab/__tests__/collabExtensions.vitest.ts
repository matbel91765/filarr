/**
 * Montage TipTap : rien sans session, les deux extensions Yjs avec, et
 * l'historique du StarterKit coupé dès qu'Yjs est là.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { buildCollabExtensions, starterKitOptions } from '../collabExtensions';

function makeSession() {
  const doc = new Y.Doc();
  return { fragment: doc.getXmlFragment('content'), awareness: new Awareness(doc) };
}

describe('buildCollabExtensions', () => {
  it('ne monte rien quand aucune session n’existe', () => {
    expect(buildCollabExtensions(null)).toEqual([]);
  });

  it('monte Collaboration et CollaborationCaret quand une session existe', () => {
    const { fragment, awareness } = makeSession();
    const extensions = buildCollabExtensions({
      fragment,
      awareness,
      user: { name: 'Bureau', color: '#2563eb' },
    });

    expect(extensions.map((e) => e.name)).toEqual(['collaboration', 'collaborationCaret']);
  });

  it('lie Collaboration au fragment de la session', () => {
    const { fragment, awareness } = makeSession();
    const [collaboration] = buildCollabExtensions({
      fragment,
      awareness,
      user: { name: 'Bureau', color: '#2563eb' },
    });

    expect((collaboration.options as { fragment: unknown }).fragment).toBe(fragment);
  });

  it('passe l’awareness et l’identité au caret', () => {
    const { fragment, awareness } = makeSession();
    const [, caret] = buildCollabExtensions({
      fragment,
      awareness,
      user: { name: 'Web', color: '#059669' },
    });
    const options = caret.options as {
      provider: { awareness: unknown };
      user: { name: string; color: string };
    };

    expect(options.provider.awareness).toBe(awareness);
    expect(options.user).toEqual({ name: 'Web', color: '#059669' });
  });
});

describe('starterKitOptions', () => {
  it('laisse l’historique du StarterKit intact hors session', () => {
    const options = starterKitOptions(false);
    expect(options).not.toHaveProperty('undoRedo');
    expect(options.codeBlock).toBe(false);
    expect(options.link).toBe(false);
    expect(options.heading).toEqual({ levels: [1, 2, 3, 4] });
  });

  it('coupe l’historique du StarterKit en session — Yjs fournit le sien', () => {
    expect(starterKitOptions(true).undoRedo).toBe(false);
  });

  it('conserve la configuration existante quand il coupe l’historique', () => {
    const options = starterKitOptions(true);
    expect(options.codeBlock).toBe(false);
    expect(options.link).toBe(false);
    expect(options.heading).toEqual({ levels: [1, 2, 3, 4] });
  });
});
