/**
 * L'apparence appartient au profil.
 *
 * La règle éprouvée ici est celle qui manquait à l'ouverture d'un profil : le
 * thème et l'accent viennent de SON stockage, et un profil qui n'a jamais rien
 * choisi n'hérite de rien — surtout pas de celui qu'on vient de quitter. Le
 * thème s'écrivait dans une clé commune au poste (`theme`) et l'accent n'était
 * appliqué qu'à l'ouverture des Réglages : on entrait donc dans un profil
 * habillé par le précédent, ce qui sautait aux yeux au retour du nuage.
 *
 * Les cinq cas couverts sont ceux qui se présentent réellement : un profil
 * restauré qui a ses réglages, un profil neuf qui n'en a pas, l'accent
 * d'origine (qui doit RÉINITIALISER la palette et non laisser celle du profil
 * précédent inscrite sur :root), un blob illisible ou hors nomenclature, et le
 * repli demandé par l'appelant.
 *
 * Environnement vitest `node` : pas de localStorage, pas de window. On en pose
 * de vrais faux AVANT d'importer les modules, car profileStorage lit le
 * pointeur de profil à l'évaluation de son module — même idiome que
 * `services/core/__tests__/profileStorage.vitest.ts`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ==================== Faux localStorage ====================

class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

const store = new MemoryStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = store;
// `isWebPlatform` (donc `defaultThemeName`) interroge window : sans lui, on ne
// prouverait rien sur le défaut de plateforme.
g.window = globalThis;

type ProfileStorage = typeof import('../../core/profileStorage');
type ThemeService = typeof import('../themeService');

const ALICE = 'profile-alice';
const BOB = 'profile-bob';

let ps: ProfileStorage;
let theme: ThemeService;

beforeEach(async () => {
  store.clear();
  vi.resetModules();
  // Même génération de registre pour les deux : themeService lit le pointeur
  // à travers l'instance de profileStorage qu'on pilote ici.
  ps = (await import('../../core/profileStorage')) as ProfileStorage;
  theme = (await import('../themeService')) as ThemeService;
});

/** Écrit le blob de réglages DANS l'espace d'un profil donné. */
function writeSettingsFor(profileId: string, settings: Record<string, unknown>): void {
  const previous = ps.getActiveProfileId();
  ps.setActiveProfile(profileId);
  ps.setItem('filarr-settings', JSON.stringify(settings));
  ps.setActiveProfile(previous);
}

describe('loadProfileAppearance', () => {
  it("prend le thème et l'accent du profil actif", () => {
    writeSettingsFor(ALICE, { theme: 'minuit', primaryColor: '#E11D48' });
    ps.setActiveProfile(ALICE);

    const appearance = theme.loadProfileAppearance(theme.defaultThemeName());

    expect(appearance.theme).toBe('minuit');
    expect(appearance.accentColor).toBe('#E11D48');
    expect(appearance.useSystemTheme).toBe(false);
  });

  it("n'hérite pas du profil précédent quand le profil entrant n'a rien choisi", () => {
    // Alice a tout réglé ; Bob n'a jamais rien touché.
    writeSettingsFor(ALICE, { theme: 'minuit', primaryColor: '#E11D48' });
    ps.setActiveProfile(BOB);

    const appearance = theme.loadProfileAppearance(theme.defaultThemeName());

    // C'EST LE CŒUR DU CORRECTIF : le repli est le défaut de la plateforme,
    // jamais le thème d'Alice, et surtout jamais sa couleur.
    expect(appearance.theme).toBe('light');
    expect(appearance.accentColor).toBeNull();
  });

  it("traite l'accent d'origine comme « aucune couleur propre »", () => {
    // Sans cette équivalence, la palette du profil précédent resterait posée en
    // style inline sur :root — `applyProfileAppearance` ne la réinitialise que
    // sur un accentColor null.
    writeSettingsFor(ALICE, { theme: 'dark', primaryColor: theme.DEFAULT_ACCENT_COLOR });
    ps.setActiveProfile(ALICE);

    expect(theme.loadProfileAppearance(theme.defaultThemeName()).accentColor).toBeNull();
  });

  it('rejette un thème stocké inconnu ou illisible plutôt que de le poser', () => {
    // Un nom qu'aucune version n'a jamais posé : disposition abîmée, réglages
    // recopiés à la main, appareil revenu d'une version future.
    writeSettingsFor(ALICE, { theme: 'aquarelle', primaryColor: '#123456' });
    ps.setActiveProfile(ALICE);
    expect(theme.loadProfileAppearance('papier').theme).toBe('papier');

    store.setItem(`p:${ALICE}:filarr-settings`, '{ pas du json');
    expect(theme.loadProfileAppearance('papier').theme).toBe('papier');
  });

  it('`custom` EST désormais un thème stockable — et son repli est ailleurs', () => {
    // Ce test disait l'inverse, et il avait raison à l'époque : les couleurs
    // d'un thème composé ne vivaient qu'en mémoire (`ui.customTheme`, non
    // persisté), donc le poser au démarrage donnait un `data-theme` sans la
    // moindre couleur derrière.
    //
    // L'atelier de thème a changé cette prémisse : la composition est retenue
    // par profil. `loadProfileAppearance` rend donc « custom » sans discuter —
    // et c'est `applyProfileAppearance` qui, LUI, retombe sur le thème par
    // défaut si la composition a disparu. La garantie n'a pas été perdue, elle
    // a changé d'endroit, et c'est ce que ce test fixe.
    writeSettingsFor(ALICE, { theme: 'custom', primaryColor: '#123456' });
    ps.setActiveProfile(ALICE);
    expect(theme.loadProfileAppearance('papier').theme).toBe('custom');
  });

  it("honore le repli fourni par l'appelant quand rien n'est stocké", () => {
    ps.setActiveProfile('profile-erin');
    expect(theme.loadProfileAppearance('foret').theme).toBe('foret');
  });
});
