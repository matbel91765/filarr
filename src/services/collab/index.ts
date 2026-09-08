/**
 * Collaboration en temps réel — transport chiffré côté client.
 *
 * Surface publique. Tout le reste du dossier est interne : l'éditeur de notes
 * personnelles n'a besoin que de `createCollabSession`, celui des notes de
 * coffre de `startVaultCollabSession`, et le chemin de fusion de
 * `isNoteInLiveSession`.
 */

export {
  CollabSession,
  createCollabSession,
  startCollabSession,
  startVaultCollabSession,
  releaseCollabSession,
  stopCollabSession,
  stopAllCollabSessions,
  getCollabSession,
  getVaultCollabSession,
  collabSessionRefCount,
  isNoteInLiveSession,
  liveSessionNoteIds,
  publishLiveSessions,
  purgeCollabOnKeyLoss,
  purgeVaultCollab,
  presenceColorFor,
  toSessionStatus,
  type CollabPresence,
  type StartSessionOptions,
  type SessionStatus,
  type VaultRoomSource,
} from './collabSession';

export {
  electSaveResponsible,
  isSaveResponsible,
  roleCanWrite,
  SAVE_ELECTION_SETTLE_MS,
  type CollabRole,
  type SaveCandidate,
  type SaveResponsibilityInput,
} from './saveElection';

export {
  vaultRoomId,
  parseVaultRoomId,
  isVaultRoomId,
  vaultRoomSalt,
  isValidRoomPart,
  VAULT_ROOM_PREFIX,
  type VaultRoomRef,
} from './collabRoom';

export {
  CollabProvider,
  type CollabStatus,
  type CollabStats,
  type CollabProviderOptions,
  type CollabSocketLike,
} from './collabProvider';

export {
  isCollabEnabled,
  setCollabEnabled,
  overrideCollabEnabled,
  LIVE_COLLAB_CHANGED_EVENT,
} from './collabFlag';

export {
  getRoomKey,
  getVaultRoomKey,
  deriveRoomKey,
  deriveRoomKeyBits,
  deriveVaultRoomKey,
  deriveVaultRoomKeyBits,
  clearRoomKey,
  clearRoomKeys,
  clearVaultRoomKeys,
  VAULT_HKDF_INFO,
  type VaultRoomKeyInput,
} from './collabKeys';

export { isNoteLive, liveNotes, setLiveNotes, clearLiveNotes } from './liveNoteRegistry';

export {
  yXmlFragmentToTiptapDoc,
  yXmlFragmentToNoteContent,
  tiptapDocToPlainText,
  type TiptapDoc,
  type TiptapNode,
} from './yToTiptap';

export {
  CollabFrameKind,
  CollabControl,
  COLLAB_MAGIC,
  COLLAB_PROTOCOL_VERSION,
  COLLAB_HEADER_BYTES,
  COLLAB_IV_BYTES,
  encryptFrame,
  decryptFrame,
  readFrameHeader,
  buildControlFrame,
} from './collabProtocol';

export {
  requestRoomTicket,
  requestVaultRoomTicket,
  buildRoomUrl,
  buildVaultRoomUrl,
  roomUrlFromPath,
  resolveCollabApiBase,
  roomSubprotocols,
  closeDisposition,
  COLLAB_SUBPROTOCOL,
  COLLAB_TOKEN_SUBPROTOCOL_PREFIX,
  COLLAB_CLOSE,
  type RoomTicket,
  type CollabCloseDisposition,
} from './collabTicket';
