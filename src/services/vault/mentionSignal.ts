import { apiSignalMentions } from './mentionsApi';
import { sameMentionSet, scanMentionUserIds } from '../notes/mentionScan';

/**
 * QUAND PRÉVIENT-ON, ET QUAND SE TAIT-ON ?
 *
 * Une note s'enregistre sans arrêt : à chaque frappe groupée, à chaque perte
 * de focus, à chaque arrivée d'un pair. Envoyer la liste des personnes nommées
 * à chaque fois serait un martèlement. On n'envoie donc QUE lorsque l'ensemble
 * des personnes nommées A CHANGÉ depuis le dernier envoi réussi pour cet
 * élément.
 *
 * Ce registre ne se souvient PAS « pour toujours » : il retient le dernier
 * ensemble envoyé, pas « déjà signalé ». C'est le SERVEUR qui décide de ne pas
 * re-sonner quelqu'un tant qu'il n'a pas lu (voir `unread_exists`) — deux
 * mémoires du même fait finiraient par diverger, et la mention retirée puis
 * remise ne sonnerait plus jamais.
 *
 * Silencieux par construction : prévenir est un bonus, jamais une raison de
 * faire échouer un enregistrement. Un réseau coupé oublie l'ensemble envoyé
 * pour que le prochain enregistrement réessaie.
 */
const dernierEnvoi = new Map<string, string[]>();

export async function signalMentionsForItem(
  vaultId: string,
  itemId: string,
  doc: unknown
): Promise<void> {
  let nommes: string[];
  try {
    nommes = scanMentionUserIds(doc);
  } catch {
    return;
  }
  const cle = `${vaultId}:${itemId}`;
  const precedent = dernierEnvoi.get(cle);
  if (precedent && sameMentionSet(precedent, nommes)) return;
  // Aucune personne nommée : rien à envoyer, mais on note l’ensemble vide pour
  // que le prochain ajout compte comme un changement.
  if (nommes.length === 0) {
    dernierEnvoi.set(cle, []);
    return;
  }
  try {
    await apiSignalMentions(vaultId, itemId, nommes);
    dernierEnvoi.set(cle, nommes);
  } catch {
    dernierEnvoi.delete(cle);
  }
}

/** Oublie ce qui a été envoyé (changement de profil, déconnexion). */
export function resetMentionSignals(): void {
  dernierEnvoi.clear();
}
