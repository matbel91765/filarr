/**
 * LES BLOCS DE STRUCTURE — ceux qui ne montrent aucune donnée.
 *
 * ── POURQUOI CES CINQ-LÀ SONT LES PLUS IMPORTANTS ───────────────────────────
 *
 * Vingt-six blocs affichaient tous QUELQUE CHOSE : des notes, des dossiers, des
 * chiffres. Aucun ne permettait de dire « ici commence une section », « laisse
 * un blanc », « écris ce mot ». Une disposition ne pouvait donc qu'empiler des
 * boîtes pleines, et c'est exactement ce qui donne à un accueil composé son air
 * de tableau de bord d'aéroport.
 *
 * Ces cinq blocs ne servent à rien tout seuls. Ce sont eux, pourtant, qui
 * rendent les vingt-six autres composables — et ce sont eux qu'un gabarit
 * publié utilisera pour se rendre lisible chez quelqu'un d'autre.
 *
 * ── DU TEXTE ÉCRIT PAR QUELQU'UN, RENDU CHEZ QUELQU'UN D'AUTRE ──────────────
 *
 * Trois d'entre eux portent du texte libre, et ce texte VOYAGE : il part dans
 * le `.filarrlayout`, passe par la place de marché, et s'affiche chez un
 * inconnu. Il est donc rendu en TEXTE — jamais en HTML, jamais par
 * `dangerouslySetInnerHTML` — et écrêté à la LECTURE et non à la saisie, parce
 * qu'un gabarit n'a jamais tapé dans un champ.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import {
  readEnumOption,
  readTextOption,
  type WidgetOptionSchema,
  type WidgetProps,
} from '../widgetOptions';
import './blocks.css';

// ==================== 1. Titre de section ====================

export const SECTION_HEADING_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'text',
    key: 'label',
    labelKey: 'home.widgets.opt.headingLabel',
    fallback: '',
    // Soixante caractères : un titre de section est un REPÈRE, pas une phrase.
    // Au-delà il ne tient plus sur une ligne et cesse de se lire d'un coup
    // d'œil, ce qui est la seule chose qu'on lui demande.
    maxLength: 60,
    placeholderKey: 'home.widgets.opt.headingPlaceholder',
  },
  {
    kind: 'enum',
    key: 'size',
    labelKey: 'home.widgets.opt.headingSize',
    fallback: 'small',
    choices: [
      { value: 'small', labelKey: 'home.widgets.opt.headingSizeSmall' },
      { value: 'medium', labelKey: 'home.widgets.opt.headingSizeMedium' },
      { value: 'large', labelKey: 'home.widgets.opt.headingSizeLarge' },
    ],
  },
  {
    kind: 'boolean',
    key: 'rule',
    labelKey: 'home.widgets.opt.headingRule',
    fallback: true,
  },
];

export const SectionHeadingWidget: React.FC<WidgetProps> = React.memo(
  function SectionHeadingWidget({ options, editing }) {
    const { t } = useTranslation();
    const label = readTextOption(SECTION_HEADING_OPTIONS, options, 'label');
    const size = readEnumOption(SECTION_HEADING_OPTIONS, options, 'size');
    const rule = options?.rule !== false;

    // Un titre vide en lecture n'affiche RIEN — pas même un filet. En édition il
    // se montre, sinon on ne pourrait ni le sélectionner ni le remplir : un bloc
    // qu'on ne peut pas atteindre est un bloc qu'on ne peut pas retirer.
    if (!label && !editing) return null;

    return (
      <div className={`blk-heading blk-heading--${size}`}>
        <span className="blk-heading__text">
          {label || t('home.widgets.opt.headingPlaceholder')}
        </span>
        {rule && <span className="blk-heading__rule" aria-hidden="true" />}
      </div>
    );
  }
);

// ==================== 2. Filet ====================

export const DIVIDER_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'enum',
    key: 'style',
    labelKey: 'home.widgets.opt.dividerStyle',
    fallback: 'line',
    choices: [
      { value: 'line', labelKey: 'home.widgets.opt.dividerLine' },
      { value: 'dashed', labelKey: 'home.widgets.opt.dividerDashed' },
      { value: 'dots', labelKey: 'home.widgets.opt.dividerDots' },
      { value: 'gradient', labelKey: 'home.widgets.opt.dividerGradient' },
    ],
  },
];

export const DividerWidget: React.FC<WidgetProps> = React.memo(function DividerWidget({ options }) {
  const style = readEnumOption(DIVIDER_OPTIONS, options, 'style');
  // `role="separator"` et non un simple trait décoratif : c'est une vraie
  // frontière de contenu, et un lecteur d'écran doit l'annoncer comme telle.
  return <div className={`blk-divider blk-divider--${style}`} role="separator" />;
});

// ==================== 3. Espace ====================

/**
 * Un blanc. Rien d'autre, et surtout PAS un `null`.
 *
 * La tentation serait de ne rien rendre du tout. Le moteur de grille garderait
 * la case — un emplacement reste un emplacement —, mais le bloc n'aurait alors
 * aucune cible de clic : impossible de le sélectionner pour le déplacer ou le
 * supprimer. Un élément vide qui occupe sa case est la seule forme utilisable.
 */
export const SpacerWidget: React.FC<WidgetProps> = React.memo(function SpacerWidget({ editing }) {
  return (
    <div className={`blk-spacer${editing ? ' blk-spacer--editing' : ''}`} aria-hidden="true" />
  );
});

// ==================== 4. Bloc de texte ====================

export const TEXT_BLOCK_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'text',
    key: 'body',
    labelKey: 'home.widgets.opt.textBody',
    fallback: '',
    // Deux mille caractères : de quoi écrire une consigne, une intention de la
    // semaine, un rappel. Au-delà, ce n'est plus un bloc d'accueil, c'est une
    // note — et il en existe un bloc pour ça.
    maxLength: 2000,
    multiline: true,
    placeholderKey: 'home.widgets.opt.textPlaceholder',
  },
  {
    kind: 'enum',
    key: 'size',
    labelKey: 'home.widgets.opt.textSize',
    fallback: 'normal',
    choices: [
      { value: 'small', labelKey: 'home.widgets.opt.textSizeSmall' },
      { value: 'normal', labelKey: 'home.widgets.opt.textSizeNormal' },
      { value: 'large', labelKey: 'home.widgets.opt.textSizeLarge' },
      { value: 'quote', labelKey: 'home.widgets.opt.textSizeQuote' },
    ],
  },
  {
    kind: 'enum',
    key: 'align',
    labelKey: 'home.widgets.opt.textAlign',
    fallback: 'start',
    choices: [
      { value: 'start', labelKey: 'home.widgets.opt.alignStart' },
      { value: 'center', labelKey: 'home.widgets.opt.alignCenter' },
    ],
  },
];

export const TextBlockWidget: React.FC<WidgetProps> = React.memo(function TextBlockWidget({
  options,
  editing,
}) {
  const { t } = useTranslation();
  const body = readTextOption(TEXT_BLOCK_OPTIONS, options, 'body');
  const size = readEnumOption(TEXT_BLOCK_OPTIONS, options, 'size');
  const align = readEnumOption(TEXT_BLOCK_OPTIONS, options, 'align');

  if (!body && !editing) return null;

  return (
    <div className={`blk-text blk-text--${size} blk-text--${align}`}>
      {/* ⚠ `{body}` — du texte, rendu par React, donc échappé. Ce texte peut
          venir d'un gabarit publié par un inconnu ; le passer par
          `dangerouslySetInnerHTML` pour « gérer les retours à la ligne »
          serait ouvrir une injection dans une application qui manipule des
          clés. Les retours à la ligne sont tenus par `white-space: pre-wrap`. */}
      {body || t('home.widgets.opt.textPlaceholder')}
    </div>
  );
});

// ==================== 5. Bandeau ====================

export const HERO_OPTIONS: WidgetOptionSchema = [
  {
    kind: 'text',
    key: 'title',
    labelKey: 'home.widgets.opt.heroTitle',
    fallback: '',
    maxLength: 80,
    placeholderKey: 'home.widgets.opt.heroTitlePlaceholder',
  },
  {
    kind: 'text',
    key: 'subtitle',
    labelKey: 'home.widgets.opt.heroSubtitle',
    fallback: '',
    maxLength: 160,
  },
  {
    kind: 'enum',
    key: 'tint',
    labelKey: 'home.widgets.opt.heroTint',
    fallback: 'accent',
    choices: [
      { value: 'accent', labelKey: 'home.widgets.opt.heroTintAccent' },
      { value: 'dusk', labelKey: 'home.widgets.opt.heroTintDusk' },
      { value: 'moss', labelKey: 'home.widgets.opt.heroTintMoss' },
      { value: 'ember', labelKey: 'home.widgets.opt.heroTintEmber' },
      { value: 'ink', labelKey: 'home.widgets.opt.heroTintInk' },
    ],
  },
];

/**
 * Un bandeau coloré avec un titre.
 *
 * Les cinq teintes sont des DÉGRADÉS DE JETONS, pas des couleurs écrites en
 * dur : un bandeau « braise » composé sur un thème sombre doit rester lisible
 * une fois le thème changé, et un `#ff6b35` figé ne le serait pas. Le texte,
 * lui, est toujours pris à l'opposé du dégradé.
 */
export const HeroWidget: React.FC<WidgetProps> = React.memo(function HeroWidget({
  options,
  editing,
}) {
  const { t } = useTranslation();
  const title = readTextOption(HERO_OPTIONS, options, 'title');
  const subtitle = readTextOption(HERO_OPTIONS, options, 'subtitle');
  const tint = readEnumOption(HERO_OPTIONS, options, 'tint');

  if (!title && !subtitle && !editing) return null;

  return (
    <div className={`blk-hero blk-hero--${tint}`}>
      <p className="blk-hero__title">{title || t('home.widgets.opt.heroTitlePlaceholder')}</p>
      {subtitle && <p className="blk-hero__subtitle">{subtitle}</p>}
    </div>
  );
});
