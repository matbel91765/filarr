/**
 * Les routes de la clé de garde, vues du renderer — couche mince sur l'IPC.
 *
 * Le jeton porteur vit dans le processus principal ; ces appels ne sont donc
 * que des relais typés. Sur le web, le même canal est servi par
 * `platform/web/handlers/custodyLabelHandlers.ts` : le renderer ne sait pas, et
 * n'a pas à savoir, sur quelle plateforme il tourne.
 *
 * RÈGLE COMMUNE À TOUS : une PANNE remonte en exception, une ABSENCE rend
 * `null`. C'est la distinction la plus coûteuse à rater du lot — « ce compte
 * n'a pas de clé de garde » et « je n'ai pas pu demander » mènent à deux
 * écrans opposés, et confondre les deux enverrait créer un coffre à quelqu'un
 * qui en a déjà un.
 */

import { isCustodyKeyMaterial, type CustodyKeyMaterial } from './custodyFormat';

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function bridge(): Bridge | null {
  return window.electron?.ipcRenderer ?? null;
}

type Envelope<T> = { success?: boolean; data?: T; error?: string } | undefined;

/**
 * Matériel COMPLET de la clé de garde, ou `null` quand le compte n'en a pas.
 * LÈVE sur panne — voir la règle commune ci-dessus.
 */
export async function fetchCustodyKey(): Promise<CustodyKeyMaterial | null> {
  const ipc = bridge();
  if (!ipc) throw new Error('CUSTODY_BRIDGE_UNAVAILABLE');
  const res = (await ipc.invoke('custody:key')) as Envelope<CustodyKeyMaterial | null>;
  if (!res?.success) throw new Error(res?.error || 'CUSTODY_KEY_FETCH_FAILED');
  // Une clé MAL FORMÉE vaut une absence : l'écran doit pouvoir le dire sans
  // tomber, et le bureau ne sait de toute façon pas en créer une.
  return isCustodyKeyMaterial(res.data) ? res.data : null;
}

/** Un libellé scellé tel qu'il vient du listing du compte. */
export interface ShareLabelRow {
  id: string;
  wrappedLabel: string | null;
}

export interface ShareLabelListing {
  /** Envois du COMPTE — `ephemeral_shares`, créés sur filarr.com. */
  sends: ShareLabelRow[];
  /** Envois de l'APPLICATION — `shares`, créés par `POST /sync/share`. */
  appSends: ShareLabelRow[];
  /** Demandes de fichiers du compte. */
  requests: ShareLabelRow[];
  /** Cf. `electron/custodyService.ts` — et ce que ce drapeau ne prouve pas. */
  serverKnowsAppLabels: boolean;
}

const EMPTY_LISTING: ShareLabelListing = {
  sends: [],
  appSends: [],
  requests: [],
  serverKnowsAppLabels: false,
};

function toRows(value: unknown): ShareLabelRow[] {
  if (!Array.isArray(value)) return [];
  const out: ShareLabelRow[] = [];
  for (const r of value as { id?: unknown; wrappedLabel?: unknown }[]) {
    if (typeof r?.id !== 'string' || r.id.length === 0) continue;
    out.push({
      id: r.id,
      wrappedLabel:
        typeof r.wrappedLabel === 'string' && r.wrappedLabel.length > 0 ? r.wrappedLabel : null,
    });
  }
  return out;
}

/**
 * Libellés scellés de tous les partages du compte.
 *
 * LÈVE sur panne. Une liste vide et un échec ne se disent PAS pareil à
 * l'écran : la première signifie « aucun nom posé », le second « je ne sais
 * pas », et effacer les noms locaux sur le second serait une perte de données
 * causée par une coupure réseau.
 */
export async function fetchShareLabels(): Promise<ShareLabelListing> {
  const ipc = bridge();
  if (!ipc) throw new Error('CUSTODY_BRIDGE_UNAVAILABLE');
  const res = (await ipc.invoke('custody:shareLabels')) as Envelope<Partial<ShareLabelListing>>;
  if (!res?.success || !res.data) throw new Error(res?.error || 'SHARE_LABELS_FETCH_FAILED');
  return {
    ...EMPTY_LISTING,
    sends: toRows(res.data.sends),
    appSends: toRows(res.data.appSends),
    requests: toRows(res.data.requests),
    serverKnowsAppLabels: res.data.serverKnowsAppLabels === true,
  };
}

export type ShareKind = 'send' | 'request';

/**
 * Pose (ou efface avec `null`) le libellé scellé d'un partage.
 *
 * Rend `'not-found'` sur 404 — un RÉSULTAT, pas une panne : ce serveur ne sait
 * pas ranger ce libellé-là (identifiant inconnu, ou colonne pas encore
 * migrée). LÈVE sur tout le reste.
 */
export async function putShareLabel(
  kind: ShareKind,
  shareId: string,
  wrappedLabel: string | null
): Promise<'saved' | 'not-found'> {
  const ipc = bridge();
  if (!ipc) throw new Error('CUSTODY_BRIDGE_UNAVAILABLE');
  const res = (await ipc.invoke('custody:setLabel', kind, shareId, wrappedLabel)) as Envelope<
    'saved' | 'not-found'
  >;
  if (!res?.success) throw new Error(res?.error || 'SHARE_LABEL_SAVE_FAILED');
  return res.data === 'not-found' ? 'not-found' : 'saved';
}
