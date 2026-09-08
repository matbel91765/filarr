/**
 * DangerTab — les trois gestes dont on ne revient pas facilement : transmettre
 * la propriété, quitter, supprimer.
 *
 * L'ORDRE DE SORTIE COMPTE. Quitter et Supprimer font tomber le coffre de
 * l'état Redux ; or c'est lui qui décide si cette page a le droit d'exister.
 * Naviguer APRÈS le thunk laisserait, l'espace d'un rendu, une route
 * `/vault-folder/<id>?view=settings` sur un coffre disparu — c'est-à-dire
 * l'écran « Coffre introuvable » en guise d'accusé de réception. On navigue
 * donc D'ABORD, et on laisse le thunk finir dans une page qui n'écoute plus.
 * Le hook `useRemoveVaultMember` fait la même chose depuis toujours pour le
 * retrait de soi-même, avec son `mountedRef`.
 *
 * QUI PEUT QUOI : le serveur tranche (`requireVaultRole`), ceci ne fait que
 * ranger l'écran. « Quitter » est offert à tout le monde — c'est la sortie de
 * secours d'un lecteur — et sa seule garde (`last_owner`) est côté serveur : on
 * ne la devine pas ici, on affiche le message qu'il renvoie, parce que lui seul
 * sait s'il reste un autre propriétaire.
 *
 * NI ÉTAT VIDE NI BANDEAU D'ERREUR DE CHARGEMENT ICI (F05), ET C'EST UN VERDICT,
 * PAS UN OUBLI. Les zones n'ont besoin que de `myRole`, qui vient de l'état
 * Redux du coffre, et les gestes appellent le serveur directement. Une panne de
 * lecture de l'effectif ne casse donc rien de ce qu'on voit ici — poser une
 * alerte rouge au-dessus de boutons qui fonctionnent apprendrait à ne plus lire
 * les alertes.
 *
 * RENOUVELER LA CLÉ EST LE PREMIER GESTE DE LA PILE (F10), et c'est le seul
 * qui ne détruit rien. Il est ici parce qu'il est IRRÉVERSIBLE et qu'il se paie
 * : une époque de plus, un scellé neuf pour chaque membre, et toute invitation
 * en attente scellée sous l'ancienne clé devient à réémettre (le serveur refuse
 * de la relancer, `invite_stale_epoch`). Ce qu'il protège est plus étroit qu'on
 * ne croit, et la confirmation le dit en toutes lettres : les éléments FUTURS.
 * Les wraps historiques restent servis aux membres restants — sans quoi ils
 * perdraient tout l'existant — et les éléments déjà chiffrés restent sous leur
 * époque d'origine. Laisser croire à une remise à zéro serait promettre une
 * garantie que le zéro-connaissance ne tient pas.
 *
 * LA CONSERVATION LÉGALE, ELLE, VIENT DU CHARGEUR (F19), et c'est la seule
 * chose qui en vient. Elle ferme réellement « Supprimer » côté serveur ; la
 * connaître AVANT le clic est tout le sujet de la fiche. Quand on ne la connaît
 * pas — rang en dessous d'admin, lecture retombée — on ne ferme rien et on
 * n'affirme rien : le refus du serveur reste la vérité, et il a sa phrase.
 *
 * VIDER LA CORBEILLE (F20) EST LE PREMIER GESTE VRAIMENT SANS RETOUR DE CETTE
 * PILE, et il se paie de trois choses que les autres n'ont pas :
 *
 *  · UN MOT À TAPER. « Supprimer le coffre » reste réversible trente jours ;
 *    vider la corbeille ne l'est PAS une seconde. Un clic de confirmation ne
 *    sépare pas assez les deux gestes, d'où la saisie (`PromptModal` — le dépôt
 *    n'avait pas encore de patron pour cela).
 *  · UNE BOUCLE, ET SA CONDITION D'ARRÊT. La route détruit par passes de
 *    cinquante et rend `{ purged, remaining }`. On rappelle tant que
 *    `purged > 0 && remaining > 0` ; on S'ARRÊTE sur `purged === 0 &&
 *    remaining > 0`, parce que cela signifie que le stockage refuse
 *    durablement ces objets-là — rappeler reproduirait la même passe jusqu'au
 *    429 du seau (30/h), c'est-à-dire un quart d'heure de roue qui tourne pour
 *    finir sur une erreur de débit au lieu de la vraie phrase.
 *  · UN ÉCHEC PARTIEL QUI SE DIT. « Corbeille vidée » sur une corbeille qui en
 *    contient encore sept ferait croire que ces octets ne pèsent plus et que ces
 *    documents n'existent plus.
 *
 * « PURGER LE COFFRE » N'EST PAS ICI, ET CE N'EST PAS UN OUBLI. Cette page ne
 * s'ouvre que sur un coffre VIVANT (le rail et la route la ferment sur un coffre
 * révoqué), or la route de purge exige précisément un coffre DÉJÀ à la
 * corbeille. Le bouton vit donc là où vivent les coffres supprimés : la
 * corbeille des coffres, au pied du rail (`VaultTrash`).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Button, ConfirmModal, ProgressBar, PromptModal } from '../../ui';
import { Skeleton } from '../../ui/Skeleton/Skeleton';
import { useNotification } from '../../ui/Notification';
import { DangerZone, InfoCallout } from '../../settings/enterprise/AdminPrimitives';
import { vaultErrorKey, errorText } from '../../../../services/vault/vaultErrorMessages';
import {
  VaultTrashPartialError,
  apiEmptyVaultTrash,
  apiFreezeVault,
  apiListDeletedVaultItems,
  apiUnfreezeVault,
} from '../../../../services/vault/vaultApi';
import type { AppDispatch } from '../../../../store';
import {
  deleteVault,
  leaveVault,
  rotateVaultKey,
  vaultFreezeState,
} from '../../../../store/slices/vaultsSlice';
import { parseInstant } from './inviteLifecycleModel';
import { formatBytes } from '../useVaultBrowser';
import type { VaultManagement } from './useVaultManagement';
import type { VaultStatsHandle } from './useVaultStats';
import type { DangerGuard } from './vaultSettingsModel';
import {
  type EmptyTrashStep,
  emptyTrashOutcome,
  emptyTrashProgressPct,
  emptyTrashStep,
  matchesConfirmWord,
  oldestDeletedAt,
  trashSummary,
} from './trashModel';

interface Props {
  vaultId: string;
  myRole: string;
  mgmt: VaultManagement;
  /**
   * Ce qui ferme les gestes irréversibles (F19). `'none'` recouvre « il n'y a
   * pas de conservation » ET « on ne sait pas » — les deux laissent les boutons
   * en place, le serveur ayant de toute façon le dernier mot
   * (`legal_hold_active`, déjà traduit).
   */
  guard: DangerGuard;
  /**
   * Les agrégats du coffre (F07) — ce que la corbeille pèse et combien elle
   * contient. Chargés par la PAGE : le seau du worker est de 120 lectures par
   * heure et par coffre, pour tous ses membres à la fois.
   */
  stats: VaultStatsHandle;
  /**
   * L'ÉTAT DE GEL (F23), tel que le résumé Redux le porte — pas une lecture de
   * plus. C'est le même fait que celui qui fait disparaître les boutons de
   * l'explorateur, et deux lectures finiraient par afficher un interrupteur
   * « Geler » sur un coffre déjà gelé.
   */
  frozenAt: string | null;
  frozenBy: string | null;
}

/** L'avancement d'un vidage en cours, ou son verdict. */
interface EmptyProgress {
  purged: number;
  /**
   * Ce qu'il restait à la dernière réponse — la barre s'en sert comme
   * dénominateur. `null` tant qu'AUCUNE passe n'est revenue ET que les agrégats
   * n'ont pas été lus : il n'y a alors pas de dénominateur du tout, et en
   * inventer un (zéro) afficherait une barre PLEINE au tout début d'une
   * destruction sans retour.
   */
  remaining: number | null;
  running: boolean;
}

export const DangerTab: React.FC<Props> = ({
  vaultId,
  myRole,
  mgmt,
  guard,
  stats,
  frozenAt,
  frozenBy,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const { success, error } = useNotification();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  /** `'freeze'` ou `'unfreeze'` — la confirmation ouverte, s'il y en a une. */
  const [confirmFreeze, setConfirmFreeze] = useState<'freeze' | 'unfreeze' | null>(null);
  const [emptying, setEmptying] = useState<EmptyProgress | null>(null);
  const [busy, setBusy] = useState(false);

  // Un geste de cette page peut démonter son propre hôte (quitter, supprimer)
  // pendant que la boucle de vidage tourne encore.
  const vivantRef = useRef(true);
  useEffect(() => {
    vivantRef.current = true;
    return () => {
      vivantRef.current = false;
    };
  }, []);

  /**
   * L'INSTANT DU PLUS ANCIEN ÉLÉMENT DE LA CORBEILLE — la seule façon de dater
   * la prochaine purge automatique.
   *
   * POURQUOI UNE LECTURE DE PLUS, ET POURQUOI ELLE NE PORTE RIEN. Les agrégats
   * (`/stats`) comptent la corbeille et la pèsent, mais ne servent AUCUN instant
   * de suppression : dater la purge de « maintenant + N jours » promettrait un
   * mois à un élément supprimé il y a vingt-neuf jours. La liste de la corbeille,
   * elle, porte `updatedAt`, et pour une ligne qui EST à la corbeille c'est
   * exactement la date de suppression (voir `oldestDeletedAt` : toutes les autres
   * écritures d'un élément portent `AND deleted_at IS NULL`).
   *
   * La lecture est ADVISORY : son échec ne s'affiche pas et ne ferme rien — la
   * carte dit alors la durée de conservation sans citer de date, ce qui reste
   * vrai. C'est la même discipline que les sièges de l'Aperçu.
   */
  const [oldestDeletedAtMs, setOldestDeletedAtMs] = useState<number | null>(null);
  const canEmptyTrash = myRole === 'owner';
  const relireCorbeille = useCallback(async () => {
    if (!canEmptyTrash) return;
    try {
      const rows = await apiListDeletedVaultItems(vaultId);
      if (vivantRef.current) setOldestDeletedAtMs(oldestDeletedAt(rows));
    } catch {
      // Une date qu'on n'a pas su lire n'est pas une date fausse : on n'en
      // affiche simplement aucune.
      if (vivantRef.current) setOldestDeletedAtMs(null);
    }
  }, [vaultId, canEmptyTrash]);

  useEffect(() => {
    void relireCorbeille();
    // Un cleanup rendu DANS TOUS LES CAS : une fonction qui n'en rend que dans
    // une branche déclenche TS7030.
    return () => {};
  }, [relireCorbeille]);

  /**
   * LA CONSERVATION N'EST AFFIRMÉE QUE SI ELLE A ÉTÉ LUE (même règle que le
   * compte, trois lignes plus bas). `useVaultSettings` retombe VOLONTAIREMENT
   * sur `DEFAULT_VAULT_SETTINGS` — donc trente jours — quand la lecture échoue,
   * et le signale par `state === 'unavailable'` ; `SettingsTab` respecte ce
   * signal (écran d'erreur + Réessayer), et cette carte l'ignorait. Sur un
   * coffre réglé à sept jours dont les réglages n'ont pas pu être lus, elle
   * annonçait « détruits 30 jours après leur suppression » PUIS datait la purge
   * avec : une date jusqu'à quatre-vingt-trois jours trop tard, présentée comme
   * un fait, sur la seule carte de la page qui parle de destruction
   * irréversible. Le `null` fait porter l'ignorance par le MODÈLE, qui refuse
   * alors aussi de dater.
   */
  const retentionRead = mgmt.settings.state === 'ok';
  const trash = trashSummary({
    trashedCount: stats.stats ? stats.stats.trashedCount : null,
    trashedBytes: stats.stats ? stats.stats.trashedBytes : null,
    retentionDays: retentionRead ? mgmt.settings.settings.trashRetentionDays : null,
    oldestDeletedAtMs,
    nowMs: Date.now(),
  });

  /**
   * VIDER LA CORBEILLE — la boucle, et la seule condition d'arrêt qui soit
   * honnête (voir l'en-tête). Le mot a déjà été tapé quand on arrive ici.
   */
  const doEmptyTrash = useCallback(async () => {
    setEmptying({
      purged: 0,
      // Un compte JAMAIS lu ne devient pas zéro : `remaining: null` fait basculer
      // la barre en indéterminé plutôt que de l'afficher PLEINE au tout début
      // d'une destruction sans retour (`emptyTrashProgressPct({0,0}) === 100`,
      // par construction).
      remaining: trash.count,
      running: true,
    });
    let purgeTotal = 0;
    let passes = 0;
    let reste = 0;
    // Le verdict de la DERNIÈRE passe : c'est lui qui sait si la boucle s'est
    // arrêtée sur un refus du stockage ou sur NOTRE borne.
    let dernier: EmptyTrashStep = 'done';
    try {
      // `while (true)` remplacé par une borne EXPLICITE : la boucle ne dépend
      // jamais de la seule bonne foi du serveur.
      for (;;) {
        const passe = await apiEmptyVaultTrash(vaultId);
        passes += 1;
        purgeTotal += passe.purged;
        reste = passe.remaining;
        if (!vivantRef.current) return;
        setEmptying({ purged: purgeTotal, remaining: reste, running: true });
        dernier = emptyTrashStep(passe, passes);
        if (dernier !== 'again') break;
      }
      const verdict = emptyTrashOutcome(purgeTotal, reste, dernier);
      if (verdict.outcome === 'capped') {
        // NOTRE BORNE, PAS UNE PANNE DU SERVEUR. Au-delà de mille cinq cents
        // éléments, la boucle s'arrête sur le seau horaire (30 passes) : dire
        // « le serveur n'arrive pas à les détruire » enverrait chercher un
        // incident qui n'existe pas, sur des documents qui partiront tout seuls.
        error(
          t('teamVaults.settings.danger.trash.capped', {
            purged: verdict.purged,
            remaining: verdict.remaining,
          })
        );
      } else if (verdict.outcome === 'partial') {
        // ON NE DIT PAS « VIDÉE ». Ce qui reste est ce que le stockage refuse de
        // détruire : ces octets pèsent encore, et ces documents existent encore.
        error(
          t('teamVaults.settings.danger.trash.partial', {
            purged: verdict.purged,
            remaining: verdict.remaining,
          })
        );
      } else {
        success(t('teamVaults.settings.danger.trash.done', { count: verdict.purged }));
      }
    } catch (e) {
      /**
       * CE QUI EST PARTI EST PARTI, ET IL FAUT LE DIRE MÊME QUAND ÇA CASSE.
       *
       * Une passe peut échouer APRÈS que d'autres ont détruit : un 429 au
       * troisième tour, une conservation légale posée en cours de route (le
       * serveur rend alors 409 en ayant déjà détruit ce qu'il a détruit), une
       * coupure réseau. Ne montrer que le refus laisserait croire que rien n'a
       * bougé — sur un geste sans retour, c'est le pire des malentendus : on
       * cherche ensuite des éléments qui n'existent plus.
       *
       * ET LE COMPTE PEUT ÊTRE DANS LE REFUS LUI-MÊME. La route relit la
       * conservation légale DANS sa boucle : un hold posé pendant la PREMIÈRE
       * passe rend 409 après avoir détruit jusqu'à quarante-neuf éléments, si
       * bien que `purgeTotal` vaut encore zéro ici. Sans
       * `VaultTrashPartialError`, l'écran affichait alors le seul refus —
       * exactement le « rien n'a bougé » que ce commentaire déclare
       * intolérable. On l'additionne AVANT de choisir la phrase.
       */
      if (e instanceof VaultTrashPartialError) purgeTotal += e.purged;
      const refus = t(vaultErrorKey(errorText(e), 'teamVaults.errors.trashEmptyFailed'));
      error(
        purgeTotal > 0
          ? t('teamVaults.settings.danger.trash.stoppedAfter', {
              count: purgeTotal,
              reason: refus,
            })
          : refus
      );
    } finally {
      if (vivantRef.current) {
        setEmptying(null);
        // Les agrégats affichés ne décrivent plus ce coffre : le compte de la
        // corbeille, ses octets, et le stockage occupé viennent de changer.
        stats.invalidate();
        void relireCorbeille();
      }
    }
  }, [vaultId, trash.count, error, success, t, stats, relireCorbeille]);

  /**
   * Renouveler la clé SANS retirer personne (F10) : la même rotation que le
   * retrait, avec zéro cible. `removeUserIds: []` est ce qui la distingue d'un
   * retrait qui aurait perdu sa cible — le thunk refuse le second et accepte la
   * première (voir son en-tête).
   */
  const doRotate = async () => {
    setConfirmRotate(false);
    setBusy(true);
    try {
      await dispatch(rotateVaultKey({ vaultId, removeUserIds: [] })).unwrap();
      success(t('teamVaults.settings.danger.rotate.done'));
      // L'effectif n'a pas bougé, mais les ÉPOQUES si : la couverture, les
      // invitations à réémettre et les agrégats partagés datent d'avant.
      await mgmt.reload();
      mgmt.afterRosterChange();
    } catch (e) {
      const msg = errorText(e);
      /**
       * TROIS REFUS QUI NE SONT PAS DES PANNES, et qu'il ne faut surtout pas
       * réduire à « réessayez » : la rotation scelle K_vault' à chacun, donc
       * elle refait la vérification de transparence de l'invitation. Une clé
       * qui a changé ARRÊTE le geste, et la reprise passe par la cérémonie
       * d'empreinte de l'onglet Membres — pas par un second clic ici, qui ne
       * ferait qu'échouer à l'identique.
       */
      const changed = /^peer_key_changed:([^:]+)/.exec(msg);
      const noKey = /^member_no_key:(.+)$/.exec(msg);
      error(
        changed
          ? t('teamVaults.settings.danger.rotate.keyChanged', { who: mgmt.display(changed[1]) })
          : noKey
            ? t('teamVaults.errors.noKey')
            : /tampered_log|served_not_latest/.test(msg)
              ? t('teamVaults.errors.keySubstituted')
              : t(vaultErrorKey(msg, 'teamVaults.settings.danger.rotate.failed'))
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * GELER / DÉGELER (F23) — UN SEUL GESTE, DEUX SENS.
   *
   * ON ÉCRIT DANS L'ÉTAT CE QUE LA ROUTE A RELU, jamais ce qu'on espérait. Les
   * deux routes sont idempotentes et rendent l'état de la BASE : geler un coffre
   * déjà gelé rend la date du premier gel (celle que tous les membres verront),
   * et une course perdue — coffre révoqué entre le contrôle de rôle et l'UPDATE
   * — rend `null`. Poser « gelé maintenant » côté client afficherait une date
   * que personne n'a écrite, et un « dégelé » sur un coffre qui ne l'est pas.
   *
   * ON NE RECHARGE PAS TOUTE LA LISTE : le résumé Redux est ce dont dépendent
   * les boutons de l'explorateur, et le mettre à jour tout de suite évite la
   * fenêtre où l'écran propose encore « Envoyer » sur un coffre fermé. La page,
   * elle, relit son effectif comme après tout geste (`afterRosterChange` réveille
   * aussi les agrégats et le fil, où la ligne `vault.freeze` vient d'apparaître).
   */
  const doFreeze = async (freeze: boolean) => {
    setConfirmFreeze(null);
    setBusy(true);
    try {
      const etat = freeze ? await apiFreezeVault(vaultId) : await apiUnfreezeVault(vaultId);
      dispatch(vaultFreezeState({ vaultId, ...etat }));
      success(
        t(
          freeze
            ? 'teamVaults.settings.danger.freeze.frozenToast'
            : 'teamVaults.settings.danger.freeze.unfrozenToast'
        )
      );
      await mgmt.reload();
      mgmt.afterRosterChange();
    } catch (e) {
      error(
        t(
          vaultErrorKey(
            errorText(e),
            freeze
              ? 'teamVaults.settings.danger.freeze.failed'
              : 'teamVaults.settings.danger.freeze.unfreezeFailed'
          )
        )
      );
    } finally {
      if (vivantRef.current) setBusy(false);
    }
  };

  const doLeave = async () => {
    setConfirmLeave(false);
    setBusy(true);
    // L'accueil AVANT le thunk : voir l'en-tête. Rien n'est perdu si le départ
    // échoue — le coffre est resté dans l'état, il est toujours dans le rail,
    // et le message d'erreur dit pourquoi.
    navigate('/');
    try {
      await dispatch(leaveVault({ vaultId })).unwrap();
      success(t('teamVaults.members.left'));
      mgmt.afterRosterChange();
    } catch (e) {
      // `last_owner` est le seul refus que cet écran puisse recevoir, et il dit
      // quoi faire : le remplacer par « Impossible de quitter » ferait passer
      // une consigne pour une panne, sur le seul geste où l'on a une sortie.
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.leave')));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    navigate('/');
    try {
      await dispatch(deleteVault({ vaultId })).unwrap();
      success(t('teamVaults.members.deleted'));
      mgmt.afterRosterChange();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.deleteVault')));
    } finally {
      setBusy(false);
    }
  };

  /**
   * LA CONSERVATION LÉGALE SE DIT AVANT LE CLIC (F19). `delete` et `purge`
   * répondent `legal_hold_active` depuis E9-6, mais RIEN ne l'annonçait :
   * l'écran proposait les gestes, on les tentait, et on découvrait au dernier
   * moment qu'ils étaient impossibles. Le bouton est grisé et le POURQUOI est
   * écrit — un bouton grisé sans explication ne vaut pas mieux qu'un refus.
   *
   * QUITTER N'EST JAMAIS FERMÉ. Une conservation légale porte sur le CONTENU du
   * coffre, pas sur les personnes : elle ne doit pas retenir quelqu'un dedans.
   * C'est aussi la seule sortie d'un lecteur.
   */
  const held = guard === 'legalHold';

  /**
   * LE GEL (F23) — la date en toutes lettres, et le nom quand on le connaît.
   *
   * `frozenBy` est un identifiant OPAQUE : `mgmt.display` le résout par le
   * trombinoscope, et retombe sur les huit premiers caractères quand il ne le
   * trouve pas (membre déjà sorti du coffre, lecture d'effectif tombée). On
   * n'affiche PAS ce repli — « gelé par a1b2c3d4 » ne renseigne personne — et la
   * phrase sans nom prend le relais. Même règle pour la date : `parseInstant`
   * rend `null` sur ce qu'il ne sait pas lire, et « Invalid Date » n'apparaît
   * jamais à côté d'un nom.
   */
  const frozen = frozenAt !== null;
  const frozenMs = parseInstant(frozenAt);
  const frozenDate = frozenMs === null ? null : new Date(frozenMs).toLocaleDateString();
  const frozenWho = frozenBy ? mgmt.display(frozenBy) : '';
  const frozenNamed = !!frozenWho && frozenWho !== frozenBy && !frozenBy?.startsWith(frozenWho);

  return (
    <div className="space-y-4">
      {held && (
        <InfoCallout tone="danger">
          <p className="text-sm font-medium m-0">{t('teamVaults.settings.legalHold.badge')}</p>
          <p className="text-xs m-0 mt-1">{t('teamVaults.settings.legalHold.dangerHint')}</p>
        </InfoCallout>
      )}

      {/* Transmettre la propriété : le geste que le produit prescrivait sans
          l'offrir (« quitter » est refusé au dernier propriétaire avec
          « transmettez la propriété à quelqu'un »). Il se fait depuis la ligne
          de la personne — l'onglet Membres — parce qu'il faut d'abord choisir
          QUI ; ici on ne fait que dire où il vit. */}
      {myRole === 'owner' && (
        <DangerZone
          title={t('teamVaults.members.transferTitle')}
          hint={t('teamVaults.settings.danger.transferHint')}
        >
          <p className="ent-hint m-0">{t('teamVaults.settings.danger.transferWhere')}</p>
        </DangerZone>
      )}

      {/* Le renouvellement volontaire : offert à qui administre le coffre, comme
          le retrait dont il est le cas général. Il ne détruit rien — d'où sa
          place en TÊTE de la pile, avant les gestes sans retour. */}
      {mgmt.canManage && (
        <DangerZone
          title={t('teamVaults.settings.danger.rotate.title')}
          hint={t('teamVaults.settings.danger.rotate.hint')}
        >
          <Button variant="danger" size="sm" onClick={() => setConfirmRotate(true)} disabled={busy}>
            {t('teamVaults.settings.danger.rotate.action')}
          </Button>
        </DangerZone>
      )}

      {/* GELER LE COFFRE (F23) — ADMIN+, comme la route.
          Sa place dans cette pile est réfléchie : il vient APRÈS le
          renouvellement de clé (qui ne détruit rien non plus) et AVANT tout ce
          qui détruit, parce qu'il est le seul geste de cette page qui se DÉFAIT
          entièrement d'un clic. Il est ici, dans « Danger », et pas dans
          « Réglages », parce qu'il change ce que tous les membres peuvent faire
          — un réglage se corrige, un gel se subit jusqu'à ce que quelqu'un le
          lève. */}
      {mgmt.canManage && (
        <DangerZone
          title={t('teamVaults.settings.danger.freeze.title')}
          hint={t('teamVaults.settings.danger.freeze.hint')}
        >
          {/* L'ÉTAT AVANT LE BOUTON. Un interrupteur seul ne dit ni depuis
              quand, ni par qui — or c'est exactement ce qu'on vient chercher
              quand on découvre un coffre en lecture seule. */}
          <p className="ent-hint m-0 mb-2">
            {!frozen
              ? t('teamVaults.settings.danger.freeze.notFrozen')
              : frozenNamed && frozenDate
                ? t('teamVaults.settings.danger.freeze.frozenSinceBy', {
                    who: frozenWho,
                    date: frozenDate,
                  })
                : frozenDate
                  ? t('teamVaults.settings.danger.freeze.frozenSince', { date: frozenDate })
                  : // Ni nom ni date lisibles : le FAIT reste vrai et se dit.
                    t('teamVaults.settings.frozen.hint')}
          </p>

          {/* DEUX BOUTONS PLUTÔT QU'UN INTERRUPTEUR, et c'est le seul endroit de
              la page où la question se pose. Un `Toggle` bascule à la seconde du
              clic ; ici chaque sens ouvre une confirmation qui explique ce que le
              geste arrête et ce qu'il n'arrête pas. Un interrupteur qui ne bascule
              qu'après une fenêtre de dialogue est un bouton déguisé — et, le
              temps de la requête, il montrerait un état que la base n'a pas
              encore. Le libellé, lui, dit le geste, jamais l'état.

              LA VARIANTE SUIT LE SENS : geler retire des possibilités (danger),
              dégeler les rend (secondaire). Peindre « Dégeler » en rouge
              suggérerait qu'on s'apprête à casser quelque chose. */}
          <Button
            variant={frozen ? 'secondary' : 'danger'}
            size="sm"
            disabled={busy}
            onClick={() => setConfirmFreeze(frozen ? 'unfreeze' : 'freeze')}
          >
            {t(
              frozen
                ? 'teamVaults.settings.danger.freeze.unfreezeAction'
                : 'teamVaults.settings.danger.freeze.action'
            )}
          </Button>
        </DangerZone>
      )}

      {/* LA CORBEILLE DU COFFRE (F20). Propriétaire seulement, comme la route :
          tant qu'aucune re-authentification n'est appliquée côté serveur, la
          fenêtre de récupération est la seule protection contre un compte
          administrateur compromis — ce qui détruit sans retour reste donc à qui
          paie le stockage. */}
      {canEmptyTrash && (
        <DangerZone
          title={t('teamVaults.settings.danger.trash.title')}
          hint={t('teamVaults.settings.danger.trash.hint')}
        >
          {/* LE RÉSUMÉ DIT CE QU'IL SAIT, ET SEULEMENT CELA. Un compte JAMAIS lu
              (429, panne) ne devient pas « 0 élément » : ce serait annoncer une
              corbeille vide à qui s'apprête justement à la vider.

              ET « EN COURS DE LECTURE » N'EST PAS « LECTURE ÉCHOUÉE ». Les
              agrégats partent au montage de la PAGE : à l'ouverture de cet
              onglet, `stats.stats` est nul le temps d'un aller-retour, et la
              carte affichait alors un reproche d'échec à chaque ouverture. Un
              rectangle gris dit la même chose sans accuser personne. */}
          {stats.loading && !stats.stats ? (
            <div className="mb-1" role="status" aria-label={t('common.loading')}>
              <Skeleton height="0.875rem" width="60%" />
            </div>
          ) : (
            <p className="ent-hint m-0 mb-1">
              {trash.count === null
                ? t('teamVaults.settings.danger.trash.unknown')
                : trash.empty
                  ? t('teamVaults.settings.danger.trash.emptyState')
                  : t('teamVaults.settings.danger.trash.summary', {
                      count: trash.count,
                      size: formatBytes(trash.bytes ?? 0),
                    })}
            </p>
          )}

          {/* LA CONSERVATION SUIT LA MÊME RÈGLE QUE LE COMPTE (voir
              `retentionRead`) : sur une lecture de réglages tombée, on ne
              recopie pas le défaut de trente jours et l'on ne date rien. Le
              bouton de relecture est celui de `SettingsTab`, parce que c'est le
              même incident et le même geste pour en sortir. */}
          {trash.retentionDays === null ? (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="ent-hint m-0">
                {t('teamVaults.settings.danger.trash.retentionUnknown')}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void mgmt.settings.reload()}
                disabled={mgmt.settings.state === 'loading'}
              >
                {t('teamVaults.retry')}
              </Button>
            </div>
          ) : (
            <p className="ent-hint m-0 mb-2">
              {t('teamVaults.settings.danger.trash.retention', { count: trash.retentionDays })}
              {trash.nextPurge && (
                <>
                  {' '}
                  {trash.nextPurge.due
                    ? t('teamVaults.settings.danger.trash.nextPurgeDue')
                    : t('teamVaults.settings.danger.trash.nextPurge', {
                        date: new Date(trash.nextPurge.at).toLocaleDateString(),
                      })}
                </>
              )}
            </p>
          )}

          {/* UNE PROGRESSION, PAS UNE ROUE. Le vidage se fait par passes de
              cinquante : sans barre, une grosse corbeille donnait une attente
              muette de plusieurs minutes qu'on ne pouvait pas distinguer d'un
              blocage. */}
          {emptying && (
            <div className="mb-2">
              <ProgressBar
                /* SANS DÉNOMINATEUR, PAS DE POURCENTAGE. Quand les agrégats
                   n'ont pas été lus et qu'aucune passe n'est encore revenue, il
                   n'y a rien à diviser : `emptyTrashProgressPct({0,0})` vaut 100
                   par construction, et la première image d'une destruction sans
                   retour aurait été une barre PLEINE. Le mode indéterminé dit la
                   seule chose vraie à cet instant — ça travaille. */
                indeterminate={emptying.remaining === null}
                value={
                  emptying.remaining === null
                    ? 0
                    : emptyTrashProgressPct({
                        purgedTotal: emptying.purged,
                        remaining: emptying.remaining,
                      })
                }
                size="sm"
                variant="warning"
                label={
                  emptying.remaining === null
                    ? t('teamVaults.settings.danger.trash.workingUnknown', {
                        purged: emptying.purged,
                      })
                    : t('teamVaults.settings.danger.trash.working', {
                        purged: emptying.purged,
                        total: emptying.purged + emptying.remaining,
                      })
                }
                showValue
              />
            </div>
          )}

          {held && (
            <p className="ent-hint m-0 mb-2">{t('teamVaults.settings.danger.trash.legalHold')}</p>
          )}

          <Button
            variant="danger"
            size="sm"
            loading={!!emptying?.running}
            /* La corbeille VIDE éteint le bouton ; une corbeille dont on ne sait
               RIEN le laisse allumé — retirer un geste sur une ignorance est le
               défaut que l'on répare, pas celui qu'on introduit. */
            disabled={busy || !!emptying || held || trash.empty}
            title={held ? t('teamVaults.settings.legalHold.hint') : undefined}
            onClick={() => setConfirmEmpty(true)}
          >
            {t('teamVaults.settings.danger.trash.action')}
          </Button>
        </DangerZone>
      )}

      <DangerZone
        title={t('teamVaults.members.leaveTitle')}
        hint={t('teamVaults.members.leaveConfirm')}
      >
        <Button variant="danger" size="sm" onClick={() => setConfirmLeave(true)} disabled={busy}>
          {t('teamVaults.members.leave')}
        </Button>
      </DangerZone>

      {/* Le propriétaire, et lui seul, peut faire disparaître l'objet. Un
          administrateur gère les membres et les contenus ; il ne décide pas de
          l'existence. */}
      {myRole === 'owner' && (
        <DangerZone
          title={t('teamVaults.members.deleteTitle')}
          hint={
            held
              ? t('teamVaults.settings.legalHold.deleteHint')
              : t('teamVaults.members.deleteHint')
          }
        >
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmDelete(true)}
            disabled={busy || held}
            title={held ? t('teamVaults.settings.legalHold.hint') : undefined}
          >
            {t('teamVaults.members.deleteVault')}
          </Button>
        </DangerZone>
      )}

      {/* LA CONFIRMATION EST HONNÊTE, ET C'EST TOUT SON INTÉRÊT : elle dit ce
          que le geste protège (les éléments futurs) ET ce qu'il ne protège pas
          (l'existant, les wraps historiques), plus son effet de bord sur les
          invitations en attente. */}
      <ConfirmModal
        isOpen={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={() => void doRotate()}
        title={t('teamVaults.settings.danger.rotate.title')}
        message={t('teamVaults.settings.danger.rotate.confirm')}
        confirmText={t('teamVaults.settings.danger.rotate.action')}
        variant="warning"
      />

      {/* LA CONFIRMATION DU GEL DIT LES DEUX MOITIÉS, et c'est tout son objet :
          ce que le gel arrête (les écritures de CONTENU) ET ce qu'il n'arrête
          pas (retirer, révoquer, renouveler la clé, quitter, dégeler). Sans la
          seconde moitié, « geler » se lit comme « verrouiller pour toujours », et
          personne n'ose — ou pire : quelqu'un croit s'être rendu inexpugnable.
          `variant="warning"` et non `danger` : rien n'est détruit, et le geste
          se défait d'un clic. */}
      <ConfirmModal
        isOpen={confirmFreeze !== null}
        onClose={() => setConfirmFreeze(null)}
        onConfirm={() => void doFreeze(confirmFreeze === 'freeze')}
        title={t(
          confirmFreeze === 'unfreeze'
            ? 'teamVaults.settings.danger.freeze.unfreezeConfirmTitle'
            : 'teamVaults.settings.danger.freeze.confirmTitle'
        )}
        message={t(
          confirmFreeze === 'unfreeze'
            ? 'teamVaults.settings.danger.freeze.unfreezeConfirm'
            : 'teamVaults.settings.danger.freeze.confirm'
        )}
        confirmText={t(
          confirmFreeze === 'unfreeze'
            ? 'teamVaults.settings.danger.freeze.unfreezeAction'
            : 'teamVaults.settings.danger.freeze.action'
        )}
        variant="warning"
      />

      <ConfirmModal
        isOpen={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void doLeave()}
        title={t('teamVaults.members.leaveTitle')}
        message={t('teamVaults.members.leaveConfirm')}
        confirmText={t('teamVaults.members.leave')}
        variant="danger"
      />

      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
        title={t('teamVaults.members.deleteTitle')}
        message={t('teamVaults.members.deleteConfirm')}
        confirmText={t('teamVaults.members.deleteVault')}
        variant="danger"
      />

      {/* UNE SAISIE, PAS UN CLIC (F20). « Supprimer le coffre », juste au-dessus,
          reste réversible trente jours ; ceci ne l'est pas une seconde. Le dépôt
          n'avait aucun patron « tapez le mot » — d'où `PromptModal`, qui est le
          composant du système de design le plus proche, avec le mot vérifié par
          le modèle (`matchesConfirmWord` : raboté, insensible à la casse, et un
          mot attendu VIDE n'arme jamais rien). */}
      <PromptModal
        isOpen={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        onSubmit={(saisi) => {
          setConfirmEmpty(false);
          if (!matchesConfirmWord(saisi, t('teamVaults.settings.danger.trash.confirmWord'))) {
            // ON LE DIT. Fermer la fenêtre sans un mot laisserait croire que le
            // vidage est parti — et, quelques secondes plus tard, qu'il a échoué
            // en silence.
            error(t('teamVaults.settings.danger.trash.wrongWord'));
            return;
          }
          void doEmptyTrash();
        }}
        title={t('teamVaults.settings.danger.trash.confirmTitle')}
        label={t('teamVaults.settings.danger.trash.confirmBody', {
          word: t('teamVaults.settings.danger.trash.confirmWord'),
        })}
        placeholder={t('teamVaults.settings.danger.trash.confirmLabel', {
          word: t('teamVaults.settings.danger.trash.confirmWord'),
        })}
        submitText={t('teamVaults.settings.danger.trash.action')}
      />
    </div>
  );
};

export default DangerTab;
