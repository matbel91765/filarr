/**
 * NoteConflictModal — résolution ASSISTÉE d'un conflit de synchronisation, à la
 * manière d'un conflit de fusion : les deux versions face à face, les
 * différences bloc par bloc, et trois issues (la mienne, la leur, un mélange
 * choisi ligne à ligne).
 *
 * ELLE NE SURGIT JAMAIS TOUTE SEULE. Un conflit naît d'un cycle de
 * synchronisation en arrière-plan, donc à un instant que personne n'a choisi —
 * potentiellement en pleine frappe. Voler le focus à ce moment-là serait pire
 * que le conflit lui-même : la fenêtre ATTEND derrière une pastille discrète
 * dans la barre latérale (voir `NotesList`), et ne s'ouvre que sur un clic.
 * Pour la même raison, la présélection et l'écran actif ne sont réinitialisés
 * qu'à l'OUVERTURE : un cycle qui arrive pendant l'arbitrage ne doit pas
 * ramener l'utilisateur à la liste ni effacer ses choix.
 *
 * TROIS RÈGLES DE SÛRETÉ, parce que résoudre ÉCRASE une note et PURGE une copie :
 *  1. Aucune différence n'a de valeur par défaut. Tant qu'il en reste une sans
 *     réponse, le bouton de résolution est fermé : un repli silencieux sur
 *     « ma version » jetterait le travail d'en face sans que personne l'ait dit.
 *  2. La résolution demande une confirmation explicite qui NOMME l'issue (tout
 *     à moi, tout à eux, ou mélange) et rappelle que la copie disparaît.
 *  3. La copie part par `permanentlyDeleteNote`, qui pose la pierre tombale de
 *     purge — une suppression douce laisserait la fusion la ramener du nuage au
 *     cycle suivant, et le conflit se rouvrirait tout seul. Le réducteur étant
 *     pur, on enchaîne `saveNotesToDisk` et on n'annonce le succès qu'après.
 *
 * CE QUI EST RECOPIÉ, ET CE QUI EST RECONSTRUIT. Quand une version est gardée
 * ENTIÈRE, son `content` et son `plainText` sont recopiés à l'octet : aucune
 * reconstruction ne peut donc rien abîmer. Seul le mélange bloc à bloc
 * reconstruit un document — à partir des nœuds d'origine, jamais de leur texte.
 *
 * CE QUI N'EST PLUS ICI, ET POURQUOI. Le face-à-face, la numérotation des
 * différences, le parcours clavier et l'aperçu vivent dans `BlockMergeView` ; le
 * modèle de décision (quelles décisions, sont-elles toutes prises, que produit
 * la résolution) dans `services/notes/mergePlan`. L'écran de conflit des notes
 * de COFFRE pose la même question sur un objet dont rien de la persistance n'est
 * commun avec celle-ci — et deux copies de ces règles, c'était accepter qu'une
 * seule des deux soit corrigée le jour où l'une se révèle fausse. Ce fichier ne
 * garde que ce qui lui appartient : les copies de conflit, la pierre tombale de
 * purge, et l'écriture sur disque.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import Modal, { ModalBody, ModalFooter } from '../ui/Modal/Modal';
import Button from '../ui/Button/Button';
import {
  permanentlyDeleteNote,
  restoreNote,
  saveNotesToDisk,
  selectConflictResolutions,
  updateNote,
} from '../../../store/slices/notesSlice';
import { stripConflictMark } from '../../../services/notes/conflictResolution';
import type { ConflictResolution } from '../../../services/notes/conflictResolution';
import type { DiffSide } from '../../../services/notes/blockDiff';
import {
  buildMergePlan,
  planOutcome,
  planProgress,
  planResult,
  takeAllChoices,
  type MergeSide,
} from '../../../services/notes/mergePlan';
import BlockMergeView, { type BlockMergeHandle } from './BlockMergeView';
import { stripWikiLinks } from '../../../services/notes/noteLinkParser';
import { restampCopiedDbIds, restampDuplicateDbIds } from './extensions/inlineDatabase/dbIndex';
import type { AppDispatch } from '../../../store';
import { useNotification } from '../ui/Notification';
import './NoteConflictModal.css';

interface NoteConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Dates dans la langue de l'APPLICATION, pas dans celle du système. */
function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return date.toLocaleString(locale || undefined);
  } catch {
    return date.toLocaleString();
  }
}

export const NoteConflictModal: React.FC<NoteConflictModalProps> = ({ isOpen, onClose }) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const conflicts = useSelector(selectConflictResolutions);
  const { success, error } = useNotification();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, DiffSide>>({});
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const merge = useRef<BlockMergeHandle | null>(null);
  const wasOpen = useRef(false);

  const soleId = conflicts.length === 1 ? conflicts[0].copyId : null;

  // Remise à zéro à la seule TRANSITION d'ouverture. La garde du drapeau est ce
  // qui protège l'arbitrage en cours : sans elle, un conflit de plus arrivé par
  // synchronisation ferait changer `soleId` et renverrait l'utilisateur à la
  // liste, ses choix perdus.
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setActiveId(soleId);
      setChoices({});
      setArmed(false);
      setBusy(false);
      setAnnouncement('');
      setRecomputed(false);
    }
    wasOpen.current = isOpen;
  }, [isOpen, soleId]);

  const active: ConflictResolution | null = useMemo(
    () => conflicts.find((item) => item.copyId === activeId) ?? null,
    [conflicts, activeId]
  );

  /**
   * LES DEUX VERSIONS EN PRÉSENCE, réduites à ce que le modèle de fusion
   * demande. Les dépendances sont des VALEURS, jamais l'objet de conflit : le
   * plan ne doit pas être refait parce qu'un champ machine de la note a bougé,
   * puisque le refaire renumérote les différences et efface les choix.
   */
  const keptTitle = active?.originState === 'live' ? (active.kept?.title ?? null) : null;
  const keptContent = active?.originState === 'live' ? (active.kept?.content ?? null) : null;
  const keptPlain = active?.originState === 'live' ? (active.kept?.plainText ?? '') : '';
  const losingTitle = active?.losing.title ?? null;
  const losingContent = active?.losing.content ?? null;
  const losingPlain = active?.losing.plainText ?? '';

  const mineSide: MergeSide | null = useMemo(
    () =>
      keptTitle !== null && keptContent !== null
        ? { title: keptTitle, content: keptContent, plainText: keptPlain }
        : null,
    [keptTitle, keptContent, keptPlain]
  );
  const theirsSide: MergeSide | null = useMemo(
    () =>
      losingTitle !== null && losingContent !== null
        ? { title: losingTitle, content: losingContent, plainText: losingPlain }
        : null,
    [losingTitle, losingContent, losingPlain]
  );
  const plan = useMemo(
    () => (mineSide && theirsSide ? buildMergePlan(mineSide, theirsSide) : null),
    [mineSide, theirsSide]
  );
  const comparison = plan?.comparison ?? null;

  /**
   * LE CONTENU PEUT CHANGER SOUS L'ÉCRAN. Un cycle de synchronisation tourne en
   * arrière-plan toutes les cinq minutes et `loadNotesFromDisk` remplace le
   * store en bloc : la comparaison est alors refaite et les différences
   * renumérotées par position. Les identifiants portent l'empreinte du couple
   * comparé, donc un choix périmé ne peut plus être COMPTÉ — mais il faut
   * encore le dire, désarmer la confirmation et repartir d'un décompte propre,
   * sinon on écrirait une fusion que personne n'a vue avant de purger la copie.
   *
   * Un simple changement d'écran n'est pas un changement de contenu : la
   * comparaison du couple précédent ne prouve rien sur celui-ci.
   */
  const signature = comparison?.signature ?? null;
  const compared = useRef<{ copyId: string; signature: string } | null>(null);
  const [recomputed, setRecomputed] = useState(false);

  useEffect(() => {
    if (!activeId || signature === null) {
      compared.current = null;
      return;
    }
    const previous = compared.current;
    compared.current = { copyId: activeId, signature };
    if (!previous || previous.copyId !== activeId) {
      setRecomputed(false);
      return;
    }
    if (previous.signature === signature) return;
    setChoices({});
    setArmed(false);
    setRecomputed(true);
    setAnnouncement(
      t(
        'notes.conflict.recomputed',
        'The note changed while you were deciding. The comparison was redone and your choices were cleared.'
      )
    );
  }, [activeId, signature, t]);

  const titleDiffers = plan?.titleDiffers ?? false;
  const progress = plan ? planProgress(plan, choices) : { decided: 0, total: 0, settled: true };
  const decided = progress.decided;
  const total = progress.total;
  const allDecided = progress.settled;

  const setChoice = useCallback(
    (id: string, side: DiffSide, index: number, count: number): void => {
      setArmed(false);
      setChoices((prev) => ({ ...prev, [id]: side }));
      const where = { index: index + 1, total: count };
      setAnnouncement(
        side === 'mine'
          ? t('notes.conflict.announceMine', {
              ...where,
              defaultValue: 'Difference {{index}} of {{total}}: your version kept',
            })
          : side === 'theirs'
            ? t('notes.conflict.announceTheirs', {
                ...where,
                defaultValue: 'Difference {{index}} of {{total}}: the other version kept',
              })
            : t('notes.conflict.announceBoth', {
                ...where,
                defaultValue: 'Difference {{index}} of {{total}}: both versions kept',
              })
      );
    },
    [t]
  );

  const takeAll = useCallback(
    (side: DiffSide): void => {
      if (!plan) return;
      setArmed(false);
      setChoices(takeAllChoices(plan, side));
      setAnnouncement(
        side === 'mine'
          ? t('notes.conflict.announceAllMine', {
              count: plan.decisionIds.length,
              defaultValue: 'All {{count}} difference(s) take your version',
            })
          : t('notes.conflict.announceAllTheirs', {
              count: plan.decisionIds.length,
              defaultValue: 'All {{count}} difference(s) take the other version',
            })
      );
    },
    [plan, t]
  );

  // ==================== Écritures ====================

  /**
   * Persiste, et ne rend `true` que si le disque a bien pris l'écriture.
   *
   * CE QUE DIT L'ÉCHEC, ET POURQUOI ON NE REVIENT PAS EN ARRIÈRE. À ce stade le
   * store porte DÉJÀ la décision : la note est écrasée, la copie retirée, sa
   * pierre tombale posée. Annoncer « rien n'a été écrit, réessayez » serait
   * doublement faux — l'application a changé d'état, et il n'y a plus rien à
   * réessayer puisque la copie a quitté la liste des conflits. Défaire serait
   * pire encore : la décision, elle, est juste ; c'est l'écriture qui a échoué,
   * et le prochain enregistrement la portera. On dit donc exactement cela.
   */
  const persist = useCallback(async (): Promise<boolean> => {
    try {
      await dispatch(saveNotesToDisk()).unwrap();
      return true;
    } catch {
      error(
        t(
          'notes.conflict.saveFailed',
          'Your decision is applied in the app, but writing it to disk failed. It will be written with the next save — do not quit until it goes through.'
        )
      );
      return false;
    }
  }, [dispatch, error, t]);

  const leave = useCallback((): void => {
    setActiveId(null);
    setChoices({});
    setArmed(false);
    setAnnouncement('');
    setRecomputed(false);
  }, []);

  const finish = useCallback((): void => {
    leave();
    // Un seul conflit au départ : le résoudre ferme l'écran, il n'y a plus rien
    // derrière. S'il en reste, on retombe sur la liste.
    if (conflicts.length <= 1) onClose();
  }, [conflicts.length, leave, onClose]);

  const handleResolve = async (): Promise<void> => {
    if (!active || busy || active.originState !== 'live' || !active.kept) return;
    if (!allDecided) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    const kept = active.kept;
    setBusy(true);

    // LE MÊME CALCUL QUE CELUI DE L'APERÇU, littéralement la même fonction : ce
    // qui part au magasin ne peut donc pas différer de ce qu'on a montré.
    if (!plan || !mineSide || !theirsSide) {
      setBusy(false);
      setArmed(false);
      return;
    }
    const result = planResult(plan, choices, mineSide, theirsSide);
    // « GARDER LES DEUX » PEUT POSER DEUX FOIS LA MÊME BASE. Un bloc base
    // modifié des deux côtés arrive en deux exemplaires, de MÊME identité — et
    // ce document part au magasin sans qu'aucun éditeur soit monté, donc sans le
    // greffon d'identité qui re-frappe d'habitude les duplications. Le premier
    // exemplaire garde son identité (les relations du coffre le visent déjà), le
    // second en reçoit une neuve. Seul un document RECONSTRUIT en a besoin :
    // retoucher une version recopiée telle quelle, c'est y introduire un écart.
    const content = result.rebuilt ? restampDuplicateDbIds(result.content) : result.content;
    const plainText = result.rebuilt ? stripWikiLinks(result.plainText) : result.plainText;

    dispatch(updateNote({ id: kept.id, changes: { title: result.title, content, plainText } }));
    // Pierre tombale obligatoire : une suppression douce et la copie revient du
    // nuage au cycle suivant.
    dispatch(permanentlyDeleteNote(active.copyId));
    if (!(await persist())) {
      setBusy(false);
      setArmed(false);
      return;
    }
    success(t('notes.conflict.resolved', 'Conflict resolved'));
    setBusy(false);
    finish();
  };

  const handleDeleteCopy = async (): Promise<void> => {
    if (!active || busy) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    dispatch(permanentlyDeleteNote(active.copyId));
    if (!(await persist())) {
      setBusy(false);
      setArmed(false);
      return;
    }
    success(t('notes.conflict.copyDeleted', 'Conflict copy deleted'));
    setBusy(false);
    finish();
  };

  const handlePromote = async (): Promise<void> => {
    if (!active || busy) return;
    setBusy(true);
    // La copie devient une note ordinaire : on lui retire la marque du titre ET
    // les champs machine, sans quoi elle resterait éternellement « en conflit ».
    //
    // ET SES BASES INLINE CHANGENT D'IDENTITÉ. Une copie de conflit porte le
    // document de la perdante à l'octet : ses bases ont donc l'identité de
    // celles de l'origine. Tant que la copie s'appelle « copie » cela ne se voit
    // pas ; devenue note à part entière, elle vivrait à côté de l'origine (ou de
    // son retour de corbeille) et une relation qui vise l'une lirait l'autre.
    // Une relation restée pendante se répare d'un clic ; deux bases de même
    // identité donnent des chiffres faux que rien n'annonce. Le document n'est
    // réécrit que si la re-frappe a bougé quelque chose : une note sans base ne
    // doit pas voir son contenu retouché par ce geste.
    const restamped = restampCopiedDbIds(active.losing.content);
    dispatch(
      updateNote({
        id: active.copyId,
        changes: {
          title: stripConflictMark(active.losing.title),
          ...(restamped !== active.losing.content ? { content: restamped } : {}),
          conflictOfId: undefined,
          conflictSavedAt: undefined,
          conflictOriginalUpdatedAt: undefined,
          conflictSide: undefined,
          conflictDevice: undefined,
          conflictKeptUpdatedAt: undefined,
        },
      })
    );
    if (!(await persist())) {
      setBusy(false);
      return;
    }
    success(t('notes.conflict.promoted', 'Version kept as a note of its own'));
    setBusy(false);
    finish();
  };

  const handleRestoreOrigin = async (): Promise<void> => {
    if (!active || busy) return;
    setBusy(true);
    dispatch(restoreNote(active.originId));
    if (!(await persist())) {
      setBusy(false);
      return;
    }
    success(t('notes.conflict.originRestored', 'Original note restored'));
    setBusy(false);
    setArmed(false);
  };

  const close = (): void => {
    if (busy) return;
    setArmed(false);
    onClose();
  };

  // ==================== Rendu ====================

  const untitled = t('notes.conflict.untitled', 'Untitled note');
  const label = (value: string): string => (value.trim() === '' ? untitled : value);

  const renderList = (): React.ReactNode => (
    <>
      <p className="note-conflict__intro">
        {t(
          'notes.conflict.intro',
          'Sync found two versions of these notes and could not choose between them. Compare and decide what each note should hold — nothing is written until you confirm.'
        )}
      </p>
      <ul className="note-conflict__list">
        {conflicts.map((item, index) => (
          <li className="note-conflict__row" key={item.copyId}>
            <div className="note-conflict__row-body">
              <span className="note-conflict__row-title">{label(item.losing.title)}</span>
              <p className="note-conflict__row-meta">
                <span>
                  {item.side === 'remote'
                    ? t('notes.conflict.fromCloud', 'The other version came from the cloud')
                    : item.side === 'local'
                      ? t('notes.conflict.fromDevice', 'The other version was on this device')
                      : t('notes.conflict.fromUnknown', 'Origin of the other version unknown')}
                </span>
                {formatDate(item.timestamps.savedAt, i18n.language) && (
                  <span>
                    {t('notes.conflict.savedAt', {
                      date: formatDate(item.timestamps.savedAt, i18n.language),
                      defaultValue: 'Kept aside on {{date}}',
                    })}
                  </span>
                )}
              </p>
              <p className="note-conflict__row-flags">
                {item.identical && (
                  <span className="note-conflict__flag note-conflict__flag--calm">
                    {t('notes.conflict.flagIdentical', 'Both versions are identical')}
                  </span>
                )}
                {item.originState === 'trashed' && (
                  <span className="note-conflict__flag">
                    {t('notes.conflict.flagTrashed', 'Original in the trash')}
                  </span>
                )}
                {(item.originState === 'missing' || item.originState === 'self') && (
                  <span className="note-conflict__flag">
                    {t('notes.conflict.flagMissing', 'Original gone')}
                  </span>
                )}
                {item.reworked && (
                  <span className="note-conflict__flag">
                    {t('notes.conflict.flagReworked', 'Copy edited since')}
                  </span>
                )}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setActiveId(item.copyId);
                setChoices({});
                setArmed(false);
                setAnnouncement('');
              }}
              {...(index === 0 ? { 'data-autofocus': true } : {})}
            >
              {t('notes.conflict.open', 'Resolve')}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );

  const renderDetail = (conflict: ConflictResolution): React.ReactNode => {
    const orphan =
      conflict.originState === 'missing' ||
      conflict.originState === 'self' ||
      conflict.originState === 'trashed';

    if (orphan) {
      return (
        <>
          <p className="note-conflict__notice note-conflict__notice--warning">
            {conflict.originState === 'trashed'
              ? t(
                  'notes.conflict.originTrashed',
                  'The original note is in the trash, so there is nothing to compare it with. Restore it to put the two versions face to face, or keep this version as a note of its own.'
                )
              : t(
                  'notes.conflict.originMissing',
                  'The original note no longer exists — this copy is the last holder of that text. Keep it as a note of its own, or delete it for good.'
                )}
          </p>
          <div className="note-conflict__orphan">
            <h4 className="note-conflict__orphan-title">{label(conflict.losing.title)}</h4>
            <p className="note-conflict__orphan-text">
              {conflict.losing.plainText.trim() !== ''
                ? conflict.losing.plainText.slice(0, 1200)
                : t('notes.conflict.noText', '(no text)')}
            </p>
          </div>
        </>
      );
    }

    const kept = conflict.kept;
    if (!kept || !plan || !comparison) return null;

    return (
      <>
        <div className="note-conflict__versions">
          <div className="note-conflict__version">
            <h4 className="note-conflict__version-title">
              {t('notes.conflict.mine', 'Your version')}
            </h4>
            <p className="note-conflict__version-meta">
              <span>{t('notes.conflict.keptHint', 'Kept by the merge')}</span>
              {formatDate(kept.updatedAt, i18n.language) && (
                <span>{formatDate(kept.updatedAt, i18n.language)}</span>
              )}
            </p>
          </div>
          <div className="note-conflict__version">
            <h4 className="note-conflict__version-title">
              {t('notes.conflict.theirs', 'The other version')}
            </h4>
            <p className="note-conflict__version-meta">
              <span>
                {conflict.side === 'remote'
                  ? t('notes.conflict.sideRemote', 'Came from the cloud')
                  : conflict.side === 'local'
                    ? t('notes.conflict.sideLocal', 'Was on this device')
                    : t('notes.conflict.sideUnknown', 'Origin unknown')}
              </span>
              {formatDate(conflict.timestamps.losingUpdatedAt, i18n.language) && (
                <span>{formatDate(conflict.timestamps.losingUpdatedAt, i18n.language)}</span>
              )}
            </p>
          </div>
        </div>

        {conflict.device && (
          <p className="note-conflict__footnote">
            {t('notes.conflict.mergedOn', {
              device: conflict.device,
              defaultValue: 'Merge ran on the {{device}} app',
            })}
          </p>
        )}

        {recomputed && (
          <p className="note-conflict__notice note-conflict__notice--warning" role="alert">
            {t(
              'notes.conflict.recomputed',
              'The note changed while you were deciding. The comparison was redone and your choices were cleared.'
            )}
          </p>
        )}

        {conflict.reworked && (
          <p className="note-conflict__notice note-conflict__notice--warning">
            {t(
              'notes.conflict.reworkedWarning',
              'You edited this copy after the merge created it. Resolving deletes the copy for good, so anything you wrote in it since must be taken over here.'
            )}
          </p>
        )}

        {conflict.identical && (
          <p className="note-conflict__notice note-conflict__notice--calm">
            {t(
              'notes.conflict.identicalNotice',
              'Both versions say exactly the same thing — title, document and text. There is nothing to choose: the copy can simply be deleted.'
            )}
          </p>
        )}

        {!comparison.comparable && (
          <p className="note-conflict__notice">
            {t(
              'notes.conflict.notComparable',
              'These two documents cannot be compared block by block (unreadable format). Pick one version as a whole.'
            )}
          </p>
        )}

        {comparison.coarse && (
          <p className="note-conflict__notice">
            {t(
              'notes.conflict.coarse',
              'These documents are too large to compare in detail: everything that differs is shown as a single difference.'
            )}
          </p>
        )}

        {/* Filet : quand RIEN n'est commun, la comparaison fine n'a rien
            trouvé à aligner et l'écran ne vaut guère mieux qu'un choix de
            document entier. Le dire vaut mieux que d'annoncer « Différence 1
            sur 1 » comme si c'était un résultat fin. */}
        {comparison.comparable &&
          !comparison.coarse &&
          comparison.hunks.length === 1 &&
          comparison.hunks[0].kind === 'changed' &&
          comparison.hunks[0].mine.length + comparison.hunks[0].theirs.length > 2 && (
            <p className="note-conflict__notice">
              {t(
                'notes.conflict.wholeDivergence',
                'These two documents have no block in common, so they are shown as a single difference. Check the result below before confirming.'
              )}
            </p>
          )}

        {total > 0 && (
          <div className="note-conflict__toolbar">
            <div className="note-conflict__toolbar-group">
              <Button variant="secondary" size="sm" onClick={() => takeAll('mine')} disabled={busy}>
                {t('notes.conflict.takeAllMine', 'Keep my version')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => takeAll('theirs')}
                disabled={busy}
              >
                {t('notes.conflict.takeAllTheirs', 'Keep their version')}
              </Button>
            </div>
            <div className="note-conflict__toolbar-group">
              <Button variant="ghost" size="sm" onClick={() => merge.current?.move(-1)}>
                {t('notes.conflict.previous', 'Previous difference')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => merge.current?.move(1)}>
                {t('notes.conflict.next', 'Next difference')}
              </Button>
            </div>
          </div>
        )}
        <BlockMergeView
          ref={merge}
          plan={plan}
          choices={choices}
          onChoose={setChoice}
          disabled={busy}
          idPrefix="note-conflict"
          titleRow={
            /* Le titre EST une différence, et numérotée comme les autres : le
               laisser hors du compte faisait commencer le document à
               « Différence 2 » et personne ne trouvait la première. */
            titleDiffers ? { mine: label(kept.title), theirs: label(conflict.losing.title) } : null
          }
          wholeRow={{
            mine: (
              <p className="note-conflict__block">
                {kept.plainText.trim() !== ''
                  ? kept.plainText.slice(0, 600)
                  : t('notes.conflict.noText', '(no text)')}
              </p>
            ),
            theirs: (
              <p className="note-conflict__block">
                {conflict.losing.plainText.trim() !== ''
                  ? conflict.losing.plainText.slice(0, 600)
                  : t('notes.conflict.noText', '(no text)')}
              </p>
            ),
          }}
        />
      </>
    );
  };

  // ---- Pied ----

  /**
   * L'issue que la confirmation doit NOMMER. Le titre compte comme une décision
   * à part entière : un document tout entier gardé d'un côté avec le titre de
   * l'autre est un mélange, et l'annoncer « je garde ma version » serait faux.
   */
  const outcome = plan ? planOutcome(plan, choices) : 'mine';

  const confirmText =
    outcome === 'mine'
      ? t(
          'notes.conflict.confirmMine',
          'Keep YOUR version and permanently delete the conflict copy? The other version will be gone for good.'
        )
      : outcome === 'theirs'
        ? t(
            'notes.conflict.confirmTheirs',
            'Replace the note with the OTHER version and permanently delete the conflict copy? Your current version will be gone for good.'
          )
        : t(
            'notes.conflict.confirmMerge',
            'Write the merged result into the note and permanently delete the conflict copy? Both original versions will be gone for good.'
          );

  const orphanActive =
    !!active &&
    (active.originState === 'missing' ||
      active.originState === 'self' ||
      active.originState === 'trashed');

  // L'état d'orphelin entre dans la clé : « Restaurer l'original » fait passer
  // l'écran de la fiche isolée à la comparaison, donc retire du DOM le bouton
  // qui avait le focus. Sans remontage, le piège à focus du design system garde
  // les bornes figées à l'ouverture et la tabulation repart de la page.
  const screenKey = active
    ? `conflict-${active.copyId}-${orphanActive ? 'orphan' : 'diff'}`
    : 'conflict-list';
  const heading = active
    ? t('notes.conflict.titleFor', {
        title: label(active.losing.title),
        defaultValue: 'Two versions of “{{title}}”',
      })
    : t('notes.conflict.title', 'Resolve conflicts');

  return (
    // La fenêtre est REMONTÉE à chaque changement d'écran : le piège à focus du
    // design system fige ses bornes à l'ouverture, et un corps remplacé sous
    // lui renverrait la tabulation au mauvais endroit.
    <Modal key={screenKey} isOpen={isOpen} onClose={close} title={heading} size="xl">
      <ModalBody>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {conflicts.length === 0 ? (
          <p className="note-conflict__empty">
            {t('notes.conflict.empty', 'No conflict left to resolve.')}
          </p>
        ) : active ? (
          renderDetail(active)
        ) : (
          renderList()
        )}
      </ModalBody>

      <ModalFooter className="note-conflict__footer">
        {armed && active && (
          <p className="note-conflict__warning" role="alert">
            {orphanActive
              ? t(
                  'notes.conflict.confirmDeleteCopy',
                  'Permanently delete this conflict copy? It does not go to the trash and will not come back from the cloud.'
                )
              : active.identical
                ? t(
                    'notes.conflict.confirmDeleteIdentical',
                    'Permanently delete this copy? Its content is already in the original, word for word.'
                  )
                : confirmText}
          </p>
        )}
        <div className="note-conflict__actions">
          {active && !orphanActive && !active.identical && total > 0 && (
            <span className="note-conflict__count">
              {t('notes.conflict.decided', {
                decided,
                total,
                defaultValue: '{{decided}} of {{total}} difference(s) chosen',
              })}
            </span>
          )}
          {active && conflicts.length > 1 && (
            <Button variant="ghost" onClick={leave} disabled={busy}>
              {t('notes.conflict.back', 'All conflicts')}
            </Button>
          )}
          <Button variant="secondary" onClick={close} disabled={busy}>
            {t('common.close', 'Close')}
          </Button>

          {active && orphanActive && (
            <>
              {active.originState === 'trashed' && (
                <Button
                  variant="secondary"
                  onClick={() => void handleRestoreOrigin()}
                  disabled={busy}
                >
                  {t('notes.conflict.restoreOrigin', 'Restore the original')}
                </Button>
              )}
              <Button variant="danger" onClick={() => void handleDeleteCopy()} disabled={busy}>
                {armed
                  ? t('notes.conflict.confirmDelete', 'Confirm deletion')
                  : t('notes.conflict.deleteCopy', 'Delete the copy')}
              </Button>
              <Button variant="primary" onClick={() => void handlePromote()} disabled={busy}>
                {t('notes.conflict.promote', 'Keep as a separate note')}
              </Button>
            </>
          )}

          {active && !orphanActive && active.identical && (
            <Button variant="danger" onClick={() => void handleDeleteCopy()} disabled={busy}>
              {armed
                ? t('notes.conflict.confirmDelete', 'Confirm deletion')
                : t('notes.conflict.deleteCopy', 'Delete the copy')}
            </Button>
          )}

          {active && !orphanActive && !active.identical && (
            <Button
              variant={armed ? 'danger' : 'primary'}
              onClick={() => void handleResolve()}
              disabled={busy || !allDecided}
            >
              {armed
                ? t('notes.conflict.confirmResolve', 'Confirm and delete the copy')
                : t('notes.conflict.resolve', 'Resolve')}
            </Button>
          )}
        </div>
      </ModalFooter>
    </Modal>
  );
};

export default NoteConflictModal;
