/**
 * ProtectInPlaceDialog — « Protéger sur place » (Wave 2).
 *
 * Transforme des fichiers/dossiers OS en conteneurs `.filarr` chiffrés SANS
 * les importer dans le coffre applicatif : le conteneur est écrit dans un
 * VRAI dossier Windows (au choix : à côté de l'original, ou un dossier
 * choisi) et ne s'ouvre qu'avec Filarr déverrouillé.
 *
 * Contrat de sécurité (côté main, electron/filarrBox.ts) : l'original n'est
 * JAMAIS supprimé avant que le conteneur soit écrit ET vérifié (hash du
 * déchiffrement comparé à la source). La suppression est cochée par défaut
 * (protéger sur place est un déplacement) avec la note d'honnêteté SSD/TRIM
 * et l'avertissement de portabilité (clé machine = cet appareil uniquement).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalBody, ModalFooter } from '../ui/Modal/Modal';
import { Button } from '../ui/Button/Button';
import { Radio } from '../ui/Radio';
import { Checkbox } from '../ui/Checkbox';
import { ProgressBar } from '../ui/ProgressBar';
import { BoxFileIcon, ProtectInPlaceIcon } from '../icons';
import {
  protectInPlace,
  onBoxProgress,
  notifyRegistryChanged,
  type ProtectItemResult,
} from '../../../services/features/filarrBoxBridge';
import './ProtectInPlaceDialog.css';

export interface ProtectInPlaceDialogProps {
  isOpen: boolean;
  /** Chemins OS absolus des fichiers/dossiers à protéger. */
  paths: string[];
  onClose: () => void;
  /** Appelé après une passe (succès partiel inclus) — rafraîchir les listes. */
  onDone?: (results: ProtectItemResult[]) => void;
}

type Destination = 'alongside' | 'custom';
type Phase = 'configure' | 'working' | 'done';

/** Nom de base d'un chemin OS (séparateurs Windows et POSIX). */
const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() || p;

export const ProtectInPlaceDialog: React.FC<ProtectInPlaceDialogProps> = ({
  isOpen,
  paths,
  onClose,
  onDone,
}) => {
  const { t } = useTranslation();
  const [destination, setDestination] = useState<Destination>('alongside');
  const [customDir, setCustomDir] = useState<string | null>(null);
  const [deleteOriginals, setDeleteOriginals] = useState(true);
  const [phase, setPhase] = useState<Phase>('configure');
  const [progress, setProgress] = useState<number | null>(null);
  const [results, setResults] = useState<ProtectItemResult[] | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const workingRef = useRef(false);

  // Resynchroniser à chaque ouverture (le composant reste monté entre usages).
  useEffect(() => {
    if (isOpen) {
      setDestination('alongside');
      setCustomDir(null);
      setDeleteOriginals(true);
      setPhase('configure');
      setProgress(null);
      setResults(null);
      setFatalError(null);
    }
  }, [isOpen]);

  const pickCustomDir = useCallback(async () => {
    const renderer = window.electron?.ipcRenderer;
    if (!renderer) return;
    try {
      const result = (await renderer.invoke('showOpenDialog', {
        properties: ['openDirectory', 'createDirectory'],
      })) as { canceled?: boolean; filePaths?: string[] } | undefined;
      const dir = result && !result.canceled ? result.filePaths?.[0] : undefined;
      if (dir) {
        setCustomDir(dir);
        setDestination('custom');
      }
    } catch {
      // Dialogue indisponible — la destination « à côté » reste utilisable.
    }
  }, []);

  const handleProtect = useCallback(async () => {
    if (workingRef.current || paths.length === 0) return;
    workingRef.current = true;
    setPhase('working');
    setFatalError(null);
    setProgress(null);

    // Progression byte-level si le main la pousse ; sinon barre indéterminée.
    const detachProgress = onBoxProgress((event) => {
      if (event.total > 0) {
        setProgress(Math.min(100, Math.round((event.processed / event.total) * 100)));
      }
    });

    try {
      const res = await protectInPlace({
        paths,
        destDir: destination === 'custom' && customDir ? customDir : undefined,
        deleteOriginals,
      });

      if (res.ok && res.data) {
        setResults(res.data.results);
        setPhase('done');
        notifyRegistryChanged();
        onDone?.(res.data.results);
      } else if (res.unavailable) {
        setFatalError(
          t(
            'desktopProtection.protectDialog.unavailable',
            'Disponible après la prochaine mise à jour de Filarr.'
          )
        );
        setPhase('configure');
      } else {
        setFatalError(
          res.error ||
            t('desktopProtection.protectDialog.failed', 'Échec de la protection sur place.')
        );
        setPhase('configure');
      }
    } finally {
      detachProgress();
      workingRef.current = false;
    }
  }, [paths, destination, customDir, deleteOriginals, onDone, t]);

  const succeeded = useMemo(() => (results ?? []).filter((r) => r.ok), [results]);
  const failed = useMemo(() => (results ?? []).filter((r) => !r.ok), [results]);
  const warnings = useMemo(
    () => succeeded.filter((r) => r.warning || (r.skippedSymlinks ?? 0) > 0),
    [succeeded]
  );

  const working = phase === 'working';

  return (
    <Modal
      isOpen={isOpen}
      onClose={working ? () => {} : onClose}
      title={t('desktopProtection.protectDialog.title', 'Protéger sur place')}
      size="md"
      closeOnBackdrop={!working}
      closeOnEsc={!working}
    >
      <ModalBody>
        {phase !== 'done' && (
          <>
            <div className="protect-dialog__intro">
              <span className="protect-dialog__intro-icon" aria-hidden="true">
                <ProtectInPlaceIcon size={22} />
              </span>
              <p className="protect-dialog__intro-text">
                {t(
                  'desktopProtection.protectDialog.intro',
                  'Chaque élément devient un conteneur .filarr chiffré, laissé dans vos dossiers Windows. Il ne s’ouvre qu’avec Filarr, une fois le coffre déverrouillé.'
                )}
              </p>
            </div>

            <ul
              className="protect-dialog__paths"
              aria-label={t('desktopProtection.protectDialog.selection', 'Éléments sélectionnés')}
            >
              {paths.slice(0, 6).map((p) => (
                <li key={p} className="protect-dialog__path" title={p}>
                  <BoxFileIcon size={14} className="protect-dialog__path-icon" />
                  <span className="protect-dialog__path-name">{basename(p)}</span>
                </li>
              ))}
              {paths.length > 6 && (
                <li className="protect-dialog__path protect-dialog__path--more">
                  {t('desktopProtection.protectDialog.morePaths', '+ {{count}} autre(s)', {
                    count: paths.length - 6,
                  })}
                </li>
              )}
            </ul>

            {/* ── Destination ── */}
            <fieldset className="protect-dialog__group" disabled={working}>
              <legend className="protect-dialog__group-label">
                {t('desktopProtection.protectDialog.destination', 'Destination du conteneur')}
              </legend>
              <div className="protect-dialog__group-options">
                <Radio
                  name="protect-destination"
                  value="alongside"
                  checked={destination === 'alongside'}
                  onChange={() => setDestination('alongside')}
                  label={t(
                    'desktopProtection.protectDialog.destAlongside',
                    'À côté de l’original (même dossier)'
                  )}
                  size="sm"
                />
                <div className="protect-dialog__custom-row">
                  <Radio
                    name="protect-destination"
                    value="custom"
                    checked={destination === 'custom'}
                    onChange={() => {
                      if (customDir) setDestination('custom');
                      else void pickCustomDir();
                    }}
                    label={
                      customDir
                        ? t('desktopProtection.protectDialog.destCustomPicked', 'Dans : {{dir}}', {
                            dir: customDir,
                          })
                        : t(
                            'desktopProtection.protectDialog.destCustom',
                            'Dans un dossier de mon choix…'
                          )
                    }
                    size="sm"
                  />
                  <Button variant="ghost" size="sm" onClick={() => void pickCustomDir()}>
                    {customDir
                      ? t('desktopProtection.protectDialog.changeDir', 'Changer…')
                      : t('desktopProtection.protectDialog.pickDir', 'Choisir…')}
                  </Button>
                </div>
              </div>
            </fieldset>

            {/* ── Suppression de l'original ── */}
            <div className="protect-dialog__group">
              <Checkbox
                checked={deleteOriginals}
                disabled={working}
                onChange={(e) => setDeleteOriginals(e.target.checked)}
                label={t(
                  'desktopProtection.protectDialog.deleteOriginals',
                  'Supprimer l’original après vérification (déplacer)'
                )}
                size="sm"
              />
              {deleteOriginals && (
                <p className="protect-dialog__note">
                  {t(
                    'desktopProtection.protectDialog.verifyNote',
                    'L’original n’est supprimé qu’une fois le conteneur écrit et vérifié (déchiffrement comparé octet par octet). Sur un SSD, l’effacement est best-effort — pour une protection complète du disque, activez BitLocker ou FileVault.'
                  )}
                </p>
              )}
              <p className="protect-dialog__note protect-dialog__note--portability">
                {t(
                  'desktopProtection.protectDialog.portabilityNote',
                  'Un conteneur créé avec la clé de cet appareil ne s’ouvre que sur cet appareil. Avec un compte synchronisé, il s’ouvre sur tous vos appareils déverrouillés.'
                )}
              </p>
            </div>

            {fatalError && (
              <p className="protect-dialog__error" role="alert">
                {fatalError}
              </p>
            )}

            {working && (
              <div className="protect-dialog__progress">
                <ProgressBar
                  value={progress ?? 0}
                  indeterminate={progress === null}
                  size="sm"
                  label={t('desktopProtection.protectDialog.working', 'Chiffrement en cours…')}
                />
              </div>
            )}
          </>
        )}

        {phase === 'done' && results && (
          <div className="protect-dialog__results">
            <p className="protect-dialog__results-headline">
              {failed.length === 0
                ? t(
                    'desktopProtection.protectDialog.allDone',
                    '{{count}} conteneur(s) .filarr créé(s).',
                    { count: succeeded.length }
                  )
                : t(
                    'desktopProtection.protectDialog.partialDone',
                    '{{count}} conteneur(s) créé(s), {{failed}} échec(s) — les originaux en échec sont conservés.',
                    { count: succeeded.length, failed: failed.length }
                  )}
            </p>
            <ul className="protect-dialog__result-list">
              {(results ?? []).map((r) => (
                <li
                  key={r.sourcePath}
                  className={`protect-dialog__result ${r.ok ? '' : 'protect-dialog__result--error'}`}
                  title={r.ok ? r.boxPath : r.sourcePath}
                >
                  <span className="protect-dialog__result-name">{basename(r.sourcePath)}</span>
                  <span className="protect-dialog__result-status">
                    {r.ok
                      ? r.originalDeleted
                        ? t(
                            'desktopProtection.protectDialog.resultMoved',
                            'Protégé — original supprimé'
                          )
                        : t(
                            'desktopProtection.protectDialog.resultKept',
                            'Protégé — original conservé'
                          )
                      : r.error ||
                        t(
                          'desktopProtection.protectDialog.resultFailed',
                          'Échec — original conservé'
                        )}
                  </span>
                </li>
              ))}
            </ul>
            {warnings.map((r) => (
              <p key={`warn-${r.sourcePath}`} className="protect-dialog__note" role="status">
                {r.warning
                  ? `${basename(r.sourcePath)} : ${r.warning}`
                  : t(
                      'desktopProtection.protectDialog.symlinksSkipped',
                      '{{name}} : {{count}} lien(s) symbolique(s) ignoré(s).',
                      { name: basename(r.sourcePath), count: r.skippedSymlinks }
                    )}
              </p>
            ))}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        {phase === 'done' ? (
          <Button variant="primary" onClick={onClose}>
            {t('common.close', 'Fermer')}
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={working}>
              {t('common.cancel', 'Annuler')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void handleProtect()}
              loading={working}
              disabled={paths.length === 0 || (destination === 'custom' && !customDir)}
              leftIcon={<ProtectInPlaceIcon size={15} />}
            >
              {t('desktopProtection.protectDialog.confirm', 'Protéger sur place')}
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  );
};

export default ProtectInPlaceDialog;
