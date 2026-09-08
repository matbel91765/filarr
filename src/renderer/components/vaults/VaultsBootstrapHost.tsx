/**
 * VaultsBootstrapHost — L'AUTORITÉ UNIQUE DE CHARGEMENT des coffres partagés.
 *
 * CE QUI SE PASSAIT AVANT. Quatre endroits déclenchaient le premier
 * chargement des coffres, chacun avec sa propre garde locale (une ref « déjà
 * demandé ? » par composant) : l'accueil, le hook des cibles d'ajout monté par
 * l'accueil, l'explorateur ET la liste des notes, la vue des coffres. Au
 * premier rendu, ces gardes ne se voyaient pas les unes les autres : autant de
 * requêtes identiques que d'écrans montés, aucune ne profitant du résultat des
 * autres. Le balayage des intentions (0073), lui, vivait dans `VaultsList` —
 * donc rejoué à chaque montage de la page, et concurrent de lui-même si la
 * page était montée deux fois (onglets scindés) : le serveur refusait le
 * second scellement en `already_invited`, et l'hôte lisait un refus là où
 * tout s'était bien passé.
 *
 * CE QUE FAIT CE COMPOSANT. Rien à l'écran (il rend `null`) ; il est monté
 * UNE fois, à côté de `PendingInviteHost`, au seul point de l'arbre où le
 * profil est choisi, le coffre déverrouillé, le Router monté et le store
 * hydraté. De là, il porte les quatre lectures de session :
 *   (a) le premier chargement des coffres — via `ensureVaultsLoaded`, dont la
 *       garde vit DANS la slice (un drapeau d'état), pas ici ;
 *   (b) le balayage des intentions d'accès, rejoué à chaque changement de la
 *       liste des coffres DÉVERROUILLÉS — la première occasion où le travail
 *       devient possible — jamais deux fois en même temps ;
 *   (c) la boîte de réception d'invitations du compte, dès la connexion ;
 *   (d) « Partagé avec moi », dès la connexion — pour un compte GRATUIT sans
 *       coffre, l'entrée de la barre latérale n'existerait jamais sinon.
 *
 * Les écrans, eux, ne font plus que LIRE. Les « Réessayer » explicites
 * continuent d'appeler `loadVaults` nu : une relance demandée par l'utilisateur
 * n'a pas à passer par une garde.
 */

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../../store';
import { useNotification } from '../ui/Notification';
import {
  ensureVaultsLoaded,
  fetchMyInvitations,
  loadVaultActivityHeads,
  sweepPendingGrants,
} from '../../../store/slices/vaultsSlice';
import { fetchSharedWithMe } from '../../../store/slices/sharedWithMeSlice';
import { loadShareHeads } from '../../../store/slices/shareIndexSlice';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { subscribeUserKeypair } from '../../../services/auth/userKeypair';
import { reportToLog } from '../../../services/platform/reportToLog';

export const VaultsBootstrapHost: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success } = useNotification();

  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const cloudUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const unlockedIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);
  const vaultIds = useSelector((s: RootState) => s.vaults.vaultIds);
  const sharedStatus = useSelector((s: RootState) => s.sharedWithMe.status);
  const sharedError = useSelector((s: RootState) => s.sharedWithMe.error);

  // (a) Le premier chargement. Aucune garde ici : `ensureVaultsLoaded` la
  // porte dans l'état, et refuse de relancer une fois la demande posée — même
  // si le droit aux coffres clignote (les orgs arrivent après la session).
  useEffect(() => {
    // Le refus aussi se journalise : « jamais demandé » et « demandé, zéro
    // coffre » étaient indiscernables à l'écran comme dans la console.
    if (canUseTeamVaults) {
      reportToLog('vaults', 'chargement demandé (droit coffres OK)');
      void dispatch(ensureVaultsLoaded());
    } else {
      reportToLog('vaults', 'chargement NON demandé : droit coffres absent (tier local/free ?)');
    }
  }, [canUseTeamVaults, dispatch]);

  /**
   * (a bis) LA SECONDE CHANCE, quand la première a échoué transitoirement.
   *
   * Le premier chargement part dès que le DROIT est connu — et le droit vient
   * de l'utilisateur mis en cache sur disque, donc parfois avant que le jeton
   * d'accès n'arrive du processus principal. `apiClient` rejette alors la
   * requête sans même l'envoyer (« No access token available »), et la garde
   * d'`ensureVaultsLoaded` interdit tout rechargement de la session.
   *
   * Résultat observé en production : une course perdue de quelques
   * millisecondes au démarrage coûtait TOUS les coffres jusqu'au prochain
   * lancement — qui reperdait la même course, puisqu'elle se joue toujours
   * dans le même ordre.
   *
   * `loadVaults.rejected` rouvre désormais la porte sur un échec transitoire ;
   * il reste à repasser. Trois tentatives espacées, et on s'arrête : au-delà,
   * ce n'est plus une course, c'est une panne — et battre contre un mur ne la
   * réparerait pas.
   */
  const loadError = useSelector((s: RootState) => s.vaults.error);
  const requested = useSelector((s: RootState) => s.vaults.initialLoadRequested);
  const retriesRef = useRef(0);
  useEffect(() => {
    if (!canUseTeamVaults || !loadError || requested) return;
    if (retriesRef.current >= 3) return;
    retriesRef.current += 1;
    const timer = window.setTimeout(
      () => void dispatch(ensureVaultsLoaded()),
      // 400 ms, 1,2 s, 3,6 s : la première couvre la course, les suivantes un
      // réseau qui tarde. Immédiat rejouerait la même course perdue.
      400 * 3 ** (retriesRef.current - 1)
    );
    return () => window.clearTimeout(timer);
  }, [canUseTeamVaults, loadError, requested, dispatch]);

  /**
   * (b) LE BALAYAGE DES INTENTIONS (0073) — le second geste de l'hôte, rendu
   * inutile.
   *
   * LA DÉPENDANCE EST LA LISTE DES COFFRES DÉVERROUILLÉS, et c'est le fond de
   * l'effet : un coffre verrouillé ne porte pas K_vault en mémoire, donc rien à
   * sceller. Rejouer au déverrouillage, c'est saisir la première occasion où le
   * travail devient possible ; se contenter du montage la manquerait à chaque
   * fois qu'on déverrouille après coup. Aucun sondage périodique — un scellement
   * n'a pas besoin d'être immédiat, seulement d'être CERTAIN d'arriver.
   *
   * `inFlight` empêche deux balayages concurrents : chacun émet des e-mails, et
   * deux passages qui se croisent scelleraient deux fois la même personne — le
   * serveur refuserait le second en `already_invited`, mais l'hôte lirait un
   * refus là où tout s'est bien passé.
   */
  const unlockedKey = unlockedIds.join(',');
  const sweepInFlight = useRef(false);
  useEffect(() => {
    // Aucun coffre deverrouille : rien ne porte K_vault en memoire, donc rien a
    // sceller - et c'est aussi ce qui fait de `unlockedKey` une dependance
    // REELLEMENT lue, plutot qu'un declencheur greffe de l'exterieur.
    if (!unlockedKey || sweepInFlight.current) return;
    sweepInFlight.current = true;
    void (async () => {
      try {
        // La langue de l'hôte suit le balayage : l'avis d'accès que le Worker
        // poste à la personne ajoutée parle celle de qui donne, comme les
        // invitations — un geste automatique ne doit pas basculer en anglais
        // là où le même geste fait à la main aurait parlé français.
        const outcome = await dispatch(sweepPendingGrants({ lang: i18n.language }));
        const granted = sweepPendingGrants.fulfilled.match(outcome) ? outcome.payload.granted : [];
        // On n'annonce QUE ce qui vient d'arriver. Les blocages, eux, vivent
        // dans l'écran (`VaultAccessNotices`) : une clé à vérifier hors bande
        // est une action qui attend, pas un événement qui passe.
        if (granted.length === 1) {
          success(t('teamVaults.access.grantedOne', { email: granted[0].email }));
        } else if (granted.length > 1) {
          success(t('teamVaults.access.grantedMany', { count: granted.length }));
        }
      } finally {
        sweepInFlight.current = false;
      }
    })();
  }, [unlockedKey, dispatch, success, t, i18n.language]);

  /**
   * (e) LES TÊTES DE PARTAGE — l'effectif de chaque coffre, pour le « · N »
   * des cartes. UNE requête pour toutes les cartes (le contrat de
   * `shareIndexSlice` : jamais un appel par carte), lancée dès que la LISTE
   * des coffres est là — c'est-à-dire après le premier `loadVaults` réussi,
   * puisque `vaultIds` n'est écrit qu'à son `fulfilled`. La clé jointe fait
   * de la liste une dépendance réellement lue : un coffre créé, rejoint ou
   * quitté change la clé et redemande les têtes, ce qui est exactement le
   * moment où l'ancien effectif devient faux. Liste vide = aucune carte à
   * renseigner = rien à demander. Hors nuage, la `condition` du thunk en fait
   * un no-op sans même de `pending`.
   */
  const vaultsKey = vaultIds.join(',');
  useEffect(() => {
    if (!vaultsKey) return;
    void dispatch(loadShareHeads());
    // (f) LES TÊTES DU FIL D'ACTIVITÉ — la pastille des cartes de l'accueil
    // (lot A, C4). Même cadence et même raison que les têtes de partage : une
    // requête pour toutes les cartes, relancée quand la liste change. Le thunk
    // avale l'échec (pas de pastille vaut mieux qu'une erreur).
    void dispatch(loadVaultActivityHeads());
  }, [vaultsKey, dispatch]);

  // (c) Ce qui attend l'adresse du compte, à travers tous les locataires.
  // Dès la connexion, pas seulement à l'ouverture de l'écran des coffres : la
  // question « quelque chose m'attend-il ? » se pose avant qu'on aille voir.
  useEffect(() => {
    if (cloudUserId) void dispatch(fetchMyInvitations());
  }, [cloudUserId, dispatch]);

  // (d) « Partagé avec moi ». La sentinelle 'idle' évite la boucle : le slice
  // passe à 'loading' dès le pending, et ne revient jamais à 'idle' tout seul.
  useEffect(() => {
    if (cloudUserId && sharedStatus === 'idle') void dispatch(fetchSharedWithMe());
  }, [cloudUserId, sharedStatus, dispatch]);

  /**
   * (g) L'ARRIVÉE DE LA PAIRE DE CLÉS — le moment où (a) et (d) deviennent
   * définitifs.
   *
   * Les deux lectures ci-dessus partent au démarrage, souvent AVANT la paire de
   * clés (chargée paresseusement : mot de passe saisi après coup, gate à la
   * demande). Un chargement fait sans la clé n'est pas définitif : les coffres
   * restent « verrouillés » et « Partagé avec moi » reste en attente ('locked').
   * Avant, rien n'observait la pose de la clé : l'état restait figé jusqu'à un
   * « Réessayer ». Ici on s'abonne au module, et à la pose on rejoue UNE fois :
   *   · `ensureVaultsLoaded` — sa garde sait déjà ne recharger que si le
   *     dernier chargement n'avait pas la clé (`lastLoadHadKeypair`) ;
   *   · `fetchSharedWithMe` — seulement si la lecture attendait la clé
   *     ('idle', 'locked', ou l'ancien refus 'keypair_needed' pour compat). Une
   *     erreur réelle reste à l'utilisateur (« Réessayer »).
   * L'effacement (déconnexion) ne fait rien : les purges existent déjà.
   * C'est le SEUL émetteur de `fetchSharedWithMe` à l'arrivée de la clé — le
   * gate n'en ajoute pas.
   */
  useEffect(() => {
    if (!cloudUserId) return undefined;
    return subscribeUserKeypair((present) => {
      if (!present) return;
      void dispatch(ensureVaultsLoaded());
      const awaitingKey =
        sharedStatus === 'idle' ||
        sharedStatus === 'locked' ||
        (sharedStatus === 'error' && sharedError === 'keypair_needed');
      if (awaitingKey) void dispatch(fetchSharedWithMe());
    });
  }, [cloudUserId, sharedStatus, sharedError, dispatch]);

  return null;
};

export default VaultsBootstrapHost;
