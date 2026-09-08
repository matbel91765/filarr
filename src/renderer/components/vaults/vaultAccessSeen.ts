/**
 * vaultAccessSeen — le registre des coffres « déjà vus », PAR PROFIL.
 *
 * IL RESTE LOCAL, ET CE N'EST PAS UN DÉTAIL. Le serveur n'a aucune notion de
 * « déjà vu » sur un coffre, et il ne doit pas en acquérir une : ce serait lui
 * apprendre quand quelqu'un ouvre son application et sur quoi son regard s'est
 * posé. La liste ne contient que des identifiants opaques — jamais un nom, qui
 * est chiffré de bout en bout et n'existe qu'après déchiffrement chez la
 * personne.
 *
 * PAR PROFIL, VIA `profileStorage`, PUIS PAR COMPTE dans le nom de la clé. Deux
 * profils sur la même machine sont deux vies séparées (c'est tout l'objet du
 * préfixe `p:<profil>:`), et un même profil peut voir passer deux comptes nuage
 * — le registre de l'un annoncerait alors les coffres de l'autre comme
 * « déjà vus », c'est-à-dire silencieusement.
 *
 * MÊME DISCIPLINE QUE `vaultActivitySeen` : chaque accès est gardé. Pas de
 * `localStorage` en environnement de test (vitest = node) ni dans certains
 * contextes navigateur — un stockage absent rend `null` / ne fait rien, jamais
 * une exception. Une lecture illisible vaut « jamais semé » : le premier
 * chargement suivant re-sèmera en silence plutôt que d'annoncer une salve.
 */

import { getItem, setItem } from '../../../services/core/profileStorage';
import type { KnownVaultsRegistry } from './newVaultAccessModel';

const key = (userId: string) => `filarr-vaults-known:${userId}`;

export function readKnownVaults(userId: string): KnownVaultsRegistry | null {
  try {
    const raw = getItem(key(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ids?: unknown; seeded?: unknown };
    if (!Array.isArray(parsed.ids)) return null;
    const ids = parsed.ids.filter((v): v is string => typeof v === 'string');
    // `seeded` doit être VRAI explicitement : un registre d'une forme qu'on ne
    // reconnaît pas est un registre dont on ne sait rien, et ne pas savoir ne
    // doit jamais produire une annonce.
    return { ids, seeded: parsed.seeded === true };
  } catch {
    return null; // pas de stockage (tests / non-navigateur) ou JSON corrompu
  }
}

export function writeKnownVaults(userId: string, registry: KnownVaultsRegistry): void {
  try {
    setItem(key(userId), JSON.stringify({ ids: registry.ids, seeded: registry.seeded }));
  } catch {
    /* stockage absent ou plein : le bandeau repartira du dernier état lisible */
  }
}
