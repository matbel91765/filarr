/**
 * POSER UN THÈME NE DOIT JAMAIS LAISSER DE RESTES.
 *
 * Les jetons d'un thème composé sont écrits en STYLE EN LIGNE sur `:root`, ce
 * qui est nécessaire : c'est le seul moyen de battre les onze blocs
 * `[data-theme='…']` de la feuille de style sans en écrire un douzième.
 *
 * Mais un style en ligne bat aussi le thème SUIVANT. Sans retrait explicite,
 * choisir « Minuit » après un thème composé changerait l'attribut `data-theme`
 * sans rien changer à l'écran — et le symptôme, « mon ancien thème ne part
 * pas », n'oriente vers aucune cause.
 *
 * Il n'y a pas de jsdom dans cette configuration (environnement `node`, choisi
 * pour avoir une vraie WebCrypto). On pose donc un document minimal : ce qu'on
 * éprouve ici n'est pas le navigateur, c'est la COMPTABILITÉ des propriétés
 * posées et retirées.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../core/profileStorage', () => {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

import * as profileStorage from '../../core/profileStorage';
import {
  applyCustomTheme,
  clearCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  unapplyCustomTheme,
} from '../customThemeStore';
import { deriveThemeTokens } from '../customTheme';

// ==================== Un document minimal ====================

interface FakeRoot {
  props: Map<string, string>;
  attrs: Map<string, string>;
}

interface FakeNode {
  id: string;
  className: string;
  props: Map<string, string>;
}

let root: FakeRoot;
/** Ce qui a été ajouté au corps de page — les couches de décor. */
let body: FakeNode[];
/** Les écouteurs posés sur la fenêtre, par type. Sert à prouver qu'ils partent. */
let listeners: Map<string, number>;

function installDocument(): void {
  root = { props: new Map(), attrs: new Map() };
  body = [];
  listeners = new Map();

  /**
   * Une fenêtre minimale.
   *
   * Elle n'est pas là pour faire passer le test : elle porte la garde de FUITE.
   * Un décor qui suit le curseur pose un écouteur de pointeur, et un thème
   * changé dix fois dans une session ne doit pas laisser dix écouteurs
   * derrière lui — le genre de fuite qui ne se voit qu'après une heure, quand
   * tout est devenu lent sans raison apparente.
   */
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string) => void listeners.set(type, (listeners.get(type) ?? 0) + 1),
    removeEventListener: (type: string) =>
      void listeners.set(type, Math.max(0, (listeners.get(type) ?? 0) - 1)),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setTimeout: () => 1,
    clearTimeout: () => {},
    innerWidth: 1280,
    innerHeight: 800,
  };

  const element = {
    style: {
      setProperty: (name: string, value: string) => void root.props.set(name, value),
      removeProperty: (name: string) => void root.props.delete(name),
    },
    setAttribute: (name: string, value: string) => void root.attrs.set(name, value),
    removeAttribute: (name: string) => void root.attrs.delete(name),
  };

  (globalThis as Record<string, unknown>).document = {
    documentElement: element,
    getElementById: () => null,
    createElement: () => {
      const node: FakeNode & { style: unknown; setAttribute: () => void; remove: () => void } = {
        id: '',
        className: '',
        props: new Map<string, string>(),
        style: {
          setProperty: (name: string, value: string) => void node.props.set(name, value),
        },
        setAttribute: () => {},
        remove: () => {
          const at = body.indexOf(node);
          if (at >= 0) body.splice(at, 1);
        },
      };
      return node;
    },
    body: {
      appendChild: (node: FakeNode) => void body.push(node),
      insertBefore: (node: FakeNode) => void body.unshift(node),
      firstChild: null,
    },
  };
}

beforeEach(installDocument);
afterEach(() => {
  unapplyCustomTheme();
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

// ==================== 1. Ce qui est posé ====================

describe('applyCustomTheme — tous les jetons, et l’attribut', () => {
  it('écrit exactement ce que la dérivation produit', () => {
    const spec = { ground: '#101418', accent: '#e2a03f' };
    applyCustomTheme(spec);

    const expected = deriveThemeTokens(spec);
    expect(Object.fromEntries(root.props)).toEqual(expected);
    expect(root.attrs.get('data-theme')).toBe('custom');
  });

  it('une entrée invalide ne pose pas de propriété vide', () => {
    // Un thème reçu ou abîmé retombe champ par champ ; ce qui est écrit reste
    // une couleur valide, jamais un `undefined` que le navigateur accepterait
    // en silence en laissant l'élément hériter de sa couleur précédente.
    applyCustomTheme({ ground: 'pas une couleur', accent: '' });
    for (const [name, value] of root.props) {
      expect(value, name).toMatch(/^(#[0-9a-f]{6}|rgba\()/);
    }
  });
});

// ==================== 2. Ce qui est retiré ====================

describe('unapplyCustomTheme — LE PIÈGE DU STYLE EN LIGNE', () => {
  it('retire toutes les propriétés posées', () => {
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f' });
    expect(root.props.size).toBeGreaterThan(30);

    unapplyCustomTheme();
    expect(root.props.size).toBe(0);
  });

  it('poser un SECOND thème ne laisse rien du premier', () => {
    // Sans le retrait préalable, deux thèmes successifs se superposeraient et
    // le second n'écraserait que les jetons qu'il partage avec le premier.
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f' });
    applyCustomTheme({ ground: '#fffdf7', accent: '#2f5d50' });

    expect(Object.fromEntries(root.props)).toEqual(
      deriveThemeTokens({ ground: '#fffdf7', accent: '#2f5d50' })
    );
  });

  it('LA GARDE : on retire ce qu’on a POSÉ, pas une liste écrite ici', () => {
    // Un thème composé sur une version plus récente peut poser un jeton que
    // cette version ne connaît pas. Retirer « la liste d'aujourd'hui »
    // laisserait ce jeton collé sur `:root` pour le reste de la session — un
    // reste invisible, qui teindrait tous les thèmes suivants.
    //
    // On simule le cas en glissant une propriété étrangère dans le document
    // APRÈS l'application : elle n'a pas été posée par nous, elle doit donc
    // survivre. Et tout ce que nous avons posé doit partir, sans exception.
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f' });
    root.props.set('--color-venu-d-ailleurs', '#123456');

    unapplyCustomTheme();

    expect([...root.props.keys()]).toEqual(['--color-venu-d-ailleurs']);
  });

  it('LA GARDE DU DÉCOR INVISIBLE : un décor pose `data-backdrop` sur la racine', () => {
    /**
     * ── LE BUG QUE CE TEST EXISTE POUR NE PLUS JAMAIS LAISSER PASSER ─────────
     *
     * La première version posait bien la couche d'image, avec la bonne image,
     * au bon endroit — et elle était STRICTEMENT invisible.
     *
     * `.layout` peint `background-color: var(--color-background)` sur toute la
     * page : un mur opaque par-dessus le décor. Le seul moyen de le percer est
     * la règle `[data-backdrop='on'] .layout { background: transparent }`, donc
     * ce marqueur EST le décor. Sans lui, tout le reste est décoratif.
     *
     * Le dépôt donnait pourtant la réponse : quatre thèmes livrés portent déjà
     * `#root { background: transparent }` sous un commentaire qui l'explique.
     */
    applyCustomTheme({
      ground: '#101418',
      accent: '#e2a03f',
      backdrop: { image: 'data:image/gif;base64,AAAA', opacity: 1, blur: 0 },
    });
    expect(root.attrs.get('data-backdrop')).toBe('on');
    expect(body.length).toBe(1);

    unapplyCustomTheme();
    expect(root.attrs.has('data-backdrop')).toBe(false);
    expect(body.length).toBe(0);
  });

  it('un décor VIVANT seul suffit à poser le marqueur', () => {
    // Une lueur qui suit le curseur n'a pas d'image, et elle a exactement le
    // même mur opaque devant elle.
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f', living: 'glow' });
    expect(root.attrs.get('data-backdrop')).toBe('on');
    unapplyCustomTheme();
    expect(root.attrs.has('data-backdrop')).toBe(false);
  });

  it('LA GARDE DE FUITE : l’écouteur de pointeur est retiré avec le décor', () => {
    // Dix changements de thème dans une session ne doivent pas laisser dix
    // écouteurs de `pointermove`, chacun réveillant une image d'animation.
    for (let round = 0; round < 5; round += 1) {
      applyCustomTheme({ ground: '#101418', accent: '#e2a03f', living: 'glow' });
    }
    expect(listeners.get('pointermove')).toBe(1);

    unapplyCustomTheme();
    expect(listeners.get('pointermove')).toBe(0);
  });

  it('un décor qui ne suit RIEN ne pose pas d’écouteur', () => {
    // L'aurore vit d'une animation CSS et ne lit jamais le pointeur : lui
    // poser un écouteur ferait tourner une boucle que personne ne regarde.
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f', living: 'aurora' });
    expect(listeners.get('pointermove') ?? 0).toBe(0);
  });

  it('sans décor, AUCUN marqueur — la page garde son fond', () => {
    // Poser `data-backdrop` en permanence rendrait `.layout` transparent pour
    // tous les thèmes composés, y compris ceux qui n'ont pas de décor : la page
    // retomberait alors sur le fond du `body`, et le moindre écart entre les
    // deux se verrait comme un défaut d'affichage.
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f' });
    expect(root.attrs.has('data-backdrop')).toBe(false);
    expect(body.length).toBe(0);
  });

  it('une opacité de zéro ne pose pas de couche d’image', () => {
    // Éteindre le décor sans le supprimer est un geste légitime ; peindre une
    // couche invisible coûterait une composition par image pour rien.
    applyCustomTheme({
      ground: '#101418',
      accent: '#e2a03f',
      backdrop: { image: 'data:image/gif;base64,AAAA', opacity: 0, blur: 0 },
    });
    expect(body.length).toBe(0);
  });

  it('retirer deux fois de suite ne lève pas', () => {
    applyCustomTheme({ ground: '#101418', accent: '#e2a03f' });
    unapplyCustomTheme();
    expect(() => unapplyCustomTheme()).not.toThrow();
  });
});

// ==================== 3. Ce qui est retenu ====================

describe('le thème composé survit au redémarrage', () => {
  it('ce qu’on enregistre est ce qu’on relit', () => {
    const spec = {
      ground: '#1b1b2f',
      accent: '#f4a261',
      text: '#f6f1e7',
      backdrop: null,
      living: 'aurora' as const,
    };
    expect(saveCustomTheme(spec)).toBe(true);
    expect(loadCustomTheme()).toEqual(spec);
  });

  it('rien d’enregistré ⇒ rien à relire', () => {
    clearCustomTheme();
    expect(loadCustomTheme()).toBeNull();
  });

  it('un enregistrement ABÎMÉ est traité comme une absence', () => {
    // Mieux vaut ouvrir sur le thème par défaut que sur un écran à moitié
    // coloré, dont l'utilisateur ne saurait pas quoi faire.
    saveCustomTheme({ ground: '#1b1b2f', accent: '#f4a261' });
    // ⚠ Le stockage bouchonné est importé EN HAUT et non par un `require` :
    // ces suites tournent en ESM natif, où `require` n'existe pas.
    profileStorage.setItem('filarr.theme.custom', '{ pas du json');
    expect(loadCustomTheme()).toBeNull();
  });
});
