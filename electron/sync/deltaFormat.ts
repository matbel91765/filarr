/**
 * deltaFormat.ts — Le drapeau qui decide du format d'ECRITURE des blocs delta.
 *
 * ── LA LECTURE N'EST PAS DERRIERE CE DRAPEAU, ET C'EST VOLONTAIRE ────────────
 * Un lecteur v5 lit le v4 ET le v5, toujours, quel que soit ce drapeau. Ne
 * gater que l'ECRITURE est ce qui rend la bascule reversible : si le v5 pose
 * probleme, on eteint le drapeau et les nouveaux fichiers repartent en v4,
 * pendant que ceux deja ecrits en v5 restent parfaitement lisibles.
 *
 * Gater la lecture ferait exactement l'inverse : eteindre le drapeau rendrait
 * illisibles les fichiers deja ecrits. C'est le piege classique des drapeaux de
 * format, et il transforme un retour en arriere en perte de donnees.
 *
 * ── PAR DEFAUT : ETEINT ──────────────────────────────────────────────────────
 * Le contrat de parite l'impose (« l'ecriture v5 est derriere un drapeau »), et
 * le calendrier le confirme : au 2026-09-05 le mobile est en relecture chez
 * Google, sa part du lot 8 se limite a la lecture, et rester en v4 en
 * production l'arrange. Allumer ce drapeau est une decision de Mathis, pas un
 * effet de bord d'un deploiement.
 *
 * ── LU A CHAQUE APPEL ────────────────────────────────────────────────────────
 * Comme `FILARR_NOTES_V2`, et pour la meme raison : basculer doit pouvoir se
 * faire sans reconstruire l'application. Le cout est une lecture d'environnement
 * par fichier televerse, c'est-a-dire rien devant le reste du travail.
 */

/**
 * Faut-il ECRIRE les nouveaux fichiers delta au format v5 ?
 *
 * `FILARR_DELTA_V5=1` (ou `true`) pour allumer. Toute autre valeur, absence
 * comprise, laisse le v4 en place.
 */
let serverDeltaV5Write = false;

/**
 * L'interrupteur SERVEUR (`/sync/capabilities` → `deltaV5Write`), pose par la
 * sonde de capacites a chaque cycle ; il s'eteint seul si la sonde echoue ou
 * change de profil. La variable d'environnement reste le levier local ; l'un
 * OU l'autre suffit.
 */
export function setServerDeltaV5Write(on: boolean): void {
  serverDeltaV5Write = on;
}

export function isDeltaV5WriteEnabled(): boolean {
  if (serverDeltaV5Write) return true;
  const raw = process.env.FILARR_DELTA_V5;
  return raw === '1' || raw === 'true';
}

/**
 * Nom de la variable, exporte pour que les messages de diagnostic et les suites
 * ne le recopient pas a la main. Une chaine dupliquee est une chaine qui finit
 * par diverger.
 */
export const DELTA_V5_ENV = 'FILARR_DELTA_V5';
