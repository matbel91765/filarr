/**
 * LES ATTRIBUTS D'UN CHAMP DE RECHERCHE — écrits UNE fois.
 *
 * ── LE DÉFAUT QU'ILS FERMENT ────────────────────────────────────────────────
 *
 * La barre de recherche se remplissait toute seule avec l'adresse e-mail du
 * compte, au clic, et de nouveau en entrant dans un coffre.
 *
 * Ce n'est pas Filarr qui écrivait ce texte : c'est le remplissage automatique
 * du navigateur. Un `<input type="text">` SANS `name`, SANS `id` et SANS
 * `autocomplete`, seul dans son coin sur une origine où l'on s'est déjà
 * connecté, coche toutes les cases de l'heuristique « c'est sûrement le champ
 * identifiant ». Chrome le remplit alors avec l'identifiant enregistré, et
 * recommence à chaque fois que le champ est monté à nouveau — d'où le retour du
 * phénomène en changeant d'écran.
 *
 * ── POURQUOI `autocomplete="off"` NE SUFFIT PAS ─────────────────────────────
 *
 * Chrome l'IGNORE délibérément sur les champs qu'il croit être un identifiant :
 * la décision a été prise contre les sites qui désactivaient le gestionnaire de
 * mots de passe de leurs utilisateurs, et elle ne se contourne pas.
 *
 * Ce qui marche, c'est de ne plus ressembler à un champ d'identifiant :
 *
 *   · `type="search"` — le signal décisif. Le remplissage automatique ne
 *     propose pas d'identifiant dans un champ de recherche ;
 *   · un `name` qui ne ressemble à rien de connu (« email », « user »,
 *     « login » déclenchent l'heuristique à eux seuls) ;
 *   · `autocomplete="off"`, qui suffit pour les navigateurs qui l'honorent ;
 *   · les marqueurs des gestionnaires TIERS, qui ont chacun le leur et
 *     n'écoutent aucun des attributs standards.
 *
 * ── ET UN NOM ACCESSIBLE ────────────────────────────────────────────────────
 *
 * Ces champs n'avaient qu'un `placeholder`. Un placeholder n'est PAS un nom
 * accessible : il disparaît à la première frappe, et plusieurs lecteurs
 * d'écran ne l'annoncent pas du tout. Le libellé se passe donc en argument,
 * pour qu'aucun de ces champs ne puisse être posé sans en avoir un.
 */

/**
 * @param name  identifiant technique du champ. DOIT rester loin de tout ce qui
 *              évoque un compte : c'est la moitié de l'heuristique.
 * @param label le nom accessible, déjà traduit.
 */
export function searchFieldProps(
  name: string,
  label: string
): {
  type: 'search';
  name: string;
  autoComplete: 'off';
  spellCheck: false;
  enterKeyHint: 'search';
  'aria-label': string;
  'data-1p-ignore': string;
  'data-lpignore': string;
  'data-bwignore': string;
  'data-form-type': string;
} {
  return {
    type: 'search',
    name,
    autoComplete: 'off',
    spellCheck: false,
    enterKeyHint: 'search',
    'aria-label': label,
    // 1Password, LastPass, Bitwarden, Dashlane. Chacun a inventé le sien ;
    // aucun ne lit `autocomplete`. Les quatre coûtent quatre attributs et
    // évitent quatre rapports de bogue identiques.
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  };
}
