/**
 * `filarr://invite` et `filarr://vault-invite` — la seule façon dont un lien
 * d'invitation peut atteindre l'application de bureau.
 *
 * POURQUOI UN SCHÉMA PERSONNALISÉ ET PAS L'URL DE L'E-MAIL. Le renderer charge
 * `app://filarr.app/index.html` : il n'y a aucune barre d'adresse à lire, et la
 * captation qui fonctionne sur le web (lire `location` avant le premier rendu)
 * n'a rien à lire ici. Un lien `https://app.filarr.com/vault-invite?…` ouvre le
 * NAVIGATEUR, jamais l'application installée. Le seul chemin qui restait était de
 * coller le lien à la main dans les réglages.
 *
 * CE MODULE EST PUR, et c'est délibéré : `handleProtocolUri` vit dans main.ts,
 * qui n'est pas testable sans lancer Electron. L'analyse — la seule partie qui
 * peut se tromper — est ici, exercée par `electron/__tests__`.
 *
 * LES DEUX FORMES SONT CELLES DE L'E-MAIL, à l'hôte près :
 *   filarr://invite?token=…
 *   filarr://vault-invite?token=…&vault=…&org=…
 * Les mêmes noms de paramètres que `parseInviteLink` côté renderer, pour qu'une
 * seule grammaire décrive le parcours des deux côtés.
 */

export interface InviteUriPayload {
  kind: 'org' | 'vault';
  token: string;
  vaultId?: string;
  orgId?: string;
}

/** Jetons du Worker : 64 caractères hexadécimaux. La borne reste large pour ne
 *  pas rejeter un futur jeton base64url — la validation qui compte est côté
 *  serveur, celle-ci n'écarte que ce qui ne peut pas être un jeton. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,512}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Analyse une URI `filarr://` d'invitation. Rend `null` pour tout le reste —
 * y compris `filarr://reminder`, qui a son propre routage.
 *
 * Aucune exception ne sort d'ici : une URI malformée arrive d'un shell, pas d'un
 * appelant de confiance, et faire tomber le processus principal sur un lien
 * abîmé serait pire que de l'ignorer.
 */
export function parseInviteUri(uri: unknown): InviteUriPayload | null {
  if (typeof uri !== 'string' || !uri.startsWith('filarr://')) return null;

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'invite' && host !== 'vault-invite') return null;

  const token = parsed.searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) return null;

  if (host === 'invite') return { kind: 'org', token };

  // Une invitation de COFFRE sans son identifiant de coffre ne peut être
  // présentée à aucune route : le refuser ici vaut mieux que d'armer un porteur
  // qui ne pourra jamais aboutir.
  const vaultId = parsed.searchParams.get('vault') ?? '';
  if (!UUID_RE.test(vaultId)) return null;

  // L'org de l'HÔTE est facultative : les e-mails partis avant qu'elle n'entre
  // dans le lien n'en portent pas, et la jointure sonde alors les locataires
  // connus. Une valeur non conforme est ignorée plutôt que de faire échouer le
  // tout — le sondage reste un repli correct.
  const orgId = parsed.searchParams.get('org') ?? '';
  return {
    kind: 'vault',
    token,
    vaultId,
    ...(UUID_RE.test(orgId) ? { orgId } : {}),
  };
}

/** La première URI `filarr://` d'un argv (activation à froid, Windows). */
export function findProtocolUriInArgv(argv: readonly unknown[]): string | null {
  for (const a of argv) {
    if (typeof a === 'string' && a.startsWith('filarr://')) return a;
  }
  return null;
}
