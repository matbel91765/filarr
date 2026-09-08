/**
 * AccessJourneyPanel — « OÙ EN EST L'ACCÈS DE X ? » (F04).
 *
 * CE QU'IL REMPLACE. Une pastille : « 1 accès en attente de votre
 * vérification ». Rien sur qui, rien sur ce qui manque, rien à faire. Cinq
 * choses peuvent manquer et elles appellent cinq gestes différents — dont trois
 * consistent à ne rien faire, ce qui n'est une réponse acceptable que si on le
 * DIT.
 *
 * LA LISTE EST UNE CHECKLIST, PAS UN JOURNAL. Chaque cran porte son état, et le
 * premier qui n'est pas franchi porte l'action — et lui seul. Proposer de
 * comparer une empreinte à quelqu'un qui n'a pas encore ouvert l'application
 * envoie chercher un problème qui n'existe pas ; c'est ainsi qu'on apprend à se
 * méfier d'un écran.
 *
 * `unknown` N'EST PAS UN ÉTAT DÉCORATIF : quand l'annuaire n'a pas pu être lu,
 * le cran le dit et AUCUN bouton ne s'appuie dessus. Le modèle
 * (`accessJourneyModel`) en décide ; ce composant ne fait que rendre.
 *
 * LA CÉRÉMONIE VIT DANS LE FLUX. « Vérifier sa clé maintenant » ne rouvre pas
 * une modale par-dessus la modale : le numéro de sécurité se déplie sous les
 * boutons, et le bouton principal devient « Confirmer et donner l'accès ».
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ModalBody, ModalFooter, ModalHeader } from '../../ui';
import { InfoCallout, RelativeTime } from '../../settings/enterprise/AdminPrimitives';
import { KeyVerificationPanel } from '../KeyVerification';
import type { AccessJourney, AccessStepState } from './accessJourneyModel';
import type { VaultReinvite } from './useVaultReinvite';

interface Props {
  journey: AccessJourney | null;
  reinvite: VaultReinvite;
  /** Annuler l'intention 0073 — l'invitation d'espace, elle, reste. */
  onCancelIntent: (journey: AccessJourney) => void | Promise<void>;
  /** Relancer le balayage POUR CE COFFRE. */
  onRetryNow: () => void | Promise<void>;
  /** Un autre geste de la page est en cours. */
  busy: boolean;
  onClose: () => void;
}

/** La pastille d'un cran. Trois états, trois lectures — jamais deux confondus. */
const StepMark: React.FC<{ state: AccessStepState }> = ({ state }) => {
  const { t } = useTranslation();
  const label = t(`teamVaults.access.journey.state.${state}`);
  const tone =
    state === 'done'
      ? 'var(--color-success-600)'
      : state === 'pending'
        ? 'var(--color-warning-700, #b45309)'
        : 'var(--color-text-tertiary)';
  return (
    <span
      aria-label={label}
      title={label}
      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold"
      style={{ color: tone, border: `1px solid ${tone}` }}
    >
      {state === 'done' ? '✓' : state === 'pending' ? '·' : '?'}
    </span>
  );
};

export const AccessJourneyPanel: React.FC<Props> = ({
  journey,
  reinvite,
  onCancelIntent,
  onRetryNow,
  busy,
  onClose,
}) => {
  const { t } = useTranslation();
  if (!journey) return null;

  const ceremonyOpen = reinvite.ceremonyFor?.email === journey.email;
  const working = busy || reinvite.busyEmail === journey.email;
  const disabled = working || (reinvite.locked && !ceremonyOpen);

  /** Le geste du cran courant — un seul, jamais une rangée de boutons. */
  const primary = () => {
    if (ceremonyOpen) {
      return (
        <Button
          variant="primary"
          loading={working}
          disabled={!reinvite.kv.canProceed || working}
          onClick={() => void reinvite.confirm()}
        >
          {t('teamVaults.invite.confirmAndGiveAccess')}
        </Button>
      );
    }
    switch (journey.action) {
      case 'verifyKeyNow':
        return (
          <Button
            variant="primary"
            loading={working}
            disabled={disabled || !journey.userId}
            onClick={() =>
              void reinvite.start({
                email: journey.email,
                userId: journey.userId,
                role: journey.role,
                kind: 'reinvite',
              })
            }
          >
            {t('teamVaults.access.journey.action.verifyKeyNow')}
          </Button>
        );
      case 'resendSpaceInvite':
        return (
          <Button
            variant="primary"
            loading={working}
            disabled={disabled}
            onClick={() =>
              void reinvite.start({
                email: journey.email,
                userId: journey.userId,
                role: journey.role,
                kind: 'reinviteToSpace',
              })
            }
          >
            {/* DEUX SITUATIONS, MÊME GESTE, MOTS OPPOSÉS. « L'inviter à nouveau »
                suppose qu'elle est partie ; ici elle n'a simplement jamais
                répondu, et le bouton dit alors « Renvoyer l'invitation
                d'espace » — ce qui est exactement ce qu'il fait (le serveur ne
                sait pas relancer une invitation d'espace : il en poste une
                neuve, et l'intention repart avec). */}
            {t(
              journey.awaitingSpaceReply
                ? 'teamVaults.access.journey.action.resendSpaceInviteUnanswered'
                : 'teamVaults.access.journey.action.resendSpaceInvite'
            )}
          </Button>
        );
      case 'retryNow':
        return (
          <Button
            variant="primary"
            loading={working}
            disabled={disabled}
            onClick={() => void onRetryNow()}
          >
            {t('teamVaults.access.journey.action.retryNow')}
          </Button>
        );
      default:
        // `waitFirstOpen`, `explainOnly`, `none` : il n'y a rien à cliquer, et
        // fabriquer un bouton pour le cacher serait pire — la phrase du bas dit
        // ce qui se passe.
        return null;
    }
  };

  return (
    <Modal isOpen onClose={onClose} size="lg">
      <ModalHeader onClose={onClose} closeLabel={t('common.close')}>
        {t('teamVaults.access.journey.title', { email: journey.email })}
      </ModalHeader>
      <ModalBody>
        <ol className="list-none m-0 p-0 flex flex-col gap-3">
          {journey.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-3">
              <StepMark state={step.state} />
              <span className="min-w-0">
                <span
                  className="block text-sm"
                  style={{
                    color:
                      step.state === 'done'
                        ? 'var(--color-text-primary)'
                        : 'var(--color-text-secondary)',
                  }}
                >
                  {t(`teamVaults.access.journey.step.${step.id}`)}
                </span>
                <span className="block text-xs text-[var(--color-text-tertiary)]">
                  {/* « N'est plus dans l'espace » et « n'a pas encore répondu »
                      sont le MÊME cran manqué et deux situations opposées. Dire
                      la première à quelqu'un qu'on vient d'inviter enverrait
                      l'hôte chercher un problème qui n'existe pas. */}
                  {t(
                    step.id === 'inSpace' && step.state === 'pending' && journey.awaitingSpaceReply
                      ? 'teamVaults.access.journey.hint.inSpace.awaiting'
                      : `teamVaults.access.journey.hint.${step.id}.${step.state}`
                  )}
                  {step.atMs !== null && (
                    <>
                      {' · '}
                      <RelativeTime ms={step.atMs} />
                    </>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ol>

        {/* La phrase du cran courant, quand elle porte plus que la checklist :
            « on attend sa première ouverture », « demandez au propriétaire de
            l'espace ». Ce sont les cas où le bon geste est de ne rien faire, et
            où le taire donne l'impression d'un écran cassé. */}
        {(journey.action === 'waitFirstOpen' ||
          journey.action === 'explainOnly' ||
          journey.action === 'none') && (
          <div className="mt-4">
            <InfoCallout tone="info">
              <p className="text-xs m-0">{t(`teamVaults.access.journey.note.${journey.action}`)}</p>
            </InfoCallout>
          </div>
        )}

        {/* Le numéro de sécurité — SOUS la checklist, une étape du flux. */}
        {ceremonyOpen && (
          <div className="mt-4">
            <KeyVerificationPanel verification={reinvite.kv} />
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {/* ANNULER L'INTENTION est un geste à part, et il est secondaire : il
            n'ouvre rien, il éteint une promesse.
            CE QU'IL TOUCHE DÉPEND DE L'ÉTAT DE L'INVITATION D'ESPACE, et les
            trois phrases sont différentes. Sur quelqu'un DÉJÀ dans l'espace, il
            n'éteint que la promesse et la personne reste où elle est. Sur une
            invitation partie sans réponse, il révoque AUSSI le porteur : le lien
            meurt et la place est rendue — le laisser vivant était le défaut du
            30/08. Et quand la promesse est déjà retirée, il ne reste que
            l'invitation à reprendre, ce qui est ici la seule porte pour le
            faire. */}
        {journey.canCancelIntent && (
          <Button
            variant="ghost"
            disabled={disabled}
            onClick={() => void onCancelIntent(journey)}
            title={t(
              journey.intentCanceled
                ? 'teamVaults.access.journey.action.revokeSpaceInviteHint'
                : journey.awaitingSpaceReply
                  ? 'teamVaults.access.journey.action.cancelIntentHintPending'
                  : 'teamVaults.access.journey.action.cancelIntentHint'
            )}
          >
            {t(
              journey.intentCanceled
                ? 'teamVaults.access.journey.action.revokeSpaceInvite'
                : 'teamVaults.access.journey.action.cancelIntent'
            )}
          </Button>
        )}
        {ceremonyOpen ? (
          <Button variant="secondary" disabled={working} onClick={reinvite.cancel}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        )}
        {primary()}
      </ModalFooter>
    </Modal>
  );
};

export default AccessJourneyPanel;
