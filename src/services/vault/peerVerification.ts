/**
 * peerVerification — RÉSOUDRE LA CLÉ D'UN PAIR ET LA CONFRONTER À SON JOURNAL,
 * en un seul endroit.
 *
 * POURQUOI CETTE EXTRACTION. Ces quinze lignes vivaient à l'intérieur du thunk
 * du balayage (`sweepPendingGrants`), c'est-à-dire dans un endroit qu'aucun
 * écran ne pouvait appeler. Or « Réinviter en un clic » (F03) et « Vérifier sa
 * clé maintenant » (F04) ont besoin EXACTEMENT du même enchaînement : demander
 * la clé servie, demander le journal, faire dire au journal ce qu'il pense de la
 * clé. Sans extraction, chaque écran l'aurait réécrit — et une divergence entre
 * deux copies d'un contrôle anti-substitution est une faille silencieuse, pas
 * une inélégance.
 *
 * CE QU'ELLE NE DÉCIDE PAS. Elle rend un VERDICT, jamais une autorisation :
 * `mayAutoSeal` (pendingGrantSweep) reste seul juge de ce qui peut être scellé
 * sans humain, et la cérémonie d'empreinte reste seule capable d'accepter un
 * `changed`. Mélanger les deux ici rendrait la règle invisible.
 *
 * LA CLÉ RENDUE EST CELLE QUI A ÉTÉ VÉRIFIÉE. L'appelant la scelle TELLE
 * QUELLE : la redemander rouvrirait la fenêtre où le serveur peut en substituer
 * une autre entre le contrôle et le scellé.
 */

import { apiGetMemberPublicKey, apiGetKeyLog, type MemberPublicKeyDTO } from './vaultApi';
import { checkPeerKeyTransparency, type PeerKeyStatus } from './keyTransparency';

export interface VerifiedPeerKey {
  status: PeerKeyStatus;
  /** La clé EXACTEMENT vérifiée — à passer au scellement sans la redemander. */
  peerKey: MemberPublicKeyDTO;
}

/**
 * La clé servie pour `userId`, avec le verdict de transparence qui va avec.
 *
 * Rend `null` quand la clé n'a PAS pu être lue — un compte qui n'a jamais ouvert
 * l'application n'en a pas publié, et c'est un état normal, pas un incident.
 * Cette absence et une panne réseau se ressemblent, et c'est assumé : ni l'une
 * ni l'autre n'autorise à sceller quoi que ce soit, et l'appelant dit la seule
 * chose vraie des deux (« elle n'a pas encore publié de clé »).
 */
export async function verifyPeerKey(userId: string): Promise<VerifiedPeerKey | null> {
  try {
    const served = await apiGetMemberPublicKey(userId);
    const entries = await apiGetKeyLog(userId);
    const status = await checkPeerKeyTransparency(
      userId,
      { encPublicKey: served.encPublicKey, fingerprint: served.fingerprint },
      entries
    );
    return { status, peerKey: served };
  } catch {
    return null;
  }
}

/**
 * Les verdicts qui BLOQUENT, quoi que l'humain en pense — le serveur sert une
 * clé que le journal ne porte pas, ou un journal qui ne recalcule pas. Aucune
 * case à cocher ne lève cela : c'est la même règle que `keyVerificationModel`,
 * dite ici pour les appelants qui n'ont pas de cérémonie montée.
 */
export function isBlockingPeerStatus(status: PeerKeyStatus): boolean {
  return status === 'tampered_log' || status === 'served_not_latest';
}

export default verifyPeerKey;
