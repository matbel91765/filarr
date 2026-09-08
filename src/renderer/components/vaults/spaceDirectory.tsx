/**
 * spaceDirectory — lire les gens de l'espace D'UN COFFRE, et dire quand on n'a
 * pas pu.
 *
 * CE QUE SON ABSENCE COÛTAIT (P2). Trois écrans lisaient le trombinoscope
 * d'espace par `GET /org/:orgId/members`, chacun avec son `catch {}` muet en
 * commentaire (« invité dans l'espace d'autrui : lecture refusée, tolérée »).
 * Or cette route exige `VIEW_MEMBERS`, que la matrice d'org ne donne qu'aux
 * propriétaires et administrateurs d'ESPACE : un admin de coffre reçu chez
 * quelqu'un d'autre est org `viewer`, donc il essuyait un 403 SYSTÉMATIQUE. Le
 * silence transformait ce refus permanent en « il n'y a personne » : les
 * adresses redevenaient des identifiants, et la ligne d'invitation proposait
 * une invitation d'espace à des gens qui étaient déjà dans l'espace.
 *
 * Ici, deux choses et rien de plus : un chargement qui CLASSE son échec, et une
 * ligne de texte qui le dit. Les écrans qui s'en servent ne sont pas refondus —
 * la fiche F02 les remplace — mais aucun d'eux ne ment plus par omission.
 *
 * QUI APPELLE. Seulement un propriétaire ou un administrateur de coffre : la
 * route leur est réservée. Pour un membre ou un lecteur, `enabled` reste faux
 * et l'annuaire n'est même pas demandé — leurs adresses viennent désormais du
 * champ `email` que chaque ligne de `GET /vaults/:id/members` porte.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import {
  apiListVaultDirectory,
  classifyDirectoryFailure,
  type SpaceDirectoryEntry,
} from '../../../services/vault/vaultApi';

/**
 * `ok` recouvre deux situations qui appellent le même écran : l'annuaire a été
 * lu, ou il n'a pas été demandé (rôle sans la route). Dans les deux cas il n'y
 * a rien à signaler — un membre n'a pas à voir un reproche pour un appel qu'on
 * a choisi de ne pas faire.
 */
export type DirectoryState = 'ok' | 'forbidden' | 'unavailable';

export interface SpaceDirectory {
  entries: SpaceDirectoryEntry[];
  state: DirectoryState;
  /** Relire — n'a de sens que sur `unavailable` ; un refus de droit ne bouge pas. */
  reload: () => void;
}

export function useSpaceDirectory(vaultId: string, enabled: boolean): SpaceDirectory {
  const [entries, setEntries] = useState<SpaceDirectoryEntry[]>([]);
  const [state, setState] = useState<DirectoryState>('ok');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setEntries([]);
      setState('ok');
      // Un cleanup rendu DANS TOUS LES CAS : une fonction qui n'en rend que
      // dans une branche déclenche TS7030 (« pas de valeur de retour »).
      return () => {};
    }
    let vivant = true;
    void apiListVaultDirectory(vaultId)
      .then((m) => {
        if (!vivant) return;
        setEntries(m);
        setState('ok');
      })
      .catch((e) => {
        if (!vivant) return;
        // Une liste vide ET un état : sans le second, le vide se lirait
        // « personne dans cet espace », qui est faux et indétectable.
        setEntries([]);
        setState(classifyDirectoryFailure(e));
      });
    return () => {
      vivant = false;
    };
  }, [vaultId, enabled, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { entries, state, reload };
}

/**
 * La ligne qui dit ce qui s'est passé. DEUX phrases distinctes, parce que les
 * deux appellent des gestes opposés : une panne se réessaie, un droit absent
 * non — offrir « Réessayer » sur un refus définitif est une invitation à
 * cliquer en boucle.
 */
export const DirectoryNotice: React.FC<{ state: DirectoryState; onRetry?: () => void }> = ({
  state,
  onRetry,
}) => {
  const { t } = useTranslation();
  if (state === 'ok') return null;
  return (
    <div role="status" className="flex items-center justify-between gap-2">
      <p className="text-xs text-[var(--color-text-tertiary)] m-0">
        {t(
          state === 'forbidden'
            ? 'teamVaults.members.directoryForbidden'
            : 'teamVaults.members.directoryUnavailable'
        )}
      </p>
      {state === 'unavailable' && onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {t('teamVaults.retry')}
        </Button>
      )}
    </div>
  );
};
