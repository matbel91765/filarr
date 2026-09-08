/**
 * DIRE QUELQUE CHOSE QUAND PERSONNE NE PEUT REGARDER.
 *
 * ── LE TROU QUE CECI COMBLE ─────────────────────────────────────────────────
 *
 * En production, les outils de développement ne sont pas seulement absents :
 * `main.ts` les REFERME activement si on les ouvre. C'est une posture
 * défendable pour une application qui manipule des clés — mais elle a une
 * conséquence qu'on ne mesure qu'en cherchant une panne : le renderer n'a
 * AUCUN moyen de signaler quoi que ce soit.
 *
 * Le processus principal, lui, écrit un journal sur disque que l'utilisateur
 * sait retrouver et envoyer. Tout ce qui échoue côté main est donc diagnosti-
 * cable ; tout ce qui échoue côté renderer est muet. Un chargement de coffres
 * qui rate au démarrage ne laisse littéralement aucune trace : l'écran affiche
 * une page sans coffres, ce qui ressemble à un compte sans coffres.
 *
 * ── CE QUI PASSE PAR ICI, ET CE QUI N'Y PASSERA JAMAIS ──────────────────────
 *
 * Une PORTÉE et un MESSAGE, tous deux bornés. Rien d'autre.
 *
 * ⚠ Jamais de charge utile, jamais de contenu d'objet, jamais une erreur
 * sérialisée telle quelle. Ce journal part par courriel quand quelqu'un
 * signale un problème : un titre de note ou un nom de fichier qui s'y
 * retrouverait serait une fuite, et elle serait invisible à la relecture
 * puisque le code, lui, ne fait « qu'écrire une erreur ».
 *
 * Le message est donc composé À LA MAIN par l'appelant, qui sait ce qu'il
 * contient — jamais interpolé depuis une donnée de l'utilisateur.
 */

import { isWebPlatform } from './isWebPlatform';

/** Le plafond, en caractères. Un journal n'est pas un dépotoir. */
const MAX_MESSAGE = 300;

/**
 * Écrit une ligne dans le journal du processus principal.
 *
 * Sans effet sur le web (il y a une console, et pas de fichier de journal) et
 * sans effet si le pont n'existe pas. Ne lève jamais : un rapport de
 * diagnostic qui casse le chemin qu'il diagnostique serait pire que le silence
 * qu'il remplace.
 */
export function reportToLog(scope: string, message: string): void {
  if (isWebPlatform()) {
    // Le web n'a pas de journal du processus principal — mais un no-op rendait
    // toute panne INVISIBLE : un chargement de coffres qui ratait au démarrage
    // ne laissait aucune trace nulle part (cas réel du 2026-09-01, diagnostiqué
    // à l'aveugle). La console du navigateur est le journal du web.
    try {
      console.warn(`[diag:${scope.slice(0, 40)}]`, message.slice(0, MAX_MESSAGE));
    } catch {
      /* le diagnostic ne casse pas ce qu'il diagnostique */
    }
    return;
  }
  try {
    window.electron?.ipcRenderer?.send('diag:log', {
      scope: scope.slice(0, 40),
      message: message.slice(0, MAX_MESSAGE),
    });
  } catch {
    /* le diagnostic ne casse pas ce qu'il diagnostique */
  }
}
