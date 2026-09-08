/**
 * useMemberKeyWatch (F11) — le contrôle des clés du coffre, branché sur un écran.
 *
 * LA RÉPARTITION DES RÔLES, ET ELLE EST STRICTE : le service
 * (`services/vault/memberKeyWatch`) lit le réseau et range ; le modèle pur
 * (`memberTrustModel`) décide ce que ça VEUT DIRE ; ce hook ne fait que les
 * relier et prévenir React. Aucun verdict ne se calcule ici — c'est ce qui
 * permet de les éprouver en vitest, sans DOM ni réseau.
 *
 * DEUX ÉCRANS LISENT LE MÊME FAIT. La page « Gérer » contrôle et affiche ; le
 * bouton « Gérer » de l'explorateur ne montre qu'un point rouge, et il ne
 * déclenche AUCUN réseau — il relit ce que la dernière visite a déposé. Un badge
 * qui lancerait deux cents lectures à chaque ouverture d'un dossier coûterait
 * exactement ce que la fiche cherche à éviter (§7, amplification de lecture).
 * Le point rouge dit donc « la dernière fois qu'on a regardé », ce qui est
 * l'information honnête ; la page, elle, regarde pour de bon.
 *
 * ON NE DÉPOSE RIEN TANT QU'ON N'A RIEN VU. Publier une liste d'alertes vide
 * avant le premier contrôle effacerait le point rouge posé par la visite
 * précédente — c'est-à-dire qu'une page ouverte hors ligne annulerait une alerte
 * réelle. Une absence d'information ne remplace pas une information.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  getMemberKeyReport,
  getVaultKeyAlerts,
  getVerifiedMark,
  markMemberVerified,
  memberKeyWatchVersion,
  setVaultKeyAlerts,
  subscribeMemberKeyWatch,
  watchVaultMemberKeys,
} from '../../../../services/vault/memberKeyWatch';
import {
  alertingMembers,
  memberTrust,
  trustCounter,
  type MemberTrustVerdict,
} from './memberTrustModel';

export interface MemberKeyWatch {
  /** Le verdict de chaque membre — la colonne « Confiance ». */
  verdicts: Record<string, MemberTrustVerdict>;
  /** « N vérifiés sur M ». */
  counter: { verified: number; total: number };
  /** Ceux dont la clé alerte : bandeau rouge, point rouge, filtre « Clé changée ». */
  alerts: string[];
  /** Le même ensemble, prêt pour le filtre de F09. */
  keyChanged: Set<string>;
  /** Un contrôle est en cours — l'écran le dit plutôt que d'afficher « inconnu ». */
  checking: boolean;
  /** Tout revérifier, cache ignoré (le bouton du tiroir). */
  recheck: () => void;
  /** « J'ai comparé ce numéro » : la marque locale ET `acceptPeerKeyChange`. */
  confirm: (userId: string, fingerprint: string) => void;
}

/** Le vide, hors de toute lecture — un objet stable, pour ne pas re-rendre. */
const AUCUN: Record<string, MemberTrustVerdict> = {};

export function useMemberKeyWatch(vaultId: string, userIds: readonly string[]): MemberKeyWatch {
  /**
   * Les identifiants en une CHAÎNE : le tableau est reconstruit à chaque rendu
   * par l'appelant (`rows.map(...)`), et le prendre en dépendance relancerait le
   * contrôle à chaque frame. La chaîne, elle, ne change que quand l'effectif
   * change vraiment.
   */
  const key = userIds.join(',');
  const version = useSyncExternalStore(subscribeMemberKeyWatch, memberKeyWatchVersion);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return () => {};
    let vivant = true;
    setChecking(true);
    void watchVaultMemberKeys(ids, { cancelled: () => !vivant }).finally(() => {
      if (vivant) setChecking(false);
    });
    // Quitter la page ne doit pas laisser des pages de contrôle en vol pour un
    // tableau démonté : le service consulte ce drapeau ENTRE deux pages.
    return () => {
      vivant = false;
    };
  }, [key]);

  const verdicts = useMemo(() => {
    // `version` n'est pas LU par ce calcul : il en est la raison. Les rapports
    // et les marques vivent dans un store externe (`memberKeyWatch`), que React
    // ne peut pas observer ; c'est ce compteur qui dit qu'ils viennent de
    // bouger. Le mentionner ici le rend dépendance de plein droit plutôt que
    // dépendance « inutile » signalée par le linter — et une directive
    // `eslint-disable` sur react-hooks fait ÉCHOUER le build de ce dépôt.
    void version;
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return AUCUN;
    const out: Record<string, MemberTrustVerdict> = {};
    for (const userId of ids) {
      const r = getMemberKeyReport(userId);
      out[userId] = memberTrust({
        status: r?.status ?? null,
        served: r?.fingerprint ?? null,
        pinned: r?.pinned ?? null,
        mark: getVerifiedMark(vaultId, userId),
      });
    }
    return out;
  }, [key, vaultId, version]);

  const alerts = useMemo(() => alertingMembers(verdicts), [verdicts]);
  const counter = useMemo(() => trustCounter(verdicts), [verdicts]);
  const alertKey = alerts.join(',');

  /**
   * A-t-on contrôlé QUOI QUE CE SOIT ? Tant que non, on ne dépose pas de liste
   * d'alertes : elle serait vide, et effacerait le point rouge que la visite
   * précédente avait posé à juste titre.
   */
  const vu = useMemo(
    () => Object.values(verdicts).some((v) => v.reason !== 'not_checked'),
    [verdicts]
  );

  useEffect(() => {
    if (!vu) return () => {};
    setVaultKeyAlerts(vaultId, alertKey ? alertKey.split(',') : []);
    return () => {};
  }, [vaultId, alertKey, vu]);

  const recheck = useCallback(() => {
    const ids = key ? key.split(',') : [];
    if (ids.length === 0) return;
    setChecking(true);
    void watchVaultMemberKeys(ids, { force: true }).finally(() => setChecking(false));
  }, [key]);

  const confirm = useCallback(
    (userId: string, fingerprint: string) => markMemberVerified(vaultId, userId, fingerprint),
    [vaultId]
  );

  /** Le même fait, en ensemble : c'est ainsi que le filtre de F09 le consomme. */
  const keyChanged = useMemo(() => new Set(alerts), [alerts]);

  return { verdicts, counter, alerts, keyChanged, checking, recheck, confirm };
}

/**
 * Le point rouge du bouton « Gérer », dans l'explorateur. Aucune requête : il
 * relit ce que la page a déposé, et ne prétend donc jamais dire l'état de
 * l'instant (voir l'en-tête).
 *
 * `canManage` N'EST PAS UN SECRET GARDÉ, C'EST LA PROMESSE DU POINT. Les
 * alertes sont rangées par APPAREIL (`filarr.kt.alerts.<coffre>`), pas par rôle
 * : un administrateur rétrogradé, ou un autre profil de la même machine, les
 * relisait telles quelles. Or la page, elle, ne contrôle les clés QUE pour qui
 * gère le coffre — le point menait donc à un écran sans bandeau, sans colonne
 * « Confiance » et sans geste possible. Un signal qui ne mène à rien apprend à
 * ignorer les signaux : ici, il se tait.
 */
export function useVaultKeyAlertCount(vaultId: string, canManage: boolean): number {
  const version = useSyncExternalStore(subscribeMemberKeyWatch, memberKeyWatchVersion);
  return useMemo(() => {
    // Même raison que ci-dessus : une alerte acquittée dans la page doit
    // éteindre le point sans qu'on ait à repasser par la route.
    void version;
    if (!canManage) return 0;
    return getVaultKeyAlerts(vaultId)?.userIds.length ?? 0;
  }, [vaultId, version, canManage]);
}

export default useMemberKeyWatch;
