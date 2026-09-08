/**
 * Le magasin de ce compte est-il HORS DE PORTÉE depuis un navigateur ?
 *
 * ── POURQUOI CETTE GARDE EXISTE ─────────────────────────────────────────────
 *
 * La cible de stockage est un réglage de COMPTE, pas d'appareil. Un utilisateur
 * peut donc déclarer, depuis son ordinateur, un magasin sur son réseau (NAS,
 * MinIO) — puis ouvrir app.filarr.com. Le navigateur, lui, ne joindra jamais ce
 * magasin : une page servie en HTTPS ne peut pas appeler un endpoint en clair,
 * et un NAS domestique n'a ni certificat ni CORS.
 *
 * Sans cette garde, chaque cycle partirait, échouerait sur des erreurs réseau,
 * et l'utilisateur lirait « synchronisation impossible » sans jamais apprendre
 * que le problème n'est ni son compte ni sa connexion, mais le fait que ce
 * magasin-là ne se joint que depuis l'application de bureau.
 *
 * On ne RÉPARE rien ici — il n'y a rien à réparer. On remplace un échec
 * incompréhensible par une phrase vraie.
 *
 * ── CE QUE LA GARDE NE FAIT PAS ─────────────────────────────────────────────
 *
 * Elle ne bloque pas la lecture locale : les données déjà présentes dans ce
 * navigateur restent lisibles. Seul le CYCLE de synchronisation s'abstient.
 */

import { apiFetch } from '../webApiBase';

/** Réponse partielle de `GET /sync/capabilities` — seul ce champ nous intéresse. */
interface CapabilitiesDto {
  storageMode?: 'filarr' | 'byos';
  byosLocality?: 'public' | 'local';
}

/**
 * Mémorisé par profil, pour la durée de l'onglet.
 *
 * Le cycle tourne toutes les vingt secondes en sondage : rappeler
 * `/sync/capabilities` à chaque fois serait un aller-retour pour une valeur qui
 * ne change qu'à la reconfiguration du magasin. `null` = pas encore su.
 */
const _cache = new Map<string, boolean>();

/** Oublie ce qui a été appris — appelé au changement de compte ou de profil. */
export function resetLocalStoreCache(): void {
  _cache.clear();
}

/**
 * `true` quand le magasin du profil est sur le réseau de l'utilisateur.
 *
 * En cas de doute — worker plus ancien qui n'envoie pas le champ, réseau coupé,
 * réponse illisible — on répond `false`. C'est le comportement d'avant cette
 * garde : le cycle part et échoue s'il doit échouer. Bloquer la synchro sur une
 * incertitude serait bien pire que la laisser tenter.
 */
export async function isStoreOutOfReachFromBrowser(profileId: string): Promise<boolean> {
  const known = _cache.get(profileId);
  if (known !== undefined) return known;

  try {
    const res = await apiFetch<{ data?: CapabilitiesDto }>(
      `/sync/capabilities?profileId=${encodeURIComponent(profileId)}`
    );
    const data = res.body?.data;
    const local = data?.storageMode === 'byos' && data?.byosLocality === 'local';
    _cache.set(profileId, local);
    return local;
  } catch {
    // On ne mémorise PAS un échec : la prochaine tentative doit pouvoir
    // apprendre. Mémoriser `false` figerait une ignorance passagère.
    return false;
  }
}
