/**
 * OpenWithDialog — « avec quoi ouvrir ce fichier ? »
 *
 * ── CE QUE CHAQUE LIGNE DOIT DIRE ──────────────────────────────────────────
 * Un choix ne se donne pas avec un libellé, il se donne avec sa CONSÉQUENCE.
 * « Filarr Docs » ne dit rien ; « crée un document .fdoc — le .docx d'origine
 * reste intact » dit ce qui va se passer. C'est là, et nulle part ailleurs,
 * que se prend le consentement à une conversion.
 *
 * Deux conséquences méritent d'être écrites noir sur blanc, parce qu'elles
 * sont irréversibles ou surprenantes :
 *  · l'IMPORT crée un second fichier, d'un autre format ;
 *  · l'application SYSTÈME travaille sur une copie déchiffrée hors du coffre.
 *
 * ── LA CASE « SE SOUVENIR » N'EST PAS COCHÉE PAR DÉFAUT ────────────────────
 * Mémoriser un choix fait une fois, pour toutes les fois suivantes et pour
 * TOUS les fichiers de cette extension, doit être un geste délibéré. Un
 * utilisateur qui essaie une ouverture ne demande pas à changer un réglage.
 */

import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Modal, Radio } from '../ui';
import type { OpenTarget } from '../../../services/files/openWith';
import './OpenWithDialog.css';

export interface OpenWithDialogProps {
  fileName: string;
  targets: OpenTarget[];
  /** La cible pré-sélectionnée — celle qu'un double-clic emprunterait. */
  initialId: string;
  onCancel: () => void;
  /** `remember` : mémoriser ce choix pour toute l'extension. */
  onConfirm: (target: OpenTarget, remember: boolean) => void;
}

export const OpenWithDialog: React.FC<OpenWithDialogProps> = ({
  fileName,
  targets,
  initialId,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const groupe = useId();
  const [choisi, setChoisi] = useState(
    () => targets.find((c) => c.id === initialId)?.id ?? targets[0]?.id ?? ''
  );
  const [retenir, setRetenir] = useState(false);

  const extension = (() => {
    const point = fileName.lastIndexOf('.');
    return point > 0 ? fileName.slice(point + 1).toLowerCase() : '';
  })();

  /** Le titre d'une ligne. */
  const titre = (c: OpenTarget): string => {
    if (c.kind === 'preview') return t('openWith.preview.label', 'Aperçu');
    if (c.kind === 'system') return t('openWith.system.label', 'Application du système');
    return c.displayName;
  };

  /** LA CONSÉQUENCE — ce que le clic fera vraiment. */
  const consequence = (c: OpenTarget): string => {
    if (c.kind === 'preview') {
      return t('openWith.preview.hint', 'Consultation seule, sans quitter Filarr.');
    }
    if (c.kind === 'system') {
      return t(
        'openWith.system.hint',
        'Une copie déchiffrée est ouverte hors du coffre. Vos modifications y reviennent tant que le fichier reste ouvert.'
      );
    }
    if (c.mode === 'import') {
      return t(
        'openWith.import.hint',
        "Crée un nouveau document Filarr à partir du texte, des titres, des listes, des tableaux et des images. La mise en page Word — polices, couleurs, alignements, marges, en-têtes et pieds de page — ne suit PAS. Le fichier d'origine reste intact."
      );
    }
    return c.builtin
      ? t('openWith.native.hint', 'Édition dans Filarr, sans conversion.')
      : t('openWith.nativeThirdParty.hint', 'Extension installée — édition dans Filarr.');
  };

  const valider = () => {
    const cible = targets.find((c) => c.id === choisi);
    if (cible) onConfirm(cible, retenir);
  };

  return (
    <Modal isOpen onClose={onCancel} size="md" title={t('openWith.title', 'Ouvrir avec')}>
      <div className="open-with">
        <p className="open-with__file" title={fileName}>
          {fileName}
        </p>

        <div
          className="open-with__choices"
          role="radiogroup"
          aria-label={t('openWith.title', 'Ouvrir avec')}
        >
          {targets.map((c) => (
            <label key={c.id} className="open-with__choice">
              <Radio
                name={groupe}
                value={c.id}
                checked={choisi === c.id}
                onChange={() => setChoisi(c.id)}
              />
              <span className="open-with__choice-text">
                <span className="open-with__choice-title">{titre(c)}</span>
                <span className="open-with__choice-hint">{consequence(c)}</span>
              </span>
            </label>
          ))}
        </div>

        {/* Mémoriser vaut pour l'EXTENSION, pas pour ce fichier : le dire, sinon
            l'utilisateur découvre la portée de son geste plus tard. */}
        {extension && (
          <Checkbox
            checked={retenir}
            onChange={(e) => setRetenir(e.target.checked)}
            label={t('openWith.remember', 'Toujours ouvrir les fichiers .{{ext}} ainsi', {
              ext: extension,
            })}
          />
        )}

        <div className="open-with__actions">
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel', 'Annuler')}
          </Button>
          <Button variant="primary" onClick={valider} disabled={!choisi}>
            {t('openWith.confirm', 'Ouvrir')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default OpenWithDialog;
