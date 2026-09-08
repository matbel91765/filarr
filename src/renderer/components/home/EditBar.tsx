/**
 * Mode édition — LA BARRE.
 *
 * ── ELLE EST ANCRÉE, PAS FLOTTANTE ──────────────────────────────────────────
 *
 * Elle prend la place de l'en-tête de l'accueil, dans le flux, au-dessus de la
 * grille. Aucune position `fixed`, aucun `sticky` : une barre qui se décolle
 * passe devant le contenu qu'on est en train de ranger, et pendant un glissement
 * elle devient une zone morte qu'on traverse sans comprendre pourquoi le widget
 * ne se pose pas. Elle entre et sort avec le mode, donc elle n'ajoute RIEN à un
 * accueil au repos.
 *
 * ── CE QU'ELLE PORTE, DANS CET ORDRE ────────────────────────────────────────
 *
 *   [Ajouter un élément] [Modèle ▾]   [↶ ↷]   [⋯]   [Terminé]
 *
 * Rien d'autre. Chaque bouton de plus ici est un bouton de moins dans le
 * panneau, où il aurait sa place et son explication.
 *
 * ── « MODÈLE ▾ » OUVRE LES TROIS MODÈLES ────────────────────────────────────
 *
 * Le bouton existait et ouvrait le panneau des gabarits INSTALLÉS — c'est-à-dire
 * une liste vide chez presque tout le monde, puisque personne n'a encore publié
 * ni installé quoi que ce soit. Il ouvre maintenant le sélecteur des trois
 * modèles prêts à l'emploi (`presets/PresetPicker`), et le panneau des gabarits
 * installés reste à un clic depuis ce sélecteur (« Voir les modèles installés… »)
 * : c'est la même destination, atteinte par la porte qui a quelque chose à
 * montrer.
 *
 * L'entrée « Repartir d'un modèle… » du menu « ⋯ » mène au MÊME sélecteur. Deux
 * chemins vers deux listes différentes de modèles auraient été deux produits.
 *
 * ── SAUF DANS UN BANDEAU DE DOSSIER ─────────────────────────────────────────
 *
 * Les trois modèles sont des modèles d'ACCUEIL (salutation, lanceur de
 * recherche, tous les dossiers en 12×6) et ils s'appliquent en REMPLAÇANT le
 * brouillon entier — ce qui, dans la session d'un dossier, emportait
 * l'emplacement réservé `folder-config`, donc l'icône, la couverture et la note
 * d'accueil au « Terminé ». Un appelant qui a ses propres modèles fournit
 * `onPickTemplate` : « Modèle ▾ » et « Repartir d'un modèle… » lui sont alors
 * confiés, et le sélecteur d'accueil n'est même pas monté.
 *
 * ── LA LARGEUR EST DANS LE « ⋯ », PAS DANS LA BARRE ─────────────────────────
 *
 * « Centré » / « Pleine largeur » est un réglage de PAGE : il ne concerne aucun
 * bloc en particulier, donc l'inspecteur — qui ne s'ouvre que sur un bloc
 * sélectionné — n'est pas son endroit. Restait la barre, et la loi écrite
 * quinze lignes plus haut vaut aussi pour lui : « chaque bouton de plus ici est
 * un bouton de moins dans le panneau ». Un troisième bouton visible, à côté de
 * « Ajouter un élément » et de « Modèle », se disputerait le regard avec les
 * deux gestes qu'on vient réellement faire.
 *
 * Il va donc dans le menu « ⋯ », qui est exactement fait pour ça : ce qu'on
 * règle UNE FOIS, pas ce qu'on fait à chaque session. Les deux valeurs y sont
 * montrées ensemble, celle qui est active portant une coche — un menu qui
 * n'afficherait que « Passer en pleine largeur » obligerait à cliquer pour
 * savoir dans quel mode on est.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/Button/Button';
import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import { PresetPicker } from './presets/PresetPicker';
import type { HomeWidth } from './homeConfig';
import './homeEdit.css';

export interface EditBarProps {
  /** Le panneau montre le catalogue. */
  addActive: boolean;
  /** Le panneau montre les gabarits INSTALLÉS. */
  templatesActive: boolean;
  onToggleAdd: () => void;
  /**
   * Ouvre le panneau des gabarits installés. Ce n'est plus la destination du
   * bouton « Modèle ▾ » (qui montre les trois modèles prêts à l'emploi) mais
   * celle du lien « Voir les modèles installés… » du sélecteur.
   */
  onOpenTemplates: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
  /**
   * La largeur de la PAGE, pas d'un bloc. Voir l'en-tête.
   *
   * ── POURQUOI C'EST FACULTATIF ─────────────────────────────────────────────
   *
   * Cette barre sert DEUX écrans : l'accueil et le bandeau de dossier
   * (`folder/FolderWidgetBand.tsx`). Le bandeau, lui, n'a pas de largeur à
   * régler — la vue dossier n'a jamais porté de plafond (`FolderView` est en
   * `flex-1 px-6`), elle occupe donc déjà toute la fenêtre et n'a aucun vide
   * latéral à combler. Lui imposer un couple de propriétés qu'il ne peut
   * qu'inventer aurait été lui faire porter un réglage sans objet.
   *
   * Absentes, les deux entrées ne sont tout simplement pas rendues : le menu
   * « ⋯ » du bandeau reste exactement ce qu'il était.
   */
  width?: HomeWidth;
  /** Un pas d'édition comme un autre : annulable, scellé à la sortie. */
  onWidth?: (width: HomeWidth) => void;
  /**
   * L'appelant a SES modèles (le bandeau de dossier) : « Modèle ▾ » et
   * « Repartir d'un modèle… » l'appellent au lieu d'ouvrir les modèles
   * d'accueil, qui ne décrivent pas un bandeau et effaceraient sa configuration.
   */
  onPickTemplate?: () => void;
  /**
   * « Enregistrer comme… » — garder CETTE disposition sous un nouveau nom.
   *
   * ── POURQUOI CE BOUTON MANQUAIT, ET CE QU'IL CHANGE ───────────────────────
   *
   * « Terminé » scelle la disposition PAR-DESSUS celle qu'on avait. Les mises
   * en page nommées, elles, ne naissaient que d'un modèle appliqué ou d'un
   * fichier importé — c'est-à-dire toujours du travail de quelqu'un d'autre,
   * jamais du sien. Pour garder son accueil ET en essayer un autre, il fallait
   * exporter un fichier puis le réimporter : un aller-retour par le disque pour
   * dupliquer ce qui est déjà en mémoire.
   *
   * ── FACULTATIF, COMME LA LARGEUR ──────────────────────────────────────────
   *
   * Cette barre sert aussi le bandeau de dossier, qui n'a pas de mises en page
   * nommées : absent, le bouton n'est pas rendu.
   */
  onSaveAs?: () => void;
}

/** Flèche de retour. Le produit n'embarque pas de bibliothèque d'icônes. */
const UndoIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className="home-editbar__glyph"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 14 4 9l5-5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h9a7 7 0 0 1 0 14h-3" />
  </svg>
);

/** La même, retournée — un miroir CSS suffirait mais mentirait aux lecteurs d'écran. */
const RedoIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className="home-editbar__glyph"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m15 14 5-5-5-5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 9h-9a7 7 0 0 0 0 14h3" />
  </svg>
);

const MoreIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="home-editbar__glyph"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

/**
 * La coche du choix actif. Quand il ne l'est pas, une cale de la même taille :
 * le porte-icône du menu fait 20 px de large quoi qu'on y mette, et laisser la
 * case vide décalerait le libellé inactif par rapport à l'actif.
 */
const CheckIcon: React.FC<{ on: boolean }> = ({ on }) =>
  on ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className="home-editbar__glyph"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  ) : (
    <span aria-hidden="true" />
  );

export const EditBar: React.FC<EditBarProps> = ({
  addActive,
  templatesActive,
  onToggleAdd,
  onOpenTemplates,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDone,
  width,
  onWidth,
  onPickTemplate,
  onSaveAs,
}) => {
  const { t } = useTranslation();

  /**
   * Le sélecteur vit ICI, dans un état local, et pas dans la session d'édition
   * du store : c'est une boîte qu'on ouvre et qu'on referme, pas un pas de
   * rangement. Ce qu'elle produit, en revanche — poser un modèle — passe par
   * `pushLayoutDraft` comme tous les autres gestes, donc s'annule au Ctrl+Z.
   */
  const [presetsOpen, setPresetsOpen] = useState(false);
  const openTemplates = onPickTemplate ?? (() => setPresetsOpen(true));

  const undoLabel = t('home.customize.undo', 'Annuler');
  const redoLabel = t('home.customize.redo', 'Rétablir');

  /**
   * Le menu « ⋯ ». La largeur de la page d'abord — c'est le réglage qu'on vient
   * y chercher —, puis, DERRIÈRE UN FILET, « Repartir d'un modèle… » : c'est le
   * seul geste de cette barre qui puisse effacer du travail, il n'a rien à faire
   * collé aux deux autres, au premier clic venu.
   */
  const widthItems: DropdownItem[] =
    width && onWidth
      ? [
          {
            label: t('home.customize.widthCentered', 'Accueil centré'),
            icon: <CheckIcon on={width === 'centered'} />,
            onClick: () => onWidth('centered'),
          },
          {
            label: t('home.customize.widthFull', 'Accueil pleine largeur'),
            icon: <CheckIcon on={width === 'full'} />,
            onClick: () => onWidth('full'),
            divider: true,
          },
        ]
      : [];

  const moreItems: DropdownItem[] = [
    ...widthItems,
    {
      label: t('home.customize.restart', 'Repartir d’un modèle…'),
      onClick: openTemplates,
    },
  ];

  return (
    <div className="home-editbar" role="toolbar" aria-label={t('home.customize.title')}>
      <Button
        variant={addActive ? 'secondary' : 'tertiary'}
        size="sm"
        aria-pressed={addActive}
        onClick={onToggleAdd}
      >
        {t('home.customize.addWidget', 'Ajouter un élément')}
      </Button>

      <Button
        variant={templatesActive || presetsOpen ? 'secondary' : 'tertiary'}
        size="sm"
        aria-pressed={templatesActive || presetsOpen}
        aria-haspopup={onPickTemplate ? undefined : 'dialog'}
        onClick={openTemplates}
      >
        {t('home.customize.templates', 'Modèle')}
        <span aria-hidden="true"> ▾</span>
      </Button>

      {/* Les deux flèches sont DÉSACTIVÉES quand leur pile est vide : un bouton
          qui ne fait rien au clic est pire qu'un bouton grisé — on croit que le
          geste est parti et on continue. */}
      <div className="home-editbar__group">
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo}
          aria-label={undoLabel}
          title={undoLabel}
          onClick={onUndo}
          leftIcon={<UndoIcon />}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRedo}
          aria-label={redoLabel}
          title={redoLabel}
          onClick={onRedo}
          leftIcon={<RedoIcon />}
        />
      </div>

      <div className="home-editbar__spacer" />

      <Dropdown
        position="bottom-right"
        items={moreItems}
        trigger={
          <span
            className="home-editbar__more"
            aria-label={t('home.customize.moreActions', 'Autres actions')}
            title={t('home.customize.moreActions', 'Autres actions')}
          >
            <MoreIcon />
          </span>
        }
      />

      {/* AVANT « Terminé », et en secondaire : les deux gestes sont distincts —
          « je valide mes changements » n'est pas « j'en fais une variante » — et
          le principal reste celui qu'on cherche neuf fois sur dix. */}
      {onSaveAs && (
        <Button variant="secondary" size="sm" onClick={onSaveAs}>
          {t('home.customize.saveAs', 'Enregistrer comme…')}
        </Button>
      )}

      <Button variant="primary" size="sm" onClick={onDone}>
        {t('home.customize.finish', 'Terminé')}
      </Button>

      {/* Les trois modèles prêts à l'emploi. La boîte est montée en permanence
          (elle ne rend rien tant qu'elle est fermée) pour que son état de
          confirmation ne soit pas recréé à chaque ouverture. */}
      {!onPickTemplate && (
        <PresetPicker
          isOpen={presetsOpen}
          onClose={() => setPresetsOpen(false)}
          onOpenInstalled={onOpenTemplates}
        />
      )}
    </div>
  );
};

export default EditBar;
