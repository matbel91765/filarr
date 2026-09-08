/**
 * useOnlineStatus — « hors ligne » est un état, pas une erreur.
 *
 * L'ancien écran repliait tout sur une phrase unique : « Le catalogue n'a pas pu
 * être chargé. » Un câble débranché, une panne serveur et une session expirée y
 * disaient exactement la même chose, et aucune des trois n'offrait de bouton.
 *
 * Distinguer le hors-ligne change la phrase ET le ton : ce n'est pas une panne,
 * les extensions déjà installées continuent de fonctionner, et il n'y a rien à
 * réparer — seulement à attendre. Le retour du réseau doit alors relancer la
 * requête TOUT SEUL : redemander à l'utilisateur de cliquer sur « Réessayer »
 * alors que la machine sait déjà que la connexion est revenue est une corvée
 * gratuite.
 */

import { useEffect, useState } from 'react';

function readOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // `onLine` peut être absent (environnements de test) : l'absence d'information
  // se lit « en ligne » — un faux « hors ligne » masquerait le catalogue.
  return navigator.onLine !== false;
}

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    // Le montage peut suivre un changement survenu pendant le chargement
    // paresseux de l'écran : on resynchronise une fois.
    setOnline(readOnline());
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
