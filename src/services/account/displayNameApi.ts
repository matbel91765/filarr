import apiClient from '../network/apiClient';
import type { UserDTO } from '../../types/auth';

/**
 * LE NOM D'AFFICHAGE — facultatif, et EFFAÇABLE.
 *
 * Une chaîne vide le retire : on ne force personne à porter un nom. Le serveur
 * coupe à 64 caractères — ce qui tient dans une puce de mention et un
 * trombinoscope, pas une biographie. La réponse porte le compte à jour, qu'on
 * remet dans le magasin pour que tous les écrans suivent.
 */
export async function apiUpdateDisplayName(displayName: string): Promise<UserDTO | null> {
  const { data } = await apiClient.put<{ success: boolean; data?: { user: UserDTO } }>('/account', {
    displayName,
  });
  return data.data?.user ?? null;
}
