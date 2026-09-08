/**
 * La clé de garde du compte, vue par React.
 *
 * Un seul hook, parce qu'il n'y a qu'UNE session par fenêtre et qu'elle vit
 * dans `services/custody/custodySession` — pas dans Redux. La raison est écrite
 * là-bas et vaut d'être rappelée : un secret vivant n'a rien à faire dans un
 * magasin inspectable par les devtools, sérialisé par `redux-logger` et
 * persisté au premier ajout de reducer distrait.
 *
 * CE QUE LE HOOK FAIT AU MONTAGE, dans cet ordre et pas un autre :
 *   1. il demande au serveur le matériel de clé (`custody:key`) ;
 *   2. si une clé existe, il tente la mémoire « se souvenir sur cet appareil »
 *      — silencieusement : son absence est le cas NORMAL, pas un incident ;
 *   3. il sonde Argon2, pour ne pas offrir un champ de saisie que la machine ne
 *      saurait pas honorer.
 *
 * IL NE DEMANDE RIEN EN MODE LOCAL ni sans compte : la clé de garde est un
 * objet de COMPTE, et partir chercher une route authentifiée sans session ne
 * produirait qu'un 401 dans le journal.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  custodyPhase,
  fetchCustodyKey,
  forgetRememberedCustody,
  getCustodySession,
  isCustodyArgon2Available,
  lockCustody,
  rememberCustody as rememberOnDevice,
  rememberedCustodyStatus,
  restoreRememberedCustody,
  setCustodyKey,
  setCustodyUnlocked,
  subscribeCustodySession,
  unlockCustody,
  type CustodyPhase,
  type CustodySessionState,
  type RememberStatus,
} from '../services/custody';

export interface UseCustodyResult {
  session: CustodySessionState;
  phase: CustodyPhase;
  /** État de l'option « se souvenir » — pour la case et le bouton d'oubli. */
  remember: RememberStatus;
  /** Vrai tant que le premier aller serveur n'a pas rendu son verdict. */
  loading: boolean;
  /**
   * Déverrouille. Rend `true` sur succès ; LÈVE sur échec, pour que l'appelant
   * traduise la cause (`custodyUnlockErrorOf`) plutôt que de recevoir un
   * booléen muet qui ne distingue pas « mauvaise phrase » de « clé abîmée ».
   */
  unlock: (passphrase: string, rememberOnThisDevice: boolean) => Promise<boolean>;
  /** Reverrouille pour cette session, sans toucher à la mémoire de l'appareil. */
  lock: () => void;
  /** Efface la mémoire de l'appareil ET reverrouille : le bouton « oublier ». */
  forget: () => Promise<void>;
  /** Relit le matériel de clé auprès du serveur. */
  refresh: () => Promise<void>;
}

export function useCustody(enabled: boolean): UseCustodyResult {
  const [session, setSession] = useState<CustodySessionState>(getCustodySession);
  const [argon2Available, setArgon2Available] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [remember, setRemember] = useState<RememberStatus>({
    available: false,
    remembered: false,
    expiresAt: null,
  });

  useEffect(() => subscribeCustodySession(setSession), []);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const key = await fetchCustodyKey();
      setFetchFailed(false);
      setCustodyKey(key);
      if (key) {
        // Silencieux : une mémoire absente est le cas NORMAL. Seul un
        // `mismatch` a détruit quelque chose, et il n'y a rien à en dire —
        // l'écran demandera la phrase, ce qui est déjà le bon message.
        await restoreRememberedCustody(key);
      }
    } catch {
      // On n'AFFIRME rien : la session reste `unknown`, la bannière dira
      // « indisponible » et non « ce compte n'a pas de coffre ».
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let vivant = true;
    void (async () => {
      const [dispo, statut] = await Promise.all([
        isCustodyArgon2Available(),
        rememberedCustodyStatus(),
      ]);
      if (!vivant) return;
      setArgon2Available(dispo);
      setRemember(statut);
      await refresh();
    })();
    return () => {
      vivant = false;
    };
  }, [enabled, refresh]);

  const unlock = useCallback(async (passphrase: string, rememberOnThisDevice: boolean) => {
    const current = getCustodySession();
    if (current.status !== 'locked') return false;
    const priv = await unlockCustody(passphrase, current.key);
    setCustodyUnlocked(current.key, priv);
    if (rememberOnThisDevice) {
      // Un échec de mémoire ne défait PAS le déverrouillage : la session est
      // ouverte, seul le confort du prochain lancement manque.
      await rememberOnDevice(current.key, priv);
      setRemember(await rememberedCustodyStatus());
    }
    return true;
  }, []);

  const lock = useCallback(() => {
    lockCustody();
  }, []);

  const forget = useCallback(async () => {
    await forgetRememberedCustody();
    lockCustody();
    setRemember(await rememberedCustodyStatus());
  }, []);

  return {
    session,
    phase: custodyPhase({
      signedIn: enabled,
      argon2Available,
      session: session.status,
      loading,
      fetchFailed,
    }),
    remember,
    loading,
    unlock,
    lock,
    forget,
    refresh,
  };
}
