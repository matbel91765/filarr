/**
 * Mini-helper IndexedDB du dispatcher web — un seul store clé/valeur.
 * Pas de dépendance : la surface nécessaire (get/put/delete) tient en 60 lignes.
 */

const DB_NAME = 'filarr-web';
const STORE = 'kv';
const DB_VERSION = 1;

let _db: Promise<IDBDatabase> | null = null;

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

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const value = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  return (value as T | undefined) ?? null;
}

export async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
}

export async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
}

export async function idbKeys(): Promise<string[]> {
  const db = await openDb();
  const keys = await request(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
  return keys.map(String);
}
