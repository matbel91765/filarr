/**
 * VaultKeySection (F10) — « Clé du coffre », EN LECTURE.
 *
 * POURQUOI LA LECTURE EST ICI ET LE GESTE AILLEURS. Faire tourner la clé est
 * irréversible et se paie (une époque de plus, un scellé neuf pour chacun, des
 * invitations à réémettre) : le bouton vit dans l'onglet Danger, avec les autres
 * gestes dont on ne revient pas. Mais on ne décide pas d'une rotation sans
 * savoir ce que l'état actuel raconte — d'où cette section, qui ne fait
 * qu'exposer des faits, et aucune action destructive.
 *
 * CE QU'ELLE DIT, ET CE QU'ELLE REFUSE DE DIRE :
 *
 *   · l'époque courante et la dernière rotation. « Inconnue » quand le fil ne la
 *     porte pas — pas « jamais » : le journal est borné, et il peut être
 *     structurellement coupé (espace personnel, offre sans journal). Une absence
 *     d'information n'est pas un fait.
 *   · la couverture des membres. Trois colonnes, et la troisième compte : un
 *     `wrappedEpoch` absent ne vaut ni à jour ni en retard.
 *   · les invitations à RÉÉMETTRE. C'est le fait le plus contre-intuitif de la
 *     fiche : une invitation scellée sous une clé révolue ne se « relance » pas
 *     (le serveur refuse `invite_stale_epoch`), elle se refait.
 *   · les éléments restés sous une clé ancienne — et, DEPUIS, le geste qui les
 *     répare. On croyait qu'un rescellement était un re-chiffrement complet :
 *     c'est faux, et cette section l'a longtemps affirmé. K_item est STABLE
 *     (0019) ; seule l'ENVELOPPE de K_item sous K_vault est refaite — quelques
 *     centaines d'octets par élément, aucun contenu relu, aucun téléversement.
 *     Ce qui était présenté comme une fatalité était donc un bouton manquant,
 *     et son absence laissait DÉFINITIVEMENT amputé tout membre ajouté après une
 *     rotation. Le compte, lui, ne porte toujours que sur ce que cet appareil a
 *     chargé : un coffre jamais ouvert ne rend AUCUN chiffre plutôt qu'un « 0 »
 *     rassurant et faux.
 *   · mes époques, et celles qui me manquent — c'est le même verdict que la
 *     carte « Vous » (F15), calculé par le même modèle et dit avec les mêmes
 *     mots.
 *
 * L'AUTO-CONTRÔLE N'EST PAS ICI, ET C'EST DÉLIBÉRÉ. « Mon scellé de l'époque
 * courante s'ouvre-t-il ? » est calculé UNE fois par la page et affiché en
 * bandeau au-dessus des onglets, avec le nom des administrateurs à qui demander
 * une nouvelle rotation. Deux raisons : un lecteur verrouillé dehors n'a PAS
 * accès à cet onglet (Réglages est réservé aux administrateurs) et doit
 * pourtant l'apprendre ; et un même fait dit à deux endroits de la même page
 * finit par être dit de deux façons. La section n'en garde qu'une ligne d'état,
 * à sa place dans le tableau de couverture.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, ProgressBar } from '../../ui';
import { Skeleton } from '../../ui/Skeleton/Skeleton';
import { AdminSection, RelativeTime, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import { isVaultUnlocked } from '../../../../services/vault/vaultKeyCache';
import type { VaultManagement } from './useVaultManagement';
import type { VaultKeyHistory } from './useVaultKeyHistory';
import type { VaultTabId } from './vaultManagementModel';
import {
  inviteEpochCoverage,
  itemEpochCoverage,
  memberEpochCoverage,
  type ItemEpochRow,
  type MySealVerdict,
} from './epochCoverage';
import { epochCoverage, summarizeMissingEpochs } from './mySecurityModel';
import { planRewrap, REWRAP_BATCH_SIZE, type RewrapCandidate } from './rewrapPlan';
import { rewrapStaleItems } from '../../../../store/slices/vaultsSlice';
import type { AppDispatch, RootState } from '../../../../store';

const KeyIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 8.8-8.8" />
    <path d="m17 6 3 3" />
  </svg>
);

interface Props {
  vaultId: string;
  currentKeyEpoch: number;
  /** L'auto-contrôle, calculé par la page (qui en fait aussi son bandeau). */
  verdict: MySealVerdict;
  mgmt: VaultManagement;
  history: VaultKeyHistory;
  /**
   * Les éléments chargés de ce coffre — `undefined` = jamais ouvert ici.
   *
   * Le COMPTE n'a besoin que de l'époque ; le GESTE a besoin en plus de
   * l'identifiant et de la version (le compare-and-set du serveur s'appuie
   * dessus). D'où l'intersection des deux formes plutôt qu'un second champ :
   * deux listes d'éléments à garder d'accord finiraient par ne plus l'être.
   */
  items: readonly (ItemEpochRow & RewrapCandidate)[] | undefined;
  /**
   * L'appelant a-t-il le rang pour re-sceller ? L'onglet est déjà réservé aux
   * administrateurs (`ADMIN_ONLY_TABS`) — c'est une ceinture, pas une porte : le
   * serveur refuse de toute façon, et un bouton qui ne peut qu'échouer est pire
   * qu'un bouton absent.
   */
  canRewrap: boolean;
  onGoTo: (tab: VaultTabId) => void;
}

/** Ce que le geste a VRAIMENT fait — jamais un simple « c'est fait ». */
type RewrapOutcome =
  | {
      ok: true;
      rewrapped: number;
      skipped: number;
      skippedEpochs: number[];
      unreadable: number;
      conflictsLeft: number;
    }
  | { ok: false; code: string | null };

export const VaultKeySection: React.FC<Props> = ({
  vaultId,
  currentKeyEpoch,
  verdict,
  mgmt,
  history,
  items,
  canRewrap,
  onGoTo,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const progress = useSelector((s: RootState) => s.vaults.rewrapProgress[vaultId]);
  /**
   * L'HISTORIQUE DES CLÉS A-T-IL PU ÊTRE LU au dernier chargement ?
   *
   * SANS CE DRAPEAU, UNE PANNE DE RÉSEAU SE LIRAIT COMME UN VERDICT. Les clés
   * d'époques anciennes ne sont pas en cache au démarrage : `loadVaultItems` les
   * va chercher (`ensureEpochKeys`), et quand CETTE lecture échoue, aucune
   * ancienne époque n'est ouverte ici. Le plan rangerait alors TOUS les éléments
   * en retard dans les « sautés faute de clé » — une accusation (« cet appareil
   * ne possède pas ces clés ») fabriquée à partir d'une absence, sur un membre
   * qui les détient parfaitement. C'est exactement la règle que cette section
   * applique partout ailleurs : une absence d'information n'est pas un fait.
   *
   * On garde donc le bouton ACTIF — le geste refait la lecture, et réussira
   * peut-être — et on se tait sur ce qu'on sauterait.
   */
  const historyAvailable = useSelector(
    (s: RootState) => s.vaults.decryptStatusByVault[vaultId]?.historyAvailable ?? true
  );
  const [rewrapping, setRewrapping] = useState(false);
  const [outcome, setOutcome] = useState<RewrapOutcome | null>(null);

  // Le geste survit à son écran : on peut changer d'onglet pendant un lot.
  const vivantRef = useRef(true);
  useEffect(() => {
    vivantRef.current = true;
    // Un cleanup rendu DANS TOUS LES CAS (TS7030).
    return () => {
      vivantRef.current = false;
    };
  }, []);

  const membres = useMemo(
    () => memberEpochCoverage(mgmt.members, currentKeyEpoch),
    [mgmt.members, currentKeyEpoch]
  );
  const invitations = useMemo(
    () => inviteEpochCoverage(mgmt.invites, currentKeyEpoch),
    [mgmt.invites, currentKeyEpoch]
  );
  const elements = useMemo(
    () => itemEpochCoverage(items, currentKeyEpoch),
    [items, currentKeyEpoch]
  );

  /**
   * CE QU'ON PEUT RÉPARER ICI, ET AVEC QUELLES CLÉS. Le plan est recalculé à
   * chaque rendu utile parce qu'il dépend du TROUSSEAU DE CETTE SESSION
   * (`isVaultUnlocked`) autant que de la liste : une époque qui s'ouvre après un
   * déverrouillage change le nombre d'éléments réparables sans que la liste ait
   * bougé d'une ligne.
   */
  const plan = useMemo(
    () =>
      planRewrap({
        items,
        currentKeyEpoch,
        canOpenEpoch: (epoch) => isVaultUnlocked(vaultId, epoch),
      }),
    [items, currentKeyEpoch, vaultId]
  );

  /**
   * CE QUE LE BOUTON PROMET. Le plan quand on sait ce qu'on peut ouvrir ; le
   * COMPTE BRUT quand l'historique des clés n'a pas pu être lu — annoncer
   * « re-sceller 0 élément » sur un coffre qui en a quatre en retard ferait
   * passer une panne de lecture pour un travail terminé.
   */
  const aReparer = historyAvailable ? plan.total : elements.old;

  const lancerRewrap = useCallback(async () => {
    setRewrapping(true);
    setOutcome(null);
    const action = await dispatch(rewrapStaleItems({ vaultId }));
    if (!vivantRef.current) return;
    if (rewrapStaleItems.fulfilled.match(action)) {
      setOutcome({ ok: true, ...action.payload });
    } else {
      // Le code du refus, pas une phrase : c'est LUI qui décide de la traduction
      // (coffre verrouillé, rotation concurrente, ou l'échec générique).
      setOutcome({
        ok: false,
        code: typeof action.payload === 'string' ? action.payload : null,
      });
    }
    setRewrapping(false);
  }, [dispatch, vaultId]);

  /**
   * MES ÉPOQUES — le MÊME modèle que la carte « Vous » (F15), volontairement.
   * Deux calculs de la même chose auraient fini par afficher deux comptes
   * différents dans deux onglets de la même page.
   */
  const miennes = useMemo(
    () =>
      epochCoverage({
        wraps: history.wraps,
        currentKeyEpoch,
        // `isVaultUnlocked` plutôt que `getVaultKey(...) !== null` : une
        // manipulation de secret en moins pour exactement le même verdict.
        unlocked: (epoch) => isVaultUnlocked(vaultId, epoch),
      }),
    [history.wraps, currentKeyEpoch, vaultId]
  );

  return (
    <AdminSection
      title={t('teamVaults.settings.key.title')}
      description={t('teamVaults.settings.key.hint')}
      icon={<KeyIcon />}
      actions={
        history.state === 'unavailable' ? (
          <Button size="sm" variant="secondary" onClick={history.reload}>
            {t('teamVaults.retry')}
          </Button>
        ) : undefined
      }
    >
      {/* ── L'époque courante et la dernière rotation ─────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatusBadge title={t('teamVaults.settings.identity.epoch')}>
          {t('teamVaults.settings.identity.epochValue', { epoch: currentKeyEpoch })}
        </StatusBadge>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {history.last ? (
            <>
              {t('teamVaults.settings.key.lastRotation', {
                who: history.last.actorUserId
                  ? mgmt.display(history.last.actorUserId)
                  : t('teamVaults.activity.someone'),
              })}{' '}
              <RelativeTime ms={history.last.atMs ?? 0} />
            </>
          ) : currentKeyEpoch <= 1 ? (
            t('teamVaults.settings.key.neverRotated')
          ) : (
            // « Inconnue », jamais « jamais » : le fil est borné et peut être
            // coupé ; l'absence de ligne n'est pas l'absence de rotation.
            t('teamVaults.settings.key.lastRotationUnknown')
          )}
        </span>
      </div>

      {/* ── La frise ──────────────────────────────────────────────────────── */}
      <div className="mt-3">
        {history.state === 'loading' && <Skeleton height="5rem" borderRadius="0.5rem" />}
        {history.state === 'unavailable' && (
          <p className="ent-hint m-0">{t('teamVaults.settings.key.historyUnavailable')}</p>
        )}
        {history.state === 'ready' && (
          <ol className="m-0 p-0 list-none flex flex-col gap-1.5">
            {history.entries.map((e) => (
              <li
                key={e.epoch}
                className="flex items-center gap-2 flex-wrap text-xs text-[var(--color-text-secondary)]"
              >
                <StatusBadge tone={e.current ? 'success' : 'neutral'}>
                  {t('teamVaults.settings.identity.epochValue', { epoch: e.epoch })}
                </StatusBadge>
                <span>
                  {e.origin === 'creation'
                    ? t('teamVaults.settings.key.timeline.created')
                    : e.atMs !== null
                      ? t('teamVaults.settings.key.timeline.rotatedBy', {
                          who: e.actorUserId
                            ? mgmt.display(e.actorUserId)
                            : t('teamVaults.activity.someone'),
                        })
                      : t('teamVaults.settings.key.timeline.rotatedUnknown')}
                </span>
                {e.atMs !== null && <RelativeTime ms={e.atMs} />}
                {/* Combien de personnes ce geste a retirées — `0` est une
                    information (« renouvellement seul »), pas un vide. */}
                {e.removed !== null && (
                  <span className="ent-hint">
                    {e.removed > 0
                      ? t('teamVaults.settings.key.timeline.removed', { count: e.removed })
                      : t('teamVaults.settings.key.timeline.noRemoval')}
                  </span>
                )}
                {!e.mine && (
                  <StatusBadge tone="warning" title={t('teamVaults.settings.key.notMineHint')}>
                    {t('teamVaults.settings.key.notMine')}
                  </StatusBadge>
                )}
              </li>
            ))}
            {/* CE QUI N'EST PAS ÉNUMÉRÉ EST DIT. La frise s'arrête à
                `MAX_TIMELINE_EPOCHS` lignes — son plafond vient du serveur, et
                une liste pilotée par un entier du courtier gèlerait la fenêtre.
                Élider en silence ferait passer une frise coupée pour entière,
                ce qui est exactement le mensonge que cette section refuse
                ailleurs (« inconnue », jamais « jamais »). */}
            {history.truncatedBefore > 0 && (
              <li className="text-xs text-[var(--color-text-tertiary)]">
                {t('teamVaults.settings.key.timeline.earlier', {
                  count: history.truncatedBefore,
                })}
              </li>
            )}
          </ol>
        )}
      </div>

      {/* ── Mes époques, dites comme dans la carte « Vous » ───────────────── */}
      {history.state === 'ready' && miennes.totalEpochs > 0 && (
        <div className="mt-3">
          <p className="ent-hint m-0">
            {/* Les COMPTES, pas la taille de la fenêtre : `rows` est borné
                (le plafond vient du serveur), les nombres se calculent et
                restent donc exacts. */}
            {t('teamVaults.settings.mine.epochs', {
              sealed: miennes.sealedCount,
              total: miennes.totalEpochs,
            })}
          </p>
          {miennes.missingCount > 0 &&
            (() => {
              const resume = summarizeMissingEpochs(
                miennes.missing,
                undefined,
                miennes.missingCount
              );
              const liste = resume.shown.join(', ');
              return (
                <p className="ent-hint m-0" style={{ marginTop: 2 }}>
                  {t('teamVaults.settings.mine.epochsMissing', {
                    count: miennes.missingCount,
                    epochs:
                      resume.rest > 0
                        ? t('teamVaults.settings.mine.epochsMore', {
                            epochs: liste,
                            count: resume.rest,
                          })
                        : liste,
                  })}
                </p>
              );
            })()}
        </div>
      )}

      {/* ── La couverture : membres, invitations, éléments ────────────────── */}
      <dl className="ent-kv m-0 mt-4">
        <dt className="ent-kv__key">{t('teamVaults.settings.key.coverage.members')}</dt>
        <dd className="ent-kv__val m-0">
          {membres.known ? (
            <span className="flex items-center gap-2 flex-wrap">
              <StatusBadge tone="success">
                {t('teamVaults.settings.key.coverage.upToDate', {
                  count: membres.upToDate.length,
                })}
              </StatusBadge>
              {membres.behind.length > 0 && (
                <StatusBadge tone="warning">
                  {t('teamVaults.settings.key.coverage.behind', { count: membres.behind.length })}
                </StatusBadge>
              )}
              {membres.unknown.length > 0 && (
                <StatusBadge>
                  {t('teamVaults.settings.key.coverage.unknown', {
                    count: membres.unknown.length,
                  })}
                </StatusBadge>
              )}
            </span>
          ) : (
            // Aucune époque servie : le rang, ou un worker d'avant la fiche.
            // On ne convertit pas ce silence en « tout le monde est à jour ».
            <span className="ent-hint">{t('teamVaults.settings.key.coverage.noEpochs')}</span>
          )}
          {membres.behind.length > 0 && (
            <p className="ent-hint m-0 mt-1">
              {membres.behind
                .map((m) =>
                  t('teamVaults.settings.key.coverage.behindOne', {
                    who: mgmt.display(m.userId),
                    epoch: m.wrappedEpoch ?? 0,
                  })
                )
                .join(' · ')}
            </p>
          )}
        </dd>

        <dt className="ent-kv__key">{t('teamVaults.settings.key.coverage.mine')}</dt>
        <dd className="ent-kv__val m-0">
          {/* Le verdict vient de la page — voir l'en-tête. Ici c'est une ligne
              d'état parmi les autres ; le bandeau, lui, nomme qui appeler. */}
          <StatusBadge
            tone={
              verdict === 'ok'
                ? 'success'
                : verdict === 'behind' || verdict === 'unreadable'
                  ? 'error'
                  : 'neutral'
            }
          >
            {t(`teamVaults.settings.key.selfCheck.${verdict}`, { epoch: currentKeyEpoch })}
          </StatusBadge>
        </dd>

        <dt className="ent-kv__key">{t('teamVaults.settings.key.coverage.invites')}</dt>
        <dd className="ent-kv__val m-0">
          {invitations.toReissue.length > 0 ? (
            <span className="flex items-center gap-2 flex-wrap">
              <StatusBadge tone="warning">
                {t('teamVaults.settings.key.coverage.toReissue', {
                  count: invitations.toReissue.length,
                })}
              </StatusBadge>
              {/* Un renvoi, pas un second geste : le bouton « Réémettre » vit
                  dans l'onglet Invitations, et il n'y en aura pas deux. */}
              <Button size="sm" variant="secondary" onClick={() => onGoTo('invitations')}>
                {t('teamVaults.settings.key.coverage.seeInvites')}
              </Button>
            </span>
          ) : (
            // Sans compteur : « 0 invitation à réémettre » et « aucune
            // invitation du tout » se liraient pareil, et le second n'est pas
            // une information sur les clés.
            <span className="ent-hint">{t('teamVaults.settings.key.coverage.invitesFine')}</span>
          )}
        </dd>

        <dt className="ent-kv__key">{t('teamVaults.settings.key.coverage.items')}</dt>
        <dd className="ent-kv__val m-0">
          {!elements.known ? (
            // Le pire des trois états serait « 0 » : rassurant, et faux.
            <span className="ent-hint">{t('teamVaults.settings.key.coverage.itemsUnknown')}</span>
          ) : elements.old === 0 ? (
            <span className="ent-hint">{t('teamVaults.settings.key.coverage.itemsFine')}</span>
          ) : (
            <>
              <StatusBadge>
                {t('teamVaults.settings.key.coverage.itemsOld', { count: elements.old })}
              </StatusBadge>
              <p className="ent-hint m-0 mt-1">
                {t('teamVaults.settings.key.coverage.itemsOldHint', {
                  // Le COMPTE est celui des époques, pas des éléments : c'est
                  // lui qui décide de « la clé » ou « les clés ».
                  count: elements.byEpoch.length,
                  epochs: elements.byEpoch.map((b) => `v${b.epoch}`).join(', '),
                })}
              </p>
              {/* ── LE GESTE (et non plus le seul constat) ──────────────────
                  Ce compteur a longtemps été un cul-de-sac : il DISAIT le
                  défaut sans offrir d'issue, si bien qu'un membre ajouté après
                  une rotation restait amputé de l'histoire du coffre pour
                  toujours. Le bouton ne promet que ce qu'il peut tenir — le
                  nombre d'éléments dont CET appareil détient l'époque — et tout
                  ce qu'il ne peut pas faire est dit AVANT le clic. */}
              {!canRewrap ? (
                <p className="ent-hint m-0">{t('teamVaults.settings.key.coverage.noReseal')}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-2">
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rewrapping || plan.blocked || aReparer === 0}
                      onClick={() => void lancerRewrap()}
                    >
                      {rewrapping
                        ? t('teamVaults.settings.key.rewrap.running')
                        : t('teamVaults.settings.key.rewrap.button', { count: aReparer })}
                    </Button>
                  </div>
                  {/* L'historique n'a pas pu être lu : on ne sait pas encore ce
                      qu'on peut ouvrir, et on ne fait pas passer ça pour un
                      manque de clés. */}
                  {!historyAvailable && (
                    <p className="ent-hint m-0">{t('teamVaults.decryptTransient')}</p>
                  )}
                  {/* Sans la clé courante, aucune enveloppe ne se REFERME : on le
                      dit au lieu de laisser un bouton grisé sans raison. */}
                  {plan.blocked && (
                    <p className="ent-hint m-0">{t('teamVaults.settings.key.rewrap.blocked')}</p>
                  )}
                  {/* Ce que le bouton ne fera PAS, dit avant qu'on l'attende :
                      sinon le compteur ne tombe pas à zéro et rien ne l'explique. */}
                  {historyAvailable && !plan.blocked && plan.skipped.length > 0 && (
                    <p className="ent-hint m-0">
                      {t('teamVaults.settings.key.rewrap.skipped', {
                        count: plan.skipped.length,
                      })}{' '}
                      {t('teamVaults.settings.key.rewrap.skippedEpochs', {
                        epochs: plan.skippedEpochs.map((e) => `v${e}`).join(', '),
                      })}
                    </p>
                  )}
                  {/* La barre n'apparaît que s'il y a plusieurs lots : sur un lot
                      unique elle clignoterait sans jamais rien apprendre. */}
                  {rewrapping && progress && progress.total > REWRAP_BATCH_SIZE && (
                    <ProgressBar
                      size="sm"
                      value={progress.done}
                      max={progress.total}
                      label={t('teamVaults.settings.key.rewrap.progress', {
                        done: progress.done,
                        total: progress.total,
                      })}
                    />
                  )}
                  {outcome && !rewrapping && (
                    <div className="flex flex-col gap-1">
                      {outcome.ok ? (
                        <>
                          <p className="ent-hint m-0">
                            {outcome.rewrapped > 0
                              ? t('teamVaults.settings.key.rewrap.done', {
                                  count: outcome.rewrapped,
                                })
                              : t('teamVaults.settings.key.rewrap.none')}
                          </p>
                          {outcome.skipped > 0 && (
                            <p className="ent-hint m-0">
                              {t('teamVaults.settings.key.rewrap.skipped', {
                                count: outcome.skipped,
                              })}{' '}
                              {t('teamVaults.settings.key.rewrap.skippedEpochs', {
                                epochs: outcome.skippedEpochs.map((e) => `v${e}`).join(', '),
                              })}
                            </p>
                          )}
                          {/* La bonne époque, et pourtant rien ne s'ouvre : ce
                              n'est pas la même panne qu'une clé absente, et la
                              confondre enverrait chercher le mauvais remède. */}
                          {outcome.unreadable > 0 && (
                            <p className="ent-hint m-0">
                              {t('teamVaults.settings.key.rewrap.unreadable', {
                                count: outcome.unreadable,
                              })}
                            </p>
                          )}
                          {outcome.conflictsLeft > 0 && (
                            <p className="ent-hint m-0">
                              {t('teamVaults.settings.key.rewrap.conflicts', {
                                count: outcome.conflictsLeft,
                              })}
                            </p>
                          )}
                        </>
                      ) : (
                        <p className="ent-hint m-0">
                          {t(
                            outcome.code === 'vault_epoch_conflict'
                              ? 'teamVaults.settings.key.rewrap.epochConflict'
                              : outcome.code === 'vault_locked'
                                ? 'teamVaults.settings.key.rewrap.blocked'
                                : 'teamVaults.settings.key.rewrap.failed'
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </dd>
      </dl>

      {/* Le fil ne journalise pas sur ce plan : la frise n'aura JAMAIS de dates
          ici, et le dire évite de chercher une panne. */}
      {history.recorded === false && (
        <p className="ent-hint m-0 mt-3">{t('teamVaults.settings.key.notRecorded')}</p>
      )}
    </AdminSection>
  );
};

export default VaultKeySection;
