/**
 * vaultDescriptionIndex — LE CACHE SUIT LE SECRET DONT IL DÉRIVE.
 *
 * CE QUE CES TESTS GARDENT, ET LE DÉFAUT QUI LES A ÉCRITS.
 *
 * L'en-tête de `vaultDescriptionIndex` justifie son existence EN MÉMOIRE par une
 * phrase précise : « la ranger en clair sur le disque la rendrait lisible sans le
 * coffre — c'est-à-dire qu'elle survivrait au verrouillage ». Or `forgetVault-
 * Descriptions()` n'était appelé de NULLE PART. La description déchiffrée
 * survivait donc au verrouillage de session, à la déconnexion, au changement de
 * profil — et à la branche de CONTRAINTE : les cartes de l'accueil d'une session
 * leurre continuaient d'afficher, en clair, la description d'un coffre réel.
 *
 * `collabKeys.ts` énonce littéralement la règle enfreinte : « le cache module
 * suit les secrets dont il dérive ». La description arrive chiffrée sous
 * K_vault ; elle doit donc mourir avec K_vault, et pas « quelque part dans
 * hybridCrypto, si quelqu'un pense à l'appeler ».
 *
 * D'OÙ LE CÂBLAGE CHOISI, et c'est lui que ces tests fixent : l'oubli est fait
 * PAR `vaultKeyCache` lui-même — `clearVaultKeys()` (verrouillage, contrainte) et
 * `lockVault(vaultId)` (départ d'un coffre). Un appel posé à côté de chaque
 * `clearVaultKeys()` aurait tenu tant qu'on y pense ; posé DANS, il tient par
 * construction, et un troisième chemin de purge écrit demain l'hérite sans rien
 * savoir de cet index.
 *
 *   npx vitest run src/services/vault/__tests__/vaultDescriptionIndex.vitest.ts
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetVaultDescription,
  forgetVaultDescriptions,
  getVaultDescription,
  rememberVaultDescription,
} from '../vaultDescriptionIndex';
import { clearVaultKeys, lockVault } from '../vaultKeyCache';

// `hybridCrypto` pousse la clé de session au processus principal : `window` est
// référencé NU. Un objet vide suffit — les gardes `?.` font le reste.
beforeAll(() => {
  (globalThis as unknown as { window?: unknown }).window ??= {};
});

beforeEach(() => {
  forgetVaultDescriptions();
});

describe('l’index en mémoire — ce qu’il retient', () => {
  it('rend la description LUE, chaîne vide comprise, et `undefined` quand on n’a pas lu', () => {
    // « ce coffre n'a pas de description » est une RÉPONSE ; « on n'a pas lu »
    // est l'absence de clé. Les confondre ferait afficher un vide comme un fait.
    rememberVaultDescription('v-1', 'Les contrats 2026');
    rememberVaultDescription('v-2', '');
    expect(getVaultDescription('v-1')).toBe('Les contrats 2026');
    expect(getVaultDescription('v-2')).toBe('');
    expect(getVaultDescription('v-jamais-ouvert')).toBeUndefined();
  });
});

describe('la description meurt avec K_vault', () => {
  it('`clearVaultKeys()` (verrouillage, contrainte) efface TOUT l’index', () => {
    rememberVaultDescription('v-1', 'Les contrats 2026');
    rememberVaultDescription('v-2', 'Le coffre du conseil');

    clearVaultKeys();

    expect(getVaultDescription('v-1')).toBeUndefined();
    expect(getVaultDescription('v-2')).toBeUndefined();
  });

  it('`lockVault(id)` (départ d’un coffre) n’efface QUE ce coffre-là', () => {
    // Quitter un coffre ne dit rien des autres : effacer tout l'index ferait
    // disparaître des descriptions parfaitement lisibles de toutes les cartes.
    rememberVaultDescription('v-1', 'Les contrats 2026');
    rememberVaultDescription('v-2', 'Le coffre du conseil');

    lockVault('v-1');

    expect(getVaultDescription('v-1')).toBeUndefined();
    expect(getVaultDescription('v-2')).toBe('Le coffre du conseil');
  });

  it('l’oubli ciblé s’expose aussi seul, et ne touche pas les voisins', () => {
    rememberVaultDescription('v-1', 'Les contrats 2026');
    rememberVaultDescription('v-2', 'Le coffre du conseil');

    forgetVaultDescription('v-1');

    expect(getVaultDescription('v-1')).toBeUndefined();
    expect(getVaultDescription('v-2')).toBe('Le coffre du conseil');
  });
});

describe('le chemin RÉEL du verrouillage, pas seulement le module', () => {
  it('`clearHybridCrypto()` emporte la description avec la FEK et K_vault', async () => {
    // Le garde ci-dessus tiendrait même si plus personne n'appelait
    // `clearVaultKeys()`. Celui-ci part de l'AUTORITÉ du verrouillage — la
    // séquence que `forgetSessionSecrets` déclenche — et vérifie qu'elle atteint
    // bien l'index. C'est le trajet complet : verrouillage → K_vault → cartes.
    const { clearHybridCrypto } = await import('../../auth/hybridCrypto');
    rememberVaultDescription('v-1', 'Les contrats 2026');

    clearHybridCrypto();

    expect(getVaultDescription('v-1')).toBeUndefined();
  });
});
