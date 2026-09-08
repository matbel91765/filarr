import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * LE DÉCOR S'ARRÊTE QUAND PERSONNE NE LE REGARDE — garde sur le source.
 *
 * Une animation, n'importe laquelle, tient la boucle d'affichage réveillée et
 * fait recomposer l'écran entier à la fréquence de la dalle tant que la fenêtre
 * est visible (mesuré sur mobile : ~55 points d'un cœur de plancher, sans un
 * pixel de flou). Le thème « minuit » se mettait en pause fenêtre inactive ;
 * l'aurore non. Ce test lit les deux feuilles et App.tsx, et exige pour CHAQUE
 * animation sans fin du décor les trois réponses : pause quand la fenêtre est
 * inactive ou masquée (`.app-blurred`), arrêt quand « Fond animé » est décoché
 * (`[data-animated-bg='off']`), arrêt quand le système demande moins de
 * mouvement (`prefers-reduced-motion`). Une animation ajoutée sans l'une des
 * trois rendra ce test rouge.
 */

const css = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const app = (): string => readFileSync(join(__dirname, '..', '..', '..', 'App.tsx'), 'utf8');

/** Le bloc d'un sélecteur : ce qu'il y a entre `selecteur {` et la `}` suivante. */
function bloc(source: string, selecteur: string): string {
  const i = source.indexOf(selecteur);
  if (i < 0) return '';
  const debut = source.indexOf('{', i);
  const fin = source.indexOf('}', debut);
  return source.slice(debut, fin);
}

describe('backdrop.css — l’aurore', () => {
  const s = css('backdrop.css');

  it('anime sans fin (le test garde une réalité, pas une hypothèse)', () => {
    expect(s).toMatch(/\.filarr-living--aurora::before\s*\{[^}]*infinite/);
    expect(s).toMatch(/\.filarr-living--aurora::after\s*\{[^}]*infinite/);
  });

  it('se met en PAUSE fenêtre inactive ou masquée — pause, pas arrêt : le ciel reprend où il était', () => {
    const regle = bloc(s, '.app-blurred .filarr-living--aurora::before');
    expect(regle).toContain('animation-play-state: paused');
    expect(s).toMatch(/\.app-blurred \.filarr-living--aurora::after/);
  });

  it('s’arrête quand « Fond animé » est décoché', () => {
    expect(bloc(s, "[data-animated-bg='off'] .filarr-living--aurora::before")).toContain(
      'animation: none'
    );
  });

  it('s’arrête quand le système demande moins de mouvement', () => {
    const media = s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(media).toMatch(/\.filarr-living--aurora::before[\s\S]*?animation: none/);
  });
});

describe('global.css — le thème minuit', () => {
  const s = css('global.css');
  const noeuds = [
    "[data-theme='minuit'] .layout::before",
    "[data-theme='minuit'] .layout::after",
    "[data-theme='minuit'] .layout__body::before",
  ];

  it('anime sans fin ses trois nœuds', () => {
    expect((s.match(/minuit-(twinkle-a|twinkle-b|breathe) [^;]*infinite/g) ?? []).length).toBe(3);
  });

  it('se met en PAUSE fenêtre inactive ou masquée', () => {
    for (const n of noeuds) expect(s, n).toContain(`.app-blurred${n}`);
    expect(bloc(s, ".app-blurred[data-theme='minuit'] .layout::before")).toContain(
      'animation-play-state: paused'
    );
  });

  it('s’arrête quand « Fond animé » est décoché', () => {
    for (const n of noeuds) expect(s, n).toContain(`[data-animated-bg='off']${n}`);
  });

  it('s’arrête quand le système demande moins de mouvement — ce qui manquait', () => {
    const media = s.slice(s.indexOf('@media (prefers-reduced-motion: reduce)'));
    for (const n of noeuds) expect(media, n).toContain(n);
    expect(media).toMatch(/\[data-theme='minuit'\] \.layout::before[\s\S]*?animation: none/);
  });
});

describe('App.tsx — qui pose `.app-blurred`', () => {
  it('masqué compte comme inactif : `document.hidden` ET le focus, sur `visibilitychange` aussi', () => {
    const s = app();
    expect(s).toContain("document.addEventListener('visibilitychange', syncBlurred)");
    expect(s).toMatch(/document\.hidden \|\| !document\.hasFocus\(\)/);
    // Et on ne fuit pas l'écouteur au démontage.
    expect(s).toContain("document.removeEventListener('visibilitychange', syncBlurred)");
  });
});
