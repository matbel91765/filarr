/**
 * vaultAppearanceLocal (F14) — la personnalisation « POUR MOI » d'un coffre.
 *
 * DEUX PORTÉES, ET UNE SEULE PEUT ÊTRE PARTAGÉE. « Pour tout le monde » est
 * scellé dans l'enveloppe de `name_encrypted` : c'est une décision de l'équipe,
 * elle voyage, elle se rescelle à chaque rotation. « Pour moi » n'a aucune
 * raison d'être chiffrée pour autrui, ni même d'exister ailleurs que sur cet
 * appareil : c'est un repère personnel (« ce coffre-là, c'est le rouge »), pas
 * une donnée du coffre. L'envoyer au serveur — même chiffrée — ferait porter à
 * tous une préférence d'un seul, et rendrait un geste privé visible de tout le
 * monde à la rotation suivante.
 *
 * DONC localStorage, ET RIEN D'AUTRE. Comme `vaultActivitySeen` : chaque accès
 * est gardé (pas de stockage en environnement de test, ni dans certains
 * contextes navigateur), un stockage absent rend `undefined` ou ne fait rien,
 * jamais une exception. La clé porte l'identifiant de compte, pour qu'un second
 * profil sur la même machine ne récupère pas les repères du premier.
 *
 * LES ABONNÉS SONT INDISPENSABLES : le glyphe du coffre est rendu à cinq
 * endroits à la fois (cartes de l'accueil, rangées de liste, fil d'Ariane,
 * en-tête de la page). Sans notification, changer la couleur « pour moi »
 * n'aurait repeint que le composant qui a fait le geste, et les quatre autres
 * seraient restés en arrière jusqu'au prochain rendu — c'est-à-dire, pour
 * l'accueil, jusqu'au prochain redémarrage.
 */

import { normalizeVaultAppearance, type VaultAppearance } from './vaultNameEnvelope';

const key = (userId: string, vaultId: string) => `filarr-vault-appearance:${userId}:${vaultId}`;

/** Les abonnés (useSyncExternalStore) — un seul jeu pour toute l'application. */
const abonnes = new Set<() => void>();

export function subscribeVaultAppearance(fn: () => void): () => void {
  abonnes.add(fn);
  return () => {
    abonnes.delete(fn);
  };
}

/**
 * Le cache mémoire — indispensable, et pas pour la vitesse.
 *
 * `useSyncExternalStore` compare le résultat de son `getSnapshot` PAR
 * RÉFÉRENCE à chaque rendu : relire et re-parser le JSON à chaque appel
 * rendrait un objet neuf à chaque fois, donc une boucle de rendu infinie. On
 * garde donc l'objet lu, et on ne le remplace que lorsqu'il change vraiment.
 */
const cache = new Map<string, VaultAppearance | undefined>();

export function getLocalVaultAppearance(
  userId: string | null,
  vaultId: string
): VaultAppearance | undefined {
  if (!userId) return undefined;
  const k = key(userId, vaultId);
  if (cache.has(k)) return cache.get(k);
  let val: VaultAppearance | undefined;
  try {
    const raw = localStorage.getItem(k);
    // Les bornes sont RÉAPPLIQUÉES à la lecture : ce qui est écrit ici l'a été
    // par une version de cette application, mais rien n'empêche une version
    // future — ou une main — d'y ranger autre chose, et ce sont des valeurs
    // qu'on met ensuite dans du CSS.
    val = raw ? normalizeVaultAppearance(JSON.parse(raw)) : undefined;
  } catch {
    val = undefined; // pas de stockage, ou JSON corrompu
  }
  cache.set(k, val);
  return val;
}

/** Poser (ou retirer, avec `undefined`) le repère personnel de ce coffre. */
export function setLocalVaultAppearance(
  userId: string | null,
  vaultId: string,
  appearance: VaultAppearance | undefined
): void {
  if (!userId) return;
  const k = key(userId, vaultId);
  const borne = normalizeVaultAppearance(appearance);
  cache.set(k, borne);
  try {
    if (borne) localStorage.setItem(k, JSON.stringify(borne));
    else localStorage.removeItem(k);
  } catch {
    /* stockage absent ou plein : le repère ne survivra pas à la session */
  }
  for (const fn of abonnes) fn();
}

/** Oublier le cache mémoire (changement de profil / de compte). */
export function forgetLocalVaultAppearances(): void {
  cache.clear();
  for (const fn of abonnes) fn();
}
