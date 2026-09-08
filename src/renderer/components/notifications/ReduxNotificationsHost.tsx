/**
 * ReduxNotificationsHost — rend les notifications de fond dispatchées dans Redux
 *
 * Filarr a DEUX files de notifications :
 *   1. le Context `NotificationProvider` (useNotification), seul système monté
 *      et donc seul à s'afficher ;
 *   2. `state.ui.notifications`, alimenté par addNotification /
 *      showSuccessNotification / showErrorNotification — que PERSONNE ne
 *      rendait. Les toasts des services de fond (hot folders, watcher de
 *      téléchargements, protection du bureau) tombaient dans le vide : un
 *      fichier était importé sans que rien ne l'annonce.
 *
 * Ce hôte draine la file Redux dans la pile du Context : même apparence, même
 * empilement, aucun second conteneur (il ne rend rien lui-même). L'entrée est
 * retirée de Redux dès qu'elle est transmise — le toast devient alors seul
 * propriétaire de son cycle de vie (fermeture, expiration) ; sans ce retrait
 * elle serait re-transmise à chaque re-render.
 *
 * OPT-IN ASSUMÉ — seules les notifications marquées `metadata.source` sont
 * transmises. Les hooks CRUD historiques (useFolder, useFile) dispatchent EUX
 * AUSSI dans cette file, en doublon d'un toast Context déjà affiché par leurs
 * appelants (Home, FolderView) et avec des chaînes françaises en dur : tout
 * transmettre afficherait deux toasts par création de dossier, dont un en
 * français sur une interface anglaise. Un service de fond s'abonne donc
 * explicitement :
 *
 *   store.dispatch(showSuccessNotification(msg, { metadata: { source: 'hotFolders' } }));
 *
 * (à faire pour downloadsWatcherBridge et desktopProtectionBridge, dont les
 * chaînes doivent d'abord passer par i18n.)
 */

import React, { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../../store';
import { selectNotifications } from '../../../store/selectors/uiSelectors';
import { removeNotification } from '../../../store/slices/uiSlice';
import { useNotification } from '../ui/Notification';

const ReduxNotificationsHost: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const notifications = useSelector(selectNotifications);
  const { notify } = useNotification();

  // Ref miroir de `notify`, synchronisée par un effet dédié : le drainage ne
  // doit se déclencher que sur l'arrivée d'une notification, pas sur
  // l'identité du callback du Context.
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  // Ids déjà transmis pendant la vidange en cours : protège d'un double
  // affichage si l'effet est rejoué sur le même instantané (StrictMode, rendu
  // concurrent). Vidé dès que la file est drainée, donc borné.
  const forwardedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const owned = notifications.filter(
      (notification) => typeof notification.metadata?.source === 'string'
    );
    if (owned.length === 0) {
      forwardedIdsRef.current.clear();
      return;
    }
    for (const notification of owned) {
      const key = String(notification.id);
      if (!forwardedIdsRef.current.has(key)) {
        forwardedIdsRef.current.add(key);
        notifyRef.current({
          type: notification.type,
          message: notification.message,
          duration: notification.autoClose === false ? 0 : (notification.duration ?? 5000),
        });
      }
      dispatch(removeNotification(notification.id as number));
    }
  }, [notifications, dispatch]);

  return null;
};

export default ReduxNotificationsHost;
