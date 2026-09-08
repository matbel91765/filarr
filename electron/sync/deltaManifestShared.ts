/**
 * deltaManifestShared.ts — Constantes du manifeste delta, PORTABLES.
 *
 * Extraites pour que `deltaManifestV5.ts` puisse les partager sans importer
 * `deltaManifest.ts`, qui tire `node:crypto` et ne peut donc pas être chargé
 * par l'application web ni par le mobile.
 *
 * ⚠ Ces valeurs sont dupliquées dans `deltaManifest.ts` (chemin de production
 * v4). Elles DOIVENT rester identiques : `__tests__/deltaManifestV5.vitest.ts`
 * échoue si les deux divergent. La duplication est assumée pour la même raison
 * que `notesDelta.ts` existe en deux exemplaires — `electron/tsconfig.json` a
 * pour racine `electron/`, et le build CRA interdit à `src/` d'en sortir.
 */

/** Magic identifiant un manifeste delta. */
export const DELTA_MANIFEST_FMT = 'filarr-delta-manifest';

/** Manifeste v4 : blocs à frontière FIXE de 8 Mio, sans en-tête sur l'objet. */
export const MANIFEST_V4 = 4;

/** Manifeste v5 : découpage par contenu, en-tête v2, taille stockée portée. */
export const MANIFEST_V5 = 5;

export const ERR_MANIFEST_PARSE = 'Manifeste delta illisible (JSON invalide)';
export const ERR_MANIFEST_INVALID = 'Manifeste delta invalide';
