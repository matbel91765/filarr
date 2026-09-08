/**
 * InvitationsTab — les invitations de ce coffre : celles qui sont dehors, celles
 * qui se préparent, et le sort de celles qui sont retombées.
 *
 * POURQUOI LES MONTRER. Une invitation porte K_vault DÉJÀ scellée pour son
 * destinataire : c'est un porteur valide sept jours, qu'on ne pouvait ni voir
 * ni reprendre. Elle explique aussi le refus `already_invited`, qui sans cette
 * liste ressemble à un défaut plutôt qu'à un fait. Et l'accusé (14 jours) est
 * la SEULE réponse que l'hôte reçoit : par décision produit, un refus n'envoie
 * pas d'e-mail.
 *
 * QUATRE SECTIONS, ET DEUX SONT NÉES D'UN MENSONGE (F03/F04) :
 *
 *  · « Accès en préparation » — « dans mon espace mais pas dans le coffre »
 *    n'était un état visible NULLE PART. La pastille « 1 accès en attente de
 *    votre vérification » ne disait ni qui, ni ce qui manquait, ni quoi faire.
 *    Elle couvre aussi, depuis le défaut du 30/08, LE CRAN D'AVANT : une
 *    personne invitée qui n'a pas encore répondu. Celle-là n'avait de ligne
 *    nulle part — rien n'est scellé avant son arrivée dans l'espace (modèle
 *    0073, et il est juste), et les intentions mûres l'écartent à raison — si
 *    bien que l'onglet disait « aucune invitation » à un hôte qui venait d'en
 *    envoyer une.
 *
 *  · « Échues (30 derniers jours) » — `listVaultInvites` filtre
 *    `expires_at > now` : une invitation expirée et une personne jamais invitée
 *    rendaient EXACTEMENT le même écran vide. C'est cette indiscernabilité qui
 *    a fait conclure à un accès perdu là où il n'y avait qu'un lien à réémettre.
 *
 * ET UNE LIGNE EN ATTENTE PEUT MENTIR AUSSI. Quand son scellé date d'une époque
 * révolue, « Relancer » ne peut QUE se faire refuser (`invite_stale_epoch`) :
 * l'époque d'un coffre ne fait que monter, celle du scellé est figée à
 * l'émission, et une fois séparées elles ne se rejoignent jamais. Le bouton dit
 * alors « Réémettre », et prend le chemin de l'ajout direct.
 *
 * QUATRE SECTIONS VIDES NE FONT PAS QUATRE MESSAGES (F05). Quand il n'y a rien
 * du tout — ni en attente, ni en préparation, ni récente, ni échue — l'onglet
 * répétait quatre fois « aucune » sous quatre titres, ce qui donne à un coffre
 * neuf l'aspect d'un écran cassé. Un seul état vide prend leur place, il dit la
 * règle qui explique les quatre sections (sept jours de validité, trente jours
 * de mémoire) et il mène à la ligne d'invitation. Et une panne de lecture n'y
 * ressemble JAMAIS : elle rend son message et son bouton Réessayer.
 *
 * LE RÔLE D'UNE LIGNE EN ATTENTE SE CORRIGE SUR PLACE (F18). Il fallait
 * jusqu'ici révoquer puis réinviter : deux e-mails, un lien mort chez la
 * personne, un scellé neuf — pour changer un mot. Or le rôle n'est PAS scellé :
 * il est écrit en clair dans la ligne, et c'est l'acceptation qui le recopie
 * dans l'adhésion. Un menu suffit, et le lien déjà reçu reste valide.
 *
 * TOUTES LES DÉCISIONS SONT DANS LES MODÈLES PURS (`inviteLifecycleModel`,
 * `accessJourneyModel`, `vaultSettingsEmptyStates`) : ce fichier ne fait que
 * rendre et appeler.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, EmptyState } from '../../ui';
import { useNotification } from '../../ui/Notification';
import { AdminSection, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import { vaultErrorKey, errorText } from '../../../../services/vault/vaultErrorMessages';
import { apiCancelPendingGrant, apiRevokeVaultInvite } from '../../../../services/vault/vaultApi';
import type { AppDispatch, RootState } from '../../../../store';
import { selectVaultById, sweepPendingGrants } from '../../../../store/slices/vaultsSlice';
import { selectSharedVaultOrgId } from '../../../../store/selectors/authSelectors';
import { KeyVerificationPanel } from '../KeyVerification';
import {
  InviteLinkPanel,
  InviteLinkRecoveryButton,
  InviteRoleSelect,
} from './PendingInviteControls';
import { usePendingInviteActions } from './usePendingInviteActions';
import { VAULT_ROLE_TONE } from './vaultRoleTone';
import { type VaultInviteRole } from './vaultSettingsModel';
import type { VaultManagement } from './useVaultManagement';
import type { InviteGroups, InviteRowBase, ReissuePlan } from './inviteLifecycleModel';
import { findAccessJourney, pendingAccessJourneys, type AccessJourney } from './accessJourneyModel';
import { intentSeatable } from './pendingSeatsModel';
import { useVaultReinvite, type ReinviteTarget, type VaultReinvite } from './useVaultReinvite';
import { InviteTimeline } from './InviteTimeline';
import { extendsUntilMs } from './inviteTimelineModel';
import { AccessJourneyPanel } from './AccessJourneyPanel';
import type { VaultSettingsEmptyStates } from './vaultSettingsEmptyStates';

interface Props {
  vaultId: string;
  mgmt: VaultManagement;
  /** Les trois listes d'invitations, déjà classées (`inviteLifecycleModel`). */
  groups: InviteGroups;
  /** Les accès en préparation, déjà situés (`accessJourneyModel`). */
  journeys: AccessJourney[];
  /** Les verdicts « contenu / vide / erreur », décidés une fois par la page. */
  states: VaultSettingsEmptyStates;
  /** Emmener vers la ligne d'invitation (onglet Membres), focus posé. */
  onGoToInviteRow: () => void;
  /** La personne à mettre en évidence (`?focus=<userId|email>`), s'il y en a une. */
  focus?: string;
}

const MailIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

/**
 * L'enveloppe de l'état vide — DIMENSIONNÉE, contrairement à `MailIcon` dont la
 * taille vient de la CSS de l'en-tête d'`AdminSection`. Un SVG sans
 * `width`/`height` posé nu occupe la taille par défaut d'un élément remplacé.
 */
const EnvelopeGlyph = () => (
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
    <path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

/**
 * Une date en toutes lettres, ou RIEN. `parseInstant` rend `null` sur ce qu'il
 * n'a pas su lire, et ce null s'arrête ici : `new Date(NaN)` affichait « Invalid
 * Date » à côté d'une adresse, ce qui ressemble à une donnée corrompue.
 */
const DateText: React.FC<{ ms: number | null }> = ({ ms }) =>
  ms === null ? null : (
    <span className="ml-2 text-xs text-[var(--color-text-tertiary)]">
      {new Date(ms).toLocaleDateString()}
    </span>
  );

/**
 * POURQUOI LA FRISE N'A PAS DE CRAN « VUE » — dit UNE FOIS PAR SECTION.
 *
 * La phrase vivait sur chaque frise, en `sr-only` désigné par un
 * `aria-describedby`. À la lecture d'écran, six invitations en attente, c'était
 * six fois le même paragraphe de deux lignes. Or la décision ne concerne aucune
 * ligne en particulier : elle vaut pour la section entière, et c'est là qu'elle
 * appartient. Chaque frise garde son `aria-label` nominatif (« Progression de
 * l'invitation à … »), qui lui, dit de QUI on parle.
 *
 * `sr-only` et non caché : un élément masqué n'est pas lu du tout. Les yeux et
 * la souris, eux, ont déjà l'infobulle de la frise.
 */
const TimelineWhy: React.FC = () => {
  const { t } = useTranslation();
  return <p className="sr-only">{t('teamVaults.invites.timeline.why')}</p>;
};

/**
 * Le bouton de rattrapage d'une ligne — MÊME geste, deux voies annoncées.
 *
 * DÉFINI AU NIVEAU DU MODULE, et ce n'est pas de la coquetterie : un composant
 * déclaré dans le corps du rendu change d'identité à chaque rendu, donc React le
 * démonte et le remonte. La cérémonie ci-dessous porte une case à cocher — la
 * cocher provoque un rendu, qui la remonterait, et le focus clavier partirait au
 * moment précis où l'on demande à quelqu'un de confirmer une empreinte.
 */
const ReissueButton: React.FC<{
  row: InviteRowBase;
  label: string;
  reinvite: VaultReinvite;
  locked: boolean;
}> = ({ row, label, reinvite, locked }) => {
  const { t } = useTranslation();
  const plan: ReissuePlan = row.action;
  const target: ReinviteTarget = {
    email: row.email,
    userId: plan.userId,
    role: row.role,
    kind: plan.kind,
  };
  const mine = reinvite.busyEmail === row.email;
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={mine}
      // L'annuaire n'a pas pu être lu : on ne route pas à l'aveugle. Le
      // pourquoi est dit une fois, sous la section.
      disabled={plan.kind === 'unknown' || (locked && !mine)}
      title={plan.kind === 'unknown' ? t('teamVaults.members.directoryUnavailable') : undefined}
      onClick={() => void reinvite.start(target)}
    >
      {plan.kind === 'reinviteToSpace' ? t('teamVaults.invites.reinviteToSpace') : label}
    </Button>
  );
};

/** La cérémonie du numéro de sécurité, dépliée SOUS la ligne concernée. */
const Ceremony: React.FC<{ email: string; reinvite: VaultReinvite }> = ({ email, reinvite }) => {
  const { t } = useTranslation();
  if (reinvite.ceremonyFor?.email !== email) return null;
  const working = reinvite.busyEmail === email;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <KeyVerificationPanel verification={reinvite.kv} />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={working}
          disabled={!reinvite.kv.canProceed || working}
          onClick={() => void reinvite.confirm()}
        >
          {t('teamVaults.invites.confirmAndReinvite')}
        </Button>
        <Button variant="ghost" size="sm" disabled={working} onClick={reinvite.cancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
};

export const InvitationsTab: React.FC<Props> = ({
  vaultId,
  mgmt,
  groups,
  journeys,
  states,
  onGoToInviteRow,
  focus,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  /** Relance partie — l'accusé local du bouton, le temps du montage. */
  const [resentIds, setResentIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  /** La fiche ouverte, s'il y en a une. */
  const [openJourney, setOpenJourney] = useState<string | null>(null);

  /**
   * L'espace DU COFFRE, pas le mien : un administrateur de coffre peut être
   * l'invité de l'espace de quelqu'un d'autre, et c'est LÀ qu'un ancien invité
   * doit rentrer. Viser le mien l'inviterait au mauvais endroit.
   */
  const vaultOrgId = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.organizationId ?? null
  );
  const mySpaceOrgId = useSelector(selectSharedVaultOrgId);
  const orgId = vaultOrgId ?? mySpaceOrgId;

  /**
   * Relire la page ET réveiller les agrégats partagés, après TOUT geste qui
   * touche à l'effectif. Mémoïsé sur les deux rappels du chargeur (eux-mêmes
   * stables) : une fonction recréée à chaque rendu ferait changer d'identité
   * toutes les fonctions du hook de ré-invitation, à chaque frappe.
   */
  const { reload, afterRosterChange } = mgmt;
  const afterChange = useCallback(async () => {
    await reload();
    afterRosterChange();
  }, [reload, afterRosterChange]);

  const reinvite = useVaultReinvite(vaultId, { orgId, onDone: afterChange });

  /**
   * `?focus=` OUVRE LA FICHE, quand il désigne quelqu'un qui en a une. C'est le
   * lien profond du bandeau d'accueil : « X attend votre vérification » y menait
   * jusqu'ici à l'explorateur du coffre, c'est-à-dire à un écran qui ne parle
   * pas du sujet. Ne le fait qu'une fois par valeur de `focus` : refermer la
   * fenêtre ne doit pas la rouvrir au rendu suivant.
   */
  const [autoOpened, setAutoOpened] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || autoOpened === focus) return;
    const target = findAccessJourney(journeys, focus);
    if (target) {
      setOpenJourney(target.email);
      setAutoOpened(focus);
    }
  }, [focus, journeys, autoOpened]);

  /**
   * LES DEUX GESTES D'UNE INVITATION EN ATTENTE, partagés avec l'onglet Membres.
   *
   * ILS ONT QUITTÉ CE FICHIER, ET C'EST LE POINT. La liste des membres montre
   * désormais les invitées (c'est là qu'on vient corriger un rôle) : deux
   * implémentations du même appel, c'est deux messages d'erreur, deux
   * invalidations et deux idées de ce que « l'ancien lien meurt » veut dire.
   * Le rôle ne touche à aucune clé ; la régénération tue le porteur précédent.
   */
  const inviteActions = usePendingInviteActions(vaultId, {
    onDone: afterChange,
    lang: i18n.language,
  });

  /**
   * « Relancer / Prolonger » : le MÊME appel que « Retrouver le lien », nommé
   * autrement parce que ce qu'on vient chercher n'est pas la même chose — ici
   * l'e-mail qui repart et la date qui recule, là l'URL qui réapparaît. L'accusé
   * nomme donc le geste demandé, et les deux disent que l'ancien lien est mort.
   */
  const resend = async (inviteId: string, email: string) => {
    await inviteActions.regenerate(inviteId, email, 'teamVaults.members.pendingResentToast');
    setResentIds((ids) => new Set(ids).add(inviteId));
  };

  const revoke = async (inviteId: string) => {
    setBusy(true);
    try {
      await apiRevokeVaultInvite(vaultId, inviteId);
      success(t('teamVaults.members.pendingRevoked'));
      await afterChange();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.inviteRevokeFailed')));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Éteindre une promesse. L'invitation d'ESPACE, elle, n'est pas touchée.
   *
   * TOUTES LES PROMESSES DE CETTE PERSONNE, PAS SEULEMENT LA PREMIÈRE.
   * « Renvoyer l'invitation d'espace » poste une invitation NEUVE (le serveur ne
   * sait pas relancer une invitation d'espace) : deux porteurs vivants pour une
   * seule promesse. N'en annuler qu'un laisserait la ligne revenir à la lecture
   * suivante, et l'hôte croirait son geste sans effet.
   *
   * UN SEUL SUCCÈS SUFFIT À DIRE QUE C'EST FAIT. Le 404 `intent_not_found` est
   * UNIFORME : « inconnue », « déjà honorée » et « déjà annulée » répondent la
   * même chose, et une intention déjà close n'est pas un échec du geste. On ne
   * signale donc l'erreur que si AUCUNE n'a pu être éteinte.
   */
  const cancelIntent = async (journey: AccessJourney) => {
    const cibles = journey.intentInviteIds.length
      ? journey.intentInviteIds
      : journey.inviteId
        ? [journey.inviteId]
        : [];
    if (!cibles.length) return;
    setBusy(true);
    try {
      const sorts = await Promise.allSettled(
        cibles.map((id) => apiCancelPendingGrant(vaultId, id))
      );
      const tenue = sorts.find((s) => s.status === 'rejected');
      if (tenue && !sorts.some((s) => s.status === 'fulfilled')) {
        throw (tenue as PromiseRejectedResult).reason;
      }
      // UNE PLACE A-T-ELLE ÉTÉ RENDUE ? C'est le seul détail que l'hôte attend :
      // « elle reste dans votre espace partagé » serait faux dès qu'une
      // invitation vient d'être révoquée, et c'est précisément la phrase qui
      // aurait empêché de comprendre le siège perdu du 30/08.
      const placeRendue = sorts.some(
        (s) => s.status === 'fulfilled' && s.value?.spaceInviteRevoked === true
      );
      success(
        t(
          placeRendue
            ? 'teamVaults.access.journey.intentCanceledSeatFreed'
            : 'teamVaults.access.journey.intentCanceled',
          { email: journey.email }
        )
      );
      setOpenJourney(null);
      await afterChange();
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.generic')));
    } finally {
      setBusy(false);
    }
  };

  /**
   * « Réessayer maintenant » — le balayage, POUR CE COFFRE. Il ne tourne
   * normalement qu'au changement de la liste des coffres déverrouillés : sans ce
   * point d'entrée, un scellement retombé sur une panne attendait le prochain
   * déverrouillage. La garde anti-concurrence vit dans le thunk (`condition`),
   * donc deux clics ne peuvent pas se croiser.
   */
  const retryNow = async () => {
    setBusy(true);
    try {
      await dispatch(sweepPendingGrants({ vaultIds: [vaultId] }));
      await afterChange();
    } finally {
      setBusy(false);
    }
  };

  const locked = busy || inviteActions.busy || reinvite.locked;
  const waiting = pendingAccessJourneys(journeys);

  /**
   * L'INSTANT DE RÉFÉRENCE DES FRISES (F22) — CELUI DU REGROUPEMENT, EMPRUNTÉ.
   *
   * Surtout pas une horloge lue ici. `groups` est calculé dans un `useMemo` de
   * la page : il est figé au dernier changement des listes, alors que ce corps
   * de rendu, lui, repasse sans arrêt (sondage du fil d'activité,
   * rafraîchissement des statistiques, bascules de `busy`, chaque frappe dans
   * la ligne d'invitation). Une invitation qui franchissait son échéance entre
   * les deux se lisait alors DEUX FOIS SUR LA MÊME LIGNE : rangée dans « En
   * attente », pastille orange « Expire bientôt » et bouton « Prolonger de N
   * jours » — et « Expirée » dans la frise imprimée juste dessous. `isLapsed`
   * est pourtant la même règle des deux côtés : c'est l'INSTANT qui différait,
   * et une même règle nourrie de deux instants rend deux verdicts.
   *
   * PAS D'HORLOGE BATTANTE non plus : faire vibrer la page à la seconde pour
   * une information qui vaut à la minute près coûterait un rendu permanent. Les
   * sections et leurs frises se rafraîchissent ENSEMBLE, au prochain passage du
   * regroupement.
   */
  const nowMs = groups.nowMs;

  /**
   * CE QUE « PROLONGER » PEUT PROMETTRE (F21). La relance ne repousse pas
   * l'échéance de sept jours : le worker réécrit `expires_at = maintenant +
   * inviteTtlDays`, la durée RÉGLÉE de ce coffre. Quand les réglages n'ont pas
   * pu être lus, `useVaultSettings` retombe volontairement sur le défaut (sept
   * jours) et le SIGNALE par son `state` : on prend `null` plutôt que ce défaut,
   * et le bouton dit alors « Prolonger » sans chiffre. Promettre « 7 jours » sur
   * un coffre réglé à deux serait un mensonge sur le bouton même dont l'objet
   * est de dire ce qu'il fait.
   */
  const ttlDays = mgmt.settings.state === 'ok' ? mgmt.settings.settings.inviteTtlDays : null;
  /**
   * LA SEULE HORLOGE FRAÎCHE DE CET ÉCRAN, et elle doit l'être : cette date-là
   * n'est pas un verdict sur le passé, c'est la promesse de ce que le worker
   * ÉCRIRA au clic (`expires_at = maintenant + inviteTtlDays`). La dater du
   * regroupement annoncerait une échéance en retard de tout le temps passé sur
   * la page — sur le bouton même dont l'objet est de dire ce qu'il fait.
   */
  const extendUntil = extendsUntilMs(Date.now(), ttlDays);

  const highlighted = (row: { email: string; invite: { id: string } }) =>
    !!focus && (focus === row.email || focus === row.invite.id);

  /**
   * LE REFUS DE LECTURE PASSE AVANT TOUT, et il ne descend pas dans les
   * sections : quatre « aucune invitation » bâtis sur une route qui a échoué
   * sont quatre mensonges, et c'est exactement la confusion qui a fait conclure
   * à un accès perdu là où il n'y avait qu'un lien à réémettre.
   */
  if (states.invitations.kind === 'error') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-[var(--color-text-primary)] m-0">
          {t(states.invitations.key ?? 'teamVaults.errors.membersLoad')}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void mgmt.reload()}
          disabled={mgmt.loading}
        >
          {t('teamVaults.retry')}
        </Button>
      </div>
    );
  }

  /** Rien nulle part : UNE phrase qui explique les quatre sections, et le geste. */
  if (states.invitations.kind === 'empty') {
    return (
      <EmptyState
        icon={<EnvelopeGlyph />}
        title={t(`${states.invitations.key}.title`)}
        description={t(`${states.invitations.key}.body`)}
        action={
          states.invitations.action === 'goToInviteRow'
            ? { label: t(`${states.invitations.key}.action`), onClick: onGoToInviteRow }
            : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ── EN ATTENTE ─────────────────────────────────────────────────────── */}
      <AdminSection
        title={t('teamVaults.members.pendingTitle')}
        description={t('teamVaults.members.pendingHint')}
        icon={<MailIcon />}
      >
        {groups.pending.length > 0 && <TimelineWhy />}
        {groups.pending.length === 0 ? (
          <p className="ent-hint m-0">{t('teamVaults.settings.invitations.nonePending')}</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {groups.pending.map((row) => (
              <li
                key={row.invite.id}
                className={`rounded-md ${
                  highlighted(row) ? 'ring-1 ring-[var(--color-primary-500)] px-2 py-1' : ''
                }`}
              >
                <div className="ent-stack flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-text-secondary)] truncate">
                    {row.email}
                    {/* « À RÉÉMETTRE » : le scellé est d'une époque révolue, et
                        aucune relance ne peut plus l'ouvrir. */}
                    {row.staleEpoch && (
                      <span className="ml-2">
                        <StatusBadge tone="warning" title={t('teamVaults.invites.staleEpochHint')}>
                          {t('teamVaults.invites.staleEpochBadge')}
                          {/* L'INFOBULLE NE SE LIT QU'À LA SOURIS : ni au
                              clavier, ni à l'écran vocal. La phrase qui explique
                              la pastille est donc aussi posée en `sr-only` —
                              invisible, hors flux (position absolue : la
                              `gap` de la pastille ne la compte pas), et lue. */}
                          <span className="sr-only">
                            {' — '}
                            {t('teamVaults.invites.staleEpochHint')}
                          </span>
                        </StatusBadge>
                      </span>
                    )}
                    {/* « EXPIRE BIENTÔT » (F21) — une PASTILLE, pas seulement une
                        date en orange. La couleur seule ne se voit pas dans une
                        pile de six lignes, ne se lit pas à l'écran vocal, et ne
                        dit pas ce qu'elle veut dire. L'infobulle explique les
                        deux issues : le rappel automatique si le réglage est
                        actif, ou prolonger tout de suite. */}
                    {row.urgent && (
                      <span className="ml-2">
                        <StatusBadge tone="warning" title={t('teamVaults.invites.expiringHint')}>
                          {t('teamVaults.invites.expiringBadge')}
                          {/* Même raison que ci-dessus : « Expire bientôt » sans
                              son explication ne dit pas les deux issues (le
                              rappel automatique, ou prolonger tout de suite). */}
                          <span className="sr-only">
                            {' — '}
                            {t('teamVaults.invites.expiringHint')}
                          </span>
                        </StatusBadge>
                      </span>
                    )}
                    {/* La date de péremption existait dans le DTO et n'était
                        affichée nulle part : l'hôte ne pouvait pas distinguer
                        une invitation fraîche d'une qui meurt ce soir. */}
                    <span
                      className={`ml-2 text-xs ${
                        row.urgent
                          ? 'text-[var(--color-warning-700,#b45309)]'
                          : 'text-[var(--color-text-tertiary)]'
                      }`}
                    >
                      {t('teamVaults.members.pendingExpires', {
                        date: row.atMs === null ? '—' : new Date(row.atMs).toLocaleDateString(),
                      })}
                    </span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* LE RÔLE SE CORRIGE ICI (F18), sans révoquer ni renvoyer.
                        Un menu plutôt qu'une pastille : ce champ-là est la seule
                        chose d'une invitation en attente qui se change sans rien
                        casser, et l'ancien parcours (révoquer + réinviter) tuait
                        le lien déjà reçu pour changer un mot.

                        L'INTITULÉ NOMME LA PERSONNE : ces menus sont empilés, et
                        le seul mot « Rôle » répété N fois ne dit pas à une
                        lecture d'écran de QUI on change le rôle — l'adresse est
                        la seule chose qui les distingue. */}
                    <InviteRoleSelect
                      inviteId={row.invite.id}
                      email={row.email}
                      role={row.invite.role as VaultInviteRole}
                      disabled={locked}
                      onChange={(id, role) => void inviteActions.changeRole(id, role)}
                    />
                    {row.staleEpoch ? (
                      // Le MÊME chemin que « Réinviter » : l'ajout direct scelle
                      // sous l'époque courante, et le serveur reprend lui-même
                      // l'invitation périmée de cette adresse.
                      <ReissueButton
                        row={row}
                        label={t('teamVaults.invites.reissue')}
                        reinvite={reinvite}
                        locked={locked}
                      />
                    ) : resentIds.has(row.invite.id) ? (
                      /* RELANCER : porteur neuf, même scellé — l'ancien lien
                         meurt à l'instant. Un accusé local remplace le bouton :
                         relancer deux fois de suite n'envoie que du bruit.

                         L'ACCUSÉ N'EST PLUS UN CUL-DE-SAC. Il remplaçait le seul
                         bouton de la ligne : qui avait relancé une fois, puis
                         rangé le lien, n'avait plus AUCUN geste pour le
                         retrouver — le défaut rapporté à l'essai. Le geste de
                         récupération, lui, reste offert en dessous. */
                      <span className="text-xs text-[var(--color-success-600)]">
                        {t('teamVaults.members.pendingResent')}
                      </span>
                    ) : (
                      /* LE MÊME GESTE, DEUX LIBELLÉS (F21). Sur une ligne qui
                         meurt sous 48 h, « Relancer » ne dit pas la chose utile :
                         ce qu'on vient chercher, c'est du TEMPS. Le bouton nomme
                         donc l'effet — « Prolonger de N jours » — avec la durée
                         RÉGLÉE du coffre, et sans chiffre du tout quand les
                         réglages n'ont pas pu être lus (le défaut de sept jours
                         serait plausible et faux sur un coffre réglé à deux).
                         L'appel, lui, est strictement identique : porteur neuf,
                         même scellé, l'ancien lien meurt à l'instant. */
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={locked}
                        title={
                          row.urgent
                            ? extendUntil === null
                              ? t('teamVaults.invites.extendTitleUnknown')
                              : t('teamVaults.invites.extendTitle', {
                                  date: new Date(extendUntil).toLocaleDateString(),
                                })
                            : undefined
                        }
                        onClick={() => void resend(row.invite.id, row.email)}
                      >
                        {!row.urgent
                          ? t('teamVaults.members.pendingResend')
                          : ttlDays === null
                            ? t('teamVaults.invites.extendUnknown')
                            : t('teamVaults.invites.extend', { count: ttlDays })}
                      </Button>
                    )}
                    {/* RETROUVER LE LIEN — le défaut rapporté à l'essai : « on ne
                        peut pas récupérer le lien ni le QR une fois qu'ils ont
                        disparu ». On ne peut pas les RÉAFFICHER (le serveur n'en
                        garde que le condensat) ; on peut en fabriquer un neuf, et
                        la confirmation dit que l'ancien meurt. Offert quel que
                        soit l'état du bouton voisin, y compris après une relance
                        déjà faite. */}
                    <InviteLinkRecoveryButton
                      inviteId={row.invite.id}
                      email={row.email}
                      staleEpoch={row.staleEpoch}
                      disabled={locked}
                      actions={inviteActions}
                    />
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={locked}
                      onClick={() => void revoke(row.invite.id)}
                    >
                      {t('teamVaults.members.pendingRevoke', 'Revoke')}
                    </Button>
                  </div>
                </div>
                {/* F22 — LA FRISE, SOUS LA LIGNE. Elle répond à la question que
                    l'hôte se posait sans pouvoir y répondre : « ai-je déjà
                    relancé cette personne ? ». Sans elle, la seule façon de
                    savoir était de relancer encore — c'est-à-dire de tuer un
                    lien encore valide pour en envoyer un identique. */}
                <InviteTimeline invite={row.invite} nowMs={nowMs} email={row.email} />

                {/* F16 — L'AUTRE CHEMIN, juste sous la ligne qu'on vient de
                    relancer. Relancer une invitation dont l'e-mail n'arrive pas
                    refait exactement le même trajet : sans ce bloc, l'hôte n'a
                    aucun moyen de transmettre l'accès autrement. Le panneau est
                    celui de l'onglet Membres — un seul affichage du lien, une
                    seule hygiène de presse-papiers. */}
                <InviteLinkPanel inviteId={row.invite.id} actions={inviteActions} />
                <Ceremony email={row.email} reinvite={reinvite} />
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {/* ── ACCÈS EN PRÉPARATION ─────────────────────────────────────────────
          Seulement ceux qui attendent ENCORE quelque chose : un blocage laissé
          par un balayage précédent survit à sa propre cause (la personne a pu
          devenir membre entre-temps), et une liste « en préparation » qui
          contient des gens déjà entrés se lit comme une panne. Leur fiche reste
          ouvrable par lien profond — elle montre alors cinq crans franchis. */}
      {waiting.length > 0 && (
        <AdminSection
          title={t('teamVaults.access.journey.sectionTitle')}
          description={t('teamVaults.access.journey.sectionHint')}
          icon={<ClockIcon />}
        >
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {waiting.map((j) => {
              const envoyee = j.steps.find((s) => s.id === 'spaceInvited')?.atMs ?? null;
              return (
                <li key={j.email} className="ent-stack flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-text-secondary)] truncate">
                    {j.email}
                    {/* LE RÔLE PROMIS, sur les lignes où il a été choisi
                        explicitement par l'hôte. Sur une fiche née d'un blocage,
                        personne ne l'a dit et le modèle retombe sur « lecteur » :
                        l'afficher là serait présenter un défaut comme une
                        décision.

                        LA PASTILLE NE RESTE QUE LÀ OÙ LE RANG NE SE CORRIGE PAS.
                        Dès qu'il se corrige, c'est le MENU qui le montre, dans le
                        groupe d'actions à droite — deux affichages du même rang
                        sur une seule ligne, dont un mort, se lisent comme deux
                        rangs. `intentSeatable` tranche, et c'est la MÊME règle que
                        la section « en attente » de l'onglet Membres : une ligne
                        est corrigible des deux côtés, ou d'aucun. */}
                    {j.awaitingSpaceReply && !intentSeatable(j) && (
                      <span className="ml-2">
                        <StatusBadge tone={VAULT_ROLE_TONE[j.role] ?? 'neutral'}>
                          {t(`teamVaults.role.${j.role}`, j.role)}
                        </StatusBadge>
                      </span>
                    )}
                    <span className="block text-xs text-[var(--color-text-tertiary)]">
                      {/* La raison LISIBLE : c'est elle qui explique l'attente, et
                          elle diffère à chaque cran. « Pas encore répondu » et
                          « n'est plus dans l'espace » échouent au MÊME cran et
                          appellent des mots opposés. */}
                      {/* UNE INVITATION D'ESPACE ORPHELINE N'ATTEND PAS UNE
                          RÉPONSE : la promesse d'accès a été retirée, donc même
                          si la personne répond, rien n'arrivera au bout de ce
                          coffre. Ce qui reste vrai, et qu'il faut dire, c'est
                          qu'elle occupe une place et que son lien fonctionne. */}
                      {t(
                        j.intentCanceled
                          ? 'teamVaults.access.journey.summary.spaceInviteOrphaned'
                          : j.awaitingSpaceReply
                            ? j.action === 'explainOnly'
                              ? 'teamVaults.access.journey.summary.awaitingSpaceReplyExplainOnly'
                              : 'teamVaults.access.journey.summary.awaitingSpaceReply'
                            : `teamVaults.access.journey.summary.${j.action}`
                      )}
                    </span>
                    {/* QUAND, ET JUSQU'À QUAND. Sans ces deux dates, une
                        invitation partie il y a une heure et une qui meurt ce
                        soir se ressemblent — et c'est justement le choix entre
                        attendre et relancer. Chacune s'efface seule si le serveur
                        n'a pas rendu une date lisible (`Invalid Date` à côté d'une
                        adresse se lit comme une donnée corrompue). */}
                    {j.awaitingSpaceReply &&
                      (envoyee !== null || j.spaceInviteExpiresAtMs !== null) && (
                        <span className="block text-xs text-[var(--color-text-tertiary)]">
                          {envoyee !== null &&
                            t('teamVaults.access.journey.spaceInviteSent', {
                              date: new Date(envoyee).toLocaleDateString(),
                            })}
                          {envoyee !== null && j.spaceInviteExpiresAtMs !== null && ' · '}
                          {j.spaceInviteExpiresAtMs !== null &&
                            t('teamVaults.access.journey.spaceInviteExpires', {
                              date: new Date(j.spaceInviteExpiresAtMs).toLocaleDateString(),
                            })}
                        </span>
                      )}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* LE RANG PROMIS SE CORRIGE ICI AUSSI, ET PAR LE MÊME
                        CROCHET QUE L'ONGLET MEMBRES.

                        C'était une pastille MORTE : un rang donné par erreur
                        n'avait pour recours que d'annuler l'accès promis puis de
                        réinviter — donc un lien d'espace mort chez la personne, et
                        sept jours qui repartent, pour changer un mot. Rien n'est
                        scellé à ce stade (c'est la définition d'une intention) :
                        le corriger est un simple UPDATE, et l'invitation d'espace
                        déjà reçue mènera au bon rang.

                        IL EST DANS LE GROUPE D'ACTIONS, pas dans le bloc de texte
                        à gauche : celui-ci porte `truncate`, et un contrôle posé
                        dans un conteneur qui coupe se fait couper.

                        `changeIntentRole` ET PAS `changeRole` : l'identifiant est
                        une ligne `org_invitations`, pas une invitation de coffre.
                        Les deux sont des UUID, et les intervertir rendrait un 404
                        que l'hôte lirait comme la disparition de la personne
                        qu'il vient d'inviter. */}
                    {intentSeatable(j) && (
                      <InviteRoleSelect
                        inviteId={j.inviteId as string}
                        email={j.email}
                        role={j.role}
                        disabled={locked}
                        onChange={(id, role) => void inviteActions.changeIntentRole(id, role)}
                      />
                    )}
                    {/* LES DEUX GESTES, SUR LA LIGNE. Ouvrir la fiche pour les
                        atteindre serait un clic de plus pour les deux seules
                        choses qu'on puisse faire ici. « Renvoyer » n'apparaît
                        qu'à qui peut le faire — un administrateur de COFFRE reçu
                        dans l'espace d'autrui y est org 'viewer' — et la phrase
                        au-dessus dit alors à qui s'adresser, plutôt qu'un bouton
                        qui se refermerait au clic. */}
                    {/* PAS DE « RENVOYER » SUR UNE PROMESSE RETIRÉE : renvoyer
                        ferait partir un SECOND porteur, donc une seconde place
                        prise, pour un accès que l'hôte a justement annulé. */}
                    {j.awaitingSpaceReply &&
                      !j.intentCanceled &&
                      j.action === 'resendSpaceInvite' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={reinvite.busyEmail === j.email}
                          disabled={locked && reinvite.busyEmail !== j.email}
                          onClick={() =>
                            void reinvite.start({
                              email: j.email,
                              userId: j.userId,
                              role: j.role,
                              kind: 'reinviteToSpace',
                            })
                          }
                        >
                          {t('teamVaults.access.journey.action.resendSpaceInviteUnanswered')}
                        </Button>
                      )}
                    {/* LA SEULE PORTE. Aucun écran de Filarr ne révoque une
                        invitation d'espace : la console d'organisation est
                        fermée (`ENTERPRISE_ACCESSIBLE === false`) et le client
                        n'appelle nulle part la route de révocation. Ce bouton-ci
                        est donc, pour un espace personnel, le seul moyen de
                        rendre une place — d'où son maintien même quand la
                        promesse a déjà été retirée, où il ne reste plus que
                        l'invitation à reprendre. */}
                    {j.awaitingSpaceReply && j.canCancelIntent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={locked}
                        title={t(
                          j.intentCanceled
                            ? 'teamVaults.access.journey.action.revokeSpaceInviteHint'
                            : 'teamVaults.access.journey.action.cancelIntentHintPending'
                        )}
                        onClick={() => void cancelIntent(j)}
                      >
                        {t(
                          j.intentCanceled
                            ? 'teamVaults.access.journey.action.revokeSpaceInvite'
                            : 'teamVaults.access.journey.action.cancelIntent'
                        )}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => setOpenJourney(j.email)}
                    >
                      {t('teamVaults.access.journey.open')}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminSection>
      )}

      {/* ── RÉCENTES (14 JOURS) ────────────────────────────────────────────── */}
      <AdminSection
        title={t('teamVaults.members.settledTitle')}
        description={t('teamVaults.members.settledHint')}
      >
        {groups.settled.length > 0 && <TimelineWhy />}
        {groups.settled.length === 0 ? (
          <p className="ent-hint m-0">{t('teamVaults.settings.invitations.noneSettled')}</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {groups.settled.map((row) => (
              <li key={row.invite.id} className="text-sm">
                <div className="ent-stack flex items-center justify-between gap-3">
                  <span className="text-[var(--color-text-secondary)] truncate">
                    {row.email}
                    <DateText ms={row.atMs} />
                  </span>
                  <span
                    className={`text-xs font-medium shrink-0 ${
                      row.status === 'accepted'
                        ? 'text-[var(--color-success-600)]'
                        : 'text-[var(--color-text-tertiary)]'
                    }`}
                  >
                    {row.status === 'accepted'
                      ? t('teamVaults.members.settledAccepted')
                      : t('teamVaults.members.settledDeclined')}
                  </span>
                </div>
                {/* LA FRISE VAUT AUSSI POUR UNE LIGNE RÉGLÉE : « acceptée
                    après deux relances » dit ce qu'il aura fallu, et c'est la
                    seule trace qu'on en garde.
                    CE QU'ELLE NE PEUT PAS TOUJOURS DIRE, en revanche : si le
                    rappel automatique a servi. Le worker remet `reminded_at` à
                    NULL à CHAQUE relance manuelle (`resendVaultInvite`, db.ts).
                    Dans l'ordre cron-PUIS-hôte, le rappel est donc EFFACÉ et la
                    frise dira « Relancée N fois », attribuée à l'hôte seul ;
                    « + rappel de Filarr » ne survit que dans l'ordre inverse,
                    hôte-PUIS-cron, où les deux marques coexistent. La frise est
                    fidèle à ce que la ligne SE RAPPELLE, pas à tout ce qui s'est
                    passé. */}
                <InviteTimeline invite={row.invite} nowMs={nowMs} email={row.email} />
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      {/* ── ÉCHUES (30 JOURS) ──────────────────────────────────────────────── */}
      <AdminSection
        title={t('teamVaults.invites.lapsedTitle')}
        description={t('teamVaults.invites.lapsedHint')}
      >
        {groups.lapsed.length > 0 && <TimelineWhy />}
        {groups.lapsed.length === 0 ? (
          <p className="ent-hint m-0">{t('teamVaults.invites.noneLapsed')}</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {groups.lapsed.map((row) => (
              <li
                key={row.invite.id}
                className={`rounded-md ${
                  highlighted(row) ? 'ring-1 ring-[var(--color-primary-500)] px-2 py-1' : ''
                }`}
              >
                <div className="ent-stack flex items-center justify-between gap-3">
                  <span className="text-sm text-[var(--color-text-secondary)] truncate">
                    {row.email}
                    {/* Expirée et révoquée n'appellent pas la même lecture :
                        l'une est un délai passé, l'autre une décision. */}
                    <span className="ml-2">
                      <StatusBadge tone={row.cause === 'revoked' ? 'neutral' : 'warning'}>
                        {t(`teamVaults.invites.cause.${row.cause}`)}
                      </StatusBadge>
                    </span>
                    <span className="ml-2">
                      <StatusBadge tone={VAULT_ROLE_TONE[row.invite.role] ?? 'neutral'}>
                        {t(`teamVaults.role.${row.invite.role}`, row.invite.role)}
                      </StatusBadge>
                    </span>
                    <DateText ms={row.atMs} />
                  </span>
                  <div className="shrink-0">
                    <ReissueButton
                      row={row}
                      label={t('teamVaults.invites.reinvite')}
                      reinvite={reinvite}
                      locked={locked}
                    />
                  </div>
                </div>
                {/* Sur une ligne ÉCHUE, la frise dit ce qui a été tenté avant
                    d'abandonner : deux relances sans réponse et une révocation
                    n'appellent pas la même conduite qu'une expiration silencieuse
                    sur laquelle personne n'est jamais revenu. */}
                <InviteTimeline invite={row.invite} nowMs={nowMs} email={row.email} />
                <Ceremony email={row.email} reinvite={reinvite} />
              </li>
            ))}
          </ul>
        )}
        {/* Dit UNE fois, sous la section qui en dépend : sans annuaire, on ne
            sait pas si la personne est encore dans l'espace, donc on ne sait pas
            laquelle des deux ré-invitations proposer. */}
        {mgmt.directory.state !== 'ok' && groups.lapsed.length > 0 && (
          <p className="ent-hint m-0 mt-2">
            {t(
              mgmt.directory.state === 'forbidden'
                ? 'teamVaults.members.directoryForbidden'
                : 'teamVaults.members.directoryUnavailable'
            )}
          </p>
        )}
      </AdminSection>

      <AccessJourneyPanel
        journey={journeys.find((j) => j.email === openJourney) ?? null}
        reinvite={reinvite}
        onCancelIntent={cancelIntent}
        onRetryNow={retryNow}
        busy={busy}
        onClose={() => setOpenJourney(null)}
      />
    </div>
  );
};

export default InvitationsTab;
