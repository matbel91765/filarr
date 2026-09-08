/**
 * VaultNoteConflict — L'ARBITRAGE D'UN 409 sur une note de coffre partagé, à la
 * manière d'un conflit git : ma version d'un côté, celle du coffre de l'autre,
 * alignées bloc par bloc, chaque divergence acceptée d'un côté OU de l'autre (ou
 * des deux), et le document fusionné rendu tel qu'il sera écrit.
 *
 * ── CE QUI EST PARTAGÉ AVEC L'ÉCRAN DES NOTES PERSONNELLES, ET CE QUI NE L'EST PAS ──
 *
 * PARTAGÉ : le moteur de différence (`services/notes/blockDiff`), le modèle de
 * décision et ses règles de sûreté (`services/notes/mergePlan`), et le
 * face-à-face lui-même (`components/notes/BlockMergeView`). La question posée à
 * l'utilisateur est mot pour mot la même, donc elle n'a qu'une implémentation.
 *
 * PROPRE À CE CÔTÉ, et c'est tout ce que ce fichier contient : une note de
 * coffre n'est pas une note. Elle n'entre PAS dans `notesSlice` (voir l'en-tête
 * de `VaultNotePane` : la recherche globale, le graphe, les modèles et la sync
 * locale la ramasseraient, et l'élection d'enregistrement serait perdue). Elle
 * est un élément CHIFFRÉ, gardé par un compare-and-set côté serveur, avec des
 * révisions et une salle collaborative. Il n'y a donc ici ni copie de conflit à
 * purger, ni pierre tombale, ni écriture sur disque : il y a une VERSION à
 * respecter.
 *
 * ── LA VERSION CONTRE LAQUELLE ON ÉCRIT ─────────────────────────────────────
 *
 * La fusion repart de la version QU'ON VIENT DE LIRE — celle que le 409 a
 * rapportée — et jamais de celle qu'on avait chargée. Rien n'est « forcé » pour
 * faire taire le conflit : si un TROISIÈME enregistrement arrive pendant
 * l'arbitrage, le commit reprend un 409, l'écran se rouvre sur les nouvelles
 * données, et les choix pris sur l'ancien couple sont effacés — leurs
 * identifiants portent l'empreinte du couple comparé, donc ils ne peuvent même
 * pas être comptés par erreur (voir `blockDiff`). C'est ce que dit le bandeau
 * `merge.recomputed`.
 *
 * ── L'APERÇU NE PEUT PAS DIVERGER DE CE QUI SERA ÉCRIT ──────────────────────
 *
 * Il n'est pas une liste de fragments réassemblée pour l'occasion : c'est le
 * résultat de `planResult()` — LA fonction que le bouton d'enregistrement
 * appelle — monté dans une surface d'éditeur en lecture seule, celle-là même qui
 * affiche la note. Un document que l'aperçu accepte est un document que
 * l'éditeur sait rouvrir, et le seul moyen qu'ils racontent deux histoires
 * différentes serait d'appeler deux fonctions différentes. Il n'y en a qu'une.
 *
 * ── L'ÉLÉMENT SUPPRIMÉ N'EST PAS UN CONFLIT ─────────────────────────────────
 *
 * Quand le 409 ne rapporte aucune version (`serverVersion === null`), l'élément
 * a été supprimé pendant l'édition : il n'y a plus rien en face, donc pas
 * d'arbitrage. Cet écran n'est alors PAS monté — `VaultNoteEditor` garde son
 * bandeau, qui ne promet rien d'autre que de fermer.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';
import BlockMergeView, { type BlockMergeHandle } from '../notes/BlockMergeView';
import type { DiffSide } from '../../../services/notes/blockDiff';
import {
  buildMergePlan,
  planOutcome,
  planProgress,
  planResult,
  takeAllChoices,
  type MergeSide,
} from '../../../services/notes/mergePlan';
import { restampDuplicateDbIds } from '../notes/extensions/inlineDatabase/dbIndex';

export interface VaultMergeSideInput {
  title: string;
  /** Document ProseMirror, tel quel. */
  doc: unknown;
}

interface Props {
  /** Notre version — EXACTEMENT le document que le serveur vient de refuser. */
  mine: VaultMergeSideInput;
  /** La version du coffre, déchiffrée depuis l'élément que le 409 portait. */
  theirs: VaultMergeSideInput | null;
  /** Où en est le déchiffrement de la version du coffre. */
  status: 'loading' | 'ready' | 'error';
  /** La version du serveur, celle contre laquelle la fusion sera commitée. */
  serverVersion: number;
  saving: boolean;
  /** Écrit le résultat, gardé par `serverVersion`. */
  onResolve: (result: { title: string; doc: unknown }) => void;
  /** Abandonne notre texte et recharge ce que le coffre détient. */
  onDiscardMine: () => void;
  /** Écrit NOTRE version telle quelle — le seul recours si rien ne se compare. */
  onKeepMine: () => void;
  /**
   * Rend un document dans la surface d'éditeur du coffre, en lecture seule.
   * Fourni par `VaultNoteEditor` : la surface vit chez lui, et l'importer d'ici
   * ferait un cycle de modules.
   */
  renderPreview: (doc: unknown, key: string) => React.ReactNode;
}

/**
 * Le texte brut n'existe pas pour une note de coffre — le corps chiffré ne porte
 * que le document. `MergeSide` en demande un pour l'écran des notes
 * personnelles, qui le persiste ; ici il n'est ni lu ni écrit.
 */
const NO_PLAIN_TEXT = '';

export const VaultNoteConflict: React.FC<Props> = ({
  mine,
  theirs,
  status,
  serverVersion,
  saving,
  onResolve,
  onDiscardMine,
  onKeepMine,
  renderPreview,
}) => {
  const { t } = useTranslation();
  const [choices, setChoices] = useState<Record<string, DiffSide>>({});
  const [armed, setArmed] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [recomputed, setRecomputed] = useState(false);
  const merge = useRef<BlockMergeHandle | null>(null);

  const mineSide: MergeSide = useMemo(
    () => ({ title: mine.title, content: JSON.stringify(mine.doc), plainText: NO_PLAIN_TEXT }),
    [mine]
  );
  const theirsSide: MergeSide | null = useMemo(
    () =>
      theirs
        ? { title: theirs.title, content: JSON.stringify(theirs.doc), plainText: NO_PLAIN_TEXT }
        : null,
    [theirs]
  );
  const plan = useMemo(
    () => (theirsSide ? buildMergePlan(mineSide, theirsSide) : null),
    [mineSide, theirsSide]
  );

  /**
   * LE COUPLE COMPARÉ A CHANGÉ SOUS L'ÉCRAN — un troisième enregistrement est
   * arrivé et notre commit a repris un 409, avec un nouvel élément serveur. Les
   * identifiants sont renumérotés par position, et bien qu'ils portent
   * l'empreinte du couple (donc qu'un choix périmé ne PUISSE pas être compté),
   * il faut encore le dire, désarmer la confirmation et repartir d'un décompte
   * propre : sinon le pied annoncerait « 3 sur 5 » sur des décisions que plus
   * personne n'a prises.
   */
  const signature = plan?.signature ?? null;
  const compared = useRef<string | null>(null);
  if (signature !== null && compared.current !== signature) {
    const first = compared.current === null;
    compared.current = signature;
    if (!first) {
      setChoices({});
      setArmed(false);
      setRecomputed(true);
    }
  }

  const progress = plan ? planProgress(plan, choices) : { decided: 0, total: 0, settled: false };
  const outcome = plan ? planOutcome(plan, choices) : 'mine';

  const setChoice = useCallback(
    (id: string, side: DiffSide, index: number, count: number): void => {
      // Un choix qui change DÉSARME la confirmation : elle nomme une issue, et
      // celle qu'elle nommait n'est plus celle qu'on vient de composer.
      setArmed(false);
      setChoices((prev) => ({ ...prev, [id]: side }));
      const where = { index: index + 1, total: count };
      setAnnouncement(
        side === 'mine'
          ? t('notes.conflict.announceMine', where)
          : side === 'theirs'
            ? t('notes.conflict.announceTheirs', where)
            : t('notes.conflict.announceBoth', where)
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
          ? t('notes.conflict.announceAllMine', { count: plan.decisionIds.length })
          : t('notes.conflict.announceAllTheirs', { count: plan.decisionIds.length })
      );
    },
    [plan, t]
  );

  /**
   * LE RÉSULTAT — un seul calcul, deux usages : l'aperçu le montre, le bouton
   * l'écrit. Un document RECONSTRUIT (mélange bloc à bloc) peut porter deux fois
   * la même base inline quand « garder les deux » a retenu les deux versants du
   * même bloc : le second exemplaire reçoit une identité neuve, sans quoi deux
   * bases de même identité vivraient dans le coffre et une relation qui vise
   * l'une lirait l'autre. Une version recopiée telle quelle n'est jamais
   * retouchée — y toucher ne pourrait qu'y introduire un écart.
   */
  const result = useMemo(() => {
    if (!plan || !theirsSide) return null;
    const built = planResult(plan, choices, mineSide, theirsSide);
    const content = built.rebuilt ? restampDuplicateDbIds(built.content) : built.content;
    try {
      return { title: built.title, doc: JSON.parse(content) as unknown };
    } catch {
      return null;
    }
  }, [plan, choices, mineSide, theirsSide]);

  /**
   * La clé de l'aperçu : la surface d'éditeur ne lit son document QU'AU MONTAGE
   * (tiptap traite `content` comme une valeur initiale), donc changer un choix
   * doit la remonter. Elle est composée du couple comparé ET de la suite des
   * décisions — deux états de l'écran qui rendent le même document portent la
   * même clé, et aucun ne peut afficher le document d'un autre.
   */
  const previewKey = plan
    ? `${plan.signature}:${plan.decisionIds.map((id) => choices[id] ?? '-').join('')}`
    : 'none';

  const confirmText =
    outcome === 'mine'
      ? t('teamVaults.noteEditor.merge.confirmMine')
      : outcome === 'theirs'
        ? t('teamVaults.noteEditor.merge.confirmTheirs')
        : t('teamVaults.noteEditor.merge.confirmMerge');

  const handleResolve = (): void => {
    if (!result || saving || !progress.settled) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    onResolve(result);
  };

  // ── Rien à comparer : le repli honnête ────────────────────────────────────
  //
  // Tant que la version du coffre n'est pas déchiffrée, il n'y a pas de
  // face-à-face possible. On ne prétend donc pas en offrir un : les deux seuls
  // gestes qui gardent leur sens sont écrire par-dessus ou abandonner.
  if (status !== 'ready' || !plan || !theirsSide) {
    return (
      <div className="vault-note-conflict" role="alert">
        <p className="vault-note-conflict__lead">{t('teamVaults.noteEditor.conflict')}</p>
        <p className="vault-note-conflict__note">
          {status === 'loading'
            ? t('teamVaults.noteEditor.merge.loading')
            : t('teamVaults.noteEditor.conflictViewError')}
        </p>
        <div className="vault-note-conflict__actions">
          <Button size="sm" variant="primary" loading={saving} onClick={onKeepMine}>
            {t('teamVaults.noteEditor.conflictKeepMine')}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={onDiscardMine}>
            {t('teamVaults.noteEditor.conflictDiscardMine')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="vault-note-conflict" role="alert">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <p className="vault-note-conflict__lead">{t('teamVaults.noteEditor.merge.lead')}</p>

      {recomputed && (
        <p className="note-conflict__notice note-conflict__notice--warning">
          {t('teamVaults.noteEditor.merge.recomputed')}
        </p>
      )}

      <div className="note-conflict__versions">
        <div className="note-conflict__version">
          <h4 className="note-conflict__version-title">{t('notes.conflict.mine')}</h4>
          <p className="note-conflict__version-meta">
            <span>{t('teamVaults.noteEditor.merge.mineHint')}</span>
          </p>
        </div>
        <div className="note-conflict__version">
          <h4 className="note-conflict__version-title">{t('notes.conflict.theirs')}</h4>
          <p className="note-conflict__version-meta">
            <span>{t('teamVaults.noteEditor.merge.theirsHint', { version: serverVersion })}</span>
          </p>
        </div>
      </div>

      {plan.comparison.coarse && (
        <p className="note-conflict__notice">{t('notes.conflict.coarse')}</p>
      )}

      {progress.total > 0 && (
        <div className="note-conflict__toolbar">
          <div className="note-conflict__toolbar-group">
            <Button variant="secondary" size="sm" disabled={saving} onClick={() => takeAll('mine')}>
              {t('notes.conflict.takeAllMine')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={saving}
              onClick={() => takeAll('theirs')}
            >
              {t('notes.conflict.takeAllTheirs')}
            </Button>
          </div>
          <div className="note-conflict__toolbar-group">
            <Button variant="ghost" size="sm" onClick={() => merge.current?.move(-1)}>
              {t('notes.conflict.previous')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => merge.current?.move(1)}>
              {t('notes.conflict.next')}
            </Button>
          </div>
        </div>
      )}

      <BlockMergeView
        ref={merge}
        plan={plan}
        choices={choices}
        onChoose={setChoice}
        disabled={saving}
        idPrefix="vault-merge"
        titleRow={plan.titleDiffers ? { mine: mine.title, theirs: theirsSide.title } : null}
        preview={
          result ? (
            <div className="vault-note-conflict__preview">
              {renderPreview(result.doc, previewKey)}
            </div>
          ) : undefined
        }
      />

      {armed && (
        <p className="note-conflict__warning" role="alert">
          {confirmText}
        </p>
      )}

      <div className="vault-note-conflict__actions">
        {progress.total > 0 && (
          <span className="note-conflict__count">
            {t('notes.conflict.decided', { decided: progress.decided, total: progress.total })}
          </span>
        )}
        <Button size="sm" variant="ghost" disabled={saving} onClick={onDiscardMine}>
          {t('teamVaults.noteEditor.conflictDiscardMine')}
        </Button>
        <Button
          size="sm"
          variant={armed ? 'danger' : 'primary'}
          loading={saving}
          // AUCUNE DIFFÉRENCE N'A DE VALEUR PAR DÉFAUT : tant qu'il en reste une
          // sans réponse, ce bouton est fermé. Un repli muet sur « ma version »
          // écraserait le travail d'en face sans que personne l'ait dit.
          disabled={!progress.settled || result === null}
          onClick={handleResolve}
        >
          {armed
            ? t('teamVaults.noteEditor.merge.confirmResolve')
            : t('teamVaults.noteEditor.merge.resolve')}
        </Button>
      </div>
    </div>
  );
};

export default VaultNoteConflict;
