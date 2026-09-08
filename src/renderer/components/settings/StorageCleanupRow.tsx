/**
 * StorageCleanupRow — libérer les octets que plus rien ne référence.
 *
 * ── POURQUOI CE BOUTON EXISTE ───────────────────────────────────────────────
 *
 * Le ramassage automatique ne visite QUE les fichiers encore présents dans le
 * manifeste : `/sync/delta/gc` nettoie les blocs périmés d'un fichier vivant,
 * `DELETE /sync/file` purge celui qu'on supprime. Un fichier dont
 * l'identifiant a disparu du manifeste sans passer par la suppression n'est
 * plus jamais regardé. Mesuré le 2026-09-07 sur un compte ouvert depuis deux
 * postes : 4,2 Go dans ce cas.
 *
 * ── DEUX TEMPS, ET C'EST TOUT L'INTÉRÊT ─────────────────────────────────────
 *
 * On COMPTE d'abord, on montre le chiffre, et on ne propose la suppression
 * qu'ensuite. Demander d'autoriser une suppression dont on ne connaît pas la
 * taille n'est pas demander : c'est faire signer. Le premier appel ne supprime
 * rien — `execute` n'est passé qu'au second, après un clic sur un bouton qui
 * porte le nombre d'octets.
 *
 * ── CE QUI PEUT RESTER APRÈS COUP ───────────────────────────────────────────
 *
 * Le serveur borne chaque passage (5 000 objets) et dit `complete: false`
 * quand il en reste. On le DIT plutôt que de relancer tout seul : une boucle
 * silencieuse sur un geste destructeur est exactement ce qu'on ne veut pas
 * fabriquer ici.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';

/** Ce que le processus principal rend — un sous-ensemble de l'inventaire worker. */
interface Inventaire {
  ok?: boolean;
  code?: string;
  message?: string | null;
  orphanBytes?: number;
  orphanCount?: number;
  orphanFileCount?: number;
  deletedBytes?: number;
  complete?: boolean;
  executed?: boolean;
  skipped?: boolean;
}

type Etat =
  | { phase: 'repos' }
  | { phase: 'compte' }
  | { phase: 'compté'; inv: Inventaire }
  | { phase: 'supprime' }
  | { phase: 'fini'; inv: Inventaire }
  | { phase: 'échec'; code: string; message?: string | null };

const mo = (octets: number): string => `${(octets / 1024 / 1024).toFixed(1)} Mo`;

/**
 * Les refus qu'on sait NOMMER, et le repli qui montre le code pour les autres.
 *
 * Un refus anonyme n'apprend rien : ni à l'utilisateur qui pourrait attendre
 * une heure (limite de débit) ou se reconnecter (session expirée), ni à qui
 * lira sa capture d'écran. Le code brut est laid ; il est infiniment plus utile
 * qu'une phrase polie qui ne distingue aucun cas.
 */
function messageDeRefus(
  t: (cle: string, defaut: string) => string,
  code: string,
  message?: string | null
): string {
  if (code === 'manifest_moved') {
    return t(
      'settings.accountSync.cleanup.moved',
      'Un autre appareil a synchronisé pendant l’analyse. Réessayez.'
    );
  }
  if (code === 'session_expired') {
    return t('settings.accountSync.cleanup.session', 'Session expirée — reconnectez-vous.');
  }
  if (code === 'no_manifest' || code === 'no_profile') {
    return t(
      'settings.accountSync.cleanup.noProfile',
      'Ce profil n’a pas encore synchronisé — rien à analyser.'
    );
  }
  const base = t('settings.accountSync.cleanup.failed', 'Analyse impossible pour le moment.');
  return message ? `${base} (${code} — ${message})` : `${base} (${code})`;
}

export default function StorageCleanupRow(): React.ReactElement {
  const { t } = useTranslation();
  const [etat, setEtat] = useState<Etat>({ phase: 'repos' });

  /**
   * `execute` est passé EXPLICITEMENT. Le processus principal assemble
   * l'ensemble vivant depuis le manifeste local — le renderer ne le tient pas,
   * et c'est très bien ainsi : il n'a pas à savoir quels fichiers sont vivants
   * pour demander un nettoyage.
   */
  const appeler = async (execute: boolean): Promise<void> => {
    setEtat({ phase: execute ? 'supprime' : 'compte' });
    try {
      const r = (await window.electron.ipcRenderer.invoke(
        'sync:gcProfile',
        '',
        execute
      )) as Inventaire | null;
      if (!r?.ok) {
        setEtat({ phase: 'échec', code: r?.code ?? 'unavailable', message: r?.message });
        return;
      }
      // `skipped` = le manifeste a bougé pendant qu'on regardait. Ce n'est pas
      // une panne : un autre appareil a publié, et l'ensemble vivant qu'on
      // vient d'envoyer est périmé. On le dit et on laisse reprendre.
      if (r.skipped) {
        setEtat({ phase: 'échec', code: 'manifest_moved' });
        return;
      }
      setEtat(execute ? { phase: 'fini', inv: r } : { phase: 'compté', inv: r });
    } catch {
      setEtat({ phase: 'échec', code: 'unavailable' });
    }
  };

  const ligne = (texte: string): React.ReactElement => (
    <p className="text-xs text-[var(--color-text-tertiary)]">{texte}</p>
  );

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {etat.phase === 'repos' && (
        <Button size="sm" variant="ghost" onClick={() => void appeler(false)}>
          {t('settings.accountSync.cleanup.check', 'Vérifier l’espace inutilisé')}
        </Button>
      )}

      {etat.phase === 'compte' && ligne(t('settings.accountSync.cleanup.checking', 'Analyse…'))}
      {etat.phase === 'supprime' &&
        ligne(t('settings.accountSync.cleanup.deleting', 'Libération en cours…'))}

      {etat.phase === 'compté' && (
        <>
          {(etat.inv.orphanBytes ?? 0) === 0
            ? ligne(t('settings.accountSync.cleanup.nothing', 'Rien à libérer.'))
            : ligne(
                t('settings.accountSync.cleanup.found', {
                  defaultValue:
                    '{{taille}} en {{objets}} objets ne sont plus référencés par aucun de vos fichiers.',
                  taille: mo(etat.inv.orphanBytes ?? 0),
                  objets: etat.inv.orphanCount ?? 0,
                })
              )}
          {(etat.inv.orphanBytes ?? 0) > 0 && (
            <Button size="sm" variant="primary" onClick={() => void appeler(true)}>
              {t('settings.accountSync.cleanup.free', {
                defaultValue: 'Libérer {{taille}}',
                taille: mo(etat.inv.orphanBytes ?? 0),
              })}
            </Button>
          )}
        </>
      )}

      {etat.phase === 'fini' && (
        <>
          {ligne(
            t('settings.accountSync.cleanup.freed', {
              defaultValue: '{{taille}} libérés.',
              taille: mo(etat.inv.deletedBytes ?? 0),
            })
          )}
          {/* Le serveur borne chaque passage : on le DIT, on ne reboucle pas. */}
          {etat.inv.complete === false && (
            <Button size="sm" variant="ghost" onClick={() => void appeler(false)}>
              {t('settings.accountSync.cleanup.again', 'Il en reste — relancer')}
            </Button>
          )}
        </>
      )}

      {etat.phase === 'échec' && (
        <>
          {/*
            LE CODE EST MONTRÉ QUAND ON NE SAIT PAS LE TRADUIRE.

            « Analyse impossible pour le moment » seul ne laisse rien faire à
            personne — ni à l'utilisateur, ni à qui lira la capture d'écran.
            Signalé par Mathis le 2026-09-07 : le bouton refusait et le journal
            ne portait pas une ligne sur le sujet, parce que la couche réseau
            rendait `null` sans la raison.
          */}
          {ligne(messageDeRefus(t, etat.code, etat.message))}
          <Button size="sm" variant="ghost" onClick={() => void appeler(false)}>
            {t('common.retry', 'Réessayer')}
          </Button>
        </>
      )}
    </div>
  );
}
