/**
 * LES RÉPERTOIRES DU PROFIL QUI NE SONT PAS DES DOSSIERS D'UTILISATEUR.
 *
 * Le répertoire d'un profil mélange deux choses : un sous-répertoire par
 * dossier du coffre, nommé par son identifiant, et quelques répertoires de
 * service. Rien ne les distinguait, et le recensement des dossiers prenait
 * TOUT.
 *
 * ── CE QUE ÇA COÛTAIT ──────────────────────────────────────────────────────
 * `getFolder` sur un répertoire sans métadonnées en ÉCRIT : le répertoire de
 * service devenait un dossier du coffre, nommé « Folder note-versions »,
 * visible dans l'arborescence. On le prenait pour un résidu, on le mettait à
 * la corbeille, on vidait la corbeille — et l'historique des versions partait
 * avec, par suppression récursive. C'est arrivé à `note-versions` ; le
 * répertoire `file-versions` avait déjà reçu ses métadonnées d'adoption quand
 * le défaut a été trouvé.
 *
 * ── POURQUOI UN MODULE À PART ──────────────────────────────────────────────
 * Ce n'est pas une affaire de stockage, c'est un fait sur la DISPOSITION du
 * profil, et plusieurs modules en dépendent. Le tenir ici lui donne un endroit
 * évident où être complété, et un test qui n'a besoin ni d'Electron ni du
 * disque pour vérifier que chaque service de versions y figure.
 *
 * Un nouveau répertoire de service DOIT être ajouté ici le jour où il est
 * créé. Le test `profileDirs.vitest.ts` le rappelle pour ceux qui existent.
 */

/** Le répertoire des instantanés de NOTES (`noteVersionService`). */
export const DIR_VERSIONS_NOTES = 'note-versions';

/** Le répertoire des instantanés de FICHIERS (`fileVersionService`). */
export const DIR_VERSIONS_FICHIERS = 'file-versions';

/**
 * Tout ce qui, sous le répertoire d'un profil, n'est pas un dossier du coffre.
 *
 * `files` et `temp` s'y ajoutent : ils ne sont pas créés par un service de
 * versions, mais un recensement qui les prendrait pour des dossiers ferait
 * exactement la même faute.
 */
export const REPERTOIRES_RESERVES: ReadonlySet<string> = new Set([
  DIR_VERSIONS_NOTES,
  DIR_VERSIONS_FICHIERS,
  'files',
  'temp',
]);


/**
 * LE MARQUEUR D'UNE COPIE DE CONFLIT.
 *
 * `handleConflict` fabrique un RÉPERTOIRE `<fileId>_conflict_<horodatage>` à la
 * racine du profil, contenant une copie du fichier divergent. Ce n'est pas un
 * dossier du coffre : c'est un artefact d'arbitrage, local par nature.
 */
const MOTIF_COPIE_CONFLIT = /_conflict_\d{10,}$/;

/**
 * Ce répertoire est-il une copie de conflit ?
 *
 * ── CE QUE ÇA A COÛTÉ, ET C'EST LE MÊME DÉFAUT QUE `note-versions` ──────────
 *
 * Observé en production le 2026-09-07, sur un compte ouvert depuis deux postes.
 * La boucle de conflit (corrigée par `keepsOpenConflict`) avait fabriqué
 * vingt-quatre de ces répertoires. Chacun a été :
 *
 *   1. PRIS POUR UN DOSSIER par `getFolders`, dont la branche ENOENT de
 *      `getFolder` ÉCRIT un `metadata.json` — une lecture qui écrit. Un dossier
 *      « Folder a7fc2c0c…_conflict_1788744226658 » apparaissait dans le coffre.
 *   2. PRIS POUR UN DOSSIER par `scanLocalFiles`, donc synchronisé : ses
 *      métadonnées inventées ET son contenu sont partis dans le nuage, puis se
 *      sont propagés sur l'autre poste.
 *
 * Le fichier en conflit faisait 1,28 Go. Chaque copie a reçu un `fileId` neuf
 * (il dérive du CHEMIN), donc aucune ne profitait des blocs de l'originale :
 * 2,7 Go téléversés pour un seul fichier, sur quatre identifiants.
 *
 * ── POURQUOI UN MOTIF ET PAS UN NOM ─────────────────────────────────────────
 *
 * `REPERTOIRES_RESERVES` liste des noms FIXES. Une copie de conflit porte un
 * horodatage : elle ne peut pas y figurer, et c'est exactement pour ça que le
 * garde-fou posé pour `note-versions` ne l'a pas attrapée. Le motif exige les
 * chiffres d'un horodatage — un dossier que l'utilisateur nommerait
 * « photos_conflict_final » n'est pas concerné.
 */
export function estCopieDeConflit(nom: string): boolean {
  return MOTIF_COPIE_CONFLIT.test(nom);
}

/**
 * Le nom du répertoire où déposer la copie d'un conflit sur `fileId`.
 *
 * ── LES DEUX-POINTS SONT INTERDITS SOUS WINDOWS, ET ÇA A CASSÉ ─────────────
 *
 * Les entrées de métadonnées portent un identifiant en `meta:<quelque chose>`.
 * Utilisé tel quel comme nom de répertoire, le `:` est lu par Windows comme le
 * séparateur d'un FLUX DE DONNÉES ALTERNATIF (`fichier:flux`), et `mkdir`
 * échoue en `ENOENT` — une erreur qui ne désigne rien de ce qui se passe.
 *
 * Journaux du 2026-09-07 :
 *
 *     Conflict handling failed for meta:…_conflict_…: ENOENT: no such file or
 *     directory, mkdir '…\meta:…_conflict_…'
 *
 * Onze fois. Et l'échec n'est pas silencieux : `handleConflict` retombe dans
 * son `catch`, qui marque quand même l'entrée `conflict` — SANS copie. Le
 * fichier divergent n'est donc nulle part, et l'entrée reste bloquée en
 * conflit, à réessayer, sans que rien ne puisse jamais l'arbitrer.
 *
 * ── LE REMPLACEMENT NE DOIT PAS CRÉER DE COLLISION ─────────────────────────
 *
 * `meta:X` devient `meta-X`. Un fichier réellement nommé `meta-X` aurait donc
 * le même répertoire de conflit — mais l'horodatage est en millisecondes et
 * les deux conflits devraient tomber dans la même, sur deux fichiers dont l'un
 * est une métadonnée. On accepte, plutôt que d'inventer un encodage que
 * personne ne saura relire dans six mois.
 */
export function nomDeCopieDeConflit(fileId: string, horodatage: number): string {
  // Tout ce que Windows refuse dans un nom de fichier. `/` et `\` en font
  // partie : un identifiant hérité (`dossier/fichier.pdf`) fabriquerait sinon
  // une arborescence au lieu d'un répertoire.
  const sain = fileId.replace(/[:<>"/\|?*]/g, '-');
  return `${sain}_conflict_${horodatage}`;
}

/**
 * Ce nom désigne-t-il autre chose qu'un dossier du coffre ?
 *
 * Un nom RÉSERVÉ (service) ou une COPIE DE CONFLIT. Les deux partagent la
 * seule propriété qui compte ici : les recenser comme dossiers les fait
 * apparaître dans le coffre, et `getFolder` leur invente alors des
 * métadonnées qui partent dans le nuage.
 */
export function estRepertoireReserve(nom: string): boolean {
  return REPERTOIRES_RESERVES.has(nom) || estCopieDeConflit(nom);
}
