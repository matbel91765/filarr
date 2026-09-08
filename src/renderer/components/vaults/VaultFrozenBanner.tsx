/**
 * VaultFrozenBanner (F23) — « Coffre gelé par X le … », le MÊME bandeau partout.
 *
 * POURQUOI UN COMPOSANT PLUTÔT QUE DEUX BLOCS DE JSX. Le gel se voit à deux
 * endroits qui n'ont rien en commun : l'explorateur du coffre (où les boutons
 * d'écriture viennent de disparaître) et la page « Gérer le coffre » (où
 * l'interrupteur vit). Deux rendus séparés, ce serait deux phrases qui finiront
 * par diverger sur le seul fait qui explique la disparition des boutons — et
 * c'est précisément l'écart entre « archivage volontaire » et « panne
 * inexplicable ».
 *
 * IL NE NOMME PERSONNE QU'IL NE CONNAÎT PAS. Le serveur ne rend qu'un
 * identifiant opaque (`frozenBy`) ; le résoudre demande le trombinoscope, qui
 * peut n'être pas encore lu — ou ne pas contenir un membre déjà sorti du coffre.
 * Deux phrases existent donc : avec le nom, et sans. Afficher « gelé par
 * a1b2c3d4 » ne renseignerait personne, et attendre le nom laisserait un
 * bandeau vide sur le fait le plus important de l'écran.
 *
 * IL NE FABRIQUE AUCUNE DATE. `parseInstant` — le même lecteur que les
 * invitations, qui connaît l'ISO comme le `'YYYY-MM-DD HH:MM:SS'` de SQLite —
 * rend `null` sur ce qu'il ne sait pas lire, et la phrase sans date prend alors
 * le relais plutôt qu'un « Invalid Date » à côté d'un nom.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { InfoCallout } from '../settings/enterprise/AdminPrimitives';
import '../settings/enterprise/enterprise.css';
import { parseInstant } from './settings/inviteLifecycleModel';

interface Props {
  /** L'instant du gel, tel que le serveur l'a rendu. `null` = coffre vivant. */
  frozenAt: string | null | undefined;
  /** L'identifiant OPAQUE de qui a gelé. */
  frozenBy: string | null | undefined;
  /**
   * Le résolveur d'identifiant vers une adresse, quand l'écran en a un. Il rend
   * une chaîne vide (ou l'identifiant nu) quand il ne sait pas : le bandeau ne
   * l'affiche que s'il diffère de l'identifiant, sans quoi il écrirait
   * « gelé par a1b2c3d4 », qui ne renseigne personne.
   */
  display?: (userId: string) => string;
}

export const VaultFrozenBanner: React.FC<Props> = ({ frozenAt, frozenBy, display }) => {
  const { t } = useTranslation();
  // Le bandeau EST le verdict : pas de gel, pas de bandeau. Un bandeau grisé
  // « ce coffre n'est pas gelé » serait du bruit permanent sur tous les coffres.
  if (!frozenAt) return null;

  const ms = parseInstant(frozenAt);
  const date = ms === null ? null : new Date(ms).toLocaleDateString();
  const resolu = frozenBy && display ? display(frozenBy) : '';
  // « Résolu » veut dire : on a autre chose que l'identifiant lui-même. Le
  // repli habituel des résolveurs de ce dossier est l'identifiant tronqué, qui
  // ne dit rien à personne — on préfère alors la phrase sans nom.
  const qui = resolu && resolu !== frozenBy && !frozenBy?.startsWith(resolu) ? resolu : '';

  return (
    <InfoCallout tone="warning">
      {/* `role="status"` et non `role="alert"` : le gel n'est pas un incident
          qui vient d'arriver, c'est l'état dans lequel on entre. Une région
          assertive interromprait la lecture d'écran à chaque rendu.

          ET L'ANNONCE N'EST PAS GARANTIE, autant l'écrire : ce bandeau n'existe
          QUE gelé (ses deux hôtes ne le montent que sur `frozen`), donc la
          région naît avec son texte déjà dedans — or c'est le CHANGEMENT d'une
          région déjà présente qui est annoncé de façon fiable. La monter vide en
          permanence demanderait aux deux hôtes de la peindre sur tous les
          coffres, y compris dans un conteneur à marges : on préfère la garder
          honnête et compter sur ce qui, lui, est certain — le bandeau est en
          tête d'écran, dans l'ordre de lecture, avant les boutons qu'il
          explique. */}
      <p className="text-sm font-medium m-0" role="status">
        {qui && date
          ? t('teamVaults.freeze.banner.titleBy', { who: qui, date })
          : date
            ? t('teamVaults.freeze.banner.title', { date })
            : /* Ni nom ni date lisibles : le FAIT reste vrai et doit se dire.
                 Le corps du bandeau porte à lui seul tout ce qui est
                 actionnable — c'est lui, et pas la date, qui explique les
                 boutons manquants. */
              t('teamVaults.settings.frozen.hint')}
      </p>
      <p className="text-xs m-0 mt-1">{t('teamVaults.freeze.banner.body')}</p>
    </InfoCallout>
  );
};

export default VaultFrozenBanner;
