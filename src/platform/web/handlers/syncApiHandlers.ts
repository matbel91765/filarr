/**
 * Handlers web des canaux sync:* qui sont de purs appels serveur (famille
 * 'api'). Le MOTEUR de sync (queue, manifest, OPFS) est un chantier M3 — ici
 * ne vivent que les canaux qui relaient le Worker sans état local.
 */

import { apiFetch } from '../webApiBase';

export const syncApiHandlers: Record<string, (...args: unknown[]) => unknown> = {
  // Même contrat que electron/main.ts:3641-3646 : {profiles: [...]} ou liste vide.
  'sync:getCloudProfiles': async () => {
    const res = await apiFetch<{
      data?: {
        profiles?: Array<{
          profileId: string;
          manifestVersion: number;
          storageUsed: number;
          lastSyncAt: string | null;
        }>;
      };
    }>('/sync/profiles');
    if (res.status === 200 && res.body?.success && res.body.data) return res.body.data;
    // « Appel échoué » n'est pas « aucun profil » : l'onboarding lit
    // `profiles`, le journal et le diagnostic lisent `error`.
    return { profiles: [], error: res.body?.error || `HTTP ${res.status}` };
  },

  /**
   * L'appairage à six chiffres n'existe pas sur le web (aucun second processus,
   * aucun handler : le dispatcher levait). L'onboarding y tombe quand le compte
   * a des données synchronisées mais AUCUNE clé enveloppée côté serveur
   * (compte antérieur au déploiement de la copie serveur). Une impasse explicite
   * vaut mieux qu'un rejet non géré : la copie serveur se pose en ouvrant une
   * fois l'application de bureau à jour.
   */
  'pairing:join': async () => {
    let error = 'Not available in the web app yet — use the desktop app.';
    try {
      const { default: i18n } = await import('../../../i18n/config');
      error = i18n.t('settings.webUnavailable', error);
    } catch {
      /* catalogue indisponible : phrase de repli */
    }
    return { success: false, error };
  },

  /**
   * Retirer un profil du nuage. Même contrat que le canal Electron : l'appelant
   * partagé n'a pas à savoir sur quelle plateforme il tourne.
   */
  'sync:deleteCloudProfile': async (profileId: unknown) => {
    if (typeof profileId !== 'string' || !profileId) {
      return { success: false, error: 'No profileId' };
    }
    // Voir le canal Electron : le Worker peut ne vider qu'une PARTIE du
    // préfixe (budget de sous-requêtes) et répond alors 409
    // `deletion_incomplete`. On relance, sinon le profil resterait enterré
    // côté base avec ses octets encore dans le bucket.
    const MAX_PASSES = 40;
    let deletedBytes = 0;
    let last = 0;
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const res = await apiFetch<{
        data?: { deletedBytes?: number };
        code?: string;
        deletedBytes?: number;
      }>(`/sync/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      last = res.status;
      if (res.status === 200 && res.body?.success) {
        deletedBytes += res.body.data?.deletedBytes ?? 0;
        return { success: true, deletedBytes };
      }
      if (res.status !== 409 || res.body?.code !== 'deletion_incomplete') break;
      deletedBytes += res.body?.deletedBytes ?? 0;
    }
    return { success: false, error: `HTTP ${last}` };
  },

  /**
   * Ramener les profils du compte, hors de tout cycle de synchronisation.
   *
   * La restauration EXISTAIT côté web — et n'était appelée que depuis
   * `runCycle(profileId)`, c'est-à-dire un cycle mené POUR UN PROFIL QU'ON
   * POSSÈDE DÉJÀ. Sur un navigateur neuf, il fallait donc déjà avoir un profil,
   * et une synchronisation en cours, pour que les autres apparaissent : l'œuf
   * et la poule. Rien ne se déclenchait à la connexion.
   *
   * Même contrat que le canal Electron, pour que l'appelant partagé n'ait pas à
   * savoir sur quelle plateforme il tourne.
   */
  'sync:restoreCloudProfiles': async () => {
    try {
      const { restoreAccountProfiles } = await import('../sync/readSync');
      // Les VRAIS identifiants, comme le bureau : `profileIds: []` laissait
      // l'appelant partagé (`profilesOfAccount`) sans rien à reconnaître, et
      // l'onboarding retombait sur « créer un profil » — un doublon vide qui
      // synchronisait dans le vide.
      const { restored, profileIds, unreadable } = await restoreAccountProfiles();
      return { success: true, restored, profileIds, unreadable };
    } catch (err) {
      return {
        success: false,
        restored: 0,
        profileIds: [],
        unreadable: [],
        error: (err as Error).message,
      };
    }
  },
};
