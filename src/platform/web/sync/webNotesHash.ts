/**
 * LES EMPREINTES DU COFFRE v2, VERSION NAVIGATEUR — module PUR.
 *
 * ═══ POURQUOI UN FICHIER À PART ═══
 *
 * Ces fonctions n'ont besoin que de `crypto.subtle`, qui existe partout (Node
 * compris). Les laisser dans `webNotesCycleV2.ts` les liait à IndexedDB, au
 * réseau et à `window` — et tout test qui voulait seulement comparer une
 * empreinte à celle du bureau tirait le monde navigateur entier dans une
 * compilation qui ne le connaît pas.
 *
 * ⚠ CHAQUE FONCTION DOIT RENDRE LA MÊME VALEUR QUE LE BUREAU. Ce sont des
 * IDENTIFIANTS partagés entre plateformes : une divergence ferait voir deux
 * contenus différents là où il n'y en a qu'un, et les deux côtés se
 * renverraient l'objet indéfiniment. La parité est éprouvée dans
 * `notesStoreV2Parity.vitest.ts`.
 */

import type { NoteRecord, SplitDeps } from './notesStoreV2';

function asArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sérialisation à clés TRIÉES — miroir de `stableStringify` (bureau).
 * `JSON.stringify` suit l'ordre d'insertion : deux appareils qui ont construit
 * la même note par des chemins différents produiraient des chaînes différentes.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** Empreinte du clair d'une note — miroir de `digestOf` (bureau) : SHA-256, 16 octets. */
export async function digestOfAsync(note: NoteRecord): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(note));
  const d = await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes));
  return hex(new Uint8Array(d).slice(0, 16));
}

/** Empreinte d'une IMAGE — miroir de `blobHash` (bureau) : SHA-256 de la charge base64, 32 hex. */
export async function webBlobHash(base64: string): Promise<string> {
  const bytes = new TextEncoder().encode(base64);
  const d = await crypto.subtle.digest('SHA-256', asArrayBuffer(bytes));
  return hex(new Uint8Array(d)).slice(0, 32);
}

/**
 * `digestOf` est SYNCHRONE dans `SplitDeps` (le bureau utilise `node:crypto`),
 * alors que `crypto.subtle` est asynchrone. On pré-calcule donc les empreintes
 * des notes qu'on s'apprête à traiter, et la fonction injectée ne fait que les
 * relire. Une note absente du pré-calcul rend une empreinte VIDE — c'est ce que
 * les contrats de migration vérifient ne jamais arriver.
 */
export async function makeSplitDeps(notes: Record<string, NoteRecord>): Promise<SplitDeps> {
  const cache = new Map<string, string>();
  for (const [id, note] of Object.entries(notes)) {
    cache.set(id, await digestOfAsync(note));
  }
  return {
    digestOf: (note: NoteRecord) => {
      const id = typeof note.id === 'string' ? note.id : '';
      return cache.get(id) ?? '';
    },
    newObjectId: () => crypto.randomUUID().replace(/-/g, '').slice(0, 22),
  };
}
