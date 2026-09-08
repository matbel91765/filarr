/**
 * VaultAccessNotices — ce qui est PROMIS mais pas encore arrivé, des deux côtés.
 *
 * POURQUOI CET ÉCRAN EXISTE. « Aucun coffre partagé pour l'instant » était
 * rigoureusement identique pour deux personnes dans des situations opposées :
 * celle que personne n'a jamais invitée, et celle qui a rejoint l'espace de son
 * hôte et attend qu'il lui scelle une clé. La seconde n'avait aucun moyen de
 * savoir qu'elle attendait — alors elle recollait son lien d'espace, déjà
 * consommé, et lisait « invitation déjà utilisée », qui est vrai et ne répond à
 * rien. Trois écrans qui disent quelque chose de faux sur une situation
 * parfaitement normale.
 *
 * DEUX PUBLICS, UN SEUL COMPOSANT, ET C'EST VOULU : ce sont les deux moitiés du
 * MÊME fait. `awaitingHost` est ce que l'INVITÉE attend ; `blockedGrants` est ce
 * que le balayage de l'HÔTE n'a pas pu accorder tout seul. Un même compte peut
 * porter les deux — on est souvent l'hôte de quelqu'un et l'invité d'un autre.
 *
 * AUCUN BOUTON D'ACCEPTATION CÔTÉ INVITÉE, et c'est le point : il n'y a rien à
 * accepter. Lui en offrir un rejouerait la confusion qu'on ferme.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button } from '../ui';
import type { RootState } from '../../../store';
import type { BlockedEntry } from '../../../services/vault/pendingGrantSweep';

interface Props {
  /**
   * OUVRIR LA FICHE DE LA PERSONNE, pas l'explorateur du coffre (F04).
   *
   * « Ouvrir le coffre » menait à la grille de fichiers : un écran qui ne parle
   * pas du sujet, et où rien ne rappelait pourquoi on y était venu. Le lien
   * profond vise maintenant `?view=settings&tab=invitations&focus=<userId>`,
   * c'est-à-dire l'endroit exact où le geste attend.
   */
  onOpenAccess?: (vaultId: string, focus: string) => void;
}

/**
 * La phrase d'un blocage. Chaque motif appelle un geste DIFFÉRENT, et les
 * confondre sous « impossible de donner l'accès » redonnerait à l'hôte le doute
 * qu'on cherche à lever : `key_unverified` réclame une comparaison hors bande,
 * `no_key` ne réclame rien du tout, `seal_failed` se retentera seul.
 */
function blockedKey(reason: BlockedEntry['reason']): string {
  switch (reason) {
    case 'key_unverified':
      return 'teamVaults.access.blockedKeyUnverified';
    case 'no_key':
      return 'teamVaults.access.blockedNoKey';
    default:
      return 'teamVaults.access.blockedSealFailed';
  }
}

export const VaultAccessNotices: React.FC<Props> = ({ onOpenAccess }) => {
  const { t } = useTranslation();
  const awaiting = useSelector((s: RootState) => s.vaults.awaitingHost);
  const blocked = useSelector((s: RootState) => s.vaults.blockedGrants);

  if (awaiting.length === 0 && blocked.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {awaiting.length > 0 && (
        <section aria-labelledby="vault-awaiting-title">
          <p
            id="vault-awaiting-title"
            className="text-sm font-medium text-[var(--color-text-primary)] m-0 mb-1"
          >
            {t('teamVaults.access.awaitingTitle')}
          </p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1">
            {awaiting.map((a) => (
              <li
                key={`${a.orgId}:${a.since}`}
                className="text-xs text-[var(--color-text-secondary)]"
              >
                {a.orgName
                  ? t('teamVaults.access.awaitingLine', { space: a.orgName })
                  : t('teamVaults.access.awaitingLineUnknownSpace')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {blocked.length > 0 && (
        <section aria-labelledby="vault-blocked-title">
          <p
            id="vault-blocked-title"
            className="text-sm font-medium text-[var(--color-text-primary)] m-0 mb-1"
          >
            {t('teamVaults.access.blockedTitle')}
          </p>
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {blocked.map((b) => (
              <li
                key={`${b.vaultId}:${b.email}`}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-xs text-[var(--color-text-secondary)]">
                  {t(blockedKey(b.reason), { email: b.email })}
                </span>
                {/* Seule une clé à vérifier appelle un geste ici — les deux
                    autres motifs se règlent d'eux-mêmes. Le lien mène à la
                    FICHE de la personne (« Où en est l'accès de X ? »), qui
                    porte la cérémonie et les autres issues ; l'explorateur du
                    coffre, lui, ne parlait pas du sujet. */}
                {b.reason === 'key_unverified' && onOpenAccess && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenAccess(b.vaultId, b.userId || b.email)}
                  >
                    {t('teamVaults.access.reviewAccess')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default VaultAccessNotices;
