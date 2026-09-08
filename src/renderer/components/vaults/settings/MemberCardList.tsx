/**
 * MemberCardList (F28) — le trombinoscope en CARTES, pour la bande compacte.
 *
 * POURQUOI PAS LE MÊME TABLEAU, EN PLUS ÉTROIT. Un `<table>` de six colonnes ne
 * se replie pas : il POUSSE. Sous 840 px, ses colonnes de largeur fixe (rôle
 * 150, confiance 150, arrivée 130, identifiant 150, actions 210) réclament à
 * elles seules près de 800 px avant même la colonne « Membre » — le tableau
 * déborde alors de sa carte, la carte de la page, et la page du corps. Un
 * défilement horizontal dans une carte serait déjà une régression ; un
 * défilement du CORPS en est une bien pire, parce qu'il emporte les onglets et
 * l'en-tête avec lui.
 *
 * IL N'EST DONC PAS CACHÉ, IL N'EST PAS MONTÉ. Le masquer en CSS le laisserait
 * mesurer sa largeur naturelle, donc pousser : c'est le piège classique du
 * `display:none` posé sur un conteneur défilant qui, lui, avait déjà donné sa
 * taille au parent.
 *
 * LES MÊMES GESTES, DERRIÈRE « ⋯ ». Une carte porte ce que la ligne portait :
 * la case à cocher (la sélection multiple continue de fonctionner, et sa barre
 * flottante est déjà au-dessus du clavier), l'avatar, l'adresse, le rôle, la
 * date d'arrivée, et un menu qui rassemble « Changer le rôle », « Numéro de
 * sécurité », « Transmettre la propriété » et « Retirer ». Aucune action
 * n'apparaît ici qui n'existe pas sur la ligne, et aucune action de la ligne ne
 * disparaît : deux implémentations du même geste est le défaut d'origine de tout
 * cet écran.
 *
 * LE RÔLE SE CHANGE DANS LE MENU, PAS DANS UN `Select` POSÉ SUR LA CARTE. Un
 * menu déroulant de 150 px sur une carte de 300 vole la moitié de la ligne, et
 * l'ouvrir au pouce à côté d'une case à cocher est le meilleur moyen de changer
 * le rôle de quelqu'un en croyant le sélectionner. Les rôles sont donc autant
 * d'entrées du menu, avec celui qui est en cours marqué comme tel — et ils
 * viennent de `ASSIGNABLE_VAULT_ROLES`, l'autorité que lisent déjà le `Select`
 * de la table, la ligne d'invitation et le dialogue de partage. Un troisième
 * littéral, même contenant les mêmes trois mots, rouvrait le défaut que
 * `vaultRoleOptions` raconte en en-tête : le même menu changeait d'ORDRE selon
 * la porte par laquelle on était entré.
 *
 * ET UNE LISTE VIDE DIT POURQUOI. La table portait ses trois replis (chargement,
 * filtre stérile, coffre où l'on est seul) ; les cartes n'en portaient aucun, si
 * bien que les trois situations rendaient la même surface blanche. La phrase est
 * choisie une seule fois pour les deux surfaces (`rosterPlaceholderKey`) et
 * arrive ici toute faite : une absence rendue comme un fait est le travers de ce
 * dossier, et le blanc en est une variante muette.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Checkbox, Dropdown, type DropdownItem } from '../../ui';
import { RelativeTime, StatusBadge } from '../../settings/enterprise/AdminPrimitives';
import { ASSIGNABLE_VAULT_ROLES } from '../../sharing/shareDialogModel';
import { TRUST_TONE } from './MemberTrustModal';
import { isSelectable } from './memberRosterModel';
import { VAULT_ROLE_TONE } from './vaultRoleTone';
import type { MemberKeyWatch } from './useMemberKeyWatch';
import type { VaultMemberRow } from './vaultManagementModel';

/** Trois points — le même dessin que sur les cartes de coffre. */
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

export interface MemberCardListProps {
  rows: VaultMemberRow[];
  /** La sélection courante — les mêmes identifiants que ceux de la table. */
  selected: string[];
  /** La sélection est-elle offerte du tout (rang admin) ? */
  selectable: boolean;
  /** Une écriture est en vol : les gestes se ferment, ils ne s'empilent pas. */
  busy: boolean;
  /** Les verdicts de clé (F11), ou rien tant que le contrôle n'a pas atteint la ligne. */
  trust: MemberKeyWatch;
  /** La ligne à mettre en évidence (retour depuis un autre écran). */
  highlighted: string | null;
  onToggle: (userId: string, checked: boolean) => void;
  onChangeRole: (m: VaultMemberRow, role: 'admin' | 'member' | 'viewer') => void;
  onOpenTrust: (userId: string) => void;
  onTransfer: (m: VaultMemberRow) => void;
  onRemove: (m: VaultMemberRow) => void;
  /** Le contrôle de clés ne tourne QUE pour qui gère : sinon, pas d'entrée du tout. */
  showTrust: boolean;
  /**
   * CE QU'ON DIT QUAND IL N'Y A AUCUNE LIGNE — la MÊME phrase que le tableau, et
   * choisie au même endroit (`rosterPlaceholderKey`). Un chargement en cours, un
   * filtre stérile et un coffre où l'on est seul rendaient ici la même surface
   * blanche : trois situations, aucun mot, et le blanc se lit comme un fait.
   */
  emptyMessage: string;
}

export const MemberCardList: React.FC<MemberCardListProps> = ({
  rows,
  selected,
  selectable,
  busy,
  trust,
  highlighted,
  onToggle,
  onChangeRole,
  onOpenTrust,
  onTransfer,
  onRemove,
  showTrust,
  emptyMessage,
}) => {
  const { t } = useTranslation();

  const menuFor = (m: VaultMemberRow): DropdownItem[] => {
    const items: DropdownItem[] = [];
    if (m.canChangeRole) {
      // L'AUTORITÉ, PAS UN TROISIÈME LITTÉRAL. `ASSIGNABLE_VAULT_ROLES` est la
      // liste que le `Select` de la table, la ligne d'invitation et le dialogue
      // de partage lisent tous : un menu qui se réordonne selon la porte par
      // laquelle on est entré retourne le geste qu'on vient d'apprendre — c'est
      // le défaut que l'en-tête de `vaultRoleOptions` raconte, et un quatrième
      // rôle ajouté demain n'apparaîtrait pas du tout dans la bande compacte.
      for (const role of ASSIGNABLE_VAULT_ROLES) {
        items.push({
          // Le rôle EN COURS reste dans la liste, désactivé : le retirer ferait
          // un menu dont le contenu change selon l'état, et on ne lirait plus
          // d'un coup d'œil quel rôle porte cette personne.
          label: t(`teamVaults.role.${role}`, role),
          disabled: busy || role === m.role,
          onClick: () => onChangeRole(m, role),
        });
      }
      items[items.length - 1].divider = true;
    }
    if (showTrust && trust.verdicts[m.userId]) {
      items.push({
        label: t('teamVaults.settings.trust.open', { name: m.label }),
        onClick: () => onOpenTrust(m.userId),
      });
    }
    if (m.transferable) {
      items.push({
        label: t('teamVaults.members.transfer'),
        disabled: busy,
        onClick: () => onTransfer(m),
      });
    }
    if (m.removable) {
      items.push({
        label: t('teamVaults.members.remove'),
        danger: true,
        disabled: busy,
        onClick: () => onRemove(m),
      });
    }
    return items;
  };

  /* AUCUNE LIGNE SE DIT. La table rendait déjà ses trois cas ; les cartes n'en
     rendaient aucun, et le vide se lisait comme « il n'y a personne ». La phrase
     arrive toute choisie de l'onglet, qui la tire de la MÊME fonction que la
     table — pas d'un second `if` recopié ici. */
  if (rows.length === 0) {
    return (
      <p className="ent-hint" style={{ margin: 0, padding: 'var(--spacing-4)' }}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <ul className="ent-rowcards">
      {rows.map((m) => {
        const menu = menuFor(m);
        const ms = Date.parse(m.joinedAt);
        const verdict = trust.verdicts[m.userId];
        return (
          <li
            key={m.userId}
            className={`ent-rowcard ${m.userId === highlighted ? 'ent-rowcard--highlight' : ''}`}
          >
            {/* LES DEUX LIGNES QU'AUCUN GESTE DE LOT N'ATTEINT (le propriétaire,
                la mienne) n'ont pas de case du tout — la même règle que la
                table, tirée du MÊME champ calculé par `buildMemberRows`. */}
            {selectable && isSelectable(m) && (
              <span className="pt-0.5">
                <Checkbox
                  size="sm"
                  checked={selected.includes(m.userId)}
                  onChange={(e) => onToggle(m.userId, e.target.checked)}
                  aria-label={t('teamVaults.settings.roster.selectMember', { name: m.label })}
                />
              </span>
            )}
            {/* La pastille prend l'IDENTIFIANT pour graine, comme partout
                ailleurs : la même personne garde sa couleur d'un écran à l'autre. */}
            <Avatar label={m.label} seed={m.userId} size="sm" title={null} />
            <div className="ent-rowcard__body">
              <p className="ent-rowcard__title">
                <span className="truncate">{m.label}</span>
                {m.isSelf && <span className="ent-hint">({t('teamVaults.members.you')})</span>}
              </p>
              <p className="ent-rowcard__meta">
                <StatusBadge tone={VAULT_ROLE_TONE[m.role] ?? 'neutral'}>
                  {t(`teamVaults.role.${m.role}`, m.role)}
                </StatusBadge>
                {/* « Hors de l'espace » n'est affirmé que si le serveur l'a dit :
                    `inSpace` absent (vieux Worker) n'est pas « non ». */}
                {m.inSpace === false && (
                  <StatusBadge
                    tone="warning"
                    title={t('teamVaults.settings.members.outOfSpaceHint')}
                  >
                    {t('teamVaults.settings.members.outOfSpace')}
                  </StatusBadge>
                )}
                {/* Pas encore de verdict pour cette ligne : RIEN, plutôt qu'un
                    « inconnu » qui se lirait comme un résultat. */}
                {showTrust && verdict && (
                  <StatusBadge tone={TRUST_TONE[verdict.state]} dot>
                    {t(`teamVaults.settings.trust.state.${verdict.state}`)}
                  </StatusBadge>
                )}
                {!Number.isNaN(ms) && <RelativeTime ms={ms} />}
              </p>
            </div>
            {/* Un menu VIDE n'existe pas : sur une carte sans aucun geste offert
                (un lecteur qui regarde le trombinoscope), le bouton disparaît
                plutôt que de s'ouvrir sur du vide. */}
            {menu.length > 0 && (
              <Dropdown
                position="bottom-right"
                items={menu}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('common.moreOptions', 'Plus d’options')}
                  >
                    <MoreDotsGlyph />
                  </Button>
                }
              />
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default MemberCardList;
