/**
 * Lifecycle of a live room for ONE vault note.
 *
 * Mirrors notes/collab/useCollabSession for the personal editor, and is the only
 * place in the vaults folder that touches the collab service. Three things it
 * owns that the personal hook does not:
 *
 *  · the room is addressed by (vaultId, itemId) and its key comes from K_vault,
 *    so the identity it opens on includes the EPOCH — and deliberately not the
 *    revision: a save mints a fresh K_item but must never move the room key
 *    under the peers already in the room (see collabKeys.ts);
 *  · presence carries the member's identity and vault role, because a vault room
 *    contains other people rather than other devices of mine;
 *  · it runs the save election and publishes its verdict, gated by a settle
 *    delay — presence arrives in dribs and drabs, and electing on a half-arrived
 *    roster is how two peers briefly both believe they are the saver.
 *
 * PHASES exist for one specific bug class: the session lands ONE RENDER after
 * the props that describe it. Mounting the editing surface during that gap binds
 * tiptap to the wrong document — permanently, since useEditor takes its
 * extensions once. So the caller is told `pending` and renders nothing until the
 * answer is `live` or `off`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  startVaultCollabSession,
  type CollabSession,
  type SessionStatus,
} from '../../../services/collab';
import { SAVE_ELECTION_SETTLE_MS, type CollabRole } from '../../../services/collab/saveElection';
import {
  deriveVaultPresence,
  sameVaultPresence,
  updateTypingReceipts,
  isTypingNow,
  vaultRoomSettled,
  loneVaultSaverEligible,
  nextOfflineSince,
  LONE_SAVER_ISOLATION_MS,
  TYPING_TTL_MS,
  type TypingReceipt,
  type VaultAwarenessUser,
  type VaultParticipant,
} from './vaultNoteCollab';

export type VaultCollabPhase = 'off' | 'pending' | 'live';

export interface UseVaultNoteCollabOptions {
  /** Result of `shouldOpenVaultRoom` — the caller owns that decision. */
  enabled: boolean;
  vaultId: string;
  itemId: string;
  /** Epoch of K_vault the loaded revision is sealed under. Changing it re-keys the room. */
  epoch: number;
  profileId: string | null;
  /** Our vault role, from Redux. The local authority on whether we may save. */
  role: CollabRole;
  /** What other members see: the member's identity, not a device name. */
  memberLabel: string;
  memberId: string | null;
  /** Cursor / badge colour. */
  color: string;
  /**
   * L'EFFECTIF DU COFFRE tel que le serveur l'annonce (`shareIndexSlice`,
   * alimenté par `GET /vaults/heads`). `undefined` tant que rien n'est arrivé.
   *
   * Il n'ouvre ni ne ferme aucune salle : il sert UNIQUEMENT de preuve de
   * solitude quand le relais est durablement injoignable — la seule qu'on
   * puisse produire sans lui (voir `loneVaultSaverEligible`).
   */
  memberCount?: number;
}

export interface VaultCollabState {
  phase: VaultCollabPhase;
  session: CollabSession | null;
  status: SessionStatus;
  participants: VaultParticipant[];
  /** Are WE the peer that writes this item back to the vault? */
  responsible: boolean;
  /**
   * LE RELAIS NOUS A ÉMIS UN JETON DE LECTEUR (F23) — le coffre est gelé.
   *
   * C'est le signal le plus PRÉCOCE qu'un éditeur ouvert puisse recevoir sur un
   * gel posé pendant qu'il l'était : il arrive au premier renouvellement de
   * jeton (cinq minutes au pire), là où le résumé Redux n'apprendra le gel qu'au
   * prochain `loadVaults`, et où un enregistrement mettrait six secondes de plus
   * pour récolter un 409 `vault_frozen`. L'écran passe donc en lecture seule sur
   * CE signal, sans attendre un refus.
   *
   * Faux tant que rien n'a été dit : une salle personnelle n'inscrit aucun rôle,
   * et une absence n'a jamais valu un verdict.
   */
  serverReadOnly: boolean;
  /**
   * ON EST SEUL, PROUVÉ SANS LA SALLE — le relais est durablement muet et le
   * coffre n'a qu'un membre. C'est le second chemin vers l'enregistrement
   * automatique, et il existe pour que `vaultRoomSettled` ne coûte pas le texte
   * de quelqu'un dont le relais ne répond simplement jamais.
   */
  loneSaver: boolean;
}

/** Identity of an attempt to open a room. A change here reopens it. */
function roomAttemptKey(o: UseVaultNoteCollabOptions): string {
  return `${o.vaultId}:${o.itemId}:${o.epoch}:${o.profileId ?? ''}`;
}

/** Compact signature of the ballot, to detect a roster change without deep-comparing. */
function candidatesSignature(session: CollabSession): string {
  return session
    .getSaveCandidates()
    .map((c) => `${c.clientId}${c.canWrite ? 'w' : 'r'}`)
    .sort()
    .join(',');
}

export function useVaultNoteCollab(options: UseVaultNoteCollabOptions): VaultCollabState {
  const { enabled, vaultId, itemId, epoch, profileId, role, memberLabel, memberId, color } =
    options;
  const memberCount = options.memberCount;

  const attemptKey = roomAttemptKey(options);

  // Identity is read when the room opens and refreshed in place afterwards: a
  // renamed member must not tear down and reopen a WebSocket.
  const identityRef = useRef({ role, memberLabel, memberId, color });
  identityRef.current = { role, memberLabel, memberId, color };
  // L'effectif change SANS rouvrir la salle : il entre par une référence, jamais
  // par les dépendances de l'effet, sinon la première réponse de `/vaults/heads`
  // couperait un WebSocket parfaitement vivant.
  const memberCountRef = useRef(memberCount);
  memberCountRef.current = memberCount;

  const [slot, setSlot] = useState<{ key: string; session: CollabSession | null } | null>(null);
  const [status, setStatus] = useState<SessionStatus>('connecting');
  const [participants, setParticipants] = useState<VaultParticipant[]>([]);
  const [responsible, setResponsible] = useState(false);
  /** Le verdict du relais sur notre droit d'écrire dans CETTE salle (F23). */
  const [serverReadOnly, setServerReadOnly] = useState(false);
  /** Isolement durable + coffre à un seul membre (voir `loneVaultSaverEligible`). */
  const [loneSaver, setLoneSaver] = useState(false);
  /**
   * Le scrutin de la salle vivante, republié à chaque effet. Il sert à réévaluer
   * DE L'EXTÉRIEUR de l'effet — quand l'effectif arrive, par exemple — sans
   * remettre la salle dans les dépendances.
   */
  const evaluateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !profileId) {
      setSlot(null);
      setParticipants([]);
      setResponsible(false);
      // Pas de salle, pas de verdict : une lecture seule héritée d'une salle
      // fermée figerait un éditeur que plus rien ne peut rouvrir.
      setServerReadOnly(false);
      setLoneSaver(false);
      evaluateRef.current = null;
      return undefined;
    }

    let disposed = false;
    let created: CollabSession | null = null;
    try {
      created = startVaultCollabSession({
        vaultId,
        itemId,
        epoch,
        profileId,
        presence: {
          name: identityRef.current.memberLabel,
          color: identityRef.current.color,
          role: identityRef.current.role,
          memberId: identityRef.current.memberId ?? undefined,
        },
      });
    } catch {
      // Transport unavailable, flag off, bad ids: fall back silently. Editing
      // this note stays exactly as it is without a room.
      created = null;
    }

    // Publishing the ATTEMPT even when it failed is what turns `pending` into a
    // definitive `off`, instead of a surface that never mounts.
    setSlot({ key: attemptKey, session: created });
    if (!created) {
      setParticipants([]);
      setResponsible(false);
      setServerReadOnly(false);
      setLoneSaver(false);
      evaluateRef.current = null;
      return undefined;
    }

    const live = created;
    setStatus(live.status);
    /**
     * LU D'ABORD, ÉCOUTÉ ENSUITE (F23). Une session est PARTAGÉE entre ses
     * détenteurs : le jeton peut être arrivé bien avant que ce panneau-ci ne
     * s'abonne, et s'en remettre au seul évènement le laisserait en édition sur
     * un coffre gelé jusqu'au prochain renouvellement — cinq minutes de frappe
     * qui ne partiront jamais.
     */
    setServerReadOnly(live.serverReadOnly);

    // Election state. `lastChange` is when the ballot last changed shape; until
    // the settle delay has run out from that instant, nobody claims the job.
    let lastSignature = '';
    let lastChange = Date.now();
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let channelStatus: SessionStatus = live.status;
    /**
     * DEPUIS QUAND LE CANAL EST-IL MUET ? L'horloge de l'isolement, remise à zéro
     * dès qu'il redonne signe de vie. Rien d'autre ne la porte : la session, elle,
     * ne connaît que son état courant.
     */
    let offlineSince: number | null = nextOfflineSince(null, live.status, Date.now());
    /** Le silence ne réveille personne : c'est ce minuteur qui rouvre le scrutin. */
    let loneTimer: ReturnType<typeof setTimeout> | null = null;
    // « Untel ecrit… » : les recus dates par NOTRE horloge, et le timer qui
    // re-evalue a l'expiration du plus proche — rien d'autre ne nous reveille
    // quand un typing expire en silence.
    let typingReceipts = new Map<number, TypingReceipt>();
    let typingExpiryTimer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = () => {
      if (disposed) return;
      const signature = candidatesSignature(live);
      if (signature !== lastSignature) {
        lastSignature = signature;
        lastChange = Date.now();
        // Re-ask ourselves once the roster has had time to stop moving —
        // nothing else would wake us up, since no event fires on "silence".
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(evaluate, SAVE_ELECTION_SETTLE_MS + 50);
      }
      // « HORS LIGNE » NE PROUVE RIEN sur les autres membres d'un coffre — la
      // règle, et le défaut qu'elle ferme, sont en tête de `vaultRoomSettled`.
      const channelSettled = vaultRoomSettled(channelStatus);
      /**
       * LA CONTREPARTIE. Un relais durablement muet ne doit pas coûter
       * l'enregistrement automatique à quelqu'un dont le coffre n'a qu'un membre :
       * personne d'autre ne PEUT écrire cet objet, et ce fait-là vient de l'API
       * des coffres, pas de la salle (voir `loneVaultSaverEligible`).
       */
      const alone = loneVaultSaverEligible({
        status: channelStatus,
        offlineSince,
        memberCount: memberCountRef.current,
        localRole: identityRef.current.role,
        now: Date.now(),
      });
      setLoneSaver((prev) => (prev === alone ? prev : alone));
      // Rien n'arrive quand le canal reste muet : sans ce réveil, l'isolement
      // serait constaté à la prochaine frappe, jamais à son échéance.
      if (loneTimer) clearTimeout(loneTimer);
      loneTimer =
        !alone && channelStatus === 'offline' && offlineSince !== null
          ? setTimeout(
              evaluate,
              Math.max(0, offlineSince + LONE_SAVER_ISOLATION_MS - Date.now()) + 50
            )
          : null;
      const rosterSettled = Date.now() - lastChange >= SAVE_ELECTION_SETTLE_MS;
      const amResponsible = live.isSaveResponsible((channelSettled || alone) && rosterSettled);
      setResponsible((prev) => (prev === amResponsible ? prev : amResponsible));

      const now = Date.now();
      const states = live.awareness.getStates() as ReadonlyMap<
        number,
        { user?: VaultAwarenessUser | null; typing?: unknown } | undefined
      >;
      typingReceipts = updateTypingReceipts(typingReceipts, states, now);
      const typingIds = new Set<number>();
      let nextExpiry = Infinity;
      typingReceipts.forEach((receipt, clientId) => {
        if (isTypingNow(receipt, now)) {
          typingIds.add(clientId);
          nextExpiry = Math.min(nextExpiry, receipt.seenAt + TYPING_TTL_MS);
        }
      });
      if (typingExpiryTimer) clearTimeout(typingExpiryTimer);
      typingExpiryTimer =
        typingIds.size > 0 ? setTimeout(evaluate, Math.max(0, nextExpiry - now) + 20) : null;

      const next = deriveVaultPresence(
        states,
        live.awareness.clientID,
        { name: identityRef.current.memberLabel, color: identityRef.current.color },
        live.getSaveResponsible(),
        typingIds
      );
      setParticipants((prev) => (sameVaultPresence(prev, next) ? prev : next));
    };

    const offReadOnly = live.onServerReadOnly((ro) => {
      if (disposed) return;
      setServerReadOnly(ro);
      /**
       * ET ON REFAIT LE SCRUTIN. Le gel et le dégel changent le rôle que NOTRE
       * présence porte (`_adoptServerRole`), donc le bulletin — mais ce
       * changement-là ne passe par aucune trame d'awareness : sans cet appel,
       * un dégel rendrait l'éditeur éditable en laissant `responsible` à faux
       * jusqu'à ce qu'un pair entre ou sorte de la salle. Seul appelé après
       * `setServerReadOnly`, il ne peut que corriger.
       */
      evaluate();
    });

    const offStatus = live.onStatus((nextStatus) => {
      if (disposed) return;
      channelStatus = nextStatus;
      // Une reconnexion, même brève, RÉARME l'horloge — la règle et le piège
      // qu'elle ferme sont en tête de `nextOfflineSince`.
      offlineSince = nextOfflineSince(offlineSince, nextStatus, Date.now());
      setStatus(nextStatus);
      evaluate();
    });

    const awareness = live.awareness;
    awareness.on('change', evaluate);
    evaluateRef.current = evaluate;
    evaluate();

    return () => {
      disposed = true;
      evaluateRef.current = null;
      if (settleTimer) clearTimeout(settleTimer);
      if (typingExpiryTimer) clearTimeout(typingExpiryTimer);
      if (loneTimer) clearTimeout(loneTimer);
      try {
        awareness.off('change', evaluate);
      } catch {
        /* awareness already destroyed */
      }
      try {
        offStatus?.();
      } catch {
        /* already unsubscribed */
      }
      try {
        offReadOnly?.();
      } catch {
        /* already unsubscribed */
      }
      try {
        // RELEASE, never destroy: the same item may be open elsewhere, and the
        // first holder to close must not take the room with it.
        live.release();
      } catch {
        /* already gone */
      }
      setStatus('connecting');
      setParticipants([]);
      setResponsible(false);
      setServerReadOnly(false);
      setLoneSaver(false);
    };
  }, [enabled, attemptKey, vaultId, itemId, epoch, profileId]);

  /**
   * L'EFFECTIF ARRIVE APRÈS COUP — `GET /vaults/heads` répond quand il répond.
   * Il ne doit rouvrir aucune salle (il n'est pas dans les dépendances de
   * l'effet), mais il change la réponse du scrutin : on le relance sur place.
   */
  useEffect(() => {
    evaluateRef.current?.();
  }, [memberCount]);

  // Identity refresh in place — no reconnection.
  const session = slot?.key === attemptKey ? slot.session : null;
  useEffect(() => {
    if (!session) return;
    session.setPresence({
      name: memberLabel,
      color,
      role,
      memberId: memberId ?? undefined,
    });
  }, [session, memberLabel, color, role, memberId]);

  const phase: VaultCollabPhase = useMemo(() => {
    if (!enabled || !profileId) return 'off';
    if (!slot || slot.key !== attemptKey) return 'pending';
    // Un refus d'accès n'est pas une salle vivante : sortir de 'live' coupe
    // l'enregistrement automatique et remonte la surface en édition locale, ce
    // qui est la vérité — on n'est plus membre du coffre.
    if (status === 'denied') return 'off';
    return slot.session ? 'live' : 'off';
  }, [enabled, profileId, slot, attemptKey, status]);

  return {
    phase,
    session,
    status,
    participants,
    responsible,
    /** Vrai seulement pour la salle courante, même discipline que `serverReadOnly`. */
    loneSaver: session ? loneSaver : false,
    /**
     * LE VERDICT NE VAUT QUE POUR LA SALLE QUI L'A DONNÉ. Pendant la fenêtre où
     * `slot` porte encore la salle PRÉCÉDENTE (changement d'élément, rotation
     * d'époque), rendre son « lecture seule » verrouillerait un éditeur qui vient
     * de s'ouvrir sur autre chose. Même discipline que `session`, qui est nulle
     * tant que la clé de tentative ne correspond pas.
     */
    serverReadOnly: session ? serverReadOnly : false,
  };
}

/**
 * The room's write-back cadence, as a stable callback the editor can schedule.
 * Split out so the debounce lives next to the rule it serves rather than inside
 * a component effect.
 *
 * `armed` EST RENDU PARCE QUE L'ÉCRAN EN RÉPOND. Le panneau annonce « pris en
 * charge » ou « rien ne l'enregistrera » ; tant que ce verdict se déduisait de
 * la CAPACITÉ d'écrire (élu, salle stabilisée, version connue), il pouvait
 * décrire une écriture que rien ne déclenchait — il a suffi qu'un chemin de
 * modification oublie d'appeler `schedule` (c'était le cas du titre) pour que le
 * badge promette un enregistrement qui n'arriverait jamais. `armed` est le FAIT
 * correspondant : un minuteur court, ici, maintenant. C'est un état de rendu et
 * non une référence, parce que le badge doit changer quand il retombe.
 */
export function useDebouncedCallback(
  fn: () => void,
  delayMs: number
): { schedule: () => void; cancel: () => void; armed: boolean } {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [armed, setArmed] = useState(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setArmed(false);
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      // Désarmé AVANT l'appel : ce qui suit peut réarmer (un commit qui ne
      // couvre pas l'écran le fait), et l'ordre inverse effacerait ce réarmement.
      setArmed(false);
      fnRef.current();
    }, delayMs);
  }, [delayMs]);

  useEffect(() => cancel, [cancel]);

  return { schedule, cancel, armed };
}
