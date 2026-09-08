/**
 * BlockMergeView — LE FACE-À-FACE de fusion, à la manière d'un conflit git : ma
 * version d'un côté, la leur de l'autre, alignées bloc par bloc, les blocs
 * communs discrets, ceux qui divergent mis en avant, et un bouton par côté pour
 * chaque divergence — plus « garder les deux » là où elle a un sens.
 *
 * POURQUOI CE COMPOSANT EXISTE À PART. Deux écrans posent aujourd'hui la même
 * question : `NoteConflictModal` (notes personnelles, deux copies dans le
 * magasin local) et `VaultNoteConflict` (note de coffre, 409 sur la garde de
 * version du serveur). Rien de leur persistance n'est commun, mais la
 * PRÉSENTATION et les règles de sûreté le sont entièrement — et les laisser
 * recopiées, c'était accepter qu'un seul des deux soit corrigé le jour où l'une
 * se révèle fausse. Le modèle de décision vit dans `services/notes/mergePlan`,
 * le moteur de différence dans `services/notes/blockDiff` : ce fichier ne
 * décide rien, il DESSINE.
 *
 * ── CE QU'IL GARANTIT, ET LE DÉFAUT QUE CHAQUE RÈGLE FERME ──────────────────
 *
 * · AUCUN CHOIX N'EST PRÉSÉLECTIONNÉ. L'état d'une différence non tranchée est
 *   affiché en toutes lettres (« pas encore choisi »), jamais deviné. C'est
 *   l'appelant qui referme son bouton d'écriture tant qu'il en reste
 *   (`planProgress().settled`), mais l'écran ne doit pas non plus SUGGÉRER une
 *   réponse par une case déjà cochée.
 *
 * · LES IDENTIFIANTS VIENNENT DU PLAN, PAS DE LA POSITION DANS LE RENDU. Un
 *   bloc inséré en tête décale toutes les différences ; `blockDiff` suffixe donc
 *   chaque identifiant de l'empreinte du couple comparé, et ce composant ne
 *   fabrique jamais d'identifiant lui-même. Un choix pris sur une comparaison
 *   précédente ne peut pas se reporter sur un autre bloc.
 *
 * · UN BLOC SANS TEXTE N'EST JAMAIS RENDU COMME UN VIDE. Image, base inline,
 *   dessin, formule : tout leur contenu est dans leurs attributs. Les afficher
 *   « bloc sans texte » des deux côtés reviendrait à faire trancher entre deux
 *   panneaux identiques avant de jeter celui qu'on écarte. On montre donc le
 *   type traduit ET ce que les attributs savent dire (`DiffBlock.summary`), et
 *   quand ils ne disent rien, le RANG du bloc dans son document — deux images
 *   collées sans nom restent au moins distinguables l'une de l'autre.
 *
 * · LE PARCOURS CLAVIER EST UNE PROPRIÉTÉ DE L'ÉCRAN, pas de l'appelant :
 *   Alt+↓/↑ d'ici, et un `move()` exposé pour les boutons « différence
 *   précédente / suivante » de la barre d'outils. L'ordre parcouru vient de
 *   `plan.decisionIds` et jamais de l'ordre d'inscription des références, que
 *   React reconstruit à chaque rendu.
 */

import React, { useCallback, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Button from '../ui/Button/Button';
import type { DiffBlock, DiffHunk, DiffSide } from '../../../services/notes/blockDiff';
import { TITLE_DECISION, WHOLE_DECISION, type MergePlan } from '../../../services/notes/mergePlan';
import './BlockMergeView.css';

/** Au-delà, une suite de blocs inchangés est repliée derrière un compteur. */
const COMMON_FOLD_THRESHOLD = 3;

export interface BlockMergeHandle {
  /** Déplace le focus de `delta` différences, en bornant aux extrémités. */
  move: (delta: number) => void;
}

export interface BlockMergeViewProps {
  plan: MergePlan;
  choices: Readonly<Record<string, DiffSide>>;
  onChoose: (id: string, side: DiffSide, index: number, total: number) => void;
  /** Les deux titres, quand ils diffèrent — le plan le dit, pas ce composant. */
  titleRow?: { mine: string; theirs: string } | null;
  /** Repli quand les deux corps ne se comparent pas : un seul choix, en bloc. */
  wholeRow?: { mine: React.ReactNode; theirs: React.ReactNode } | null;
  disabled?: boolean;
  /** Préfixe des id DOM : deux écrans peuvent coexister dans la même page. */
  idPrefix: string;
  /**
   * L'APERÇU DU RÉSULTAT, fourni par l'appelant. Quand il est absent, la vue en
   * rend un elle-même, bloc à bloc — utile là où aucun moteur de rendu n'est
   * disponible, mais un vrai document rendu vaut toujours mieux.
   */
  preview?: React.ReactNode;
}

/** Dépliage des longues traversées communes, par différence. */
type Unfolded = Record<string, boolean>;

export const BlockMergeView = React.forwardRef<BlockMergeHandle, BlockMergeViewProps>(
  function BlockMergeView(
    { plan, choices, onChoose, titleRow, wholeRow, disabled, idPrefix, preview },
    ref
  ) {
    const { t } = useTranslation();
    const [unfolded, setUnfolded] = React.useState<Unfolded>({});
    const sections = useRef(new Map<string, HTMLElement>());
    const cursor = useRef(0);

    const { comparison, decisionIds } = plan;
    const total = decisionIds.length;

    // Les dépliages appartiennent à UNE comparaison : quand le couple change,
    // les identifiants changent avec lui et les anciens ne désignent plus rien.
    const signature = plan.signature;
    const lastSignature = useRef(signature);
    if (lastSignature.current !== signature) {
      lastSignature.current = signature;
      if (Object.keys(unfolded).length > 0) setUnfolded({});
    }

    const focusDecision = useCallback(
      (index: number): void => {
        if (decisionIds.length === 0) return;
        const clamped = Math.max(0, Math.min(index, decisionIds.length - 1));
        cursor.current = clamped;
        const element = sections.current.get(decisionIds[clamped]);
        element?.focus();
        element?.scrollIntoView({ block: 'nearest' });
      },
      [decisionIds]
    );

    useImperativeHandle(
      ref,
      () => ({ move: (delta: number) => focusDecision(cursor.current + delta) }),
      [focusDecision]
    );

    const registerSection = useCallback((id: string, element: HTMLElement | null): void => {
      if (element) sections.current.set(id, element);
      else sections.current.delete(id);
    }, []);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusDecision(cursor.current + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusDecision(cursor.current - 1);
      }
    };

    /**
     * Le type d'un nœud TipTap est un identifiant de code (`inlineDatabase`,
     * `bulletList`) : il n'a rien à faire sous les yeux de quelqu'un. Traduit
     * quand on le connaît, montré tel quel sinon — un type ajouté demain reste
     * lisible plutôt que de disparaître.
     */
    const blockTypeLabel = (type: string): string =>
      t(`notes.conflict.blockType.${type}`, { defaultValue: '' }) || type || '?';

    const renderBlock = (blockItem: DiffBlock, key: string): React.ReactNode => {
      if (blockItem.text.trim() !== '') {
        return (
          <p className="note-conflict__block" key={key}>
            {blockItem.text}
          </p>
        );
      }
      return (
        <p className="note-conflict__block note-conflict__block--object" key={key}>
          <span className="note-conflict__block-kind">{blockTypeLabel(blockItem.type)}</span>
          <span className="note-conflict__block-summary">
            {blockItem.summary !== ''
              ? blockItem.summary
              : /* RIEN DE LISIBLE DANS LES ATTRIBUTS — deux images collées, deux
                   séparateurs, deux blocs de code identiques. Sans repère, les
                   deux panneaux se ressemblent trait pour trait et personne ne
                   sait lequel il vient de choisir. Le rang du bloc DANS SON
                   DOCUMENT est le seul repère qui reste, et il suffit à les
                   distinguer. */
                t('notes.conflict.blockAtPosition', {
                  position: blockItem.index + 1,
                  defaultValue: 'nothing readable to show — block {{position}}',
                })}
          </span>
        </p>
      );
    };

    const renderSide = (blocks: readonly DiffBlock[], prefix: string): React.ReactNode =>
      blocks.length === 0 ? (
        <p className="note-conflict__block note-conflict__block--none">
          {t('notes.conflict.nothing', '(nothing here)')}
        </p>
      ) : (
        blocks.map((blockItem, index) => renderBlock(blockItem, `${prefix}-${index}`))
      );

    const renderCommon = (hunk: DiffHunk): React.ReactNode => {
      const blocks = hunk.mine;
      if (blocks.length === 0) return null;
      // Une longue traversée inchangée noie les différences : on n'en montre que
      // les deux bouts, et le bouton dit combien de blocs il cache.
      const long = blocks.length > COMMON_FOLD_THRESHOLD;
      const open = !long || !!unfolded[hunk.id];
      return (
        <div className="note-conflict__common" key={hunk.id}>
          {renderBlock(blocks[0], `${hunk.id}-0`)}
          {long && (
            <button
              type="button"
              className="note-conflict__fold"
              aria-expanded={open}
              onClick={() => setUnfolded((prev) => ({ ...prev, [hunk.id]: !prev[hunk.id] }))}
            >
              {open
                ? t('notes.conflict.unchangedHide', {
                    count: blocks.length - 2,
                    defaultValue: 'Hide {{count}} unchanged block(s)',
                  })
                : t('notes.conflict.unchanged', {
                    count: blocks.length - 2,
                    defaultValue: 'Show {{count}} unchanged block(s)',
                  })}
            </button>
          )}
          {open
            ? blocks
                .slice(1)
                .map((blockItem, index) => renderBlock(blockItem, `${hunk.id}-${index + 1}`))
            : renderBlock(blocks[blocks.length - 1], `${hunk.id}-last`)}
        </div>
      );
    };

    /** Une décision : deux panneaux, deux boutons, un état affiché. */
    const renderDecision = (
      id: string,
      index: number,
      heading: string,
      mineSide: React.ReactNode,
      theirsSide: React.ReactNode,
      allowBoth: boolean
    ): React.ReactNode => {
      const chosen = choices[id];
      return (
        <section
          key={id}
          className={`note-conflict__diff${chosen ? ' note-conflict__diff--decided' : ''}`}
          role="group"
          aria-labelledby={`${idPrefix}-${id}-heading`}
          tabIndex={-1}
          ref={(element) => registerSection(id, element)}
          onFocus={() => {
            cursor.current = index;
          }}
          {...(index === 0 ? { 'data-autofocus': true } : {})}
        >
          <header className="note-conflict__diff-head">
            <h4 className="note-conflict__diff-title" id={`${idPrefix}-${id}-heading`}>
              {heading}
            </h4>
            <span className={`note-conflict__state${chosen ? ' note-conflict__state--done' : ''}`}>
              {chosen === 'mine'
                ? t('notes.conflict.chosenMine', 'Your version kept')
                : chosen === 'theirs'
                  ? t('notes.conflict.chosenTheirs', 'The other version kept')
                  : chosen === 'both'
                    ? t('notes.conflict.chosenBoth', 'Both kept, one after the other')
                    : t('notes.conflict.pending', 'Not chosen yet')}
            </span>
          </header>
          <div className="note-conflict__panes">
            {(['mine', 'theirs'] as const).map((side) => {
              const action =
                side === 'mine'
                  ? t('notes.conflict.useMine', 'Use your version')
                  : t('notes.conflict.useTheirs', 'Use the other version');
              return (
                <div
                  key={side}
                  className={`note-conflict__pane note-conflict__pane--${side}${
                    chosen === side ? ' note-conflict__pane--chosen' : ''
                  }`}
                >
                  <div className="note-conflict__pane-body">
                    {side === 'mine' ? mineSide : theirsSide}
                  </div>
                  <Button
                    variant={chosen === side ? 'primary' : 'secondary'}
                    size="sm"
                    aria-pressed={chosen === side}
                    // Le nom accessible RAPPELLE de quelle différence il s'agit —
                    // sinon la liste des boutons répète vingt fois la même phrase —
                    // et contient le libellé visible mot pour mot (WCAG 2.5.3).
                    aria-label={`${heading} — ${action}`}
                    onClick={() => onChoose(id, side, index, total)}
                    disabled={disabled}
                  >
                    {action}
                  </Button>
                </div>
              );
            })}
          </div>
          {allowBoth && (
            // LA SEULE ISSUE QUI NE JETTE RIEN. Les blocs qui divergent entre deux
            // zones communes sont regroupés en une décision : deux changements
            // sans rapport — un paragraphe réécrit d'un côté, une image ajoutée de
            // l'autre — arrivent ensemble, et sans ce bouton il faudrait sacrifier
            // un versant entier, définitivement.
            <div className="note-conflict__both">
              <Button
                variant={chosen === 'both' ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={chosen === 'both'}
                aria-label={`${heading} — ${t('notes.conflict.useBoth', 'Keep both, one after the other')}`}
                onClick={() => onChoose(id, 'both', index, total)}
                disabled={disabled}
              >
                {t('notes.conflict.useBoth', 'Keep both, one after the other')}
              </Button>
            </div>
          )}
        </section>
      );
    };

    // L'index d'affichage suit `plan.decisionIds` — c'est LUI qui numérote, et
    // c'est le même ordre que le parcours clavier.
    const indexOf = (id: string): number => decisionIds.indexOf(id);

    /**
     * L'aperçu de repli : les blocs retenus, dans l'ordre du document.
     *
     * Calculé à chaque rendu, sans mémo : il ne fait que re-parcourir des blocs
     * déjà en mémoire, et un mémo l'aurait fait dépendre de `renderBlock`, une
     * fonction reconstruite à chaque rendu — donc d'un mémo qui ne mémorise rien.
     */
    const fallbackPreview = ((): React.ReactNode => {
      if (!comparison.comparable) return null;
      let seen = titleRow ? 0 : -1;
      return comparison.hunks.map((hunk) => {
        if (hunk.kind === 'common') {
          return (
            <div key={hunk.id}>
              {hunk.mine.map((blockItem, index) => renderBlock(blockItem, `p-${hunk.id}-${index}`))}
            </div>
          );
        }
        seen += 1;
        const side = choices[hunk.id];
        if (side === undefined) {
          return (
            <p className="note-conflict__preview-pending" key={hunk.id}>
              {t('notes.conflict.previewPending', {
                index: seen + 1,
                defaultValue: 'Difference {{index}} — not chosen yet',
              })}
            </p>
          );
        }
        const blocks =
          side === 'both'
            ? [...hunk.mine, ...hunk.theirs]
            : side === 'theirs'
              ? hunk.theirs
              : hunk.mine;
        return (
          <div key={hunk.id} className="note-conflict__preview-chosen">
            {blocks.length === 0 ? (
              <p className="note-conflict__block note-conflict__block--none">
                {t('notes.conflict.nothing', '(nothing here)')}
              </p>
            ) : (
              blocks.map((blockItem, index) => renderBlock(blockItem, `p-${hunk.id}-${index}`))
            )}
          </div>
        );
      });
    })();

    return (
      <>
        <p className="note-conflict__hint">
          {t('notes.conflict.keyboardHint', 'Alt + ↓ and Alt + ↑ move between differences.')}
        </p>

        <div className="note-conflict__diffs" onKeyDown={onKeyDown}>
          {titleRow &&
            renderDecision(
              TITLE_DECISION,
              indexOf(TITLE_DECISION),
              t('notes.conflict.titleRow', {
                index: indexOf(TITLE_DECISION) + 1,
                total,
                defaultValue: 'Difference {{index}} of {{total}} — Title',
              }),
              <p className="note-conflict__block">{titleRow.mine}</p>,
              <p className="note-conflict__block">{titleRow.theirs}</p>,
              false
            )}

          {!comparison.comparable
            ? wholeRow &&
              renderDecision(
                WHOLE_DECISION,
                indexOf(WHOLE_DECISION),
                t('notes.conflict.wholeRow', 'Whole document'),
                wholeRow.mine,
                wholeRow.theirs,
                false
              )
            : comparison.hunks.map((hunk) => {
                if (hunk.kind === 'common') return renderCommon(hunk);
                const index = indexOf(hunk.id);
                return renderDecision(
                  hunk.id,
                  index,
                  t('notes.conflict.hunkLabel', {
                    index: index + 1,
                    total,
                    defaultValue: 'Difference {{index}} of {{total}}',
                  }),
                  renderSide(hunk.mine, `${hunk.id}-mine`),
                  renderSide(hunk.theirs, `${hunk.id}-theirs`),
                  // « Garder les deux » n'a de sens que là où les deux côtés ont
                  // quelque chose : sur un ajout ou un retrait pur, l'un des
                  // panneaux est vide et concaténer ne dirait rien de plus.
                  hunk.kind === 'changed'
                );
              })}

          {comparison.comparable && comparison.differences === 0 && !titleRow && (
            <p className="note-conflict__notice note-conflict__notice--calm">
              {t('notes.conflict.noDifference', 'The two documents hold exactly the same blocks.')}
            </p>
          )}
        </div>

        {total > 0 && (
          <section className="note-conflict__preview" aria-labelledby={`${idPrefix}-preview`}>
            <h4 className="note-conflict__preview-title" id={`${idPrefix}-preview`}>
              {t('notes.conflict.preview', 'Result')}
            </h4>
            <div className="note-conflict__preview-body">{preview ?? fallbackPreview}</div>
          </section>
        )}
      </>
    );
  }
);

export default BlockMergeView;
