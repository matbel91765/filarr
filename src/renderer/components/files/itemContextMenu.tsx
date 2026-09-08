/**
 * itemContextMenu — le menu contextuel PARTAGÉ de l'explorateur.
 *
 * Un seul endroit décide de l'ORDRE des entrées, de leurs libellés et de leurs
 * icônes. Avant, chaque vue redéclarait son menu de son côté : l'accueil en
 * offrait cinq là où la vue dossier en offrait onze à quatorze, les icônes SVG
 * étaient recopiées d'un fichier à l'autre, et la moitié des libellés étaient
 * écrits en français directement dans le code. Le même clic droit ne donnait
 * donc pas le même menu selon l'écran où on se trouvait.
 *
 * Le partage se fait par CAPACITÉS : l'hôte déclare ce qu'il sait faire
 * (`caps`) et fournit les gestes (`handlers`) ; le builder décide où chaque
 * entrée tombe et où vont les séparateurs. Une entrée n'est produite que si sa
 * capacité est vraie ET que le geste correspondant existe — un hôte qui oublie
 * un gestionnaire n'affiche pas d'entrée morte.
 *
 * Le menu se referme TOUT SEUL : `ContextMenu.handleItemClick` appelle
 * `onClose()` juste après `onClick()` (et le chemin clavier fait de même).
 * Les gestionnaires n'ont donc rien à fermer eux-mêmes.
 */

import type { FC, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { isProtected, isUnlockedForSession } from '../../../services/auth/filePasswordService';
import { BoxFolderIcon, ProtectInPlaceIcon } from '../icons';

// ─────────────────────────────────────────────────────────────────────────────
// Icônes — 16×16, `currentColor`, tracé heroicons. Elles vivaient en double
// dans Home et FolderView ; elles n'existent plus qu'ici.
// ─────────────────────────────────────────────────────────────────────────────

const MenuIcon: FC<{ children: ReactNode }> = ({ children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="16"
    height="16"
  >
    {children}
  </svg>
);

export const FolderOpenIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
    />
  </MenuIcon>
);

export const EditIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
    />
  </MenuIcon>
);

export const InfoIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
    />
  </MenuIcon>
);

export const DownloadIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </MenuIcon>
);

/** « Afficher dans l'explorateur » — le dossier fermé de l'OS. */
export const ExplorerIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </MenuIcon>
);

/** « Couleur & icône » — le pinceau. */
export const StyleIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"
    />
  </MenuIcon>
);

export const MoveIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5"
    />
  </MenuIcon>
);

export const CopyIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
    />
  </MenuIcon>
);

export const StarIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
    />
  </MenuIcon>
);

export const BellIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
    />
  </MenuIcon>
);

/**
 * L'épingle (F27). Une punaise vue de face — le même trait que les autres
 * icônes de ce menu, jamais un emoji : un glyphe de police change de dessin
 * d'une plateforme à l'autre et casse l'alignement de la colonne.
 */
export const PinIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 17.25V21m-4.5-9.75V4.5A1.5 1.5 0 019 3h6a1.5 1.5 0 011.5 1.5v6.75l1.875 2.25a.75.75 0 01-.575 1.23H5.2a.75.75 0 01-.575-1.23L7.5 11.25z"
    />
  </MenuIcon>
);

export const ShareIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z"
    />
  </MenuIcon>
);

export const SyncIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.356v4.992"
    />
  </MenuIcon>
);

export const HistoryIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
    />
  </MenuIcon>
);

export const LockIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
    />
  </MenuIcon>
);

export const DeleteIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
    />
  </MenuIcon>
);

export const UploadIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
    />
  </MenuIcon>
);

export const FolderPlusIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
    />
  </MenuIcon>
);

/** « Aperçu » — l'œil : consulter sans déposer de clair sur le disque. */
export const EyeIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </MenuIcon>
);

/** « Remplacer le fichier » — la flèche circulaire d'une nouvelle version. */
export const ReplaceIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M9 13.5l3-3m0 0l3 3m-3-3v9M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
    />
  </MenuIcon>
);

/**
 * « Ajouter au coffre partagé » — le cadenas du coffre, avec le « + » de
 * l'ajout. Volontairement le MÊME cadenas que partout ailleurs (rail des
 * coffres, section de l'accueil) : c'est le même objet, il doit se reconnaître.
 */
export const VaultAddIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 13.5v3m1.5-1.5h-3" />
  </MenuIcon>
);

/**
 * « Ouvrir dans le coffre » — le MÊME cadenas que `VaultAddIcon`, sans le
 * « + » : c'est le coffre lui-même, pas l'entrée dans le coffre. Sert aussi de
 * vignette à la carte d'un raccourci (`FileCard`), pour que le raccourci se
 * reconnaisse au premier coup d'œil comme « quelque chose qui vit là-bas ».
 */
export const VaultIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5z"
    />
  </MenuIcon>
);

/** « Membres » — le trombinoscope d'un coffre partagé. */
export const PeopleIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
    />
  </MenuIcon>
);

/** « Activité » — le fil de ce qui s'est passé dans le coffre. */
export const ActivityIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.25 12h3.75l2.25-6 3.75 12 2.25-6h3.75"
    />
  </MenuIcon>
);

/** « Quitter le coffre » — la porte, pas la poubelle : rien n'est détruit. */
export const LeaveIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75"
    />
  </MenuIcon>
);

/** « Partager avec une personne » — la silhouette, pas le lien. */
export const PersonShareIcon: FC = () => (
  <MenuIcon>
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z"
    />
  </MenuIcon>
);

// ─────────────────────────────────────────────────────────────────────────────
// Menu d'un ÉLÉMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ce que l'hôte sait faire de cet élément. Tout est facultatif : une capacité
 * absente veut dire « cet écran ne propose pas ce geste », pas « ce geste est
 * interdit » (pour ce dernier cas, l'entrée existe et se montre désactivée —
 * c'est ce que fait le téléchargement d'un fichier protégé verrouillé).
 */
export interface ItemMenuCapabilities {
  /**
   * « Ouvrir dans le coffre » — l'entrée de TÊTE d'un RACCOURCI (fichier de
   * l'espace personnel dont les octets sont partis dans un coffre partagé,
   * `FileItem.vaultRef`). Il n'y a rien à ouvrir ici : on va là où c'est.
   */
  openInVault?: boolean;
  /** Ouvrir (dossier) — l'entrée de tête. */
  open?: boolean;
  /** Ouvrir dans l'éditeur d'un greffon (fichier dont un greffon revendique l'extension). */
  openInEditor?: boolean;
  openWith?: boolean;
  /**
   * Aperçu en mémoire — CONSULTER sans écrire de clair sur le disque. Le coffre
   * partagé en a besoin : y « ouvrir » un fichier voulait dire le télécharger.
   */
  preview?: boolean;
  details?: boolean;
  download?: boolean;
  showInExplorer?: boolean;
  rename?: boolean;
  /** « Couleur & icône » — la personnalisation d'un dossier. */
  style?: boolean;
  /**
   * Remplacer le CONTENU d'un fichier par un autre, l'ancien devenant une
   * révision. Propre au coffre partagé, où un fichier était sinon immuable.
   */
  replace?: boolean;
  move?: boolean;
  copy?: boolean;
  favorite?: boolean;
  reminder?: boolean;
  /**
   * « Épingler à l'aperçu » (F27) — propre au coffre partagé, et réservé à ses
   * administrateurs : l'épingle est vue par TOUT le coffre (elle vit dans le
   * bloc scellé des réglages), ce n'est pas un favori personnel. Un seul
   * élément à la fois, d'où la paire exclusive ci-dessous.
   */
  pin?: boolean;
  /** « Ne plus épingler » — la MOITIÉ opposée de `pin`, jamais les deux ensemble. */
  unpin?: boolean;
  /**
   * « Gérer l'accès » — le dialogue de partage UNIFIÉ (ShareDialog) : inviter,
   * la liste d'accès et le lien AU MÊME ENDROIT, façon Notion. Entrée de TÊTE
   * du groupe partage, plate (pas de sous-menu : `ContextMenuItem` n'en a pas).
   * N'a de sens qu'en mode nuage — l'hôte ne la pose pas en local.
   */
  manageAccess?: boolean;
  /** Partage E2EE par lien — n'a de sens qu'en mode nuage. */
  share?: boolean;
  /**
   * Partage avec UNE personne nommée (grant K_item du coffre partagé) — un acte
   * d'administration, distinct du lien public.
   */
  shareWithPerson?: boolean;
  /**
   * « Ajouter au coffre partagé… » — faire entrer CET élément de l'espace
   * personnel dans un coffre d'équipe (copie ou déplacement).
   *
   * L'hôte ne pose cette capacité que s'il existe au moins un coffre
   * DÉVERROUILLÉ où le rôle écrit (`useVaultAddTargets`). Sinon : pas d'entrée
   * du tout. Une entrée qui n'ouvrirait qu'un mur de vente n'a rien à faire
   * dans un menu contextuel — c'est la même règle que la section « Coffres
   * partagés » de l'accueil, qui n'apparaît pas non plus quand il n'y a rien.
   */
  addToVault?: boolean;
  /** Déclencher une synchronisation — n'a de sens qu'en mode nuage. */
  sync?: boolean;
  versions?: boolean;
  protect?: boolean;
  delete?: boolean;
  /**
   * « Retirer le raccourci » — REMPLACE `delete` pour un raccourci : même
   * geste (la fiche part à la corbeille douce, via le `deleteFile` ordinaire),
   * mais le mot « Supprimer » mentirait — les octets, eux, restent dans le
   * coffre et ne bougent pas.
   */
  removeShortcut?: boolean;

  // ── Un COFFRE PARTAGÉ vu comme un dossier ─────────────────────────────────
  // Un coffre est un dossier de plus dans le contenu ordinaire : son clic droit
  // passe donc par CE builder, et pas par un menu écrit à part dans l'accueil
  // puis recopié dans la liste des coffres. Ces trois entrées ne servent qu'à
  // lui — elles sont simplement absentes partout ailleurs.
  /**
   * Ouvrir la page « Gérer le coffre » (membres, invitations, activité,
   * danger). Elle a remplacé le volet « Membres » qu'ouvrait cette entrée : le
   * geste est le même, la destination est entière.
   */
  vaultManage?: boolean;
  /** Ouvrir le FIL D'ACTIVITÉ du coffre. */
  vaultActivity?: boolean;
  /** Quitter le coffre — on perd SON accès, on ne détruit RIEN. */
  vaultLeave?: boolean;
}

export interface ItemMenuHandlers {
  onOpenInVault?: () => void;
  onOpen?: () => void;
  onOpenInEditor?: () => void;
  onOpenWith?: () => void;
  onPreview?: () => void;
  onDetails?: () => void;
  onDownload?: () => void;
  onShowInExplorer?: () => void;
  onRename?: () => void;
  onStyle?: () => void;
  onReplace?: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onFavorite?: () => void;
  /**
   * Retirer des favoris.
   *
   * ⚠ CE HANDLER MANQUAIT, ET C'EST TOUT LE BUG.
   *
   * Le menu ne proposait qu'« Ajouter aux favoris ». Or c'est le SEUL endroit
   * d'où l'on pose un favori sur un dossier — et le retirer n'était possible
   * que depuis la barre latérale, à un autre endroit de l'écran. Un geste qui
   * ne se défait pas là où il se fait passe pour cassé, à juste titre.
   *
   * Pire : `addFavorite` ignore en silence un élément déjà favori, pendant que
   * l'appelant affichait quand même « ajouté aux favoris ». Cliquer une
   * seconde fois donnait donc une confirmation pour une action qui n'avait pas
   * eu lieu.
   */
  onUnfavorite?: () => void;
  onReminder?: () => void;
  onPin?: () => void;
  onUnpin?: () => void;
  onManageAccess?: () => void;
  onShare?: () => void;
  onShareWithPerson?: () => void;
  onAddToVault?: () => void;
  onSync?: () => void;
  onVersions?: () => void;
  onProtect?: () => void;
  onDelete?: () => void;
  onRemoveShortcut?: () => void;
  onVaultManage?: () => void;
  onVaultActivity?: () => void;
  onVaultLeave?: () => void;
}

/**
 * Ce que le builder a besoin de savoir de l'élément : son IDENTIFIANT, rien de
 * plus (il sert au verrou de téléchargement des fichiers protégés). `Item` —
 * le type Redux de l'espace personnel — y est assignable tel quel, et un
 * élément de coffre partagé aussi, sans fabriquer de fausse entité.
 */
export interface MenuTargetItem {
  id: string;
}

/**
 * Construit le menu contextuel d'un élément.
 *
 * L'ORDRE est fixe et commun à toutes les vues : ouvrir → consulter →
 * réorganiser → marquer → partager → sécuriser → supprimer. Les séparateurs
 * sont posés par le builder, jamais par l'appelant.
 *
 * `item` sert au verrou de téléchargement : un fichier protégé non déverrouillé
 * garde son entrée « Télécharger », mais désactivée et renommée, plutôt que de
 * disparaître (une entrée qui s'évapore n'apprend rien à personne).
 */
export function buildItemContextMenu(
  item: MenuTargetItem,
  caps: ItemMenuCapabilities,
  handlers: ItemMenuHandlers,
  t: TFunction
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  /**
   * Un RACCOURCI s'ouvre là où sont ses octets : en tête, avant tout — c'est
   * la seule façon de « l'ouvrir », et la carte le dit déjà.
   */
  if (caps.openInVault && handlers.onOpenInVault) {
    items.push({
      label: t('teamVaults.shortcut.openInVault', 'Ouvrir dans le coffre'),
      icon: <VaultIcon />,
      onClick: handlers.onOpenInVault,
    });
  }

  if (caps.open && handlers.onOpen) {
    items.push({
      label: t('contextMenu.open', 'Ouvrir'),
      icon: <FolderOpenIcon />,
      onClick: handlers.onOpen,
    });
  }

  /**
   * Les deux autres façons de REGARDER un coffre se rangent juste après
   * « Ouvrir », avant tout geste qui le modifie : sa page de gestion et son
   * fil. Elles n'apparaissent que pour un coffre.
   */
  if (caps.vaultManage && handlers.onVaultManage) {
    items.push({
      label: t('teamVaults.settings.menuManage', 'Gérer le coffre…'),
      icon: <PeopleIcon />,
      onClick: handlers.onVaultManage,
    });
  }

  if (caps.vaultActivity && handlers.onVaultActivity) {
    items.push({
      label: t('teamVaults.viewTab.activity', 'Activité'),
      icon: <ActivityIcon />,
      onClick: handlers.onVaultActivity,
    });
  }

  if (caps.openInEditor && handlers.onOpenInEditor) {
    items.push({
      label: t('contextMenu.openInEditor', 'Ouvrir dans l’éditeur'),
      icon: <EditIcon />,
      onClick: handlers.onOpenInEditor,
    });
  }

  // « Ouvrir avec… » — PAS un sous-menu : `ContextMenuItem` n'a ni champ
  // enfants ni notion de niveau, et lui en ajouter toucherait la navigation
  // clavier de TOUTES les vues. Une entrée qui ouvre une fenêtre de choix
  // coûte un clic de plus et ne déstabilise rien.
  if (caps.openWith && handlers.onOpenWith) {
    items.push({
      label: t('contextMenu.openWith', 'Ouvrir avec…'),
      icon: <EditIcon />,
      onClick: handlers.onOpenWith,
    });
  }

  if ((caps.openInEditor && handlers.onOpenInEditor) || (caps.openWith && handlers.onOpenWith)) {
    // Le choix d'ouverture est un geste à part : on le détache du reste.
    items.push({ divider: true });
  }

  /**
   * L'aperçu se range avec « consulter », juste avant les détails : c'est le
   * geste de lecture le moins engageant du lot (rien n'atterrit sur le disque).
   * Le libellé vient de la fonctionnalité elle-même (`teamVaults.preview.open`)
   * plutôt que d'un doublon sous `contextMenu.*` — même règle que « protéger
   * sur place » dans le menu de fond : une phrase, une seule vérité.
   */
  if (caps.preview && handlers.onPreview) {
    items.push({
      label: t('teamVaults.preview.open', 'Aperçu'),
      icon: <EyeIcon />,
      onClick: handlers.onPreview,
    });
  }

  if (caps.details && handlers.onDetails) {
    items.push({
      label: t('contextMenu.details', 'Voir les détails'),
      icon: <InfoIcon />,
      onClick: handlers.onDetails,
    });
  }

  if (caps.download && handlers.onDownload) {
    const locked = isProtected(item.id) && !isUnlockedForSession(item.id);
    items.push({
      label: locked
        ? t('contextMenu.downloadProtected', 'Télécharger (protégé)')
        : t('contextMenu.download', 'Télécharger'),
      icon: <DownloadIcon />,
      disabled: locked,
      onClick: handlers.onDownload,
    });
  }

  if (caps.showInExplorer && handlers.onShowInExplorer) {
    items.push({
      label: t('contextMenu.showInExplorer', "Afficher dans l'explorateur"),
      icon: <ExplorerIcon />,
      onClick: handlers.onShowInExplorer,
    });
  }

  if (caps.rename && handlers.onRename) {
    items.push({
      label: t('contextMenu.rename', 'Renommer'),
      icon: <EditIcon />,
      onClick: handlers.onRename,
    });
  }

  if (caps.style && handlers.onStyle) {
    items.push({
      label: t('contextMenu.folderStyle', 'Couleur & icône'),
      icon: <StyleIcon />,
      onClick: handlers.onStyle,
    });
  }

  /**
   * « Remplacer » suit « Renommer » : ce sont les deux gestes qui changent
   * l'élément SANS le déplacer. L'ancien contenu devient une révision, donc
   * l'entrée n'est jamais destructrice — pas de `danger`.
   */
  if (caps.replace && handlers.onReplace) {
    items.push({
      label: t('teamVaults.items.replace', 'Remplacer'),
      icon: <ReplaceIcon />,
      onClick: handlers.onReplace,
    });
  }

  if (caps.move && handlers.onMove) {
    items.push({
      label: t('contextMenu.move', 'Déplacer'),
      icon: <MoveIcon />,
      onClick: handlers.onMove,
    });
  }

  if (caps.copy && handlers.onCopy) {
    items.push({
      label: t('contextMenu.copy', 'Copier'),
      icon: <CopyIcon />,
      onClick: handlers.onCopy,
    });
  }

  // L'entree BASCULE, sur le modele de `pin`/`unpin` juste en dessous : c'est
  // le handler fourni qui decide du sens, et l'appelant sait, lui, si
  // l'element est deja en favori.
  if (caps.favorite && handlers.onUnfavorite) {
    items.push({
      label: t('contextMenu.removeFromFavorites', 'Retirer des favoris'),
      icon: <StarIcon />,
      onClick: handlers.onUnfavorite,
    });
  } else if (caps.favorite && handlers.onFavorite) {
    items.push({
      label: t('contextMenu.addToFavorites', 'Ajouter aux favoris'),
      icon: <StarIcon />,
      onClick: handlers.onFavorite,
    });
  }

  if (caps.reminder && handlers.onReminder) {
    items.push({
      label: t('contextMenu.addReminder', 'Ajouter un rappel'),
      icon: <BellIcon />,
      onClick: handlers.onReminder,
    });
  }

  /**
   * « ÉPINGLER À L'APERÇU » (F27) se range avec les autres façons de MARQUER un
   * élément (favori, rappel) et non avec le partage : épingler ne fait sortir
   * l'élément de nulle part, et ne change ni son emplacement ni qui y a accès.
   * La note reste une note ordinaire du coffre — l'épingle la DÉSIGNE, elle ne
   * la déplace pas.
   *
   * Les deux entrées sont EXCLUSIVES par construction (l'hôte sait si CET
   * élément est celui qui est épinglé) : proposer les deux ferait choisir entre
   * un geste et son contraire sur le même objet.
   */
  if (caps.pin && handlers.onPin) {
    items.push({
      label: t('teamVaults.pinned.menuPin', 'Épingler à l’aperçu'),
      icon: <PinIcon />,
      onClick: handlers.onPin,
    });
  }

  if (caps.unpin && handlers.onUnpin) {
    items.push({
      label: t('teamVaults.pinned.menuUnpin', 'Ne plus épingler'),
      icon: <PinIcon />,
      onClick: handlers.onUnpin,
    });
  }

  /**
   * « Gérer l'accès » OUVRE le groupe partage : c'est la réponse complète à
   * « qui d'autre y a accès » (inviter, liste, lien), dont les entrées qui
   * suivent ne sont que des raccourcis. Il pose le séparateur du groupe ; les
   * autres ne le reposent pas s'il l'a déjà fait — même mécanique que
   * `shareWithPerson` vis-à-vis de `share`.
   */
  const gereAcces = !!(caps.manageAccess && handlers.onManageAccess);
  if (gereAcces) {
    items.push({ divider: true });
    items.push({
      label: t('contextMenu.manageAccess', 'Manage access'),
      icon: <PeopleIcon />,
      onClick: handlers.onManageAccess,
    });
  }

  if (caps.share && handlers.onShare) {
    if (!gereAcces) items.push({ divider: true });
    items.push({
      label: t('contextMenu.shareLink', 'Partager par lien'),
      icon: <ShareIcon />,
      onClick: handlers.onShare,
    });
  }

  /**
   * Partager avec UNE personne : dans le même groupe que le lien public — les
   * deux « font sortir » l'élément — mais sans second séparateur, parce que
   * c'est le même geste vu sous deux angles (à qui, plutôt que comment).
   */
  if (caps.shareWithPerson && handlers.onShareWithPerson) {
    if (!gereAcces && (!caps.share || !handlers.onShare)) items.push({ divider: true });
    items.push({
      label: t('teamVaults.grants.shareWithPerson', 'Partager avec une personne'),
      icon: <PersonShareIcon />,
      onClick: handlers.onShareWithPerson,
    });
  }

  /**
   * « Ajouter au coffre partagé… » se range avec les deux autres façons de
   * faire SORTIR l'élément de chez soi (le lien, la personne) : c'est la
   * troisième réponse à « qui d'autre y a accès », pas un déplacement de plus.
   * Le séparateur n'est posé que si le groupe n'existait pas déjà.
   */
  if (caps.addToVault && handlers.onAddToVault) {
    const dejaGroupe =
      gereAcces ||
      !!(caps.share && handlers.onShare) ||
      !!(caps.shareWithPerson && handlers.onShareWithPerson);
    if (!dejaGroupe) items.push({ divider: true });
    items.push({
      label: t('teamVaults.addToVault.menu', 'Ajouter au coffre partagé…'),
      icon: <VaultAddIcon />,
      onClick: handlers.onAddToVault,
    });
  }

  if (caps.sync && handlers.onSync) {
    items.push({ divider: true });
    items.push({
      label: t('contextMenu.sync', 'Synchroniser'),
      icon: <SyncIcon />,
      onClick: handlers.onSync,
    });
  }

  if (caps.versions && handlers.onVersions) {
    items.push({ divider: true });
    items.push({
      label: t('contextMenu.versions', "Voir l'historique des versions"),
      icon: <HistoryIcon />,
      onClick: handlers.onVersions,
    });
  }

  if (caps.protect && handlers.onProtect) {
    items.push({
      label: t('contextMenu.protect', 'Protéger par mot de passe'),
      icon: <LockIcon />,
      onClick: handlers.onProtect,
    });
  }

  if (caps.delete && handlers.onDelete) {
    items.push({ divider: true });
    items.push({
      label: t('contextMenu.delete', 'Supprimer'),
      icon: <DeleteIcon />,
      onClick: handlers.onDelete,
      danger: true,
      shortcut: t('contextMenu.deleteShortcut', 'Suppr'),
    });
  }

  /**
   * « Retirer le raccourci » occupe la place de « Supprimer » : même corbeille
   * douce, même raccourci clavier, mais un libellé qui dit ce qui se passe
   * VRAIMENT — la fiche part, les octets du coffre restent.
   */
  if (caps.removeShortcut && handlers.onRemoveShortcut) {
    items.push({ divider: true });
    items.push({
      label: t('teamVaults.shortcut.remove', 'Retirer le raccourci'),
      icon: <DeleteIcon />,
      onClick: handlers.onRemoveShortcut,
      danger: true,
      shortcut: t('contextMenu.deleteShortcut', 'Suppr'),
    });
  }

  /**
   * « Quitter le coffre » ferme le menu, à la place qu'occuperait « Supprimer ».
   * `danger` parce que c'est irréversible SANS nouvelle invitation — mais ce
   * n'est PAS une suppression : le coffre et son contenu continuent d'exister
   * pour les autres, et le libellé le dit à la place de l'icône de poubelle.
   */
  if (caps.vaultLeave && handlers.onVaultLeave) {
    items.push({ divider: true });
    items.push({
      label: t('teamVaults.leave.menu', 'Quitter le coffre'),
      icon: <LeaveIcon />,
      onClick: handlers.onVaultLeave,
      danger: true,
    });
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Menu de FOND (clic droit sur la zone vide d'une vue)
// ─────────────────────────────────────────────────────────────────────────────

export interface BackgroundMenuCapabilities {
  newFolder?: boolean;
  /**
   * Un coffre partagé se crée depuis le fond de l'ACCUEIL (lot A, C4) — la
   * racine mêle dossiers et coffres. Règle 13 : jamais hors nuage.
   */
  newVault?: boolean;
  /** « J'ai un code d'invitation… » — l'autre moitié : rejoindre le coffre d'un autre. */
  inviteCode?: boolean;
  /** Ajouter des fichiers ICI — seulement là où un conteneur peut les recevoir. */
  addFiles?: boolean;
  protectFiles?: boolean;
  protectFolder?: boolean;
}

export interface BackgroundMenuHandlers {
  onNewFolder?: () => void;
  onNewVault?: () => void;
  onInviteCode?: () => void;
  onAddFiles?: () => void;
  onProtectFiles?: () => void;
  onProtectFolder?: () => void;
}

/**
 * La variante « fond » du builder : ce qu'on peut faire là où il n'y a pas
 * d'élément sous le curseur. Les deux vues d'explorateur en partagent l'ordre
 * pour que le clic droit dans le vide réponde pareil partout.
 *
 * Les libellés « protéger sur place » restent sous `desktopProtection.*` : ce
 * sont ceux de la fonctionnalité, déjà traduits, et les dupliquer sous
 * `contextMenu.*` créerait deux vérités pour une même phrase.
 */
export function buildBackgroundContextMenu(
  caps: BackgroundMenuCapabilities,
  handlers: BackgroundMenuHandlers,
  t: TFunction
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  if (caps.newFolder && handlers.onNewFolder) {
    items.push({
      label: t('contextMenu.newFolder', 'Nouveau dossier'),
      icon: <FolderPlusIcon />,
      onClick: handlers.onNewFolder,
    });
  }

  // Les deux gestes « coffre » suivent « Nouveau dossier » dans le MÊME ordre
  // que le bouton « Nouveau » de l'accueil : créer, puis rejoindre.
  if (caps.newVault && handlers.onNewVault) {
    items.push({
      label: t('contextMenu.newVault', 'Nouveau coffre partagé'),
      icon: <VaultAddIcon />,
      onClick: handlers.onNewVault,
    });
  }

  if (caps.inviteCode && handlers.onInviteCode) {
    items.push({
      label: t('contextMenu.inviteCode', "J'ai un code d'invitation…"),
      icon: <PersonShareIcon />,
      onClick: handlers.onInviteCode,
    });
  }

  if (caps.addFiles && handlers.onAddFiles) {
    items.push({
      label: t('desktopProtection.contextMenu.addFiles', 'Ajouter des fichiers…'),
      icon: <UploadIcon />,
      onClick: handlers.onAddFiles,
    });
  }

  const protectEntries: ContextMenuItem[] = [];
  if (caps.protectFiles && handlers.onProtectFiles) {
    protectEntries.push({
      label: t('desktopProtection.contextMenu.protectFiles', 'Protéger des fichiers sur place…'),
      icon: <ProtectInPlaceIcon size={16} />,
      onClick: handlers.onProtectFiles,
    });
  }
  if (caps.protectFolder && handlers.onProtectFolder) {
    protectEntries.push({
      label: t('desktopProtection.contextMenu.protectFolder', 'Protéger un dossier sur place…'),
      icon: <BoxFolderIcon size={16} />,
      onClick: handlers.onProtectFolder,
    });
  }

  if (protectEntries.length > 0) {
    // Le séparateur n'a de sens qu'entre deux groupes : pas de trait en tête.
    if (items.length > 0) items.push({ divider: true });
    items.push(...protectEntries);
  }

  return items;
}
