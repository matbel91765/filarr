/**
 * Dossiers personnalisables — LA NOTE D'ACCUEIL.
 *
 * ── C'EST LE README D'UN DOSSIER ────────────────────────────────────────────
 *
 * De tout ce chantier, c'est la pièce qui apporte le plus : une couverture rend
 * un dossier reconnaissable, un bandeau le rend pratique, mais seule cette note
 * lui donne une INTENTION. « Ce dossier contient les contrats signés ; les
 * brouillons vont dans /Brouillons ; ne rien y supprimer avant l'archivage. »
 * Aucune arborescence ne dit ça, et c'est pourtant la première chose qu'on
 * voudrait savoir en l'ouvrant.
 *
 * ── EN LECTURE, TOUJOURS ────────────────────────────────────────────────────
 *
 * Le rendu est celui de `VersionRender`, l'afficheur en LECTURE SEULE déjà
 * utilisé par l'historique des versions et bâti sur `buildSharedNoteExtensions` —
 * le même jeu de nœuds que l'éditeur, donc rien ne disparaît silencieusement du
 * rendu. Monter un vrai éditeur ici aurait mis un piège à frappe au-dessus d'une
 * liste de fichiers : on clique pour sélectionner, on tape, et on a modifié une
 * note sans l'avoir demandé. Pour écrire, on ouvre la note — un clic, explicite.
 *
 * ── UNE NOTE ABSENTE N'EST PAS UNE NOTE SUPPRIMÉE ───────────────────────────
 *
 * Si l'attache désigne une note que le store ne connaît pas, l'attache est
 * CONSERVÉE et le pavé le dit. Les notes arrivent de façon asynchrone
 * (hydratation, changement de profil, synchronisation) : effacer l'attache
 * parce qu'une lecture est arrivée trop tôt détruirait le lien pour de bon, sur
 * tous les appareils, à la première ouverture d'un dossier hors ligne.
 */

import React from 'react';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

import { VersionRender } from '../notes/versioning/VersionRender';
import type { RootState } from '../../../store';
import './folder.css';

export interface FolderReadmeProps {
  noteId: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Ouvre la note dans l'éditeur — le SEUL chemin d'écriture. */
  onOpen: () => void;
  /** Détache la note du dossier (elle n'est pas supprimée). */
  onDetach?: () => void;
}

const ChevronIcon: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className={`folder-readme__chevron ${collapsed ? 'folder-readme__chevron--collapsed' : ''}`}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
  </svg>
);

export const FolderReadme: React.FC<FolderReadmeProps> = React.memo(function FolderReadme({
  noteId,
  collapsed,
  onToggleCollapsed,
  onOpen,
  onDetach,
}) {
  const { t } = useTranslation();
  const note = useSelector((state: RootState) => state.notes.byId[noteId]);

  // Une note d’accueil qui vient d’être créée n’a ni titre ni texte : elle se
  // présente comme ce qu’elle est, pas comme une note « Sans titre » dont le rendu
  // de versions dirait « Aucun contenu à afficher ».
  const title = note?.title || t('folder.readme.label', 'Note d’accueil');
  const isEmpty =
    !!note &&
    !(note.plainText ?? '').trim() &&
    !(typeof note.content === 'string' && /"text":\s*"[^"]/.test(note.content));

  return (
    <section className="folder-readme" aria-label={t('folder.readme.label', 'Note d’accueil')}>
      <div className="folder-readme__bar">
        <button
          type="button"
          className="folder-readme__toggle"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          title={
            collapsed
              ? t('folder.readme.expand', 'Déplier la note d’accueil')
              : t('folder.readme.collapse', 'Replier la note d’accueil')
          }
        >
          <ChevronIcon collapsed={collapsed} />
          <span className="folder-readme__title">{title}</span>
        </button>
        <div className="folder-readme__actions">
          <button type="button" className="folder-readme__action" onClick={onOpen}>
            {t('folder.readme.edit', 'Modifier')}
          </button>
          {onDetach && (
            <button type="button" className="folder-readme__action" onClick={onDetach}>
              {t('folder.readme.detach', 'Retirer')}
            </button>
          )}
        </div>
      </div>

      {!collapsed &&
        (note ? (
          isEmpty ? (
            <p className="folder-readme__missing">
              {t(
                'folder.readme.empty',
                'Cette note d’accueil est vide — Modifier pour écrire l’intention du dossier.'
              )}
            </p>
          ) : (
            <VersionRender
              className="folder-readme__body"
              content={note.content}
              plainTextFallback={note.plainText}
            />
          )
        ) : (
          <p className="folder-readme__missing">
            {t(
              'folder.readme.missing',
              'Cette note n’est pas disponible sur cet appareil pour le moment.'
            )}
          </p>
        ))}
    </section>
  );
});

export default FolderReadme;
