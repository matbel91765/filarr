/**
 * PluginEditorModal — l'HÔTE d'édition : le pont entre un greffon et un coffre.
 *
 * C'est ici, et seulement ici, que les deux mondes se touchent. Le greffon
 * reçoit des octets, un `saveBytes`, et — quand la salle est possible — une
 * poignée de collaboration. Il ne voit ni Redux, ni le réseau, ni une clé :
 * le déchiffrement, le verrou de version, l'époque, l'élection de
 * l'enregistreur restent la propriété du cœur. Un greffon qui voudrait plus
 * que ce contrat est un greffon qu'on refuse.
 *
 * La salle est ouverte pour un élément FICHIER exactement comme pour une note :
 * même crochet, même billet, même époque — la garde `shouldOpenVaultRoom` a
 * cessé de connaître la liste des formats, c'est l'éditeur qui affirme que son
 * contenu est un document CRDT.
 *
 * CE QUE L'HÔTE GARANTIT AU GREFFON (P3-H) — le contrat que la documentation
 * promet doit EXISTER ici, sinon il ne vaut rien :
 *
 *  1. Les pannes se VOIENT. Un `mount()` rejeté et un `onFatal` du pont
 *     s'affichent en bandeau (texte React, jamais innerHTML) ; le temps de
 *     montage a son indicateur.
 *  2. Les sauvegardes sont SÉRIALISÉES et portent leur ORIGINE. Une seule en
 *     vol ; la suivante rejette `save_in_flight`.
 *  3. Un conflit de version d'origine 'plugin' N'ADOPTE JAMAIS la version
 *     serveur : l'autosave d'un greffon ne doit pas écraser le travail d'un
 *     collègue sans qu'un humain l'ait décidé. Toute sauvegarde suivante
 *     rejette `item_version_conflict` jusqu'au geste explicite (Enregistrer →
 *     confirmation d'écrasement), SEUL endroit qui adopte serverVersion.
 *  4. Le drapeau `dirty` ne se fait plus écraser : une frappe arrivée PENDANT
 *     l'aller-retour de sauvegarde survit à son succès (dirtySeqRef).
 *  5. `readOnly` est une OBLIGATION VÉRIFIÉE : saveBytes jette `read_only`
 *     sans regarder ce que le greffon a bien voulu respecter.
 *  6. Une autosave ne coûte ni toast ni rechargement du coffre : indicateur
 *     discret, `onSaved()` différé à la fermeture.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, ConfirmModal } from '../ui';
import { Modal } from '../ui/Modal/Modal';
import { useNotification } from '../ui/Notification';
import { PluginEditorShell, type PluginEditorSaveState } from './PluginEditorShell';
import type { AppDispatch, RootState } from '../../../store';
import {
  downloadVaultItemContent,
  updateVaultItem,
  renameVaultItem,
  selectIsVaultUnlocked,
  isVaultItemConflict,
  type VaultItemSummary,
} from '../../../store/slices/vaultsSlice';
import { vaultErrorKey, errorText } from '../../../services/vault/vaultErrorMessages';
import type { EditorInstance, EditorProvider } from '../../../services/plugins/pluginTypes';
import { trustOfProvider } from '../../../services/plugins/pluginRegistry';
import { shouldOpenVaultRoom, vaultMemberLabel } from '../vaults/vaultNoteCollab';
import { useVaultNoteCollab } from '../vaults/useVaultNoteCollab';

/**
 * Budget d'éligibilité collab d'un document de greffon — marge sous la trame
 * du relais (COLLAB_MAX_SEND_BYTES = 1 Mio, collabProtocol.ts) : au-delà, une
 * trame de semis serait JETÉE EN SILENCE et les pairs garderaient une salle
 * vide qu'une sauvegarde écraserait sous version. Miroir de
 * DOC_COLLAB_MAX_BYTES du greffon docs.
 */
const PLUGIN_DOC_COLLAB_MAX_BYTES = 700 * 1024;

/**
 * Les CODES que `host.saveBytes` rejette — jamais une phrase traduite (le
 * greffon a sa propre i18n ; voir le doc-comment de EditorHost.saveBytes).
 * Tout autre refus part sous la CLÉ i18n de l'hôte (`vaultErrorKey`).
 */
/**
 * Le PRÉFIXE que `parseFdoc` du plugin docs jette quand l'enveloppe annonce une
 * version qu'il ne connaît pas (voir external/docs/fdoc.js, et le test de
 * compat qui le fige). Ce n'est pas un plantage : c'est le contrat « refuser,
 * jamais dégrader » qui fonctionne. L'utilisateur doit lire « mettez à jour »,
 * pas « le plugin a cessé de fonctionner » — l'un se répare, l'autre effraie.
 */
const FDOC_VERSION_TOO_NEW = 'Unsupported fdoc version';

const SAVE_CONFLICT = 'item_version_conflict';
const SAVE_READ_ONLY = 'read_only';
const SAVE_IN_FLIGHT = 'save_in_flight';

type SaveOrigin = 'plugin' | 'user';
import { resolveEditSessionId, buildEditSessionMeta } from '../vaults/vaultNoteCollab';
import { pickCollabColor, getDeviceSeed } from '../notes/collab/collabPresence';
import { VaultCollabPresence } from '../vaults/VaultCollabPresence';
import type { CollabRole } from '../../../services/collab/saveElection';

interface Props {
  vaultId: string;
  item: VaultItemSummary;
  fileName: string;
  provider: EditorProvider;
  canEdit: boolean;
  role: string;
  onClose: () => void;
  onSaved: () => void;
}

export const PluginEditorModal: React.FC<Props> = ({
  vaultId,
  item,
  fileName,
  provider,
  canEdit,
  role,
  onClose,
  onSaved,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  /** Le nom accessible de la fenêtre — voir `PluginEditorShellProps.titleId`. */
  const titleId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<EditorInstance | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  /** Le montage a échoué (exception de mount) — message du greffon, affiché. */
  const [mountError, setMountError] = useState<string | null>(null);
  /** Le pont a rendu l'âme APRÈS le montage (onFatal) — affiché aussi. */
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** Entre la lecture des octets et la résolution du mount. */
  const [mounting, setMounting] = useState(false);
  /**
   * Le montage a échoué parce que le DOCUMENT est plus récent que l'éditeur —
   * un refus délibéré du format, pas une panne.
   */
  const documentTooNew = mountError !== null && mountError.startsWith(FDOC_VERSION_TOO_NEW);
  /** Conflit en attente d'arbitrage humain — bloque toute autosave. */
  const [conflictPending, setConflictPending] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  /** Horodatage de la dernière autosave réussie (indicateur discret du pied). */
  const [autoSavedAt, setAutoSavedAt] = useState<number | null>(null);
  /**
   * La dernière sauvegarde a ÉCHOUÉ (hors conflit, qui a son propre bandeau).
   * Le toast passe ; la pastille reste rouge tant que rien n'a réussi.
   */
  const [saveFailed, setSaveFailed] = useState(false);
  // La version que NOTRE sauvegarde doit battre — suit chaque succès.
  const versionRef = useRef(item.version);
  /**
   * LA MÉTA COURANTE — et pas `item.meta` figé à l'ouverture (P9-B3).
   *
   * `updateVaultItem` REPOUSSE la méta à chaque sauvegarde. Un renommage change
   * `meta.fileName` côté serveur ; si la sauvegarde suivante renvoyait la méta
   * de l'ouverture, elle RESTAURERAIT l'ancien nom sans que personne ne l'ait
   * demandé — le renommage aurait tenu deux secondes, le temps de la prochaine
   * autosave.
   */
  const metaRef = useRef(item.meta);
  /** Le nom affiché ; il ne pilote AUCUN effet (voir `renameTo`). */
  const [displayName, setDisplayName] = useState(fileName);
  /**
   * Un RENOMMAGE est en vol — état distinct de `saving`, et il le faut.
   * Le greffon autosauve toutes les deux secondes : figer le champ de titre
   * sur `saving` le rendrait insaisissable une fois sur deux, en pleine
   * frappe, pour une écriture qui ne le concerne pas.
   */
  const [renaming, setRenaming] = useState(false);
  /** Une seule sauvegarde en vol : la suivante rejette `save_in_flight`. */
  const inFlightRef = useRef(false);
  const conflictPendingRef = useRef(false);
  /** La version que le serveur a annoncée au conflit — adoptée SEULEMENT par
   *  la confirmation d'écrasement, jamais par une autosave. */
  const pendingServerVersionRef = useRef<number | null>(null);
  /**
   * Compteur de saletés. Le succès d'une sauvegarde ne baisse le drapeau que si
   * AUCUN onDirty(true) n'est arrivé pendant l'aller-retour — sinon la frappe
   * de l'utilisateur pendant l'envoi était déclarée enregistrée, et la
   * confirmation « quitter sans perdre » sautait.
   */
  const dirtySeqRef = useRef(0);
  /** Une autosave a réussi : le coffre doit être rechargé — à la FERMETURE. */
  const pendingReloadRef = useRef(false);

  // ── La salle, aux mêmes conditions que les notes ───────────────────────────
  const vaultUnlocked = useSelector((s: RootState) => selectIsVaultUnlocked(s, vaultId));
  const profileId = useSelector(
    (s: RootState) => s.profiles?.manifest?.activeProfileId || s.profiles?.activeProfileId || null
  );
  const cloudUser = useSelector((s: RootState) => s.auth?.cloudUser ?? null);
  const profileName = useSelector((s: RootState) => s.auth?.localProfile?.name ?? null);
  const myRole: CollabRole =
    role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer'
      ? role
      : canEdit
        ? 'member'
        : 'viewer';
  const memberLabel = useMemo(
    () => vaultMemberLabel({ email: cloudUser?.email, profileName, userId: cloudUser?.id }),
    [cloudUser?.email, cloudUser?.id, profileName]
  );
  const roomEnabled = shouldOpenVaultRoom({
    bodyReady: bytes !== null,
    vaultUnlocked,
    /**
     * GATE CÔTÉ HÔTE (docs-v2) : la salle NE S'OUVRE PAS pour un document
     * au-delà du budget de trame — sinon le greffon monterait SOLO pendant que
     * collabLive resterait vrai : la confirmation de fermeture serait sautée
     * (modifications jetées sans avertissement) et la barre de présence
     * annoncerait une co-édition inexistante. Règle déterministe sur les MÊMES
     * octets : tous les clients concluent pareil. Le greffon garde sa propre
     * garde — défense en profondeur.
     */
    // Un provider SANDBOXÉ n'ouvre JAMAIS de salle (v1 sans collab pour du
    // code non revu — la clé de salle n'existe que côté hôte), et le budget de
    // trame s'applique toujours.
    collabEligible:
      trustOfProvider(provider) !== 'sandboxed' &&
      bytes !== null &&
      bytes.byteLength <= PLUGIN_DOC_COLLAB_MAX_BYTES,
    epoch: item.wrappedUnderEpoch,
    profileId,
  });
  const collab = useVaultNoteCollab({
    enabled: roomEnabled,
    vaultId,
    itemId: item.id,
    epoch: item.wrappedUnderEpoch,
    profileId,
    role: myRole,
    memberLabel,
    memberId: cloudUser?.id ?? null,
    color: pickCollabColor(`${cloudUser?.id ?? ''}:${getDeviceSeed()}`),
  });
  /**
   * LA SALLE N'EST « VIVANTE » QU'UNE FOIS LE REJEU TERMINÉ — et c'est une
   * garde contre le DOUBLE, pas une coquetterie d'affichage.
   *
   * Un greffon sème la salle quand il la trouve VIDE au montage (c'est la règle,
   * et elle est juste). Mais une salle qui vient de s'ouvrir est vide TANT que
   * le relais n'a pas rejoué ce qu'elle contient — il n'y a pas de persistance
   * Yjs locale pour un document de coffre, donc le fragment reste vide pendant
   * toute la latence du canal. Monter le greffon sur `phase === 'live'` seul,
   * c'était lui faire verser le document déchiffré dans une salle habitée : le
   * CRDT ne perd rien, et le `.fdoc` rouvert se retrouvait EN DOUBLE, en entier.
   *
   * Attendre le canal SETTLED (`synced`, ou `offline` où l'on est seul par
   * construction — même arbitre que l'élection de l'enregistreur) coûte un
   * montage solo puis un remontage en salle ; en échange, « fragment vide »
   * prouve enfin une salle vide.
   */
  const collabSettled = collab.status === 'synced' || collab.status === 'offline';
  const collabLive = collab.phase === 'live' && collab.session !== null && collabSettled;
  /**
   * F23 — LE COFFRE A ÉTÉ GELÉ PENDANT QUE L'ÉDITEUR ÉTAIT OUVERT.
   *
   * Le relais le dit AVANT tout refus d'écriture : `POST /collab/token` répond
   * 200 avec `role: 'viewer'` sur un coffre gelé. Ici, l'enjeu est plus grand
   * qu'ailleurs — un greffon autosauve tout seul, toutes les deux secondes s'il
   * le veut, si bien qu'un gel non détecté produirait un chapelet d'échecs 409
   * `vault_frozen` sans qu'aucun humain n'ait rien demandé.
   *
   * `readOnly` n'est PAS repassé au greffon : il est lu une fois au montage
   * (`provider.mount`), et remonter le bac à sable coûterait le curseur et
   * l'état d'édition en cours. La garde qui compte est celle de l'HÔTE, dans
   * `doSave` — c'est déjà la discipline du `canEdit` d'origine : « readOnly
   * n'est pas un conseil donné au greffon ».
   */
  const mayWrite = canEdit && !collab.serverReadOnly;
  // Le save du greffon est capture par l'effet de MONTAGE : router par des refs
  // rafraichies a chaque rendu, sinon la closure figee embarquerait le roster
  // du montage (souvent vide) dans meta.editSession.participants.
  const collabSessionRef = useRef(collab.session);
  collabSessionRef.current = collab.session;
  const collabLiveRef = useRef(collabLive);
  collabLiveRef.current = collabLive;
  const collabStatusRef = useRef(collab.status);
  collabStatusRef.current = collab.status;
  const participantsRef = useRef(collab.participants);
  participantsRef.current = collab.participants;
  /** Une ouverture de modale = une session solo (hors salle). */
  const fallbackSessionIdRef = useRef<string>(crypto.randomUUID());

  // ── Le contenu ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let vivant = true;
    void downloadVaultItemContent(vaultId, item)
      .then((b) => {
        if (vivant) setBytes(b);
      })
      .catch(() => {
        if (vivant) setLoadError(true);
      });
    return () => {
      vivant = false;
    };
    // L'élément est figé à l'ouverture de la modale — comme l'éditeur de notes.
    // react-hooks/exhaustive-deps : règle absente de cette config CRA — dépendances volontairement réduites.
  }, [vaultId, item.id]);

  // ── Monter le greffon quand tout est prêt ──────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || bytes === null) return;
    // La salle en attente ne bloque pas : l'éditeur monte hors ligne et la
    // presence apparaîtra à la prochaine ouverture. Un remontage clefé sur
    // `collabLive` adopterait la salle — même règle que les notes.
    let disposed = false;
    let instance: EditorInstance | null = null;
    setMountError(null);
    setFatalError(null);
    setMounting(true);
    /**
     * L'APPEL EST DANS LA FONCTION ASYNC, PAS DANS `Promise.resolve(...)`.
     *
     * La nuance a coûté un écran entier. `Promise.resolve(provider.mount(…))`
     * évalue `mount` AVANT d'envelopper : un greffon qui jette SYNCHRONEMENT
     * (le cas réel : `getText('content')` sur un nom déjà pris par le
     * fragment, voir le greffon texte) traversait la fonction d'effet, donc
     * React, jusqu'à l'ErrorBoundary de la route — la page du coffre
     * disparaissait pour un fichier qu'on n'arrivait pas à ouvrir. Le
     * gestionnaire de rejet ci-dessous, lui, ne voyait jamais rien : il
     * n'attrape que les promesses.
     *
     * Dans une fonction `async`, un jet synchrone devient un rejet, et le
     * bandeau prévu pour ça (« mount_error ») fait enfin son travail : la
     * modale reste, le reste du coffre aussi.
     */
    void (async () =>
      provider.mount({
        container,
        fileName,
        readOnly: !canEdit,
        initialBytes: bytes,
        saveBytes: async (b) => {
          await doSaveRef.current(b, { origin: 'plugin' });
        },
        onDirty: (d) => {
          // Chaque « sale » compte : le succès d'une sauvegarde ne baisse le
          // drapeau que si la séquence n'a pas bougé entre-temps.
          if (d) dirtySeqRef.current += 1;
          setDirty(d);
        },
        onFatal: (message: string) => {
          if (!disposed) setFatalError(message || 'sandbox_fatal');
        },
        collab:
          collabLive && collab.session
            ? {
                doc: collab.session.doc,
                awareness: collab.session.awareness,
                phase: 'live',
                responsible: collab.responsible,
                // QUI SÈME, quand la salle est vraiment vide : un seul pair.
                // Deux greffons qui versent chacun leur copie du document, et
                // le CRDT — qui ne perd rien — garde les deux. Lu à l'INSTANT
                // du semis (ref rafraîchie à chaque rendu), pas au montage :
                // le scrutin dépend de la composition de la salle, qui bouge.
                maySeed: () => collabSessionRef.current?.isSeedResponsible() ?? true,
              }
            : undefined,
      }))().then(
      (inst) => {
        if (disposed) {
          inst.destroy();
          return;
        }
        instance = inst;
        instanceRef.current = inst;
        setMounting(false);
      },
      (e: unknown) => {
        // Un mount() qui jette laissait un cadre VIDE et muet — l'utilisateur
        // attendait un éditeur qui ne viendrait jamais. Il le sait maintenant.
        if (disposed) return;
        setMounting(false);
        setMountError(errorText(e) || 'mount_error');
      }
    );
    return () => {
      disposed = true;
      instance?.destroy();
      instanceRef.current = null;
    };
    // Remonter à l'entrée/sortie de salle : l'éditeur doit brancher ou
    // débrancher sa liaison CRDT, et seul un montage propre le garantit.
    // react-hooks/exhaustive-deps : règle absente de cette config CRA — dépendances volontairement réduites.
  }, [bytes, collabLive]);

  // « Untel ecrit… » depuis un greffon : PAS onDirty (tiptap onUpdate se
  // declenche aussi sur les transactions CRDT distantes et le rejeu — la salle
  // entiere semblerait ecrire). Le vrai signal local est le drapeau tr.local
  // des transactions Yjs du doc partage.
  useEffect(() => {
    const session = collab.session;
    if (!collabLive || !session) return undefined;
    const doc = session.doc;
    const handler = (tr: { local: boolean; changed: Map<unknown, unknown> }) => {
      if (tr.local && tr.changed.size > 0) collabSessionRef.current?.notifyTyping();
    };
    doc.on('afterTransaction', handler as never);
    return () => {
      try {
        doc.off('afterTransaction', handler as never);
      } catch {
        /* document deja detruit */
      }
    };
  }, [collabLive, collab.session]);

  /**
   * LA sauvegarde, sérialisée et consciente de son origine.
   *
   * Un greffon autosauve tout seul, toutes les deux secondes s'il le veut : ce
   * chemin doit donc être SÛR sans surveillance humaine — pas d'écrasement de
   * conflit, pas d'empilement, pas de toast toutes les deux secondes, pas de
   * rechargement du coffre à chaque frappe.
   */
  const doSave = async (b: Uint8Array, opts: { origin: SaveOrigin }) => {
    // readOnly n'est pas un conseil donné au greffon : c'est une garde d'hôte.
    // Elle porte AUSSI le gel (F23) : le relais nous a dégradés en lecteur, et un
    // greffon qui autosauve toutes les deux secondes empilerait sinon les 409.
    if (!mayWrite) throw new Error(SAVE_READ_ONLY);
    // Un conflit non arbitré fige les autosaves : SEULE la confirmation
    // d'écrasement (origine 'user') peut repasser.
    if (conflictPendingRef.current && opts.origin === 'plugin') {
      throw new Error(SAVE_CONFLICT);
    }
    if (inFlightRef.current) throw new Error(SAVE_IN_FLIGHT);
    inFlightRef.current = true;
    const dirtySeqAuDepart = dirtySeqRef.current;
    setSaving(true);
    try {
      // Session d'edition : meme discipline que l'editeur de notes — l'id de
      // salle n'est resolu que canal SETTLED, sinon session solo de la modale.
      const now = Date.now();
      const settled = collabStatusRef.current === 'synced' || collabStatusRef.current === 'offline';
      const session = collabSessionRef.current;
      const sessionId =
        collabLiveRef.current && session && settled
          ? resolveEditSessionId(session.getRoomEditSession(), now, () => crypto.randomUUID()).id
          : fallbackSessionIdRef.current;
      const updated = await dispatch(
        updateVaultItem({
          vaultId,
          itemId: item.id,
          expectedVersion: versionRef.current,
          meta: metaRef.current,
          editSession: buildEditSessionMeta(sessionId, participantsRef.current, now),
          content: b,
        })
      ).unwrap();
      if (collabLiveRef.current && session && settled) {
        session.publishRoomEditSession(sessionId, now);
      }
      versionRef.current = updated.item?.version ?? versionRef.current + 1;
      if (updated.item?.meta) metaRef.current = updated.item.meta;
      // Une frappe arrivée PENDANT l'aller-retour n'est pas enregistrée.
      if (dirtySeqRef.current === dirtySeqAuDepart) setDirty(false);
      setSaveFailed(false);
      if (opts.origin === 'user') {
        success(t('teamVaults.pluginEditor.saved'));
        pendingReloadRef.current = false;
        onSaved();
      } else {
        // Une autosave ne toaste pas et ne recharge pas le coffre : elle laisse
        // une trace discrète, et la liste se rafraîchit à la fermeture.
        setAutoSavedAt(Date.now());
        pendingReloadRef.current = true;
      }
    } catch (e) {
      if (isVaultItemConflict(e)) {
        /**
         * ON N'ADOPTE PAS serverVersion ICI. Le faire rendait la PROCHAINE
         * autosave — deux secondes plus tard, sans qu'un humain ait rien vu —
         * un écrasement réussi du travail d'un collègue. Le conflit reste
         * pendant jusqu'au geste explicite.
         */
        pendingServerVersionRef.current = e.serverVersion;
        conflictPendingRef.current = true;
        setConflictPending(true);
        error(t('teamVaults.pluginEditor.conflict'));
        throw new Error(SAVE_CONFLICT, { cause: e });
      }
      setSaveFailed(true);
      const cle = vaultErrorKey(errorText(e), 'teamVaults.errors.upload');
      error(t(cle));
      // Le greffon reçoit un identifiant STABLE, pas la phrase traduite.
      throw new Error(cle, { cause: e });
    } finally {
      inFlightRef.current = false;
      setSaving(false);
    }
  };

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  /** La sauvegarde DEMANDÉE : lit les octets courants du greffon puis pousse. */
  const runUserSave = () => {
    const inst = instanceRef.current;
    if (!inst) return;
    // Le pont bac à sable est asynchrone ; un getBytes REJETÉ (iframe morte)
    // doit se DIRE — un doSave échoué, lui, toaste déjà : deux .catch séparés.
    void Promise.resolve(inst.getBytes())
      .then((b) => doSaveRef.current(b, { origin: 'user' }).catch(() => {}))
      .catch(() => error(t('teamVaults.pluginEditor.sandboxUnavailable')));
  };

  /**
   * LE GESTE « ENREGISTRER », quel que soit son chemin — bouton OU Ctrl+S.
   *
   * IL DOIT EXISTER EN UN SEUL EXEMPLAIRE. La garde de conflit vivait dans le
   * `onClick` du bouton ; brancher Ctrl+S directement sur `runUserSave`
   * ouvrait une SECONDE porte vers la même écriture, celle-là sans la
   * confirmation d'écrasement — un raccourci clavier suffisait alors à
   * remplacer le travail d'un collègue sans que personne n'ait rien confirmé.
   */
  const demanderSauvegarde = () => {
    // Un conflit pendant ne s'écrase QUE sur confirmation — c'est le seul
    // geste qui adopte la version du serveur.
    if (conflictPendingRef.current) {
      setConfirmOverwrite(true);
      return;
    }
    runUserSave();
  };

  /** La fermeture réelle — c'est ici que le coffre encaisse les autosaves. */
  const finishClose = () => {
    if (pendingReloadRef.current) {
      pendingReloadRef.current = false;
      onSaved();
    }
    onClose();
  };

  /**
   * LE RENOMMAGE (P9-B3) — le titre de la barre est le nom de l'élément.
   *
   * TROIS PIÈGES, TOUS DÉSAMORCÉS ICI :
   *
   *  1. Il partage le verrou de la sauvegarde. `renameVaultItem` pousse la
   *     méta sous `expectedVersion` : concurrent d'un `updateVaultItem`, l'un
   *     des deux se prend un conflit de version pour rien.
   *  2. Il FAIT AVANCER la version de l'élément. Sans adopter celle que le
   *     serveur renvoie, la sauvegarde suivante — l'autosave, deux secondes
   *     plus tard — se croirait en conflit avec un collègue qui n'existe pas,
   *     et l'utilisateur devrait confirmer un écrasement de son propre travail.
   *  3. Il change `meta.fileName`. `metaRef` adopte la méta renvoyée, sinon la
   *     prochaine sauvegarde de contenu réécrirait l'ancien nom.
   *
   * Ce qu'il NE fait pas : remonter l'éditeur. Ni `item`, ni `bytes`, ni
   * `collabLive` ne bougent — la salle et le curseur survivent au renommage.
   */
  const renameTo = async (nextName: string) => {
    if (!mayWrite) return;
    if (nextName === displayName) return;
    if (conflictPendingRef.current) {
      error(t('teamVaults.pluginEditor.renameBlockedByConflict'));
      return;
    }
    if (inFlightRef.current) {
      error(t('teamVaults.pluginEditor.renameBusy'));
      return;
    }
    inFlightRef.current = true;
    setRenaming(true);
    setSaving(true);
    try {
      const { item: renomme } = await dispatch(
        renameVaultItem({ vaultId, itemId: item.id, name: nextName })
      ).unwrap();
      setDisplayName(nextName);
      if (renomme) {
        versionRef.current = renomme.version;
        metaRef.current = renomme.meta;
      }
      /**
       * `renomme` absent : le serveur a accepté sans rendre l'élément. On NE
       * conclut PAS qu'il n'a rien fait — une information manquante n'est pas
       * une information négative. On garde donc le nouveau nom à l'écran, on
       * laisse `versionRef` en arrière, et c'est le chemin de CONFLIT déjà
       * écrit qui arbitrera la prochaine sauvegarde, avec un humain dedans.
       */
      pendingReloadRef.current = true;
    } catch (e) {
      console.warn('[PluginEditorModal] rename failed:', e);
      error(t('teamVaults.pluginEditor.renameFailed'));
    } finally {
      inFlightRef.current = false;
      setSaving(false);
      setRenaming(false);
    }
  };

  const requestClose = () => {
    if (dirty && !collabLive) {
      setConfirmClose(true);
      return;
    }
    finishClose();
  };

  /**
   * L'état de la pastille. Un conflit non arbitré est un ÉCHEC : l'autosave
   * est gelée, et rien de ce qui est tapé depuis ne part vers le coffre.
   */
  const saveState: PluginEditorSaveState = saving
    ? 'saving'
    : conflictPending || saveFailed
      ? 'error'
      : dirty
        ? 'pending'
        : 'synced';

  const saveHint =
    saveState === 'synced' && autoSavedAt !== null
      ? t('teamVaults.pluginEditor.autoSavedAt', {
          time: new Date(autoSavedAt).toLocaleTimeString(),
        })
      : null;

  return (
    <>
      <Modal isOpen onClose={requestClose} size="full" ariaLabelledBy={titleId}>
        <PluginEditorShell
          titleId={titleId}
          fileName={displayName}
          onRenameTitle={mayWrite ? (next) => void renameTo(next) : undefined}
          renaming={renaming}
          onRequestClose={requestClose}
          saveState={saveState}
          saveHint={saveHint}
          onUserSave={mayWrite ? demanderSauvegarde : undefined}
          containerRef={containerRef}
          veil={
            loadError
              ? t('teamVaults.pluginEditor.loadFailed')
              : bytes === null
                ? t('common.loading')
                : null
          }
          veilIsError={loadError}
          banners={
            <>
              {bytes !== null && bytes.byteLength > PLUGIN_DOC_COLLAB_MAX_BYTES && (
                <p
                  className="plugin-editor-shell__banner plugin-editor-shell__banner--warning"
                  role="status"
                >
                  {t('teamVaults.pluginEditor.tooLargeForCollab')}
                </p>
              )}
              {mounting && (
                <p className="plugin-editor-shell__banner" role="status">
                  {t('teamVaults.pluginEditor.sandboxLoading')}
                </p>
              )}
              {/* Le message vient du GREFFON — texte brut React, jamais de
                  HTML : un bandeau d'erreur n'est pas une surface de rendu. */}
              {documentTooNew ? (
                /* Un refus de version n'est pas un crash : le dire autrement
                   évite d'apprendre à l'utilisateur que Filarr est cassé. */
                <p
                  className="plugin-editor-shell__banner plugin-editor-shell__banner--warning"
                  role="alert"
                >
                  {t('teamVaults.pluginEditor.documentTooNew')}
                </p>
              ) : (
                (mountError !== null || fatalError !== null) && (
                  <div
                    className="plugin-editor-shell__banner plugin-editor-shell__banner--error"
                    role="alert"
                  >
                    <p className="plugin-editor-shell__banner-title">
                      {t('teamVaults.pluginEditor.sandboxCrashed')}
                    </p>
                    <p className="plugin-editor-shell__banner-detail">{mountError ?? fatalError}</p>
                  </div>
                )
              )}
              {conflictPending && (
                <p
                  className="plugin-editor-shell__banner plugin-editor-shell__banner--warning"
                  role="alert"
                >
                  {t('teamVaults.pluginEditor.conflictPending')}
                </p>
              )}
            </>
          }
        >
          {collabLive && (
            <VaultCollabPresence
              participants={collab.participants}
              status={collab.status}
              responsible={collab.responsible}
            />
          )}
          {mayWrite && (
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={bytes === null}
              onClick={demanderSauvegarde}
            >
              {t('teamVaults.pluginEditor.save')}
            </Button>
          )}
        </PluginEditorShell>
      </Modal>

      <ConfirmModal
        isOpen={confirmClose}
        onClose={() => setConfirmClose(false)}
        onConfirm={finishClose}
        title={t('teamVaults.pluginEditor.unsavedTitle')}
        message={t('teamVaults.pluginEditor.unsavedBody')}
        confirmText={t('teamVaults.pluginEditor.discard')}
        variant="warning"
      />

      {/* L'ARBITRAGE du conflit : le SEUL endroit du fichier qui adopte la
          version du serveur, et il faut un humain pour l'atteindre. */}
      <ConfirmModal
        isOpen={confirmOverwrite}
        onClose={() => setConfirmOverwrite(false)}
        onConfirm={() => {
          setConfirmOverwrite(false);
          if (pendingServerVersionRef.current !== null) {
            versionRef.current = pendingServerVersionRef.current;
          }
          pendingServerVersionRef.current = null;
          conflictPendingRef.current = false;
          setConflictPending(false);
          runUserSave();
        }}
        title={t('teamVaults.pluginEditor.overwriteTitle')}
        message={t('teamVaults.pluginEditor.overwriteBody')}
        confirmText={t('teamVaults.pluginEditor.overwriteConfirm')}
        variant="danger"
      />
    </>
  );
};

export default PluginEditorModal;
