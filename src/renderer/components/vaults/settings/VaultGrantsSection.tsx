/**
 * VaultGrantsSection (F17) — « Accès ponctuels » : qui, en dehors des membres,
 * peut encore lire quelque chose ici.
 *
 * LA SEULE FUITE « HORS MEMBRES » D'UN COFFRE. Un grant d'élément scelle K_item
 * à quelqu'un qui n'est PAS dans le trombinoscope : il ne voit rien d'autre du
 * coffre, mais ce qu'il voit, il le voit vraiment, et rien à l'écran ne le
 * récapitulait. Il fallait ouvrir le dialogue de partage de CHAQUE fichier pour
 * dresser la liste — c'est-à-dire ne jamais la dresser. La section est en bas de
 * l'onglet Membres parce que c'est là qu'on se pose la question (« qui a
 * accès ? »), et parce que les gestes qu'elle porte sont ceux d'un
 * administrateur.
 *
 * ELLE NE MASQUE AUCUNE LIGNE, et c'est la règle qui a décidé de sa forme. Trois
 * accès sur quatre se nomment tout seuls (le titre est dans le store) ; le
 * quatrième — coffre verrouillé, élément purgé, méta illisible — est justement
 * le plus inquiétant. Il reste donc affiché, avec son identifiant opaque, sa
 * personne et son bouton Révoquer. « Élément supprimé » n'est en revanche
 * affirmé QUE si la liste des éléments a réellement été lue : le modèle refuse
 * de conclure sur un silence, et l'écran ne le contourne pas.
 *
 * DEUX GESTES, ET ILS NE FONT PAS LA MÊME CHOSE :
 *   · RÉVOQUER coupe l'accès serveur à l'instant, puis fait TOURNER K_item (le
 *     thunk réenregistre le même contenu sous une clé neuve). Sans cette
 *     rotation, la révocation ne serait que déclarative : le destinataire garde
 *     l'ancienne clé. Quand la rotation ne passe pas (offre échue, réseau), on
 *     le DIT — l'accès est coupé, le re-chiffrement suivra au prochain
 *     enregistrement — au lieu de laisser croire à un échec complet.
 *   · RÉPARER rescelle un accès né « stale » sur la version courante de
 *     l'élément. C'est la seule chose qui manquait : jusqu'ici il fallait
 *     ré-enregistrer le document, ce qui n'arrive jamais sur un fichier qu'on ne
 *     touche plus.
 *
 * LES RÉVOCATIONS RESTENT POSSIBLES SUR UN PLAN ÉCHU, et c'est le serveur qui en
 * décide (la route DELETE n'a pas de garde de plan, « même règle que /rotate »).
 * L'écran n'ajoute aucune condition de son côté : couper un accès est un geste de
 * sécurité, jamais une fonctionnalité payante.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Avatar, Button, ConfirmModal, EmptyState } from '../../ui';
import { useNotification } from '../../ui/Notification';
import { AdminSection, CopyableId, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import type { AppDispatch } from '../../../../store';
import {
  loadVaultItems,
  revokeItemGrant,
  rewrapItemGrant,
} from '../../../../store/slices/vaultsSlice';
import { vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import type { VaultGrants } from './useVaultGrants';
import {
  buildGrantOverview,
  grantSummaryCounts,
  type GrantItemRow,
  type GrantPersonRow,
} from './grantOverviewModel';

interface Props {
  vaultId: string;
  grants: VaultGrants;
  /** Les titres déchiffrés sur CET appareil — jamais rien du serveur. */
  nameByItemId: ReadonlyMap<string, string>;
  /**
   * Les éléments dont la liste a été RÉELLEMENT lue, ET EN ENTIER. `null` = pas
   * lue (coffre verrouillé, jamais ouvert) ou lue à trous (des éléments scellés
   * sous une époque dont la clé n'est pas revenue) : aucun accès n'est alors dit
   * orphelin.
   */
  knownItemIds: ReadonlySet<string> | null;
  /** Après CHAQUE geste : relire la liste ET réveiller les agrégats partagés. */
  onChanged: () => Promise<void> | void;
}

const KeyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
  </svg>
);

/**
 * Le même dessin, DIMENSIONNÉ. Posé nu dans un état vide, un SVG sans
 * `width`/`height` se replie sur la taille par défaut d'un élément remplacé et
 * occupe une bande de trois cents pixels (même piège que `MembersGlyph`).
 */
const KeyGlyph = () => (
  <svg
    width="48"
    height="48"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" />
  </svg>
);

export const VaultGrantsSection: React.FC<Props> = ({
  vaultId,
  grants,
  nameByItemId,
  knownItemIds,
  onChanged,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const [busy, setBusy] = useState<string | null>(null);
  /** La personne dont on s'apprête à tout couper — la boîte nomme, elle ne compte pas. */
  const [revokeAll, setRevokeAll] = useState<GrantPersonRow | null>(null);

  /**
   * Une révocation SURVIT À SON ÉCRAN : changer d'onglet démonte celui-ci
   * pendant que la file de rotations tourne encore. Même précaution que
   * `useVaultGrants`, `useVaultManagement` et `MembersTab` — inoffensive
   * aujourd'hui, mais une page où trois hôtes sur quatre s'en gardent et le
   * quatrième non est une page dont on ne sait plus ce qu'elle garantit.
   */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * Les titres viennent du store ; un coffre qu'on n'a pas encore ouvert n'y a
   * rien. Une seule demande par coffre — le partage n'est pas du temps réel, et
   * c'est exactement ce que fait le panneau d'activité pour la même raison.
   *
   * LA CONDITION PORTE SUR LA LISTE LUE, JAMAIS SUR LES TITRES, et c'est une
   * BOUCLE DE REQUÊTES qui l'a décidé. `loadVaultItems.fulfilled` réassigne
   * `itemsByVault[vaultId]` : tableau neuf, donc index de titres neuf, donc
   * dépendance changée à chaque tour — et `size === 0` reste vrai tant que le
   * coffre n'a aucun élément NOMMABLE. C'est le parcours principal (coffre
   * partagé tout juste créé, « Gérer le coffre », onglet Membres), et aussi le
   * coffre dont tous les éléments sont indéchiffrables : la demande se serait
   * relancée indéfiniment. `knownItemIds` ferme la boucle des deux côtés — il
   * passe de `null` à un Set dès la première lecture COMPLÈTE (même vide), et
   * reste `null` — valeur identique, effet non relancé — quand elle échoue ou
   * qu'elle ne ramène qu'une partie des éléments (voir son calcul dans
   * `VaultSettingsView`).
   */
  useEffect(() => {
    if (knownItemIds === null) void dispatch(loadVaultItems({ vaultId }));
    // Un cleanup rendu DANS TOUS LES CAS : sinon TS7030.
    return undefined;
  }, [vaultId, dispatch, knownItemIds]);

  const view = useMemo(
    () =>
      buildGrantOverview({
        grants: grants.grants ?? [],
        nowMs: Date.now(),
        titleByItemId: nameByItemId,
        knownItemIds,
      }),
    [grants.grants, nameByItemId, knownItemIds]
  );

  /**
   * Révoquer une ligne — ou toutes celles d'une personne, en SÉQUENCE.
   *
   * Séquentiel comme le scellement (`ShareItemToPersonBody`) : chaque révocation
   * entraîne une rotation de K_item, et un lot parallèle rendrait un échec au
   * milieu illisible. Un refus SYSTÉMIQUE (coffre verrouillé, réseau) arrête la
   * file : le répéter N fois n'empilerait que la même phrase.
   */
  const revoke = useCallback(
    // `granteeUserId` est REQUIS par le thunk : révoquer écrit aussi
    // l'exclusion, sans quoi un rattrapage de partage de dossier rescellerait
    // l'accès qu'on vient de retirer.
    async (rows: GrantItemRow[], busyKey: string, granteeUserId: string) => {
      setBusy(busyKey);
      let rotationPending = false;
      let stopped = false;
      try {
        for (const r of rows) {
          const res = await dispatch(
            revokeItemGrant({ vaultId, itemId: r.itemId, grantId: r.grantId, granteeUserId })
          );
          if (revokeItemGrant.fulfilled.match(res)) {
            /**
             * LA ROTATION N'A LIEU QUE SI L'ÉLÉMENT EST EN MÉMOIRE. Le thunk la
             * saute en silence quand il ne le trouve pas dans le store (coffre
             * verrouillé, liste jamais lue) : la révocation SERVEUR a bien eu
             * lieu, mais K_item n'a pas changé — le destinataire garde une clé
             * qui ouvre encore ce qu'il a déjà téléchargé. Dire « l'élément a
             * été re-chiffré » y serait FAUX, et c'est exactement la phrase à
             * laquelle on se fie pour juger qu'un accès est vraiment coupé.
             *
             * `null` COUVRE AUSSI LA LECTURE PARTIELLE, et on l'assume dans ce
             * sens-là : la rotation a peut-être eu lieu, on annonce quand même
             * « le re-chiffrement suivra ». Promettre trop peu se rattrape au
             * prochain enregistrement ; promettre trop ne se rattrape jamais.
             */
            if (knownItemIds === null || !knownItemIds.has(r.itemId)) rotationPending = true;
            continue;
          }
          if (res.payload === 'grant_revoked_rotation_failed') {
            // L'accès serveur EST coupé ; la rotation se rejouera au prochain
            // enregistrement. Ce n'est pas un échec, c'est un report.
            rotationPending = true;
            continue;
          }
          stopped = true;
          error(t(vaultErrorKey(String(res.payload ?? ''), 'teamVaults.errors.generic')));
          break;
        }
        if (!stopped) {
          if (rotationPending) error(t('teamVaults.grants.revokedRotationPending'));
          else success(t('teamVaults.grants.revoked'));
        }
      } finally {
        if (mountedRef.current) setBusy(null);
        await onChanged();
      }
    },
    [dispatch, vaultId, error, success, t, onChanged, knownItemIds]
  );

  const repair = useCallback(
    async (person: GrantPersonRow, row: GrantItemRow) => {
      setBusy(row.grantId);
      try {
        const res = await dispatch(
          rewrapItemGrant({
            vaultId,
            itemId: row.itemId,
            grantId: row.grantId,
            granteeUserId: person.userId,
          })
        );
        if (rewrapItemGrant.fulfilled.match(res)) {
          success(t('teamVaults.grantOverview.repaired'));
        } else {
          error(
            t(vaultErrorKey(String(res.payload ?? ''), 'teamVaults.grantOverview.errors.repair'))
          );
        }
      } finally {
        if (mountedRef.current) setBusy(null);
        await onChanged();
      }
    },
    [dispatch, vaultId, error, success, t, onChanged]
  );

  // ── Les trois états qui ne sont PAS une liste ──────────────────────────────

  if (grants.error) {
    return (
      <AdminSection title={t('teamVaults.grantOverview.title')} icon={<KeyIcon />}>
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-sm text-[var(--color-text-primary)] m-0">
            {t(vaultErrorKey(grants.error, 'teamVaults.grantOverview.errors.load'))}
          </p>
          <Button
            size="sm"
            variant="secondary"
            disabled={grants.loading}
            onClick={() => void grants.reload()}
          >
            {t('teamVaults.retry')}
          </Button>
        </div>
      </AdminSection>
    );
  }

  // `null` = pas encore lu (ou pas le droit) : on ne dit surtout pas « aucun ».
  if (grants.grants === null) return null;

  const counts = grantSummaryCounts(view);

  return (
    <AdminSection
      title={t('teamVaults.grantOverview.title')}
      description={t('teamVaults.grantOverview.hint')}
      icon={<KeyIcon />}
      actions={
        !view.empty && (
          <span className="ent-hint">
            {[
              t('teamVaults.grantOverview.summaryItems', { count: counts.items }),
              t('teamVaults.grantOverview.summaryPeople', { count: counts.people }),
              ...(counts.expiring > 0
                ? [t('teamVaults.grantOverview.summaryExpiring', { count: counts.expiring })]
                : []),
            ].join(', ')}
          </span>
        )
      }
    >
      {view.empty ? (
        /* AUCUN accès ponctuel n'est le BON état d'un coffre : la phrase ne
           reproche rien et ne propose aucun geste — il n'y en a pas. */
        <EmptyState
          icon={<KeyGlyph />}
          title={t('teamVaults.grantOverview.empty.title')}
          description={t('teamVaults.grantOverview.empty.body')}
        />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-4">
          {view.people.map((person) => (
            <li key={person.userId} className="flex flex-col gap-2">
              <div className="ent-stack flex items-center gap-2 min-w-0">
                <Avatar label={person.label} seed={person.userId} size="sm" title={null} />
                <span className="truncate" style={{ color: 'var(--color-text-primary)' }}>
                  {person.label}
                </span>
                {person.staleCount > 0 && (
                  <StatusBadge tone="warning" title={t('teamVaults.grantOverview.staleHint')}>
                    {t('teamVaults.grantOverview.staleBadgeCount', { count: person.staleCount })}
                  </StatusBadge>
                )}
                <span className="ml-auto shrink-0">
                  {/* UN SEUL GESTE POUR TOUT COUPER. Répéter N clics sur une
                      personne qui détient dix fichiers, c'est dix rotations de
                      clé faites à la main — et neuf occasions de s'arrêter au
                      milieu sans savoir où. */}
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy !== null}
                    loading={busy === `all:${person.userId}`}
                    onClick={() => setRevokeAll(person)}
                  >
                    {t('teamVaults.grantOverview.revokeAll')}
                  </Button>
                </span>
              </div>

              <ul className="list-none m-0 p-0 pl-8 flex flex-col gap-1.5">
                {person.items.map((row) => (
                  <li
                    key={row.grantId}
                    className="flex flex-wrap items-center gap-2 min-w-0 text-sm"
                  >
                    <span
                      className="truncate min-w-0"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {/* TROIS FAITS DIFFÉRENTS, TROIS PHRASES. Un titre lu ; un
                          élément parti d'une liste qu'on a LUE ; un élément
                          qu'on n'a pas su nommer sur CET appareil. Le troisième
                          n'est jamais masqué : c'est le plus inquiétant. */}
                      {row.title ??
                        (row.orphaned
                          ? t('teamVaults.grantOverview.itemDeleted')
                          : t('teamVaults.grantOverview.itemUnreadable'))}
                    </span>
                    <CopyableId value={row.itemId} />
                    <StatusBadge tone="neutral">
                      {t(`teamVaults.role.${row.role}`, row.role)}
                    </StatusBadge>
                    {row.expiresAt !== null && (
                      <span
                        className={`text-xs shrink-0 ${
                          row.expiringThisWeek || row.expired
                            ? 'text-[var(--color-warning-700,#b45309)]'
                            : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {t(
                          row.expired
                            ? 'teamVaults.grantOverview.expiredOn'
                            : 'teamVaults.grantOverview.expiresOn',
                          { date: new Date(row.expiresAt).toLocaleDateString() }
                        )}
                      </span>
                    )}
                    {row.stale && (
                      <StatusBadge tone="warning" title={t('teamVaults.grantOverview.staleHint')}>
                        {t('teamVaults.grantOverview.staleBadge')}
                      </StatusBadge>
                    )}
                    <span className="ml-auto shrink-0 flex items-center gap-1.5">
                      {/* « Réparer » n'apparaît que quand il y a quelque chose à
                          resceller : un orphelin n'a plus de K_item, et le bouton
                          ne pourrait que se faire refuser. */}
                      {row.repairable && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy !== null}
                          loading={busy === row.grantId}
                          onClick={() => void repair(person, row)}
                        >
                          {t('teamVaults.grantOverview.repair')}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        title={t('teamVaults.grants.revokeConfirmBody')}
                        onClick={() => void revoke([row], row.grantId, person.userId)}
                      >
                        {t('teamVaults.grants.revoke')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {/* Elle NOMME la personne et COMPTE les éléments : « révoquer tout » sans
          dire quoi ni pour qui est le genre de bouton qu'on n'ose pas cliquer. */}
      <ConfirmModal
        isOpen={revokeAll !== null}
        onClose={() => setRevokeAll(null)}
        onConfirm={() => {
          const cible = revokeAll;
          setRevokeAll(null);
          if (cible) void revoke(cible.items, `all:${cible.userId}`, cible.userId);
        }}
        title={t('teamVaults.grantOverview.revokeAllTitle')}
        message={t('teamVaults.grantOverview.revokeAllConfirm', {
          name: revokeAll?.label ?? '',
          count: revokeAll?.items.length ?? 0,
        })}
        confirmText={t('teamVaults.grantOverview.revokeAll')}
        variant="danger"
      />
    </AdminSection>
  );
};

export default VaultGrantsSection;
