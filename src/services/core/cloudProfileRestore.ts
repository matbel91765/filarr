/**
 * RAMENER LES PROFILS D'UN COMPTE, à la connexion — le geste qui manquait.
 *
 * CE QUE L'UTILISATEUR VOYAIT. Il se connectait à un compte dont les profils
 * avaient pourtant été synchronisés depuis un autre appareil, et il ne voyait
 * rien arriver : soit une liste vide, soit un unique profil neuf nommé d'après
 * le début de son adresse e-mail.
 *
 * POURQUOI, ET CE N'ÉTAIT PAS LE MÊME DÉFAUT DES DEUX CÔTÉS.
 *
 *   · SUR LE BUREAU, `restoreProfilesFromCloud()` faisait exactement le bon
 *     travail — lister, télécharger les manifestes, les déchiffrer, recréer les
 *     entrées locales avec leur nom — mais vivait, privée, dans le protocole
 *     d'APPAIRAGE à six chiffres. Le jour où l'écran de connexion a appris à
 *     sauter cet appairage (le serveur détient une copie enveloppée de la FEK,
 *     les six chiffres n'ont plus lieu d'être), il a sauté du même coup la
 *     seule fonction qui ramenait les profils.
 *   · SUR LE WEB, la restauration existait aussi — et n'était appelée que
 *     depuis un cycle de synchronisation mené POUR UN PROFIL QU'ON POSSÈDE
 *     DÉJÀ. Sur un navigateur neuf, il fallait donc déjà avoir un profil pour
 *     que les autres arrivent : l'œuf et la poule.
 *
 * Un seul appelant partagé les corrige tous les deux, parce que le geste est le
 * même — « je viens de prouver qui je suis, rends-moi ce qui m'appartient ».
 *
 * BEST-EFFORT, DÉLIBÉRÉMENT. Hors ligne, ou coffre encore verrouillé (les
 * métadonnées d'un profil vivent dans un manifeste chiffré : sans clé, rien
 * n'est lisible), la restauration échoue sans faire échouer une connexion par
 * ailleurs réussie. La suivante réessaiera.
 */

import store from '../../store';
import { fetchManifest } from '../../store/slices/profilesSlice';

interface RestoreOutcome {
  success: boolean;
  restored: number;
  /**
   * IDENTIFIANTS des profils du compte, et pas seulement leur nombre.
   *
   * Le compteur suffisait tant que la restauration servait un appareil neuf :
   * tout ce qui était là appartenait au compte qui venait de se connecter.
   * Depuis le sélecteur, la machine porte DÉJÀ des profils — d'autres comptes,
   * du travail hors ligne — et « prendre le premier » revient à ouvrir celui de
   * quelqu'un d'autre. Les identifiants sont la seule façon de désigner ce qui
   * relève du compte qu'on vient d'ajouter.
   *
   * Le côté principal les rendait déjà (`sync:restoreCloudProfiles`) ; ils
   * étaient jetés ici.
   */
  profileIds: string[];
}

/**
 * Rend les profils ramenés. Une liste vide n'est pas une erreur : un compte dont
 * aucun profil n'a jamais été synchronisé n'a rien à rendre — la table
 * `profiles_sync` ne se remplit qu'à la première synchronisation.
 */
export async function restoreCloudProfiles(): Promise<RestoreOutcome> {
  const ipc = (
    window as unknown as {
      electron?: { ipcRenderer?: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } };
    }
  ).electron?.ipcRenderer;
  if (!ipc) return { success: false, restored: 0, profileIds: [] };

  try {
    const result = (await ipc.invoke('sync:restoreCloudProfiles')) as
      | Partial<RestoreOutcome>
      | undefined;
    const restored = result?.restored ?? 0;
    const profileIds = Array.isArray(result?.profileIds) ? result.profileIds : [];
    /**
     * RELIRE LE MANIFESTE, TOUJOURS — pas seulement quand le compte rendu est
     * positif.
     *
     * Sans cette relecture, le travail resterait invisible : les entrées
     * viennent d'être écrites sous l'écran, pas dans le magasin qui l'alimente.
     * Et la conditionner à `restored > 0` était une erreur :
     * `restoreProfileFromCloud` sort immédiatement sur un identifiant déjà
     * connu, si bien que le compteur peut valoir zéro alors qu'un autre profil,
     * lui, vient d'apparaître. Relire coûte une lecture locale ; ne pas relire
     * coûte le symptôme entier.
     */
    await store.dispatch(fetchManifest());
    return { success: result?.success ?? false, restored, profileIds };
  } catch {
    return { success: false, restored: 0, profileIds: [] };
  }
}
