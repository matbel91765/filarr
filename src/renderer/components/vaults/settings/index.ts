/**
 * La page « Gérer le coffre » (F01) — un dossier, parce qu'elle est faite de
 * six pièces (la coque, le chargeur unique, son modèle pur, et un fichier par
 * onglet) que les fiches suivantes enrichissent une à une.
 */

export { VaultSettingsView } from './VaultSettingsView';
export { useVaultManagement } from './useVaultManagement';
export type { VaultManagement } from './useVaultManagement';
export {
  VAULT_TAB_ORDER,
  defaultVaultTab,
  resolveVaultTab,
  visibleVaultTabs,
} from './vaultManagementModel';
export type { VaultTabId, VaultMemberRow } from './vaultManagementModel';
/**
 * Les réglages du coffre (F13) sortent du dossier parce que DEUX écrans hors de
 * la page les appliquent : le dialogue de partage par élément
 * (`itemGrantsEnabled`, `grantMaxExpiryDays`) et l'explorateur
 * (`itemDeleteRequiresAdmin`). Un réglage lu par la seule page qui l'édite ne
 * serait qu'une décoration.
 */
/**
 * Le trombinoscope trié/filtré (F09) et la confiance par membre (F11) sortent
 * eux aussi : le point rouge du bouton « Gérer » vit dans l'explorateur, hors de
 * ce dossier, et la barre de sélection s'appuie sur le même modèle que la page.
 */
export {
  DEFAULT_ROSTER_SORT,
  ROSTER_FILTERS,
  isSelectable,
  rosterView,
  selectedRows,
  visibleSelection,
} from './memberRosterModel';
export type { RosterFilterId, RosterSort, RosterSortKey, RosterView } from './memberRosterModel';
export { alertingMembers, memberTrust, trustCounter } from './memberTrustModel';
export type {
  MemberKeyFacts,
  MemberKeyStatus,
  MemberTrustState,
  MemberTrustVerdict,
  TrustMark,
} from './memberTrustModel';
export { useMemberKeyWatch, useVaultKeyAlertCount } from './useMemberKeyWatch';
export type { MemberKeyWatch } from './useMemberKeyWatch';

/**
 * Le fil filtrable (F12) sort du dossier parce que `VaultActivityPanel` vit à
 * l'étage au-dessus (il sert quatre écrans) et qu'il a besoin du MÊME découpage
 * en familles que le menu : deux partitions parallèles finiraient par diverger,
 * et un menu « éléments » qui ne rendrait pas les lignes 📄 serait un mensonge
 * que rien ne signale.
 */
export {
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_FAMILY_IDS,
  ACTIVITY_PERIOD_IDS,
  activityFamily,
  activityQueryTypes,
  buildActivityExport,
  csvField,
  familyEventTypes,
  periodRange,
} from './vaultActivityExport';
export type { ActivityFamilyId, ActivityPeriodId } from './vaultActivityExport';

/** Les accès ponctuels (F17) — le modèle et son chargeur de page. */
export { buildGrantOverview, grantSummaryCounts } from './grantOverviewModel';
export type { GrantItemRow, GrantOverview, GrantPersonRow } from './grantOverviewModel';
export { useVaultGrants } from './useVaultGrants';
export type { VaultGrants } from './useVaultGrants';

export { useVaultSettings } from './useVaultSettings';
export type { VaultSettingsHandle } from './useVaultSettings';
export {
  DEFAULT_VAULT_SETTINGS,
  coerceGrantExpiry,
  dangerGuard,
  grantExpiryChoices,
  readVaultSettings,
  vaultSpaceIdentity,
} from './vaultSettingsModel';
export type { VaultSettingsDocument, VaultSpaceIdentity } from './vaultSettingsModel';
