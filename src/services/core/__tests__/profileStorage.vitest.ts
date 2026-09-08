/**
 * Isolation par profil des préférences d'affichage.
 *
 * Ce que ces tests protègent : deux profils du même poste ne doivent PAS
 * partager leur chrome (barres, clic fichier, widget d'accueil, fonds animés,
 * cadrages de vue). Un profil de diversion se trahirait autrement sans qu'on
 * ait ouvert un seul fichier.
 *
 * Trois propriétés y sont vérifiées, parce que ce sont les trois qu'on peut
 * casser sans que rien ne compile en rouge :
 *   1. LECTURE DE REPLI — la valeur déjà posée sous l'ancienne clé nue survit
 *      à la migration tant que le profil n'a rien enregistré ;
 *   2. ÉCRITURE PRÉFIXÉE — toute écriture part sous `p:{profil}:` et ne touche
 *      JAMAIS l'ancienne clé, sinon la migration reboucle et le partage revient;
 *   3. PREMIER LANCEMENT — clé absente partout = null, le défaut de l'appelant
 *      s'applique et rien ne jette.
 *
 * L'environnement vitest est `node` : pas de localStorage, pas de window. On
 * en pose de vrais faux AVANT d'importer les modules, car profileStorage lit
 * le pointeur de profil à l'évaluation de son module et uiSlice construit son
 * initialState au même moment — c'est précisément l'ordre qui était cassé.
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
  /** Toutes les clés, pour affirmer qu'une ancienne n'a pas été réécrite. */
  keys(): string[] {
    return [...this.map.keys()];
  }
}

const store = new MemoryStorage();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = store;
// uiSlice court-circuite sur `typeof window === 'undefined'` (garde SSR) : sans
// window, ses lecteurs renverraient les défauts et ne prouveraient rien.
g.window = globalThis;

const PROFILE_A = 'profile-alpha';
const PROFILE_B = 'profile-beta';
const ACTIVE_KEY = 'filarr-active-profile';

type ProfileStorage = typeof import('../profileStorage');
type UiModule = typeof import('../../../store/slices/uiSlice');

/**
 * Recharge les modules comme au démarrage de l'application : profileStorage
 * relit le pointeur de profil à son évaluation, uiSlice bâtit son initialState
 * à la sienne. Les deux doivent venir de la MÊME génération de registre, sinon
 * uiSlice interrogerait une autre instance que celle qu'on pilote ici.
 */
async function bootModules(): Promise<{ ps: ProfileStorage; ui: UiModule }> {
  vi.resetModules();
  const ps = (await import('../profileStorage')) as ProfileStorage;
  const ui = (await import('../../../store/slices/uiSlice')) as UiModule;
  return { ps, ui };
}

let ps: ProfileStorage;

beforeEach(async () => {
  store.clear();
  vi.resetModules();
  ps = (await import('../profileStorage')) as ProfileStorage;
});

// ==================== 1. Lecture de repli ====================

describe('getItemWithLegacyFallback', () => {
  it('rend la valeur de l’ancienne clé nue tant que la clé du profil est absente', () => {
    store.setItem('filarr-bars-mode', 'side');
    ps.setActiveProfile(PROFILE_A);

    expect(ps.getItemWithLegacyFallback('filarr-bars-mode')).toBe('side');
  });

  it('la clé du profil prime sur l’ancienne dès qu’elle existe', () => {
    store.setItem('filarr-bars-mode', 'side');
    store.setItem(`p:${PROFILE_A}:filarr-bars-mode`, 'none');
    ps.setActiveProfile(PROFILE_A);

    expect(ps.getItemWithLegacyFallback('filarr-bars-mode')).toBe('none');
  });

  it('rend null quand rien n’est stocké — premier lancement, le défaut appelant s’applique', () => {
    ps.setActiveProfile(PROFILE_A);

    expect(ps.getItemWithLegacyFallback('filarr-bars-mode')).toBeNull();
    expect(ps.getItemWithLegacyFallback('filarr-file-click-behavior')).toBeNull();
  });

  it('rend la chaîne vide plutôt que de basculer sur l’ancienne clé', () => {
    // '' est une valeur ENREGISTRÉE, pas une absence : la confondre avec null
    // ferait ressurgir la valeur de l'autre profil.
    store.setItem('une-cle', 'ancienne');
    store.setItem(`p:${PROFILE_A}:une-cle`, '');
    ps.setActiveProfile(PROFILE_A);

    expect(ps.getItemWithLegacyFallback('une-cle')).toBe('');
  });

  it('sans profil actif, lit simplement la clé nue (pas de double lecture)', () => {
    store.setItem('filarr-bars-mode', 'floating');

    expect(ps.getActiveProfileId()).toBeNull();
    expect(ps.getItemWithLegacyFallback('filarr-bars-mode')).toBe('floating');
  });
});

// ==================== 2. Écriture préfixée ====================

describe('setItem', () => {
  it('écrit sous le préfixe du profil et laisse l’ancienne clé intacte', () => {
    store.setItem('filarr-bars-mode', 'side');
    ps.setActiveProfile(PROFILE_A);

    ps.setItem('filarr-bars-mode', 'tabs-only');

    expect(store.getItem(`p:${PROFILE_A}:filarr-bars-mode`)).toBe('tabs-only');
    // L'ancienne clé n'est JAMAIS réécrite : le profil B doit encore hériter
    // de 'side', et non du choix que A vient de faire.
    expect(store.getItem('filarr-bars-mode')).toBe('side');
  });

  it('isole deux profils qui règlent la même préférence', () => {
    ps.setActiveProfile(PROFILE_A);
    ps.setItem('filarr-home-recent-notes', 'off');

    ps.setActiveProfile(PROFILE_B);
    expect(ps.getItemWithLegacyFallback('filarr-home-recent-notes')).toBeNull();

    ps.setItem('filarr-home-recent-notes', 'on');
    ps.setActiveProfile(PROFILE_A);
    expect(ps.getItemWithLegacyFallback('filarr-home-recent-notes')).toBe('off');
  });

  it('n’introduit aucune clé nue nouvelle', () => {
    ps.setActiveProfile(PROFILE_A);
    ps.setItem('filarr-animated-background', 'off');

    const bare = store.keys().filter((k) => !k.startsWith('p:') && k !== ACTIVE_KEY);
    expect(bare).toEqual([]);
  });
});

// ==================== 3. Reconnaissance des StorageEvent ====================

describe('matchesKey', () => {
  it('reconnaît la clé préfixée du profil actif et l’ancienne clé nue', () => {
    ps.setActiveProfile(PROFILE_A);

    expect(ps.matchesKey(`p:${PROFILE_A}:filarr-style-settings`, 'filarr-style-settings')).toBe(
      true
    );
    expect(ps.matchesKey('filarr-style-settings', 'filarr-style-settings')).toBe(true);
    expect(ps.matchesKey(`p:${PROFILE_B}:filarr-style-settings`, 'filarr-style-settings')).toBe(
      false
    );
    expect(ps.matchesKey(null, 'filarr-style-settings')).toBe(false);
  });
});

// ==================== 4. Le pointeur est lu à l’import ====================

describe('amorçage du profil actif', () => {
  it('reprend le profil enregistré dès l’évaluation du module', async () => {
    // Le scénario cassé : store/index.ts appelle setActiveProfile APRÈS avoir
    // importé uiSlice, qui a déjà construit son initialState. Si le pointeur
    // n'était pas relu à l'import, ces lectures-là partiraient hors profil.
    store.setItem(ACTIVE_KEY, PROFILE_B);
    store.setItem(`p:${PROFILE_B}:filarr-bars-mode`, 'floating');

    const { ps: fresh } = await bootModules();

    expect(fresh.getActiveProfileId()).toBe(PROFILE_B);
    expect(fresh.getItemWithLegacyFallback('filarr-bars-mode')).toBe('floating');
  });
});

// ==================== 5. uiSlice bout à bout ====================

describe('uiSlice — préférences durables d’affichage', () => {
  it('hérite des anciennes clés nues au premier démarrage sous un profil', async () => {
    store.setItem(ACTIVE_KEY, PROFILE_A);
    store.setItem('filarr-bars-mode', 'autohide');
    store.setItem('filarr-file-click-behavior', 'open');
    store.setItem('filarr-home-recent-notes', 'off');

    const { ui } = await bootModules();
    const state = ui.default(undefined, { type: '@@INIT' });

    expect(state.barsMode).toBe('autohide');
    expect(state.fileClickBehavior).toBe('open');
    expect(state.homeRecentNotes).toBe(false);
    // Jamais écrite → défaut « activé », pas « masqué ».
    expect(state.animatedBackground).toBe(true);
  });

  it('applique les défauts quand rien n’a jamais été enregistré', async () => {
    store.setItem(ACTIVE_KEY, PROFILE_A);

    const { ui } = await bootModules();
    const state = ui.default(undefined, { type: '@@INIT' });

    expect(state.barsMode).toBe('all');
    expect(state.fileClickBehavior).toBe('details');
    expect(state.homeRecentNotes).toBe(true);
    expect(state.animatedBackground).toBe(true);
  });

  it('ne voit pas les réglages d’un AUTRE profil', async () => {
    store.setItem(ACTIVE_KEY, PROFILE_A);
    store.setItem(`p:${PROFILE_B}:filarr-bars-mode`, 'none');
    store.setItem(`p:${PROFILE_B}:filarr-animated-background`, 'off');

    const { ui } = await bootModules();
    const state = ui.default(undefined, { type: '@@INIT' });

    expect(state.barsMode).toBe('all');
    expect(state.animatedBackground).toBe(true);
  });

  it('les setters écrivent sous le profil et pas sous l’ancienne clé', async () => {
    store.setItem(ACTIVE_KEY, PROFILE_A);
    store.setItem('filarr-bars-mode', 'autohide');

    const { ui } = await bootModules();
    const state = ui.default(undefined, ui.setBarsMode('none'));

    expect(state.barsMode).toBe('none');
    expect(store.getItem(`p:${PROFILE_A}:filarr-bars-mode`)).toBe('none');
    expect(store.getItem('filarr-bars-mode')).toBe('autohide');
  });

  it('hydrateDisplayPreferences recharge le chrome du profil qu’on vient d’activer', async () => {
    store.setItem(ACTIVE_KEY, PROFILE_A);
    store.setItem(`p:${PROFILE_A}:filarr-bars-mode`, 'none');
    store.setItem(`p:${PROFILE_A}:filarr-home-recent-notes`, 'off');
    store.setItem(`p:${PROFILE_B}:filarr-bars-mode`, 'floating');

    const { ps: boot, ui } = await bootModules();

    // initialState est calculé une seule fois, à l'import : c'est le chrome de A.
    const asA = ui.default(undefined, { type: '@@INIT' });
    expect(asA.barsMode).toBe('none');
    expect(asA.homeRecentNotes).toBe(false);

    // On bascule sur B sans recharger la fenêtre (le sélecteur de démarrage).
    boot.setActiveProfile(PROFILE_B);
    const asB = ui.default(asA, ui.hydrateDisplayPreferences());

    expect(asB.barsMode).toBe('floating');
    // Jamais réglé sous B, et l'ancienne clé nue n'existe pas → défaut, PAS le
    // 'off' de A qui traînait dans l'état.
    expect(asB.homeRecentNotes).toBe(true);
  });
});
