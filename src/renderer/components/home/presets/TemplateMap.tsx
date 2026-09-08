/**
 * L'APERÇU D'UN MODÈLE — sa géométrie, nommée.
 *
 * ── PAS UNE CAPTURE D'ÉCRAN, PAS DES DONNÉES ────────────────────────────────
 *
 * Un modèle décrit des RÔLES, pas un contenu : deux comptes n'auront jamais les
 * mêmes notes ni les mêmes dossiers dedans. Une capture d'écran promettrait donc
 * quelque chose que l'installation ne tiendrait pas — et vieillirait au premier
 * changement de thème (il y en a neuf).
 *
 * Ce qu'on montre est ce qu'on va réellement recevoir : douze colonnes, des
 * rectangles à leur vraie place et à leur vraie taille, chacun portant le nom du
 * bloc qu'il accueillera. On lit la composition d'un coup d'œil, sans avoir à
 * l'appliquer pour la voir.
 *
 * Les classes viennent de `homeEdit.css` (`.home-template__map/__cell`), qui
 * décrit déjà cette carte pour le panneau des modèles installés : deux feuilles
 * de style pour la même carte finiraient par diverger.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { resolveWidget } from '../widgetRegistry';
import { coreWidgetId } from '../../../../services/layouts/layoutFormat';
import '../homeEdit.css';

/**
 * La géométrie SEULE — ce dont la carte a besoin, et rien de plus.
 *
 * Elle prenait un `LayoutTemplate` entier, ce qui la réservait aux modèles. Or
 * la même carte répond à la même question pour une mise en page qu'on s'apprête
 * à publier : « à quoi ça ressemble ? ». Réduire l'entrée aux quatre nombres et
 * au type qu'elle lit réellement la rend utilisable des deux côtés, sans qu'un
 * appelant ait à fabriquer un faux gabarit pour la contenter.
 */
export interface TemplateMapSlot {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateMapProps {
  slots: readonly TemplateMapSlot[];
}

export const TemplateMap: React.FC<TemplateMapProps> = React.memo(function TemplateMap({ slots }) {
  const { t } = useTranslation();

  // La hauteur de la carte est celle du gabarit : un modèle de dix rangées ne
  // doit pas être écrasé dans la boîte d'un modèle de quatre, sinon les deux
  // paraissent aussi denses l'un que l'autre — ce qui est précisément ce qui les
  // distingue.
  const rows = slots.reduce((max, slot) => Math.max(max, slot.y + slot.h), 0);

  return (
    <span
      className="home-template__map"
      style={{ ['--home-template-rows' as string]: String(Math.max(rows, 1)) }}
    >
      {slots.map((slot, index) => {
        /**
         * ⚠ LE PRÉFIXE `core:` DOIT TOMBER AVANT LA RECHERCHE.
         *
         * Le registre est indexé par identifiant NU (`resume`), tandis qu'un
         * fichier `.filarrlayout` porte le type PRÉFIXÉ (`core:resume`) — c'est
         * le préfixe qui dit « ce bloc vient du binaire, pas d'un greffon ».
         * Chercher la forme préfixée ne trouvait donc jamais rien, et l'aperçu
         * affichait `core:resume` à la place de « Reprendre ». Les gabarits, eux,
         * portent le type nu : le défaut ne se voyait que sur un modèle publié.
         */
        const definition = resolveWidget(coreWidgetId(slot.type) ?? slot.type);
        // Un type inconnu de CE binaire garde sa case et montre son type brut :
        // une case manquante ferait croire à un trou dans la composition.
        const label = definition ? t(definition.titleKey) : slot.type;
        return (
          <span
            key={`${slot.type}-${index}`}
            className="home-template__cell"
            title={label}
            style={{
              ['--home-template-x' as string]: String(slot.x + 1),
              ['--home-template-y' as string]: String(slot.y + 1),
              ['--home-template-w' as string]: String(slot.w),
              ['--home-template-h' as string]: String(slot.h),
            }}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
});

export default TemplateMap;
