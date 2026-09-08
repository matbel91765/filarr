/**
 * pluginStorage — les greffons installés, en IndexedDB DÉDIÉE
 * ('filarr-plugins'). Parité web/desktop sans IPC : le renderer Electron est
 * Chromium, IndexedDB marche identiquement des deux côtés (et localStorage ne
 * tient pas 4 MiB de bundle). Calqué sur src/platform/web/idb.ts.
 *
 * Clés préfixées '{userId}:{slug}' — les comptes d'un même poste sont isolés.
 *
 * LE TOFU VIT ICI : pinnedSignPublicKey est écrit à l'install et RELU à chaque
 * chargement — c'est installedPlugins.ts qui arbitre un changement de clé
 * (jamais d'écrasement silencieux) ; ce module ne fait que ranger.
 *
 * Garde vitest env node : jamais d'accès top-level à indexedDB — chaque
 * fonction vérifie à l'entrée (règle du dépôt).
 */

export interface InstalledPluginRecord {
  slug: string;
  installedVersion: string;
  /** Les octets exacts signés — chaîne verbatim, jamais re-sérialisée. */
  manifestJson: string;
  signature: string;
  /** La clé épinglée à l'install (TOFU) — la vérification au chargement se
   *  fait contre ELLE, jamais contre une clé re-servie par le serveur. */
  pinnedSignPublicKey: string;
  publisherFingerprint: string;
  bundle: ArrayBuffer;
  enabled: boolean;
  installedAt: string;
}

const DB_NAME = 'filarr-plugins';
const STORE = 'plugins';
const DB_VERSION = 1;

let _db: Promise<IDBDatabase> | null = null;

function requireIdb(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('pluginStorage requires a browser context');
  }
}

function openDb(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _db;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

const keyOf = (userId: string, slug: string) => `${userId}:${slug}`;

export async function installedPluginsList(userId: string): Promise<InstalledPluginRecord[]> {
  requireIdb();
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly').objectStore(STORE);
  const [keys, values] = await Promise.all([request(tx.getAllKeys()), request(tx.getAll())]);
  const prefix = `${userId}:`;
  const out: InstalledPluginRecord[] = [];
  keys.forEach((k, i) => {
    if (String(k).startsWith(prefix)) out.push(values[i] as InstalledPluginRecord);
  });
  return out;
}

/** Ce qu'il faut savoir d'un plugin installé SANS toucher à ses octets. */
export interface InstalledPluginVersion {
  slug: string;
  installedVersion: string;
  enabled: boolean;
}

/**
 * Les versions installées d'UN compte, par CURSEUR.
 *
 * POURQUOI PAS `installedPluginsList`. Celle-ci fait `getAll()` : elle
 * matérialise en mémoire les bundles de TOUS les comptes du poste — jusqu'à
 * 4 Mio chacun — pour n'en garder que ceux d'un seul, et la pastille de mise à
 * jour l'appellerait à chaque démarrage. Ici la plage de clés borne la lecture
 * au compte demandé, le curseur ne tient qu'un enregistrement à la fois, et
 * seules trois chaînes en ressortent : les octets sont relâchés aussitôt lus.
 */
export async function installedPluginVersions(userId: string): Promise<InstalledPluginVersion[]> {
  requireIdb();
  const db = await openDb();
  const prefix = `${userId}:`;
  // '\uffff' borne le préfixe : aucun autre compte ne peut s'y glisser.
  const plage = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
  return new Promise((resolve, reject) => {
    const out: InstalledPluginVersion[] = [];
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(plage);
    req.onsuccess = () => {
      const curseur = req.result;
      if (!curseur) {
        resolve(out);
        return;
      }
      const rec = curseur.value as InstalledPluginRecord;
      out.push({
        slug: rec.slug,
        installedVersion: rec.installedVersion,
        enabled: rec.enabled,
      });
      curseur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function installedPluginGet(
  userId: string,
  slug: string
): Promise<InstalledPluginRecord | null> {
  requireIdb();
  const db = await openDb();
  const value = await request(
    db.transaction(STORE, 'readonly').objectStore(STORE).get(keyOf(userId, slug))
  );
  return (value as InstalledPluginRecord | undefined) ?? null;
}

export async function installedPluginPut(
  userId: string,
  rec: InstalledPluginRecord
): Promise<void> {
  requireIdb();
  const db = await openDb();
  await request(
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec, keyOf(userId, rec.slug))
  );
}

export async function installedPluginDelete(userId: string, slug: string): Promise<void> {
  requireIdb();
  const db = await openDb();
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(keyOf(userId, slug)));
}

export async function installedPluginSetEnabled(
  userId: string,
  slug: string,
  enabled: boolean
): Promise<void> {
  const rec = await installedPluginGet(userId, slug);
  if (!rec) return;
  await installedPluginPut(userId, { ...rec, enabled });
}
