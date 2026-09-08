/**
 * Cycle de vie d'une session vivante pour la note ouverte.
 *
 * Point de couture avec le fournisseur (agent voisin) : ce module est le SEUL
 * de l'éditeur à importer `services/collab/collabProvider`. Le type de session
 * est déduit du retour de la fabrique, pour ne dépendre que d'un export.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createCollabSession } from '../../../../services/collab/collabProvider';
import { isLiveCollabEnabled, LIVE_COLLAB_CHANGED_EVENT } from '../../../../config/collab';
import { buildCollabIdentity, derivePresence, getDeviceSeed, samePresence } from './collabPresence';
import type {
  AwarenessUserState,
  CollabIdentity,
  CollabParticipant,
  CollabStatus,
} from './collabTypes';

export type CollabSession = NonNullable<ReturnType<typeof createCollabSession>>;

export interface UseCollabSessionOptions {
  noteId: string;
  profileId: string | null;
  /** Faux en lecture seule, en aperçu de version, ou drapeau éteint. */
  enabled: boolean;
  /** Nom affiché de cet appareil dans la barre de présence. */
  displayName: string;
}

export interface CollabSessionState {
  session: CollabSession | null;
  status: CollabStatus;
  participants: CollabParticipant[];
  identity: CollabIdentity;
}

/** Suit le drapeau « édition vivante » sans recharger l'application. */
export function useLiveCollabEnabled(): boolean {
  const [enabled, setEnabled] = useState(isLiveCollabEnabled);
  useEffect(() => {
    const sync = () => setEnabled(isLiveCollabEnabled());
    window.addEventListener(LIVE_COLLAB_CHANGED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(LIVE_COLLAB_CHANGED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return enabled;
}

export function useCollabSession(options: UseCollabSessionOptions): CollabSessionState {
  const { noteId, profileId, enabled, displayName } = options;

  const identity = useMemo(() => buildCollabIdentity(displayName, getDeviceSeed()), [displayName]);
  // Lue à l'ouverture de la session seulement : un changement de nom ne doit
  // pas rouvrir la salle (donc pas de reconnexion réseau à chaque frappe).
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus>('connecting');
  const [participants, setParticipants] = useState<CollabParticipant[]>([]);

  useEffect(() => {
    if (!enabled || !noteId || !profileId) return undefined;

    let disposed = false;
    let created: CollabSession | null = null;
    try {
      created = createCollabSession({
        profileId,
        noteId,
        user: { name: identityRef.current.name, color: identityRef.current.color },
      });
    } catch {
      // Transport indisponible : on retombe silencieusement sur le mode actuel.
      created = null;
    }
    if (!created) return undefined;

    const live = created;
    setSession(live);
    setStatus(live.status);

    const offStatus = live.onStatus((next) => {
      if (!disposed) setStatus(next);
    });

    const awareness = live.awareness;
    const refresh = () => {
      if (disposed) return;
      const states = awareness.getStates() as ReadonlyMap<number, AwarenessUserState | undefined>;
      const next = derivePresence(states, awareness.clientID, identityRef.current.name);
      // Garder la référence précédente quand rien de visible n'a bougé : sinon
      // chaque déplacement de curseur distant re-rendrait tout l'éditeur.
      setParticipants((prev) => (samePresence(prev, next) ? prev : next));
    };
    refresh();
    awareness.on('change', refresh);

    return () => {
      disposed = true;
      try {
        awareness.off('change', refresh);
      } catch {
        /* awareness déjà détruite */
      }
      try {
        offStatus?.();
      } catch {
        /* désabonnement déjà fait */
      }
      try {
        // RELÂCHER, pas détruire : la même note peut être ouverte dans un
        // second panneau (mode scindé), et le premier qui ferme ne doit pas
        // emporter la session de l'autre.
        live.release();
      } catch {
        /* session déjà détruite */
      }
      setSession(null);
      setStatus('connecting');
      setParticipants([]);
    };
  }, [enabled, noteId, profileId]);

  return { session, status, participants, identity };
}
