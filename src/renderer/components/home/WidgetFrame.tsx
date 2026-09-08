/**
 * Accueil modulaire — LE CADRE D'UN BLOC.
 *
 * ── LOI Nº1 : AU REPOS, LE CADRE N'EXISTE PAS ───────────────────────────────
 *
 * Ni bordure, ni fond, ni ombre, ni arrondi, ni poignée, ni bouton. RIEN. Un
 * accueil que personne n'a personnalisé doit être indiscernable d'un accueil
 * écrit à la main — c'est la condition pour que la modularité soit un cadeau et
 * non une taxe. Le jour où le cadre pose un liseré « pour montrer que c'est un
 * widget », tous les accueils du produit se ressemblent, et le nôtre ressemble à
 * un tableau de bord d'administration.
 *
 * Ce que le cadre s'autorise :
 *   · AU SURVOL, une icône de 24 px en haut à droite, opacité 0 → 1. C'est la
 *     seule affordance permanente, et elle ne coûte rien tant que la souris est
 *     ailleurs.
 *   · EN ÉDITION, une bordure de 1 px et le nom du bloc. Là, c'est nécessaire :
 *     un bloc vide (aucune note sans dossier, aucun coffre) n'a aucun pixel à
 *     lui, et sans bordure on ne pourrait ni le voir, ni le saisir, ni le
 *     retirer. La poignée de déplacement et la prise d'angle, elles, viennent du
 *     moteur de grille (`GridItem`) : le cadre ne les redessine pas.
 */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import { allowedSizeList } from '../grid/gridSolver';
import type { GridSizeId } from '../grid/gridTypes';
import { useHomeActions } from './HomeActionsContext';
import { readBoolOption, readEnumOption, type WidgetDefinition } from './widgetRegistry';
import './home.css';

export interface WidgetFrameProps {
  slotId: string;
  definition: WidgetDefinition;
  options?: Record<string, unknown>;
  binding?: Record<string, string>;
  editing: boolean;
}

/** Trois points verticaux — le produit n'embarque pas de bibliothèque d'icônes. */
const MoreIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="home-widget__menu-glyph"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

export const WidgetFrame: React.FC<WidgetFrameProps> = React.memo(function WidgetFrame({
  slotId,
  definition,
  options,
  binding,
  editing,
}) {
  const { t } = useTranslation();
  const actions = useHomeActions();
  const { Component } = definition;

  const title = t(definition.titleKey);
  const menuLabel = t('home.customize.blockMenu', 'Options du bloc « {{name}} »', { name: title });

  const handleSize = useCallback(
    (size: GridSizeId) => actions.setSlotSize(slotId, size),
    [actions, slotId]
  );

  /**
   * Le menu du bloc. Il est reconstruit à chaque ouverture parce que `Dropdown`
   * ne le lit qu'au moment de l'affichage — mais la liste elle-même dépend
   * seulement des réglages du bloc, qui ne bougent qu'à la demande.
   */
  const menuItems = useMemo<DropdownItem[]>(() => {
    const items: DropdownItem[] = [];

    // ── Les réglages déclarés par le widget ──────────────────────────────
    for (const field of definition.optionsSchema ?? []) {
      if (field.kind === 'boolean') {
        const current = readBoolOption(definition.optionsSchema, options, field.key);
        items.push({
          label: `${current ? '✓ ' : ''}${t(field.labelKey)}`,
          onClick: () => actions.setSlotOption(slotId, field.key, !current),
        });
      } else if (field.kind === 'enum') {
        // ⚠ La condition est EXPLICITE et non un `else` fourre-tout. Tant
        // qu'elle l'était, l'arrivée d'un troisième type de réglage faisait
        // lire `field.choices` sur un champ qui n'en a pas — un plantage au
        // simple survol du menu du bloc. Un réglage de TEXTE ne se règle pas
        // dans un menu de toute façon : il se saisit, donc il n'apparaît que
        // dans l'inspecteur.
        const current = readEnumOption(definition.optionsSchema, options, field.key);
        for (const choice of field.choices) {
          items.push({
            label: `${choice.value === current ? '✓ ' : ''}${t(choice.labelKey)}`,
            onClick: () => actions.setSlotOption(slotId, field.key, choice.value),
          });
        }
      }
    }

    // ── Les tailles NOMMÉES, quand il y en a plus d'une ─────────────────
    // Des raccourcis, pas la liste des tailles possibles : la poignée d'angle
    // pose n'importe quelle géométrie entre les bornes du bloc, et l'inspecteur
    // laisse taper la largeur et la hauteur au clavier.
    const sizes = allowedSizeList(definition.sizeShortcuts);
    if (sizes.length > 1) {
      if (items.length > 0) items[items.length - 1].divider = true;
      for (const size of sizes) {
        items.push({
          label: t(`grid.sizes.${size.id}`),
          onClick: () => handleSize(size.id),
        });
      }
    }

    // ── Personnaliser / retirer ──────────────────────────────────────────
    if (items.length > 0) items[items.length - 1].divider = true;
    items.push({
      label: editing
        ? t('home.customize.done', 'Terminer la personnalisation')
        : t('home.customize.start', "Personnaliser l'accueil"),
      onClick: () => actions.setEditing(!editing),
    });
    items.push({
      label: t('home.customize.removeWidget', 'Retirer ce bloc'),
      onClick: () => actions.removeSlot(slotId),
      danger: true,
    });

    return items;
  }, [definition, options, editing, slotId, actions, handleSize, t]);

  const className = ['home-widget', editing ? 'home-widget--editing' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-widget-type={definition.type}>
      {/* Le nom du bloc n'apparaît qu'en édition : c'est ce qui rend saisissable
          un widget qui, ce jour-là, n'a rien à afficher. */}
      {editing && <p className="home-widget__label">{title}</p>}

      <div className="home-widget__body">
        <Component slotId={slotId} options={options} binding={binding} editing={editing} />
      </div>

      {/* L'unique affordance permanente. `home-widget__menu` est transparente et
          intraversable au repos (voir `home.css`) : au repos elle n'intercepte
          donc AUCUN clic destine au contenu du bloc.

          Le declencheur est un `span`, PAS un `button` : `Dropdown` enveloppe
          deja ce qu'on lui donne dans un element `role="button"` focalisable, et
          imbriquer un vrai bouton dedans donnerait deux controles pour une seule
          cible — un lecteur d'ecran en annoncerait deux, et la tabulation s'y
          arreterait deux fois. Le nom accessible du controle exterieur est
          calcule a partir de son contenu : l'`aria-label` porte ici suffit donc
          a le nommer. */}
      <Dropdown
        className="home-widget__menu"
        position="bottom-right"
        items={menuItems}
        trigger={
          <span className="home-widget__menu-button" aria-label={menuLabel} title={menuLabel}>
            <MoreIcon />
          </span>
        }
      />
    </div>
  );
});

export default WidgetFrame;
