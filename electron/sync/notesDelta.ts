/**
 * APPLICATION D'UN DELTA DE NOTES sur un coffre déjà déchiffré — logique PURE
 * du processus principal (aucun `fs`, aucun `electron`, aucun état de module).
 *
 * POURQUOI CE MODULE EXISTE. L'auto-save envoyait le coffre ENTIER à chaque
 * écriture : sur un coffre de 70 Mo (images en data-URL), le renderer payait la
 * sérialisation deux fois (contextBridge puis IPC) — 93-149 ms de fil d'exécution
 * FIGÉ — et le main payait la désérialisation symétrique. Ces deux immobilisations
 * tombaient pile sur le clic qui suit un glissement (debounce de 2 s), d'où le
 * « gel à la sélection ». Un delta ne transporte que les notes RÉELLEMENT touchées :
 * quelques Ko pour un déplacement.
 *
 * CE QUE LE FORMAT DE `notes.enc` DEVIENT : rien. Le delta est un protocole de
 * TRANSPORT, pas un format de stockage — le fichier reste le même objet complet,
 * scellé par `encryptToFile` comme avant. Un lecteur d'une version antérieure lit
 * donc toujours le fichier.
 *
 * DEUX RÈGLES DE SÛRETÉ, qui sont toute la raison d'être de ce fichier :
 *
 *  1. RIEN NE DISPARAÎT SANS ÊTRE NOMMÉ. Une note présente dans la base et
 *     absente du delta est CONSERVÉE. C'est strictement plus sûr que la
 *     sauvegarde pleine, qui reconstruit le payload depuis Redux et efface donc
 *     tout ce que le renderer ignore encore — les copies de conflit fabriquées
 *     par la fusion du cycle de sync, par exemple (voir `downloadAndMergeNotes`).
 *     Seul `removedIds` retire quelque chose.
 *
 *  2. LA FORME ÉCRITE EST CELLE DE LA SAUVEGARDE PLEINE, au champ et à l'ordre
 *     de clé près (`byId`, `allIds`, `templates`, `notebooks`, [`purged`],
 *     [`purgedNotebooks`], `skipVersioning`). Toute divergence de forme fait voir
 *     à chaque côté de la synchronisation une différence que l'autre ne voit pas :
 *     la fusion trouve du « neuf » à chaque cycle et les appareils se renvoient le
 *     coffre indéfiniment. Même exigence que le miroir web (webStorageHandlers).
 *
 * Jumeau du module web `src/platform/web/sync/notesDelta.ts`, volontairement
 * DUPLIQUÉ pour la même raison que `notesLock.ts` : `electron/tsconfig.json` a
 * pour racine `electron/`, importer un module de `src/` déplacerait toute
 * l'arborescence émise dans `dist-electron`.
 */

/** Une note, vue d'ici : un objet opaque dont on ne lit que `deletedAt`. */
export type NoteRecord = Record<string, unknown>;

/** Le coffre tel qu'il vit dans `notes.enc` (et dans le cache mémoire du main). */
export interface NotesVaultPayload {
  byId: Record<string, NoteRecord>;
  allIds: string[];
  templates?: unknown[];
  notebooks?: Record<string, unknown>;
  purged?: Record<string, string>;
  purgedNotebooks?: Record<string, string>;
  skipVersioning?: boolean;
  [key: string]: unknown;
}

/** Charge utile du canal `notes:saveDelta`. */
export interface NotesDeltaPayload {
  /** Notes touchées depuis la dernière écriture, entières. */
  dirtyById: Record<string, NoteRecord>;
  /** Notes SUPPRIMÉES DÉFINITIVEMENT (la corbeille, elle, passe par `dirtyById`). */
  removedIds: string[];
  /** Ordre d'affichage faisant autorité côté renderer. */
  allIds: string[];
  /**
   * PAR NOTE SALE, L'`updatedAt` QUE LE RENDERER AVAIT SOUS LES YEUX AVANT DE
   * LA MODIFIER — sa BASE. C'est ce qui rend l'écriture vérifiable.
   *
   * Sans lui, `notes:saveDelta` est un ordre : « mets cette note-là ». Le
   * renderer peut donc réécrire une note que la fusion de la synchronisation
   * venait de rafraîchir sur le disque, et le nuage reçoit ensuite la
   * régression comme si elle était neuve (cas réel du 2026-09-02 : 613 586
   * octets rendus au néant, puis remontés). Avec lui, l'écriture devient une
   * proposition : « je pars de cette version-ci ». Le main peut la refuser.
   *
   * `null` = le renderer n'avait AUCUNE copie (note neuve). Clé absente = ce
   * renderer ne déclare rien pour cette note et la garde ne s'applique pas —
   * c'est le comportement d'avant, conservé pour qu'un preload plus ancien ou
   * un chemin d'écriture non instrumenté ne se retrouve pas bloqué.
   */
  baseUpdatedAt?: Record<string, string | null>;
  templates?: unknown[];
  notebooks?: Record<string, unknown>;
  purged?: Record<string, string>;
  purgedNotebooks?: Record<string, string>;
  skipVersioning?: boolean;
}

/**
 * Le delta a-t-il la forme attendue ? Un delta malformé ne doit JAMAIS produire
 * une écriture partielle : l'appelant retombe sur une sauvegarde pleine.
 */
export function isWellFormedNotesDelta(value: unknown): value is NotesDeltaPayload {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<NotesDeltaPayload>;
  if (!d.dirtyById || typeof d.dirtyById !== 'object' || Array.isArray(d.dirtyById)) return false;
  if (!Array.isArray(d.removedIds)) return false;
  if (!Array.isArray(d.allIds)) return false;
  return true;
}

/**
 * La base relue (cache ou disque) est-elle un coffre exploitable ? Un `byId`
 * absent ou un `allIds` qui n'est pas un tableau = on ne sait pas sur quoi
 * appliquer le delta, donc on ne l'applique pas.
 */
export function isUsableNotesBase(value: unknown): value is NotesVaultPayload {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<NotesVaultPayload>;
  if (!b.byId || typeof b.byId !== 'object' || Array.isArray(b.byId)) return false;
  if (!Array.isArray(b.allIds)) return false;
  return true;
}

/** Horloge d'une entrée : la plus récente de ses dates de mutation, ou -∞. */
function deltaClock(entry: unknown): number {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return -Infinity;
  const rec = entry as Record<string, unknown>;
  let best = -Infinity;
  for (const field of ['updatedAt', 'deletedAt']) {
    const raw = rec[field];
    if (typeof raw !== 'string') continue;
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return best;
}

/** Horloge d'une base DÉCLARÉE (un `updatedAt` seul, ou rien). */
function declaredClock(raw: string | null | undefined): number {
  if (typeof raw !== 'string') return -Infinity;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? -Infinity : ms;
}

/**
 * LES NOTES DU DELTA QUI ARRIVENT TROP TARD — le cœur de la garde.
 *
 * Une note est REFUSÉE quand le disque a AVANCÉ sous les pieds du renderer :
 * l'entrée présente dans la base porte une horloge STRICTEMENT plus récente que
 * celle que le renderer a déclarée comme point de départ. C'est exactement la
 * situation où écrire détruit du texte que personne n'a demandé à perdre — la
 * fusion de la descente vient de rapatrier une version plus fraîche, et le
 * renderer, lui, édite encore l'ancienne.
 *
 * TROIS SITUATIONS NE SONT PAS DES REFUS, délibérément :
 *  - aucune base déclarée pour cette note (clé absente) : rien à vérifier ;
 *  - la note n'existe pas dans la base : c'est un AJOUT, il ne détruit rien ;
 *  - le disque est ÉGAL ou EN RETARD sur la base déclarée : le renderer part
 *    bien de ce que le disque porte (ou de plus frais), il a le dernier mot.
 *
 * `removedIds` N'EST PAS GARDÉ. Une purge est un geste explicite de
 * l'utilisateur ; la refuser ressusciterait des notes délibérément détruites,
 * ce qui serait un défaut pire que celui qu'on corrige ici.
 */
export function selectStaleDeltaEntries(
  base: NotesVaultPayload,
  delta: NotesDeltaPayload
): string[] {
  const declared = delta.baseUpdatedAt;
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return [];
  const stale: string[] = [];
  for (const id of Object.keys(delta.dirtyById)) {
    if (!Object.prototype.hasOwnProperty.call(declared, id)) continue;
    const current = base.byId[id];
    if (current === undefined) continue;
    if (deltaClock(current) > declaredClock(declared[id])) stale.push(id);
  }
  return stale;
}

/**
 * Applique `delta` à `base` et rend un coffre NEUF (la base n'est jamais mutée :
 * si l'écriture échoue, le cache mémoire reste ce qu'il était, donc cohérent avec
 * le fichier resté intact).
 *
 * Les notes que `selectStaleDeltaEntries` désigne sont SAUTÉES : la base garde
 * la sienne. L'appelant doit alors faire recharger le renderer — voir
 * `notes:saveDelta` dans main.ts.
 */
export function applyNotesDelta(
  base: NotesVaultPayload,
  delta: NotesDeltaPayload
): NotesVaultPayload {
  const byId: Record<string, NoteRecord> = { ...base.byId };
  const stale = new Set(selectStaleDeltaEntries(base, delta));

  // Les retraits d'abord : un id présent dans les deux listes est donc RÉÉCRIT,
  // pas effacé — le renderer peut avoir purgé puis recréé la même identité.
  for (const id of delta.removedIds) delete byId[id];
  for (const id of Object.keys(delta.dirtyById)) {
    if (stale.has(id)) continue;
    const note = delta.dirtyById[id];
    if (note && typeof note === 'object') byId[id] = note;
  }

  // L'ordre du renderer fait autorité pour ce qu'il connaît ; ce qu'il ignore
  // encore (une copie de conflit tout juste fabriquée par la fusion) est
  // conservé à la suite plutôt que perdu — voir la règle 1 en tête de fichier.
  const allIds: string[] = [];
  const seen = new Set<string>();
  for (const id of delta.allIds) {
    if (byId[id] !== undefined && !seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(byId)) {
    if (!seen.has(id)) {
      allIds.push(id);
      seen.add(id);
    }
  }

  // Forme STRICTEMENT identique à celle de `notes:save` — même champs, même
  // ordre de clés (voir la règle 2 en tête de fichier).
  const purged = delta.purged;
  const purgedNotebooks = delta.purgedNotebooks;
  return {
    byId,
    allIds,
    templates: delta.templates ?? (base.templates as unknown[] | undefined) ?? [],
    notebooks: delta.notebooks ?? (base.notebooks as Record<string, unknown> | undefined) ?? {},
    ...(purged && Object.keys(purged).length > 0 ? { purged } : {}),
    ...(purgedNotebooks && Object.keys(purgedNotebooks).length > 0 ? { purgedNotebooks } : {}),
    skipVersioning: delta.skipVersioning === true,
  };
}

/**
 * Le coffre résultant est-il VIDE ? Même critère que la garde anti-vidage de
 * `notes:save` (ni `allIds` ni `byId`), reprise telle quelle : une base relue de
 * travers ne doit pas pouvoir écraser un fichier plein.
 */
export function isEmptyNotesVault(payload: NotesVaultPayload): boolean {
  return payload.allIds.length === 0 && Object.keys(payload.byId).length === 0;
}

/**
 * Les notes du delta qui méritent un instantané de version : les seules
 * réellement touchées, jamais tout le coffre. Un passage complet hachait et
 * sérialisait les 70 Mo à CHAQUE sauvegarde.
 */
export function snapshotInputsFromDelta(delta: NotesDeltaPayload): Array<{
  id: string;
  title: string;
  content: string;
  plainText: string;
  wordCount: number;
}> {
  const out: Array<{
    id: string;
    title: string;
    content: string;
    plainText: string;
    wordCount: number;
  }> = [];
  for (const id of Object.keys(delta.dirtyById)) {
    const n = delta.dirtyById[id] as Record<string, unknown> | undefined;
    if (!n || typeof n !== 'object') continue;
    if (n.deletedAt) continue;
    out.push({
      id: typeof n.id === 'string' ? n.id : id,
      title: typeof n.title === 'string' ? n.title : '',
      content: typeof n.content === 'string' ? n.content : '',
      plainText: typeof n.plainText === 'string' ? n.plainText : '',
      wordCount: typeof n.wordCount === 'number' ? n.wordCount : 0,
    });
  }
  return out;
}
