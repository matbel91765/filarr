/**
 * Empreinte du CLAIR du store de notes — le seul moyen bon marché de savoir si
 * une sauvegarde apporte quelque chose.
 *
 * POURQUOI. `notes:save` marquait `meta:notes` à REMONTER à chaque appel. Or un
 * onglet SUIVEUR qui rejoue `notes-updated` recharge le store depuis IndexedDB
 * puis le ré-enregistre tel quel : un aller-retour strictement identique
 * déclenchait donc une remontée, depuis un onglet qui n'avait rien modifié —
 * et la remontée réveillait les autres onglets, qui rechargeaient, qui
 * ré-enregistraient…
 *
 * Comparer les CLAIRS directement est impossible sans déchiffrer le blob stocké
 * à chaque sauvegarde (coûteux, et le blob fait plusieurs Mo). On garde donc à
 * côté l'empreinte du dernier clair écrit : la sauvegarde n'a plus qu'à hacher
 * ce qu'elle s'apprête à écrire — ce qu'elle a déjà sérialisé — et à comparer.
 *
 * Les DEUX écrivains du blob tiennent cette empreinte à jour (`notes:save` et la
 * fusion du cycle) : une empreinte laissée en arrière ferait passer le
 * rechargement suivant pour une modification, ce qui rouvrirait exactement la
 * boucle qu'on ferme ici.
 */

/** Clé de l'empreinte dans le store CLOISONNÉ du profil. */
export const NOTES_DIGEST_KEY = 'notes_plain_digest';

/** SHA-256 hex du clair sérialisé. Aucun secret : c'est une empreinte. */
export async function notesPlainDigest(plain: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    plain.buffer.slice(plain.byteOffset, plain.byteOffset + plain.byteLength) as ArrayBuffer
  );
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
