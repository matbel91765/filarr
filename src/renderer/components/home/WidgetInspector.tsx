/**
 * Mode édition — L'INSPECTEUR.
 *
 * ── LE MÊME PANNEAU, PAS UNE MODALE ─────────────────────────────────────────
 *
 * Sélectionner un bloc ne fait pas surgir de fenêtre : le panneau latéral change
 * de contenu, comme dans un éditeur graphique. Une modale par-dessus la grille
 * cacherait le bloc qu'on règle, et il faudrait la fermer pour voir l'effet du
 * réglage qu'on vient de changer — donc la rouvrir pour le corriger.
 *
 * ── TROIS RÉGLAGES, PUIS « PLUS » ───────────────────────────────────────────
 *
 * Trois au maximum sont visibles, le reste attend sous un pli. Ce n'est pas de
 * la coquetterie : un panneau qui déroule sept contrôles se lit comme un
 * formulaire d'administration, et les deux réglages qui comptent vraiment s'y
 * noient. La taille vient toujours en premier — c'est celle qu'on cherche.
 *
 * ── LA TAILLE N'EST PLUS UNE LISTE DE FORMATS ─────────────────────────────
 *
 * Ce groupe montrait des boutons radio : les formats du catalogue, et rien
 * d'autre. C'était honnête tant que la poignée ne savait poser que ça ; depuis
 * qu'elle pose N'IMPORTE QUELLE géométrie entière, une liste exhaustive est
 * devenue un mensonge — un 7×5 parfaitement légal n'aurait coché aucun bouton,
 * et la moindre pression sur l'un d'eux aurait effacé le réglage patiemment
 * tiré à la souris.
 *
 * Trois étages le remplacent, dans cet ordre :
 *
 *   1. CE QU'ON A. La taille courante en clair (« 7 × 5 cases »), suivie du nom
 *      du format quand la géométrie tombe pile sur l'un des huit. Sans ce
 *      premier étage, la seule façon de savoir ce qu'on a serait de compter les
 *      cases à l'œil.
 *   2. CE QU'ON PEUT AVOIR EN UN CLIC. Les formats nommés COMPATIBLES avec les
 *      bornes du bloc, proposés comme des suggestions — pas comme les seules
 *      valeurs possibles.
 *   3. CE QU'ON VEUT EXACTEMENT. Deux champs, largeur et hauteur, en cases.
 *      C'est le seul chemin CLAVIER vers une taille libre : le geste à la souris
 *      ne s'offre ni au pavé tactile ni à qui navigue au clavier, et une
 *      liberté qui ne passe que par une poignée de 22 px n'est pas une liberté
 *      pour tout le monde.
 *
 * ── LA MISE À JOUR EST DIRECTE ──────────────────────────────────────────────
 *
 * Aucun bouton « Appliquer ». Chaque changement part immédiatement dans le
 * brouillon (donc dans la pile d'annulation), et le bloc change à côté, sous les
 * yeux. C'est ce qui rend le réglage essayable au lieu d'être décidé à l'avance.
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/Button/Button';
import Input from '../ui/Input/Input';
import { Radio } from '../ui/Radio';
import { Toggle } from '../ui/Toggle';
import { isResizable, resolveConstraints } from '../grid/gridSolver';
import { gridSize, sizeIdOf } from '../grid/gridTypes';
// La borne du FORMAT DE FICHIER, pas un avis sur la mise en page : au-delà, un
// `.filarrlayout` exporté serait refusé à l'import. Un champ qui laisserait
// taper plus fabriquerait une disposition impartageable sans le dire.
import { LAYOUT_LIMITS } from '../../../services/layouts/layoutFormat';
// Les lecteurs de réglages viennent de `widgetOptions`, pas du registre : le
// registre importe les douze widgets, donc tout ce qu'ils lisent du store. Ce
// panneau n'a besoin que du schéma — et `widgetOptions` existe exactement pour
// ça (voir son en-tête). La définition, elle, ne traverse qu'en TYPE : effacée à
// la compilation, elle ne tire rien derrière elle.
import { readBoolOption, readEnumOption, readTextOption } from './widgetOptions';
import type { WidgetDefinition } from './widgetRegistry';
import type { LayoutSlot } from '../../../services/layout/layoutTypes';
import './homeEdit.css';

/** Au-delà, les réglages passent sous le pli. */
const VISIBLE_CONTROLS = 3;

export interface WidgetInspectorProps {
  slot: LayoutSlot;
  /** `null` quand ce binaire ne connaît pas le type du bloc. */
  definition: WidgetDefinition | null;
  onClose: () => void;
  /**
   * Poser une taille EXACTE, en cases. Ce n'est plus un identifiant de format :
   * l'appelant écrit la géométrie telle quelle, sans rien aimanter.
   */
  onResize: (w: number, h: number) => void;
  onOption: (key: string, value: unknown) => void;
  onRemove: () => void;
}

/**
 * Un champ de dimension, en cases.
 *
 * Il tient un BROUILLON local plutôt que d'écrire chaque frappe dans la
 * disposition, et les deux moitiés de cette décision comptent :
 *
 *   · on ne COMMET que ce qui est déjà recevable — taper « 12 » passe par
 *     « 1 », et commettre ce « 1 » ferait sauter le bloc à une case sous les
 *     yeux avant de le rendre à douze ;
 *   · le brouillon SUIT la valeur réelle — la poignée et les raccourcis
 *     changent la taille dans le dos de ce panneau, et un champ resté sur
 *     l'ancienne valeur écraserait le geste à la première frappe suivante.
 */
const SizeField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}> = ({ label, value, min, max, onCommit }) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const handleChange = (raw: string): void => {
    setDraft(raw);
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
  };

  return (
    <Input
      type="number"
      size="sm"
      label={label}
      min={min}
      max={max}
      step={1}
      value={draft}
      onChange={(event) => handleChange(event.target.value)}
      // Une saisie abandonnée (vide, hors bornes) ne laisse pas le champ mentir
      // sur la taille du bloc : il revient à ce qui est réellement posé.
      onBlur={() => setDraft(String(value))}
      containerClassName="home-inspector__dim"
    />
  );
};

export const WidgetInspector: React.FC<WidgetInspectorProps> = ({
  slot,
  definition,
  onClose,
  onResize,
  onOption,
  onRemove,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const title = definition
    ? t(definition.titleKey)
    : t('home.customize.unknownWidget', 'Bloc indisponible dans cette version');

  // ── Les contrôles, dans l'ordre où on les cherche ────────────────────────

  const controls: React.ReactNode[] = [];

  // Les bornes du bloc, remises en règle par le MÊME code que celui qui arrête
  // la poignée : ce que ce panneau affiche et ce que le geste autorise ne
  // peuvent donc pas diverger.
  const bounds = resolveConstraints(definition?.constraints);
  const currentSize = sizeIdOf(slot.w, slot.h);
  // Un bloc dont les bornes ne laissent qu'UNE géométrie n'a pas de réglage de
  // taille : proposer un choix unique donne l'illusion d'une décision à prendre.
  if (definition && isResizable(definition.constraints)) {
    controls.push(
      <fieldset key="size" className="home-inspector__field">
        <legend className="home-inspector__label">{t('home.inspector.size', 'Taille')}</legend>

        {/* 1. CE QU'ON A. Le « × » et les chiffres se lisent dans toutes les
            langues ; seul le mot « cases » est traduit. */}
        <p className="home-inspector__size">
          <span className="home-inspector__size-cells">
            {t('home.inspector.sizeCells', '{{w}} × {{h}} cases', { w: slot.w, h: slot.h })}
          </span>
          {/* Le nom n'apparaît QUE si la géométrie tombe pile dessus. Un nom
              approché (« à peu près Bande ») serait faux la moitié du temps. */}
          {currentSize && (
            <span className="home-inspector__size-name">{t(`grid.sizes.${currentSize}`)}</span>
          )}
        </p>

        {/* 2. CE QU'ON PEUT AVOIR EN UN CLIC. Des suggestions, pas une liste
            fermée : rien ici n'empêche une taille qui n'y figure pas. */}
        <div className="home-inspector__shortcuts">
          {definition.sizeShortcuts.map((id) => {
            const spec = gridSize(id);
            const active = currentSize === id;
            return (
              <button
                key={id}
                type="button"
                className={[
                  'home-inspector__shortcut',
                  active ? 'home-inspector__shortcut--active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                // `aria-pressed` et pas un bouton radio : ce n'est pas un choix
                // exclusif entre huit valeurs, c'est un raccourci qu'on prend ou
                // pas, et la taille courante peut n'être aucun des deux états.
                aria-pressed={active}
                title={`${spec.w} × ${spec.h}`}
                onClick={() => onResize(spec.w, spec.h)}
              >
                {t(`grid.sizes.${id}`)}
              </button>
            );
          })}
        </div>

        {/* 3. CE QU'ON VEUT EXACTEMENT. */}
        <div className="home-inspector__dims">
          <SizeField
            label={t('home.inspector.width', 'Largeur')}
            value={slot.w}
            min={bounds.minW}
            max={bounds.maxW}
            onCommit={(value) => onResize(value, slot.h)}
          />
          <SizeField
            label={t('home.inspector.height', 'Hauteur')}
            value={slot.h}
            min={bounds.minH}
            // Sans plafond déclaré, la seule borne qui reste est celle du format
            // de fichier. C'est exactement ce qu'on veut : « Tous les dossiers »
            // doit pouvoir passer six rangées, et douze, et vingt.
            max={Number.isFinite(bounds.maxH) ? bounds.maxH : LAYOUT_LIMITS.rows}
            onCommit={(value) => onResize(slot.w, value)}
          />
        </div>
      </fieldset>
    );
  }

  for (const field of definition?.optionsSchema ?? []) {
    if (field.kind === 'boolean') {
      const current = readBoolOption(definition?.optionsSchema, slot.options, field.key);
      controls.push(
        <div key={field.key} className="home-inspector__field">
          <Toggle
            label={t(field.labelKey)}
            size="sm"
            checked={current}
            onChange={() => onOption(field.key, !current)}
          />
        </div>
      );
    } else if (field.kind === 'text') {
      const current = readTextOption(definition?.optionsSchema, slot.options, field.key);
      controls.push(
        <div key={field.key} className="home-inspector__field">
          <Input
            label={t(field.labelKey)}
            size="sm"
            value={current}
            maxLength={field.maxLength}
            placeholder={field.placeholderKey ? t(field.placeholderKey) : undefined}
            onChange={(e) => onOption(field.key, e.target.value)}
            fullWidth
          />
        </div>
      );
    } else {
      // ⚠ La branche `enum` est désormais la DERNIÈRE et non le fourre-tout :
      // tant qu'elle l'était, l'ajout d'un troisième type de réglage l'aurait
      // fait lire `field.choices` sur un champ qui n'en a pas — un plantage de
      // l'inspecteur, déclenché par le simple fait de sélectionner le bloc.
      const current = readEnumOption(definition?.optionsSchema, slot.options, field.key);
      controls.push(
        <fieldset key={field.key} className="home-inspector__field">
          <legend className="home-inspector__label">{t(field.labelKey)}</legend>
          <div className="home-inspector__choices">
            {field.choices.map((choice) => (
              <Radio
                key={choice.value}
                name={`home-opt-${slot.id}-${field.key}`}
                label={t(choice.labelKey)}
                size="sm"
                checked={current === choice.value}
                onChange={() => onOption(field.key, choice.value)}
              />
            ))}
          </div>
        </fieldset>
      );
    }
  }

  const visible = controls.slice(0, VISIBLE_CONTROLS);
  const folded = controls.slice(VISIBLE_CONTROLS);

  return (
    <aside className="home-panel" aria-label={t('home.inspector.title', 'Réglages du bloc')}>
      <div className="home-panel__header">
        <h2 className="home-panel__title">{title}</h2>
        <button
          type="button"
          className="home-panel__close"
          aria-label={t('common.close', 'Fermer')}
          title={t('common.close', 'Fermer')}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="home-panel__body">
        {controls.length === 0 && (
          <p className="home-panel__hint">
            {t('home.inspector.noSettings', 'Ce bloc n’a aucun réglage.')}
          </p>
        )}

        {visible}

        {folded.length > 0 && (
          <>
            <button
              type="button"
              className="home-panel__more"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? t('home.inspector.less', 'Moins')
                : /* `n` et non `count` : `count` déclencherait la recherche des
                     formes plurielles d'i18next pour une clé qui n'en a pas. */
                  t('home.inspector.more', 'Plus ({{n}})', { n: folded.length })}
            </button>
            {expanded && folded}
          </>
        )}

        {/* Retirer est en bas, seul, à distance des réglages : c'est le seul
            geste de ce panneau qui enlève quelque chose. Il reste annulable
            (Ctrl+Z), donc pas de confirmation — une boîte de plus pour un geste
            réversible n'apprend rien et fatigue. */}
        <div className="home-inspector__danger">
          <Button variant="danger" size="sm" onClick={onRemove}>
            {t('home.customize.removeWidget', 'Retirer ce bloc')}
          </Button>
        </div>
      </div>
    </aside>
  );
};

export default WidgetInspector;
