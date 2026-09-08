/**
 * Gestionnaires web des canaux `custody:*` de TRANSPORT — clé de garde du
 * compte et libellés scellés des partages.
 *
 * Relais fidèles de leurs jumeaux Electron (`electron/custodyService.ts`) :
 * mêmes routes, mêmes formes de réponse `{success, data}|{success:false,
 * error}`. Le renderer ne doit pas savoir sur quelle plateforme il tourne — il
 * scelle et déscelle de la même façon des deux côtés, avec le même
 * `crypto.subtle` et le même `@noble/curves`.
 *
 * NE SONT PAS ICI : `custody:remember`, `custody:recall`,
 * `custody:rememberStatus`, `custody:forget`. Ce sont les quatre canaux de la
 * MÉMOIRE de la privée déverrouillée, et le web a déjà sa réponse à cette
 * question — `lib/dashboard/vault-session.ts` du site, qui chiffre sous une clé
 * AES NON EXTRACTIBLE rangée en IndexedDB. Y brancher un relais serait recopier
 * un mécanisme existant avec un modèle de menace différent ; ils restent classés
 * 'crypto' et non livrés, ce que le dispatcher signale explicitement (palier).
 *
 * À ne pas confondre avec `custodyHandlers.ts`, qui parle de la custody de la
 * clé du PROFIL (FEK enveloppée) — un autre sujet, un autre secret.
 */

import { apiFetch } from '../webApiBase';

function échec(error: string): { success: false; error: string } {
  return { success: false, error };
}

interface RawLabelRow {
  id?: unknown;
  wrapped_label?: unknown;
}

/**
 * Projection `{id, wrappedLabel}`. Une ligne sans identifiant exploitable est
 * SAUTÉE plutôt que rendue avec un `id` vide : elle ne se rattacherait à aucun
 * partage et ne ferait qu'ajouter du bruit dans la fusion.
 */
function toLabelRows(rows: unknown): { id: string; wrappedLabel: string | null }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; wrappedLabel: string | null }[] = [];
  for (const r of rows as RawLabelRow[]) {
    if (typeof r?.id !== 'string' || r.id.length === 0) continue;
    out.push({
      id: r.id,
      wrappedLabel:
        typeof r.wrapped_label === 'string' && r.wrapped_label.length > 0 ? r.wrapped_label : null,
    });
  }
  return out;
}

export const custodyLabelHandlers: Record<string, (...args: unknown[]) => unknown> = {
  /**
   * Matériel COMPLET de la clé de garde — publique, privée emballée, sel.
   * Distinct de `share:custodyKey`, qui n'en rend que la publique : elle suffit
   * à sceller, jamais à ouvrir.
   *
   * 404 et `data: null` disent la même chose — « ce compte n'a pas de clé » —
   * et c'est un SUCCÈS. Tout autre refus est un échec : afficher « pas de
   * coffre » sur une panne enverrait en créer un second.
   */
  'custody:key': async () => {
    const res = await apiFetch<{ data?: { custodyPublicKey?: string } | null }>(
      '/account/custody-key'
    );
    if (res.status === 404) return { success: true, data: null };
    if (res.status !== 200 || !res.body?.success) return échec(`HTTP ${res.status}`);
    const d = res.body.data;
    return { success: true, data: d && typeof d.custodyPublicKey === 'string' ? d : null };
  },

  /**
   * Libellés scellés de tous les partages du compte.
   *
   * `/account/shares` et NON `/sync/share` : ce dernier n'énumère pas
   * `wrapped_label` dans ses colonnes. Le champ n'existe que dans le listing du
   * compte, qui réunit les deux systèmes de partage.
   */
  'custody:shareLabels': async () => {
    const res = await apiFetch<{
      data?: { sends?: unknown; appSends?: unknown; requests?: unknown };
    }>('/account/shares');
    if (res.status !== 200 || !res.body?.success || !res.body.data) {
      return échec(`HTTP ${res.status}`);
    }
    const appSends = res.body.data.appSends;
    // La PRÉSENCE du champ, `null` compris : un worker d'avant `appSends` n'a
    // pas le tableau du tout. Voir la note du jumeau Electron sur ce que cela
    // ne prouve PAS (la migration de la colonne peut manquer — le 404 à
    // l'écriture reste le verdict final).
    const serverKnowsAppLabels =
      Array.isArray(appSends) &&
      (appSends.length === 0 ||
        appSends.some((r) => r != null && typeof r === 'object' && 'wrapped_label' in r));
    return {
      success: true,
      data: {
        sends: toLabelRows(res.body.data.sends),
        appSends: toLabelRows(appSends),
        requests: toLabelRows(res.body.data.requests),
        serverKnowsAppLabels,
      },
    };
  },

  /**
   * Pose ou efface un libellé scellé. Le 404 est un RÉSULTAT nommé, pas une
   * panne : il dit « ce serveur ne sait pas ranger ce libellé-là », et l'écran
   * doit alors promettre « sur cet appareil » plutôt que « on réessaiera ».
   */
  'custody:setLabel': async (kind: unknown, shareId: unknown, wrappedLabel: unknown) => {
    if (typeof shareId !== 'string' || shareId.length === 0) return échec('Invalid shareId');
    const segment = kind === 'request' ? 'requests' : 'sends';
    const res = await apiFetch(`/account/${segment}/${encodeURIComponent(shareId)}`, {
      method: 'PATCH',
      body: {
        wrappedLabel:
          typeof wrappedLabel === 'string' && wrappedLabel.length > 0 ? wrappedLabel : null,
      },
    });
    if (res.status === 404) return { success: true, data: 'not-found' };
    if (res.status !== 200 || !res.body?.success) return échec(`HTTP ${res.status}`);
    return { success: true, data: 'saved' };
  },
};
