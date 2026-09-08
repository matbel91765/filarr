/**
 * Handlers web des canaux org:* dont le parcours PERSONNEL a besoin.
 *
 * POURQUOI CE FICHIER EXISTE. `org:list` n'était pas servi sur le web, donc
 * `fetchOrgs` jetait et `state.org.orgs` restait vide en permanence. Or c'est
 * de cette liste que dérivent `selectSharedVaultOrgIds` (les locataires à
 * interroger pour lister les coffres) et `selectIsSharedVaultGuest` (l'entrée
 * « Coffres partagés » d'un invité gratuit). Conséquence : sur app.filarr.com,
 * un coffre partagé par quelqu'un d'autre restait invisible MÊME après une
 * jointure réussie. Accepter une invitation sans cela, c'est réussir dans le
 * vide.
 *
 * PÉRIMÈTRE COMPLET DEPUIS L'OUVERTURE DE LA SURFACE. Ce fichier ne servait que
 * quatre canaux — la liste, l'acceptation d'invitation et le miroir du contexte —
 * parce que la console était fermée. Elle ne l'est plus : un administrateur sur
 * app.filarr.com voyait donc la marque de son espace, ses coffres, et une console
 * absente sans que rien ne le dise. Les seize canaux restants sont portés ici.
 *
 * TROIS FAMILLES, ET LA TROISIÈME NE RESSEMBLE PAS AUX AUTRES :
 *
 *   · membres, invitations, réglages, facturation → de simples appels HTTP, la
 *     route est org-scopée par son paramètre de chemin, rien à inventer ;
 *   · le contexte d'org (`getCurrent`/`setCurrent`) → une préférence d'appareil,
 *     miroir localStorage, aucune route serveur ;
 *   · le CACHE DE POLITIQUE (`policy:load/save/clear`) → sur le bureau c'est un
 *     fichier sur disque, ce que le navigateur n'a pas. C'est localStorage qui en
 *     tient lieu, avec la même forme de données. Ce cache est ce qui fait
 *     travailler l'application hors ligne sous les règles de son organisation :
 *     sans lui, un onglet sans réseau perdrait la politique et la fenêtre de
 *     grâce ne pourrait pas s'écouler.
 * Formes de retour identiques au main (electron/authService.ts) — `{ success,
 * data?, error?, code? }` — car le `code` du Worker est ce qui permet à l'écran
 * d'acceptation de dire la vérité sur un refus.
 */

import { apiFetch } from '../webApiBase';

/** Miroir local du contexte d'org, comme `space:get`/`space:set`. */
const CURRENT_ORG_KEY = 'filarr-web-current-org';

/** Le cache de politique — pendant navigateur du fichier disque du bureau. */
const POLICY_CACHE_KEY = 'filarr-web-org-policy';

/**
 * Un segment de chemin, échappé.
 *
 * Les identifiants d'organisation, de membre et d'invitation viennent de l'état
 * de l'application, pas d'une saisie — mais une valeur inattendue qui glisserait
 * dans un chemin d'URL changerait la ROUTE appelée, pas seulement son argument.
 * On échappe donc systématiquement plutôt que de dépendre de la propreté de
 * l'appelant.
 */
const enc = (v: unknown): string => encodeURIComponent(String(v ?? ''));

/**
 * Le code d'un échec dont le CORPS n'en porte aucun.
 *
 * POURQUOI DÉRIVER PLUTÔT QUE LAISSER VIDE. Un refus sans `code` remonte muet à
 * l'écran d'acceptation, qui n'a alors plus qu'un repli à opposer — et un repli
 * terminal (« invitation retirée ») tiré d'une page de défi Cloudflare ou d'un
 * 502 de passerelle est un mensonge qui, en prime, jette le jeton. Le STATUT, lui,
 * est toujours là : 401 dit la session, 5xx et un corps illisible disent le
 * serveur. Le reste reste explicitement INDÉTERMINÉ — `request_failed` n'est dans
 * aucune table de traduction, donc l'appelant garde sa phrase générique et son
 * bouton « Réessayer », ce qui est la seule chose vraie quand on ne sait pas.
 */
function codeForFailure(status: number, hadJsonBody: boolean): string {
  if (status === 401) return 'session_expired';
  if (status >= 500 || !hadJsonBody) return 'server_error';
  return 'request_failed';
}

function envelope(res: { status: number; body: unknown }): unknown {
  const body =
    res.body && typeof res.body === 'object' ? (res.body as Record<string, unknown>) : null;
  if (!body) {
    return { success: false, error: `HTTP ${res.status}`, code: codeForFailure(res.status, false) };
  }
  if ((res.status >= 400 || body.success === false) && typeof body.code !== 'string') {
    return { ...body, success: false, code: codeForFailure(res.status, true) };
  }
  return body;
}

export const orgHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'org:list': async () => envelope(await apiFetch('/org')),

  'org:acceptInvitation': async (token: unknown) =>
    envelope(
      await apiFetch(`/org/invitations/${encodeURIComponent(String(token ?? ''))}/accept`, {
        method: 'POST',
        body: {},
      })
    ),

  // Aucune route serveur ne porte ce choix : c'est une préférence d'appareil.
  // En espace personnel `initOrgContext` force l'org à null de toute façon, si
  // bien qu'un miroir localStorage suffit et ne ment jamais.
  'org:getCurrent': async () => {
    let orgId: string | null = null;
    try {
      orgId = localStorage.getItem(CURRENT_ORG_KEY);
    } catch {
      /* stockage indisponible : contexte personnel */
    }
    return { success: true, data: { orgId: orgId || null } };
  },

  'org:setCurrent': async (orgId: unknown) => {
    try {
      if (typeof orgId === 'string' && orgId) localStorage.setItem(CURRENT_ORG_KEY, orgId);
      else localStorage.removeItem(CURRENT_ORG_KEY);
    } catch {
      /* mémoire seule */
    }
    return { success: true };
  },

  // ── Cycle de vie de l'organisation ────────────────────────────────────────

  'org:create': async (name: unknown) =>
    envelope(await apiFetch('/org', { method: 'POST', body: { name: String(name ?? '') } })),

  'org:update': async (orgId: unknown, name: unknown) =>
    envelope(
      await apiFetch(`/org/${enc(orgId)}`, { method: 'PATCH', body: { name: String(name ?? '') } })
    ),

  'org:delete': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}`, { method: 'DELETE' })),

  'org:restore': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/restore`, { method: 'POST' })),

  // ── Membres ───────────────────────────────────────────────────────────────

  'org:members:list': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/members`)),

  'org:members:updateRole': async (orgId: unknown, userId: unknown, role: unknown) =>
    envelope(
      await apiFetch(`/org/${enc(orgId)}/members/${enc(userId)}`, {
        method: 'PATCH',
        body: { role: String(role ?? '') },
      })
    ),

  'org:members:remove': async (orgId: unknown, userId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/members/${enc(userId)}`, { method: 'DELETE' })),

  // ── Invitations ───────────────────────────────────────────────────────────

  'org:invitations:list': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/invitations`)),

  'org:invitations:create': async (orgId: unknown, email: unknown, role: unknown, lang: unknown) =>
    envelope(
      await apiFetch(`/org/${enc(orgId)}/invitations`, {
        method: 'POST',
        body: { email: String(email ?? ''), role: String(role ?? ''), lang },
      })
    ),

  'org:invitations:revoke': async (orgId: unknown, invId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/invitations/${enc(invId)}`, { method: 'DELETE' })),

  // ── Facturation ───────────────────────────────────────────────────────────

  'org:billing:status': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/billing/status`)),

  'org:billing:checkout': async (
    orgId: unknown,
    plan: unknown,
    period: unknown,
    successUrl: unknown,
    cancelUrl: unknown
  ) =>
    envelope(
      await apiFetch(`/org/${enc(orgId)}/billing/checkout`, {
        method: 'POST',
        body: { plan, period, successUrl, cancelUrl },
      })
    ),

  'org:billing:portal': async (orgId: unknown) =>
    envelope(await apiFetch(`/org/${enc(orgId)}/billing/portal`, { method: 'POST' })),

  'org:billing:seats': async (orgId: unknown, seats: unknown) =>
    envelope(
      await apiFetch(`/org/${enc(orgId)}/billing/seats`, {
        method: 'POST',
        body: { seats: Number(seats) },
      })
    ),

  // ── Cache local de politique ──────────────────────────────────────────────
  //
  // Le pendant navigateur du fichier que le bureau écrit sur disque. C'est lui
  // qui fait tenir l'application hors ligne sous les règles de son organisation :
  // sans cache, un onglet sans réseau perdrait la politique, et la fenêtre de
  // grâce n'aurait plus de point de départ à décompter.

  'org:policy:save': async (data: unknown) => {
    try {
      localStorage.setItem(POLICY_CACHE_KEY, JSON.stringify(data));
    } catch {
      /* stockage refusé : la politique reste en mémoire pour cette session */
    }
    return { success: true };
  },

  'org:policy:load': async () => {
    try {
      const raw = localStorage.getItem(POLICY_CACHE_KEY);
      // Une valeur illisible vaut une absence : mieux vaut refaire un appel
      // réseau que d'appliquer un document à moitié compris.
      return { success: true, data: raw ? JSON.parse(raw) : null };
    } catch {
      return { success: true, data: null };
    }
  },

  'org:policy:clear': async () => {
    try {
      localStorage.removeItem(POLICY_CACHE_KEY);
    } catch {
      /* rien à effacer */
    }
    return { success: true };
  },
};
