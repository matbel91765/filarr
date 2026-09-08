/**
 * VaultNoteEditor (E3-12) — open a team-vault NOTE and save it back, E2EE.
 *
 * Why not NoteEditor: that component is bound to a personal `Note` in notesSlice —
 * it dispatches setEditingNote / addTab, drives version history, autosave to the
 * local notes.db and the live collab session. A vault note has none of those (it
 * lives only as an encrypted item in the cloud, and its plaintext must never reach
 * the personal store or its exports). So we reuse the layer that already exists for
 * exactly this purpose: `buildSharedNoteExtensions()`, which derives from the SAME
 * schema source as NoteEditor (`extensions/schemaExtensions.ts`), global attributes
 * included — not a hand-copied mirror of it, which is what silently erased block
 * anchors, font size and spacing here. Mounted EDITABLE. Same document schema in and
 * out — a vault note round-trips through both editors unchanged — with none of the
 * personal-note plumbing attached.
 *
 * Saving goes through updateVaultItem: fresh K_item, chunks staged, commit guarded
 * by the version OF THE DOCUMENT ON SCREEN. Two rules make that guard real rather
 * than decorative:
 *
 *  · THE LOADED DOCUMENT IS THE UNIT. `loadedVersion` is set when a body is actually
 *    decrypted and mounted, and the editing surface is keyed on that load. It never
 *    follows the item's version through the list: a background refresh used to
 *    advance the version under a document that had not changed, which turned the
 *    next save into a silent overwrite of someone else's work — the exact thing the
 *    compare-and-set exists to prevent.
 *  · A REMOTE CHANGE IS ANNOUNCED, NEVER APPLIED. While the modal is open we do not
 *    reload — with or without unsaved edits. A newer version raises a banner; only
 *    an explicit click adopts it.
 *
 * On a conflict we keep the user's text on screen and OFFER a resolution: their
 * version can be inspected (decrypted locally from the item the 409 carried) before
 * anything is written. Never overwrite, never discard silently.
 *
 * ── LIVE ROOM (phase 2) ──────────────────────────────────────────────────────
 *
 * With the live-collaboration flag on, an unlocked vault and a note item, this
 * editor also joins a room addressed by (vaultId, itemId), keyed by K_vault at the
 * loaded revision's epoch — the same key it already holds to read the body, so every
 * member who can read the item can join, and nobody else. Yjs then owns the text: the
 * surface binds to the shared fragment instead of a static `content`, and the
 * decrypted body is only SEEDED into it when the room turns out to be empty and the
 * relay has confirmed it has nothing more to replay.
 *
 * The save path is where a shared room collides with everything above. All peers
 * converge on the same document, so all of them would save it — and all but the
 * first would take a 409 from the very compare-and-set that protects this file.
 * Exactly one peer writes, elected without negotiation (smallest client id among
 * those allowed to write; see services/collab/saveElection.ts). The others keep
 * typing and let the CRDT carry their text to the saver. A reader joins, is shown
 * as a reader, and never writes.
 *
 * That election only holds together because the COMMITTED VERSION travels with the
 * room. It is per-peer state that only the writer would otherwise see advance, so a
 * peer promoted after the writer leaves would open with a version several commits
 * stale and take a 409 on every attempt, forever. Each commit is announced to the
 * room and adopted by everyone (monotonically); see `adoptCommittedVersion`.
 *
 * Two notions of "changed" live here, and conflating them was a bug: `dirty` means
 * THE DOCUMENT changed (it drives the deferred write-back, and it must include the
 * other members' typing, since the elected peer saves the room's text, not its own),
 * while `unsaved` means WE typed something not yet committed (it drives the close
 * guards). In a room, a peer who is not the writer is never held back by someone
 * else's work: their text is already on its way to whoever holds the pen.
 *
 * Nothing above changes when the flag is off, the network is down, or the role is
 * read-only: the editor falls back to exactly the load/edit/save-button behaviour
 * described at the top, which is also what a peer does when it is not the saver.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { migrateLegacyImageNodes } from '../../../services/notes/legacyImageMigration';
import { useDispatch, useSelector } from 'react-redux';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Awareness } from 'y-protocols/awareness';
import type { XmlFragment, Doc as YDoc } from 'yjs';
import { Modal, ModalBody, ModalFooter, Button, Input, ConfirmModal } from '../ui';
import { useNotification } from '../ui/Notification';
import { buildSharedNoteExtensions } from '../notes/sharedNoteExtensions';
import { PERSONAL_ONLY_SLASH_IDS } from '../notes/slashCommandExtension';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import { buildCollabExtensions } from '../notes/collab/collabExtensions';
import { pickCollabColor, getDeviceSeed } from '../notes/collab/collabPresence';
import type { AppDispatch, RootState } from '../../../store';
import {
  updateVaultItem,
  downloadVaultItemContent,
  isVaultItemConflict,
  selectIsVaultUnlocked,
  type VaultItemConflict,
  type VaultItemSummary,
} from '../../../store/slices/vaultsSlice';
import { selectVaultMemberCount } from '../../../store/selectors/shareIndexSelectors';
import { decideCollabSettle } from '../notes/collab/collabWriteBack';
import type { CollabRole } from '../../../services/collab/saveElection';
import {
  loadKey,
  saveGuardVersion,
  shouldAnnounceNewerVersion,
  surfaceKey,
} from './vaultNoteEditorSync';
import {
  adoptCommittedVersion,
  commitCoversDocument,
  reconcileCommittedTitle,
  shouldOpenVaultRoom,
  shouldWriteBackVaultNote,
  vaultMemberLabel,
  vaultRoomSettled,
  VAULT_COLLAB_SAVE_DEBOUNCE_MS,
} from './vaultNoteCollab';
import { useVaultNoteCollab, useDebouncedCallback } from './useVaultNoteCollab';
import {
  vaultPaneAutoSaveCovers,
  vaultPaneOffersSave,
  vaultPaneSaveEnabled,
  vaultPaneSaveLabel,
  vaultPaneSaveState,
  vaultPaneWarnsDraftIsNowhere,
  type VaultPaneConflict,
} from './vaultPaneSaveState';
import { errorText } from '../../../services/vault/vaultErrorMessages';
import {
  classifyVaultSaveFailure,
  vaultSaveRetryDelay,
  vaultSaveRetryMayFire,
} from './vaultSaveFailure';
import { COMMENTS_SEED_ORIGIN } from '../../../services/collab/collabSession';
import {
  sanitizeCommentMap,
  commentsEqual,
  withoutTombstones,
  type VaultComment,
} from '../../../services/vault/vaultComments';
import { metaWithThreadStamp } from '../../../services/vault/threadStamp';
import { parseVaultNoteBody, serializeVaultNoteBody } from '../../../services/vault/vaultNoteBody';
import { findOrphanCommentIds } from '../../../services/notes/commentOrphans';
import { vaultMentionCandidates } from '../../../services/vault/mentionCandidates';
import { signalMentionsForItem } from '../../../services/vault/mentionSignal';
import type { MentionCandidatesProvider } from '../notes/extensions/mentionSuggestionExtension';
import { buildRecentEditsExtension } from '../notes/collab/recentEdits';
import { resolveEditSessionId, buildEditSessionMeta } from './vaultNoteCollab';
import { VaultCommentsPanel } from './VaultCommentsPanel';
import { VaultNoteConflict } from './VaultNoteConflict';
import { VaultCollabPresence } from './VaultCollabPresence';
import './VaultNoteEditor.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  vaultId: string;
  item: VaultItemSummary;
  /** False for a vault VIEWER — the server refuses their write too (403). */
  canEdit: boolean;
  /** Our exact role in this vault; drives the save election and the presence badge. */
  role?: string;
  /**
   * LE CADRE, ET RIEN QUE LE CADRE.
   *
   * `'modal'` (par défaut) : la fenêtre de l'explorateur de coffre, inchangée.
   * `'pane'` : le MÊME éditeur monté à plat dans le panneau d'édition de
   * l'onglet Notes, à la place de l'éditeur de note personnelle.
   *
   * Ce qui change est le contenant : un portail et un fond fixe d'un côté, un
   * bloc de flux de l'autre. Ce qui NE change pas est tout le reste — la salle,
   * l'élection d'enregistrement, le veto de lecture seule du relais, la
   * bannière de version plus récente, la garde de fermeture. C'était la
   * condition pour que la note d'un coffre s'ouvre dans l'onglet Notes sans
   * qu'un second éditeur « simplifié » naisse à côté du vrai : le seul moyen de
   * ne pas perdre ces quatre choses est de ne pas les réécrire.
   */
  variant?: 'modal' | 'pane';
  /**
   * Le chemin du RETOUR vers l'explorateur du coffre, en mode panneau. Absent,
   * le lien ne s'affiche pas — la modale, elle, est déjà DANS l'explorateur.
   */
  onOpenInVault?: () => void;
  /** Nom du coffre, pour que le retour dise où il mène. */
  vaultName?: string;
}

type LoadState = 'loading' | 'ready' | 'error' | 'unsupported';

/**
 * CE QUE L'HABILLAGE FOURNIT AU CONTENU — la frontière, écrite en trois champs.
 *
 * Elle est déclarée ici, hors du composant, pour qu'elle se lise comme un
 * CONTRAT et non comme un détail de rendu : tout ce qui diffère entre la fenêtre
 * de l'explorateur et le panneau de l'onglet Notes passe par ces trois lignes,
 * et rien d'autre. En ajouter une quatrième, ce serait rouvrir la porte au
 * `variant === 'pane' ? … : …` disséminé — c'est-à-dire à deux éditeurs qui
 * divergent sans que rien ne le signale.
 */
interface CorpsHabillage {
  /**
   * La boîte qui entoure la surface d'édition. La fenêtre la borne et la fait
   * défiler ; le panneau la laisse couler dans la page, comme une note
   * ordinaire.
   */
  classeSurface: string;
  /** Ce que le cadre pose entre les bandeaux et la surface. */
  avantSurface?: React.ReactNode;
  /** Ce qu'il pose entre la surface et les commentaires. */
  apresSurface?: React.ReactNode;
}

/** How long to wait for a verdict on the shared document before seeding it. */
const COLLAB_SEED_TIMEOUT_MS = 4000;

/** Parse a decrypted body into a ProseMirror doc, or null if it isn't one. */
function parseNoteDoc(bytes: Uint8Array): unknown | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || (parsed as { type?: string }).type !== 'doc') {
      return null;
    }
    // Une note de coffre peut venir d'un import, elle aussi (cf.
    // legacyImageMigration) : meme rattrapage, meme raison.
    return migrateLegacyImageNodes(parsed).doc;
  } catch {
    return null;
  }
}

/** What binds the surface to a shared document instead of a static one. */
interface CollabMount {
  fragment: XmlFragment;
  awareness: Awareness;
  /** Le Y.Doc de la salle — recentEdits lit ses state-vectors. */
  doc: YDoc;
  user: { name: string; color: string };
  /** The decrypted body, seeded into the room only if it turns out to be empty. */
  seed: unknown;
  /** Tells the seeding logic whether the relay has finished replaying. */
  status: 'connecting' | 'connected' | 'synced' | 'offline' | 'denied';
  /** Are we the peer elected to seed an empty room? See CollabSession.isSeedResponsible. */
  maySeed: () => boolean;
  /** Temps 2 : le semis des COMMENTAIRES accompagne celui du corps —
   *  uniquement si la carte est encore vide (mêmes règles, même arbitre). */
  commentsEmpty: () => boolean;
  seedComments: () => void;
}

/** Les gestes de marque que le parent pilote (poser/retirer un ancrage). */
export interface SurfaceCommands {
  setCommentMark: (id: string) => void;
  removeCommentMark: (id: string) => void;
  /**
   * Le curseur au DÉBUT DU CORPS — ce que fait Entrée depuis le titre, comme
   * dans l'éditeur ordinaire. Le parent ne tient pas l'instance tiptap : sans ce
   * geste exposé, il ne lui restait qu'à laisser le saut de ligne entrer dans le
   * titre.
   */
  focusStart: () => void;
  /**
   * Remplace le document MONTÉ. `content` est une valeur INITIALE pour tiptap :
   * sans ce geste, adopter le résultat d'une fusion demanderait de remonter la
   * surface — ce qui, en salle vivante, la ferait quitter et rejoindre la salle.
   * L'événement de mise à jour est tu : ce document vient d'être commité, le
   * signaler comme une frappe rallumerait « non enregistré » sur du travail déjà
   * écrit et relancerait un enregistrement à vide.
   */
  replaceDocument: (doc: unknown) => void;
}

/**
 * The inner editor, remounted per loaded document (same trick as VersionRender).
 *
 * With `collab`, the extensions bind to the shared Yjs fragment and `content` is
 * ignored by tiptap — so the decrypted body has to be pushed in explicitly, and
 * ONLY when the room is provably empty. Seeding a room that is merely slow to
 * replay duplicates the whole note: the CRDT never drops anything, so our copy
 * and the replayed one both survive, one after the other. `decideCollabSettle`
 * is the shared referee for that, reused verbatim from the personal editor.
 */
const VaultNoteEditorSurface: React.FC<{
  doc: unknown;
  editable: boolean;
  /**
   * Le texte du bloc vide, DÉJÀ traduit. Absent sur les surfaces d'APERÇU (la
   * version serveur montrée pendant un conflit) : elles ne se remplissent pas,
   * et leur proposer d'écrire serait un mensonge d'interface.
   */
  placeholder?: string;
  collab?: CollabMount | null;
  /** `local` is false for a change that arrived through the CRDT (someone else typing). */
  onChange?: (local: boolean) => void;
  onReady?: (getJSON: () => unknown, commands?: SurfaceCommands) => void;
  /** La salle a rendu son verdict de semis — le rejeu est terminé. */
  onSettled?: () => void;
  /** Qui l'on peut mentionner sous « @ » — absent en aperçu et en lecture seule. */
  mentionCandidates?: MentionCandidatesProvider;
}> = ({ doc, editable, placeholder, collab, onChange, onReady, onSettled, mentionCandidates }) => {
  // Seeding state, declared before the editor because the update handler reads it.
  const seededRef = useRef(false);
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const editor = useEditor({
    extensions: [
      // Yjs brings its own undo stack; leaving ProseMirror's on would make
      // Ctrl+Z undo the other members' typing.
      ...buildSharedNoteExtensions({
        ...(collab ? { starterKit: { undoRedo: false } } : {}),
        /**
         * LE MENU « / » ET SES VOISINS, dans un coffre partagé.
         *
         * Ils viennent du module que monte AUSSI NoteEditor : rien n'est
         * recopié ici, et une commande ajoutée là-bas apparaît ici sans que
         * personne n'y pense. C'est la même leçon que le schéma partagé, un an
         * plus tard — deux listes tenues à la main divergent, et la divergence
         * ne se voit pas à la compilation.
         *
         * DEUX RETRAITS, ET ILS SONT DÉLIBÉRÉS :
         *
         *  · les commandes qui visent l'espace personnel
         *    (`PERSONAL_ONLY_SLASH_IDS`) sont écartées. Un `[[` posé ici
         *    résoudrait vers une note du DISQUE de cette machine, et scellerait
         *    son identifiant dans un document que d'autres membres liront : un
         *    lien qui, chez eux, ne mène nulle part. C'est le pendant exact de
         *    la règle qui tient les notes de coffre hors de la recherche, du
         *    graphe et des modèles — le mélange est aussi fautif dans ce sens ;
         *  · rien d'autre n'est retiré. Tableaux, bases, mathématiques,
         *    mermaid, colonnes, dépliants, notes de bas de page : ils étaient
         *    DÉJÀ dans le schéma partagé, et n'attendaient qu'un moyen d'être
         *    insérés.
         *
         * Une surface d'APERÇU (la version serveur d'un conflit) n'en reçoit
         * aucun : sans `placeholder`, pas d'interactivité.
         */
        ...(placeholder
          ? {
              interactive: {
                placeholder,
                excludeSlashIds: PERSONAL_ONLY_SLASH_IDS,
                // « @ » propose les membres de CE coffre (lot 2 des @mentions).
                ...(mentionCandidates ? { mentionCandidates } : {}),
              },
            }
          : {}),
      }),
      ...buildCollabExtensions(
        collab
          ? { fragment: collab.fragment, awareness: collab.awareness, user: collab.user }
          : null
      ),
      // Le sillage des modifications distantes — gate anti-rejeu sur le settle
      // de CETTE surface (seededRef), jamais sur un etat du parent.
      ...(collab
        ? [
            buildRecentEditsExtension({
              doc: collab.doc,
              awareness: collab.awareness,
              isReady: () => seededRef.current,
            }),
          ]
        : []),
    ],
    content: collab ? undefined : (doc as never),
    editable,
    onUpdate: ({ transaction }) => {
      // In a room, the relay's replay arrives as ProseMirror transactions too.
      // Reporting those as a change would mark the note dirty on arrival, and
      // the elected peer would save a document nobody edited — bumping the
      // version and raising a "newer version" banner for every other member.
      // Anything before the room has settled is the replay, not a human.
      if (collabRef.current && !seededRef.current) return;
      // Yjs-originated transactions are the OTHER members typing. They still
      // change the document (the elected peer must save them), but they are not
      // OUR unsaved work, and they must not hold this window open on close.
      onChangeRef.current?.(!collabRef.current || !isChangeOrigin(transaction));
    },
  });

  useEffect(() => {
    if (editor && onReady) {
      onReady(() => editor.getJSON(), {
        setCommentMark: (id) => editor.chain().focus().setComment(id).run(),
        removeCommentMark: (id) => editor.commands.removeCommentById(id),
        focusStart: () => editor.commands.focus('start'),
        replaceDocument: (next) => {
          editor.commands.setContent(next as never, { emitUpdate: false });
        },
      });
    }
  }, [editor, onReady]);

  // Seeding, once. Everything it reads lives in a ref or is captured per run, so
  // a status change re-evaluates without rebuilding the editor.
  const status = collab?.status ?? null;

  useEffect(() => {
    const mount = collabRef.current;
    if (!editor || !mount || seededRef.current || status === null) return undefined;

    let disposed = false;
    let timedOut = false;

    const evaluate = () => {
      if (disposed || seededRef.current) return;
      const decision = decideCollabSettle({
        status: mount.status,
        fragmentEmpty: mount.fragment.length === 0,
        // No IndexedDB persistence for a vault room (its plaintext must not be
        // written locally), so there is never a local reload to wait for.
        docLoaded: true,
        timedOut,
      });
      if (decision === 'wait') return;
      // Only ONE peer pours the decrypted body into an empty room; the others
      // wait for it to reach them. Two seeders would duplicate the note, since
      // the CRDT keeps both copies. The timeout is the escape hatch: if the
      // elected seeder never delivers, everyone eventually seeds rather than
      // stare at a blank note.
      if (decision === 'seed' && !timedOut && !mount.maySeed()) return;
      seededRef.current = true;
      // Le verdict est rendu : tout ce qui arrive ensuite est une frappe, pas
      // le rejeu — le parent peut armer son observateur de commentaires.
      onSettledRef.current?.();
      if (decision !== 'seed') return;
      const body = mount.seed;
      if (!body || typeof body !== 'object') return;
      editor.commands.setContent(body as never, { emitUpdate: false });
      // Les commentaires suivent le corps, sous les MÊMES gardes : seulement
      // par le semeur élu, seulement dans une carte VIDE — verser dans une
      // salle simplement lente ressusciterait des commentaires supprimés
      // depuis (le corps semé est une photo ancienne).
      if (mount.commentsEmpty()) mount.seedComments();
    };

    const onDocUpdate = () => evaluate();
    mount.fragment.observeDeep(onDocUpdate);
    const timer = setTimeout(() => {
      timedOut = true;
      evaluate();
    }, COLLAB_SEED_TIMEOUT_MS);
    evaluate();

    return () => {
      disposed = true;
      clearTimeout(timer);
      try {
        mount.fragment.unobserveDeep(onDocUpdate);
      } catch {
        /* document already destroyed */
      }
    };
  }, [editor, status]);

  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  return (
    <div className="vault-note-editor__surface">
      <EditorContent editor={editor} />
    </div>
  );
};

export const VaultNoteEditor: React.FC<Props> = ({
  isOpen,
  onClose,
  vaultId,
  item,
  canEdit,
  role,
  variant = 'modal',
  onOpenInVault,
  vaultName,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error, warning } = useNotification();

  const [state, setState] = useState<LoadState>('loading');
  const [doc, setDoc] = useState<unknown>(null);
  const [title, setTitle] = useState('');
  /**
   * LE TITRE QUE LE COFFRE DÉTIENT, tel qu'on le sait — rogné, jamais traduit.
   *
   * Le titre n'est pas dans le document partagé : il part dans les métadonnées
   * de l'élément avec celui qui commite. C'est donc la SEULE façon de savoir si
   * notre renommage est parti ou s'il attend encore, et tout ce qui en dépend
   * (le badge, la garde de sortie) se lit dessus. Une référence et non un état,
   * comme `loadedVersionRef` : chacune de ses mutations s'accompagne d'un
   * `setState` dans le même geste, donc un rendu la suit toujours.
   */
  const baseTitleRef = useRef('');
  /** Le même titre, lisible depuis les rappels de salle (qui ne re-rendent pas). */
  const titleRef = useRef('');
  titleRef.current = title;
  // THE DOCUMENT changed since the last committed save — including through the
  // CRDT. Drives the deferred write-back, because the elected peer saves the
  // ROOM's text, not merely its own.
  const [dirty, setDirty] = useState(false);
  // WE have work that is not in the vault yet. Drives the close guards only. In
  // a room this is deliberately narrower than `dirty`: another member's typing
  // is already on its way to whoever holds the pen, and must not keep this
  // window from closing.
  const [unsaved, setUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * COMBIEN DE FOIS LE DOCUMENT A CHANGÉ — et combien de fois par NOUS.
   *
   * Un enregistrement de coffre dure : déclaration de révision, envoi des
   * morceaux chiffrés, rescellement des accès, commit. Ce qui change entre la
   * sérialisation et le succès n'est PAS dans ce qui vient d'être écrit ; baisser
   * `dirty` dessus déclarerait sauvé ce qui ne l'est pas, et plus rien ne
   * repartirait. On compare donc des séquences (voir `commitCoversDocument`),
   * jamais des contenus — c'est déjà le service que rend `dirtySeqRef` dans
   * l'éditeur de greffons.
   */
  const docSeqRef = useRef(0);
  const localSeqRef = useRef(0);
  // Version of the document ACTUALLY on screen — the optimistic-concurrency guard.
  // Set when a body is decrypted and mounted, when we commit, and when the room
  // announces someone else's commit — never from a list refresh.
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  // Same value, readable from callbacks that must not close over a stale render.
  const loadedVersionRef = useRef<number | null>(null);
  loadedVersionRef.current = loadedVersion;
  // Bumped once per successful load; keys the surface so a reload really remounts it
  // (tiptap's `content` is initial-only — reusing the key would keep the old text).
  const [docToken, setDocToken] = useState(0);
  // The epoch of K_vault the mounted body was sealed under — what the room is
  // keyed on. Set on the same beat as `loadedVersion` because both describe the
  // document ON SCREEN, never whatever the item list currently reports.
  const [loadedEpoch, setLoadedEpoch] = useState<number | null>(null);
  // Explicit user-driven reload trigger. The load effect keys on THIS, not on the
  // item's version, so a background list refresh can never swap the text.
  const [reloadNonce, setReloadNonce] = useState(0);
  const [conflict, setConflict] = useState<VaultItemConflict | null>(null);
  /**
   * NOTRE VERSION, TELLE QUE LE SERVEUR L'A REFUSÉE — capturée au moment de la
   * sérialisation, pas au moment où le 409 revient. En salle vivante le document
   * continue de bouger pendant l'envoi : arbitrer sur l'écran d'aujourd'hui
   * plutôt que sur le texte réellement rejeté ferait comparer deux choses qui ne
   * se sont jamais opposées.
   */
  const [conflictMine, setConflictMine] = useState<{ title: string; doc: unknown } | null>(null);
  const sentDocRef = useRef<{ title: string; doc: unknown } | null>(null);
  /**
   * Le corps que le coffre détient, déchiffré depuis l'élément que le 409
   * portait (E3-12 : le Worker le renvoie avec le conflit, précisément pour que
   * cette décision ne coûte aucun aller-retour de plus). Il est chargé D'OFFICE :
   * sans lui il n'y a pas de face-à-face, et il n'y a rien à décider sans voir.
   */
  const [serverBody, setServerBody] = useState<{
    status: 'loading' | 'ready' | 'error';
    doc?: unknown;
    comments?: Record<string, VaultComment>;
  }>({ status: 'loading' });
  const getJSONRef = useRef<(() => unknown) | null>(null);
  // ── Commentaires (Temps 2) ──────────────────────────────────────────────
  // Miroir local de la verite : en solo c'est LA verite ; en salle vivante,
  // la Y.Map fait foi et ce state la reflete via l'observateur.
  const [comments, setComments] = useState<Record<string, VaultComment>>({});
  const commentsRef = useRef(comments);
  commentsRef.current = comments;
  /** Dernier instantane connu — la garde « rien n'a change » de l'observateur. */
  const lastCommentsRef = useRef<Record<string, VaultComment>>({});
  /** Verdict de settle rendu par la surface — avant lui, tout est du rejeu. */
  const commentsSettledRef = useRef(false);
  /** Un balayage d'orphelins en cours : ses transactions ne sont pas une frappe. */
  const sweepingRef = useRef(false);
  const surfaceCommandsRef = useRef<SurfaceCommands | null>(null);
  const [pendingComment, setPendingComment] = useState<{ id: string; draft: string } | null>(null);
  const docRef = useRef<unknown>(null);
  // The item object is rebuilt on every list update; keep it in a ref so the load
  // effect reads the freshest one WITHOUT re-firing when it changes.
  const itemRef = useRef(item);
  itemRef.current = item;

  const untitled = t('teamVaults.items.untitled');

  // ONE dependency for the load effect, computed by loadKey(): the load identity
  // lives in a single tested place, and widening it (adding item.version, say) is
  // exactly the bug that turned a background refresh into a silent overwrite.
  const currentLoadKey = loadKey({ isOpen, vaultId, itemId: item.id, reloadNonce });

  // Load + decrypt the body on open, and on an explicit reload. downloadVaultItemContent
  // returns bytes out-of-band (never through Redux), so no plaintext transits the
  // action pipeline.
  useEffect(() => {
    if (!isOpen) return;
    const current = itemRef.current;
    let cancelled = false;
    setState('loading');
    setDirty(false);
    setUnsaved(false);
    setConflict(null);
    setConflictMine(null);
    setServerBody({ status: 'loading' });
    // Drop the room identity first: a reload must not leave the previous
    // epoch's key in play while the new body is on its way.
    setLoadedEpoch(null);
    // Et la capture de sortie de salle avec : elle décrit un texte que ce
    // chargement vient précisément de remplacer. L'estampille suffirait, mais
    // l'invalider ici dit l'intention plutôt que de s'en remettre à un compteur.
    liveExitDocRef.current = null;
    setTitle(current.meta.title || '');
    // Le titre CHARGÉ est la référence : à partir d'ici, « différent » veut dire
    // « retouché par nous, et pas encore écrit ».
    titleRef.current = current.meta.title || '';
    baseTitleRef.current = (current.meta.title || '').trim();
    setComments({});
    lastCommentsRef.current = {};
    commentsSettledRef.current = false;
    setPendingComment(null);
    downloadVaultItemContent(vaultId, current)
      .then((bytes) => {
        if (cancelled) return;
        // L'enveloppe accepte le doc nu (format historique) ET
        // filarr.note+comments v1 — voir vaultNoteBody.ts.
        const body = parseVaultNoteBody(bytes);
        if (body === null) {
          // Not a ProseMirror document — refuse to edit rather than round-trip it
          // through a schema it never had (that would rewrite the stored format).
          setState('unsupported');
          return;
        }
        const parsed = body.doc;
        setComments(body.comments);
        lastCommentsRef.current = body.comments;
        setDoc(parsed);
        // The version — and the epoch the room is keyed on — belong to THIS body,
        // not to whatever the list holds now.
        setLoadedVersion(current.version);
        loadedVersionRef.current = current.version;
        setLoadedEpoch(current.wrappedUnderEpoch);
        setDocToken((n) => n + 1);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
    // Deliberately NOT keyed on item.version: a refresh that advances it must not
    // reload the document (see the header). Only opening, switching item, or an
    // explicit reload re-runs this — all of which currentLoadKey already carries,
    // which is why isOpen/vaultId are not repeated here.
  }, [currentLoadKey]);

  const onReady = useMemo(
    () => (getJSON: () => unknown, commands?: SurfaceCommands) => {
      getJSONRef.current = getJSON;
      surfaceCommandsRef.current = commands ?? null;
      // BALAYAGE D'ORPHELINS — SOLO UNIQUEMENT : en salle, il retirerait la
      // marque « pending » d'un AUTRE pair (posee, texte pas encore valide).
      // Les tombstones sont EXCLUS du dictionnaire passe : leur marque doit
      // precisement etre balayee (sinon surlignage fantome permanent).
      if (!collabLiveRef.current && commands) {
        const orphans = findOrphanCommentIds(
          docRef.current,
          withoutTombstones(commentsRef.current),
          []
        );
        if (orphans.length > 0) {
          sweepingRef.current = true;
          try {
            for (const id of orphans) commands.removeCommentMark(id);
          } finally {
            sweepingRef.current = false;
          }
        }
      }
    },
    []
  );

  // ── Live room ──────────────────────────────────────────────────────────────

  const vaultUnlocked = useSelector((s: RootState) => selectIsVaultUnlocked(s, vaultId));
  /**
   * L'EFFECTIF DU COFFRE, tel que `GET /vaults/heads` l'annonce.
   *
   * Il n'ouvre aucune salle. Il sert quand la salle NE S'OUVRE PAS : c'est la
   * seule preuve de solitude qui arrive par une autre voie que le relais —
   * celle-là même par laquelle un autre membre enregistrerait. Voir
   * `loneVaultSaverEligible`.
   */
  const memberCount = useSelector((s: RootState) => selectVaultMemberCount(s, vaultId));
  const profileId = useSelector(
    (s: RootState) => s.profiles?.manifest?.activeProfileId || s.profiles?.activeProfileId || null
  );
  const cloudUser = useSelector((s: RootState) => s.auth?.cloudUser ?? null);
  // Les membres de CE coffre, pour le menu « @ » de la surface (lot 2 des
  // @mentions). Jamais soi-même ; cache par coffre, lisible hors ligne.
  const mentionCandidates = useCallback(
    (query: string) => vaultMentionCandidates(vaultId, query, cloudUser?.id ?? null),
    [vaultId, cloudUser?.id]
  );
  const profileName = useSelector((s: RootState) => s.auth?.localProfile?.name ?? null);

  // Our role, in one place. `canEdit` stays the coarse gate the browser passes;
  // the exact role is what the election needs (and what other members see).
  const myRole: CollabRole = useMemo(() => {
    if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') return role;
    return canEdit ? 'member' : 'viewer';
  }, [role, canEdit]);

  const memberLabel = useMemo(
    () =>
      vaultMemberLabel({
        email: cloudUser?.email,
        profileName,
        userId: cloudUser?.id,
      }),
    [cloudUser?.email, cloudUser?.id, profileName]
  );

  // The room key comes from the LOADED body's epoch, and from no other: the same
  // discipline as `loadedVersion`. Reading it off the item in the list would key
  // the room on an epoch whose text is not the one on screen.
  const roomEnabled = shouldOpenVaultRoom({
    bodyReady: state === 'ready',
    vaultUnlocked,
    collabEligible: item.itemType === 'note',
    epoch: loadedEpoch,
    profileId,
  });

  const collab = useVaultNoteCollab({
    enabled: roomEnabled,
    vaultId,
    itemId: item.id,
    epoch: loadedEpoch ?? 0,
    profileId,
    role: myRole,
    memberLabel,
    memberId: cloudUser?.id ?? null,
    color: pickCollabColor(`${cloudUser?.id ?? ''}:${getDeviceSeed()}`),
    memberCount,
  });

  const collabLive = collab.phase === 'live' && collab.session !== null;
  /**
   * Le serveur a REFUSÉ la salle : on n'est plus membre de ce coffre.
   *
   * C'est le seul état où l'on sait, de source sûre, que l'enregistrement
   * échouera. Le taire laissait la personne taper et cliquer « Enregistrer »
   * jusqu'au 403 — sans jamais lui dire de mettre son texte à l'abri.
   */
  const accessRevoked = collab.status === 'denied';

  /**
   * F23 — LE COFFRE A ÉTÉ GELÉ PENDANT QU'ON ÉCRIVAIT.
   *
   * `POST /collab/token` répond alors 200 avec `role: 'viewer'` : la salle reste
   * ouverte (on lit, on voit les curseurs) et cesse de relayer nos écritures.
   * C'est le signal le plus précoce dont dispose un éditeur déjà ouvert — le
   * résumé Redux, lui, n'apprendra le gel qu'au prochain `loadVaults`, et une
   * tentative d'enregistrement mettrait six secondes de plus pour récolter son
   * 409 `vault_frozen`. On passe donc en lecture seule SUR CE SIGNAL, sans
   * attendre un refus.
   *
   * `mayWrite` remplace `canEdit` partout où un geste ÉCRIT, et nulle part
   * ailleurs : `canEdit` reste ce que notre RÔLE permet — c'est lui qui décide
   * du rôle publié dans la salle et du texte affiché à un lecteur — tandis que
   * `mayWrite` dit ce que cette session peut faire à cet instant. Un gel se
   * lève ; une rétrogradation, non.
   */
  const roomReadOnly = collab.serverReadOnly;
  const mayWrite = canEdit && !roomReadOnly;

  // ADOPTING WHAT THE ROOM COMMITTED. The guard version is a fact about the item,
  // not about this peer: whoever writes announces it, everyone takes it. Without
  // this, only the writer's guard ever moves, and the next peer to be elected is
  // stuck on a 409 it can never resolve. The rule (monotonic, never a downgrade)
  // lives in `adoptCommittedVersion`.
  const collabSession = collab.session;
  useEffect(() => {
    if (!collabSession) return undefined;
    return collabSession.onCommittedVersion((announced, announcedTitle) => {
      const next = adoptCommittedVersion(loadedVersionRef.current, announced);
      if (next === loadedVersionRef.current) return;
      loadedVersionRef.current = next;
      setLoadedVersion(next);
      /**
       * UN COMMIT NE DÉCLARE PROPRE QUE CE QU'IL A ÉCRIT.
       *
       * Le CORPS, oui : le CRDT l'a porté au sauveur avant son commit, donc ce
       * qui vient d'être écrit contient nos frappes. LE TITRE, NON — il n'est
       * pas dans le document partagé, il part dans les métadonnées avec celui
       * qui commite. Baisser `dirty` sans regarder, c'était afficher la pastille
       * verte « Enregistré dans le coffre » à quelqu'un dont le renommage venait
       * d'être écrasé par le titre d'un autre : une perte de texte que l'écran
       * démentait. La règle vit dans `reconcileCommittedTitle`, éprouvée à part.
       */
      const titre = reconcileCommittedTitle({
        localTitle: titleRef.current.trim(),
        baseTitle: baseTitleRef.current,
        committedTitle: announcedTitle,
      });
      if (titre.adopt !== null) {
        // On n'avait rien retouché : adopter le titre écrit est le seul moyen de
        // ne pas le réécrire par-dessus au prochain enregistrement.
        setTitle(titre.adopt);
        titleRef.current = titre.adopt;
      }
      if (titre.stillPending) return;
      baseTitleRef.current = titre.adopt ?? titleRef.current.trim();
      setDirty(false);
      setUnsaved(false);
    });
  }, [collabSession]);

  // ── Commentaires : l'observateur de la carte partagee ──────────────────────
  //
  // GARDE COMME LE CORPS : rien n'est signale avant le verdict de settle de la
  // surface (le rejeu du journal remplit la Y.Map — le signaler ferait
  // committer un document que personne n'a edite : version+1, K_item neuf,
  // rescellement des grants, banniere chez tous). Le SEMIS porte son origine
  // dediee et n'est jamais une frappe. Et avant de marquer dirty, la carte est
  // comparee au dernier instantane — ceinture et bretelles.
  useEffect(() => {
    if (!collabSession) return undefined;
    commentsSettledRef.current = false;
    const off = collabSession.onComments(({ local, origin }) => {
      const next = sanitizeCommentMap(collabSession.getCommentsJSON());
      setComments(next);
      if (origin === COMMENTS_SEED_ORIGIN || !commentsSettledRef.current) {
        lastCommentsRef.current = next;
        return;
      }
      if (commentsEqual(next, lastCommentsRef.current)) return;
      lastCommentsRef.current = next;
      // Meme partage dirty/unsaved que handleDocChange : le commentaire d'un
      // AUTRE membre est a sauver (l'elu ecrit la salle) mais ne retient pas
      // NOTRE fenetre.
      docSeqRef.current += 1;
      setDirty(true);
      if (local) {
        localSeqRef.current += 1;
        setUnsaved(true);
      }
      if (collabLiveRef.current) scheduleAutoSaveRef.current?.();
    });
    return off;
  }, [collabSession]);

  // ── La reprise après une coupure ───────────────────────────────────────────

  /**
   * COMBIEN DE FOIS DE SUITE L'ENVOI N'A RENCONTRÉ PERSONNE.
   *
   * Une RÉFÉRENCE et non un état : elle est lue et incrémentée dans le `catch`
   * d'un envoi, après plusieurs `await` — la valeur figée au rendu où l'envoi
   * est parti serait celle d'avant la coupure. Remise à zéro par tout envoi qui
   * aboutit, et par tout échec qui n'est PAS une coupure : compter un refus de
   * plan avec les pannes de réseau ferait renoncer la reprise sur la première
   * vraie coupure venue.
   */
  const repriseEchecsRef = useRef(0);
  /**
   * UN MINUTEUR DE REPRISE COURT EN CE MOMENT — le fait dont le badge répond.
   *
   * Même discipline que `autoSave.armed` : c'est un ÉTAT de rendu, parce que le
   * panneau doit changer de phrase quand il retombe. Sans lui, l'écran aurait
   * annoncé « reprise dès le retour du réseau » à partir d'un
   * `navigator.onLine` — c'est-à-dire à partir de rien.
   */
  const [repriseArmee, setRepriseArmee] = useState(false);
  const repriseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const annulerReprise = useCallback(() => {
    if (repriseTimerRef.current !== null) {
      clearTimeout(repriseTimerRef.current);
      repriseTimerRef.current = null;
    }
    setRepriseArmee(false);
  }, []);

  /**
   * ARMER LA REPRISE — posée plus bas, appelée depuis l'envoi qui vient
   * d'échouer. La référence casse la boucle : l'envoi a besoin de la reprise,
   * la reprise a besoin de l'envoi.
   */
  const armerRepriseRef = useRef<(echecs: number) => void>(() => {});

  /**
   * `navigator.onLine`, LU AVEC DES PINCETTES.
   *
   * Il n'entre nulle part comme preuve : la preuve est l'envoi qui a échoué.
   * Il est passé au classement pour trancher les seuls motifs qu'AUCUNE table
   * ne sait lire, et `null` quand on ne peut pas le lire du tout — sur un rendu
   * hors navigateur, par exemple.
   */
  const lireOnLine = (): boolean | null =>
    typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean'
      ? null
      : navigator.onLine;

  // ── Saving ─────────────────────────────────────────────────────────────────

  /**
   * `close: false` is the collaborative write-back: it must leave the modal open
   * and the room untouched. The manual button keeps the original behaviour of
   * closing on success.
   *
   * `override` EST LA PORTE DE LA FUSION, et la seule. Le document qui part
   * n'est alors plus celui de la surface mais le résultat arbitré — commité
   * contre la version qu'on VIENT DE LIRE (celle du 409), jamais forcé. Tout le
   * reste du chemin est identique, y compris le rattrapage d'un nouveau 409 :
   * un troisième enregistrement arrivé entre-temps rouvre l'écran sur les
   * nouvelles données au lieu d'écraser en silence.
   */
  const doSave = async (
    expectedVersion: number,
    options: {
      close?: boolean;
      override?: {
        doc: unknown;
        title: string;
        comments: Record<string, VaultComment>;
        /** Les métadonnées SUR LESQUELLES on se rebase — celles du serveur. */
        metaBase: VaultItemSummary['meta'];
      };
    } = {}
    /** Vrai si le commit a abouti — ce que la garde de sortie doit savoir avant
     *  de laisser partir : un 409 pris en quittant jetterait le texte. */
  ): Promise<boolean> => {
    const override = options.override;
    if (!getJSONRef.current && !override) return false;
    setSaving(true);
    /**
     * L'INSTANTANÉ DES SÉQUENCES, PRIS AVANT LA SÉRIALISATION — et rien
     * d'asynchrone ne s'intercale d'ici au `dispatch`, donc il décrit
     * EXACTEMENT le document qui part.
     */
    const docSeqSent = docSeqRef.current;
    const localSeqSent = localSeqRef.current;
    /** Le titre QUI PART — la référence des pairs et la nôtre, une fois écrit. */
    const titleSent = (override ? override.title : title).trim();
    try {
      // L'elu serialise les commentaires DE LA SALLE, pas les siens ; en solo,
      // le state local est la verite. Doc nu si aucun commentaire (compat).
      const savedComments = override
        ? override.comments
        : collabLiveRef.current && collabSessionRef.current
          ? sanitizeCommentMap(collabSessionRef.current.getCommentsJSON())
          : commentsRef.current;
      /**
       * LE DOCUMENT QUI PART, RETENU. C'est LUI que l'écran de conflit oppose à
       * celui du coffre si le commit est refusé : en salle vivante le texte
       * continue de bouger pendant l'envoi, et arbitrer sur l'écran d'aujourd'hui
       * ferait comparer deux versions qui ne se sont jamais opposées.
       */
      const sentDoc = override ? override.doc : getJSONRef.current!();
      sentDocRef.current = { title: titleSent, doc: sentDoc };
      /**
       * SESSION D'EDITION (confort phase 3). L'id de salle n'est resolu que
       * quand le canal est SETTLED (synced/offline) — avant le rejeu, la carte
       * peut etre vide et un mint concurrent scinderait le groupe (meme
       * discipline que shouldWriteBackVaultNote.settled). Sinon : session solo
       * de CETTE ouverture de modale.
       */
      const now = Date.now();
      // Même arbitre que l'élection : une salle hors ligne n'a rien rejoué, sa
      // carte peut être vide, et on repart alors sur la session solo.
      const settled = vaultRoomSettled(collabStatusRef.current);
      const session = collabSessionRef.current;
      const sessionId =
        collabLiveRef.current && session && settled
          ? resolveEditSessionId(session.getRoomEditSession(), now, () => crypto.randomUUID()).id
          : fallbackSessionIdRef.current;
      await dispatch(
        updateVaultItem({
          vaultId,
          itemId: item.id,
          expectedVersion,
          /**
           * LE TAMPON DU FIL voyage avec la méta (`services/vault/threadStamp`).
           * Une note porte ses commentaires DANS son corps : sans ce résumé,
           * une liste devrait déchiffrer chaque note pour dire « 2 ouverts ».
           * Il décrit `savedComments` — ce qui part, pas ce qui est à l'écran.
           */
          meta: metaWithThreadStamp(
            { ...(override ? override.metaBase : item.meta), title: titleSent || untitled },
            savedComments
          ),
          editSession: buildEditSessionMeta(sessionId, participantsRef.current, now),
          content: serializeVaultNoteBody(sentDoc, savedComments),
        })
      ).unwrap();
      // PRÉVENIR LES PERSONNES NOMMÉES — après le commit, jamais avant : on ne
      // sonne personne au sujet d'un texte qui n'est pas encore enregistré.
      // Silencieux et non attendu : prévenir est un bonus, pas une condition
      // de l'enregistrement (voir mentionSignal).
      void signalMentionsForItem(vaultId, item.id, sentDoc);
      // Publier l'id APRES le commit reussi : les sauveurs suivants groupent
      // leurs revisions avec la notre.
      if (collabLiveRef.current && session && settled) {
        session.publishRoomEditSession(sessionId, now);
      }
      lastCommentsRef.current = savedComments;
      // L'ENVOI EST PASSÉ : la série de coupures est close, minuteur compris.
      // Le laisser courir aurait refait partir un envoi que celui-ci vient de
      // rendre inutile, et le badge aurait continué d'annoncer une reprise.
      repriseEchecsRef.current = 0;
      annulerReprise();
      // Le titre est désormais celui du coffre : c'est LUI que « ai-je un
      // renommage en attente ? » compare, ici comme chez les autres pairs.
      baseTitleRef.current = titleSent;
      /**
       * CE QUI A ÉTÉ ÉCRIT NE COUVRE PAS FORCÉMENT CE QUI EST À L'ÉCRAN. En
       * salle vivante c'est même le cas ordinaire : l'élu enregistre le texte de
       * la salle pendant que la salle continue de taper. Déclarer « tout est
       * sauvé » perdrait ces frappes-là — aucun enregistrement automatique ne
       * repartirait, et la garde de fermeture laisserait partir du travail.
       */
      const covered = commitCoversDocument(docSeqSent, docSeqRef.current);
      const mineCovered = commitCoversDocument(localSeqSent, localSeqRef.current);
      setDirty(!covered);
      setUnsaved(!mineCovered);
      // Et on relance la cadence : le minuteur armé par la frappe arrivée
      // PENDANT l'envoi a pu se déclencher et se faire opposer `saving`.
      if (!covered && collabLiveRef.current) scheduleAutoSaveRef.current?.();
      setConflict(null);
      setConflictMine(null);
      setLoadedVersion(expectedVersion + 1);
      loadedVersionRef.current = expectedVersion + 1;
      // ANNOUNCE THE COMMIT TO THE ROOM. Without this the guard version only
      // ever advances here, and the next peer to be elected writes with a stale
      // one — a 409 it can never get out of. `loadedEpoch` is deliberately NOT
      // advanced: the room is keyed on the vault key, which a save does not
      // touch (see collabKeys.ts).
      // Le TITRE voyage avec la version : sans lui, un pair ne peut pas
      // distinguer « mon renommage est parti » de « mon renommage a été
      // écrasé », et se déclarait propre dans les deux cas.
      collab.session?.publishCommittedVersion(expectedVersion + 1, titleSent);
      /**
       * LA FUSION DEVIENT LE TEXTE À L'ÉCRAN, une fois écrite et pas avant.
       *
       * L'ordre n'est pas un détail : remplacer le document AVANT le commit
       * laisserait, sur un nouveau 409, une surface portant un texte que
       * personne n'a accepté — et en salle vivante ce texte serait déjà parti
       * chez les autres membres. Après le commit, en revanche, il EST la
       * vérité du coffre, et la salle doit l'adopter comme telle : le premier
       * pair qui enregistrerait ensuite y réécrirait sinon l'ancien texte.
       */
      if (override) {
        setDoc(override.doc);
        docRef.current = override.doc;
        setTitle(titleSent);
        titleRef.current = titleSent;
        setComments(override.comments);
        surfaceCommandsRef.current?.replaceDocument(override.doc);
      }
      if (options.close === false) return true;
      success(t('teamVaults.noteEditor.saved'));
      onClose();
      return true;
    } catch (e) {
      if (isVaultItemConflict(e)) {
        // Someone saved first. Keep the user's text exactly where it is and let
        // them choose — nothing is written until they do. In a live room this
        // means the writer was OUTSIDE the room (an older client, another
        // session): peers in the room never race each other, one of them saves.
        setConflict(e);
        // NOTRE version est celle qui vient d'être refusée, pas celle de l'écran.
        setConflictMine(sentDocRef.current);
        // LE SERVEUR A RÉPONDU — donc pas de coupure, et surtout pas de reprise
        // silencieuse : l'écran d'arbitrage bloc par bloc porte le geste, et une
        // reprise qui renverrait la même version périmée ne récolterait qu'un
        // second 409, sans écran pour le dire.
        repriseEchecsRef.current = 0;
        annulerReprise();
        return false;
      }
      /**
       * UNE COUPURE N'EST PAS UN REFUS, et jusqu'ici les deux tombaient dans la
       * même phrase : « impossible d'enregistrer cette note, rien n'a été
       * modifié dans le coffre ». Littéralement vrai hors ligne, et faux de
       * sens — le coffre n'a rien refusé, il n'a pas été atteint ; le texte est
       * intact ; et une reprise allait de toute façon avoir lieu.
       *
       * LA PREUVE EST L'ENVOI, PAS LE NAVIGATEUR : `classifyVaultSaveFailure`
       * lit d'abord le motif que le thunk a canonisé (`network_unavailable` =
       * une requête revenue sans réponse), et ne consulte `navigator.onLine`
       * que pour trancher un motif qu'aucune table ne sait lire.
       */
      const echec = classifyVaultSaveFailure({ reason: errorText(e), onLine: lireOnLine() });
      if (echec === 'unreachable') {
        const echecs = repriseEchecsRef.current + 1;
        repriseEchecsRef.current = echecs;
        armerRepriseRef.current(echecs);
        // UNE SEULE FOIS, au premier échec : la reprise est silencieuse par
        // construction, et répéter la même phrase à chaque palier ferait lire
        // une panne aggravée là où il ne se passe rien de nouveau.
        if (echecs === 1) warning(t('teamVaults.noteEditor.pane.offlineSave'));
        return false;
      }
      // LE COFFRE A RÉPONDU : la série de coupures est close, et une reprise
      // silencieuse contre une décision ne ferait que la rejouer.
      repriseEchecsRef.current = 0;
      annulerReprise();
      error(
        echec === 'epoch'
          ? t('teamVaults.errors.conflict')
          : echec === 'read-only'
            ? t('teamVaults.noteEditor.readOnly')
            : t('teamVaults.errors.save')
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  // The write-back, debounced, and fired ONLY by the elected peer. Every input
  // it reads goes through a ref so the scheduled callback always sees the
  // current state rather than the state at scheduling time.
  const autoSaveInputRef = useRef({
    responsible: false,
    dirty: false,
    saving: false,
    hasConflict: false,
    guardVersion: null as number | null,
    settled: false,
    loneSaver: false,
    serverReadOnly: false,
  });
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  /**
   * LA PORTE DE LA REPRISE — les quatre raisons de ne pas repartir.
   *
   * Elle est réévaluée AU MOMENT DE TIRER, jamais au moment d'armer : deux
   * minutes séparent parfois les deux, et tout a pu changer entre-temps — le
   * coffre gelé, l'accès révoqué, un conflit ouvert par une autre voie, ou
   * simplement un document redevenu propre parce que la salle l'a écrit. Une
   * reprise qui partirait quand même n'obtiendrait qu'un refus, et le badge
   * aurait promis pour rien.
   *
   * ET ELLE NE FORCE JAMAIS : c'est `guardVersion` — la version du document À
   * L'ÉCRAN — qui part, comme pour tout autre envoi. Si quelqu'un a écrit
   * pendant la coupure, la reprise récolte un 409 ordinaire et l'écran
   * d'arbitrage bloc par bloc s'ouvre. Jamais d'écriture par-dessus.
   */
  const porteDeRepriseRef = useRef<() => void>(() => {});
  porteDeRepriseRef.current = () => {
    const input = autoSaveInputRef.current;
    if (
      !vaultSaveRetryMayFire({
        open: state === 'ready',
        mayWrite: mayWrite && !accessRevoked && !roomReadOnly,
        hasConflict: conflict !== null,
        guardVersion: input.guardVersion,
        saving,
        dirty,
      })
    ) {
      // Plus rien à reprendre, ou plus le droit : on ARRÊTE NET, sans compter
      // cette non-tentative comme un échec de plus.
      repriseEchecsRef.current = 0;
      annulerReprise();
      return;
    }
    if (input.guardVersion === null) return;
    void doSaveRef.current(input.guardVersion, { close: false });
  };

  /**
   * Le minuteur de reprise. `null` en retour de `vaultSaveRetryDelay` veut dire
   * que la borne est atteinte : on n'arme plus rien, et le badge redescend de
   * lui-même à « rien ne les enregistrera tout seul », bouton compris. Une
   * promesse qui expire vaut mieux qu'une promesse qui dure.
   */
  const armerReprise = useCallback(
    (echecs: number) => {
      if (repriseTimerRef.current !== null) {
        clearTimeout(repriseTimerRef.current);
        repriseTimerRef.current = null;
      }
      const delai = vaultSaveRetryDelay(echecs);
      if (delai === null) {
        setRepriseArmee(false);
        return;
      }
      setRepriseArmee(true);
      repriseTimerRef.current = setTimeout(() => {
        repriseTimerRef.current = null;
        // Désarmé AVANT de tirer : ce qui suit peut réarmer (un nouvel échec de
        // réseau le fait), et l'ordre inverse effacerait ce réarmement.
        setRepriseArmee(false);
        porteDeRepriseRef.current();
      }, delai);
    },
    [setRepriseArmee]
  );
  armerRepriseRef.current = armerReprise;

  /**
   * LE RETOUR DU RÉSEAU N'ATTEND PAS LE PALIER.
   *
   * `online` est le meilleur indice qu'on puisse recevoir, et il ne sert QU'À
   * ÇA : avancer une tentative déjà prévue. Il n'en crée aucune — sans échec
   * préalable il n'y a rien en attente, et sans reprise armée la borne est
   * atteinte et on a renoncé exprès. Un navigateur qui se croit revenu à tort
   * ne provoque donc qu'un envoi de plus, qui échouera et reprogrammera le
   * palier suivant : pas de boucle.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return undefined;
    }
    const auRetour = () => {
      if (repriseTimerRef.current === null) return;
      clearTimeout(repriseTimerRef.current);
      repriseTimerRef.current = null;
      setRepriseArmee(false);
      porteDeRepriseRef.current();
    };
    window.addEventListener('online', auRetour);
    return () => window.removeEventListener('online', auRetour);
  }, []);

  /**
   * L'ARRÊT NET. Le panneau démonte à la fermeture de la note ET au
   * verrouillage du coffre (`VaultNotePane` rend alors son cadre d'attente) :
   * un minuteur qui survivrait à ça écrirait dans un coffre qu'on vient de
   * fermer à clé, plusieurs minutes après que l'écran a disparu.
   */
  useEffect(() => {
    return () => {
      if (repriseTimerRef.current !== null) {
        clearTimeout(repriseTimerRef.current);
        repriseTimerRef.current = null;
      }
    };
  }, []);

  const autoSave = useDebouncedCallback(() => {
    const input = autoSaveInputRef.current;
    if (
      !shouldWriteBackVaultNote({
        responsible: input.responsible,
        localRole: myRole,
        dirty: input.dirty,
        saving: input.saving,
        hasConflict: input.hasConflict,
        guardVersion: input.guardVersion,
        settled: input.settled,
        // Le relais nous a dégradés en lecteur (coffre gelé, F23) : sans ce
        // veto, le pair élu retenterait un enregistrement toutes les six
        // secondes jusqu'à un 409 `vault_frozen`, sur un état normal.
        serverReadOnly: input.serverReadOnly,
      })
    ) {
      return;
    }
    if (input.guardVersion === null) return;
    void doSaveRef.current(input.guardVersion, { close: false });
  }, VAULT_COLLAB_SAVE_DEBOUNCE_MS);

  /**
   * LE CORPS DU COFFRE, DÉCHIFFRÉ D'OFFICE dès qu'un conflit s'ouvre — plus « sur
   * demande ». L'écran de fusion ne peut rien montrer sans lui, et faire cliquer
   * pour voir ce qu'on s'apprête à écraser, c'était laisser trancher à l'aveugle.
   *
   * L'effet est clefé sur l'IDENTITÉ du corps visé (élément + version), jamais
   * sur l'objet de conflit : celui-ci est reconstruit à chaque rendu, et s'y fier
   * relancerait un téléchargement à chaque frappe.
   */
  const serverItemRef = useRef(conflict?.serverItem ?? null);
  serverItemRef.current = conflict?.serverItem ?? null;
  const serverBodyKey =
    conflict && conflict.serverItem && conflict.serverVersion !== null
      ? `${conflict.serverItem.id}:${conflict.serverVersion}`
      : null;

  useEffect(() => {
    const serverItem = serverItemRef.current;
    if (serverBodyKey === null || !serverItem) return undefined;
    let cancelled = false;
    setServerBody({ status: 'loading' });
    downloadVaultItemContent(vaultId, serverItem)
      .then((bytes) => {
        if (cancelled) return;
        const body = parseVaultNoteBody(bytes);
        setServerBody(
          body === null
            ? { status: 'error' }
            : { status: 'ready', doc: body.doc, comments: body.comments }
        );
      })
      .catch(() => {
        if (!cancelled) setServerBody({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [serverBodyKey, vaultId]);

  /** Adopt what the server holds: re-read it from scratch, dropping this draft. */
  const reloadFromServer = () => {
    setConflict(null);
    setConflictMine(null);
    setReloadNonce((n) => n + 1);
  };

  /**
   * LE CANAL A-T-IL MONTRÉ LA SALLE ? Une seule réponse vaut oui, et le défaut
   * qu'elle ferme est en tête de `vaultRoomSettled` : « hors ligne » ne prouve
   * rien sur les autres membres d'un coffre, qui atteignent l'API par une tout
   * autre voie. Ce booléen commande l'enregistrement automatique — donc, en
   * dernier ressort, le nombre de 409 que deux personnes se renvoient.
   */
  const collabSettled = vaultRoomSettled(collab.status);

  // A newer version landed in the list while we were editing (someone else's save,
  // picked up by a refresh). Announce it; the text on screen stays exactly as it is.
  //
  // SILENT IN A CONVERGING ROOM, and that is not a shortcut. Inside a room that
  // has actually replayed, the newer version is the one the room itself just
  // produced — the elected peer saved the text every member is already looking at.
  // Showing "another member saved a newer version, load it?" would fire on every
  // write-back, for everyone but the saver, and offer to reload a document that is
  // already identical (which would also re-key the room). A save from OUTSIDE the
  // room still surfaces, at the moment it matters: the elected peer's next write
  // takes the 409 and the conflict UI opens.
  //
  // OUVERTE NE SUFFIT PAS, et c'est la nuance qui manquait : une salle hors ligne
  // ne fait converger personne. C'est même exactement le cas où l'autre membre
  // enregistre sans que rien ne nous parvienne — taire l'avis là, c'était faire
  // apprendre la nouvelle version par un 409 plutôt que par un bandeau.
  const roomConverging = collabLive && collabSettled;
  const remoteIsNewer = shouldAnnounceNewerVersion({
    ready: state === 'ready',
    roomConverging,
    loadedVersion,
    remoteVersion: item.version,
    hasConflict: conflict !== null,
  });
  // The save is guarded by the version of the DOCUMENT ON SCREEN, never by what the
  // list currently reports for this item.
  const guardVersion = saveGuardVersion({ loadedVersion });

  // Everything the debounced write-back needs, refreshed on every render so the
  // timer that fires in six seconds reads today's answer, not the one that was
  // true when the user stopped typing.
  autoSaveInputRef.current = {
    responsible: collab.responsible,
    dirty,
    saving,
    hasConflict: conflict !== null,
    guardVersion,
    settled: collabSettled,
    /**
     * `settled` reste ce que LA SALLE a prouvé, et rien d'autre. Le pair isolé
     * entre par une porte séparée, pour que les deux raisons d'écrire restent
     * lisibles à la lecture : « la salle m'a montré que je suis l'élu » et
     * « il n'existe personne d'autre pour écrire cet objet, le serveur le dit ».
     */
    loneSaver: collab.loneSaver,
    serverReadOnly: collab.serverReadOnly,
  };

  const collabLiveRef = useRef(collabLive);
  collabLiveRef.current = collabLive;
  const collabSessionRef = useRef(collabSession);
  collabSessionRef.current = collabSession;
  docRef.current = doc;
  const collabStatusRef = useRef(collab.status);
  collabStatusRef.current = collab.status;
  const participantsRef = useRef(collab.participants);
  participantsRef.current = collab.participants;
  /** Une ouverture de modale = une session solo (hors salle). */
  const fallbackSessionIdRef = useRef<string>(crypto.randomUUID());

  /**
   * Le corps à monter quand on RETOMBE hors salle vivante.
   *
   * La surface est clefée sur `collabLive` : elle est donc remontée à la sortie,
   * et elle l'était sur `doc` — le corps déchiffré AU MOMENT DE L'OUVERTURE. Or
   * une salle de coffre ne persiste rien localement : dix minutes de frappe
   * collective disparaissaient de l'écran sans un mot, et comme `dirty` restait
   * vrai, un clic sur « Enregistrer » réécrivait ensuite le texte revenu en
   * arrière PAR-DESSUS le travail de la salle.
   *
   * Il suffit de trois choses pour y tomber, dont deux qu'on ne provoque pas
   * soi-même : le réglage de collaboration basculé dans un autre onglet, le
   * coffre verrouillé par un rafraîchissement de liste, ou l'époque du corps
   * redevenue nulle.
   *
   * On garde donc le DERNIER état connu de la surface et on repart de lui.
   *
   * ESTAMPILLÉ, PARCE QU'UN CORPS CAPTURÉ NE DOIT SURVIVRE À AUCUN RECHARGEMENT
   * DÉLIBÉRÉ. « Adopter la version du serveur » relit tout depuis zéro ; sans
   * estampille, la capture d'une sortie de salle antérieure repassait par-dessus
   * le corps fraîchement téléchargé, et l'écran affichait l'ancien texte sous un
   * bouton qui venait de promettre le contraire.
   */
  const liveExitDocRef = useRef<{ doc: unknown; token: number } | null>(null);
  const wasLiveRef = useRef(collabLive);
  // La détection se fait PENDANT LE RENDU, et pas dans un effet : la surface est
  // clefée sur `collabLive`, donc elle est remontée dans le même commit que le
  // changement d'état — un effet, même de mise en page, s'exécuterait après, et
  // le corps d'origine serait déjà à l'écran.
  if (wasLiveRef.current && !collabLive) {
    try {
      const capture = getJSONRef.current?.() ?? null;
      liveExitDocRef.current = capture === null ? null : { doc: capture, token: docToken };
    } catch {
      liveExitDocRef.current = null; // surface déjà démontée : on garde le corps chargé
    }
  } else if (collabLive) {
    liveExitDocRef.current = null;
  }
  wasLiveRef.current = collabLive;
  const scheduleAutoSave = autoSave.schedule;
  const scheduleAutoSaveRef = useRef(scheduleAutoSave);
  scheduleAutoSaveRef.current = scheduleAutoSave;

  /**
   * A change in the surface. In a live room this ALSO fires for other members'
   * typing (their updates arrive as ProseMirror transactions), and that is the
   * point: the elected peer saves the room's text, not merely its own — hence
   * `dirty` for every change. `unsaved` is the narrower half: only what WE typed
   * can hold this window open, or a peer who never touched the note would be
   * kept from closing it by someone else's keystrokes.
   */
  const handleDocChange = useCallback(
    (local: boolean) => {
      docSeqRef.current += 1;
      setDirty(true);
      // Le balayage d'orphelins retire des marques : un changement a sauver,
      // jamais NOTRE travail — il ne piege pas la fermeture de la fenetre.
      if (local && !sweepingRef.current) {
        localSeqRef.current += 1;
        setUnsaved(true);
      }
      // « Untel ecrit… » : JAMAIS sur local === false — l'echo des frappes
      // distantes ferait apparaitre toute la salle en train d'ecrire.
      if (local && !sweepingRef.current && collabLiveRef.current) {
        collabSessionRef.current?.notifyTyping();
      }
      if (collabLiveRef.current) scheduleAutoSave();
    },
    [scheduleAutoSave]
  );

  // ── Operations sur les commentaires ────────────────────────────────────────
  // En salle : ecrire la Y.Map (l'observateur fait le reste). En solo : le
  // state local + dirty/unsaved. Toujours l'objet ENTIER (LWW au grain de la cle).
  const applyComment = useCallback((c: VaultComment) => {
    if (collabLiveRef.current && collabSessionRef.current) {
      collabSessionRef.current.setComment(c);
      return;
    }
    setComments((prev) => {
      const next = { ...prev, [c.id]: c };
      lastCommentsRef.current = next;
      return next;
    });
    docSeqRef.current += 1;
    localSeqRef.current += 1;
    setDirty(true);
    setUnsaved(true);
  }, []);

  const newComment = useCallback(
    (id: string, parentId: string | null, text: string): VaultComment => ({
      id,
      parentId,
      text,
      authorName: memberLabel,
      authorId: cloudUser?.id ?? null,
      createdAt: new Date().toISOString(),
      resolved: false,
    }),
    [memberLabel, cloudUser?.id]
  );

  const startComment = () => {
    const id = crypto.randomUUID();
    // La marque est DEJA dans le schema du coffre (CommentExtension via
    // buildSharedNoteExtensions) — on la pose sur la selection courante.
    surfaceCommandsRef.current?.setCommentMark(id);
    setPendingComment({ id, draft: '' });
  };

  const confirmComment = () => {
    const pending = pendingComment;
    if (!pending) return;
    const text = pending.draft.trim();
    if (!text) return;
    applyComment(newComment(pending.id, null, text));
    setPendingComment(null);
  };

  const cancelComment = () => {
    const pending = pendingComment;
    if (!pending) return;
    sweepingRef.current = true;
    try {
      surfaceCommandsRef.current?.removeCommentMark(pending.id);
    } finally {
      sweepingRef.current = false;
    }
    setPendingComment(null);
  };

  const replyComment = useCallback(
    (parentId: string, text: string) => {
      applyComment(newComment(crypto.randomUUID(), parentId, text));
    },
    [applyComment, newComment]
  );

  const resolveComment = useCallback(
    (id: string) => {
      const current = commentsRef.current[id];
      if (current) applyComment({ ...current, resolved: true });
    },
    [applyComment]
  );

  const deleteComment = useCallback(
    (id: string) => {
      const current = commentsRef.current[id];
      if (!current) return;
      // TOMBSTONE, jamais un retrait de cle — la fusion et le semis en dependent.
      applyComment({ ...current, deleted: true });
      sweepingRef.current = true;
      try {
        surfaceCommandsRef.current?.removeCommentMark(id);
      } finally {
        sweepingRef.current = false;
      }
    },
    [applyComment]
  );

  /**
   * LE DERNIER ENREGISTREMENT SUR LE CHEMIN DE LA SORTIE — vrai s'il est parti.
   *
   * Closing a live room is not "discard": the text has already reached the other
   * members, and a vault room keeps NOTHING locally. If we are the peer that
   * writes, we push one last save on the way out rather than leave the room's
   * work unwritten — the remaining peers would re-elect, but a LAST peer closing
   * would take everything with it.
   *
   * LE MÊME VETO QU'À LA CADENCE, et pas une liste parallèle. Celle qui était
   * écrite ici en oubliait trois : le conflit non résolu (on renvoyait la même
   * version périmée, donc un second 409, cette fois sans écran pour le dire), la
   * lecture seule rendue par le relais, et la salle non stabilisée. Deux sorties
   * du même écran ne peuvent pas avoir deux politiques d'écriture.
   */
  const pousserDernierEnregistrement = (): boolean => {
    const input = autoSaveInputRef.current;
    if (
      !collabLiveRef.current ||
      !shouldWriteBackVaultNote({ ...input, localRole: myRole }) ||
      input.guardVersion === null
    ) {
      return false;
    }
    autoSave.cancel();
    void doSave(input.guardVersion, { close: false });
    return true;
  };

  /**
   * LA SORTIE A ÉTÉ TRAITÉE PAR UN GESTE — le démontage n'a plus à la rattraper.
   *
   * Sans cette marque, le filet de démontage (voir plus bas) rejouerait un
   * enregistrement que la sortie vient de pousser, ou écrirait derrière une
   * personne qui a explicitement choisi de partir sans enregistrer.
   */
  const sortieTraiteeRef = useRef(false);

  const handleClose = () => {
    if (saving) return;
    sortieTraiteeRef.current = true;
    pousserDernierEnregistrement();
    onClose();
  };

  /**
   * LE FILET DE DÉMONTAGE — la seule garde qui tienne quand personne n'a cliqué.
   *
   * AUCUNE SORTIE NE DOIT JETER DU TEXTE NON ENREGISTRÉ EN SILENCE, et toutes ne
   * passent pas par un bouton : le coffre qu'on verrouille pendant l'édition
   * démonte ce panneau (`VaultNotePane` rend alors son cadre d'attente), une
   * navigation ailleurs dans l'application aussi, et un changement d'onglet de
   * même. Or le démontage ANNULE le minuteur (`useDebouncedCallback`) : même en
   * « enregistrement pris en charge », les six secondes n'aboutissaient pas.
   *
   * On pousse donc une dernière écriture, dans cet ordre : d'abord celle de la
   * SALLE (si nous tenons le stylo, tout son travail part avec nous), sinon la
   * nôtre, si le coffre l'accepte encore. Ce qu'aucun filet ne peut couvrir est
   * dit franchement : une fermeture brutale de la fenêtre tue le rendu avant que
   * la requête n'aboutisse, et rien ici ne le rattrape.
   *
   * INERTE SUR UN MONTAGE NEUF, et c'est ce qui le rend compatible avec le
   * double montage de `React.StrictMode` (l'application entière y est enveloppée
   * en développement) : rien n'est en attente à la seconde où l'on arrive, donc
   * le nettoyage joué à vide n'écrit rien.
   */
  const filetDeSortieRef = useRef<() => void>(() => {});
  filetDeSortieRef.current = () => {
    // Un geste de sortie s'en est déjà chargé — ou a explicitement choisi de
    // partir sans enregistrer. Réécrire par-dessus serait décider à sa place.
    if (sortieTraiteeRef.current) return;
    if (pousserDernierEnregistrement()) return;
    if (!unsaved || saving) return;
    const input = autoSaveInputRef.current;
    // Hors salle, l'écriture différée n'existe pas : c'est ici, et nulle part
    // ailleurs, que le texte d'un rédacteur isolé part avant que l'écran ne
    // disparaisse. Les vetos restent ceux du bouton — un coffre gelé, une
    // révocation ou un conflit ouvert ne récolteraient qu'un refus.
    if (!mayWrite || accessRevoked || conflict !== null || input.guardVersion === null) return;
    autoSave.cancel();
    void doSave(input.guardVersion, { close: false });
  };
  useEffect(() => () => filetDeSortieRef.current(), []);

  /**
   * LA MÊME POLITIQUE POUR TOUTES LES SORTIES DU PANNEAU.
   *
   * Le retour « ← nom du coffre » appelait `onOpenInVault` en direct : hors
   * salle, un clic jetait le texte sans un mot, alors que la fenêtre gardait la
   * même donnée sur son fond et sur Échap. Deux sorties d'un même écran ne
   * peuvent pas avoir deux politiques d'écriture — celle-ci vaut donc pour le
   * retour comme pour la fermeture : on écrit si quelque chose peut écrire,
   * sinon ON DEMANDE, et on ne part jamais en silence.
   */
  const [exitPrompt, setExitPrompt] = useState<{ suite: () => void } | null>(null);

  const quitterPanneau = (suite: () => void) => {
    if (saving) return;
    if (pousserDernierEnregistrement() || !unsaved) {
      sortieTraiteeRef.current = true;
      suite();
      return;
    }
    setExitPrompt({ suite });
  };

  /**
   * LE TITRE — UN SEUL GESTE, DEUX PRÉSENTATIONS.
   *
   * La fenêtre le pose en champ de formulaire étiqueté « Titre » ; le panneau le
   * pose en grand, en tête du document, comme l'éditeur de notes ordinaire. Ce
   * qui ne peut PAS différer, c'est ce que taper un titre déclenche — d'où cette
   * fonction, appelée par les deux habillages.
   */
  const handleTitleChange = (value: string) => {
    /**
     * UN TITRE N'A PAS DE LIGNES. Le panneau le pose dans un `<textarea>` (il
     * grandit avec son texte) : une touche Entrée y insère un saut de ligne, et
     * un collage en apporte autant qu'il en contient. `title.trim()` ne rogne
     * que les bords, si bien que le reste partait tel quel dans `meta.title` —
     * jusque dans la liste du coffre et dans le titre de la fenêtre. La touche
     * est interceptée à la saisie (voir `onKeyDown`) ; ceci ferme le collage,
     * que l'interception ne voit pas.
     */
    const propre = value.replace(/[\r\n]+/g, ' ');
    setTitle(propre);
    titleRef.current = propre;
    // Le titre n'est pas dans le CRDT mais il PART avec le commit : il compte
    // donc dans la séquence, sans quoi un titre retouché pendant un envoi serait
    // déclaré enregistré. Et le retaper EST notre propre travail en attente,
    // qu'aucune salle ne portera à notre place — les deux compteurs montent.
    docSeqRef.current += 1;
    localSeqRef.current += 1;
    setDirty(true);
    setUnsaved(true);
    /**
     * ET IL ARME LA CADENCE, COMME LE CORPS. Sans cette ligne, renommer une note
     * sans toucher au texte montait `dirty` et ne lançait AUCUN minuteur : le
     * badge annonçait « enregistrement pris en charge » (il lisait la capacité,
     * pas le déclencheur) et rien n'écrivait jamais. Les deux moitiés du défaut
     * sont fermées ensemble — ici le minuteur, et dans `vaultPaneAutoSaveCovers`
     * le fait `autoSaveArmed`, pour qu'un oubli du même genre dégrade vers le
     * bouton au lieu de mentir.
     */
    if (collabLiveRef.current) scheduleAutoSave();
  };

  /**
   * Le titre du panneau grandit avec son texte — même procédé que `NoteEditor`
   * (`titleRef`), parce qu'un `<textarea>` d'une ligne écrête un titre long sans
   * le dire.
   */
  const paneTitleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = paneTitleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title, state, variant]);

  /**
   * CE QUE LE PANNEAU DIT DE L'ENREGISTREMENT.
   *
   * LE PIÈGE QU'ON DÉSAMORCE ICI. Le panneau n'a plus de pied de fenêtre, donc
   * plus de bouton « Enregistrer dans le coffre » planté en bas — et une note de
   * coffre, elle, ne s'enregistre PAS toute seule comme une note personnelle :
   * l'écriture différée ne tire que pour le pair élu d'une salle stabilisée, ou
   * pour le rédacteur isolé. Relais injoignable, salle jamais vue, conflit
   * ouvert : rien n'écrit, et ce bouton était la seule issue.
   *
   * La décision vit donc dans un modèle pur et éprouvé (`vaultPaneSaveState`) :
   * c'est le seul endroit où l'on peut PROUVER qu'on ne dit pas « enregistré »
   * sur du texte qui ne l'est pas, ni qu'on ne laisse quelqu'un sans moyen
   * d'écrire. Ce composant ne fait qu'afficher ce que ce modèle répond.
   */
  /**
   * NOTRE RENOMMAGE ATTEND-IL ENCORE ? Le titre ne voyage pas par le CRDT : ni
   * l'élu ni personne ne l'écrira à notre place (voir `titlePending`).
   */
  const titlePending = title.trim() !== baseTitleRef.current;
  const autoSaveCovers = vaultPaneAutoSaveCovers({
    // LE FAIT, PAS LA DÉDUCTION : un minuteur court-il en ce moment ? Le modèle
    // ne peut plus conclure « c'est pris en charge » d'une simple capacité —
    // c'est ce qui faisait promettre un enregistrement au renommage seul, que
    // rien n'armait.
    autoSaveArmed: autoSave.armed,
    settled: collabSettled,
    // Un autre pair tient le stylo : notre texte est déjà en route vers lui, et
    // son commit annoncé fera retomber notre attente.
    otherSaverPresent: collab.participants.some((p) => p.isSaver && !p.isLocal),
    titlePending,
    serverReadOnly: roomReadOnly,
    capability: {
      responsible: collab.responsible,
      localRole: myRole,
      guardVersion,
      settled: collabSettled,
      loneSaver: collab.loneSaver,
      serverReadOnly: roomReadOnly,
    },
  });
  /**
   * LES DEUX 409 NE MÈNENT PAS AU MÊME GESTE : l'élément supprimé pendant
   * l'édition ne laisse que « Fermer » dans l'écran de conflit, et le badge ne
   * doit donc pas y renvoyer comme s'il portait « enregistrer ma version ».
   */
  const paneConflict: VaultPaneConflict =
    conflict === null ? 'none' : conflict.serverVersion === null ? 'gone' : 'open';
  const paneSaveState = vaultPaneSaveState({
    // La révocation d'accès compte comme une incapacité d'écrire : le serveur a
    // déjà tranché, et un bouton n'en récolterait qu'un 403.
    mayWrite: mayWrite && !accessRevoked,
    serverReadOnly: roomReadOnly,
    conflict: paneConflict,
    saving,
    // `dirty`, pas `unsaved` : le sur-ensemble. Voir `VaultPaneSaveStateInput`.
    dirty,
    autoSaveCovers,
    /**
     * DEUX FAITS, PAS UNE SUPPOSITION : un envoi est REVENU sans réponse, et un
     * minuteur de reprise court EN CE MOMENT. Ni l'un ni l'autre ne se déduit
     * de `navigator.onLine` — le premier vient de la requête elle-même, le
     * second du minuteur. Quand la borne de tentatives est atteinte, `armee`
     * retombe et l'écran redescend à « rien ne les enregistrera tout seul »,
     * avec son bouton, plutôt que de promettre une reprise qui n'aura pas lieu.
     */
    offlineRetryArmed: repriseArmee,
  });
  /**
   * Le coffre accepterait-il une écriture MAINTENANT, sur un clic ? C'est ce qui
   * décide si la demande de sortie a le droit d'offrir « Enregistrer et partir ».
   * Un gel, une révocation, un élément supprimé : le bouton n'y récolterait
   * qu'un refus, et promettre un enregistrement impossible est pire que se taire.
   */
  const peutEnregistrerMaintenant =
    mayWrite && !accessRevoked && conflict === null && guardVersion !== null && !saving;
  const paneSaveTone = vaultPaneSaveLabel(paneSaveState);
  const paneSaveText = t(`teamVaults.noteEditor.pane.${paneSaveTone.key}`);

  /**
   * LE COMPOSEUR DE COMMENTAIRE — même geste, deux places. Dans la fenêtre il
   * occupe une ligne de formulaire entre le titre et le texte ; dans le panneau
   * il rejoint les commentaires, en bas, là où l'éditeur ordinaire les tient.
   */
  const composeurCommentaire = (classeur: string) => (
    <>
      {mayWrite && !accessRevoked && (
        <div className={classeur}>
          {pendingComment === null ? (
            <Button size="sm" variant="ghost" disabled={saving} onClick={startComment}>
              {t('teamVaults.comments.add')}
            </Button>
          ) : (
            <>
              <Input
                value={pendingComment.draft}
                placeholder={t('teamVaults.comments.addPlaceholder')}
                aria-label={t('teamVaults.comments.add')}
                autoFocus
                fullWidth
                onChange={(e) =>
                  setPendingComment((prev) => (prev ? { ...prev, draft: e.target.value } : prev))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmComment();
                  if (e.key === 'Escape') cancelComment();
                }}
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!pendingComment.draft.trim()}
                onClick={confirmComment}
              >
                {t('teamVaults.comments.add')}
              </Button>
              <Button size="sm" variant="ghost" onClick={cancelComment}>
                {t('common.cancel')}
              </Button>
            </>
          )}
        </div>
      )}
    </>
  );

  /** Le champ de la FENÊTRE : un champ de formulaire étiqueté, inchangé. */
  const champTitreModale = (
    <Input
      label={t('teamVaults.noteEditor.titleLabel')}
      value={title}
      onChange={(e) => handleTitleChange(e.target.value)}
      disabled={!mayWrite || saving}
      fullWidth
    />
  );

  /**
   * LA FRONTIÈRE — LE CONTENU, QUI IGNORE OÙ IL SERA POSÉ.
   *
   * Une seule construction pour les deux montages : c'est ce qui garantit qu'un
   * panneau et une fenêtre ne divergeront jamais sur ce qui compte — la salle,
   * l'élection d'enregistrement, la bannière de version, l'écran de conflit, le
   * veto de lecture seule, les commentaires.
   *
   * ELLE NE CONNAÎT PLUS `ModalBody`/`ModalFooter`, ET C'EST TOUT LE CORRECTIF.
   * Le contenu portait le CORPS ET LE PIED d'une boîte de dialogue ; le panneau
   * les recevait tels quels, d'où le champ « Titre » encadré, le bouton
   * « Commenter » posé en ligne de formulaire et le pied « Fermer / Enregistrer
   * dans le coffre » au milieu de l'onglet Notes.
   *
   * Ce que le cadre fournit tient en trois emplacements, et il n'y en a pas un
   * quatrième : la boîte qui entoure la surface, ce qui vient juste avant elle,
   * ce qui vient juste après. Le reste est identique, à l'octet près.
   */
  const corps = ({ classeSurface, avantSurface, apresSurface }: CorpsHabillage) => (
    <>
      {state === 'loading' && (
        <p className="text-sm text-[var(--color-text-secondary)] m-0">
          {t('teamVaults.noteEditor.loading')}
        </p>
      )}
      {state === 'error' && (
        <p className="text-sm text-[var(--color-error-600,#dc2626)] m-0">
          {t('teamVaults.noteEditor.loadError')}
        </p>
      )}
      {state === 'unsupported' && (
        <p className="text-sm text-[var(--color-text-secondary)] m-0">
          {t('teamVaults.noteEditor.unsupported')}
        </p>
      )}
      {state === 'ready' && (
        <div className="flex flex-col gap-3 min-h-0">
          {collabLive && (
            <VaultCollabPresence
              participants={collab.participants}
              status={collab.status}
              responsible={collab.responsible}
            />
          )}
          {accessRevoked && (
            <p
              className="text-xs text-[var(--color-error-700,#b91c1c)] bg-[var(--color-error-50,#fef2f2)] border border-[var(--color-border-light)] rounded-md px-3 py-2 m-0"
              role="alert"
            >
              {t('teamVaults.noteEditor.live.accessRevoked')}
            </p>
          )}
          {!mayWrite && !accessRevoked && (
            <p
              className="text-xs text-[var(--color-text-secondary)] bg-[var(--color-surface-secondary)] border border-[var(--color-border-light)] rounded-md px-3 py-2 m-0"
              role="status"
            >
              {/* TROIS RAISONS D'ÊTRE EN LECTURE SEULE, ET ELLES N'APPELLENT PAS
                    LA MÊME CONDUITE. Le refus de la SALLE vient en premier parce
                    qu'il est le seul qui puisse surprendre quelqu'un qui
                    écrivait il y a dix secondes : lui dire « vous êtes lecteur »
                    le renverrait demander un rôle qu'il a déjà.

                    MAIS IL NE DIT PAS SA CAUSE, et le message ne doit donc pas
                    en affirmer une. Un jeton `viewer` rendu par la salle dit
                    exactement ceci : le serveur n'accepte plus nos écritures.
                    C'est le cas sur un GEL — mais tout autant sur une
                    RÉTROGRADATION reçue pendant que l'éditeur est ouvert, où la
                    salle rend le vrai rôle (`viewer`) tandis que le résumé
                    Redux dira encore « membre » jusqu'au prochain
                    `loadVaults`. Écrire « ce coffre est gelé » enverrait alors
                    quelqu'un réclamer le dégel d'un coffre qui n'a jamais été
                    gelé. La phrase nomme donc les deux causes et n'en tranche
                    aucune : se tromper ici ne coûte aucun accès, mais c'est un
                    fait FAUX affirmé à quelqu'un qui vient de perdre la main. */}
              {roomReadOnly && canEdit
                ? t('teamVaults.noteEditor.live.serverReadOnly')
                : collabLive
                  ? t('teamVaults.noteEditor.live.readerNotice')
                  : t('teamVaults.noteEditor.readOnly')}
            </p>
          )}
          {remoteIsNewer && (
            <div
              className="text-xs text-[var(--color-text-primary)] bg-[var(--color-surface-secondary)] border border-[var(--color-border-light)] rounded-md px-3 py-2 flex flex-col gap-2"
              role="status"
            >
              <span>{t('teamVaults.noteEditor.newerVersion')}</span>
              <div>
                <Button size="sm" variant="secondary" disabled={saving} onClick={reloadFromServer}>
                  {unsaved
                    ? t('teamVaults.noteEditor.newerVersionReloadDirty')
                    : t('teamVaults.noteEditor.newerVersionReload')}
                </Button>
              </div>
            </div>
          )}
          {/* L'ÉLÉMENT A DISPARU PENDANT L'ÉDITION (`serverVersion === null`) : il
              n'y a plus rien en face, donc aucun arbitrage à promettre. Ce
              bandeau ne propose que de fermer, et c'est délibéré. */}
          {conflict && conflict.serverVersion === null && (
            <div
              className="text-xs text-[var(--color-text-primary)] bg-[var(--color-warning-50,#fffbeb)] border border-[var(--color-warning-200,#fde68a)] rounded-md px-3 py-2 flex flex-col gap-2"
              role="alert"
            >
              <span>{t('teamVaults.noteEditor.conflictGone')}</span>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="ghost" disabled={saving} onClick={handleClose}>
                  {t('common.close')}
                </Button>
              </div>
            </div>
          )}
          {/* LE FACE-À-FACE. `conflictMine` est le document que le serveur vient
              de refuser — pas celui de l'écran, qui a pu bouger depuis dans une
              salle vivante. Sans lui il n'y a rien à opposer, et on retombe sur
              le repli honnête que porte `VaultNoteConflict` lui-même. */}
          {conflict && conflict.serverVersion !== null && conflictMine && (
            <VaultNoteConflict
              mine={conflictMine}
              theirs={
                serverBody.status === 'ready'
                  ? {
                      title: conflict.serverItem?.meta.title || untitled,
                      doc: serverBody.doc,
                    }
                  : null
              }
              status={serverBody.status}
              serverVersion={conflict.serverVersion}
              saving={saving}
              onKeepMine={() => {
                if (conflict.serverVersion !== null) void doSave(conflict.serverVersion);
              }}
              onDiscardMine={reloadFromServer}
              onResolve={(resolved) => {
                if (conflict.serverVersion === null) return;
                void doSave(conflict.serverVersion, {
                  close: false,
                  override: {
                    doc: resolved.doc,
                    title: resolved.title,
                    /* LES COMMENTAIRES DES DEUX CÔTÉS SONT CONSERVÉS. Le corps
                       du coffre en porte que nous n'avons jamais vus, et jeter
                       l'une des deux cartes ferait disparaître des fils
                       d'ancrage encore visés par les blocs qu'on vient de
                       retenir. En cas d'homonymie, le nôtre l'emporte : c'est
                       le seul des deux dont on sache qu'il est à jour. */
                    comments: sanitizeCommentMap({
                      ...(serverBody.comments ?? {}),
                      ...commentsRef.current,
                    }),
                    metaBase: conflict.serverItem?.meta ?? item.meta,
                  },
                });
              }}
              renderPreview={(previewDoc, previewKey) => (
                <VaultNoteEditorSurface key={previewKey} doc={previewDoc} editable={false} />
              )}
            />
          )}
          {avantSurface}
          <div className={classeSurface}>
            {/* Nothing is mounted while the room is still deciding: tiptap binds
                  its extensions ONCE, so a surface built before the session lands
                  would stay bound to the wrong document for good. */}
            {collab.phase === 'pending' ? (
              <p className="text-sm text-[var(--color-text-secondary)] m-0">
                {t('teamVaults.noteEditor.live.joining')}
              </p>
            ) : (
              /* Keyed on the LOADED document, not on the item's version: the surface
                   must remount when a new body is mounted, and only then. The room
                   identity joins the key for the same reason. */
              <VaultNoteEditorSurface
                key={`${surfaceKey(item.id, docToken)}:${collabLive ? 'live' : 'local'}`}
                mentionCandidates={mentionCandidates}
                doc={
                  !collabLive && liveExitDocRef.current?.token === docToken
                    ? liveExitDocRef.current.doc
                    : doc
                }
                /* A save is a background chore in a live room — freezing the
                     surface every six seconds would make it unusable. Only the
                     manual, modal-closing save locks the text. */
                editable={mayWrite && (collabLive || !saving)}
                /* Le placeholder allume AUSSI le jeu d'interaction (menu « / »,
                     poignée, émojis) : c'est la seule surface de ce fichier qui
                     s'écrit — l'aperçu d'un conflit, lui, n'en reçoit pas. */
                placeholder={t('notes.editorPlaceholder')}
                collab={
                  collabLive && collab.session
                    ? {
                        fragment: collab.session.fragment,
                        awareness: collab.session.awareness,
                        doc: collab.session.doc,
                        user: {
                          name: memberLabel,
                          color: pickCollabColor(`${cloudUser?.id ?? ''}:${getDeviceSeed()}`),
                        },
                        seed: doc,
                        status: collab.status,
                        maySeed: () => collab.session?.isSeedResponsible() ?? true,
                        commentsEmpty: () => (collab.session?.getCommentsMap().size ?? 0) === 0,
                        seedComments: () => collab.session?.seedComments(commentsRef.current),
                      }
                    : null
                }
                onChange={handleDocChange}
                onReady={onReady}
                onSettled={() => {
                  commentsSettledRef.current = true;
                }}
              />
            )}
          </div>
          {apresSurface}
          <VaultCommentsPanel
            comments={comments}
            canComment={mayWrite && !accessRevoked && !saving}
            onReply={replyComment}
            onResolve={resolveComment}
            onDelete={deleteComment}
          />
        </div>
      )}
    </>
  );

  // ══ HABILLAGE ══════════════════════════════════════════════════════════════

  if (variant === 'pane') {
    /**
     * LE MÊME ÉDITEUR, DANS L'HABILLAGE DE L'ÉDITEUR DE NOTES ORDINAIRE.
     *
     * Pas de portail, pas de fond fixe, pas de piège à Échap : on est dans le
     * flux du panneau d'édition, à la place exacte qu'occuperait une note
     * personnelle — et on en reprend le vocabulaire visuel plutôt que d'en
     * inventer un troisième. Les classes `note-editor__title*` et
     * `note-editor__save-*` viennent de `NoteEditor.css`, chargée d'office par
     * l'onglet Notes qui monte ce panneau : les réécrire ici aurait fait deux
     * échelles typographiques pour un même titre.
     *
     * `isOpen` reste la garde de chargement du corps (`loadKey`) — un panneau
     * qui n'est pas monté ne doit pas déchiffrer d'élément.
     */
    if (!isOpen) return null;
    return (
      <div className="vault-note-pane">
        <div className="vault-note-pane__bar">
          {/* LE RETOUR EST UN GESTE EXPLICITE, et il est visible : rester dans
              l'onglet Notes ne doit pas emmurer. Le nom du coffre dit où l'on
              va — l'intitulé n'a donc rien à inventer. */}
          {onOpenInVault && (
            /* GARDÉ COMME TOUTE AUTRE SORTIE. Il appelait `onOpenInVault` en
               direct : hors salle, un clic emportait la personne dans
               l'explorateur en jetant son paragraphe sans un mot. */
            <Button
              variant="ghost"
              size="sm"
              onClick={() => quitterPanneau(onOpenInVault)}
              title={t('common.back')}
            >
              {`← ${vaultName || t('teamVaults.notesSection.title')}`}
            </Button>
          )}
          <span className="vault-note-pane__bar-spacer" />
          {/* L'ÉTAT DE L'ENREGISTREMENT, ET LE GESTE QUAND IL EN FAUT UN. Rien
              n'est affiché avant que le corps soit monté : sur un document qui
              n'est pas encore là, « Enregistré » serait vrai par accident. */}
          {state === 'ready' && (
            <>
              <span
                className={`note-editor__save-state note-editor__save-state--${paneSaveTone.tone} vault-note-pane__save-state`}
                role="status"
                aria-live="polite"
                title={paneSaveText}
              >
                <span
                  className={`note-editor__save-dot note-editor__save-dot--${paneSaveTone.tone}`}
                  aria-hidden="true"
                />
                <span className="note-editor__save-label">{paneSaveText}</span>
              </span>
              {vaultPaneOffersSave(paneSaveState) && (
                <Button
                  size="sm"
                  variant="primary"
                  loading={saving}
                  disabled={!vaultPaneSaveEnabled(paneSaveState) || guardVersion === null}
                  /* `close: false` — un enregistrement depuis le panneau ne
                     referme pas la note : on est dans l'onglet Notes, pas dans
                     une boîte de dialogue qu'on vient valider. Le badge repasse
                     à « enregistré », c'est l'accusé de réception. */
                  onClick={() => {
                    if (guardVersion !== null) doSave(guardVersion, { close: false });
                  }}
                >
                  {t('teamVaults.noteEditor.pane.saveNow')}
                </Button>
              )}
            </>
          )}
          {/* La MÊME garde que le retour ci-dessus : on écrit si quelque chose
              peut écrire, sinon on demande. Deux sorties d'un même écran ne
              peuvent pas avoir deux politiques d'écriture. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => quitterPanneau(onClose)}
            disabled={saving}
            title={t('teamVaults.noteEditor.pane.exit')}
          >
            {t('common.close')}
          </Button>
        </div>
        {/* L'AVEU, SOBREMENT, ET AU SEUL MOMENT OÙ IL COÛTE QUELQUE CHOSE.
            Le brouillon n'est écrit NULLE PART sur ce poste : ni stockage
            local, ni fichier. Recharger la page ou fermer l'onglet pendant la
            coupure le perd, entier — et c'est justement quand l'écran annonce
            « ça repartira tout seul » que quelqu'un est tenté de le fermer.
            Hors de cet état, l'écran demande un geste immédiat : un second
            avertissement n'y ferait qu'affaiblir le premier. */}
        {state === 'ready' && vaultPaneWarnsDraftIsNowhere(paneSaveState) && (
          <p className="vault-note-pane__draft-warning" role="status">
            {t('teamVaults.noteEditor.pane.offlineDraftNowhere')}
          </p>
        )}
        <div className="vault-note-pane__scroll">
          {/* LE TITRE EN TÊTE DU DOCUMENT, SANS ÉTIQUETTE — comme une note
              ordinaire. Un champ encadré surmonté du mot « Titre » était
              précisément ce que la personne signalait à l'écran. */}
          {state === 'ready' && (
            <div className="note-editor__title-area vault-note-pane__title-area">
              <textarea
                ref={paneTitleRef}
                className="note-editor__title"
                value={title}
                /* SANS ÉTIQUETTE VISIBLE, MAIS PAS SANS NOM. Le champ de la
                   fenêtre porte un `label` ; ici il n'y a qu'un texte de
                   substitution, qui disparaît dès qu'on tape — une aide
                   technique annoncerait alors un champ anonyme. */
                aria-label={t('teamVaults.noteEditor.titleLabel')}
                onChange={(e) => handleTitleChange(e.target.value)}
                /* ENTRÉE DESCEND DANS LE TEXTE, elle n'ouvre pas une ligne dans
                   le titre — même geste que l'éditeur ordinaire. Un `<textarea>`
                   accepte les sauts de ligne, et `trim()` ne rogne que les
                   bords : le reste partait dans `meta.title`, donc dans la liste
                   du coffre et dans le titre de la fenêtre. */
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  surfaceCommandsRef.current?.focusStart();
                }}
                placeholder={t('notes.titlePlaceholder', 'Untitled')}
                readOnly={!mayWrite || saving}
                rows={1}
              />
            </div>
          )}
          <div className="vault-note-pane__doc">
            {corps({
              classeSurface: 'vault-note-pane__surface',
              apresSurface: composeurCommentaire('vault-note-pane__compose'),
            })}
          </div>
        </div>
        {/* ON NE PART PAS EN SILENCE. Cette demande n'apparaît que lorsqu'il
            reste du texte À NOUS que rien n'écrira : si la salle peut l'écrire,
            `quitterPanneau` l'a déjà poussé et n'a rien demandé. « Enregistrer
            et partir » n'est offert que si le coffre accepte encore une
            écriture — le proposer sous un gel ou sur un élément supprimé
            enverrait cliquer sur un refus, et le message dit alors de copier ce
            qui compte. */}
        {exitPrompt !== null && (
          <ConfirmModal
            isOpen
            variant="warning"
            title={t('teamVaults.noteEditor.pane.exitTitle')}
            message={
              /* HORS LIGNE, « rien ne les enregistrera tout seul » EST FAUX —
                 une reprise est armée — et « enregistrer et partir » ne peut
                 pas aboutir. La troisième phrase dit les deux, et le seul
                 conseil qui tienne : rester, ou copier son texte. */
              vaultPaneWarnsDraftIsNowhere(paneSaveState)
                ? t('teamVaults.noteEditor.pane.exitMessageOffline')
                : peutEnregistrerMaintenant
                  ? t('teamVaults.noteEditor.pane.exitMessage')
                  : t('teamVaults.noteEditor.pane.exitMessageBlocked')
            }
            cancelText={t('teamVaults.noteEditor.pane.exitStay')}
            confirmText={t('teamVaults.noteEditor.pane.exitDiscard')}
            extraActions={
              peutEnregistrerMaintenant
                ? [
                    {
                      label: t('teamVaults.noteEditor.pane.exitSaveAndLeave'),
                      onClick: () => {
                        const suite = exitPrompt.suite;
                        const version = guardVersion;
                        if (version === null) return;
                        // ON NE PART QU'UNE FOIS LE COMMIT ABOUTI : un 409 pris
                        // sur le pas de la porte jetterait le texte qu'on venait
                        // de promettre d'enregistrer. En cas d'échec, l'écran de
                        // conflit s'ouvre et le panneau reste.
                        void doSave(version, { close: false }).then((ok) => {
                          if (!ok) return;
                          sortieTraiteeRef.current = true;
                          suite();
                        });
                      },
                    },
                  ]
                : []
            }
            onConfirm={() => {
              // Partir en connaissance de cause : le filet de démontage ne doit
              // pas écrire derrière quelqu'un qui vient de choisir le contraire.
              sortieTraiteeRef.current = true;
              exitPrompt.suite();
            }}
            onClose={() => setExitPrompt(null)}
          />
        )}
      </div>
    );
  }

  // ══ LA FENÊTRE ═════════════════════════════════════════════════════════════
  // Tout ce qui précède ignore `ModalBody`/`ModalFooter` — c'était le défaut
  // rapporté (un pied de boîte de dialogue au milieu de l'onglet Notes), et le
  // garde-fou lit cette borne.

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={item.meta.title || untitled}
      size="xl"
      /* Guarded by OUR unsaved work, not the room's: another member's typing is
         already on its way to the writer and must not trap us in this modal.
         Échap est gardée EXACTEMENT comme le fond, et ne l'était pas : hors salon
         vivant rien n'enregistre automatiquement et rien n'est conservé
         localement, si bien qu'un réflexe de fermeture jetait le paragraphe qu'on
         venait d'écrire. Deux sorties d'un même écran ne peuvent pas avoir deux
         politiques opposées sur la même donnée. */
      closeOnBackdrop={!unsaved && !saving}
      closeOnEsc={!unsaved && !saving}
    >
      <ModalBody>
        {corps({
          classeSurface:
            'border border-[var(--color-border-light)] rounded-md p-3 max-h-[55vh] overflow-y-auto bg-[var(--color-surface)]',
          avantSurface: (
            <>
              {champTitreModale}
              {composeurCommentaire('flex items-center gap-2')}
            </>
          ),
        })}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={handleClose} disabled={saving}>
          {unsaved ? t('common.cancel') : t('common.close')}
        </Button>
        <Button
          variant="primary"
          loading={saving}
          disabled={
            !mayWrite ||
            accessRevoked ||
            state !== 'ready' ||
            guardVersion === null ||
            conflict !== null
          }
          onClick={() => {
            if (guardVersion !== null) doSave(guardVersion);
          }}
        >
          {t('teamVaults.noteEditor.save')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default VaultNoteEditor;
