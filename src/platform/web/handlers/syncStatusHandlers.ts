/**
 * Handlers web des canaux de STATUT sync + verrou renforcé — implémentations
 * M1 honnêtes en attendant le moteur de sync web (M3).
 *
 * Nécessité découverte au premier test réel : le finish de l'onboarding
 * (Onboarding.tsx:770) AWAIT `sync:setEnabled` dans son chemin fatal — sans
 * handler, l'onboarding entier échoue. La préférence est écrite avec la même
 * clé de flag que le desktop (`sync-paused[-profileId]`, main.ts:3614-3624)
 * pour que le moteur M3 la retrouve telle quelle ; il n'y a simplement pas
 * encore de démon à démarrer.
 */

import { idbGet } from '../idb';
import { getSyncState, isCycleInFlight } from '../sync/readSync';

const FLAGS_KEY = 'filarr-web-flags';

function readFlags(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeFlags(flags: Record<string, string>): void {
  try {
    localStorage.setItem(FLAGS_KEY, JSON.stringify(flags));
  } catch {
    /* préférence reconstructible */
  }
}

async function activeProfileId(): Promise<string | null> {
  const manifest = await idbGet<{ activeProfileId: string | null }>('profiles_manifest');
  return manifest?.activeProfileId ?? null;
}

export const syncStatusHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'sync:setEnabled': async (enabled: unknown) => {
    const flags = readFlags();
    const profileId = await activeProfileId();
    const key = profileId ? `sync-paused-${profileId}` : 'sync-paused';
    if (enabled) {
      delete flags[key];
      if (profileId) delete flags['sync-paused'];
    } else {
      flags[key] = 'true';
    }
    writeFlags(flags);
    // Pas de démon à (re)démarrer avant M3 — la préférence est posée, c'est tout.
  },

  // Même forme que syncService.getSyncStatus() (electron/sync/syncService.ts:330-343).
  'sync:getStatus': async () => {
    const state = await getSyncState();
    const { getPendingUploads } = await import('../sync/pendingUploads');
    const pending = await getPendingUploads().catch(() => ({}));
    return {
      // Le montage du renderer ne doit pas effacer un cycle en cours.
      state: isCycleInFlight() ? 'syncing' : 'idle',
      lastSyncAt: state?.lastPullAt ?? null,
      pendingItems: Object.keys(pending).length,
      failedItems: 0,
      conflicts: 0,
      storageUsed: 0,
      storageLimit: 0,
    };
  },

  // Déclenche un cycle complet (pull → fusion → push) — c'est LE bouton
  // « Synchroniser » du renderer. Il passe par l'ordonnanceur, jamais par
  // `pullFromCloud` en direct : dans un onglet SUIVEUR, cycler ici pousserait
  // en même temps que le meneur (deux CAS concurrents sur le même manifeste),
  // et l'élection existe précisément pour l'empêcher. `requestManualSync`
  // délègue alors au meneur et rapporte SON verdict ; partout ailleurs il cycle
  // ici, en rejoignant le cycle en vol s'il y en a un.
  'sync:triggerSync': async (profileIdArg?: unknown) => {
    const explicit = profileIdArg ? String(profileIdArg) : undefined;
    const { requestManualSync } = await import('../sync/syncScheduler');
    return requestManualSync(explicit);
  },

  // Statuts réels, indexés par fileId ET localPath (le renderer utilise les
  // deux — electronMiddleware.ts:267-273) : pending prime, sinon le statut du
  // manifeste cloud pour les fichiers connus du cycle.
  'sync:getAllFileStatuses': async () => {
    const statuses: Record<string, string> = {};
    try {
      const { getPendingUploads } = await import('../sync/pendingUploads');
      const { deriveFileId, loadCachedManifest } = await import('../sync/readSync');
      const { storeGet } = await import('../webStore');
      const pending = await getPendingUploads();
      // Dépôt PARTAGÉ : dans un onglet suiveur, le cache mémoire du manifeste
      // est vide (seul le meneur cycle) et tous les statuts cloud manquaient.
      const manifest = await loadCachedManifest();
      const folders =
        (await storeGet<Record<string, { id: string; items?: Array<{ name?: string }> }>>(
          'folders'
        )) ?? {};
      for (const folder of Object.values(folders)) {
        for (const item of folder.items ?? []) {
          if (!item?.name) continue;
          const fileId = await deriveFileId(folder.id, item.name);
          const localPath = `${folder.id}/${item.name}`;
          const status = pending[fileId]
            ? pending[fileId].kind === 'delete'
              ? 'deleted'
              : 'pending_upload'
            : (manifest?.files[fileId]?.status ?? null);
          if (status) {
            statuses[fileId] = status;
            statuses[localPath] = status;
          }
        }
      }
    } catch {
      /* meilleur effort : la carte peut être partielle */
    }
    return statuses;
  },

  // Panneau « Activité de sync » — même forme que le handler desktop
  // (main.ts, 'sync:getActivity'), composée des primitives web : le manifeste
  // nuage en cache pour les transferts aboutis et les conflits, le registre des
  // remontées en attente pour la file locale. `failed` est TOUJOURS vide : la
  // file de retry persistante est un objet du processus principal, le web
  // réessaie au cycle suivant sans rien garder. Une liste vide dit la vérité —
  // absente, elle aurait cassé le panneau.
  'sync:getActivity': async () => {
    const empty = { recent: [], pending: [], conflicts: [], failed: [] };
    try {
      const { getPendingUploads } = await import('../sync/pendingUploads');
      const { loadCachedManifest } = await import('../sync/readSync');
      const [manifest, pendingMap] = await Promise.all([loadCachedManifest(), getPendingUploads()]);

      const toItem = (fileId: string, entry: Record<string, unknown>) => ({
        fileId,
        name:
          String(entry.localPath ?? '')
            .split('/')
            .pop() || fileId,
        localPath: entry.localPath as string | undefined,
        size: typeof entry.size === 'number' ? entry.size : 0,
        status: String(entry.status ?? 'synced'),
        updatedAt: String(entry.updatedAt ?? ''),
        syncedAt: (entry.syncedAt as string | null) ?? null,
        lastDirection: entry.lastDirection as 'up' | 'down' | undefined,
      });

      const recent: ReturnType<typeof toItem>[] = [];
      const conflicts: ReturnType<typeof toItem>[] = [];
      for (const [fileId, entry] of Object.entries(manifest?.files ?? {})) {
        const item = toItem(fileId, entry as unknown as Record<string, unknown>);
        if (item.status === 'conflict') conflicts.push(item);
        else if (item.syncedAt && !pendingMap[fileId]) recent.push(item);
      }

      const pending = Object.entries(pendingMap).map(([fileId, entry]) => {
        const known = manifest?.files[fileId] as unknown as Record<string, unknown> | undefined;
        const localPath =
          entry.folderId && entry.fileName
            ? `${entry.folderId}/${entry.fileName}`
            : (known?.localPath as string | undefined);
        return {
          fileId,
          name: entry.fileName || localPath?.split('/').pop() || fileId,
          localPath,
          size: typeof known?.size === 'number' ? (known.size as number) : 0,
          status: entry.kind === 'delete' ? 'deleted' : 'pending_upload',
          updatedAt: entry.markedAt,
          syncedAt: (known?.syncedAt as string | null) ?? null,
          lastDirection: undefined as 'up' | 'down' | undefined,
        };
      });

      const desc = (a: string | null, b: string | null) =>
        (b ? Date.parse(b) || 0 : 0) - (a ? Date.parse(a) || 0 : 0);
      recent.sort((a, b) => desc(a.syncedAt, b.syncedAt));
      pending.sort((a, b) => desc(a.updatedAt, b.updatedAt));
      conflicts.sort((a, b) => desc(a.updatedAt, b.updatedAt));

      return {
        recent: recent.slice(0, 100),
        pending: pending.slice(0, 100),
        conflicts: conflicts.slice(0, 100),
        failed: [],
      };
    } catch {
      // Coffre verrouillé / manifeste illisible : un panneau vide, jamais une
      // erreur de canal.
      return empty;
    }
  },

  // Le verrou renforcé repose sur safeStorage (efface .fek_safe à la fermeture) :
  // sans équivalent web, il est simplement absent — false, comme un profil qui
  // ne l'a jamais activé.
  'security:getEnhancedLock': async () => false,

  // Deux canaux HORS allowlist du preload (ils échouent aussi sur desktop) que
  // le renderer appelle quand même — handlers bénins pour une console propre :
  // App.tsx interroge security:fekStatus au pre-check (réponse honnête : rien
  // au repos côté main sur web), et le reporter d'erreurs Redux pousse
  // redux-error (relayé en console au lieu d'une erreur de canal).
  'security:fekStatus': async () => ({ active: false, source: null }),

  // Notes en session vivante. Sur desktop ce canal traverse l'IPC parce que la
  // fusion tourne dans le processus principal ; sur le web, elle tourne DANS ce
  // renderer et lit directement le registre. Le handler existe pour que la
  // publication soit un succès des deux côtés, sans erreur de canal à chaque
  // ouverture de note.
  //
  // L'instantané est AUSSI déposé dans le store du profil : le cycle de sync ne
  // tourne que chez l'onglet MENEUR, alors que la note peut être ouverte dans un
  // autre onglet — qui partage pourtant le même `notes_enc`. Sans ce dépôt, le
  // meneur ne voyait aucune session et fabriquait une copie de conflit par cycle
  // pour la note que le voisin était en train d'écrire.
  'collab:setLiveNotes': async (noteIds: unknown) => {
    const ids = Array.isArray(noteIds) ? (noteIds as string[]) : [];
    const { setLiveNotes } = await import('../../../services/collab/liveNoteRegistry');
    setLiveNotes(ids);
    const { publishLiveNotesSnapshot } = await import('../sync/readSync');
    await publishLiveNotesSnapshot(ids);
    return true;
  },
  'redux-error': async (payload: unknown) => {
    console.warn('[redux-error]', payload);
  },
};
