/**
 * VaultNotesSection — les notes des coffres partagés, DANS l'onglet Notes mais
 * PAS mélangées aux notes locales.
 *
 * LA FORME EST UNE DÉCISION, pas un raccourci d'implémentation. Une section à
 * part, repliable, groupée par coffre, sous les notes personnelles. Fondre ces
 * notes dans la liste principale aurait été plus court à écrire et faux : une
 * note de coffre ne vit pas sur ce disque, ne se cherche pas de la même façon,
 * ne s'exporte pas avec les autres, et surtout appartient à d'autres personnes
 * autant qu'à soi. Le mélange aurait fait croire l'inverse à chaque coup d'œil.
 *
 * CE QUE LA SECTION NE FAIT PAS ENTRER DANS LE LOCAL. Elle ne dépose RIEN dans
 * `notesSlice`. C'est ce qui la tient hors de la recherche globale, du graphe,
 * des modèles, du panneau des étiquettes et des raccourcis clavier : tous
 * lisent le magasin des notes, et ce qui n'y est pas ne peut pas y être ramassé
 * par accident. Les lignes affichées ici sont dérivées à la volée de
 * `vaultsSlice` et jetées au démontage.
 *
 * RÈGLE 13 — HORS NUAGE, RIEN DE TOUT CELA N'EXISTE. Trois conditions, et
 * l'absence de l'une rend `null` : un compte nuage, le droit aux coffres
 * d'équipe, et au moins un coffre. Pas de section vide, pas de section grisée,
 * pas d'appel du pied vers une offre — rien.
 *
 * CE QUI NE SE DÉCHIFFRE PAS NE SE DEVINE PAS. Le verdict de chaque groupe est
 * rendu par `buildVaultNotesSection` (pur, éprouvé) : un coffre verrouillé, une
 * époque de clé en retard, une liste pas encore lue et des métas illisibles
 * disent chacun leur phrase. « Aucune note » n'est écrit que sur un coffre
 * ouvert, lu et intégralement déchiffré.
 *
 * LE COÛT EST GARDÉ PAR LE REPLI. Afficher les notes d'un coffre suppose d'avoir
 * DÉCHIFFRÉ sa liste d'éléments. On ne la demande donc que pour les coffres
 * ouverts, et seulement quand la section est DÉPLIÉE — sans quoi ouvrir l'onglet
 * Notes déchiffrerait la liste de tous les coffres de quelqu'un qui ne regarde
 * que ses notes à lui. Le repli est retenu par profil, pour la même raison.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { AppDispatch, RootState } from '../../../store';
import { loadVaultItems } from '../../../store/slices/vaultsSlice';
import { selectCanUseTeamVaults } from '../../../store/selectors/authSelectors';
import { buildVaultNotesSection } from '../vaults/vaultNotesSection';
import type { VaultNotesGroup } from '../vaults/vaultNotesSection';
import { declareVaultsListed } from '../../../services/vault/vaultListedElsewhere';
import { vaultNoteDestination } from './noteShareNavigation';
import * as profileStorage from '../../../services/core/profileStorage';

/** Le repli est une préférence d'écran : retenue PAR PROFIL, comme le tri. */
const COLLAPSE_KEY = 'filarr-notes-vault-section-collapsed';

function loadCollapsed(): boolean {
  // Replié par DÉFAUT. Le déplié coûte un déchiffrement de liste par coffre
  // ouvert : c'est un prix qu'on ne fait payer qu'à qui a demandé à voir.
  return profileStorage.getItemWithLegacyFallback(COLLAPSE_KEY) !== '0';
}

const ChevronIcon: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s',
    }}
  >
    <path d="M8 5l8 7-8 7z" />
  </svg>
);

const VaultIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 9V7M12 17v-2" strokeLinecap="round" />
  </svg>
);

const NoteLineIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);

/** La date de modification, dans la langue courante, sans heure. */
function formatDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * Ce qu'un groupe dit quand il n'a aucune ligne à montrer.
 *
 * Chaque état a SA phrase, et c'est tout l'objet de ce composant : la faute
 * qu'on ferme est le « aucune note » rendu pour un silence. Le vocabulaire est
 * celui qui existe déjà pour l'explorateur de coffre — pas un second jeu de
 * mots qui dirait la même chose autrement.
 */
const GroupEmptyState: React.FC<{ group: VaultNotesGroup; onRetry: (vaultId: string) => void }> = ({
  group,
  onRetry,
}) => {
  const { t } = useTranslation();
  switch (group.state) {
    case 'locked':
      return (
        <div className="notes-list__vault-note-hint" title={t('teamVaults.lockedHint')}>
          {t('teamVaults.lockedTitle')}
        </div>
      );
    case 'stale-epoch':
      return (
        <div className="notes-list__vault-note-hint" title={t('teamVaults.staleEpochHint')}>
          {t('teamVaults.staleEpochTitle')}
        </div>
      );
    case 'loading':
      // Trois points qui respirent, et non un texte fige : un chargement qui
      // ne bouge pas est indiscernable d'un chargement bloque -- ce qui est
      // exactement le doute que ce bloc vient de coûter.
      return (
        <div className="notes-list__vault-note-hint vault-loading">
          <span className="vault-loading__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {t('teamVaults.notesSection.loading')}
        </div>
      );
    case 'failed':
      /**
       * ⚠ L'ETAT QUI MANQUAIT, ET LE PLUS IMPORTANT DES SEPT.
       *
       * Sans lui, un chargement qui echoue restait « en cours » pour toujours :
       * le coffre n'entrait jamais dans `itemsByVault`, et l'ecran deduisait
       * « en chargement » de cette seule absence.
       *
       * Il porte une REPRISE, parce qu'un aveu sans geste n'est qu'un reproche :
       * la cause la plus frequente (un reseau parti puis revenu) se repare d'un
       * clic, et obliger a recharger toute la page pour ca serait absurde.
       */
      return (
        <div className="notes-list__vault-note-hint vault-failed" role="alert">
          <span>{t('teamVaults.notesSection.failed')}</span>
          <button
            type="button"
            className="vault-failed__retry"
            onClick={() => onRetry(group.vaultId)}
          >
            {t('teamVaults.notesSection.retry')}
          </button>
        </div>
      );
    case 'undecryptable':
      // Le coffre n'est PAS vide : on ne sait simplement pas le lire. Écrire
      // « aucune note » ici ferait refermer la section pour de bon.
      return (
        <div className="notes-list__vault-note-hint" role="alert">
          {t('teamVaults.decryptWarning', { count: group.undecryptable })}
        </div>
      );
    default:
      return (
        <div className="notes-list__vault-note-hint">{t('teamVaults.notesSection.empty')}</div>
      );
  }
};

export const VaultNotesSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const loadFailureByVault = useSelector((s: RootState) => s.vaults.loadFailureByVault);

  /**
   * Reprendre un chargement qui a echoue.
   *
   * `loadVaultItems.pending` efface l'aveu : l'ecran repasse donc en
   * « chargement » des le clic, sans qu'on ait a le piloter ici.
   */
  const retryVault = useCallback(
    (vaultId: string) => {
      void dispatch(loadVaultItems({ vaultId }));
    },
    [dispatch]
  );
  const navigate = useNavigate();

  const canUseTeamVaults = useSelector(selectCanUseTeamVaults);
  const cloudUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const vaultsById = useSelector((s: RootState) => s.vaults.vaults);
  const vaultIds = useSelector((s: RootState) => s.vaults.vaultIds);
  const unlockedVaultIds = useSelector((s: RootState) => s.vaults.unlockedVaultIds);
  const itemsByVault = useSelector((s: RootState) => s.vaults.itemsByVault);
  const decryptStatusByVault = useSelector((s: RootState) => s.vaults.decryptStatusByVault);

  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const untitled = t('teamVaults.items.untitled');

  const section = useMemo(() => {
    const unlocked = new Set(unlockedVaultIds);
    return buildVaultNotesSection({
      vaults: vaultIds
        .map((id) => vaultsById[id])
        .filter((v): v is NonNullable<typeof v> => !!v)
        .map((v) => ({
          vaultId: v.id,
          name: v.name,
          unlocked: unlocked.has(v.id),
          currentKeyEpoch: v.currentKeyEpoch,
          wrappedVaultKeyEpoch: v.wrappedVaultKeyEpoch,
        })),
      itemsByVault,
      /**
       * « CHARGÉ » = LA CLÉ EXISTE, pas « le tableau est non vide ». C'est la
       * seule façon de distinguer un coffre dont la réponse n'est pas revenue
       * d'un coffre réellement vide — `loadVaultItems.fulfilled` pose la clé,
       * fût-ce sur un tableau vide.
       */
      loadedVaultIds: Object.keys(itemsByVault),
      // Les coffres dont la DERNIERE tentative a echoue. Sans cette entree, un
      // echec est indiscernable d'un chargement qui dure : dans les deux cas le
      // coffre est simplement absent de `itemsByVault`.
      failedVaultIds: Object.keys(loadFailureByVault),
      decryptStatusByVault,
      untitledLabel: untitled,
    });
  }, [vaultIds, vaultsById, unlockedVaultIds, itemsByVault, decryptStatusByVault, untitled]);

  /**
   * LES COFFRES QUE CETTE SECTION AFFICHE VRAIMENT — dépliée, et ouverts.
   *
   * Cette liste sert à deux choses, et à rien d'autre : demander la liste
   * d'éléments qui manque, et déclarer au guetteur ce qu'il doit tenir à jour.
   * Repliée, elle est vide : la section n'affiche rien, donc ne coûte rien.
   */
  const shownVaultIds = useMemo(() => {
    if (collapsed) return [];
    const unlocked = new Set(unlockedVaultIds);
    return section.groups.map((g) => g.vaultId).filter((id) => unlocked.has(id));
  }, [collapsed, section.groups, unlockedVaultIds]);

  // Clé stable : `shownVaultIds` est un tableau neuf à chaque rendu, et le
  // mettre tel quel en dépendance relancerait les deux effets sans fin.
  const shownKey = shownVaultIds.join(',');

  /**
   * CE QUI EST DÉJÀ CHARGÉ, lu dans une ref plutôt qu'en dépendance.
   *
   * `itemsByVault` change à CHAQUE arrivée de liste. Le mettre en dépendance de
   * l'effet ci-dessous le ferait tourner une fois par coffre servi, pour
   * re-parcourir les mêmes identifiants et ne rien demander de plus — et
   * surtout, cela reviendrait à faire dépendre une DEMANDE de sa propre
   * RÉPONSE. La ref dit « qu'ai-je déjà ? » sans réveiller personne.
   */
  const chargesRef = useRef(itemsByVault);
  useEffect(() => {
    chargesRef.current = itemsByVault;
  });

  /**
   * Aller chercher ce qui manque — UNE fois par coffre. La suite est tenue par
   * le guetteur (`VaultHeadsWatcher`), qui ne relit que sur un changement de
   * révision : rien ici ne sonde en boucle.
   */
  useEffect(() => {
    if (!shownKey) return;
    for (const vaultId of shownKey.split(',')) {
      if (!chargesRef.current[vaultId]) void dispatch(loadVaultItems({ vaultId }));
    }
  }, [shownKey, dispatch]);

  /**
   * DÉCLARER AU GUETTEUR ce que cette section liste, pour qu'une note ajoutée
   * par un autre membre y apparaisse sans rechargement. Le retrait au démontage
   * (et au repli) est ce qui empêche le guetteur de devenir un déchiffrement
   * perpétuel de listes que plus personne ne regarde.
   */
  useEffect(() => {
    if (!shownKey) return () => {};
    return declareVaultsListed(shownKey.split(','));
  }, [shownKey]);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      profileStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const openNote = useCallback(
    (vaultId: string, itemId: string) => {
      // L'adresse vient de `noteShareNavigation`, seul endroit qui traduit un
      // élément de coffre en route — et elle porte l'intention d'OUVRIR, si
      // bien que l'explorateur monte `VaultNoteEditor` (donc la salle
      // collaborative) au lieu de simplement surligner la carte.
      navigate(vaultNoteDestination(vaultId, itemId));
    },
    [navigate]
  );

  // RÈGLE 13, tenue ici et pas dans le modèle pur : hors nuage, sans le droit,
  // ou sans le moindre coffre, cette section n'existe pas du tout.
  if (!cloudUserId || !canUseTeamVaults || !section.hasSection) return null;

  return (
    <div className="notes-list__pinned notes-list__vault-notes">
      <div className="notes-list__pinned-header">
        <button
          className="notes-list__pinned-toggle"
          onClick={toggle}
          aria-expanded={!collapsed}
          title={t('teamVaults.notesSection.title')}
        >
          <ChevronIcon open={!collapsed} />
          <VaultIcon />
          <span>{t('teamVaults.notesSection.title')}</span>
          {!collapsed && <span className="notes-list__pinned-count">{section.noteCount}</span>}
        </button>
      </div>
      {!collapsed && (
        <div className="notes-list__pinned-list">
          {section.groups.map((group) => (
            <div key={group.vaultId} className="notes-list__vault-group">
              <div className="notes-list__vault-group-name">
                {/* Un nom vide veut dire « pas ouvert » : le nom du coffre est
                    chiffré sous sa clé. On le DIT plutôt que de laisser un
                    espace blanc que personne ne saurait interpréter. */}
                {group.vaultName.trim() || t('teamVaults.locked')}
              </div>
              {group.rows.length === 0 ? (
                <GroupEmptyState group={group} onRetry={retryVault} />
              ) : (
                <>
                  {group.rows.map((row) => (
                    <div
                      key={row.itemId}
                      className="notes-list__pinned-item"
                      onClick={() => openNote(row.vaultId, row.itemId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openNote(row.vaultId, row.itemId);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="notes-list__pinned-item-icon">
                        <NoteLineIcon />
                      </span>
                      <span className="notes-list__pinned-item-title">{row.title}</span>
                      <span className="notes-list__vault-note-date">
                        {formatDate(row.updatedAt, i18n.language)}
                      </span>
                    </div>
                  ))}
                  {/* Des notes lisibles ET des métas qui résistent : on montre
                      les unes SANS taire les autres. */}
                  {group.undecryptable > 0 && (
                    <div className="notes-list__vault-note-hint" role="alert">
                      {t('teamVaults.decryptWarning', { count: group.undecryptable })}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VaultNotesSection;
