/**
 * InviteTimeline (F22) — la frise d'une ligne d'invitation, rendue.
 *
 * TOUTE LA DÉCISION EST DANS `inviteTimelineModel` : qui a relancé, combien de
 * fois, quel est le sort et à quel instant. Ce composant ne fait que traduire et
 * peindre — c'est ce qui permet d'éprouver la règle sans DOM, et d'éviter qu'une
 * seconde dérivation (« expirée ou pas ? ») ne contredise la section qui contient
 * la ligne.
 *
 * TROIS CRANS, ET PAS DE « VUE ». L'infobulle de la frise le DIT à qui se
 * demanderait pourquoi : suivre l'ouverture d'un e-mail demanderait un pixel de
 * suivi, qui se trompe plus souvent qu'il ne dit vrai (images bloquées, proxys
 * qui préchargent) et qui surveillerait la boîte de quelqu'un d'autre. Une frise
 * honnête à trois crans vaut mieux qu'une frise à quatre dont un est faux.
 *
 * UNE LISTE ORDONNÉE, PAS UNE RANGÉE DE `<span>`. À la lecture d'écran, ces
 * crans sont une suite d'étapes numérotées ; `<ol>` le dit sans un mot de plus,
 * et l'`aria-label` nomme la personne concernée — ces frises sont empilées, et
 * « Envoyée, Relancée 2 fois, En attente » répété six fois ne dit pas de QUI.
 *
 * ET LE POURQUOI NE TIENT PAS DANS UN `title`. L'explication du cran absent —
 * la décision la plus intéressante de cette frise — n'est accessible qu'au
 * survol : pas au clavier, et PERDUE à la lecture d'écran, où l'`aria-label`
 * l'emporte comme nom accessible et fait disparaître l'attribut `title`. Elle
 * est donc aussi écrite EN TÊTE DE SECTION, une fois (`InvitationsTab`), et pas
 * accrochée à chaque frise par un `aria-describedby` : six invitations en
 * attente, c'était six fois le même paragraphe de deux lignes à la lecture
 * d'écran. La phrase vaut pour la section entière — elle n'appartient à aucune
 * ligne en particulier.
 *
 * LES MOTS EUX-MÊMES VIENNENT DU MODÈLE (`stepLabel`) : le passage auteur → clé
 * est le seul endroit où « Filarr a relancé » peut se mettre à mentir, et il
 * n'était éprouvable ici que par un rendu.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultInviteDTO } from '../../../../services/vault/vaultApi';
import { inviteTimeline, stepLabel, timelineSteps } from './inviteTimelineModel';

interface Props {
  invite: VaultInviteDTO;
  /** L'instant de référence, décidé UNE fois par la page (voir `groups`). */
  nowMs: number;
  /** L'adresse concernée — elle ne sert qu'au libellé d'accessibilité. */
  email: string;
}

/** La couleur d'un cran franchi : le sort décide, les deux premiers sont neutres. */
function dotStyle(kind: string, done: boolean): React.CSSProperties {
  if (!done) {
    // À VENIR : un cercle CREUX. Un point plein gris se lirait « franchi mais
    // sans importance », alors que la question posée est justement ouverte.
    return {
      background: 'transparent',
      boxShadow: 'inset 0 0 0 1.5px var(--color-text-tertiary)',
    };
  }
  if (kind === 'accepted') return { background: 'var(--color-success-600)' };
  if (kind === 'expired') return { background: 'var(--color-warning-600)' };
  // Refusée, révoquée : des fins nettes, mais pas des alarmes. Le neutre dit
  // « c'est réglé », ce qui est exactement le cas.
  if (kind === 'declined' || kind === 'revoked')
    return { background: 'var(--color-text-tertiary)' };
  return { background: 'var(--color-primary-500)' };
}

export const InviteTimeline: React.FC<Props> = ({ invite, nowMs, email }) => {
  const { t } = useTranslation();
  const steps = timelineSteps(inviteTimeline(invite, nowMs));

  return (
    <ol
      className="list-none flex flex-wrap items-center gap-x-3 gap-y-1 m-0 mt-1 p-0"
      aria-label={t('teamVaults.invites.timeline.label', { email })}
      title={t('teamVaults.invites.timeline.why')}
    >
      {steps.map((step, i) => {
        const { key, params } = stepLabel(step);
        const kind = step.id === 'outcome' ? step.outcome : step.id;

        return (
          <li key={step.id} className="flex items-center gap-1.5 text-[11px]">
            {/* Le chevron n'est PAS dans le premier cran : une frise qui commence
                par une flèche se lit comme si une étape manquait avant. */}
            {i > 0 && <span className="text-[var(--color-text-tertiary)]">→</span>}
            <span
              aria-hidden="true"
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={dotStyle(kind, step.state === 'done')}
            />
            <span
              className={
                step.state === 'done'
                  ? 'text-[var(--color-text-secondary)]'
                  : 'text-[var(--color-text-tertiary)]'
              }
            >
              {params ? t(key, params) : t(key)}
            </span>
            {/* UNE DATE, OU RIEN. `parseInstant` rend `null` sur ce qu'il ne sait
                pas lire ; « Invalid Date » à côté d'une adresse ressemble à une
                donnée corrompue. */}
            {step.atMs !== null && (
              <span className="text-[var(--color-text-tertiary)]">
                {new Date(step.atMs).toLocaleDateString()}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

export default InviteTimeline;
