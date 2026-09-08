/**
 * routeToTitle — le titre d'un onglet de coffre partagé (lot A, C3).
 *
 * Le module hôte (`useTabNavigation`) importe React Router, react-redux et la
 * config i18n : tous bouchonnés, on ne teste que la fonction pure.
 *
 * CE QU'IL NE GARDE PAS, ET OÙ C'EST GARDÉ. Un bloc « F14 » vivait ici, qui
 * décodait une enveloppe puis vérifiait que `routeToTitle` rendait ce que
 * `decodeVaultName` venait de produire : les deux moitiés sortaient du MÊME
 * modèle, si bien qu'aucune régression du chemin réel (`toVaultSummary` range-
 * t-il le nom décodé dans le résumé Redux ?) ne pouvait le faire tomber. Ce
 * chemin-là est éprouvé là où il passe, dans
 * `store/slices/__tests__/rotateKeyTrust.vitest.ts` (« range le NOM et
 * l'APPARENCE »), contre un vrai store et un `loadVaults` bouchonné.
 *
 *   npx vitest run src/hooks/__tests__/routeToTitle.vitest.ts
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useLocation: vi.fn(), useNavigate: vi.fn() }));
vi.mock('react-redux', () => ({ useSelector: vi.fn(), useDispatch: vi.fn() }));
vi.mock('../../store/slices/tabsSlice', () => ({ updateTabRoute: vi.fn() }));
vi.mock('../../i18n/config', () => ({
  default: {
    // Rend la clé, ou la valeur par défaut si fournie — assez pour distinguer
    // « nom du coffre » de « repli ».
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { routeToTitle } from '../useTabNavigation';

const folders = { 'f-1': { name: 'Docs' } };

describe('routeToTitle — /vault-folder/<id>', () => {
  it('coffre nommé → son nom', () => {
    expect(routeToTitle('/vault-folder/v-1', folders, { 'v-1': { name: 'Projet X' } })).toBe(
      'Projet X'
    );
  });

  it('coffre verrouillé (nom vide) → repli, jamais une chaîne vide', () => {
    expect(routeToTitle('/vault-folder/v-1', folders, { 'v-1': { name: '' } })).toBe(
      'Coffre partagé'
    );
  });

  it('coffre absent → repli', () => {
    expect(routeToTitle('/vault-folder/v-1', folders, {})).toBe('Coffre partagé');
  });

  it('sans dictionnaire de coffres (signature à deux arguments) → repli', () => {
    expect(routeToTitle('/vault-folder/v-1', folders)).toBe('Coffre partagé');
  });

  it('une route legacy /vaults/<id> est titrée comme sa forme canonique', () => {
    expect(routeToTitle('/vaults/v-1', folders, { 'v-1': { name: 'Projet X' } })).toBe('Projet X');
  });

  it('/vaults (legacy) est titré comme l’accueil', () => {
    expect(routeToTitle('/vaults', folders)).toBe('tabs.home');
  });
});

describe('routeToTitle — inchangé pour le reste', () => {
  it('/folder/<id> garde son patron', () => {
    expect(routeToTitle('/folder/f-1', folders)).toBe('Docs');
    expect(routeToTitle('/folder/nope', folders)).toBe('tabs.folder');
  });

  it('/vault (coffre-fort local) ne confond pas avec un coffre partagé', () => {
    expect(routeToTitle('/vault', folders, { vault: { name: 'X' } })).toBe('tabs.vault');
  });

  it('route inconnue → Filarr', () => {
    expect(routeToTitle('/nope', folders)).toBe('Filarr');
  });
});
