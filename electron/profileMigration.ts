/**
 * Profile Migration — Legacy Data Migration
 *
 * Migrates pre-profile data from the monolithic FilarData/ directory
 * into a default profile under FilarData/profiles/{id}/.
 * Runs once on first launch after the profile system update.
 */

import fs from 'fs/promises';
import path from 'path';
import type ProfileManagerType from './profileManager';

// Files/dirs at FilarData/ root that should NOT be moved (they belong to the profile system)
const SYSTEM_ENTRIES = new Set(['profiles', 'profiles.json']);

// Known root-level files that belong to a profile's data
const PROFILE_FILES = new Set([
  'encryption.key',
  'appConfig.json',
  'password_manager.enc',
  'calendarReminders.json',
  // Son frere manquait a l'appel : une migration depuis l'ancienne arborescence
  // laissait les rappels de NOTE a la racine de FilarData, orphelins de tout
  // profil — donc perdus, en silence.
  'noteReminders.json',
  'notificationSettings.json',
  'storage.quota',
]);

/**
 * Migrate legacy FilarData/ structure into the default profile directory.
 *
 * Before: FilarData/encryption.key, FilarData/{folderId}/...
 * After:  FilarData/profiles/{profileId}/encryption.key, FilarData/profiles/{profileId}/{folderId}/...
 */
export async function migrateLegacyToDefaultProfile(
  profileManager: typeof ProfileManagerType,
  baseDir: string,
): Promise<string> {
  console.log('[ProfileMigration] Starting legacy data migration...');

  // 1. Create the default profile
  const profile = await profileManager.createProfile('User', '#4682B4');
  const targetDir = profileManager.getProfileDataDir(profile.id);

  console.log(`[ProfileMigration] Created default profile "${profile.id}" at ${targetDir}`);

  // 2. List all entries at FilarData/ root
  const entries = await fs.readdir(baseDir, { withFileTypes: true });

  let movedCount = 0;

  for (const entry of entries) {
    // Skip system entries (profiles dir, manifest)
    if (SYSTEM_ENTRIES.has(entry.name)) continue;

    const sourcePath = path.join(baseDir, entry.name);
    const destPath = path.join(targetDir, entry.name);

    try {
      await fs.rename(sourcePath, destPath);
      movedCount++;
    } catch (err) {
      // rename may fail across devices; fallback to copy+delete
      console.warn(`[ProfileMigration] rename failed for ${entry.name}, trying copy:`, err);
      try {
        if (entry.isDirectory()) {
          await copyDirRecursive(sourcePath, destPath);
        } else {
          await fs.copyFile(sourcePath, destPath);
        }
        await fs.rm(sourcePath, { recursive: true, force: true });
        movedCount++;
      } catch (copyErr) {
        console.error(`[ProfileMigration] Failed to migrate ${entry.name}:`, copyErr);
      }
    }
  }

  console.log(`[ProfileMigration] Moved ${movedCount} entries to default profile.`);

  // 3. Update manifest
  const manifest = profileManager.getManifest();
  manifest.migratedFromLegacy = true;
  manifest.activeProfileId = profile.id;
  await profileManager.saveManifest(manifest);

  console.log('[ProfileMigration] Migration complete.');
  return profile.id;
}

/**
 * Recursively copy a directory
 */
async function copyDirRecursive(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}
