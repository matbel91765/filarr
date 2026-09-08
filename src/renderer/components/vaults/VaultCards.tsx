/**
 * VaultCards — la carte d'un coffre partagé, écrite UNE fois.
 *
 * Extraite de `VaultsList` (lot A, C2) parce qu'elle a désormais trois
 * consommateurs — la page des coffres, l'accueil (`SharedVaultsWidget`) et le
 * menu contextuel partagé — et qu'aucun d'eux n'a besoin d'emporter la page
 * entière (ses boîtes, sa corbeille, sa saisie de code) pour dessiner une carte.
 * Déplacement PUR : aucun comportement ne change ici.
 *
 * POURQUOI UNE CARTE MAISON PLUTÔT QUE `SubfolderCard` TELLE QUELLE.
 * `SubfolderCard` affiche invariablement « n élément(s) », comptés depuis
 * `items`. Un coffre non ouvert n'a AUCUN élément en mémoire : la carte
 * annoncerait « 0 element(s) » sur un coffre plein, ce qui est pire qu'un
 * silence. La sous-ligne porte donc à la place ce qu'on sait VRAIMENT — le
 * badge « Partagé » et le rôle. Tout le reste (géométrie, survol, cible de
 * menu, troncature) est repris à l'identique de la carte de l'explorateur.
 *
 * F14 — LE SIGNE DU COFFRE. Le cadenas n'est plus le seul glyphe possible :
 * un coffre peut porter un emoji, une icône et une couleur, choisis « pour tout
 * le monde » (dans l'enveloppe chiffrée du nom) ou « pour moi » (localStorage).
 * La fusion des deux portées est faite par `useVaultAppearance`, UNE fois pour
 * les cinq endroits qui dessinent ce glyphe — sans quoi il aurait suffi d'un
 * oubli pour qu'une carte montre l'emoji de l'équipe là où les autres montrent
 * celui qu'on s'est choisi. Un coffre que personne n'a personnalisé garde
 * EXACTEMENT le cadenas d'avant.
 *
 * F27 — LA DESCRIPTION COURTE. Une ligne, tronquée, sous le nom : ce que le
 * coffre EST, quand quelqu'un a pris la peine de l'écrire. Elle vient de l'index
 * en mémoire (`useVaultDescription`), jamais d'une requête : une carte ne
 * demande rien, c'est la règle depuis l'effectif partagé. Absente — parce qu'il
 * n'y en a pas, ou parce que cette session n'a pas encore lu ce coffre — la
 * ligne N'EXISTE PAS : réserver sa place ferait chercher un texte manquant, et
 * la rendre vide ferait sauter la hauteur des cartes d'un tour à l'autre.
 *
 * LOT A, C4 — L'ACCUEIL MÊLÉ. `VaultCardGrid` et `VaultRowList` sont les
 * cartes de coffre qui prennent place DANS la grille « Tous les dossiers »,
 * à la géométrie EXACTE de `FolderCardGrid` / `FolderRowList`
 * (FolderGridWidget) : même vignette de 120 px, même barre d'info, même
 * rangée de liste. Ce qu'elles n'ont PAS, et c'est voulu : aucun gestionnaire
 * de glisser-déposer — déposer sur un coffre est le geste CHIFFRANT
 * d'`AddToVaultDialog`, jamais un déplacement de dossier. Un coffre
 * verrouillé garde son cadenas et dit « verrouillé » ; il ne fait jamais
 * semblant d'être vide.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import type { RootState } from '../../../store';
import type { VaultSummary } from '../../../store/slices/vaultsSlice';
import { selectVaultMemberCount } from '../../../store/selectors/shareIndexSelectors';
import { SharedBadge } from '../files/SharedBadge';
import { VaultGlyph, vaultTintStyle } from './VaultGlyph';
import { useVaultAppearance } from './useVaultAppearance';
import { useVaultDescription } from './useVaultDescription';

const LockGlyph: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    className={className ?? 'w-5 h-5'}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z"
    />
  </svg>
);

/**
 * La sous-ligne d'un coffre — ce qu'on sait VRAIMENT : le badge « Partagé »,
 * l'effectif et le rôle. Écrite une fois pour les trois cartes.
 *
 * L'EFFECTIF est lu dans l'index des partages (« lire, jamais demander » :
 * c'est `VaultsBootstrapHost` qui charge les têtes, une requête pour toutes
 * les cartes). `undefined` tant qu'on ne sait pas — et alors la carte ne dit
 * RIEN plutôt qu'un « · 0 » faux ; hors nuage l'index reste vide, donc jamais
 * de compteur en mode local.
 */
const VaultBadges: React.FC<{ vault: VaultSummary }> = ({ vault }) => {
  const { t } = useTranslation();
  const memberCount = useSelector((s: RootState) => selectVaultMemberCount(s, vault.id));
  const roleLabel = t(`teamVaults.role.${vault.role}`, vault.role);
  const membersTitle =
    typeof memberCount === 'number'
      ? t('teamVaults.shareBadge.vaultMembers', {
          count: memberCount,
          role: roleLabel,
          defaultValue: `Coffre partagé avec ${memberCount} personne(s) — vous êtes ${roleLabel}`,
        })
      : undefined;
  return (
    <span className="flex items-center gap-1 mt-0.5 min-w-0 max-w-full overflow-hidden">
      {/* LE PARTAGE SE DIT EN SILHOUETTE, PAS EN MOT. « PARTAGÉ » + « · 2 » +
          « PROPRIÉTAIRE » ne tiennent PAS dans les ~145 px d'une carte de grille
          à cinq colonnes : le mot mangeait toute la place et le rôle — la seule
          chose qu'on ne peut pas deviner — se tronçonnait en « C… ». Le couple
          silhouette + effectif de `SharedBadge` dit la même chose en trois fois
          moins large, et laisse le rôle s'écrire en entier. */}
      {typeof memberCount === 'number' && memberCount >= 1 ? (
        <SharedBadge
          variant="inline"
          count={memberCount}
          title={membersTitle ?? ''}
          className="shrink-0"
        />
      ) : (
        /* Effectif inconnu (hors nuage, index pas encore chargé) : le mot
           reprend sa place — seul, il tient. Une carte sans aucun signe de
           partage se confondrait avec un dossier dans la grille mêlée. */
        <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide leading-none bg-[var(--color-primary-50)] text-[var(--color-primary-600)]">
          {t('home.sharedBadge', 'Partagé')}
        </span>
      )}
      {/* Le rôle cède en dernier recours seulement : tronqué il s'annonce
          (… + infobulle), là où l'`overflow-hidden` de la carte le coupait en
          plein glyphe, sans un mot. */}
      <span
        className="min-w-0 truncate text-[10px] uppercase tracking-wide leading-tight text-[var(--color-text-tertiary)]"
        title={roleLabel}
      >
        {roleLabel}
      </span>
    </span>
  );
};

/**
 * La description courte du coffre (F27), sur UNE ligne tronquée. Rend `null`
 * quand il n'y a rien à dire : pas de ligne vide, donc pas de saut de mise en
 * page entre un coffre décrit et un coffre qui ne l'est pas.
 *
 * UN `<span className="block">`, PAS UN `<p>`. Les trois cartes qui la posent
 * n'ont pas le même parent : la rangée de la liste l'enveloppe dans un `<span>`,
 * où un `<p>` est du contenu de FLUX dans du contenu de PHRASÉ — un modèle de
 * contenu HTML invalide, que l'analyseur du navigateur corrige en fermant le
 * `<span>` de force. Un `<span>` en `display: block` rend exactement la même
 * ligne, partout, sans rien casser.
 */
const VaultDescriptionLine: React.FC<{ vaultId: string; className?: string }> = ({
  vaultId,
  className,
}) => {
  const description = useVaultDescription(vaultId);
  if (!description) return null;
  return (
    <span
      className={`block text-[11px] text-[var(--color-text-tertiary)] truncate m-0 ${className ?? ''}`}
      title={description}
    >
      {description}
    </span>
  );
};

/** Trois points — le même dessin que sur les cartes de dossier. */
const MoreDotsGlyph: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    className="w-4 h-4 text-[var(--color-text-secondary)]"
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
    />
  </svg>
);

export interface VaultFolderCardProps {
  vault: VaultSummary;
  /** Le coffre a-t-il pu être déverrouillé ? Sinon, le nom n'est pas lisible. */
  unlocked: boolean;
  /** Le fil a bougé depuis le dernier « vu » — la pastille. */
  unseen?: boolean;
  /** La carte du coffre actuellement ouvert (page des coffres uniquement). */
  active?: boolean;
  onOpen: (vaultId: string) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>, vault: VaultSummary) => void;
}

export const VaultFolderCard: React.FC<VaultFolderCardProps> = ({
  vault,
  unlocked,
  unseen,
  active,
  onOpen,
  onContextMenu,
}) => {
  const { t } = useTranslation();
  const label = vault.name || t('teamVaults.locked');
  const appearance = useVaultAppearance(vault);
  return (
    <div
      data-item-id={vault.id}
      role="button"
      tabIndex={0}
      aria-current={active ? 'true' : undefined}
      onClick={() => onOpen(vault.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(vault.id);
        }
      }}
      onContextMenu={(e) => onContextMenu(e, vault)}
      className={`group relative flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer
      bg-[var(--color-surface)] border shadow-sm hover:border-[var(--color-primary-200)]
      select-none [contain:content] overflow-hidden transition-colors duration-150
      ${active ? 'border-[var(--color-primary-400)]' : 'border-[var(--color-border)]'}`}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}
    >
      <div
        className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--color-primary-50)] text-[var(--color-primary-500)]"
        style={vaultTintStyle(appearance)}
      >
        <VaultGlyph appearance={appearance} className="w-5 h-5 text-xl" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate m-0 flex items-center gap-1.5">
          {label}
          {/* Un coffre non déchiffrable garde son cadenas : la carte dit
              « verrouillé », elle ne fait pas semblant d'être vide. */}
          {!unlocked && (
            <LockGlyph className="w-3.5 h-3.5 shrink-0 text-[var(--color-text-tertiary)]" />
          )}
        </p>
        <VaultDescriptionLine vaultId={vault.id} />
        <VaultBadges vault={vault} />
      </div>
      {unseen && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary-500,#3b82f6)] shrink-0"
          role="status"
          aria-label={t('teamVaults.activity.railBadge')}
        />
      )}
      <button
        type="button"
        aria-label={t('common.moreOptions', 'Plus d’options')}
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu(e, vault);
        }}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0 p-1 rounded-full
        hover:bg-[var(--color-background-secondary)]"
      >
        <MoreDotsGlyph />
      </button>
    </div>
  );
};

// ==================== Les cartes de l'accueil mêlé (lot A, C4) ====================

export interface VaultHomeCardProps {
  vault: VaultSummary;
  /** Le coffre a-t-il pu être déverrouillé ? Sinon, le nom n'est pas lisible. */
  unlocked: boolean;
  /** Le fil a bougé depuis le dernier « vu » — la pastille. */
  unseen: boolean;
  /** Rendu en liste : la première ligne n'a pas de filet au-dessus. */
  first?: boolean;
  onOpen: (vaultId: string) => void;
  onContextMenu: (e: React.MouseEvent<HTMLElement>, vault: VaultSummary) => void;
}

/** Le clavier ouvre comme le clic : la carte est un bouton, pas un simple bloc. */
function activateOnKey(e: React.KeyboardEvent, open: () => void): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    open();
  }
}

/**
 * La carte-vignette d'un coffre — le calque de `FolderCardGrid`. Mémoïsée :
 * `unlocked` et `unseen` arrivent en booléens calculés par le parent, donc
 * seules les cartes dont l'état a VRAIMENT changé se re-rendent.
 */
export const VaultCardGrid: React.FC<VaultHomeCardProps> = React.memo(function VaultCardGrid({
  vault,
  unlocked,
  unseen,
  onOpen,
  onContextMenu,
}) {
  const { t } = useTranslation();
  const label = vault.name || t('teamVaults.locked');
  const appearance = useVaultAppearance(vault);
  const open = () => onOpen(vault.id);

  return (
    <div
      data-item-id={vault.id}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => activateOnKey(e, open)}
      onContextMenu={(e) => onContextMenu(e, vault)}
      className="group relative rounded-xl border cursor-pointer select-none
      transition-all duration-200 overflow-hidden
      bg-[var(--color-surface)] border-[var(--color-border)] shadow-sm
      hover:shadow-lg hover:border-[var(--color-primary-200)] hover:-translate-y-0.5"
    >
      {/* Vignette : le cadenas sur fond primaire, là où un dossier a son glyphe. */}
      <div
        className="h-[120px] flex items-center justify-center bg-[var(--color-primary-50)] text-[var(--color-primary-500)]"
        style={vaultTintStyle(appearance)}
      >
        <VaultGlyph appearance={appearance} className="w-14 h-14 text-5xl opacity-70" />
      </div>

      {/* Barre d'info : nom, puis la sous-ligne « Partagé · N · rôle ». */}
      <div className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-surface)] border-t border-[var(--color-border-light)]">
        <VaultGlyph
          appearance={appearance}
          className="w-5 h-5 shrink-0 text-xl text-[var(--color-primary-500)]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--color-text-primary)] truncate m-0">
            {label}
          </p>
          <VaultDescriptionLine vaultId={vault.id} />
          <VaultBadges vault={vault} />
        </div>
        <button
          type="button"
          aria-label={t('common.moreOptions', 'Plus d’options')}
          onClick={(e) => {
            e.stopPropagation();
            onContextMenu(e, vault);
          }}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-full
          hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
        >
          <MoreDotsGlyph />
        </button>
      </div>

      {/* Badges, au même coin que ceux des dossiers. */}
      <div className="absolute top-2 right-2 flex items-center gap-1.5">
        {/* PAS de modificateur d'opacité (le suffixe `/90`) sur une classe
            arbitraire `bg-[var(--color-text-secondary)]` : Tailwind ne sait pas
            décomposer une variable CSS en canaux pour y appliquer une opacité,
            alors il rejette la classe ENTIÈRE, sans un mot — la pastille se
            rendait SANS fond, cadenas blanc sur vignette pâle, invisible.
            L'opacité qui compte vraiment passe par `color-mix()`, comme
            folder.css le fait déjà. */}
        {!unlocked && (
          <div
            className="flex items-center justify-center w-6 h-6 rounded-full shadow-sm text-white"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-text-secondary) 90%, transparent)',
            }}
            title={t('teamVaults.locked')}
          >
            <LockGlyph className="w-3 h-3" />
          </div>
        )}
        {unseen && (
          <span
            className="w-2.5 h-2.5 rounded-full shadow-sm bg-[var(--color-primary-500,#3b82f6)]"
            role="status"
            aria-label={t('teamVaults.activity.railBadge')}
            title={t('teamVaults.activity.railBadge')}
          />
        )}
      </div>
    </div>
  );
});

/** La rangée d'un coffre en vue liste — le calque de `FolderRowList`. */
export const VaultRowList: React.FC<VaultHomeCardProps> = React.memo(function VaultRowList({
  vault,
  unlocked,
  unseen,
  first,
  onOpen,
  onContextMenu,
}) {
  const { t } = useTranslation();
  const label = vault.name || t('teamVaults.locked');
  const appearance = useVaultAppearance(vault);
  const open = () => onOpen(vault.id);

  return (
    <div
      data-item-id={vault.id}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => activateOnKey(e, open)}
      onContextMenu={(e) => onContextMenu(e, vault)}
      className={`group relative flex items-center gap-4 px-4 py-3 cursor-pointer select-none
      transition-colors duration-100
      hover:bg-[var(--color-background-secondary)]
      ${!first ? 'border-t border-[var(--color-border-light)]' : ''}`}
    >
      <VaultGlyph
        appearance={appearance}
        className="w-6 h-6 shrink-0 text-2xl text-[var(--color-primary-500)]"
      />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm text-[var(--color-text-primary)] truncate font-medium flex items-center gap-1.5">
          {label}
          {!unlocked && (
            <span
              className="shrink-0 text-[var(--color-text-tertiary)]"
              title={t('teamVaults.locked')}
            >
              <LockGlyph className="w-3.5 h-3.5" />
            </span>
          )}
        </span>
        <VaultDescriptionLine vaultId={vault.id} />
      </span>
      {/* Là où un dossier compte ses éléments, un coffre dit ce qu'il sait. */}
      <span className="hidden sm:inline-flex">
        <VaultBadges vault={vault} />
      </span>
      {unseen && (
        <span
          className="w-2 h-2 rounded-full shrink-0 bg-[var(--color-primary-500,#3b82f6)]"
          role="status"
          aria-label={t('teamVaults.activity.railBadge')}
          title={t('teamVaults.activity.railBadge')}
        />
      )}
      <button
        type="button"
        aria-label={t('common.moreOptions', 'Plus d’options')}
        onClick={(e) => {
          e.stopPropagation();
          onContextMenu(e, vault);
        }}
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 rounded-full
        hover:bg-[var(--color-background-secondary)] transition-opacity duration-150"
      >
        <MoreDotsGlyph />
      </button>
    </div>
  );
});
