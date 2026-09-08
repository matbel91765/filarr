/**
 * Handlers web : sélection d'espace (personnel/entreprise) et keypair E2E
 * utilisateur (E2) — miroirs de electron/main.ts:3025-3039 et 2811-2860.
 *
 * Le blob keypair est opaque (clé privée wrappée sous la KEK) : IndexedDB
 * convient, comme user_keypair.json sur le disque desktop. Les moitiés cloud
 * relaient GET/PUT /account/user-key, formes identiques au main.
 */

import { apiFetch } from '../webApiBase';
import { idbGet, idbPut } from '../idb';
import { getActiveProfileId } from '../webStore';

const KEYPAIR_KEY = 'user_keypair';

/**
 * L'ESPACE EST UNE AFFAIRE DE PROFIL, PAS DE NAVIGATEUR.
 *
 * Le bureau range l'espace dans `.space` AU FOND DU DOSSIER DU PROFIL
 * (authService.getSpacePath). Le web le rangeait sous UNE clé globale : se
 * connecter avec un compte d'organisation la mettait à « entreprise », et
 * revenir sur le profil personnel ne la touchait pas — la puce « Organisation »
 * restait allumée sur un compte qui ne peut PAS appartenir à un espace
 * d'organisation (comptes strictement séparés, migration 0059).
 *
 * Deux règles, dans cet ordre :
 *  1. l'estampille du profil actif tranche quand elle connaît le type de
 *     compte — un compte personnel est TOUJOURS dans l'espace personnel ;
 *  2. sinon, la préférence mémorisée POUR CE PROFIL. Jamais celle d'un autre :
 *     l'ancienne clé globale n'est pas héritée, c'est elle qui mentait.
 */
const SPACE_KEY_PREFIX = 'filarr-web-space:';

type Space = 'personal' | 'enterprise';

function asSpace(v: unknown): Space | null {
  return v === 'personal' || v === 'enterprise' ? v : null;
}

/** Le type de compte que porte l’estampille du profil actif, s’il est connu. */
async function activeProfileAccountType(pid: string): Promise<Space | null> {
  try {
    const manifest = await idbGet<{
      profiles?: Array<{ id: string; cloudAccount?: { accountType?: string } | null }>;
    }>('profiles_manifest');
    const t = manifest?.profiles?.find((p) => p.id === pid)?.cloudAccount?.accountType;
    return t === 'personal' || t === 'enterprise' ? t : null;
  } catch {
    return null;
  }
}

export async function readWebSpace(): Promise<Space> {
  const pid = await getActiveProfileId();
  if (!pid) return 'personal';
  const byAccount = await activeProfileAccountType(pid);
  if (byAccount === 'personal') return 'personal';
  let stored: Space | null = null;
  try {
    stored = asSpace(localStorage.getItem(SPACE_KEY_PREFIX + pid));
  } catch {
    /* stockage indisponible : on retombe sur le compte */
  }
  return stored ?? byAccount ?? 'personal';
}

export async function writeWebSpace(space: Space): Promise<void> {
  const pid = await getActiveProfileId();
  if (!pid) return;
  try {
    localStorage.setItem(SPACE_KEY_PREFIX + pid, space);
  } catch {
    /* mémoire seule */
  }
}

export const spaceKeypairHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'space:get': async () => ({ success: true, data: { space: await readWebSpace() } }),

  'space:set': async (space: unknown, orgId: unknown = null) => {
    const s = asSpace(space) ?? 'personal';
    await writeWebSpace(s);
    return { success: true, data: { space: s, orgId } };
  },

  'keypair:saveLocal': async (keypairData: unknown) => {
    await idbPut(KEYPAIR_KEY, keypairData);
  },

  'keypair:loadLocal': async () => idbGet(KEYPAIR_KEY),

  'keypair:pushToCloud': async (keypairData: unknown) => {
    const res = await apiFetch('/account/user-key', { method: 'PUT', body: keypairData });
    return res.body ?? { success: false, error: `HTTP ${res.status}` };
  },

  'keypair:fetchFromCloud': async () => {
    const res = await apiFetch<{ data?: Record<string, unknown> }>('/account/user-key');
    if (res.status === 200 && res.body?.success && res.body.data) return res.body.data;
    return null;
  },
};
