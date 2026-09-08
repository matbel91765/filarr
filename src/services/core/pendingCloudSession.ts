/**
 * SESSION EN ATTENTE — se connecter AVANT de savoir dans quel profil atterrir.
 *
 * Sur le bureau, un profil est un domaine d'authentification : les jetons
 * vivent sous son dossier. « Ajouter un compte cloud » demande pourtant
 * l'ordre inverse — prouver son identité, découvrir les profils que le compte
 * possède déjà, et seulement ensuite en choisir un (ou en créer un s'il n'y en
 * a aucun).
 *
 * Sans zone d'attente, cette connexion écrirait ses jetons et sa clé de coffre
 * chez le DERNIER profil activé — celui d'un autre compte, resté « courant »
 * parce que revenir au sélecteur ne détache rien. Le côté principal ouvre donc
 * un domaine neutre le temps de la démarche, et l'activation du profil retenu
 * y déménage tout (cf. `profile:activate`).
 *
 * SUR LE WEB, la zone existe AUSSI, et pour la même raison : la session y est
 * celle du navigateur, mais l'ESTAMPILLE de compte et la CLÉ de coffre sont
 * celles d'un profil. Tant que la démarche est ouverte, le profil resté actif
 * n'est qu'un spectateur : rien ne l'estampille au nom du compte qu'on ajoute,
 * rien ne lui installe sa clé, aucun cycle de synchronisation ne le pousse dans
 * ce compte (src/platform/web/handlers/authHandlers.ts). Ces fonctions parlent
 * donc aux mêmes canaux sur les deux plateformes.
 */

interface Ipc {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function ipc(): Ipc | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { electron?: { ipcRenderer?: Ipc } }).electron?.ipcRenderer ?? null;
}

/** Vrai là où la zone d'attente a un sens (bureau et web). */
export function supportsPendingCloudSession(): boolean {
  return ipc() !== null;
}

/**
 * Ouvrir la zone. À appeler AVANT le premier appel d'authentification, sinon
 * les jetons partent chez le profil précédent — c'est tout l'objet du geste.
 */
export async function beginPendingCloudSession(): Promise<boolean> {
  const bridge = ipc();
  if (!bridge) return false;
  try {
    const res = (await bridge.invoke('auth:beginPendingSession')) as
      | { success?: boolean }
      | undefined;
    return res?.success === true;
  } catch (err) {
    console.error('[pendingCloudSession] begin failed:', err);
    return false;
  }
}

/**
 * Abandonner : la session est révoquée côté serveur puis effacée, et les
 * domaines reviennent au profil actif. Appelé quand la personne quitte la
 * démarche — jamais après une adoption, qui a déjà refermé la zone.
 */
export async function discardPendingCloudSession(): Promise<void> {
  const bridge = ipc();
  if (!bridge) return;
  try {
    await bridge.invoke('auth:discardPendingSession');
  } catch (err) {
    console.error('[pendingCloudSession] discard failed:', err);
  }
}
