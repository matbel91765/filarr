/**
 * PluginEditorShell — la coquille plein écran des éditeurs de greffon.
 *
 * PRÉSENTATION PURE, ET C'EST LA CONDITION DE SON EXISTENCE. Deux hôtes très
 * différents s'en servent : celui des fichiers personnels (écriture par
 * l'adaptateur de stockage, dernière écriture gagnante) et celui des coffres
 * (verrou de version, conflit arbitré, salle de collaboration). Aucun de ces
 * deux mondes n'entre ici : la coquille ne sait ni enregistrer, ni renommer,
 * ni résoudre un conflit. Elle reçoit un état à montrer et des gestes à
 * relayer. Toute logique qui remonterait ici devrait être écrite deux fois
 * — ou, pire, une fois avec des `if` sur le monde d'en dessous.
 *
 * CE QU'ELLE REMPLACE. Un `Modal size="xl"` de 1000 px sur 70 % de hauteur,
 * avec QUATRE barres empilées (en-tête et pied de la fenêtre, barre d'outils
 * et pied du greffon) et trois zones de défilement imbriquées. Ici : UNE barre
 * de 48 px, et une scène dont le seul défileur est le porteur de page du
 * greffon.
 *
 * ── LE PIÈGE, ET LA RÈGLE QUI EN SORT ─────────────────────────────────────
 * L'hôte des coffres REMONTE le greffon quand la salle bascule en vie
 * (`collabLive`) : son effet de montage détruit l'instance et la reconstruit
 * dans le conteneur. Ce conteneur DOIT donc rester le MÊME nœud React d'un
 * rendu à l'autre — sinon React en crée un neuf, l'effet de montage garde une
 * référence vers l'ancien (détaché), et l'éditeur monte dans le vide.
 *
 * D'où deux interdits tenus par la structure même de ce fichier :
 *  · le conteneur n'est JAMAIS rendu conditionnellement — ni bandeau, ni
 *    chargement, ni erreur ne le fait disparaître ;
 *  · les états transitoires (lecture en cours, déchiffrement impossible) sont
 *    des VOILES posés PAR-DESSUS, jamais des remplacements.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './PluginEditorShell.css';

/** L'état d'enregistrement, tel que la pastille le dit. */
export type PluginEditorSaveState = 'synced' | 'saving' | 'pending' | 'error';

export interface PluginEditorShellProps {
  /** Le nom COMPLET du fichier, extension comprise. Le titre en dérive. */
  fileName: string;
  /**
   * Renommer. Reçoit le nom COMPLET reconstruit (l'extension d'origine est
   * préservée par la coquille : l'utilisateur ne modifie que le nom lisible,
   * et ne peut pas transformer un `.fdoc` en autre chose par inadvertance).
   * Absent ⇒ le titre est en lecture seule.
   */
  onRenameTitle?: (nextFileName: string) => void;
  /** Un renommage est en vol : le champ se fige plutôt que de mentir. */
  renaming?: boolean;
  /** Le retour — l'hôte décide de confirmer ou non (document modifié). */
  onRequestClose: () => void;
  /** L'état montré par la pastille. */
  saveState: PluginEditorSaveState;
  /** La précision sous la pastille (« Enregistré à 14:03 »), en info-bulle. */
  saveHint?: string | null;
  /** Ctrl/Cmd+S — la sauvegarde DEMANDÉE. Absent ⇒ raccourci inactif. */
  onUserSave?: () => void;
  /** Les bandeaux de l'hôte, en haut de la scène (voir le CSS). */
  banners?: React.ReactNode;
  /** Le voile d'état : chargement, échec de lecture. Recouvre, ne remplace pas. */
  veil?: React.ReactNode;
  /** Le voile annonce-t-il un échec ? (couleur seule ; le texte reste roi.) */
  veilIsError?: boolean;
  /** Les actions de droite : présence de la salle, bouton Enregistrer… */
  children?: React.ReactNode;
  /** Le conteneur du greffon — NŒUD STABLE, voir l'en-tête. */
  containerRef: React.RefObject<HTMLDivElement>;
  /**
   * L'identifiant que la FENÊTRE désigne par `aria-labelledby`.
   *
   * POURQUOI IL VIENT DE L'HÔTE. La coquille remplace un `ModalHeader`, et
   * avec lui le seul titre que `Modal` savait annoncer : sans cette poignée,
   * la fenêtre plein écran s'ouvrirait ANONYME pour une synthèse vocale. Le
   * champ de titre ne peut pas jouer ce rôle — un `input` nomme rarement bien
   * la boîte qui le contient, et son étiquette est déjà « Nom du document ».
   * L'hôte engendre donc l'identifiant (`useId`), le passe à `Modal` ET ici :
   * les deux bouts se rejoignent sur un élément qui existe.
   */
  titleId?: string;
}

/**
 * Découper un nom de fichier en (nom lisible, extension).
 *
 * POURQUOI L'EXTENSION RESTE HORS DU CHAMP. Un titre éditable qui contient
 * « .fdoc » invite à l'effacer, et un `.fdoc` renommé en `rapport` n'est plus
 * ouvert par aucun éditeur : le document devient un fichier opaque que
 * l'utilisateur croit avoir simplement renommé. L'extension est donc affichée
 * hors du champ, et recollée au commit.
 */
export const splitFileName = (name: string): { base: string; ext: string } => {
  const point = name.lastIndexOf('.');
  // Un point en tête (`.gitignore`) n'est pas une extension : c'est le nom.
  if (point <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, point), ext: name.slice(point) };
};

const IconeRetour: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
  </svg>
);

export const PluginEditorShell: React.FC<PluginEditorShellProps> = ({
  fileName,
  onRenameTitle,
  renaming = false,
  onRequestClose,
  saveState,
  saveHint,
  onUserSave,
  banners,
  veil,
  veilIsError = false,
  children,
  containerRef,
  titleId,
}) => {
  const { t } = useTranslation();
  const { base, ext } = splitFileName(fileName);
  const [draft, setDraft] = useState(base);
  const shellRef = useRef<HTMLDivElement | null>(null);
  /** Ref miroir du geste « enregistrer » — voir l'effet de Ctrl+S plus bas. */
  const onUserSaveRef = useRef(onUserSave);
  onUserSaveRef.current = onUserSave;

  /**
   * Le brouillon suit le nom que l'HÔTE affiche — et lui seul.
   *
   * Le seul moment où `fileName` change, c'est après un renommage accepté par
   * l'hôte ; le brouillon doit alors adopter le nom retenu (l'hôte a pu le
   * normaliser, ou refuser et rester sur l'ancien). Sans cet effet, un
   * renommage refusé laisserait à l'écran un titre que le fichier ne porte pas.
   */
  useEffect(() => {
    setDraft(splitFileName(fileName).base);
  }, [fileName]);

  const commitTitle = useCallback(() => {
    if (!onRenameTitle) return;
    const propre = draft.trim();
    // Rien à faire, ou un nom vide : on revient au nom réel sans rien demander.
    if (!propre || propre === base) {
      setDraft(base);
      return;
    }
    onRenameTitle(`${propre}${ext}`);
  }, [draft, base, ext, onRenameTitle]);

  /**
   * Ctrl/Cmd+S sur la coquille entière — le greffon ne l'intercepte pas (il ne
   * connaît que Ctrl+K et Ctrl+F) et l'événement remonte jusqu'ici depuis le
   * texte. `preventDefault` parce que la commande d'enregistrement du
   * navigateur, dans une application, n'a aucun sens.
   */
  useEffect(() => {
    const racine = shellRef.current;
    if (!racine) return undefined;
    const surTouche = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key !== 's' && e.key !== 'S')) return;
      const sauver = onUserSaveRef.current;
      if (!sauver) return;
      e.preventDefault();
      sauver();
    };
    racine.addEventListener('keydown', surTouche);
    return () => racine.removeEventListener('keydown', surTouche);
    // Aucune dépendance : l'abonnement doit survivre à CHAQUE frappe. Les
    // hôtes reconstruisent leur gestionnaire à chaque rendu (il lit `dirty`,
    // `conflictPending`…), donc le dépendre poserait et retirerait l'écouteur
    // des centaines de fois par minute d'écriture. La ref miroir ci-dessus le
    // garde à jour sans re-souscrire.
  }, []);

  const etats: Record<PluginEditorSaveState, string> = {
    synced: t('pluginEditorShell.saveSynced', 'Enregistré'),
    saving: t('pluginEditorShell.saveSaving', 'Enregistrement…'),
    pending: t('pluginEditorShell.savePending', 'Modifications en attente'),
    error: t('pluginEditorShell.saveError', "Échec de l'enregistrement"),
  };
  const etatLabel = etats[saveState];

  return (
    <div className="plugin-editor-shell" ref={shellRef}>
      {/* Le nom de la FENÊTRE, pour qui ne voit pas la barre. Il double le
          champ de titre — qui, lui, est un contrôle et non un intitulé. */}
      {titleId ? (
        <h2 id={titleId} className="sr-only">
          {fileName}
        </h2>
      ) : null}
      {/* `chrome-safe-bar` : la barre COUVRE la bande native et lui réserve
          ses deux bords — boutons de fenêtre à droite sous Windows/Linux,
          feux à gauche sous macOS. Les boutons de l'OS se posent donc dans
          une portion VIDE de cette barre, et aucune commande de l'hôte
          (« Enregistrer », pastille de présence) ne vient à leur contact. */}
      <div className="plugin-editor-shell__bar chrome-safe-bar">
        <button
          type="button"
          className="plugin-editor-shell__back"
          onClick={onRequestClose}
          aria-label={t('pluginEditorShell.back', 'Revenir')}
          title={t('pluginEditorShell.back', 'Revenir')}
        >
          <IconeRetour />
        </button>

        <div className="plugin-editor-shell__identity">
          <input
            className="plugin-editor-shell__title"
            value={draft}
            // Un titre sans `onRenameTitle` n'est pas « désactivé » : il est en
            // lecture. `readOnly` le laisse sélectionnable et lisible par une
            // synthèse vocale, là où `disabled` le sortirait de l'ordre de
            // tabulation et le peindrait en gris d'inactivité.
            readOnly={!onRenameTitle || renaming}
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                return;
              }
              if (e.key === 'Escape') {
                // Abandonner la saisie ne doit PAS fermer l'éditeur : on arrête
                // la touche ici, sinon la fenêtre l'entend et se referme sur un
                // document ouvert.
                e.preventDefault();
                e.stopPropagation();
                setDraft(base);
                e.currentTarget.blur();
              }
            }}
            aria-label={t('pluginEditorShell.titleLabel', 'Nom du document')}
            title={fileName}
          />

          <span
            className={`plugin-editor-shell__save plugin-editor-shell__save--${saveState}`}
            role="status"
            aria-live="polite"
            title={saveHint || etatLabel}
          >
            <span
              className={`plugin-editor-shell__save-dot plugin-editor-shell__save-dot--${saveState}`}
              aria-hidden="true"
            />
            <span className="plugin-editor-shell__save-label">{saveHint || etatLabel}</span>
          </span>
        </div>

        <div className="plugin-editor-shell__actions">{children}</div>
      </div>

      <div className="plugin-editor-shell__stage">
        {/* Le porte-bandeaux est TOUJOURS rendu — jamais conditionnel.
            Un hôte passe volontiers un fragment dont toutes les branches sont
            fausses (« bandeau si conflit, bandeau si trop gros… ») : un test
            de vérité sur cette prop ferait apparaître un cadre vide. C'est
            `:empty` qui l'efface, en CSS, sur le DOM réellement produit. */}
        <div className="plugin-editor-shell__banners">{banners}</div>

        <div className="plugin-editor-shell__mount">
          {/* LE nœud stable. Jamais conditionnel — voir l'en-tête du fichier. */}
          <div ref={containerRef} className="plugin-editor-shell__container" />
          {veil ? (
            <div
              className={`plugin-editor-shell__veil${
                veilIsError ? ' plugin-editor-shell__veil--error' : ''
              }`}
              role={veilIsError ? 'alert' : 'status'}
            >
              {veil}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default PluginEditorShell;
