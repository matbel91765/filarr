/**
 * Mise en pause de la synchronisation — lecture partagée entre onglets.
 *
 * `sync:setEnabled` écrivait le drapeau et s'arrêtait là (« pas de démon à
 * démarrer avant M3 » — commentaire devenu faux depuis M3) : mettre la sync en
 * pause posait la préférence pendant que l'ordonnanceur continuait de cycler et
 * de pousser toutes les 5 minutes. Un réglage qui ment.
 *
 * Le drapeau vit dans `localStorage`, donc TOUS les onglets le voient, meneur
 * compris — inutile de le diffuser. On le relit à chaque cycle plutôt que de le
 * mettre en cache : un réglage change rarement, et un cache raterait la pause
 * posée depuis un autre onglet.
 *
 * La pause ne bloque QUE les cycles automatiques. Un clic explicite sur
 * « Synchroniser maintenant » reste honoré : c'est un geste de l'utilisateur,
 * qui prime sur sa propre préférence de fond.
 */

const FLAGS_KEY = 'filarr-web-flags';

export function isSyncPaused(profileId: string | null): boolean {
  try {
    const raw = localStorage.getItem(FLAGS_KEY);
    if (!raw) return false;
    const flags = JSON.parse(raw) as Record<string, string>;
    const scoped = profileId ? flags[`sync-paused-${profileId}`] : undefined;
    return scoped === 'true' || flags['sync-paused'] === 'true';
  } catch {
    // localStorage indisponible ou JSON corrompu : ne jamais bloquer la sync
    // sur une lecture ratée — le défaut sûr est de synchroniser.
    return false;
  }
}
