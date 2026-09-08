/**
 * ImportModeDialog — choix à l'ajout : Copier / Déplacer-dans-le-coffre /
 * Protéger sur place (Wave 2).
 *
 * Affiché au moment de l'import (drag & drop ou sélecteur) quand :
 *  - « Demander à chaque import » est activé, OU
 *  - le mode par défaut est « Déplacer » (confirmation d'une action
 *    destructive : l'original est supprimé après vérification).
 *
 * « Protéger sur place » n'importe RIEN dans le coffre applicatif : chaque
 * fichier devient un conteneur .filarr chiffré laissé dans les dossiers
 * Windows (destination + suppression de l'original choisies dans le dialogue
 * dédié qui suit). Nécessite un chemin OS résoluble.
 *
 * Honnêteté sécurité : la suppression sécurisée sur SSD est best-effort
 * (wear-leveling) — le texte le dit et renvoie vers BitLocker/FileVault.
 * L'original n'est JAMAIS supprimé avant que la copie chiffrée soit écrite
 * et vérifiée (déchiffrement complet comparé à la source, côté main).
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Button } from '../ui/Button/Button';
import { Radio } from '../ui/Radio';
import { Checkbox } from '../ui/Checkbox';
import { ProtectInPlaceIcon } from '../icons';
import { formatBytes } from '../../../constants/limits';
import './ImportModeDialog.css';

export type ImportMode = 'copy' | 'move';

/** Choix du dialogue — les modes d'import + « protéger sur place » (Wave 2). */
export type ImportChoice = ImportMode | 'protect';

interface ImportModeDialogProps {
  isOpen: boolean;
  /** Nombre total de fichiers à importer. */
  fileCount: number;
  /** Taille cumulée (octets). */
  totalSize: number;
  /** Fichiers dont le chemin OS est résoluble (seuls eux peuvent être déplacés). */
  movableCount: number;
  /**
   * false = mode de stockage sans blob local vérifiable (cloud/BYOS) — le
   * déplacement est désactivé (la vérification avant suppression exige la
   * copie chiffrée locale).
   */
  storageSupportsMove: boolean;
  /** Mode présélectionné (réglage « Protection du bureau »). */
  defaultMode: ImportMode;
  onCancel: () => void;
  /**
   * `remember` = « Ne plus demander » coché → mémoriser le mode choisi
   * (jamais proposé pour « protect » : la protection sur place est une
   * action explicite, pas un mode d'import par défaut).
   */
  onConfirm: (mode: ImportChoice, remember: boolean) => void;
}

/** Icône copie — deux feuilles, traits ronds (convention inline-SVG du projet). */
const CopyGlyph: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="9" y="9" width="12" height="12" rx="2.5" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/** Icône déplacer-dans-le-coffre — cadenas au point de marque + flèche entrante. */
const MoveToVaultGlyph: React.FC = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="8" y="11" width="13" height="9" rx="2.5" />
    <path d="M11 11V8.5a3.5 3.5 0 0 1 7 0V11" />
    <circle cx="14.5" cy="14.8" r="1.3" fill="currentColor" stroke="none" />
    <path d="M2 12h4" />
    <path d="M4.5 9.5L7 12l-2.5 2.5" />
  </svg>
);

export const ImportModeDialog: React.FC<ImportModeDialogProps> = ({
  isOpen,
  fileCount,
  totalSize,
  movableCount,
  storageSupportsMove,
  defaultMode,
  onCancel,
  onConfirm,
}) => {
  const { t } = useTranslation();
  const moveDisabled = movableCount === 0 || !storageSupportsMove;
  // « Protéger sur place » exige un chemin OS résoluble mais PAS de blob
  // local du coffre (le conteneur est écrit dans un vrai dossier Windows).
  const protectDisabled = movableCount === 0;
  const [mode, setMode] = useState<ImportChoice>(defaultMode);
  const [remember, setRemember] = useState(false);

  // Resynchroniser à chaque ouverture (le composant reste monté entre imports).
  useEffect(() => {
    if (isOpen) {
      setMode(moveDisabled ? 'copy' : defaultMode);
      setRemember(false);
    }
  }, [isOpen, defaultMode, moveDisabled]);

  const selectMode = (next: ImportChoice) => {
    if (next === 'move' && moveDisabled) return;
    if (next === 'protect' && protectDisabled) return;
    setMode(next);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={t('desktopProtection.importDialog.title', 'Importer dans le coffre')}
      size="md"
    >
      <ModalBody>
        <p className="import-mode__summary">
          {t('desktopProtection.importDialog.summary', '{{count}} fichier(s) — {{size}}', {
            count: fileCount,
            size: formatBytes(totalSize),
          })}
        </p>

        <div className="import-mode__options" role="radiogroup">
          {/* ── Copier ── */}
          {/* La carte entière est cliquable ; le Radio (design system) porte
              l'input réel — pas de <label> englobant : Radio rend déjà le
              sien, un label imbriqué déclencherait deux activations. */}
          <div
            className={`import-mode__option ${mode === 'copy' ? 'import-mode__option--selected' : ''}`}
            onClick={() => selectMode('copy')}
          >
            <span className="import-mode__option-icon">
              <CopyGlyph />
            </span>
            <span className="import-mode__option-text">
              <span className="import-mode__option-title">
                {t('desktopProtection.importDialog.copyTitle', 'Copier')}
              </span>
              <span className="import-mode__option-desc">
                {t(
                  'desktopProtection.importDialog.copyDesc',
                  'Le fichier original reste en clair à son emplacement actuel.'
                )}
              </span>
            </span>
            <Radio
              name="import-mode"
              value="copy"
              checked={mode === 'copy'}
              onChange={() => selectMode('copy')}
              aria-label={t('desktopProtection.importDialog.copyTitle', 'Copier')}
            />
          </div>

          {/* ── Déplacer dans le coffre ── */}
          <div
            className={`import-mode__option ${mode === 'move' ? 'import-mode__option--selected' : ''} ${
              moveDisabled ? 'import-mode__option--disabled' : ''
            }`}
            onClick={() => selectMode('move')}
          >
            <span className="import-mode__option-icon import-mode__option-icon--vault">
              <MoveToVaultGlyph />
            </span>
            <span className="import-mode__option-text">
              <span className="import-mode__option-title">
                {t('desktopProtection.importDialog.moveTitle', 'Déplacer dans le coffre')}
              </span>
              <span className="import-mode__option-desc">
                {t(
                  'desktopProtection.importDialog.moveDesc',
                  "L'original est supprimé de façon sécurisée après vérification que la copie chiffrée est intacte."
                )}
              </span>
            </span>
            <Radio
              name="import-mode"
              value="move"
              checked={mode === 'move'}
              onChange={() => selectMode('move')}
              disabled={moveDisabled}
              aria-label={t('desktopProtection.importDialog.moveTitle', 'Déplacer dans le coffre')}
            />
          </div>

          {/* ── Protéger sur place (Wave 2) ── */}
          <div
            className={`import-mode__option ${mode === 'protect' ? 'import-mode__option--selected' : ''} ${
              protectDisabled ? 'import-mode__option--disabled' : ''
            }`}
            onClick={() => selectMode('protect')}
          >
            <span className="import-mode__option-icon import-mode__option-icon--vault">
              <ProtectInPlaceIcon size={20} strokeWidth={2} />
            </span>
            <span className="import-mode__option-text">
              <span className="import-mode__option-title">
                {t('desktopProtection.importDialog.protectTitle', 'Protéger sur place')}
              </span>
              <span className="import-mode__option-desc">
                {t(
                  'desktopProtection.importDialog.protectDesc',
                  'Le fichier devient un conteneur .filarr chiffré dans vos dossiers Windows — sans entrer dans le coffre Filarr.'
                )}
              </span>
            </span>
            <Radio
              name="import-mode"
              value="protect"
              checked={mode === 'protect'}
              onChange={() => selectMode('protect')}
              disabled={protectDisabled}
              aria-label={t('desktopProtection.importDialog.protectTitle', 'Protéger sur place')}
            />
          </div>
        </div>

        {mode !== 'protect' && !storageSupportsMove ? (
          <p className="import-mode__note">
            {t(
              'desktopProtection.importDialog.storageNote',
              'Le déplacement nécessite une copie chiffrée locale vérifiable — indisponible avec le stockage cloud pur.'
            )}
          </p>
        ) : mode !== 'protect' && moveDisabled ? (
          <p className="import-mode__note import-mode__note--warning">
            {t(
              'desktopProtection.importDialog.noPathNote',
              "Le chemin d'origine de ces fichiers n'est pas résoluble — seul l'import par copie est possible."
            )}
          </p>
        ) : (
          movableCount < fileCount &&
          (mode === 'move' || mode === 'protect') && (
            <p className="import-mode__note import-mode__note--warning">
              {mode === 'move'
                ? t(
                    'desktopProtection.importDialog.partialPathNote',
                    '{{count}} fichier(s) sans chemin résoluble seront copiés (original conservé).',
                    { count: fileCount - movableCount }
                  )
                : t(
                    'desktopProtection.importDialog.protectPartialPathNote',
                    '{{count}} fichier(s) sans chemin résoluble seront ignorés.',
                    { count: fileCount - movableCount }
                  )}
            </p>
          )
        )}

        {mode === 'move' && (
          <p className="import-mode__note">
            {t(
              'desktopProtection.importDialog.ssdNote',
              "Sur un SSD, l'effacement de l'original est best-effort (le contrôleur peut conserver des copies internes). Pour une protection complète, activez le chiffrement du disque (BitLocker sur Windows, FileVault sur macOS)."
            )}
          </p>
        )}

        {mode === 'protect' && (
          <p className="import-mode__note">
            {t(
              'desktopProtection.importDialog.protectNote',
              'Le dialogue suivant permet de choisir la destination du conteneur et la suppression de l’original (après vérification).'
            )}
          </p>
        )}

        {/* « Ne plus demander » ne s'applique qu'aux modes d'import — la
            protection sur place reste une action explicite à chaque fois. */}
        {mode !== 'protect' && (
          <div className="import-mode__remember">
            <Checkbox
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              label={t(
                'desktopProtection.importDialog.remember',
                'Ne plus demander (modifiable dans Paramètres → Protection du bureau)'
              )}
              size="sm"
            />
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel', 'Annuler')}
        </Button>
        <Button
          variant="primary"
          onClick={() => onConfirm(mode, mode === 'protect' ? false : remember)}
        >
          {mode === 'move'
            ? t('desktopProtection.importDialog.confirmMove', 'Déplacer dans le coffre')
            : mode === 'protect'
              ? t('desktopProtection.importDialog.confirmProtect', 'Protéger sur place…')
              : t('desktopProtection.importDialog.confirmCopy', 'Copier dans le coffre')}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ImportModeDialog;
