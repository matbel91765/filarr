/**
 * LE RANGEMENT DES NOTES, VU DE L'ÉCRAN — bureau et navigateur.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 *
 * `NotesFormatSection` parlait en IPC, donc au bureau seulement. Sur le web
 * l'appel échouait, la section rendait `null`, et la bascule v1 → v2 était
 * simplement HORS D'ATTEINTE pour qui n'utilise Filarr que dans son navigateur :
 * il lui aurait fallu installer l'application de bureau pour ranger des notes
 * qu'il n'y ouvrira jamais.
 *
 * Ce module est la couture. Deux questions, deux réponses, une par plateforme —
 * et le même écran au-dessus, qui n'a pas à savoir laquelle il a obtenue.
 *
 * ⚠ `window.electron.ipcRenderer` EXISTE SUR app.filarr.com (c'est un shim).
 * Sa présence ne prouve donc RIEN, et l'aiguillage se fait sur `isWebPlatform()`
 * — jamais sur l'existence du canal.
 *
 * Les modules web sont chargés en `import()` DIFFÉRÉ : ils touchent IndexedDB et
 * le réseau au montage, et il n'y a aucune raison de payer ça dans le paquet de
 * bureau, qui n'y entrera jamais.
 */

import { isWebPlatform } from '../platform/isWebPlatform';

export type NotesVaultFormat = 'none' | 'v1' | 'v2';
export type NotesLegacyVerdict = 'safe' | 'legacy-active' | 'unknown';

export interface NotesFormatState {
  format: NotesVaultFormat;
  verdict: NotesLegacyVerdict;
}

export interface MigrationOutcome {
  ok: boolean;
  why?: string;
  noteCount?: number;
}

/**
 * L'ÉTAT DU RANGEMENT — ou `null` quand on n'a pas su le lire.
 *
 * `null` n'est PAS « v1 » : la section se cache plutôt que d'annoncer un format
 * qu'elle n'a pas constaté. Proposer une bascule sur une supposition serait
 * proposer de réécrire un coffre dont on ignore l'état.
 */
export async function readNotesFormat(): Promise<NotesFormatState | null> {
  if (isWebPlatform()) {
    try {
      const [{ webLegacyNotesVerdict, webVaultFormat }, { getCachedManifest }] = await Promise.all([
        import('../../platform/web/sync/webNotesCycleV2'),
        import('../../platform/web/sync/readSync'),
      ]);
      return {
        format: await webVaultFormat(),
        // Pas de manifeste en cache = aucun cycle n'a encore vu le nuage. La
        // règle rend alors `unknown`, donc le bouton refuse : c'est l'état d'un
        // onglet qui vient de s'ouvrir, et il se résout tout seul.
        verdict: webLegacyNotesVerdict(getCachedManifest()),
      };
    } catch {
      return null;
    }
  }

  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return null;
  try {
    const res = (await ipc.invoke('notes:vaultFormat')) as NotesFormatState | undefined;
    return res ? { format: res.format, verdict: res.verdict } : null;
  } catch {
    return null;
  }
}

/**
 * BASCULE, SI LE VERDICT L'AUTORISE.
 *
 * ⚠ LE VERDICT EST RELU ICI, il n'est pas repris de l'écran. Entre le moment où
 * la section s'est peinte et celui où quelqu'un clique, un autre appareil a pu
 * réécrire `meta:notes` — et c'est précisément le cas que le garde-fou existe
 * pour attraper. Décider sur un verdict affiché, ce serait décider sur le passé.
 */
export interface MigrateNotesOptions {
  /** Basculer bien qu'un autre appareil ecrive encore a l'ancien format (le pont le servira). */
  acknowledgeLegacyWriter?: boolean;
}

export async function migrateNotesToV2(opts: MigrateNotesOptions = {}): Promise<MigrationOutcome> {
  if (isWebPlatform()) {
    try {
      const [{ migrateWebVaultToV2, webLegacyNotesVerdict }, { getCachedManifest }] =
        await Promise.all([
          import('../../platform/web/sync/webNotesCycleV2'),
          import('../../platform/web/sync/readSync'),
        ]);
      return migrateWebVaultToV2(webLegacyNotesVerdict(getCachedManifest()), undefined, opts);
    } catch (err) {
      return { ok: false, why: (err as Error).message || 'web-failed' };
    }
  }

  const ipc = window.electron?.ipcRenderer;
  if (!ipc) return { ok: false, why: 'no-ipc' };
  try {
    return ((await ipc.invoke('notes:migrateV2', opts)) as MigrationOutcome) ?? { ok: false };
  } catch (err) {
    return { ok: false, why: (err as Error).message || 'ipc-failed' };
  }
}
