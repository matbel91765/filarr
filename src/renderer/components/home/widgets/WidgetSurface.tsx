/**
 * LE CADRE INTÉRIEUR D'UN BLOC — carte, ou colonne.
 *
 * ── POURQUOI UN RÉGLAGE, ET PAS DEUX WIDGETS ────────────────────────────────
 *
 * Trois blocs (« Reprendre », « Rappels à venir », « Notes épinglées ») servent
 * dans DEUX modèles qui ne se ressemblent pas : « Essentiel » les veut en
 * colonne nue, sans bordure, avec des lignes ; « Tableau de bord » les veut sur
 * une surface, dans une grille dense. Écrire deux composants par bloc aurait
 * garanti qu'ils divergent (c'est déjà arrivé au menu contextuel des dossiers,
 * qui avait fini par avoir « son dialecte » selon l'écran) ; laisser le modèle
 * décider par un réglage garde UN composant, UN sélecteur, UNE liste.
 *
 * Le réglage voyage dans `LayoutSlot.options`, donc il traverse le gabarit, la
 * synchronisation et le menu du bloc — l'utilisateur peut passer un bloc de la
 * carte à la colonne sans quitter son accueil.
 *
 * ── LE REPLI EST « CARTE » ──────────────────────────────────────────────────
 *
 * Un bloc posé à la main depuis la palette tombe au milieu d'un accueil qui, la
 * plupart du temps, est déjà fait de cartes. La colonne, elle, ne se justifie
 * que dans une composition qui l'a choisie — c'est le modèle qui la demande.
 */

import React from 'react';

import { readEnumOption, type WidgetOptionField, type WidgetOptionSchema } from '../widgetOptions';
import '../presets/homePresets.css';

/**
 * Le réglage, à ajouter tel quel au schéma d'un bloc.
 *
 * ── SIX CADRES, ET CHACUN RÉPOND À UNE SITUATION DE COMPOSITION ────────────
 *
 *   · CARTE — le défaut. Une surface, un contour : le bloc s'annonce.
 *   · COLONNE — ni surface ni contour, des lignes. Pour une composition qui
 *     enchaîne les listes sans vouloir d'une grille de boîtes.
 *   · NU — rien du tout, pas même le libellé encadré. Le contenu flotte sur la
 *     page. C'est ce qu'il faut sous un titre de section, qui annonce déjà.
 *   · CONTOUR — un trait, pas de fond. Sur un décor animé, une surface pleine
 *     bouche l'image ; un contour la laisse voir tout en tenant le bloc.
 *   · VERRE — surface translucide et floutée. N'existe QUE pour les décors :
 *     posé sur un fond uni il ne se distingue pas d'une carte, et c'est très
 *     bien ainsi — il ne fabrique pas d'effet là où il n'y a rien derrière.
 *   · ACCENT — une barre de couleur à gauche et un fond teinté. Pour le seul
 *     bloc qu'on veut voir en premier ; s'en servir deux fois sur la même page
 *     revient à ne rien mettre en avant.
 */
export const FRAME_OPTION: WidgetOptionField = {
  kind: 'enum',
  key: 'frame',
  labelKey: 'home.widgets.opt.frame',
  fallback: 'card',
  choices: [
    { value: 'card', labelKey: 'home.widgets.opt.frameCard' },
    { value: 'column', labelKey: 'home.widgets.opt.frameColumn' },
    { value: 'plain', labelKey: 'home.widgets.opt.framePlain' },
    { value: 'outline', labelKey: 'home.widgets.opt.frameOutline' },
    { value: 'glass', labelKey: 'home.widgets.opt.frameGlass' },
    { value: 'accent', labelKey: 'home.widgets.opt.frameAccent' },
  ],
};

const FRAME_SCHEMA: WidgetOptionSchema = [FRAME_OPTION];

export type WidgetFrameStyle = 'card' | 'column' | 'plain' | 'outline' | 'glass' | 'accent';

/**
 * Le cadre demandé par CE bloc. Une valeur inconnue (gabarit d'une version plus
 * récente, fichier trafiqué) retombe sur le repli du schéma — jamais sur un
 * rendu que le schéma n'autorise pas.
 */
const FRAME_STYLES: readonly WidgetFrameStyle[] = [
  'card',
  'column',
  'plain',
  'outline',
  'glass',
  'accent',
];

export function frameOf(options: Record<string, unknown> | undefined): WidgetFrameStyle {
  const value = readEnumOption(FRAME_SCHEMA, options, 'frame');
  // ⚠ On confronte à LA LISTE et non à une suite de `===` : c'est la même
  // liste que celle des choix déclarés, donc ajouter un cadre au schéma sans
  // l'ajouter ici ne peut plus donner un cadre qui « retombe sur carte » sans
  // que rien ne le signale. C'est exactement ce qui serait arrivé aux quatre
  // cadres ajoutés ici, si l'ancien ternaire était resté.
  return (FRAME_STYLES as readonly string[]).includes(value) ? (value as WidgetFrameStyle) : 'card';
}

export interface WidgetSurfaceProps {
  frame: WidgetFrameStyle;
  /** Le libellé du bloc — TOUJOURS en petites majuscules espacées. */
  label: string;
  /** Contrôles à droite du libellé (« tout voir »…). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export const WidgetSurface: React.FC<WidgetSurfaceProps> = ({
  frame,
  label,
  actions,
  children,
}) => (
  <section
    className={
      frame === 'column'
        ? 'home-column h-full flex flex-col min-h-0 gap-3 py-2'
        : frame === 'card'
          ? 'home-card'
          : `home-card home-card--${frame}`
    }
  >
    <div className="flex items-center justify-between gap-3 home-widget__header">
      <h2 className="home-card__label">{label}</h2>
      {actions}
    </div>
    {/* Le corps scrolle DANS le bloc : le moteur de grille travaille en rangées
        de hauteur fixe, et un contenu qui grandit recouvrirait le bloc d'en
        dessous au lieu de rester dans sa case. */}
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">{children}</div>
  </section>
);

export default WidgetSurface;
