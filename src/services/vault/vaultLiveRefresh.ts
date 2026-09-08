/**
 * vaultLiveRefresh — DE QUOI INVALIDER ce que Redux ne porte pas.
 *
 * LE PROBLÈME QUE ÇA RÉSOUT. Le guetteur (`VaultHeadsWatcher`) sait qu'un
 * réglage ou un effectif a changé, mais deux lectures ne vivent PAS dans le
 * magasin : `useVaultSettings` et `useVaultManagement` gardent leur état dans
 * leurs propres `useState`, et il en existe plusieurs instances montées en même
 * temps (la page « Gérer le coffre », l'explorateur, le panneau de partage par
 * élément, la porte rapide de partage — l'en-tête d'`useVaultSettings`
 * l'assume explicitement). Un dispatch Redux ne les atteint pas, et le guetteur
 * n'a aucun moyen d'appeler le `reload()` d'une instance qu'il ne connaît pas.
 *
 * CE QUE C'EST. Un compteur par (sujet, coffre), et de quoi s'y abonner. Le
 * guetteur INCRÉMENTE ; chaque hook LIT le compteur de son coffre via
 * `useSyncExternalStore` et le met dans les dépendances de son effet de
 * chargement. Toutes les instances relisent, aucune n'a besoin de connaître les
 * autres — c'est exactement le contrat qu'`useVaultSettings` refusait de se
 * donner sous forme de cache de module (« un réglage servi périmé juste après
 * un enregistrement rouvrirait la porte que ces réglages ferment ») : ici, rien
 * n'est mis en cache, on ne fait que DEMANDER une relecture.
 *
 * POURQUOI UN COMPTEUR ET PAS UN ÉVÉNEMENT. `useSyncExternalStore` exige un
 * instantané stable : deux lectures sans changement doivent rendre la MÊME
 * valeur, sans quoi React boucle. Un entier qui ne fait que croître le garantit,
 * et il survit à un abonnement qui arrive après l'émission — un événement
 * volatile, lui, serait perdu pour l'instance montée une milliseconde trop tard.
 *
 * CE N'EST PAS UN CANAL D'ÉTAT. On n'y met AUCUNE donnée : uniquement « ceci a
 * bougé, relis ». La donnée reste servie par sa route, avec ses gardes.
 */

/** Ce qui peut être invalidé. Un sujet par lecture indépendante. */
export type VaultLiveTopic = 'settings' | 'management';

type Key = `${VaultLiveTopic}:${string}`;

const compteurs = new Map<Key, number>();
const abonnes = new Map<Key, Set<() => void>>();

function cle(topic: VaultLiveTopic, vaultId: string): Key {
  return `${topic}:${vaultId}`;
}

/** Le numéro de génération courant — l'instantané d'`useSyncExternalStore`. */
export function vaultLiveNonce(topic: VaultLiveTopic, vaultId: string): number {
  return compteurs.get(cle(topic, vaultId)) ?? 0;
}

/** S'abonner aux invalidations d'un (sujet, coffre). Rend le désabonnement. */
export function subscribeVaultLive(
  topic: VaultLiveTopic,
  vaultId: string,
  onChange: () => void
): () => void {
  const k = cle(topic, vaultId);
  const set = abonnes.get(k) ?? new Set<() => void>();
  abonnes.set(k, set);
  set.add(onChange);
  return () => {
    set.delete(onChange);
    // On ne laisse pas d'ensemble vide derrière soi : un compte qui ouvre des
    // dizaines de coffres au fil d'une session ne doit pas laisser une entrée
    // morte par coffre visité.
    if (set.size === 0) abonnes.delete(k);
  };
}

/**
 * Déclarer qu'un (sujet, coffre) est périmé. Appelé par le GUETTEUR seulement :
 * les gestes de l'utilisateur ont déjà leur voie rapide (`reload()`,
 * `afterRosterChange()`), qui n'a pas à passer par ici.
 */
export function invalidateVaultLive(topic: VaultLiveTopic, vaultId: string): void {
  const k = cle(topic, vaultId);
  compteurs.set(k, (compteurs.get(k) ?? 0) + 1);
  for (const notifier of abonnes.get(k) ?? []) notifier();
}

/** Pour les tests : repartir d'une ardoise vierge entre deux cas. */
export function resetVaultLiveRefresh(): void {
  compteurs.clear();
  abonnes.clear();
}
