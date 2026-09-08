/**
 * LA GARDE ANTI-VIDAGE — la règle, isolée de l'écran.
 *
 * Un enregistrement ne doit jamais remplacer en silence un document qui avait
 * du contenu par un document devenu vide. Trois fenêtres réelles produisaient
 * exactement ça, toutes reproduites en enquête : un `.docx` dont la conversion
 * n'avait pas fini, un `.docx` dont la conversion échouait sans être annoncée,
 * une salle de collaboration pas encore semée. Elles sont fermées à la source,
 * mais aucune garde ne se tenait entre un éditeur vide et le fichier.
 *
 * ── POURQUOI L'HÔTE NE PEUT PAS TRANCHER SEUL ──────────────────────────────
 * Il ne peut pas le déduire des octets. Un `.fdoc` vide pèse 114 octets de
 * structure, un `.ics` vide une centaine, et rien dans ces nombres ne les
 * distingue d'un document plein. Seul le greffon sait, et il le dit par
 * `EditorInstance.isEmpty()`.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * La règle vivait dans le composant. Elle décide d'une écriture destructrice :
 * elle mérite d'être lisible d'un coup d'œil et éprouvée sans monter un écran.
 */

export interface EtatAvantEcriture {
  /**
   * Le greffon disait-il « j'ai du contenu » au dernier état écrit ?
   * Faux si le document était déjà vide — il n'y a alors rien à perdre.
   */
  contenuAuDepart: boolean;
  /** Taille des octets qui seraient remplacés. Zéro = rien à perdre. */
  octetsPrecedents: number;
  /**
   * Ce que le greffon répond MAINTENANT. `undefined` = il n'implémente pas
   * `isEmpty` : on n'invente pas de réponse à sa place, et on n'garde pas.
   */
  estVideMaintenant: boolean | undefined;
  /**
   * Une CONVERSION en cours (un `.docx` ouvert pour import) : le premier
   * enregistrement crée un fichier NEUF et ne touche pas l'original. Il n'y a
   * donc rien à écraser, et poser la question égarerait.
   */
  conversion: boolean;
}

/**
 * Cet enregistrement viderait-il un document qui avait du contenu ?
 *
 * `true` ne veut pas dire « refuser » : vider un document est un geste
 * légitime. Il veut dire « ne pas le faire sans demander ».
 */
export function viderait(etat: EtatAvantEcriture): boolean {
  if (etat.conversion) return false;
  if (!etat.contenuAuDepart) return false;
  if (etat.octetsPrecedents <= 0) return false;
  // Strictement `true` : `undefined` est une absence de réponse, pas un « non ».
  return etat.estVideMaintenant === true;
}
