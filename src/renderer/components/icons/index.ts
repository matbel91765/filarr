/**
 * Filarr protection icon family (Wave 1) — hand-authored, brand-derived.
 *
 * Marks (512 grid, themeable color prop) for hero/empty states:
 *   FilarrLockMark, FilarrUnlockedMark, FilarrShieldMark
 * Glyphs (24 grid, currentColor, heroicons-compatible) for menus/buttons:
 *   ShieldPlusIcon (protéger), VaultLockIcon (verrouiller),
 *   VaultUnlockIcon (déverrouiller), LockAllIcon (tout verrouiller),
 *   PurgeTempIcon (purger), RecentItemsIcon (récents), OpenExternalIcon (ouvrir)
 *
 * Raster siblings (tray PNGs, .filarr ICO) are generated from the same
 * geometry: see buildResources/icon-sources/generate-rasters.cjs.
 */
export { FilarrLockMark, FilarrUnlockedMark, FilarrShieldMark } from './ProtectionMarks';
export {
  ShieldPlusIcon,
  VaultLockIcon,
  VaultUnlockIcon,
  LockAllIcon,
  PurgeTempIcon,
  RecentItemsIcon,
  OpenExternalIcon,
  // Wave 2 — conteneurs .filarr « Protéger sur place »
  BoxFileIcon,
  BoxFolderIcon,
  ProtectInPlaceIcon,
  ExtractIcon,
  RevealLocationIcon,
  LocateIcon,
  ForgetItemIcon,
} from './ProtectionGlyphs';
