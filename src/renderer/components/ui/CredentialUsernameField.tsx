/**
 * LE CHAMP IDENTIFIANT QUI MANQUAIT À NOS INVITES DE MOT DE PASSE.
 *
 * ── LE DÉFAUT, ET IL EST CONTRE-INTUITIF ────────────────────────────────────
 *
 * Les barres de recherche de l'application se remplissaient toutes seules avec
 * l'adresse e-mail du compte — mais SEULEMENT au moment où l'invite de mot de
 * passe d'un coffre apparaissait à l'écran.
 *
 * On a d'abord soupçonné les champs de recherche eux-mêmes, et on les a
 * durcis : `type="search"`, un `name` qui n'évoque aucun compte, les marqueurs
 * des gestionnaires tiers. Ça n'a rien changé, et c'était normal : ils
 * n'étaient pas la cause.
 *
 * La cause est du côté du MOT DE PASSE. Un `<input type="password">` posé seul,
 * sans champ identifiant à côté et sans `autocomplete`, fait décider au
 * navigateur qu'il regarde un formulaire de connexion. Il remplit alors le
 * mot de passe enregistré — et il lui faut bien mettre l'identifiant QUELQUE
 * PART. Ne trouvant aucun champ prévu pour ça, il parcourt la page et choisit
 * le meilleur candidat : nos barres de recherche.
 *
 * ── POURQUOI ON NE LUTTE PAS ────────────────────────────────────────────────
 *
 * On peut durcir les champs de recherche à l'infini ; tant que le navigateur
 * cherche un endroit où écrire un identifiant, il en trouvera un. La réponse
 * n'est pas de mieux se cacher, c'est de lui DONNER la cible qu'il réclame,
 * au bon endroit et de son plein gré.
 *
 * Ce champ est donc un vrai champ identifiant, annoncé comme tel
 * (`autocomplete="username"`). Le navigateur y écrit ce qu'il voulait écrire,
 * l'invite de mot de passe redevient un formulaire complet et cohérent, et
 * plus rien ne va se poser ailleurs.
 *
 * ── IL EST INVISIBLE, PAS ABSENT ────────────────────────────────────────────
 *
 * ⚠ `display: none` et `visibility: hidden` NE MARCHENT PAS : le remplissage
 * automatique saute délibérément les champs ainsi masqués — c'est justement sa
 * défense contre les pages qui cachent un champ pour récolter une valeur à
 * l'insu de l'utilisateur. Le champ doit rester dans le flux et calculable.
 *
 * On le sort donc de l'écran par la technique de masquage accessible
 * habituelle, et on le retire des deux autres chemins par lesquels quelqu'un
 * pourrait l'atteindre sans le vouloir : la tabulation (`tabIndex={-1}`) et
 * les lecteurs d'écran (`aria-hidden`). Il est en lecture seule : sa valeur ne
 * nous sert à rien, on ne la lit jamais, et personne ne doit pouvoir la
 * modifier par accident.
 */

import React from 'react';

export interface CredentialUsernameFieldProps {
  /**
   * L'identifiant du compte, s'il est connu.
   *
   * Facultatif : le navigateur remplit ce champ lui-même avec l'identifiant
   * qu'il a enregistré. Le renseigner ne sert qu'à ce que le gestionnaire
   * propose la BONNE entrée quand plusieurs comptes existent pour ce site.
   */
  username?: string;
}

export const CredentialUsernameField: React.FC<CredentialUsernameFieldProps> = ({ username }) => (
  <input
    type="text"
    name="username"
    autoComplete="username"
    defaultValue={username ?? ''}
    readOnly
    tabIndex={-1}
    aria-hidden="true"
    style={{
      // Le masquage accessible : hors de l'écran mais RENDU, donc éligible au
      // remplissage. Voir l'en-tête — `display: none` annulerait tout l'effet.
      position: 'absolute',
      width: 1,
      height: 1,
      padding: 0,
      margin: -1,
      overflow: 'hidden',
      clipPath: 'inset(50%)',
      whiteSpace: 'nowrap',
      border: 0,
    }}
  />
);

export default CredentialUsernameField;
