/**
 * Gestionnaires web des six canaux share:* — le partage par lien dans le navigateur.
 *
 * CE QUE LEUR ABSENCE COÛTAIT. Les six canaux étaient classés « portables »
 * (channelClassification, palier M2) depuis le début, la cryptographie du
 * partage est du pur WebCrypto côté renderer, le Worker expose toutes les
 * routes — et aucun gestionnaire n'existait. Le geste n°1 du produit, créer un
 * lien, échouait donc sur le web en « canal inconnu », pendant que le bureau le
 * faisait à trois fichiers de là avec les MÊMES routes.
 *
 * Chaque gestionnaire est un relais fidèle de son jumeau Electron
 * (electron/shareService.ts) : mêmes chemins, mêmes formes de réponse
 * `{success, data?}|{success, error}` — le renderer ne doit pas savoir sur
 * quelle plateforme il tourne.
 */

import { apiFetch, ensureAccessToken, resolveApiBase } from '../webApiBase';

/** PUT binaire — hors apiFetch, qui sérialise tout corps en JSON. */
async function putBinary(
  path: string,
  bytes: Uint8Array
): Promise<{ ok: boolean; status: number }> {
  // Renouvelé si l'échéance est passée : un envoi de partage lancé après un
  // quart d'heure d'onglet ouvert partait sinon avec un jeton mort, et le
  // chunk se perdait sur un 401 que personne ne rattrapait.
  const token = await ensureAccessToken();
  if (!token) return { ok: false, status: 401 };
  const res = await fetch(`${resolveApiBase()}${path}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  });
  return { ok: res.ok, status: res.status };
}

function échec(error: string): { success: false; error: string } {
  return { success: false, error };
}

export const shareApiHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'share:create': async (input: unknown) => {
    const res = await apiFetch<{ data?: unknown }>('/sync/share', { method: 'POST', body: input });
    if (res.status === 200 && res.body?.success && res.body.data) {
      return { success: true, data: res.body.data };
    }
    return échec((res.body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`);
  },

  'share:uploadChunk': async (shareId: unknown, chunkIndex: unknown, blob: unknown) => {
    if (typeof shareId !== 'string' || typeof chunkIndex !== 'number') {
      return échec('Invalid arguments');
    }
    // Electron sérialise un Buffer en Uint8Array à travers l'IPC ; le pont web
    // livre la même forme. On accepte aussi un ArrayBuffer nu par tolérance.
    const bytes =
      blob instanceof Uint8Array ? blob : blob instanceof ArrayBuffer ? new Uint8Array(blob) : null;
    if (!bytes) return échec('Chunk body must be bytes');
    const res = await putBinary(
      `/sync/share/${encodeURIComponent(shareId)}/upload/${chunkIndex}`,
      bytes
    );
    return res.ok ? { success: true } : échec(`HTTP ${res.status}`);
  },

  'share:finalize': async (shareId: unknown) => {
    if (typeof shareId !== 'string') return échec('Invalid shareId');
    const res = await apiFetch<{ data?: unknown }>(
      `/sync/share/${encodeURIComponent(shareId)}/finalize`,
      { method: 'POST' }
    );
    return res.status === 200 && res.body?.success
      ? { success: true, data: res.body.data }
      : échec((res.body as { error?: string } | undefined)?.error ?? `HTTP ${res.status}`);
  },

  // Le Worker répond `data: { shares: [...] }` (share.ts, GET /sync/share) ;
  // le jumeau Electron DÉBALLE ce `.shares` avant de rendre la main
  // (electron/shareService.ts listShares). Relayer l'enveloppe telle quelle
  // faisait arriver un OBJET là où le renderer attend un tableau : le
  // `items.filter(...)` de SharesManagementSection lâchait toute la page de
  // réglages sur « i.filter is not a function ». Même déballage ici.
  'share:list': async () => {
    const res = await apiFetch<{ data?: { shares?: unknown[] } }>('/sync/share');
    return res.status === 200 && res.body?.success
      ? { success: true, data: res.body.data?.shares ?? [] }
      : échec(`HTTP ${res.status}`);
  },

  // `revoked` est au PREMIER niveau chez le jumeau Electron, pas dans `data` —
  // c'est ce drapeau que `revokeShare()` du renderer relit.
  'share:revoke': async (shareId: unknown) => {
    if (typeof shareId !== 'string') return échec('Invalid shareId');
    const res = await apiFetch<{ data?: { revoked?: boolean } }>(
      `/sync/share/${encodeURIComponent(shareId)}`,
      { method: 'DELETE' }
    );
    return res.status === 200 && res.body?.success
      ? { success: true, revoked: res.body.data?.revoked === true }
      : échec(`HTTP ${res.status}`);
  },

  // Partie PUBLIQUE de la clé de custody du compte. Le renderer s'en sert pour
  // sceller K_share avant la création — sans elle, le partage reste prisonnier
  // de l'appareil qui l'a créé. `null` = coffre pas encore configuré : ce n'est
  // pas une erreur, la création continue sans scellement.
  'share:custodyKey': async () => {
    const res = await apiFetch<{ data?: { custodyPublicKey?: string } | null }>(
      '/account/custody-key'
    );
    return res.status === 200 && res.body?.success
      ? { success: true, data: res.body.data?.custodyPublicKey ?? null }
      : échec(`HTTP ${res.status}`);
  },

  // Même enveloppe que la liste : le Worker rend `data: { views: [...] }`.
  'share:listViews': async (shareId: unknown) => {
    if (typeof shareId !== 'string') return échec('Invalid shareId');
    const res = await apiFetch<{ data?: { views?: unknown[] } }>(
      `/sync/share/${encodeURIComponent(shareId)}/views`
    );
    return res.status === 200 && res.body?.success
      ? { success: true, data: res.body.data?.views ?? [] }
      : échec(`HTTP ${res.status}`);
  },
};
