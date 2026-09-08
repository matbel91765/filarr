/**
 * Session de la clé de garde — la privée déverrouillée, EN MÉMOIRE DU
 * RENDERER SEULEMENT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÈGLE, ET ELLE EST COURTE
 * ════════════════════════════════════════════════════════════════════════
 * La privée de garde ne touche NI le disque, NI le processus principal, NI
 * redux-persist, NI localStorage. Elle vit dans ce module le temps d'une
 * session applicative et meurt avec la fenêtre. Ce que la machine garde en
 * clair, c'est la seule PUBLIQUE — qui suffit à sceller et n'ouvre rien.
 *
 * L'unique exception est EXPLICITE et se demande à l'utilisateur : « se
 * souvenir sur cet appareil » (`custodyRemember.ts`), désactivée par défaut,
 * chiffrée par le `safeStorage` d'Electron, avec un bouton d'oubli. Elle vit
 * dans son propre module précisément pour que celui-ci reste inconditionnel :
 * ici, rien ne persiste, jamais.
 *
 * POURQUOI PAS LE PROCESSUS PRINCIPAL, qui tient déjà les jetons : parce que
 * le principal n'a aucun besoin de cette clé. Il ne déscelle rien, ne lit
 * aucun libellé, ne compose aucun lien. Lui confier la privée l'ajouterait à
 * la surface d'un processus qui a `fs`, `net` et l'IPC — pour zéro usage.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES QUATRE ÉTATS, ET POURQUOI `unknown` N'EST PAS `absent`
 * ════════════════════════════════════════════════════════════════════════
 * Sur une panne réseau, on ne SAIT pas si le compte a une clé. Confondre ce
 * silence avec « ce compte n'a pas de coffre » ferait afficher « créez-en un »
 * à quelqu'un qui en a un — et le worker, premier-écrit-gagnant, laisserait
 * repartir avec une phrase fraîche qui n'ouvre rien. Les deux états sont donc
 * distincts, et `setCustodyKey(null)` ne doit être appelé que sur une réponse
 * AFFIRMATIVE du serveur.
 *
 * Le module est un OBSERVABLE minimal : les écrans s'abonnent, aucun composant
 * ne détient l'état. Pas de Redux — un secret vivant n'a rien à faire dans un
 * magasin inspectable par les devtools, sérialisé par redux-logger et persisté
 * par erreur au premier ajout de reducer distrait.
 */

import type { CustodyKeyMaterial } from './custodyFormat';

export type CustodySessionState =
  /** Rien n'a encore été demandé au serveur, ou la demande a échoué. */
  | { status: 'unknown' }
  /** Le serveur AFFIRME que le compte n'a pas de clé. */
  | { status: 'absent' }
  /** Une clé existe ; la privée n'est pas en mémoire. */
  | { status: 'locked'; key: CustodyKeyMaterial }
  /** Déverrouillée : la privée est en mémoire pour cette session. */
  | { status: 'unlocked'; key: CustodyKeyMaterial; privateKey: Uint8Array };

type Listener = (state: CustodySessionState) => void;

let state: CustodySessionState = { status: 'unknown' };
const listeners = new Set<Listener>();

function emit(next: CustodySessionState): void {
  state = next;
  // Copie de la liste : un abonné qui se désabonne DANS sa notification
  // (`useEffect` démonté par le rendu qu'il déclenche) muterait le Set en
  // cours d'itération.
  for (const listener of [...listeners]) listener(state);
}

export function getCustodySession(): CustodySessionState {
  return state;
}

export function subscribeCustodySession(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Enregistre ce que le serveur a répondu. `null` signifie « pas de clé sur ce
 * compte » — jamais « je n'ai pas pu demander ».
 *
 * Si la clé du serveur a changé d'IDENTITÉ (autre publique), la privée en
 * mémoire n'ouvre plus rien : elle est effacée plutôt que gardée, pour qu'aucun
 * écran ne se croie déverrouillé sur une clé morte.
 */
export function setCustodyKey(key: CustodyKeyMaterial | null): void {
  if (!key) {
    lockCustody();
    emit({ status: 'absent' });
    return;
  }
  if (state.status === 'unlocked' && state.key.custodyPublicKey === key.custodyPublicKey) {
    // Même clé, matériel rafraîchi (un ré-emballage ailleurs a pu changer le
    // sel) : la privée reste valable, la session ne se referme pas.
    emit({ status: 'unlocked', key, privateKey: state.privateKey });
    return;
  }
  lockCustody();
  emit({ status: 'locked', key });
}

/** Range la privée déverrouillée pour la session. */
export function setCustodyUnlocked(key: CustodyKeyMaterial, privateKey: Uint8Array): void {
  if (state.status === 'unlocked' && state.privateKey !== privateKey) {
    state.privateKey.fill(0);
  }
  emit({ status: 'unlocked', key, privateKey });
}

/**
 * Reverrouille : la privée est ÉCRASÉE d'abord, puis oubliée. L'écrasement
 * n'est pas cosmétique — le tampon peut survivre à la référence dans le tas,
 * et c'est le seul geste d'hygiène disponible en JavaScript.
 */
export function lockCustody(): void {
  if (state.status === 'unlocked') {
    state.privateKey.fill(0);
    emit({ status: 'locked', key: state.key });
  }
}

/**
 * Oubli TOTAL — déconnexion, changement de compte. Repart de `unknown` : ce
 * que cette machine savait du compte précédent ne dit RIEN du suivant, et
 * garder `absent` ferait proposer de créer un coffre au compte d'après.
 */
export function clearCustodySession(): void {
  if (state.status === 'unlocked') state.privateKey.fill(0);
  emit({ status: 'unknown' });
}

/**
 * Publique utilisable pour SCELLER, même verrouillé. C'est ce qui permet de
 * renommer un partage sans redemander la phrase : sceller ne demande pas la
 * privée, seule la RELECTURE l'exige.
 */
export function custodyPublicKeyForSealing(): string | null {
  return state.status === 'locked' || state.status === 'unlocked'
    ? state.key.custodyPublicKey
    : null;
}

/** Privée de session, ou `null` si verrouillé. */
export function custodyPrivateKey(): Uint8Array | null {
  return state.status === 'unlocked' ? state.privateKey : null;
}

/** Réinitialisation complète — tests uniquement. */
export function resetCustodySessionForTests(): void {
  state = { status: 'unknown' };
  listeners.clear();
}
