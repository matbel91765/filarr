/**
 * Rendu de la barre de présence, depuis un état d'awareness simulé jusqu'au
 * balisage. Pas de JSX : la suite vitest est en `.ts` et tourne sans DOM, on
 * rend donc en balisage statique.
 */

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// i18next n'est pas initialisé hors application : on rend le repli fourni au
// composant, en interpolant comme le ferait i18next.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, string>) =>
      vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => vars[name] ?? '') : fallback,
  }),
}));

const { CollabPresenceBar } = await import('../CollabPresenceBar');
const { derivePresence } = await import('../collabPresence');
type AwarenessUserState = import('../collabTypes').AwarenessUserState;

/** Compte les pastilles sans confondre avec leur conteneur `__avatars`. */
function countAvatars(html: string): number {
  return (html.match(/class="collab-presence__avatar[" ]/g) ?? []).length;
}

function renderFromAwareness(
  entries: Array<[number, AwarenessUserState | undefined]>,
  localClientId: number,
  status: 'connecting' | 'connected' | 'synced' | 'offline' = 'synced'
) {
  const participants = derivePresence(new Map(entries), localClientId, 'Filarr');
  return renderToStaticMarkup(createElement(CollabPresenceBar, { participants, status }));
}

describe('CollabPresenceBar', () => {
  it('rend une pastille par participant, avec sa couleur et son initiale', () => {
    const html = renderFromAwareness(
      [
        [1, { user: { name: 'Mathis · Bureau', color: '#2563eb' } }],
        [2, { user: { name: 'Mathis · Web', color: '#059669' } }],
      ],
      1
    );

    expect(countAvatars(html)).toBe(2);
    expect(html).toContain('background-color:#2563eb');
    expect(html).toContain('background-color:#059669');
    expect(html).toContain('>M<');
  });

  it('marque l’appareil courant et nomme les autres au survol', () => {
    const html = renderFromAwareness(
      [
        [1, { user: { name: 'Bureau', color: '#2563eb' } }],
        [2, { user: { name: 'Web', color: '#059669' } }],
      ],
      1
    );

    expect(html).toContain('collab-presence__avatar--self');
    expect(html).toContain('title="Bureau (cet appareil)"');
    expect(html).toContain('title="Web"');
  });

  it('replie les participants au-delà de quatre', () => {
    const entries = [1, 2, 3, 4, 5, 6].map(
      (id) =>
        [id, { user: { name: `Appareil ${id}`, color: '#2563eb' } }] as [number, AwarenessUserState]
    );
    const html = renderFromAwareness(entries, 1);

    expect(countAvatars(html)).toBe(5); // 4 pastilles + le repli
    expect(html).toContain('collab-presence__avatar--overflow');
    expect(html).toContain('+2');
    expect(html).toContain('title="Appareil 5, Appareil 6"');
  });

  it('affiche l’état du canal et l’expose en attribut', () => {
    // « en direct » n'est vrai qu'une fois le rejeu du relais terminé : un
    // canal seulement ouvert est encore en train de rattraper la salle.
    expect(renderFromAwareness([[1, undefined]], 1, 'synced')).toContain('en direct');
    expect(renderFromAwareness([[1, undefined]], 1, 'connected')).toContain('synchronisation');
    expect(renderFromAwareness([[1, undefined]], 1, 'connected')).not.toContain('en direct');
    expect(renderFromAwareness([[1, undefined]], 1, 'offline')).toContain('hors ligne');

    const connecting = renderFromAwareness([[1, undefined]], 1, 'connecting');
    expect(connecting).toContain('data-status="connecting"');
    expect(connecting).toContain('connexion');
  });

  it('reste rendable quand personne n’est encore là', () => {
    const html = renderFromAwareness([], 1, 'connecting');
    expect(html).toContain('collab-presence');
    expect(countAvatars(html)).toBe(0);
  });

  it('porte un libellé de groupe pour les lecteurs d’écran', () => {
    const html = renderFromAwareness([[1, undefined]], 1);
    expect(html).toContain('aria-label="Appareils connectés à cette note"');
  });
});
