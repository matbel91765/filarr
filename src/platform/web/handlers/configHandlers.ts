/**
 * Handlers web des canaux config/flags — persistance localStorage.
 *
 * `getConfig` force le mode cloud : sur web, le stockage local Electron
 * n'existe pas et CloudStorageImplementation est l'implémentation active
 * (M1/M2 du dossier avant-projet ; le cache OPFS arrive en M3).
 * src/config.ts merge lui-même ce partiel au-dessus de ses défauts.
 */

import { resolveApiBase } from '../webApiBase';
import { getBuildVersion } from '../../../services/platform/appVersion';

const CONFIG_KEY = 'filarr-web-config';
const FLAGS_KEY = 'filarr-web-flags';

function readJson(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota/indisponible : la config web est reconstructible */
  }
}

export const configHandlers: Record<string, (...args: unknown[]) => unknown> = {
  getConfig: () => ({
    ...readJson(CONFIG_KEY),
    // Invariants web, quoi que contienne la config sauvée. `storageMode:
    // 'local'` est DÉLIBÉRÉ : le mode 'cloud' (CloudStorageImplementation)
    // parle aux endpoints REST de l'ère Express qui n'existent pas sur le
    // Worker — par design zero-knowledge, la vérité cloud est le manifeste
    // CHIFFRÉ de sync, pas une API de métadonnées en clair. Le web est donc
    // local-first sur IndexedDB via les canaux legacy (comme un desktop à
    // compte cloud), et le moteur de sync M3 fera le pont avec le manifeste.
    storageMode: 'local',
    useCloudStorage: true,
    cloudStorageUrl: resolveApiBase(),
  }),

  saveConfig: (config: unknown) => {
    if (config && typeof config === 'object') {
      writeJson(CONFIG_KEY, config as Record<string, unknown>);
    }
  },

  'flag:get': (key: unknown) => {
    const flags = readJson(FLAGS_KEY);
    return (flags[String(key)] as string | undefined) ?? null;
  },

  'flag:set': (key: unknown, value: unknown) => {
    const flags = readJson(FLAGS_KEY);
    flags[String(key)] = String(value);
    writeJson(FLAGS_KEY, flags);
  },

  'flag:remove': (key: unknown) => {
    const flags = readJson(FLAGS_KEY);
    delete flags[String(key)];
    writeJson(FLAGS_KEY, flags);
  },

  'get-app-version': () => `${getBuildVersion() ?? 'dev'}-web`,
};
