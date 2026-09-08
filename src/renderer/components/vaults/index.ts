/**
 * Team Vaults UI (E3-8) — shared E2EE team vaults.
 *
 * Lot A (C6) : plus de page « tous mes coffres », de coque `/vaults`, de page
 * « Partagé avec moi » ni de navigateur d'éléments à part. Un coffre est un
 * dossier de l'accueil, ouvert dans `VaultFolderView` à `/vault-folder/<id>`.
 */

export { VaultFolderCard } from './VaultCards';
export type { VaultFolderCardProps } from './VaultCards';
export { useVaultCardMenu } from './useVaultCardMenu';
export { VaultFolderView } from './VaultFolderView';
export type { VaultDisplayItems, VaultDisplayFile, VaultDisplayFolder } from './VaultFolderView';
export { useVaultBrowser } from './useVaultBrowser';
export type { VaultBrowser } from './useVaultBrowser';
export {
  toVaultDisplayItems,
  allVaultFolderPaths,
  vaultFileCaps,
  vaultFolderCaps,
  canDeleteVaultItem,
  isVaultAdminRole,
  canEditVault,
  pathFromDirId,
  idFromItemId,
  VAULT_DIR_PREFIX,
  VAULT_ITEM_PREFIX,
} from './vaultExplorerModel';
export type { VaultCapsContext, VaultItemLike } from './vaultExplorerModel';
export { CreateVaultModal } from './CreateVaultModal';
// La page « Gérer le coffre » (F01) — elle REMPLACE l'ancien volet
// `VaultMembersPanel`, supprimé avec elle. `InviteMemberModal` a suivi (F02) :
// la ligne d'invitation unique vit dans `sharing/InviteRow`, et les deux écrans
// qui la portent l'importent de là.
export { VaultSettingsView } from './settings';
export type { VaultTabId } from './settings';
export { VaultNotePicker } from './VaultNotePicker';
export { VaultNoteEditor } from './VaultNoteEditor';
export { VaultKeypairGate } from './VaultKeypairGate';
export { PendingInviteHost } from './PendingInviteHost';
export { InviteCodeEntry } from './InviteCodeEntry';
export { VaultItemHistory } from './VaultItemHistory';
export { ShareItemToPersonModal } from './ShareItemToPersonModal';
