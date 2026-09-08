/**
 * mailtoLink — « Envoyer par e-mail » sans que la clé ne passe par nous.
 *
 * LE POINT QUI COMPTE. Un lien Send porte sa clé de déchiffrement dans le
 * fragment (`#k=…`) : c'est ce qui fait qu'aucun serveur ne la voit, un
 * navigateur n'envoyant jamais le fragment. Le jour où c'est NOUS qui
 * envoyons l'e-mail, la clé traverse notre serveur et reste dans les journaux
 * de notre prestataire d'e-mail — la promesse tombe. Ici, rien de tel : on
 * compose un `mailto:` et c'est la messagerie de l'expéditeur, sur son poste,
 * qui envoie. La clé ne quitte pas l'appareil autrement que dans SON e-mail.
 * Décision de Mathis du 2026-09-06 : ce chemin est le défaut, sur les trois
 * plateformes ; l'envoi par nos soins reste réservé au répertoire Teams, avec
 * sa phrase de divulgation.
 *
 * DEUX CONTRAINTES DE FORME, imposées par le bureau. Le canal `open-external`
 * (main.ts, `isSafeMailtoTelUrl`) n'accepte un `mailto:` que SANS espace ni
 * caractère de contrôle et sous 2 048 caractères. `encodeURIComponent` règle
 * le premier point (`%20`, `%0A`) ; le second est tenu ici en retirant les
 * lignes facultatives du corps, jamais le lien.
 */

/** Marge sous le plafond du bureau (2 048), pour ne pas dépendre de son égalité stricte. */
const MAILTO_MAX = 2000;
const CRLF = '\r\n';

export interface ShareEmailParts {
  /** Le lien complet, fragment compris — la seule ligne jamais retirée. */
  url: string;
  subject: string;
  /** Phrase d'ouverture (« Voici le lien pour récupérer … »). */
  intro?: string;
  /** Mention de l'échéance, déjà formulée et traduite. */
  expiry?: string;
  /** Rappel que la clé est dans le lien, déjà traduit. */
  keyNote?: string;
  /** Destinataire pré-rempli, facultatif. */
  to?: string;
}

/** Le corps, ligne par ligne : chaque partie facultative est une ligne qu'on peut retirer. */
function bodyOf(p: ShareEmailParts, drop: number): string {
  const lignes: string[] = [];
  // Ordre de sacrifice, du moins utile au plus utile : la note sur la clé,
  // puis l'échéance, puis l'ouverture. Le lien reste toujours.
  const facultatives = [p.keyNote, p.expiry, p.intro].filter((l): l is string => !!l);
  const gardees = facultatives.slice(Math.min(drop, facultatives.length));
  const intro = gardees.find((l) => l === p.intro);
  const expiry = gardees.find((l) => l === p.expiry);
  const keyNote = gardees.find((l) => l === p.keyNote);
  if (intro) lignes.push(intro, '');
  lignes.push(p.url);
  if (expiry || keyNote) lignes.push('');
  if (expiry) lignes.push(expiry);
  if (keyNote) lignes.push(keyNote);
  return lignes.join(CRLF);
}

/**
 * Le `mailto:` complet, encodé, sous le plafond. `null` si même le lien seul
 * ne tient pas — ce qui ne peut arriver qu'avec un lien aberrant, et alors on
 * ne fabrique pas une adresse tronquée qui perdrait la clé.
 */
export function buildShareMailto(p: ShareEmailParts): string | null {
  const to = p.to ? encodeURIComponent(p.to.trim()) : '';
  for (let drop = 0; drop <= 3; drop++) {
    const q = new URLSearchParams();
    q.set('subject', p.subject);
    q.set('body', bodyOf(p, drop));
    // URLSearchParams encode l'espace en `+`, que les messageries lisent
    // littéralement : on repasse par `%20`, la forme que toutes comprennent.
    const query = q.toString().replace(/\+/g, '%20');
    const url = `mailto:${to}?${query}`;
    if (url.length <= MAILTO_MAX) return url;
  }
  return null;
}

/**
 * Ouvrir la messagerie de l'expéditeur. Bureau : canal `open-external` (main
 * valide le schéma avant `shell.openExternal`). Web : le répartiteur retombe
 * sur `window.open`. `false` quand aucun pont n'existe — l'appelant propose
 * alors de copier le lien, qui reste le chemin complet.
 */
export function openMailto(url: string): boolean {
  if (typeof window === 'undefined') return false;
  const pont = (
    window as { electron?: { ipcRenderer?: { send?: (c: string, u: string) => void } } }
  ).electron?.ipcRenderer?.send;
  if (typeof pont !== 'function') return false;
  pont('open-external', url);
  return true;
}
