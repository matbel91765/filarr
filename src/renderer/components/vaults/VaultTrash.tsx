/**
 * La corbeille des coffres — le pied du rail.
 *
 * CE QUI MANQUAIT. Supprimer un coffre est réversible pendant trente jours : le
 * serveur pose `revoked_at`, l'accès tombe dans la seconde, et rien n'est
 * détruit avant la purge. La route de restauration existait, l'appel client
 * aussi — et rien ne pouvait dire À QUEL COFFRE l'adresser, puisque la liste
 * ordinaire écarte les supprimés. Deux écrans promettaient donc une récupération
 * qu'aucun chemin ne rendait possible.
 *
 * La section n'apparaît QUE si la corbeille contient quelque chose : un rail
 * chargé d'un tiroir toujours vide fatigue plus qu'il ne sert.
 *
 * ── POURQUOI « PURGER » VIT ICI, ET NULLE PART AILLEURS (F20) ────────────────
 *
 * `POST /vaults/:id/purge` exige un coffre DÉJÀ à la corbeille : sur un coffre
 * vivant elle répond 409 `vault_not_deleted`, parce que le geste reste en deux
 * temps même quand les deux se suivent d'une seconde. Or la page « Gérer le
 * coffre » ne s'ouvre JAMAIS sur un coffre révoqué — le rail l'écarte, et les
 * routes qu'elle appelle répondent toutes 404. Le seul écran d'où ce bouton peut
 * viser quelque chose est donc celui-ci : la liste des coffres supprimés.
 *
 * CE QU'IL FERME. Sans lui, quelqu'un qui vient de s'apercevoir qu'il a partagé
 * le mauvais dossier n'avait qu'une réponse : « revenez dans un mois ». Pendant
 * ce mois, les octets restent sur le serveur ET pèsent sur le quota mutualisé de
 * l'espace, donc sur ce que les autres coffres peuvent recevoir.
 *
 * DEUX ISSUES POSITIVES, ET ELLES NE SE DISENT PAS PAREIL. `purged` veut dire
 * que les octets et la ligne sont partis ; `inProgress` veut dire que la marque
 * de non-retour est posée — la restauration est déjà refusée — mais que le
 * stockage n'a pas fini et que le balayage terminera. Annoncer « c'est fait »
 * dans le second cas serait faux dans le seul sens qui compte.
 *
 * LA CONSERVATION LÉGALE NE PEUT PAS ÊTRE ANNONCÉE ICI, ET C'EST ASSUMÉ. Le
 * champ `legalHold` n'est servi que par `GET /vaults/:id` (au rang admin), route
 * qui refuse justement un coffre révoqué : cette liste ne le porte pas, et
 * aucune lecture ne peut le lui donner. On ne grise donc rien — griser sur une
 * ignorance retirerait un geste légitime — et le refus du serveur (409
 * `legal_hold_active`) s'affiche avec sa phrase, qui dit quoi faire.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, PromptModal } from '../ui';
import { useNotification } from '../ui/Notification';
import type { AppDispatch } from '../../../store';
import {
  loadDeletedVaults,
  restoreVault,
  selectDeletedVaults,
} from '../../../store/slices/vaultsSlice';
import { apiPurgeVault } from '../../../services/vault/vaultApi';
import { errorText, vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import { matchesConfirmWord } from './settings/trashModel';

/** Jours pleins restants, arrondis vers le haut — « il reste 0 jour » n'a pas de sens. */
function joursRestants(until: string | null): number | null {
  if (!until) return null;
  const ms = Date.parse(until) - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export const VaultTrash: React.FC = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const deleted = useSelector(selectDeletedVaults);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Le coffre dont on demande la destruction — l'identifiant, pas l'objet. */
  const [toPurge, setToPurge] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(loadDeletedVaults());
  }, [dispatch]);

  if (deleted.length === 0) return null;

  const restaurer = async (vaultId: string) => {
    setBusyId(vaultId);
    setFailed(false);
    const result = await dispatch(restoreVault({ vaultId }));
    setBusyId(null);
    // Un refus se dit. Le cas courant est une purge qui a déjà commencé : le
    // coffre n'est plus récupérable, et la liste rechargée le fera disparaître.
    if (restoreVault.rejected.match(result)) {
      setFailed(true);
      void dispatch(loadDeletedVaults());
    }
  };

  const purger = async (vaultId: string) => {
    setBusyId(vaultId);
    setFailed(false);
    try {
      const issue = await apiPurgeVault(vaultId);
      // « Engagée » n'est pas « terminée » : la marque de non-retour est posée,
      // les octets s'en vont encore, et le balayage finira. Le dire comme tel
      // évite de promettre une destruction qui n'est pas achevée.
      success(
        issue.purged
          ? t('teamVaults.trash.purgeVaultDone')
          : t('teamVaults.trash.purgeVaultStarted')
      );
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.purgeVaultFailed')));
    } finally {
      setBusyId(null);
      // Dans TOUS les cas : purgé, il disparaît de la liste ; engagé, il n'est
      // plus restaurable ; refusé, la liste dit encore la vérité.
      void dispatch(loadDeletedVaults());
    }
  };

  return (
    <div className="border-t border-[var(--color-border-light)] px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs text-left border-none cursor-pointer bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-secondary)]"
      >
        <span className="flex-1 truncate">
          {t('teamVaults.trash.title', { count: deleted.length })}
        </span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <ul className="list-none m-0 p-0 mt-1 space-y-1">
          {failed && (
            <li
              role="alert"
              className="px-2 py-1.5 text-xs text-[var(--color-error-700,#b91c1c)] bg-[var(--color-error-50,#fef2f2)] rounded-md"
            >
              {t('teamVaults.trash.restoreFailed')}
            </li>
          )}
          {deleted.map((v) => {
            const jours = joursRestants(v.restorableUntil);
            return (
              <li
                key={v.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--color-hover-overlay)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--color-text-secondary)] truncate">
                    {v.name || t('teamVaults.locked')}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-tertiary)]">
                    {jours === null
                      ? t('teamVaults.trash.noDeadline')
                      : t('teamVaults.trash.daysLeft', { count: jours })}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyId === v.id}
                  disabled={busyId !== null}
                  onClick={() => void restaurer(v.id)}
                >
                  {t('teamVaults.trash.restore')}
                </Button>
                {/* Propriétaire seulement côté serveur ; le rôle porté par la
                    ligne vient de la même appartenance que celle que la route
                    revérifie, donc un rang inférieur ne voit pas un bouton qui
                    ne peut que répondre 404. */}
                {v.role === 'owner' && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId !== null}
                    title={t('teamVaults.trash.purgeVaultHint')}
                    onClick={() => setToPurge(v.id)}
                  >
                    {t('teamVaults.trash.purgeVault')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* UNE SAISIE, PAS UN CLIC. Supprimer laisse trente jours ; ceci n'en laisse
          aucun, et se fait depuis un rail où le pointeur passe vite. */}
      <PromptModal
        isOpen={toPurge !== null}
        onClose={() => setToPurge(null)}
        onSubmit={(saisi) => {
          const cible = toPurge;
          setToPurge(null);
          if (!cible) return;
          if (!matchesConfirmWord(saisi, t('teamVaults.trash.purgeVaultWord'))) {
            // On le DIT : fermer sans un mot laisserait croire que la purge est
            // partie, puis qu'elle a échoué en silence.
            error(t('teamVaults.settings.danger.trash.wrongWord'));
            return;
          }
          void purger(cible);
        }}
        title={t('teamVaults.trash.purgeVaultTitle')}
        label={t('teamVaults.trash.purgeVaultConfirm', {
          word: t('teamVaults.trash.purgeVaultWord'),
        })}
        placeholder={t('teamVaults.settings.danger.trash.confirmLabel', {
          word: t('teamVaults.trash.purgeVaultWord'),
        })}
        submitText={t('teamVaults.trash.purgeVault')}
      />
    </div>
  );
};

export default VaultTrash;
