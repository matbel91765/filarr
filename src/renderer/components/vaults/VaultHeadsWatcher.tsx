/**
 * VaultHeadsWatcher — LA PROPAGATION VIVANTE d'un coffre partagé.
 *
 * CE QU'IL FERME. Tout ce qui décrit un coffre était chargé UNE fois. Un membre
 * ajoutait un fichier, changeait un réglage, gelait le coffre ou retirait
 * quelqu'un : les autres écrans ouverts continuaient d'afficher l'état d'avant
 * jusqu'à un rechargement complet de l'application. Ce composant regarde
 * `GET /vaults/heads` et ne recharge QUE ce qui a bougé.
 *
 * MONTÉ À CÔTÉ DE `VaultsBootstrapHost`, ET POUR LA MÊME RAISON QUE LUI : les
 * lectures de session appartiennent à UN hôte unique, au seul point de l'arbre
 * où le profil est choisi, le coffre déverrouillé et le store hydraté. Un
 * guetteur par écran, ce serait autant de minuteries concurrentes que d'onglets
 * ouverts. Il ne rend rien.
 *
 * IL EST LÀ POUR CE QUE FONT LES AUTRES. Les gestes de l'utilisateur gardent
 * leur voie rapide — `reload()`, `afterRosterChange()`, les réducteurs
 * optimistes : personne n'attend le prochain tour pour voir son propre clic.
 *
 * LA CADENCE : 25 SECONDES, ET VOICI POURQUOI CE CHIFFRE. En dessous de ~15 s,
 * on paie une écriture de seau de débit et une agrégation D1 par espace pour
 * un écran que personne ne regarde forcément ; au-delà de ~40 s, l'attente
 * redevient assez longue pour qu'on ait le réflexe de recharger à la main — ce
 * qu'on cherche précisément à supprimer. 25 s tient les deux bouts, et le VRAI
 * cas d'usage n'est de toute façon pas la minuterie : c'est le RETOUR sur
 * l'onglet, servi par une interrogation immédiate.
 *
 * EN PAUSE HORS PREMIER PLAN. Une fenêtre masquée ou sans focus ne montre rien
 * à personne : continuer à sonder n'y ferait que dépenser la batterie et le
 * seau de débit. Le retour relance TOUT DE SUITE, et remet le recul à zéro.
 *
 * RECUL EXPONENTIEL sur échec ou 429, jusqu'à 5 minutes, retour à la cadence
 * normale au premier succès. Un worker en peine ne doit pas être martelé par
 * chaque client ouvert — c'est exactement la situation où ils sont tous en
 * échec en même temps.
 *
 * UN SONDAGE PAR ESPACE, comme `loadVaults`. La route est portée par UN espace
 * (X-Org-Id) tandis que la liste du magasin les fusionne tous : un compte peut
 * être chez lui ET invité ailleurs. Ne sonder que l'espace courant rendrait la
 * propagation muette exactement là où les coffres sont le plus partagés — et
 * ferait passer les coffres des autres espaces pour des coffres perdus. Les
 * espaces qui ont RÉPONDU sont donc nommés au modèle de décision, qui ne conclut
 * à une exclusion que dans ceux-là.
 *
 * CE QU'IL NE FAIT PAS. Pas de WebSocket, pas de salle par coffre. Le relais
 * collaboratif existe pour l'édition d'UNE note et reste ce qu'il est ; ici,
 * quelques secondes de retard sur un effectif ou un réglage ne coûtent rien,
 * et une connexion permanente par coffre ouvert en coûterait beaucoup.
 */

import React, { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../../store';
import { loadVaultItems, loadVaults } from '../../../store/slices/vaultsSlice';
import {
  selectCanUseTeamVaults,
  selectIsLocked,
  selectSharedVaultOrgIds,
} from '../../../store/selectors/authSelectors';
import { apiGetVaultHeads, type VaultHeadDTO } from '../../../services/vault/vaultApi';
import { invalidateVaultLive } from '../../../services/vault/vaultLiveRefresh';
import {
  subscribeVaultsListedElsewhere,
  vaultsListedElsewhere,
} from '../../../services/vault/vaultListedElsewhere';
import {
  diffVaultHeads,
  prochainDelai,
  rememberVaultHeads,
  vaultTargetsFromPanels,
  type KnownVault,
} from './vaultHeadsDiff';

export const VaultHeadsWatcher: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();

  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const cloudUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const isLocked = useSelector(selectIsLocked);
  const orgIds = useSelector(selectSharedVaultOrgIds);

  /**
   * Ce que le magasin porte, réduit à ce que la comparaison lit. Mémoïsé :
   * `useSelector` sur un objet reconstruit à chaque rendu ferait boucler React,
   * et la liste sert aussi de garde de démarrage (`known.length`).
   */
  const vaultsById = useSelector((s: RootState) => s.vaults.vaults);
  const vaultIds = useSelector((s: RootState) => s.vaults.vaultIds);
  const unlockedIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);
  const known = useMemo<KnownVault[]>(
    () =>
      vaultIds
        .map((id) => vaultsById[id])
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => ({
          vaultId: v.id,
          organizationId: v.organizationId,
          currentKeyEpoch: v.currentKeyEpoch,
          wrappedVaultKeyEpoch: v.wrappedVaultKeyEpoch,
          frozenAt: v.frozenAt ?? null,
        })),
    [vaultIds, vaultsById]
  );

  /**
   * LES COFFRES QU'ON REGARDE — l'onglet ACTIF de chaque panneau, la vue
   * scindée comprise. Un onglet en arrière-plan n'est pas « regardé » : ses
   * éléments seront relus à son activation, comme aujourd'hui.
   *
   * `?view=settings` distingue la page « Gérer le coffre » de l'explorateur :
   * elle a son propre chargeur, et c'est le seul écran qui doit être prévenu
   * d'un changement d'effectif pendant qu'il est ouvert.
   */
  const panels = useSelector((s: RootState) => s.tabs.panels);
  const { visibleVaultIds, managedVaultIds } = useMemo(
    () => vaultTargetsFromPanels(panels),
    [panels]
  );

  /**
   * LES COFFRES LISTÉS AILLEURS QUE DANS LEUR EXPLORATEUR — la section
   * « Coffres partagés » de l'onglet Notes, qui en montre plusieurs à la fois
   * depuis une route qui n'en nomme aucun.
   *
   * Ils ne se DÉDUISENT d'aucune route : c'est l'écran concerné qui les
   * DÉCLARE, et qui se retire quand il se replie ou se démonte. Le guetteur ne
   * fait que lire ce qu'on lui déclare — il n'invente jamais un coffre à
   * surveiller, faute de quoi la seule déduction possible serait « tous », et
   * il déchiffrerait en boucle des listes que personne ne regarde.
   */
  const listedVaultIds = useSyncExternalStore(
    subscribeVaultsListedElsewhere,
    vaultsListedElsewhere
  );

  /**
   * L'ÉTAT LU PAR LE TOUR EN COURS vit dans une ref, et c'est structurel : le
   * minuteur ne doit PAS être reconstruit à chaque navigation. Un effet dont
   * les dépendances contiendraient l'onglet actif redémarrerait son intervalle
   * à chaque clic — donc ne sonderait jamais chez quelqu'un qui navigue.
   */
  const etatRef = useRef({
    orgIds,
    known,
    visibleVaultIds,
    listedVaultIds,
    managedVaultIds,
    unlockedIds,
  });
  useEffect(() => {
    etatRef.current = {
      orgIds,
      known,
      visibleVaultIds,
      listedVaultIds,
      managedVaultIds,
      unlockedIds,
    };
  });

  /** Les têtes du tour PRÉCÉDENT — la moitié de la comparaison que Redux ne porte pas. */
  const memoireRef = useRef<Record<string, VaultHeadDTO>>({});

  const appliquer = useCallback(
    (heads: VaultHeadDTO[], covered: string[]) => {
      const {
        known: connus,
        visibleVaultIds: vus,
        listedVaultIds: listes,
        managedVaultIds: geres,
        unlockedIds: ouverts,
      } = etatRef.current;
      const d = diffVaultHeads({
        heads,
        coveredOrgIds: covered,
        known: connus,
        previous: memoireRef.current,
        // Un coffre VERROUILLÉ n'a pas sa clé en mémoire : `loadVaultItems` le
        // refuserait (« Vault is locked »). On ne le déclare donc pas
        // « regardé » — le déverrouillage relira, comme aujourd'hui.
        visibleVaultIds: vus.filter((id) => ouverts.includes(id)),
        // Même garde que pour les coffres regardés : une section peut déclarer
        // un coffre que l'utilisateur vient de reverrouiller entre deux tours.
        listedVaultIds: listes.filter((id) => ouverts.includes(id)),
        managedVaultIds: geres,
      });
      memoireRef.current = rememberVaultHeads(memoireRef.current, heads, covered, connus);

      if (d.reloadVaults) void dispatch(loadVaults());
      for (const id of d.reloadItems) void dispatch(loadVaultItems({ vaultId: id }));
      // Ces deux-là ne vivent pas dans Redux : leurs lectures sont des hooks à
      // instances multiples, invalidés par compteur (voir `vaultLiveRefresh`).
      for (const id of d.reloadSettings) invalidateVaultLive('settings', id);
      for (const id of d.reloadManagement) invalidateVaultLive('management', id);
    },
    [dispatch]
  );

  /**
   * LES QUATRE CONDITIONS. Un compte local n'a pas de coffres partagés ; un
   * compte sans droit non plus ; une application verrouillée ne doit rien
   * demander en notre nom ; et sans aucun coffre connu il n'y a rien à
   * surveiller. `orgIds` vide est le cinquième cas : c'est une course de
   * démarrage (la liste des espaces n'est pas encore là), et sonder le contexte
   * ambiant rendrait des têtes dont on ne saurait pas de quel espace elles
   * viennent — donc impossible de distinguer une exclusion d'un silence.
   */
  const actif =
    !!cloudUserId && canUseTeamVaults && !isLocked && known.length > 0 && orgIds.length > 0;

  useEffect(() => {
    if (!actif) return () => {};

    let annule = false;
    let enVol = false;
    let recul = 0;
    let minuteur: ReturnType<typeof setTimeout> | null = null;
    // `visibilitychange` couvre l'onglet masqué ; `blur` couvre la fenêtre
    // reléguée derrière une autre, que la visibilité seule déclare encore
    // « visible ». Les deux mènent au même état.
    let auPremierPlan = typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const planifier = (delai: number): void => {
      if (annule) return;
      if (minuteur) clearTimeout(minuteur);
      minuteur = setTimeout(() => {
        void tour();
      }, delai);
    };

    const tour = async (): Promise<void> => {
      // Déjà un tour en vol : il replanifiera lui-même. Ne pas replanifier ici
      // est ce qui empêche deux minuteries de se dédoubler à chaque retour au
      // premier plan.
      if (annule || enVol || !auPremierPlan) return;
      enVol = true;
      try {
        const cibles = etatRef.current.orgIds;
        const reponses = await Promise.allSettled(cibles.map((id) => apiGetVaultHeads(id)));
        if (annule) return;
        const heads: VaultHeadDTO[] = [];
        const covered: string[] = [];
        reponses.forEach((r, i) => {
          if (r.status !== 'fulfilled') return;
          heads.push(...r.value);
          covered.push(cibles[i]);
        });
        if (covered.length === 0) {
          // Rien n'a répondu (panne, hors ligne, 429 — le seau est PAR
          // UTILISATEUR, donc tous les espaces tombent ensemble). On ne conclut
          // rien et on ralentit.
          recul += 1;
        } else {
          recul = 0;
          appliquer(heads, covered);
        }
      } catch {
        // `Promise.allSettled` n'en laisse pas passer, mais un `apiGetVaultHeads`
        // qui échouerait de façon synchrone ne doit pas tuer la minuterie.
        recul += 1;
      } finally {
        enVol = false;
        if (!annule && auPremierPlan) planifier(prochainDelai(recul));
      }
    };

    const reprendre = (): void => {
      auPremierPlan = true;
      // LE RETOUR EST UN NOUVEAU DÉPART : le recul accumulé pendant une absence
      // (souvent une mise en veille, pas une panne) n'a plus rien à punir.
      recul = 0;
      // Interrogation IMMÉDIATE — c'est le cas d'usage principal : je reviens
      // sur la fenêtre, je veux voir l'état vrai, pas l'état d'il y a 25 s.
      planifier(0);
    };

    const suspendre = (): void => {
      auPremierPlan = false;
      if (minuteur) {
        clearTimeout(minuteur);
        minuteur = null;
      }
    };

    const surVisibilite = (): void => {
      if (document.visibilityState === 'hidden') suspendre();
      else reprendre();
    };

    document.addEventListener('visibilitychange', surVisibilite);
    window.addEventListener('focus', reprendre);
    window.addEventListener('blur', suspendre);

    // Premier tour tout de suite : il POSE la mémoire de comparaison, et c'est
    // aussi la seule occasion de rattraper un écart survenu avant le montage
    // (une rotation, un gel, une exclusion pendant que l'application était
    // fermée) — le modèle ne compare alors que ce que le magasin porte déjà.
    if (auPremierPlan) planifier(0);

    return () => {
      annule = true;
      if (minuteur) clearTimeout(minuteur);
      document.removeEventListener('visibilitychange', surVisibilite);
      window.removeEventListener('focus', reprendre);
      window.removeEventListener('blur', suspendre);
    };
  }, [actif, appliquer]);

  /**
   * La mémoire ne survit pas à un changement de compte : les têtes d'un autre
   * utilisateur feraient conclure n'importe quoi au premier tour suivant.
   */
  useEffect(() => {
    memoireRef.current = {};
  }, [cloudUserId]);

  return null;
};

export default VaultHeadsWatcher;
