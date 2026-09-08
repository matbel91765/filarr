/**
 * LE SÉLECTEUR DE MODÈLE — « Modèle ▾ » de la barre d'édition.
 *
 * ── CE QU'IL FAUT POUR QU'UN MODÈLE SOIT ESSAYÉ ─────────────────────────────
 *
 * Trois choses, et il en manque une seule pour que personne n'ose cliquer :
 *
 *  1. VOIR CE QU'ON VA RECEVOIR. D'où la carte de géométrie (`TemplateMap`) :
 *     douze colonnes, les rectangles à leur place, chacun nommé.
 *  2. SAVOIR QUE RIEN NE SE PERD. La confirmation le dit noir sur blanc : seule
 *     la disposition change, aucun fichier, aucune note, aucun dossier n'est
 *     touché. Sans cette phrase, « remplacer votre accueil » se lit comme
 *     « supprimer vos données », et l'expérimentation s'arrête là.
 *  3. POUVOIR REVENIR. Poser un modèle est un PAS DE BROUILLON : Ctrl+Z le
 *     défait, et rien n'est scellé avant « Terminé ». C'est `pushLayoutDraft`
 *     qui garantit les deux — c'est le seul reducer qui empile l'annulation, et
 *     c'est la raison pour laquelle ce composant ne parle à aucun autre.
 *
 * ── POURQUOI IL DISPATCHE LUI-MÊME ──────────────────────────────────────────
 *
 * Le brouillon, la pile d'annulation et le panneau vivent dans le store : ce
 * composant n'a besoin de rien de la page pour faire son travail. Le faire
 * descendre par des props depuis l'accueil n'aurait ajouté qu'un câblage de plus
 * à maintenir — et une occasion de plus d'oublier `pushLayoutDraft` au profit
 * d'une écriture directe, qui produirait un geste non annulable.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';

import { Modal, ModalBody, ModalHeader } from '../../ui/Modal';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { resolveWidget, type WidgetDefinition } from '../widgetRegistry';
import { readActiveHomeViewId } from '../homeViews';
import { HOME_PRESETS, newPresetSlotId, type HomePreset } from './homePresets';
import { TemplateMap } from './TemplateMap';
import { pushLayoutDraft, setLayoutPanel } from '../../../../store/slices/layoutSlice';
import { instantiate } from '../../../../services/layout/layoutTypes';
import type { AppDispatch, RootState } from '../../../../store';
import '../homeEdit.css';
import './homePresets.css';

export interface PresetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * « Voir les modèles installés… » : la place de marché et les gabarits que
   * l'utilisateur a publiés lui-même vivent dans le panneau latéral, pas ici.
   * Ce lien est le seul chemin entre les deux, et il existe pour que le panneau
   * ne devienne pas une surface qu'on ne peut plus atteindre.
   */
  onOpenInstalled?: () => void;
}

/** Une carte de modèle : le nom, la phrase, la géométrie. */
const PresetCard: React.FC<{
  preset: HomePreset;
  active: boolean;
  onPick: (preset: HomePreset) => void;
}> = React.memo(function PresetCard({ preset, active, onPick }) {
  const { t } = useTranslation();
  const pick = useCallback(() => onPick(preset), [onPick, preset]);

  return (
    <button
      type="button"
      className={['home-preset', active ? 'home-preset--active' : ''].filter(Boolean).join(' ')}
      onClick={pick}
      aria-current={active ? 'true' : undefined}
    >
      <span className="home-preset__head">
        <span className="home-preset__name">{preset.template.name}</span>
        {active && (
          <span className="home-preset__badge">{t('home.presets.current', 'Modèle actuel')}</span>
        )}
      </span>
      <span className="home-preset__description">{t(preset.descriptionKey)}</span>
      <TemplateMap slots={preset.template.slots} />
    </button>
  );
});

export const PresetPicker: React.FC<PresetPickerProps> = ({ isOpen, onClose, onOpenInstalled }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();

  /**
   * Le modèle POSÉ pendant la session prime sur celui du document : c'est lui
   * que la grille montre, même s'il n'est pas encore scellé.
   */
  /**
   * L'accueil AFFICHÉ, qui n'est plus forcément celui d'origine : appliquer un
   * modèle importé crée une mise en page nommée et bascule dessus (voir
   * `homeViews.ts`). Lire `home` en dur montrerait ici la pastille « modèle
   * actuel » d'une disposition qu'on n'a pas sous les yeux.
   */
  const homeViewId = readActiveHomeViewId();

  const activeTemplateId = useSelector(
    (state: RootState) =>
      state.layout.edit?.templateId ?? state.layout.document.views[homeViewId]?.templateId
  );

  /** Les blocs actuellement à l'écran — ce que la confirmation doit NOMMER. */
  const currentSlots = useSelector((state: RootState) => state.layout.edit?.slots);

  const [pending, setPending] = useState<HomePreset | null>(null);

  /**
   * La confirmation nomme ce qui part ET rappelle que les données ne bougent
   * pas. Les deux moitiés comptent : la première évite la surprise, la seconde
   * décoince l'essai. Mêmes clés que « Repartir d'un modèle… » — deux phrases
   * différentes pour le même geste feraient douter qu'il s'agisse du même.
   */
  const confirmMessage = useMemo(() => {
    if (!pending) return '';
    const names = (currentSlots ?? [])
      .map((slot) => resolveWidget(slot.type))
      .filter((definition): definition is WidgetDefinition => definition !== null)
      .map((definition) => t(definition.titleKey));
    const shown = names.slice(0, 5).join(', ');
    // `n` et non `count` : `count` déclencherait la recherche des formes
    // plurielles d'i18next pour une clé qui n'en a pas.
    const blocks =
      names.length > 5
        ? t('home.customize.resetBlocksMore', '{{blocks}} et {{n}} autre(s)', {
            blocks: shown,
            n: names.length - 5,
          })
        : shown;
    return t(
      'home.customize.resetMessage',
      'Votre accueil actuel ({{blocks}}) sera remplacé par « {{name}} ». Seule la disposition change : aucun fichier, aucune note et aucun dossier n’est touché.',
      { blocks, name: pending.template.name }
    );
  }, [pending, currentSlots, t]);

  const apply = useCallback(() => {
    if (!pending) return;
    const view = instantiate(pending.template, {
      viewId: homeViewId,
      newSlotId: newPresetSlotId,
      now: new Date().toISOString(),
    });
    // UN PAS DE BROUILLON, comme un glissement : annulable, et rien sur le
    // disque avant la sortie du mode.
    dispatch(pushLayoutDraft({ slots: view.slots, templateId: pending.template.id }));
    dispatch(setLayoutPanel({ open: false }));
    setPending(null);
    onClose();
  }, [pending, dispatch, onClose, homeViewId]);

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalHeader onClose={onClose}>
          {t('home.presets.title', 'Choisir un modèle d’accueil')}
        </ModalHeader>
        <ModalBody>
          <p className="home-preset__hint">
            {t(
              'home.palette.templatesHint',
              'Un modèle remplace la disposition de votre accueil. Vos fichiers, vos notes et vos dossiers ne sont pas touchés.'
            )}
          </p>
          <div className="home-preset__grid">
            {HOME_PRESETS.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                active={preset.id === activeTemplateId}
                onPick={setPending}
              />
            ))}
          </div>
          {onOpenInstalled && (
            <button
              type="button"
              className="home-panel__more"
              onClick={() => {
                onClose();
                onOpenInstalled();
              }}
            >
              {t('home.presets.installed', 'Voir les modèles installés…')}
            </button>
          )}
        </ModalBody>
      </Modal>

      {/* `warning` et non `danger` : rien ne se perd ici — le geste vit dans le
          brouillon, Ctrl+Z le défait, et le document n'est pas touché tant que
          la session n'est pas terminée. */}
      <ConfirmModal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={apply}
        title={t('home.customize.resetTitle', 'Repartir d’un modèle ?')}
        message={confirmMessage}
        confirmText={t('common.apply', 'Appliquer')}
        cancelText={t('common.cancel', 'Annuler')}
        variant="warning"
      />
    </>
  );
};

export default PresetPicker;
