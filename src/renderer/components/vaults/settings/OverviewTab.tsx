/**
 * OverviewTab — la fiche d'identité du coffre, ce qu'il pèse, et ce qui réclame
 * l'hôte (F07).
 *
 * L'APERÇU D'UN LECTEUR N'APPELLE PAS `GET /:id/stats`, ET C'EST UNE DÉCISION.
 * Cette route est au rang **member**, pas viewer — l'écart est délibéré côté
 * worker : un viewer est le rang « lire le contenu, rien de plus », tandis que
 * cet aperçu dresse l'INVENTAIRE du coffre (ce qu'il pèse, la ventilation des
 * dépôts par membre, le décompte des rôles, son propriétaire, sa date de
 * naissance). Ce n'est pas du contenu, c'est la carte du coffre. Pour un
 * lecteur, la grille n'existe donc pas du tout : appeler pour afficher un 403
 * ferait passer une décision pour un incident, et remplir des cases à zéro
 * serait pire — un zéro se croit.
 *
 * ÉCART ASSUMÉ AVEC LA TABLE DU PLAN (§2.4), et il est ici pour que la prochaine
 * session ne le relise pas comme une régression : la table donne l'Aperçu au
 * viewer « sans compteurs d'invitations », donc AVEC la grille. L'implémentation
 * la lui retire entièrement, parce que le rang de la route (member) est ce qui
 * tranche — c'est le worker qui décide, pas cette page. Le reste de l'Aperçu (la
 * fiche d'identité, le fil, l'époque en retard) lui reste visible.
 *
 * LES COMPTEURS D'INVITATIONS SONT OMIS SOUS LE RANG ADMIN, jamais rendus à
 * zéro par le worker. Le test est `hasInviteCounters` (`'pendingInviteCount' in
 * stats`), pas un `?? 0` : « 0 invitation en attente » affiché à quelqu'un qui
 * n'a pas le droit de les lister est exactement l'écran vide qui a fait conclure
 * à un accès perdu là où il n'y avait qu'un lien à réémettre.
 *
 * LA PART DU POOL N'EST PAS TOUJOURS LA NÔTRE. `GET /vaults/seats` répond pour
 * l'espace AMBIANT : chez un hôte qui nous a invités, ce serait NOTRE quota
 * affiché à côté de SON coffre. `poolShare` refuse de conclure sans la preuve
 * que les deux espaces sont le même, et la jauge disparaît — la fiche
 * d'identité nomme déjà l'espace, son propriétaire y lira sa jauge chez lui.
 *
 * UN REFUS N'EFFACE PAS UN CHIFFRE. Le seau du worker (120 lectures par heure et
 * par COFFRE, pour tous ses membres à la fois) peut répondre 429 : la dernière
 * valeur reste alors à l'écran, marquée « pas rafraîchie ». La remplacer par des
 * zéros inventerait un coffre vide.
 *
 * LE FIL NOMME LES ÉLÉMENTS, OU N'ACCUSE PERSONNE. Le journal du serveur ne
 * porte que des `item_id` opaques (les noms sont chiffrés sous K_vault) : ils se
 * résolvent ICI, depuis la liste du coffre déjà chargée, que la page passe en
 * `nameByItemId` — exactement comme l'explorateur et le panneau d'activité. Cet
 * index a été VIDE, et le repli qui prend le relais AFFIRME une suppression : on
 * lisait « quelqu'un a remplacé le contenu d'un élément supprimé (a1b2c3d4) »
 * sur une note parfaitement vivante. Quand l'index est vide malgré tout (ce
 * coffre n'a jamais été ouvert dans l'explorateur), le repli dit « un élément »
 * et rien de plus : une absence d'information ne se rend pas en verdict.
 *
 * LA CARTE « À TRAITER » RESTE UN INDEX, sans actions propres : deux
 * implémentations du même geste est le défaut d'origine de tout cet écran.
 *
 * LA NOTE ÉPINGLÉE (F27) N'EST PAS UN ÉLÉMENT CACHÉ. C'est une note ORDINAIRE du
 * coffre, désignée par un identifiant rangé dans le bloc scellé : elle est aussi
 * dans l'explorateur, elle se renomme, se déplace et se supprime comme les
 * autres. La carte ne fait que l'ouvrir (`vaultFolderRoute(vaultId, { itemId })`).
 *
 * ET ELLE NE REND AUCUN VERDICT SUR UN SILENCE. Trois états, trois phrases
 * différentes, décidées par `pinnedItemModel` avec l'autorité QU'UTILISE DÉJÀ LE
 * FIL juste à côté (`knownItemIds`) : on l'ouvre quand on sait la nommer ; on
 * dit « épinglée, illisible sur cet appareil » quand on ne sait ni la nommer ni
 * si elle existe ; et on ne dit « l'élément épinglé n'existe plus » que sur une
 * liste réellement lue ET complète qui ne le porte pas. Proposer « désépingler »
 * sur le deuxième cas ferait retirer une épingle parfaitement valide au premier
 * coffre ouvert hors ligne.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack, Button, ProgressBar } from '../../ui';
import {
  AdminSection,
  CopyableId,
  InfoCallout,
  RelativeTime,
  StatusBadge,
} from '../../settings/enterprise/AdminPrimitives';
import { BarList, StatCard } from '../../settings/enterprise/Charts';
import { vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import type { VaultSummary } from '../../../../store/slices/vaultsSlice';
import { formatBytes } from '../useVaultBrowser';
import { resolveActivityRow, unresolvedItemLabel } from '../vaultActivityModel';
import { VAULT_ROLE_TONE } from './vaultRoleTone';
import { pinnedItemVerdict } from './pinnedItemModel';
import { countByRole, type VaultTabId } from './vaultManagementModel';
import type { VaultSpaceIdentity } from './vaultSettingsModel';
import type { VaultManagement } from './useVaultManagement';
import type { VaultActivityPreview } from './useVaultActivityPreview';
import type { VaultStatsHandle } from './useVaultStats';
import {
  hasInviteCounters,
  mayReadVaultStats,
  mayRetryStats,
  memberUsage,
  poolShare,
  recentJoins,
  roleRows,
  typeRows,
} from './vaultStatsModel';
import {
  VAULT_EMPTY_KEYS,
  activityEmptyState,
  type VaultSettingsEmptyStates,
  type VaultTodoRow,
} from './vaultSettingsEmptyStates';

interface Props {
  vault: VaultSummary;
  mgmt: VaultManagement;
  /** L'espace du coffre et l'état de son plan (F19), décidés par la page. */
  space: VaultSpaceIdentity;
  /** Les agrégats du coffre (F07) — chargés par la page, plancher compris. */
  stats: VaultStatsHandle;
  /**
   * Les cinq derniers événements, lus par la PAGE eux aussi : cet onglet est
   * démonté à chaque clic de la barre, et sa propre lecture repartait à chaque
   * retour (voir `useVaultActivityPreview`).
   */
  activity: VaultActivityPreview;
  /**
   * Les noms des éléments du coffre, résolus par la PAGE depuis le store. Le
   * journal ne porte que des `item_id` opaques : sans cet index, chaque ligne
   * retombe sur le repli — et le repli accuse une suppression (voir le rendu de
   * la carte). Vide quand l'explorateur n'a jamais été ouvert : c'est un état
   * légitime, pas un coffre vidé.
   */
  nameByItemId: Map<string, string>;
  /**
   * LES ÉLÉMENTS QUI EXISTENT — `null` quand on n'a pas lu, ou pas tout lu.
   *
   * L'index des noms ci-dessus ne répond PAS à cette question : il est non vide
   * dès qu'un élément a été nommé, y compris quand la liste a été amputée de
   * ceux qu'on n'a pas su déchiffrer. C'est cet ensemble-là, et lui seul, qui
   * autorise la carte à dire « supprimé » plutôt que « inconnu ».
   */
  knownItemIds: ReadonlySet<string> | null;
  /**
   * Le coffre vit-il dans MON espace ? Seul cas où le stockage mutualisé lu par
   * `/vaults/seats` parle bien de cet espace-là (voir l'en-tête).
   */
  sameSpace: boolean;
  /** L'identifiant épinglé (F27), tel que le bloc scellé le porte. */
  pinnedItemId: string | undefined;
  /** Ouvrir la note épinglée dans l'explorateur — c'est une note comme une autre. */
  onOpenItem: (itemId: string) => void;
  /**
   * Retirer l'épingle. `undefined` pour qui ne peut pas l'écrire (le rang admin
   * est celui de `PUT /settings`) : l'entrée est alors RETIRÉE, pas grisée.
   */
  onUnpin?: () => void;
  /**
   * Les lignes de « À traiter », construites par la page. Elles ne sont PAS
   * recalculées ici : le verdict « la carte est vide » et son contenu doivent
   * sortir du même calcul, sinon l'écran finit par dire « rien à traiter »
   * au-dessus d'une liste.
   */
  todoRows: VaultTodoRow[];
  /** Les verdicts « contenu / vide / erreur », décidés une fois par la page. */
  states: VaultSettingsEmptyStates;
  /** Ouvrir l'onglet qui porte le geste — cette carte n'en porte aucun. */
  onGoTo: (tab: VaultTabId) => void;
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <dt className="ent-kv__key">{label}</dt>
    <dd className="ent-kv__val m-0">{children}</dd>
  </>
);

export const OverviewTab: React.FC<Props> = ({
  vault,
  mgmt,
  space,
  stats,
  activity,
  nameByItemId,
  knownItemIds,
  sameSpace,
  pinnedItemId,
  onOpenItem,
  onUnpin,
  todoRows,
  states,
  onGoTo,
}) => {
  const { t } = useTranslation();
  const roles = countByRole(mgmt.members);

  /**
   * Mon wrap est-il en retard sur l'époque courante ? C'est l'état qu'un
   * cadenas seul ne dit pas : le coffre n'est pas « verrouillé », il attend
   * qu'un administrateur me rescelle la clé. Le texte existe déjà et nomme le
   * seul geste qui répare.
   */
  const stale = vault.wrappedVaultKeyEpoch < vault.currentKeyEpoch;

  /**
   * La lecture de l'effectif a-t-elle échoué ? Elle décide de DEUX choses ici :
   * le bandeau de refus avec son Réessayer, et le sort de la ligne « membres » —
   * qui doit rendre un tiret plutôt qu'un « 0 membre » tiré d'une liste qu'on
   * n'a pas su lire. Un zéro faux se croit.
   */
  const readFailed = states.members.kind === 'error';

  /** La grille n'existe pas pour un lecteur — voir l'en-tête. */
  const showStats = mayReadVaultStats(vault.role);
  const s = stats.stats;

  const pool = useMemo(
    () => poolShare({ vaultBytes: s?.storageUsedBytes ?? 0, seats: stats.seats, sameSpace }),
    [s?.storageUsedBytes, stats.seats, sameSpace]
  );

  /**
   * Le refus, dit dans SES mots. `vaultErrorKey` ferait dire « trop
   * d'invitations d'affilée » à un 429 de compteurs — la phrase existe pour la
   * ligne d'invitation, et elle serait fausse ici.
   */
  const statsErrorKey =
    stats.error === 'rate_limited'
      ? 'teamVaults.settings.stats.rateLimited'
      : vaultErrorKey(stats.error ?? '', 'teamVaults.settings.stats.loadFailed');

  // ── Les cinq derniers événements ───────────────────────────────────────────
  /**
   * La lecture est celle de la PAGE (`useVaultActivityPreview`), pas de cet
   * onglet : monté et démonté à chaque clic de la barre, il refaisait un
   * `GET /:id/activity` à chaque retour — cinq allers-retours Aperçu↔Membres,
   * cinq requêtes. C'est exactement l'argument des agrégats, et il vaut ici.
   */
  const { events, recorded, error: activityError } = activity;

  const activityCtx = useMemo(
    () => ({
      emailByUserId: new Map(Object.entries(mgmt.emailByUserId)),
      nameByItemId,
      // MÊME CONTEXTE QUE L'ONGLET ACTIVITÉ, sans quoi la même ligne se lirait
      // « a invité quelqu'un » ici et « a invité bob@… » deux clics plus loin —
      // deux vues du même fil qui divergent, la panne qu'on ne remarque qu'au
      // moment où l'une des deux ment.
      emailByInviteId: mgmt.emailByInviteId,
    }),
    [mgmt.emailByUserId, nameByItemId, mgmt.emailByInviteId]
  );

  /**
   * Les trois vides du fil, décidés par le MÊME modèle que l'onglet Activité :
   * « non journalisé sur ce plan » n'est ni une panne ni un coffre neuf, et deux
   * calculs finiraient par en donner deux lectures.
   */
  const activityState = activityEmptyState({
    loading: events === null,
    error: activityError,
    recorded,
    events: events?.length ?? 0,
  });

  /**
   * L'ÉPINGLE (F27) — trois verdicts, et la MÊME autorité que le fil juste en
   * dessous. Le modèle ne connaît ni i18n ni troncature : la carte les porte.
   */
  const pinned = useMemo(
    () => pinnedItemVerdict({ pinnedItemId, nameByItemId, knownItemIds }),
    [pinnedItemId, nameByItemId, knownItemIds]
  );

  /** Les cinq derniers arrivés — une date illisible ne remonte jamais en tête. */
  const arrivals = useMemo(() => recentJoins(mgmt.rows, 5), [mgmt.rows]);

  /**
   * Qui a déposé quoi. La BARRE compte les ÉLÉMENTS et le libellé porte les
   * octets : un `BarList` rend son compteur en chiffres bruts, et
   * « 12 582 912 » ne se lit pas. Les deux quantités sont là, chacune sous la
   * forme où elle veut dire quelque chose.
   */
  // `display` est SORTI de l'objet avant le mémo : la règle des hooks ne sait pas
  // qu'un membre d'objet est stable, et exigerait `mgmt` entier — qui, lui, change
  // à chaque rendu de la page et rendrait le mémo inutile.
  const display = mgmt.display;
  const usage = useMemo(
    () =>
      memberUsage(s?.byMember ?? [])
        .slice(0, 8)
        .map((m) => ({
          label: `${display(m.userId)} · ${formatBytes(m.bytes)}`,
          count: m.itemCount,
        })),
    [s?.byMember, display]
  );

  return (
    <div className="space-y-4">
      {stale && (
        <InfoCallout tone="danger">
          <p className="text-sm font-medium m-0">{t('teamVaults.staleEpochTitle')}</p>
          <p className="text-xs m-0 mt-1">{t('teamVaults.staleEpochHint')}</p>
        </InfoCallout>
      )}

      {/* LA PANNE DE LECTURE, DITE UNE FOIS ET EN TÊTE. Sans elle, l'Aperçu
          affichait « 0 membre » et une carte « À traiter » vide construits sur
          une route qui avait échoué — c'est-à-dire deux affirmations tranquilles
          tirées d'une absence d'information. */}
      {readFailed && (
        <div role="alert">
          <InfoCallout tone="danger">
            <p className="text-sm m-0">{t(states.members.key ?? VAULT_EMPTY_KEYS.loadFailed)}</p>
            <div className="mt-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void mgmt.reload()}
                disabled={mgmt.loading}
              >
                {t('teamVaults.retry')}
              </Button>
            </div>
          </InfoCallout>
        </div>
      )}

      {/* LA GRILLE (F07). Absente pour un lecteur : la route lui est fermée, et
          une grille de tirets n'apprendrait rien de plus que son absence. */}
      {showStats && (
        <AdminSection
          title={t('teamVaults.settings.stats.title')}
          description={t('teamVaults.settings.stats.hint')}
        >
          {/* Le refus se dit AU-DESSUS des chiffres qu'il n'a pas pu
              rafraîchir — jamais à leur place. */}
          {stats.error && (
            <div role="alert" style={{ marginBottom: 'var(--spacing-3)' }}>
              <InfoCallout tone="danger">
                <p className="text-sm m-0">{t(statsErrorKey)}</p>
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    // `force` : un clic est une demande explicite. Le plancher
                    // de trente secondes existe pour empêcher une BOUCLE, pas
                    // pour désarmer un bouton que quelqu'un vient de presser.
                    // Un seul refus le désarme, et c'est le 429 : il DIT que le
                    // seau du coffre est vide (120 lectures/heure, partagées par
                    // tous ses membres), donc qu'aucune tentative ne peut
                    // aboutir — et chacune retarderait le retour des chiffres
                    // pour tout le monde. Le verdict est dans le modèle.
                    disabled={!mayRetryStats(stats)}
                    onClick={() => stats.refresh(true)}
                  >
                    {t('teamVaults.retry')}
                  </Button>
                </div>
              </InfoCallout>
            </div>
          )}
          {/* « Ces chiffres datent » se dit MÊME sous un refus. La condition
              portait aussi `!stats.error` : sur une panne qui laissait des
              chiffres à l'écran, on lisait « ces compteurs n'ont pas pu être
              lus » posé juste au-dessus de valeurs périmées que plus rien ne
              marquait comme telles. Les deux phrases ne disent pas la même
              chose — l'une explique le silence du serveur, l'autre l'âge de ce
              qu'on regarde. */}
          {stats.stale && (
            <p className="ent-hint m-0" style={{ marginBottom: 'var(--spacing-2)' }}>
              {t('teamVaults.settings.stats.stale')}
            </p>
          )}

          <div className="ent-statgrid">
            <StatCard
              label={t('teamVaults.settings.stats.members')}
              value={s ? s.memberCount : '—'}
              sub={
                s
                  ? roleRows(s.roleCounts)
                      .map((r) => `${t(`teamVaults.role.${r.role}`, r.role)} ${r.count}`)
                      .join(' · ')
                  : undefined
              }
            />
            {/* ADMIN SEULEMENT, ET PAR OMISSION DU SERVEUR : les deux cartes
                n'existent que si les champs sont là. */}
            {s && hasInviteCounters(s) && (
              <StatCard
                label={t('teamVaults.settings.stats.invitesPending')}
                value={s.pendingInviteCount}
                sub={t('teamVaults.settings.stats.invitesLapsed', {
                  count: s.lapsedInviteCount,
                })}
              />
            )}
            <StatCard
              label={t('teamVaults.settings.stats.items')}
              value={s ? s.itemCount : '—'}
              sub={
                s
                  ? typeRows(s.byType)
                      .map((r) => `${t(`teamVaults.settings.stats.type.${r.kind}`)} ${r.count}`)
                      .join(' · ')
                  : undefined
              }
            />
            <StatCard
              label={t('teamVaults.settings.stats.storage')}
              value={s ? formatBytes(s.storageUsedBytes) : '—'}
              sub={
                pool
                  ? t('teamVaults.settings.stats.poolShare', { pct: pool.vaultPct })
                  : s && s.pendingUploads > 0
                    ? t('teamVaults.settings.stats.pendingUploads', { count: s.pendingUploads })
                    : undefined
              }
            />
            <StatCard
              label={t('teamVaults.settings.stats.trash')}
              value={s ? s.trashedCount : '—'}
              sub={s ? formatBytes(s.trashedBytes) : undefined}
            />
            <StatCard
              label={t('teamVaults.settings.stats.revisions')}
              value={s ? formatBytes(s.retainedRevisionBytes) : '—'}
              sub={t('teamVaults.settings.stats.revisionsHint')}
            />
            <StatCard
              label={t('teamVaults.settings.stats.grants')}
              value={s ? s.liveGrantCount : '—'}
              sub={t('teamVaults.settings.stats.grantsHint')}
            />
          </div>

          {/* LA JAUGE DU POOL, EN PIED — et seulement quand elle parle du bon
              espace. `poolPct` peut manquer même là (le serveur ne sert pas
              toujours la consommation) : on n'invente alors aucune barre. */}
          {pool && pool.poolPct !== null && (
            <div style={{ marginTop: 'var(--spacing-3)' }}>
              <ProgressBar
                value={pool.poolPct}
                variant={
                  pool.tone === 'danger' ? 'error' : pool.tone === 'warning' ? 'warning' : 'default'
                }
                size="sm"
                showValue
                label={t('teamVaults.settings.stats.pool', {
                  used: formatBytes(pool.used ?? 0),
                  limit: formatBytes(pool.limit),
                })}
              />
              <p className="ent-hint m-0" style={{ marginTop: 4 }}>
                {t('teamVaults.settings.stats.poolHint', { pct: pool.vaultPct })}
              </p>
            </div>
          )}
        </AdminSection>
      )}

      {/* F27 — LA NOTE ÉPINGLÉE. Au-dessus de « À traiter » : c'est ce que
          l'équipe a décidé de mettre en avant, donc la première chose à lire
          quand elle existe. La carte n'existe pas du tout sans épingle — un
          emplacement réservé ferait chercher ce qui manque. */}
      {pinned.kind !== 'none' && (
        <AdminSection
          title={t('teamVaults.pinned.title')}
          description={t('teamVaults.pinned.hint')}
        >
          {pinned.kind === 'readable' ? (
            <div className="flex items-center justify-between gap-3 min-w-0">
              <span className="truncate text-sm text-[var(--color-text-primary)]">
                {pinned.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button variant="secondary" size="sm" onClick={() => onOpenItem(pinned.itemId)}>
                  {t('teamVaults.pinned.open')}
                </Button>
                {onUnpin && (
                  <Button variant="ghost" size="sm" onClick={onUnpin}>
                    {t('teamVaults.pinned.unpin')}
                  </Button>
                )}
              </div>
            </div>
          ) : pinned.kind === 'unreadable' ? (
            /* NI VERDICT NI GESTE. On ne sait pas la nommer, et on ne sait pas
               non plus si elle existe : proposer de désépingler ici ferait
               retirer, hors ligne, une épingle parfaitement valide. L'identifiant
               tronqué reste, pour qu'on puisse la retrouver. */
            <p className="ent-hint m-0">
              {t('teamVaults.pinned.unreadable')} ({pinned.itemId.slice(0, 8)})
            </p>
          ) : (
            /* LÀ, ET LÀ SEULEMENT, ON PROPOSE DE DÉSÉPINGLER : la liste qui fait
               autorité a été lue en entier et ne le porte pas. Le geste qui
               répare est offert avec la phrase — une épingle morte qu'on ne peut
               pas retirer resterait à l'écran indéfiniment.

               ET LA PHRASE NE DIT PAS « N'EXISTE PLUS ». La liste du worker
               filtre `deleted_at IS NULL` : une note mise à la corbeille en sort
               tout de suite, sans être détruite pour autant (elle se restaure
               pendant `trashRetentionDays`, et occupe toujours le quota). C'est
               même le cas le plus probable. « Plus dans ce coffre, peut-être à
               la corbeille » est vrai des deux. */
            <div className="flex items-center justify-between gap-3 min-w-0">
              <p className="ent-hint m-0" role="alert">
                {t('teamVaults.pinned.missing')} ({pinned.itemId.slice(0, 8)})
              </p>
              {onUnpin && (
                <Button variant="secondary" size="sm" onClick={onUnpin}>
                  {t('teamVaults.pinned.unpin')}
                </Button>
              )}
            </div>
          )}
        </AdminSection>
      )}

      {/* « À TRAITER » — UN INDEX, ET RIEN QUE ÇA.

          Chaque ligne compte quelque chose et ouvre l'onglet où LE geste existe
          déjà. Aucune action n'est reproduite ici, et c'est délibéré : deux
          implémentations du même geste est le défaut d'origine de tout cet écran
          (le champ e-mail et le sélecteur « Person » de l'ancien modal faisaient
          deux fois la même chose, différemment, avec un toast d'erreur pour seul
          pont). Un compteur ne peut pas diverger d'une liste ; deux boutons, si.

          Les lignes arrivent CONSTRUITES (`buildTodoRows`, appelé par la page) :
          le verdict « la carte est vide » et son contenu sortent du même calcul.
          Une ligne à zéro ne s'affiche pas — une carte qui montre quatre zéros
          apprend à ne plus la lire — et quand il n'y en a AUCUNE, la carte reste
          mais tient en une ligne (F05) : « rien à traiter » est une bonne
          nouvelle, et l'appareil complet d'un état vide lui donnerait le poids
          visuel d'un problème. */}
      {(states.todo.kind === 'empty' || todoRows.length > 0) && (
        <AdminSection
          title={t('teamVaults.settings.todo.title')}
          description={t('teamVaults.settings.todo.hint')}
        >
          {states.todo.kind === 'empty' ? (
            <p className="ent-hint m-0">{t(states.todo.key ?? VAULT_EMPTY_KEYS.todo)}</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {todoRows.map((row) => (
                <li key={row.key} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-text-secondary)]">
                    {t(`teamVaults.settings.todo.${row.key}`, { count: row.count })}
                  </span>
                  {/* Le clic CHANGE d'écran — il ne fait pas le geste ici. */}
                  <Button variant="ghost" size="sm" onClick={() => onGoTo(row.tab)}>
                    {t('teamVaults.settings.todo.see')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      )}

      <div className="ent-grid-2">
        {/* LES CINQ DERNIERS ARRIVÉS. La pastille prend l'IDENTIFIANT pour
            graine, comme partout ailleurs : la même personne garde sa couleur
            d'un écran à l'autre. Sur une lecture d'effectif ratée, la carte ne
            dit rien — le bandeau du haut a déjà expliqué. */}
        <div className="ent-card">
          <p className="ent-card__title">{t('teamVaults.settings.stats.recent')}</p>
          <p className="ent-card__hint">{t('teamVaults.settings.stats.recentHint')}</p>
          {readFailed || arrivals.length === 0 ? (
            <p className="ent-hint m-0">—</p>
          ) : (
            <>
              <AvatarStack
                items={arrivals.map((m) => ({ label: m.label, seed: m.userId }))}
                size="md"
                max={5}
              />
              <ul className="list-none m-0 mt-2 p-0 flex flex-col gap-1">
                {arrivals.map((m) => {
                  const ms = Date.parse(m.joinedAt);
                  return (
                    <li key={m.userId} className="flex items-center justify-between gap-2 min-w-0">
                      <span className="truncate text-sm text-[var(--color-text-secondary)]">
                        {m.label}
                      </span>
                      <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
                        {Number.isNaN(ms) ? '—' : <RelativeTime ms={ms} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        {/* LES CINQ DERNIERS ÉVÉNEMENTS. Trois vides possibles, et ce sont trois
            faits différents : le fil coupé par l'offre, le coffre qui n'a rien
            à raconter, et la panne de lecture. Le modèle les distingue déjà. */}
        <div className="ent-card">
          <p className="ent-card__title">{t('teamVaults.settings.stats.activity')}</p>
          <p className="ent-card__hint">{t('teamVaults.settings.stats.activityHint')}</p>
          {activityState.kind !== 'content' ? (
            <p
              className="ent-hint m-0"
              {...(activityState.kind === 'error' ? { role: 'alert' as const } : {})}
            >
              {t(activityState.key ?? VAULT_EMPTY_KEYS.activityEmpty)}
            </p>
          ) : events === null ? (
            <p className="ent-hint m-0">{t('common.loading')}</p>
          ) : (
            <>
              <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                {events.map((e) => {
                  const row = resolveActivityRow(e, activityCtx);
                  const params = { ...row.params };
                  if (row.unresolvedItemId) {
                    // CE QU'ON A LE DROIT DE DIRE D'UN ÉLÉMENT QU'ON N'A PAS SU
                    // NOMMER. « Un élément supprimé » est un VERDICT, et il ne
                    // se tire que de la liste qui fait autorité — jamais de
                    // l'index des noms, qui reste muet sur un élément lu mais
                    // sans titre, et non vide sur une liste amputée. Le repli
                    // neutre nomme alors « un élément », avec son identifiant
                    // tronqué pour qu'on puisse le retrouver.
                    params.item = `${t(
                      unresolvedItemLabel(row.unresolvedItemId, knownItemIds) === 'deleted'
                        ? 'teamVaults.activity.deletedItem'
                        : 'teamVaults.activity.unknownItem'
                    )} (${row.unresolvedItemId.slice(0, 8)})`;
                  }
                  if (!params.actor) params.actor = t('teamVaults.activity.someone');
                  return (
                    <li key={e.id} className="min-w-0">
                      <p className="text-sm text-[var(--color-text-primary)] m-0 truncate">
                        {t(row.i18nKey, params)}
                      </p>
                      <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                        <RelativeTime ms={e.occurredAt} />
                      </p>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2">
                <Button variant="ghost" size="sm" onClick={() => onGoTo('activity')}>
                  {t('teamVaults.settings.stats.activitySee')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* LA VENTILATION PAR MEMBRE. Les adresses sont résolues LOCALEMENT : le
          serveur ne rend que des identifiants opaques, et c'est une propriété,
          pas une lacune. Rien ne s'affiche tant qu'il n'y a rien déposé. */}
      {showStats && usage.length > 0 && (
        <AdminSection
          title={t('teamVaults.settings.stats.byMember')}
          description={t('teamVaults.settings.stats.byMemberHint')}
        >
          <BarList items={usage} />
        </AdminSection>
      )}

      <AdminSection
        title={t('teamVaults.settings.identity.title')}
        description={t('teamVaults.settings.identity.hint')}
      >
        <dl className="ent-kv m-0">
          <Row label={t('teamVaults.roleLabel')}>
            <StatusBadge tone={VAULT_ROLE_TONE[vault.role] ?? 'neutral'}>
              {t(`teamVaults.role.${vault.role}`, vault.role)}
            </StatusBadge>
          </Row>
          <Row label={t('teamVaults.settings.identity.owner')}>
            {vault.ownerUserId ? (
              <span>{mgmt.display(vault.ownerUserId)}</span>
            ) : (
              <span className="ent-hint">—</span>
            )}
          </Row>
          {/* L'ESPACE DU COFFRE (F19) — nommé quand on le connaît, et c'est la
              réponse à « chez qui suis-je ? » pour un invité, dont le coffre vit
              dans l'espace de quelqu'un d'autre. Quand la liste des espaces ne
              le porte pas, on rend l'identifiant COPIABLE plutôt qu'un nom
              inventé : c'est ce qu'on peut coller dans un message pour demander.
              Le badge de plan échu n'apparaît, lui, que sur un refus VU. */}
          <Row label={t('teamVaults.settings.identity.space')}>
            {space.named ? <span>{space.label}</span> : <CopyableId value={space.label} />}
            {space.plan === 'lapsed' && (
              <span style={{ marginLeft: 8 }}>
                <StatusBadge tone="error" title={t('teamVaults.settings.planLapsed.hint')}>
                  {t('teamVaults.settings.planLapsed.badge')}
                </StatusBadge>
              </span>
            )}
          </Row>
          {/* La description du bloc chiffré (F13) : lisible par tout membre,
              jamais par le serveur. Absente = rien à montrer, et surtout pas une
              ligne vide qui ferait chercher un texte perdu. */}
          {mgmt.settings.block.description && (
            <Row label={t('teamVaults.settings.identity.description')}>
              <span>{mgmt.settings.block.description}</span>
            </Row>
          )}
          <Row label={t('teamVaults.settings.identity.members')}>
            {/* L'effectif ET sa ventilation : « 4 membres » ne dit pas s'il
                reste quelqu'un pour administrer le coffre. Sur une lecture
                ratée, un tiret : le bandeau ci-dessus dit déjà pourquoi. */}
            {readFailed ? (
              <span className="ent-hint">—</span>
            ) : (
              <span>
                {t('teamVaults.settings.identity.memberCount', { count: mgmt.members.length })}
                <span className="ent-hint" style={{ marginLeft: 8 }}>
                  {Object.keys(roles)
                    .sort()
                    .map((r) => `${t(`teamVaults.role.${r}`, r)} ${roles[r]}`)
                    .join(' · ')}
                </span>
              </span>
            )}
          </Row>
          <Row label={t('teamVaults.settings.identity.epoch')}>
            <span>
              {t('teamVaults.settings.identity.epochValue', { epoch: vault.currentKeyEpoch })}
              {stale && (
                <span className="ent-hint" style={{ marginLeft: 8 }}>
                  {t('teamVaults.settings.identity.epochMine', {
                    epoch: vault.wrappedVaultKeyEpoch,
                  })}
                </span>
              )}
            </span>
          </Row>
          <Row label={t('teamVaults.settings.identity.created')}>
            {(() => {
              const ms = Date.parse(vault.createdAt);
              return Number.isNaN(ms) ? (
                <span className="ent-hint">—</span>
              ) : (
                <RelativeTime ms={ms} />
              );
            })()}
          </Row>
          <Row label={t('teamVaults.settings.identity.vaultId')}>
            <CopyableId value={vault.id} />
          </Row>
        </dl>
      </AdminSection>
    </div>
  );
};

export default OverviewTab;
