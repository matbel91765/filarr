/**
 * VaultSettingsView — la page « Gérer le coffre » (F01).
 *
 * CE QU'ELLE REMPLACE. Trois surfaces disaient la même chose, mal : le volet
 * latéral « Membres » de l'explorateur (380 px pour un tableau de cinq
 * colonnes), le même volet rendu en modale derrière « Paramètres avancés » du
 * dialogue de partage, et l'ancien `InviteMemberModal` où deux boutons sans
 * rapport (« Invite » = l'espace, « Give access » = le coffre) se disputaient
 * le même écran. Une seule page, à sa propre adresse, avec de la place.
 *
 * L'ADRESSE EST UNE REQUÊTE, PAS UN SEGMENT :
 * `/vault-folder/<id>?view=settings&tab=…`. La regex de `vaultTargetFromRoute`
 * est gourmande — `/vault-folder/<id>/settings` donnerait `vaultId` =
 * « <id>/settings » et l'écran « Coffre introuvable ». Le pathname reste donc
 * celui de l'explorateur, avec son titre d'onglet et sa persistance ; c'est le
 * précédent de `?item=` et de `/settings?cat=`.
 *
 * LA MISE EN PAGE EST UN FLUX DE BLOCS. La console (`ent-console`) est une
 * colonne flex mais SANS hauteur imposée : c'est l'enveloppe qui défile. Lui
 * donner `h-full` ferait rétrécir les cartes au lieu de les faire défiler — les
 * `AdminSection` portent `overflow: hidden` (coins arrondis), et un enfant flex
 * dont l'overflow n'est pas `visible` a une `min-height` automatique de zéro.
 * C'est le piège qui avait comprimé le tableau des membres à une soixantaine de
 * pixels dans le volet latéral.
 *
 * LE RÔLE NE FAIT QUE RANGER L'ÉCRAN. Le worker refait ses propres gardes
 * (`requireVaultRole`) sur chaque route appelée ici ; masquer un onglet est un
 * confort, jamais une autorisation.
 *
 * F28 — TROIS BANDES, MESURÉES SUR LA SURFACE DE LA PAGE, JAMAIS SUR LA FENÊTRE.
 * L'application ne défile pas dans la fenêtre (`body { overflow: hidden }`) et
 * cette page vit à côté d'une barre latérale rétractable : `window.innerWidth`
 * ne dit RIEN de la place réellement offerte ici — c'est le piège qui avait
 * faussé l'ancrage de la liste de suggestions. On mesure donc l'ENVELOPPE qui
 * défile (`useContainerBreakpoint`, un `ResizeObserver`) et non la colonne
 * plafonnée à 1120 px qu'elle contient : la colonne ne pourrait jamais atteindre
 * 1200, si bien que la bande « large » n'existerait pas.
 *
 * La bande descend en CLASSE sur la console (`ent-console--band-*`, pour ce que
 * le CSS sait faire seul) ET en PROP aux onglets (pour ce qu'il ne sait pas
 * faire : un tableau de six colonnes ne se replie pas, il POUSSE — sous 840 la
 * page rend des cartes, et ne monte pas le tableau du tout).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Button, PromptModal, Tabs, tabPanelProps, type TabDescriptor } from '../../ui';
import { useNotification } from '../../ui/Notification';
import { InfoCallout, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import '../../settings/enterprise/enterprise.css';
import { vaultErrorKey, errorText } from '../../../../services/vault/vaultErrorMessages';
import type { AppDispatch, RootState } from '../../../../store';
import { loadVaultItems, renameVault, selectVaultById } from '../../../../store/slices/vaultsSlice';
import { selectOrgs, selectSharedVaultOrgId } from '../../../../store/selectors/authSelectors';
import { VAULT_ROLE_TONE } from './vaultRoleTone';
import { resolveVaultTab, visibleVaultTabs, type VaultTabId } from './vaultManagementModel';
import { useVaultManagement } from './useVaultManagement';
import { useMemberKeyWatch } from './useMemberKeyWatch';
import { useVaultStats } from './useVaultStats';
import { useVaultActivityPreview } from './useVaultActivityPreview';
import { useVaultGrants } from './useVaultGrants';
import { mayReadVaultStats } from './vaultStatsModel';
import { authoritativeItemIds } from './grantOverviewModel';
import { orphanedMembers } from './orphanedMembers';
import { groupInvites } from './inviteLifecycleModel';
import { buildAccessJourneys, pendingAccessJourneys } from './accessJourneyModel';
import { buildTodoRows, vaultSettingsEmptyStates } from './vaultSettingsEmptyStates';
import { dangerGuard, vaultSpaceIdentity } from './vaultSettingsModel';
import { useVaultKeyHistory } from './useVaultKeyHistory';
import { mySealVerdict, sealVerdictAlerts } from './epochCoverage';
import { isVaultUnlocked } from '../../../../services/vault/vaultKeyCache';
import { hasUserKeypair, subscribeUserKeypair } from '../../../../services/auth/userKeypair';
import { VaultGlyph, vaultTintStyle } from '../VaultGlyph';
import { VaultFrozenBanner } from '../VaultFrozenBanner';
import { VaultAppearanceModal } from '../VaultAppearanceModal';
import { useVaultAppearance } from '../useVaultAppearance';
import { useVaultPin } from './useVaultPin';
import { useContainerBreakpoint } from '../../../styles/useContainerBreakpoint';
import { vaultFolderRoute } from '../../layout/RouteContent/routeCompat';
import { VaultKeySection } from './VaultKeySection';
import { OverviewTab } from './OverviewTab';
import { MembersTab } from './MembersTab';
import { InvitationsTab } from './InvitationsTab';
import { ActivityTab } from './ActivityTab';
import { SettingsTab } from './SettingsTab';
import { DangerTab } from './DangerTab';

interface Props {
  vaultId: string;
  /** L'onglet demandé par l'URL — validé pour mon rôle avant d'être suivi. */
  tab?: string;
  /** La ligne à mettre en évidence (`?focus=`), transmise à l'onglet concerné. */
  focus?: string;
  /** Retour à l'explorateur du coffre. */
  onExit: () => void;
  /** Changer d'onglet — l'appelant décide comment l'URL le retient. */
  onTabChange: (tab: VaultTabId) => void;
}

const PencilIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="14"
    height="14"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const TAB_ICONS: Record<VaultTabId, React.ReactNode> = {
  overview: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  members: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  ),
  invitations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  ),
  danger: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

const TAB_IDS = 'vault-settings';

export const VaultSettingsView: React.FC<Props> = ({
  vaultId,
  tab,
  focus,
  onExit,
  onTabChange,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const vault = useSelector((s: RootState) => selectVaultById(s, vaultId));
  const myRole = vault?.role ?? 'viewer';
  const mgmtBase = useVaultManagement(vaultId, myRole);
  const blockedGrants = useSelector((s: RootState) => s.vaults.blockedGrants);
  const orgs = useSelector(selectOrgs);
  const [renaming, setRenaming] = useState(false);
  /** La fenêtre d'apparence (F14) — ouverte par le glyphe de l'en-tête. */
  const [styling, setStyling] = useState(false);

  const activeTab = resolveVaultTab(tab, myRole);

  /**
   * L'APPARENCE EFFECTIVE (F14) : celle de l'enveloppe, recouverte par le repère
   * personnel de cet appareil. Une seule fusion pour toute l'application — le
   * hook est le même que celui des cartes de l'accueil et du fil d'Ariane.
   */
  const appearance = useVaultAppearance(vault);

  /**
   * LA FRISE DES CLÉS (F10), lue par la PAGE. Deux lectures constantes (les
   * scellés qu'on me garde, les rotations du fil), pas une par montage
   * d'onglet : c'est le même raisonnement que les agrégats et l'aperçu du fil,
   * et il vaut d'autant plus ici que la section vit dans un onglet qu'on ouvre
   * et referme.
   */
  const keyHistory = useVaultKeyHistory(vaultId, vault?.currentKeyEpoch ?? 0, {
    // SON SEUL LECTEUR EST UN ONGLET RÉSERVÉ AUX ADMINISTRATEURS. « Réglages »
    // n'existe pas en dessous de ce rang (`ADMIN_ONLY_TABS`) : sans ce garde, un
    // membre ou un lecteur payait `/key-wraps` ET une page de fil à chaque
    // ouverture de la page, pour un écran qu'il ne verra jamais.
    enabled: mgmtBase.canManage,
  });

  /**
   * LE COFFRE VIT-IL DANS MON ESPACE ? La question n'a l'air de rien et décide
   * d'un chiffre faux : `GET /vaults/seats` répond pour l'espace AMBIANT
   * (l'en-tête X-Org-Id), pas pour l'espace du coffre. Chez un hôte qui m'a
   * invité, la jauge de stockage mutualisé parlerait de MON quota à côté de SON
   * coffre — un pourcentage juste, posé au mauvais endroit, donc un mensonge.
   * On ne demande la lecture que dans le seul cas où elle se rapporte bien à ce
   * coffre-ci.
   */
  const mySpaceOrgId = useSelector(selectSharedVaultOrgId);
  const sameSpace = !!vault?.organizationId && vault.organizationId === mySpaceOrgId;

  /**
   * LES AGRÉGATS (F07), CHARGÉS PAR LA PAGE ET NON PAR L'ONGLET. Le seau du
   * worker est de 120 lectures par heure et par COFFRE — pour tous ses membres
   * à la fois : un hook posé dans l'Aperçu repartirait à chaque aller-retour
   * entre deux onglets. La page, elle, reste montée. Un lecteur n'appelle pas du
   * tout : la route est au rang member, et son 403 s'afficherait comme une panne.
   */
  const stats = useVaultStats(vaultId, {
    enabled: mayReadVaultStats(myRole),
    sameSpace,
  });

  /**
   * LES CINQ DERNIERS ÉVÉNEMENTS, POUR LA MÊME RAISON. La carte « Dernière
   * activité » de l'Aperçu remontait sa propre lecture à chaque montage de
   * l'onglet : cinq allers-retours Aperçu↔Membres faisaient cinq
   * `GET /:id/activity`. La lecture appartient donc à la page, comme les
   * agrégats. Le rang est celui du viewer côté worker — tout le monde la voit.
   */
  const activity = useVaultActivityPreview(vaultId);

  /**
   * LES ACCÈS PONCTUELS (F17), POUR LA MÊME RAISON ENCORE. `GET /:id/grants` est
   * au rang admin : un membre ordinaire n'appelle pas du tout, son 403
   * s'afficherait comme une panne pour un appel qu'on aurait choisi de faire à
   * sa place. La lecture appartient à la page, l'onglet Membres ne fait que
   * l'afficher.
   */
  const grants = useVaultGrants(vaultId, mgmtBase.canManage);

  /**
   * LES NOMS DES ÉLÉMENTS, POUR QUE LE FIL PARLE DE CHOSES ET NON D'IDENTIFIANTS.
   * Le journal du serveur ne connaît que des `item_id` opaques — c'est une
   * propriété, pas une lacune : les noms sont chiffrés sous K_vault et se
   * résolvent ICI, comme dans l'explorateur (`VaultFolderView`) et le panneau
   * d'activité. Sans cet index, chaque ligne retombait sur le repli, et le repli
   * AFFIRME une suppression : « quelqu'un a remplacé le contenu d'un élément
   * supprimé » se lisait sur une note parfaitement vivante.
   *
   * La liste est lue au champ NU (`itemsByVault[vaultId]`) et non par
   * `selectVaultItems`, qui rend un tableau frais à chaque appel quand le coffre
   * n'a rien de chargé : `useSelector` compare par référence et rendrait la page
   * à chaque action du store. Un coffre jamais ouvert n'a pas d'entrée du tout —
   * l'index est alors VIDE, et l'Aperçu le dit sans accuser personne (voir
   * `unresolvedItemLabel`).
   */
  const items = useSelector((s: RootState) => s.vaults.itemsByVault[vaultId]);
  const nameByItemId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items ?? []) {
      const nom = i.meta.fileName || i.meta.title;
      if (nom) m.set(i.id, nom);
    }
    return m;
  }, [items]);

  /**
   * LES ÉLÉMENTS DONT ON A RÉELLEMENT LU LA LISTE (F17). `undefined` dans le
   * store — un coffre jamais ouvert, ou verrouillé — ne veut PAS dire « aucun
   * élément » : il veut dire qu'on n'a pas lu. La distinction décide d'une
   * phrase entière dans les accès ponctuels (« cet élément a été supprimé »
   * contre « on ne sait pas le nommer sur cet appareil »), et on ne l'affirme
   * jamais sur un silence.
   *
   * UNE LISTE INCOMPLÈTE NE FAIT AUTORITÉ SUR RIEN, et c'est le succès PARTIEL
   * qui l'a appris. `loadVaultItems` SAUTE tout élément qu'il ne sait pas
   * déchiffrer — scellé sous une époque dont l'historique de clés n'est pas
   * revenu (réseau, `historyAvailable=false`) — et se résout QUAND MÊME, en ne
   * comptant les manquants que dans `decryptStatusByVault`. Bâti sur cette
   * liste-là, l'ensemble ne contient pas des éléments parfaitement vivants :
   * l'écran leur écrivait « cet élément n'existe plus » et leur retirait
   * « Réparer » (un accès stale n'est réparable que si son élément est là) —
   * exactement sur les accès les plus susceptibles d'être stale, ceux d'un
   * fichier qu'on ne touche plus, donc resté sous une époque ancienne.
   *
   * UN SEUL indéchiffrable suffit donc à rendre `null` : c'est la règle 2 du
   * modèle appliquée au bon niveau — on ne sait plus qui existe, on ne déclare
   * personne orphelin, et chaque ligne retombe sur « élément illisible sur cet
   * appareil », qui est la vérité. `null` ne relance rien non plus : l'effet de
   * chargement de `VaultGrantsSection` dépend de cette valeur, identique d'un
   * tour à l'autre.
   *
   * LE VERDICT LUI-MÊME VIT DANS `authoritativeItemIds`, avec la règle 2 qu'il
   * sert : ici on ne fait que lui donner les deux moitiés du store. Le calcul
   * tenu à la main portait un `?? 0` qui lisait un compte-rendu ABSENT comme un
   * zéro — et `addVaultItem`/`updateVaultItem` créent justement la liste sans ce
   * compte-rendu, si bien qu'un coffre où l'on venait de déposer un fichier
   * déclarait orphelins les accès à tous les autres.
   */
  const decryptStatus = useSelector((s: RootState) => s.vaults.decryptStatusByVault[vaultId]);
  const knownItemIds = useMemo(
    () => authoritativeItemIds(items, decryptStatus),
    [items, decryptStatus]
  );

  /**
   * ET C'EST LA PAGE QUI LA DEMANDE — sinon elle juge sur son ignorance.
   *
   * Les deux valeurs ci-dessus étaient LUES sans être jamais DEMANDÉES : le seul
   * appel à `loadVaultItems` de cet écran vivait dans `VaultGrantsSection`,
   * montée dans l'onglet Membres. Or la page se monte SEULE (`?view=settings`,
   * sans l'explorateur) et le menu de la carte de coffre y envoie directement :
   * sur ce chemin — le chemin normal — l'index des noms restait vide et la carte
   * de la note épinglée affichait « illisible sur cet appareil » pour une note
   * parfaitement lisible, sans qu'aucun geste ne puisse y remédier. Un aveu
   * d'ignorance vaut mieux qu'un faux verdict, mais une ignorance qu'une ligne
   * suffit à lever n'est pas une excuse.
   *
   * LA MÊME GARDE, ET POUR LA MÊME RAISON, QUE `VaultGrantsSection` : la
   * condition porte sur la liste RÉELLEMENT LUE. `loadVaultItems.fulfilled`
   * réassigne `itemsByVault[vaultId]` (tableau neuf à chaque tour) : une
   * condition posée sur les titres se relancerait indéfiniment sur tout coffre
   * sans élément nommable. `knownItemIds` passe de `null` à un Set une seule
   * fois, et reste `null` — valeur identique, effet non relancé — quand la
   * lecture échoue ou n'est que partielle. Le coffre est déjà déverrouillé
   * derrière `VaultKeypairGate` : la lecture a de quoi déchiffrer.
   */
  useEffect(() => {
    if (knownItemIds === null) void dispatch(loadVaultItems({ vaultId }));
    // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
    return undefined;
  }, [vaultId, dispatch, knownItemIds]);

  /**
   * UN CHANGEMENT D'EFFECTIF PÉRIME AUSSI LES AGRÉGATS. `afterRosterChange` ne
   * réveillait que les pastilles partagées ; la grille de l'Aperçu, elle, gardait
   * l'effectif et l'époque d'AVANT la rotation — trente secondes au moins (le
   * plancher), et indéfiniment pour qui ne revient pas sur l'Aperçu. Le point
   * d'invalidation reste UNIQUE : tous les gestes de la page appellent déjà
   * celui-ci, et aucun onglet n'a à connaître les statistiques.
   */
  const rosterChanged = mgmtBase.afterRosterChange;
  const invalidateStats = stats.invalidate;
  const mgmt = useMemo(
    () => ({
      ...mgmtBase,
      afterRosterChange: () => {
        rosterChanged();
        invalidateStats();
      },
    }),
    [mgmtBase, rosterChanged, invalidateStats]
  );

  /**
   * SUIS-JE PROPRIÉTAIRE OU ADMINISTRATEUR DE L'ESPACE **DU COFFRE** ?
   *
   * Ce n'est pas la même question que « puis-je gérer ce coffre » : un
   * administrateur de coffre reçu chez quelqu'un d'autre est org `viewer`, donc
   * il ne peut inviter personne dans cet espace-là. C'est ce booléen qui décide
   * si la fiche d'accès propose « Renvoyer l'invitation d'espace » ou dit
   * honnêtement à qui s'adresser — un bouton qui se referme au clic vaut moins
   * qu'une phrase juste. L'espace ABSENT de la liste ne vaut pas « non
   * administrateur » par accident : il vaut « je ne sais pas », donc pas de
   * bouton, ce qui est la même conclusion prudente.
   */
  const canManageSpace = useMemo(() => {
    const org = orgs.find((o) => o.id === vault?.organizationId);
    return org?.role === 'owner' || org?.role === 'admin';
  }, [orgs, vault?.organizationId]);

  /**
   * L'ESPACE DU COFFRE ET SON PLAN (F19). Le nom se résout dans la liste des
   * espaces — pour un invité, c'est l'espace de son hôte, et l'identifiant nu
   * ne dit rien à personne. Le PLAN, lui, ne se déduit d'aucun champ servi au
   * client : `vaultSpaceIdentity` ne le déclare échu que sur un refus
   * `host_plan_lapsed` réellement reçu (voir l'en-tête du modèle).
   */
  const space = useMemo(
    () =>
      vaultSpaceIdentity({
        organizationId: vault?.organizationId ?? '',
        orgs,
        planRefused: mgmt.settings.planRefused,
      }),
    [vault?.organizationId, orgs, mgmt.settings.planRefused]
  );

  /** Ce que la conservation légale ferme dans l'onglet Danger (F19). */
  const guard = dangerGuard(mgmt.legalHold);

  /**
   * LE GEL (F23), lu au RÉSUMÉ et pas par un chargeur de plus. C'est le même
   * fait que celui qui fait disparaître les boutons de l'explorateur : deux
   * lectures, ce seraient deux vérités possibles au même instant, et l'onglet
   * Danger proposerait « Geler » sur un coffre déjà gelé.
   */
  const frozenAt = vault?.frozenAt ?? null;
  const frozenBy = vault?.frozenBy ?? null;
  const frozen = frozenAt !== null;

  /**
   * F27 — L'ÉPINGLE. Elle se LIT dans le bloc scellé que `useVaultManagement` a
   * déjà ouvert (aucune lecture de plus), et s'écrit par le même chemin que la
   * description — y compris le refus d'écraser un bloc que cet appareil n'a pas
   * su ouvrir. Elle se POSE depuis l'explorateur (le menu contextuel d'un
   * élément) ; ici, on ne fait que la RETIRER, parce que c'est le seul geste
   * qu'une carte d'Aperçu peut offrir sans connaître la liste des éléments.
   */
  const pin = useVaultPin(vaultId, vault?.currentKeyEpoch ?? 0, mgmt.settings);

  /**
   * F28 — LA BANDE DE CETTE PAGE. Mesurée sur l'enveloppe qui défile, jamais sur
   * la fenêtre (voir l'en-tête). `compact` tant qu'on n'a pas mesuré : c'est la
   * seule disposition qui ne peut pas déborder.
   */
  const [surfaceRef, band] = useContainerBreakpoint();

  /**
   * OUVRIR UN ÉLÉMENT DU COFFRE depuis cette page : on QUITTE la page de gestion
   * pour l'explorateur, à l'adresse de l'élément (`?item=`). Ce n'est pas un
   * panneau de plus : la note épinglée est une note ordinaire, et elle s'ouvre
   * là où s'ouvrent toutes les autres.
   */
  const navigate = useNavigate();
  const openItem = useCallback(
    (itemId: string) => navigate(vaultFolderRoute(vaultId, { itemId })),
    [navigate, vaultId]
  );

  /**
   * F10 — L'AUTO-CONTRÔLE : MON scellé de l'époque courante s'ouvre-t-il ?
   *
   * LE GARDE-FOU CONTRE LE LOCK-OUT. Une rotation est faite par le client de
   * quelqu'un d'AUTRE : c'est son application qui rescelle K_vault' à chacun.
   * Un client bogué, une clé publique mal résolue, un wrap écrit à moitié, et
   * l'on se retrouve avec un coffre visible dont plus rien ne s'ouvre — sans le
   * moindre message, puisque de l'autre côté tout a eu l'air normal. Ce n'est
   * pas réparable ici (il faudrait la clé, justement absente) : ce qui manquait,
   * c'est de NOMMER la personne à qui demander une nouvelle rotation.
   *
   * IL EST AU NIVEAU DE LA PAGE, pas dans l'onglet Réglages, parce qu'un
   * LECTEUR n'a pas cet onglet — et c'est lui que la panne frappe le plus
   * souvent, puisqu'il n'a aucun autre écran qui parle de clés.
   *
   * IL NE SE LÈVE JAMAIS SUR UNE ABSENCE. Sans paire de clés sur cet appareil,
   * RIEN ne s'ouvre — pas ce scellé-ci en particulier ; et à l'époque 1, aucune
   * rotation n'a eu lieu. Dans les deux cas le verdict est « verrouillé », pas
   * une accusation : envoyer chercher un administrateur pour refaire une
   * rotation qui n'a jamais eu lieu (ou qui s'est très bien passée) désignerait
   * un coupable inexistant.
   */
  /**
   * LA PAIRE DE CLÉS DU COMPTE EST-ELLE LÀ ? Sans elle, RIEN ne s'ouvre sur cet
   * appareil — pas ce scellé-ci en particulier — et le verdict doit dire
   * « verrouillé », pas « ce scellé ne vaut rien ». Elle est posée
   * PARESSEUSEMENT (mot de passe saisi après le démarrage, restauration PRF) :
   * lue une seule fois au montage, l'accusation resterait affichée après le
   * déverrouillage. D'où l'abonnement — le module ne rend qu'un booléen, jamais
   * la clé.
   */
  const [deviceHasKeys, setDeviceHasKeys] = useState(hasUserKeypair);
  useEffect(() => {
    setDeviceHasKeys(hasUserKeypair());
    return subscribeUserKeypair(setDeviceHasKeys);
  }, []);

  const sealVerdict = useMemo(
    () =>
      mySealVerdict({
        currentKeyEpoch: vault?.currentKeyEpoch ?? 0,
        wrappedVaultKeyEpoch: vault?.wrappedVaultKeyEpoch ?? 0,
        // `isVaultUnlocked` plutôt que `getVaultKey(...) !== null` : le même
        // verdict, sans faire passer la matière de K_vault par une fermeture.
        canOpenCurrent: isVaultUnlocked(vaultId, vault?.currentKeyEpoch ?? 0),
        deviceHasKeys,
      }),
    [vaultId, vault?.currentKeyEpoch, vault?.wrappedVaultKeyEpoch, deviceHasKeys]
  );

  /**
   * À QUI DEMANDER — nominatif, ou rien. « Demandez à un administrateur » sur
   * un coffre à douze personnes ne dit pas quoi faire. Les adresses sont
   * résolues LOCALEMENT (annuaire de l'espace + lignes du coffre) : le serveur
   * ne rend que des identifiants opaques.
   */
  const rotators = useMemo(
    () =>
      mgmt.members
        .filter((m) => (m.role === 'owner' || m.role === 'admin') && m.userId !== mgmt.myUserId)
        .map((m) => mgmt.display(m.userId)),
    [mgmt]
  );

  /**
   * F11 — LE CONTRÔLE DES CLÉS, TENU PAR LA PAGE ET PAS PAR L'ONGLET.
   *
   * Le bandeau rouge ci-dessous et la colonne « Confiance » du trombinoscope
   * doivent nommer les MÊMES gens : deux contrôles indépendants, ce serait deux
   * fois les lectures (deux par membre) et deux verdicts qui finiraient par
   * diverger — exactement la raison pour laquelle `groups`, `journeys` et
   * `states` sont calculés ici plutôt que dans chaque onglet.
   *
   * Il part dès l'ouverture de la PAGE, quel que soit l'onglet : une clé
   * substituée ne doit pas attendre qu'on pense à aller voir les membres.
   *
   * RÉSERVÉ À QUI GÈRE LE COFFRE, comme le plan le range (§2.4 : la confiance
   * est dans la colonne « admin » de l'onglet Membres). La raison n'est pas un
   * secret gardé, c'est que le geste n'existe que là : l'administrateur est
   * celui qui SCELLE la clé du coffre à des tiers, donc celui que la
   * substitution vise et le seul qui puisse en tirer une conduite (arrêter une
   * invitation, refaire une cérémonie, retirer). Un lecteur paierait deux
   * lectures par membre pour un verdict sur lequel il n'a aucune prise.
   *
   * ET CE N'EST PAS UNE HISTOIRE DE 403 : `GET /account/public-key/:userId`
   * n'exige aucun RANG — il exige que la personne visée soit membre ACTIF de
   * l'espace de l'appelant (`account.ts`, garde `org_forbidden`). Un lecteur
   * membre de l'espace lirait donc ces clés sans difficulté ; ce sont les
   * membres SORTIS de l'espace qui se voient refuser, quel que soit le rôle de
   * celui qui demande — c'est le cas F08, pas celui-ci. Le fait reste accessible
   * à tous par ailleurs : chacun lit SON numéro dans la carte « Vous », et un
   * partage par élément refait sa propre vérification.
   */
  const memberIds = useMemo(
    () => (mgmt.canManage ? mgmt.rows.map((r) => r.userId) : []),
    [mgmt.canManage, mgmt.rows]
  );
  const trust = useMemberKeyWatch(vaultId, memberIds);

  /**
   * F08 — les membres que le serveur DIT sortis de l'espace du coffre. Compté
   * ici pour que l'index « À traiter » de l'Aperçu et le bandeau de l'onglet
   * Membres portent le même chiffre ; le modèle refuse de le déduire d'un
   * silence (`inSpace` absent = on ne sait pas).
   */
  const orphanCount = useMemo(() => orphanedMembers(mgmt.rows).count, [mgmt.rows]);

  /**
   * LES TROIS SECTIONS D'INVITATIONS ET LES FICHES D'ACCÈS, calculées ICI plutôt
   * que dans chaque onglet : l'Aperçu (carte « À traiter ») et l'onglet
   * Invitations doivent compter LA MÊME CHOSE. Deux calculs finiraient par
   * diverger, et un compteur qui ne correspond pas à la liste qu'il ouvre est
   * pire que pas de compteur.
   *
   * `Date.now()` est lu à chaque recalcul (donc à chaque arrivée de données) et
   * non par une horloge : rafraîchir la page toutes les secondes pour faire
   * basculer une pastille orange coûterait un rendu permanent pour une
   * information qui vaut à la minute près.
   */
  const groups = useMemo(
    () =>
      groupInvites({
        invites: mgmt.invites,
        settled: mgmt.settled,
        lapsed: mgmt.lapsed,
        nowMs: Date.now(),
        currentKeyEpoch: vault?.currentKeyEpoch ?? 0,
        directory: mgmt.directory.entries,
        directoryState: mgmt.directory.state,
      }),
    [
      mgmt.invites,
      mgmt.settled,
      mgmt.lapsed,
      vault?.currentKeyEpoch,
      mgmt.directory.entries,
      mgmt.directory.state,
    ]
  );

  const journeys = useMemo(
    () =>
      buildAccessJourneys({
        vaultId,
        grants: mgmt.grants,
        awaitingSpace: mgmt.awaitingSpace,
        blocked: blockedGrants,
        directory: mgmt.directory.entries,
        directoryState: mgmt.directory.state,
        invites: mgmt.invites,
        members: mgmt.members,
        canManageSpace,
      }),
    [
      vaultId,
      mgmt.grants,
      mgmt.awaitingSpace,
      blockedGrants,
      mgmt.directory.entries,
      mgmt.directory.state,
      mgmt.invites,
      mgmt.members,
      canManageSpace,
    ]
  );

  /**
   * CE QUE CHAQUE SECTION A LE DROIT DE DIRE quand elle n'a rien à montrer
   * (F05) : du contenu, un vide qui dit quoi faire, ou un refus de lecture avec
   * son Réessayer — jamais les deux derniers confondus. Décidé ICI pour la même
   * raison que `groups` et `journeys` : l'Aperçu et l'onglet Invitations doivent
   * compter la MÊME chose, et un état vide qui ne correspond pas à la liste
   * qu'il remplace est pire que pas d'état vide du tout.
   *
   * Le fil d'activité n'y est pas : il a sa PROPRE lecture (`VaultActivityPanel`),
   * donc son propre verdict, rendu au même endroit que la donnée qui le décide.
   */
  const preparing = useMemo(() => pendingAccessJourneys(journeys).length, [journeys]);

  /**
   * Les lignes de « À traiter », construites UNE fois : la page s'en sert pour
   * savoir si la carte est vide, l'Aperçu pour les rendre. Deux calculs
   * finiraient par afficher « rien à traiter » au-dessus d'une liste.
   */
  const todoRows = useMemo(
    () =>
      buildTodoRows({
        canManage: mgmt.canManage,
        outOfSpace: orphanCount,
        preparing,
        expiringSoon: groups.expiringSoon,
        toReissue: groups.toReissue,
        lapsed: groups.lapsed.length,
      }),
    [
      mgmt.canManage,
      orphanCount,
      preparing,
      groups.expiringSoon,
      groups.toReissue,
      groups.lapsed.length,
    ]
  );

  const states = useMemo(
    () =>
      vaultSettingsEmptyStates({
        counts: {
          members: mgmt.members.length,
          pending: groups.pending.length,
          settled: groups.settled.length,
          lapsed: groups.lapsed.length,
          preparing,
          todo: todoRows.length,
        },
        load: { loading: mgmt.loading, error: mgmt.error },
        canManage: mgmt.canManage,
      }),
    [
      mgmt.members.length,
      mgmt.loading,
      mgmt.error,
      mgmt.canManage,
      groups.pending.length,
      groups.settled.length,
      groups.lapsed.length,
      preparing,
      todoRows.length,
    ]
  );

  /**
   * ARRIVER SUR LA LIGNE D'INVITATION, PAS SEULEMENT SUR SON ONGLET. L'état vide
   * des Invitations envoie chez les Membres ; un bouton qui change d'écran et
   * laisse ensuite chercher où taper ne fait que la moitié du geste. Le drapeau
   * retombe à tout autre changement d'onglet, pour qu'un retour par la barre ne
   * vole pas le focus à quelqu'un qui venait lire le tableau.
   */
  const [autoFocusInvite, setAutoFocusInvite] = useState(false);
  const changeTab = useCallback(
    (id: VaultTabId) => {
      setAutoFocusInvite(false);
      onTabChange(id);
    },
    [onTabChange]
  );
  const goToInviteRow = useCallback(() => {
    setAutoFocusInvite(true);
    onTabChange('members');
  }, [onTabChange]);

  /**
   * Échap remonte au coffre, comme le bouton. Le garde est le même que celui de
   * l'explorateur, avec une condition de plus : si une boîte est ouverte, c'est
   * ELLE qu'Échap ferme. Les modales du design system écoutent `document`, donc
   * elles reçoivent la touche avant cette fenêtre-ci ; sans le garde, une
   * confirmation de suppression se fermerait ET la page se refermerait derrière,
   * ce qui donne l'impression d'avoir annulé deux choses d'un coup.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      const node = e.target as HTMLElement | null;
      const tag = node?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node?.isContentEditable) {
        return;
      }
      e.preventDefault();
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  /**
   * Renommer. Ce n'est PAS un geste dangereux — le nom est chiffré sous
   * K_vault, rien d'autre ne bouge — d'où le crayon de l'en-tête plutôt qu'une
   * carte dans l'onglet Danger. La saisie ne part qu'une fois le nom écrit :
   * elle était effacée AVANT l'aller-retour, si bien qu'un échec réseau
   * détruisait ce qu'on venait de taper.
   */
  const submitRename = useCallback(
    async (raw: string) => {
      const name = raw.trim();
      if (!name || name === (vault?.name ?? '')) {
        setRenaming(false);
        return;
      }
      try {
        await dispatch(renameVault({ vaultId, name })).unwrap();
        setRenaming(false);
        success(t('teamVaults.members.renamed'));
      } catch (e) {
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.renameFailed')));
      }
    },
    [dispatch, vaultId, vault?.name, success, error, t]
  );

  const tabs = useMemo<TabDescriptor[]>(
    () =>
      visibleVaultTabs(myRole).map((id) => ({
        id,
        label: t(`teamVaults.settings.tabs.${id}`),
        icon: TAB_ICONS[id],
        // Un compteur seulement quand il veut dire quelque chose : « 0 » sur
        // Invitations pendant le chargement laisserait croire qu'il n'y en a
        // aucune, ce qu'on ne sait pas encore.
        // Les invitations comptées sont celles qui SONT DEHORS : une ligne que
        // le serveur croit encore vivante mais dont la date est passée n'attend
        // plus personne, et la compter promettrait un accès qui n'arrivera pas.
        count:
          id === 'members' && mgmt.members.length > 0
            ? mgmt.members.length
            : id === 'invitations' && groups.pending.length > 0
              ? groups.pending.length
              : undefined,
      })),
    [myRole, t, mgmt.members.length, groups.pending.length]
  );

  // La route garde le coffre en vie (RouteContent rend « Coffre introuvable »
  // sinon) ; ce repli ne couvre que l'instant où un départ vient de le retirer
  // de l'état pendant que la navigation se termine.
  if (!vault) return null;

  const displayName = vault.name || t('teamVaults.locked');

  return (
    /* LA SURFACE MESURÉE est l'enveloppe qui défile — pas la colonne plafonnée
       qu'elle contient : celle-ci ne dépasse jamais 1120 px, si bien que la bande
       « large » (1200) n'existerait pour personne. */
    <div ref={surfaceRef} style={{ height: '100%', overflowY: 'auto' }}>
      <div
        className={`ent-console ent-console--band-${band}`}
        style={{
          // Le plafond de LECTURE, et le repli est celui d'avant : en mode
          // centré `--page-max-width` n'existe pas et cette page vaut 1120 px,
          // exactement comme avant le réglage de largeur. Voir
          // `services/platform/pageWidth.ts`.
          maxWidth: 'var(--page-max-width, 1120px)',
          margin: '0 auto',
          // Une page étroite n'a pas 24 px à donner de chaque côté : ce serait le
          // sixième de la largeur utile d'un téléphone.
          padding:
            band === 'compact'
              ? 'var(--spacing-4) var(--spacing-3) var(--spacing-6)'
              : 'var(--spacing-6) var(--spacing-6) var(--spacing-8)',
        }}
      >
        <div className="ent-pagehead">
          <div className="ent-pagehead__titles">
            <h1 className="ent-pagehead__title">
              {/* LE GLYPHE EST LE BOUTON D'APPARENCE (F14). Un coffre non
                  personnalisé garde EXACTEMENT le cadenas d'avant : la fiche
                  ajoute une possibilité, elle ne change pas ce que personne n'a
                  touché. Le geste reste offert à tout le monde — la portée
                  « pour moi » n'écrit rien au serveur — et c'est la fenêtre qui
                  ferme l'écriture partagée si le rang ne la permet pas. */}
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('teamVaults.appearance.title')}
                title={t('teamVaults.appearance.title')}
                onClick={() => setStyling(true)}
              >
                <span
                  className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                  style={vaultTintStyle(appearance)}
                >
                  <VaultGlyph appearance={appearance} className="w-[18px] h-[18px] text-base" />
                </span>
              </Button>
              <span className="truncate">{displayName}</span>
              {mgmt.canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('teamVaults.members.renameTitle')}
                  title={t('teamVaults.members.renameTitle')}
                  onClick={() => setRenaming(true)}
                >
                  <PencilIcon />
                </Button>
              )}
            </h1>
            <p className="ent-pagehead__subtitle">{t('teamVaults.settings.title')}</p>
          </div>
          <div className="ent-pagehead__meta">
            <StatusBadge tone={VAULT_ROLE_TONE[myRole] ?? 'neutral'}>
              {t(`teamVaults.role.${myRole}`, myRole)}
            </StatusBadge>
            {mgmt.members.length > 0 && (
              <StatusBadge>
                {t('teamVaults.settings.identity.memberCount', { count: mgmt.members.length })}
              </StatusBadge>
            )}
            <StatusBadge title={t('teamVaults.settings.identity.epoch')}>
              {t('teamVaults.settings.identity.epochValue', { epoch: vault.currentKeyEpoch })}
            </StatusBadge>
            {/* LES DEUX ÉTATS QUI CHANGENT CE QU'ON PEUT FAIRE ICI (F19), et que
                rien n'annonçait avant le refus : une conservation légale ferme
                les gestes irréversibles, un plan échu met l'espace en lecture
                seule. Ni l'un ni l'autre ne s'affiche « à faux » — l'absence
                d'information n'est pas un badge. */}
            {guard === 'legalHold' && (
              <StatusBadge tone="warning" title={t('teamVaults.settings.legalHold.hint')}>
                {t('teamVaults.settings.legalHold.badge')}
              </StatusBadge>
            )}
            {space.plan === 'lapsed' && (
              <StatusBadge tone="error" title={t('teamVaults.settings.planLapsed.hint')}>
                {t('teamVaults.settings.planLapsed.badge')}
              </StatusBadge>
            )}
            {/* LE GEL (F23) — la TROISIÈME pastille de cette famille, et la seule
                que tout le monde voit : `legalHold` n'est servi qu'aux admins,
                le plan échu ne se déduit que d'un refus reçu, mais le gel est un
                fait du coffre que ses membres subissent à la seconde. Il ne
                s'affiche jamais « à faux » non plus : sans date, pas de pastille. */}
            {frozen && (
              <StatusBadge tone="warning" title={t('teamVaults.settings.frozen.hint')}>
                {t('teamVaults.settings.frozen.badge')}
              </StatusBadge>
            )}
            <Button variant="secondary" size="sm" onClick={onExit}>
              {t('teamVaults.settings.back')}
            </Button>
          </div>
        </div>

        {/* F23 — LE GEL, EN TÊTE DE PAGE ET AU-DESSUS DES ONGLETS.
            Comme les deux bandeaux qui suivent, le fait ne dépend pas de
            l'onglet où l'on se trouve : il explique pourquoi l'explorateur est
            en lecture seule, pourquoi un enregistrement de contenu a été refusé,
            et il nomme la personne à qui demander le dégel. AMBRE et non rouge :
            ce n'est ni une panne ni une perte, c'est un état voulu qui se défait
            d'un clic — peindre en rouge ce qui va bien apprend à ignorer le
            rouge. */}
        {frozen && (
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <VaultFrozenBanner frozenAt={frozenAt} frozenBy={frozenBy} display={mgmt.display} />
          </div>
        )}

        {/* F10 — LE SCELLÉ QU'ON NE PEUT PAS OUVRIR. Au-dessus des onglets
            comme le bandeau de confiance, et pour la même raison : le fait ne
            dépend pas de l'onglet où l'on se trouve, et il coûte l'accès au
            contenu. Il ne se lève JAMAIS sur une absence d'information — un
            coffre simplement verrouillé (aucune paire de clés sur cet appareil,
            ou époque 1) ou dont on ignore l'époque ne dénonce personne. */}
        {sealVerdictAlerts(sealVerdict) && (
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <InfoCallout tone="danger">
              <p className="text-sm font-medium m-0" role="alert">
                {t(`teamVaults.settings.key.selfCheck.${sealVerdict}`, {
                  epoch: vault.currentKeyEpoch,
                })}
              </p>
              <p className="text-xs m-0 mt-1">
                {rotators.length > 0
                  ? t('teamVaults.settings.key.selfCheck.askNamed', { who: rotators.join(', ') })
                  : t('teamVaults.settings.key.selfCheck.askAnyone')}
              </p>
            </InfoCallout>
          </div>
        )}

        {/* F11 — LE SEUL BANDEAU DE CETTE PAGE, et il ne parle que d'une chose :
            une clé de membre a changé sans que personne ne l'ait acquittée. Il
            est ici, au-dessus des onglets, parce que le fait ne dépend pas de
            l'onglet où l'on se trouve — et parce qu'une substitution de clé est
            la seule chose de cet écran qui puisse coûter le contenu du coffre.

            IL NE SE LÈVE JAMAIS SUR UNE ABSENCE D'INFORMATION : un contrôle qui
            n'a pas pu lire une clé rend « inconnu », pas une alerte (voir
            `memberTrustModel`). Un bandeau rouge qui apparaît sur une coupure
            réseau apprend à ignorer le rouge. */}
        {trust.alerts.length > 0 && (
          <div style={{ marginBottom: 'var(--spacing-4)' }}>
            <InfoCallout tone="danger">
              {/* `role="alert"` sur le SEUL titre, comme le bandeau « hors de
                  l'espace » : une région assertive qui contient un bouton met un
                  contrôle focalisable dans une annonce. */}
              <p className="text-sm font-medium m-0" role="alert">
                {t('teamVaults.settings.trust.banner.title', { count: trust.alerts.length })}
              </p>
              <p className="text-xs m-0 mt-1">{t('teamVaults.settings.trust.banner.body')}</p>
              <p className="text-xs m-0 mt-1">
                {trust.alerts.map((id) => mgmt.display(id)).join(', ')}
              </p>
              {activeTab !== 'members' && (
                <div className="mt-2">
                  <Button variant="secondary" size="sm" onClick={() => changeTab('members')}>
                    {t('teamVaults.settings.trust.banner.action')}
                  </Button>
                </div>
              )}
            </InfoCallout>
          </div>
        )}

        <Tabs
          tabs={tabs}
          activeId={activeTab}
          onChange={(id) => changeTab(id as VaultTabId)}
          ariaLabel={t('teamVaults.settings.tablist')}
          idPrefix={TAB_IDS}
        />

        <div {...tabPanelProps(TAB_IDS, activeTab)}>
          {activeTab === 'overview' && (
            <OverviewTab
              vault={vault}
              mgmt={mgmt}
              space={space}
              stats={stats}
              activity={activity}
              nameByItemId={nameByItemId}
              knownItemIds={knownItemIds}
              sameSpace={sameSpace}
              pinnedItemId={pin.pinnedItemId}
              onOpenItem={openItem}
              // RETIRÉ, PAS GRISÉ : `PUT /settings` est réservé au rang admin, et
              // un bouton qui ne peut que récolter un 403 invite à chercher
              // pourquoi. Une écriture en vol le referme aussi — deux clics
              // partiraient sur la même version attendue, et le second serait
              // refusé en conflit.
              onUnpin={
                mgmt.canManage && !pin.busy ? () => void pin.setPinned(undefined) : undefined
              }
              todoRows={todoRows}
              states={states}
              onGoTo={changeTab}
            />
          )}
          {activeTab === 'members' && (
            <MembersTab
              vaultId={vaultId}
              currentKeyEpoch={vault.currentKeyEpoch}
              mgmt={mgmt}
              /* LA MÊME LISTE QUE L'ONGLET INVITATIONS, groupée une seule fois :
                 deux `groupInvites` rendraient deux verdicts « expire bientôt »
                 d'instants différents pour la même ligne. */
              pendingInvites={groups.pending}
              /* ET LES ACCÈS EN PRÉPARATION, SITUÉS UNE SEULE FOIS : c'est
                 l'AUTRE moitié de « quelqu'un que j'ai invité ». Une même
                 personne y est parfois vue par les deux listes, et deux fusions
                 par adresse rendraient deux vérités sur qui en est où — c'est
                 `pendingSeats` qui tranche, avec la règle « une personne, une
                 ligne ». */
              journeys={journeys}
              onGoToInvitations={() => changeTab('invitations')}
              states={states}
              autoFocusInvite={autoFocusInvite}
              trust={trust}
              grants={grants}
              nameByItemId={nameByItemId}
              knownItemIds={knownItemIds}
              band={band}
            />
          )}
          {activeTab === 'invitations' && (
            <InvitationsTab
              vaultId={vaultId}
              mgmt={mgmt}
              groups={groups}
              journeys={journeys}
              states={states}
              onGoToInviteRow={goToInviteRow}
              focus={focus}
            />
          )}
          {activeTab === 'activity' && (
            <ActivityTab
              vaultId={vaultId}
              vaultName={vault.name}
              mgmt={mgmt}
              nameByItemId={nameByItemId}
              trust={trust}
              currentKeyEpoch={vault.currentKeyEpoch}
            />
          )}
          {activeTab === 'settings' && (
            /* LA CLÉ DU COFFRE EST À CÔTÉ DES RÉGLAGES, PAS DEDANS (F10). Elle
               ne s'édite pas : elle EXPOSE. La mettre dans `SettingsTab`
               l'aurait rangée derrière les états de chargement et les refus de
               lecture du bloc de réglages — une panne de `GET /settings`
               masquerait alors la couverture des clés, qui n'a rien à voir. */
            <div className="space-y-4">
              <SettingsTab
                vaultId={vaultId}
                currentKeyEpoch={vault.currentKeyEpoch}
                mgmt={mgmt}
                stats={stats}
              />
              <VaultKeySection
                vaultId={vaultId}
                currentKeyEpoch={vault.currentKeyEpoch}
                verdict={sealVerdict}
                mgmt={mgmt}
                history={keyHistory}
                items={items}
                /* Le rang, pas l'onglet : l'onglet est DÉJÀ réservé aux
                   administrateurs, mais le bouton qui écrit doit dire sur quoi
                   il s'appuie — et le serveur refusera de toute façon. */
                canRewrap={myRole === 'owner' || myRole === 'admin'}
                onGoTo={changeTab}
              />
            </div>
          )}
          {activeTab === 'danger' && (
            <DangerTab
              vaultId={vaultId}
              myRole={myRole}
              mgmt={mgmt}
              guard={guard}
              stats={stats}
              frozenAt={frozenAt}
              frozenBy={frozenBy}
            />
          )}
        </div>
      </div>

      <VaultAppearanceModal
        isOpen={styling}
        onClose={() => setStyling(false)}
        vault={vault}
        canManage={mgmt.canManage}
      />

      <PromptModal
        isOpen={renaming}
        onClose={() => setRenaming(false)}
        onSubmit={(v) => void submitRename(v)}
        title={t('teamVaults.members.renameTitle')}
        label={t('teamVaults.nameLabel')}
        placeholder={t('teamVaults.namePlaceholder')}
        defaultValue={vault.name}
        submitText={t('teamVaults.members.rename')}
      />
    </div>
  );
};

export default VaultSettingsView;
