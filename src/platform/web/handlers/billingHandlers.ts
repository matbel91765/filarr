/**
 * Handlers web des canaux billing:* — acheter un plan depuis le navigateur.
 *
 * POURQUOI CE FICHIER EXISTE. Les deux canaux étaient classés « livrés, palier M1 »
 * et aucun handler ne les servait : `webInvoke` tombait donc sur
 * `ChannelNotImplementedError`, que l'appelant avalait dans un `console.error`. Le
 * bouton « Solo » clignotait et rien ne se passait, sans message. Comme la création
 * d'un coffre partagé exige un palier payant côté serveur, un utilisateur qui n'a
 * que le web ne pouvait RIEN acheter, donc jamais créer de coffre ni inviter
 * personne : il ne pouvait qu'être invité chez quelqu'un d'autre.
 *
 * DIFFÉRENCE ASSUMÉE AVEC LE BUREAU. Le main ouvre le navigateur puis SONDE
 * `/auth/me` toutes les cinq secondes pour détecter le changement de palier, parce
 * qu'une fenêtre Electron ne revient pas d'elle-même. Sur le web, Stripe REVIENT sur
 * `successUrl` : la page est rechargée, la session relue, et le palier arrive avec
 * elle. Un sondage ferait ici le travail que la navigation fait déjà.
 *
 * L'onglet est ouvert AVANT l'appel réseau et sa destination écrite ensuite : un
 * `window.open` qui suit une promesse n'est plus rattaché au geste de l'utilisateur
 * et se fait bloquer comme une fenêtre surgissante. Si le bloqueur l'a quand même
 * refusé, l'URL est rendue à l'appelant pour qu'il propose un lien — jamais un échec
 * muet, qui est exactement le défaut que ce fichier ferme.
 */

import { apiFetch } from '../webApiBase';

/**
 * Le Worker n'accepte que des URL de retour sur filarr.com (liste blanche
 * `isAllowedRedirectUrl`, billing.ts) : une origine locale de développement serait
 * refusée en 400. On envoie donc toujours les URL de production, comme le bureau.
 */
const SUCCESS_URL = (plan: string) =>
  `https://filarr.com/checkout/success?plan=${encodeURIComponent(plan)}`;
const CANCEL_URL = 'https://filarr.com/checkout/cancel';

/** Une URL que l'on accepte d'ouvrir : https, et rien d'autre. */
function isSafeExternalUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || !raw) return false;
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}

interface OpenResult {
  success: boolean;
  data?: { opened: boolean; url: string };
  error?: string;
  code?: string;
}

async function startStripeJourney(
  path: string,
  body: Record<string, unknown> | undefined,
  urlField: 'checkoutUrl' | 'portalUrl'
): Promise<OpenResult> {
  // Ouvert MAINTENANT, tant que le clic est encore la cause directe de l'ouverture.
  //
  // SANS `noopener` DANS LES FEATURES, ET C'EST OBLIGATOIRE. La spec HTML impose
  // que `window.open` rende `null` quand `noopener` est demande : on ouvrait donc
  // un onglet `about:blank` dont on ne gardait AUCUNE poignee, jamais navigue,
  // jamais referme — l'utilisateur restait sur une page blanche pendant que nous
  // concluions « bloqueur de fenetres surgissantes ». La protection est reprise
  // juste en dessous en annulant `opener` sur le document vide, qui est de notre
  // origine tant qu'on ne l'a pas navigue.
  const tab = window.open('', '_blank');

  const res = await apiFetch(path, { method: 'POST', ...(body ? { body } : {}) });
  const payload =
    res.body && typeof res.body === 'object' ? (res.body as Record<string, unknown>) : null;
  const data = (payload?.data ?? null) as Record<string, unknown> | null;
  const url = data?.[urlField];

  if (res.status >= 400 || payload?.success === false || !isSafeExternalUrl(url)) {
    tab?.close();
    return {
      success: false,
      error: (payload?.error as string) ?? `HTTP ${res.status}`,
      code:
        (payload?.code as string) ?? (res.status === 401 ? 'session_expired' : 'request_failed'),
    };
  }

  if (tab) {
    // Rendu avant la navigation : le lien vers nous ne survit pas au remplacement.
    try {
      tab.opener = null;
    } catch {
      /* Quelques navigateurs refusent l'affectation ; la cible reste https. */
    }
    tab.location.replace(url);
    return { success: true, data: { opened: true, url } };
  }
  // Bloqueur de fenêtres surgissantes : l'appelant affiche le lien plutôt que rien.
  return { success: true, data: { opened: false, url } };
}

export const billingHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'billing:checkout': async (plan: unknown) => {
    const target = plan === 'pro' ? 'pro' : 'solo';
    return startStripeJourney(
      '/billing/checkout',
      { plan: target, successUrl: SUCCESS_URL(target), cancelUrl: CANCEL_URL },
      'checkoutUrl'
    );
  },

  'billing:portal': async () => startStripeJourney('/billing/portal', undefined, 'portalUrl'),
};
