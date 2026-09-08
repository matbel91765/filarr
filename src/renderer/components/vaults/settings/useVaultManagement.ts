/**
 * useVaultManagement (P3) — UN chargeur pour toute la page, UNE invalidation
 * après tout geste qui touche l'effectif.
 *
 * CE QU'IL REMPLACE. Chaque écran de coffre avait le sien : le panneau des
 * membres, le dialogue de partage et le fil d'activité lisaient tous les trois
 * `/members` (et, pour deux d'entre eux, `/invites`) avec leur propre `useState`,
 * leur propre `catch`, leur propre idée de ce qu'il fallait recharger ensuite.
 * Trois listes, donc trois vérités possibles au même instant, et un retrait
 * fait dans l'une laissait les deux autres afficher l'ancienne. Ici les onglets
 * ne chargent RIEN : ils reçoivent.
 *
 * L'INVALIDATION EST LE POINT DE LA FICHE. `shareIndexSlice` n'écoute que trois
 * actions (invitation, retrait, départ) : un transfert de propriété, un
 * changement de rôle, une relance ou une révocation d'invitation ne réveillaient
 * aucune pastille — le rail et les cartes de l'accueil gardaient l'effectif
 * d'avant jusqu'à expiration du TTL. `afterRosterChange()` ferme ce trou en un
 * seul appel, et c'est celui-là que TOUS les gestes de la page doivent faire
 * après leur `reload()`.
 *
 * CE QU'IL NE FAIT PAS. Il ne mémorise pas un état vide sur une panne : l'échec
 * de lecture est CONSERVÉ (`error`) au lieu d'être réduit à une notification qui
 * s'efface — sans quoi l'écran ment ensuite en permanence, et « aucun membre »
 * (un état impossible : un coffre a toujours son propriétaire) prend la place de
 * « je n'ai pas su lire ».
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../../../../store';
import {
  invalidateVaultShareSummary,
  loadShareHeads,
  loadVaultShareSummary,
} from '../../../../store/slices/shareIndexSlice';
import { vaultFreezeState } from '../../../../store/slices/vaultsSlice';
import { errorText } from '../../../../services/vault/vaultErrorMessages';
import { subscribeVaultLive, vaultLiveNonce } from '../../../../services/vault/vaultLiveRefresh';
import {
  apiGetVault,
  apiListVaultAccessIntents,
  apiListVaultMembers,
  apiListVaultInvitesWithSettled,
  type AwaitingSpaceIntentDTO,
  type PendingGrantDTO,
  type VaultInviteDTO,
  type VaultMemberDTO,
} from '../../../../services/vault/vaultApi';
import { useSpaceDirectory, type SpaceDirectory } from '../spaceDirectory';
import {
  buildEmailIndex,
  buildInviteEmailIndex,
  buildMemberRows,
  displayName,
  freezeStateFromVault,
  type VaultMemberRow,
} from './vaultManagementModel';
import { useVaultSettings, type VaultSettingsHandle } from './useVaultSettings';

export interface VaultManagement {
  /** Mon identifiant de compte cloud — `null` tant qu'on ne le connaît pas. */
  myUserId: string | null;
  /** Vrai pour owner/admin : ce qui décide des lectures réservées. */
  canManage: boolean;
  members: VaultMemberDTO[];
  /** Les membres fondus avec l'annuaire, triés, avec leurs capacités. */
  rows: VaultMemberRow[];
  /** Les invitations encore dehors (administrateurs seulement). */
  invites: VaultInviteDTO[];
  /** Les invitations réglées des 14 derniers jours (administrateurs seulement). */
  settled: VaultInviteDTO[];
  /**
   * Les invitations ÉCHUES des 30 derniers jours (F03) — expirées, révoquées, ou
   * périmées avant le passage du balayage du worker. Sans elles, une invitation
   * morte et une personne jamais invitée rendaient le même écran vide.
   */
  lapsed: VaultInviteDTO[];
  /**
   * Les intentions d'accès MÛRES (0073) : qui est entré dans l'espace et attend
   * son scellé. C'est la matière de « Accès en préparation » (F04).
   */
  grants: PendingGrantDTO[];
  /**
   * Les intentions qui attendent encore une RÉPONSE : invitée dans l'espace,
   * elle n'y est pas encore entrée. Sans cette liste, une personne qu'on vient
   * d'inviter n'apparaissait NULLE PART — ni ici, ni dans `invites` (rien n'est
   * scellé avant son arrivée) — et l'onglet Invitations disait « aucune
   * invitation » à un hôte qui venait d'en envoyer une.
   */
  awaitingSpace: AwaitingSpaceIntentDTO[];
  /** L'annuaire de l'espace du coffre, avec l'état de sa lecture (P2). */
  directory: SpaceDirectory;
  /**
   * Les réglages du coffre (F13) — lus pour TOUT membre, lecteurs compris : la
   * route leur est ouverte, et ces règles contraignent leur application. C'est
   * aussi d'ici que l'onglet Membres tire le rôle pré-sélectionné de la ligne
   * d'invitation, et l'onglet Réglages ce qu'il édite.
   */
  settings: VaultSettingsHandle;
  /**
   * Une conservation légale est-elle en cours (F19) ? `undefined` = ON NE SAIT
   * PAS — soit le rang est en dessous d'admin (le serveur omet le champ), soit
   * la lecture a échoué. Jamais confondu avec `false` : le premier ne ferme
   * rien mais n'affirme rien non plus, le second affirme qu'il n'y en a pas.
   */
  legalHold: boolean | undefined;
  emailByUserId: Record<string, string>;
  /**
   * `inviteId → adresse invitée`, sur les TROIS listes. C'est ce qui permet au
   * fil d'activité de nommer l'invité : l'audit ne porte jamais d'adresse, mais
   * il porte l'identifiant de l'invitation — la jointure est locale, et le
   * serveur n'en apprend rien. Vide pour qui ne gère pas le coffre : il n'a pas
   * les invitations, et le fil gardera sa formule sans nom.
   */
  emailByInviteId: ReadonlyMap<string, string>;
  /** Le libellé d'une personne : adresse si on la connaît, identifiant sinon. */
  display: (userId: string) => string;
  loading: boolean;
  /** Le refus de lecture, MÉMORISÉ (jamais un état vide sur une panne). */
  error: string | null;
  /** Relire membres + invitations. */
  reload: () => Promise<void>;
  /** À appeler après TOUT geste qui change l'effectif — voir l'en-tête. */
  afterRosterChange: () => void;
}

export function useVaultManagement(vaultId: string, myRole: string): VaultManagement {
  const dispatch = useDispatch<AppDispatch>();
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const canManage = myRole === 'owner' || myRole === 'admin';

  const [members, setMembers] = useState<VaultMemberDTO[]>([]);
  const [invites, setInvites] = useState<VaultInviteDTO[]>([]);
  const [settled, setSettled] = useState<VaultInviteDTO[]>([]);
  const [lapsed, setLapsed] = useState<VaultInviteDTO[]>([]);
  const [grants, setGrants] = useState<PendingGrantDTO[]>([]);
  const [awaitingSpace, setAwaitingSpace] = useState<AwaitingSpaceIntentDTO[]>([]);
  const [legalHold, setLegalHold] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Les gestes de la page peuvent démonter leur propre hôte (quitter, supprimer
  // : le coffre tombe de l'état) pendant qu'une lecture est encore en vol.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * L'annuaire n'est demandé que si l'on gère le coffre : la route lui est
   * réservée, et un membre n'a pas à voir un reproche pour un appel qu'on a
   * choisi de ne pas faire. Ses adresses à lui viennent des lignes de `/members`.
   */
  const directory = useSpaceDirectory(vaultId, canManage);

  /**
   * Les réglages sont lus pour TOUT LE MONDE : la route est ouverte aux
   * lecteurs, et ce sont ces règles-là qui décident de ce que leur application
   * s'autorise. L'époque courante vient du résumé déjà en mémoire — c'est elle
   * qui dit si le bloc chiffré a été scellé sous une clé révolue.
   */
  const currentKeyEpoch = useSelector(
    (s: RootState) => s.vaults.vaults[vaultId]?.currentKeyEpoch ?? 0
  );
  const settings = useVaultSettings(vaultId, currentKeyEpoch);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Le trombinoscope est la donnée CRITIQUE et doit s'afficher seul ; les
      // invitations sont accessoires, leur échec ne doit pas vider la liste.
      const vm = await apiListVaultMembers(vaultId);
      if (!mountedRef.current) return;
      setMembers(vm);
      if (canManage) {
        // Les trois listes d'invitations en UNE requête : elles sortent de la
        // même route, et les demander séparément aurait multiplié les fenêtres
        // où l'écran affiche deux états d'un même instant.
        const inv = await apiListVaultInvitesWithSettled(vaultId, { lapsed: true });
        if (!mountedRef.current) return;
        setInvites(inv.invites);
        setSettled(inv.settled);
        setLapsed(inv.lapsed);
        // Les intentions sont un COMPLÉMENT, pas un chemin critique :
        // `apiListVaultAccessIntents` avale déjà son échec et rend deux listes
        // vides. Un `await` de plus ici plutôt qu'un chargeur à part, pour que la
        // section « Accès en préparation » et le trombinoscope datent du même
        // instant.
        //
        // LES DEUX MOITIÉS EN UNE LECTURE : les mûres (« il ne manque que le
        // scellé ») et celles qui attendent encore une réponse. Elles sortent
        // de la même route et doivent dater du même instant — deux appels, et
        // l'écran pourrait montrer la même personne dans les deux listes.
        const pg = await apiListVaultAccessIntents(vaultId);
        if (!mountedRef.current) return;
        setGrants(pg.grants);
        setAwaitingSpace(pg.awaitingSpace);
        /**
         * LA CONSERVATION LÉGALE (F19), lue au coffre lui-même. Le champ n'est
         * servi qu'au rang admin — d'où cet appel ici et non pour tout le
         * monde — et `apiGetVault` avale son propre échec : une panne laisse
         * `undefined`, c'est-à-dire « on ne sait pas », et l'onglet Danger
         * n'affirme alors rien dans un sens ni dans l'autre.
         */
        const v = await apiGetVault(vaultId);
        if (!mountedRef.current) return;
        setLegalHold(v?.legalHold);
        /**
         * ET LE GEL AVEC (F23) — la MÊME réponse le porte déjà.
         *
         * `frozenAt` n'entrait dans Redux que par `loadVaults` (qui ne repasse
         * jamais tout seul) et par le réducteur de celui qui vient de cliquer
         * sur « Geler » : un SECOND admin ouvrait donc cette page et voyait
         * « non gelé », bandeau compris, avec la vérité déjà chargée dans la
         * même requête. Le résumé Redux est l'autorité unique de l'écran — on
         * l'y publie plutôt que d'ouvrir une seconde vérité locale.
         *
         * `freezeStateFromVault` rend `null` quand rien n'a été lu :
         * `apiGetVault` avale son propre échec, et une panne ne doit surtout
         * pas effacer un bandeau vrai.
         */
        const gel = freezeStateFromVault(vaultId, v);
        if (gel) dispatch(vaultFreezeState(gel));
      } else {
        setInvites([]);
        setSettled([]);
        setLapsed([]);
        setGrants([]);
        setAwaitingSpace([]);
        setLegalHold(undefined);
      }
    } catch (e) {
      if (mountedRef.current) setError(errorText(e) || 'load_failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [vaultId, canManage, dispatch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * CE QUE FONT LES AUTRES, pendant que la page est ouverte (propagation
   * vivante). Un second administrateur invite quelqu'un, retire un membre ou
   * gèle le coffre : jusqu'ici cette page gardait l'effectif d'avant
   * jusqu'à un rechargement complet. Le guetteur des têtes incrémente le
   * compteur du coffre, et on relit — le MÊME `reload()` que les gestes de la
   * page, jamais un second chemin de lecture.
   *
   * `vuRef` porte le compteur DÉJÀ HONORÉ : sans lui, cet effet rejouerait
   * `reload()` à chaque fois que la fonction elle-même change d'identité
   * (changement de coffre, de rôle), c'est-à-dire en double de l'effet
   * ci-dessus. On ne recharge donc que sur un compteur qui a VRAIMENT bougé.
   */
  const nonceVivant = useSyncExternalStore(
    useCallback((f) => subscribeVaultLive('management', vaultId, f), [vaultId]),
    useCallback(() => vaultLiveNonce('management', vaultId), [vaultId])
  );
  const vuRef = useRef({ vaultId, nonce: nonceVivant });
  useEffect(() => {
    const vu = vuRef.current;
    vuRef.current = { vaultId, nonce: nonceVivant };
    // Un changement de COFFRE est déjà servi par l'effet ci-dessus (`reload`
    // change alors d'identité) : sans cette moitié de la garde, passer d'un
    // coffre à l'autre partirait en double requête à chaque fois.
    if (vu.vaultId !== vaultId || vu.nonce === nonceVivant) return;
    void reload();
  }, [vaultId, nonceVivant, reload]);

  /**
   * Le seul point d'invalidation des agrégats partagés. L'ordre compte :
   * `loadVaultShareSummary` a une `condition` de fraîcheur (TTL d'une minute),
   * si bien qu'un chargement demandé AVANT l'invalidation ne partirait même
   * pas — pas de `pending`, pas de requête, pastille périmée.
   */
  const afterRosterChange = useCallback(() => {
    dispatch(invalidateVaultShareSummary(vaultId));
    void dispatch(loadVaultShareSummary(vaultId));
    void dispatch(loadShareHeads());
  }, [dispatch, vaultId]);

  const emailByUserId = useMemo(
    () => buildEmailIndex(directory.entries, members),
    [directory.entries, members]
  );

  const rows = useMemo(
    () => buildMemberRows(members, emailByUserId, { myUserId, myRole }),
    [members, emailByUserId, myUserId, myRole]
  );

  const emailByInviteId = useMemo(
    () => buildInviteEmailIndex(invites, settled, lapsed),
    [invites, settled, lapsed]
  );

  const display = useCallback(
    (userId: string) => displayName(userId, emailByUserId),
    [emailByUserId]
  );

  return {
    myUserId,
    canManage,
    members,
    rows,
    invites,
    settled,
    lapsed,
    grants,
    awaitingSpace,
    directory,
    settings,
    legalHold,
    emailByUserId,
    emailByInviteId,
    display,
    loading,
    error,
    reload,
    afterRosterChange,
  };
}

export default useVaultManagement;
