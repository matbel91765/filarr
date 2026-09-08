/**
 * ShareDialog — le dialogue de partage UNIFIÉ, façon Notion : inviter, la liste
 * d'accès et le lien AU MÊME ENDROIT, quelle que soit la nature de la cible.
 *
 * CE QUE SON ABSENCE COÛTAIT. Le produit avait quatre voies de partage, chacune
 * derrière sa propre entrée de menu et sa propre boîte : l'adhésion au coffre
 * (l'ancien `InviteMemberModal`, supprimé par F02), le grant par personne
 * (ShareItemToPersonModal), le lien public (VaultShareModal / ShareFileModal)
 * et l'entrée dans un coffre (AddToVaultDialog). Il fallait connaître le
 * modèle pour savoir laquelle ouvrir. Ici, UNE entrée — « Gérer l'accès » —
 * et le dialogue ne montre que les voies qui existent pour CETTE cible et CE
 * rôle (décidé par `shareDialogModel`, pur et éprouvé).
 *
 * DÉCISIONS TENUES (D1/D2). Une Modal du design system, pas un popover ancré :
 * les points d'entrée sont des menus contextuels sans ancre. Et une
 * ORCHESTRATION LÉGÈRE : ce fichier COMPOSE les briques existantes — la
 * cérémonie d'empreinte (KeyVerification), le corps de partage par personne
 * (ShareItemToPersonBody), les boîtes de lien, l'ajout au coffre, le retrait
 * d'un membre (useRemoveVaultMember, partagé avec la page de gestion). Rien de
 * cryptographique n'est réécrit ici. « Paramètres avancés » NAVIGUE désormais
 * vers la page « Gérer le coffre » (`?view=settings&tab=members`) au lieu
 * d'empiler un troisième niveau de boîte : le dialogue est la porte RAPIDE, la
 * page est la complète, et il n'y a plus deux écrans à tenir d'accord.
 *
 * L'INVITATION EN UNE LIGNE : `sharing/InviteRow`, le MÊME composant que
 * l'onglet « Membres » de la page « Gérer le coffre » (F02). Il n'y a plus deux
 * codes pour le geste le plus important de l'écran — et donc plus de dix-sept
 * incohérences à tenir d'accord. Ce fichier ne fait que lui passer l'annuaire
 * qu'il a déjà lu, la liste des membres, et ce qu'il faut relire ensuite.
 *
 * MODE LOCAL : le hook (`useShareDialog`) n'ouvre rien ; ce composant suppose
 * le nuage.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Modal, ModalBody, ModalFooter, Button, Select, Avatar } from '../ui';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import { selectSharedVaultOrgId } from '../../../store/selectors/authSelectors';
import { selectVaultMemberCount } from '../../../store/selectors/shareIndexSelectors';
import {
  invalidateVaultShareSummary,
  loadVaultShareSummary,
} from '../../../store/slices/shareIndexSlice';
import { vaultFolderRoute } from '../layout/RouteContent/routeCompat';
import { selectExternalSharesDisabledByOrg } from '../../../store/slices/governanceSlice';
import { selectVaultById } from '../../../store/slices/vaultsSlice';
import { selectNoteById } from '../../../store/slices/notesSlice';
import {
  apiListVaultMembers,
  apiListVaultInvitesWithSettled,
  apiRevokeVaultInvite,
  apiSetVaultMemberRole,
  type VaultInviteDTO,
  type VaultMemberDTO,
} from '../../../services/vault/vaultApi';
import { vaultErrorKey, errorText } from '../../../services/vault/vaultErrorMessages';
import { ShareItemToPersonBody } from '../vaults/ShareItemToPersonBody';
import { VaultShareModal } from '../vaults/VaultShareModal';
import ShareFileModal from './ShareFileModal';
import {
  AddToVaultDialog,
  useVaultAddTargets,
  type AddToVaultSource,
} from '../vaults/AddToVaultDialog';
import { writableAddTargets } from '../vaults/addToVaultTargets';
import { useSpaceDirectory } from '../vaults/spaceDirectory';
import { useVaultSettings } from '../vaults/settings/useVaultSettings';
import { VaultActivityPanel } from '../vaults/VaultActivityPanel';
import { useRemoveVaultMember } from '../vaults/useRemoveVaultMember';
import { InviteRow, vaultRoleOptions } from './InviteRow';
import {
  shareDialogSections,
  shareTargetName,
  buildAccessRows,
  isAssignableVaultRole,
  type ShareTarget,
  type ShareDialogSections,
} from './shareDialogModel';

export type { ShareTarget } from './shareDialogModel';

// ─────────────────────────────────────────────────────────────────────────────
// Petites briques de présentation
// ─────────────────────────────────────────────────────────────────────────────

/** L'icône de l'en-tête — 20 px, `currentColor`, tracé heroicons. */
const TargetGlyph: React.FC<{ kind: ShareTarget['kind'] }> = ({ kind }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.8}
    stroke="currentColor"
    width="20"
    height="20"
    aria-hidden="true"
  >
    {kind === 'vault' ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    ) : kind === 'personalNote' ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    ) : (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    )}
  </svg>
);

/** Une section du dialogue : un titre bas de casse, un contenu. */
const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="flex flex-col gap-2">
    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)] m-0">
      {title}
    </h3>
    {children}
  </section>
);

const firstOf = (v: string | string[]): string => (Array.isArray(v) ? (v[0] ?? '') : v);

// ─────────────────────────────────────────────────────────────────────────────
// PERSONNES AYANT ACCÈS — le trombinoscope du coffre, avec ses gestes
// ─────────────────────────────────────────────────────────────────────────────

interface VaultAccessProps {
  vaultId: string;
  myRole: string;
  sections: ShareDialogSections;
}

const VaultAccessSections: React.FC<VaultAccessProps> = ({ vaultId, myRole, sections }) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  // L'espace DU COFFRE, pas le mien : un admin de coffre peut être l'invité
  // d'un autre espace (même règle que la page de gestion).
  const vaultOrgId = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.organizationId ?? null
  );
  const mySpaceOrgId = useSelector(selectSharedVaultOrgId);
  const orgId = vaultOrgId ?? mySpaceOrgId;
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);

  const [members, setMembers] = useState<VaultMemberDTO[]>([]);
  const [invites, setInvites] = useState<VaultInviteDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ownBusy, setBusy] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const canInvite = sections.invite;

  /**
   * L'annuaire de l'espace — demandé SEULEMENT à qui gère le coffre, parce que
   * la route lui est réservée (P2). Un membre ou un lecteur ne le réclame pas :
   * les adresses de sa liste d'accès viennent maintenant du champ `email` que
   * chaque ligne de `/members` porte.
   */
  const directory = useSpaceDirectory(vaultId, canInvite);

  /**
   * Les réglages du coffre (F13) — pour la SEULE chose dont cette porte rapide
   * se sert : le rôle pré-sélectionné de la ligne d'invitation. Demandés
   * seulement quand cette ligne existe : un dialogue ouvert sur un fichier
   * personnel ne parle d'aucun coffre.
   *
   * L'ÉPOQUE COURANTE EST PASSÉE POUR DE VRAI, même si cet écran ne lit pas le
   * bloc scellé : un `0` en dur rendrait `seal` structurellement « courant », donc
   * FAUX, pour le prochain lecteur qui s'en servirait depuis cette poignée.
   */
  const vaultKeyEpoch = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.currentKeyEpoch ?? 0
  );
  const vaultSettings = useVaultSettings(vaultId, vaultKeyEpoch, canInvite);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // La liste des membres est la donnée critique ; les invitations sont
      // accessoires : leur échec ne vide jamais la liste.
      const vm = await apiListVaultMembers(vaultId);
      if (!mountedRef.current) return;
      setMembers(vm);
      if (canInvite) {
        const inv = await apiListVaultInvitesWithSettled(vaultId);
        if (!mountedRef.current) return;
        setInvites(inv.invites);
      }
    } catch (e) {
      // MÉMORISÉ, pas réduit à une notification passagère : une liste vide sur
      // panne de lecture mentirait ensuite en permanence.
      if (mountedRef.current) setLoadError(errorText(e) || 'load_failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [vaultId, canInvite]);

  // Le jeton de relecture d'autrefois a disparu avec le second niveau qu'il
  // servait : « Paramètres avancés » ne se referme plus sur ce dialogue, il le
  // QUITTE pour la page du coffre. Plus de liste à resynchroniser au retour.
  useEffect(() => {
    void load();
  }, [load]);

  // L'annuaire couvre aussi les gens que le coffre ne connaît pas (destinataires
  // d'un grant, par exemple) ; l'adresse portée par la ligne du coffre prend le
  // relais pour tous les autres — c'est `buildAccessRows` qui arbitre.
  const emailByUserId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of directory.entries) map[m.userId] = m.email;
    return map;
  }, [directory.entries]);
  // Même ordre que `buildAccessRows` : l'annuaire s'il a répondu, sinon
  // l'adresse que la ligne du coffre porte, sinon l'identifiant. Ce nom sert
  // aussi la réserve du retrait — « retirer 7f3a… » ne dit à personne qui part.
  const display = useCallback(
    (userId: string) =>
      emailByUserId[userId] || members.find((m) => m.userId === userId)?.email || userId,
    [emailByUserId, members]
  );

  const rows = useMemo(
    () => buildAccessRows(members, emailByUserId, myUserId, myRole),
    [members, emailByUserId, myUserId, myRole]
  );

  /**
   * « Voir la ligne » de quelqu'un qui a déjà accès. Le dialogue tient sa liste
   * juste en dessous : on la surligne et on l'amène sous les yeux, plutôt que de
   * laisser l'hôte chercher dans une liste qu'il n'a peut-être même pas déroulée.
   */
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const highlightRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) highlightRef.current?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, rows]);

  const removal = useRemoveVaultMember(vaultId, { displayName: display, onRemoved: load });
  const busy = ownBusy || removal.busy;

  /** Changer un rôle — sans rotation, donc sans coûter l'historique (cf. panneau). */
  const changeRole = async (userId: string, current: string, next: string) => {
    if (next === current || !isAssignableVaultRole(next)) return;
    setBusy(true);
    try {
      await apiSetVaultMemberRole(vaultId, userId, next);
      if (mountedRef.current) success(t('teamVaults.members.roleChanged'));
      await load();
    } catch (e) {
      if (mountedRef.current) {
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.roleChangeFailed')));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const revokeInvite = async (inv: VaultInviteDTO) => {
    setBusy(true);
    try {
      await apiRevokeVaultInvite(vaultId, inv.id);
      if (mountedRef.current) success(t('teamVaults.members.pendingRevoked'));
      await load();
    } catch (e) {
      if (mountedRef.current) {
        error(t(vaultErrorKey(errorText(e), 'teamVaults.errors.inviteRevokeFailed')));
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <>
      {canInvite && (
        <Section title={t('shareDialog.invite.title', 'Invite')}>
          {/* LA MÊME ligne que l'onglet « Membres » de la page de gestion — un
              seul code, donc un seul comportement à tenir juste. */}
          <InviteRow
            vaultId={vaultId}
            orgId={orgId}
            directory={directory.entries}
            directoryState={directory.state}
            onRetryDirectory={directory.reload}
            vaultMembers={members}
            // Les invitations déjà lues par ce dialogue : la liste de
            // suggestions peut alors dire « invitation en attente » au lieu de
            // laisser croire qu'on n'a rien fait pour cette personne.
            pendingInvites={invites}
            // Le rôle par défaut de CE coffre (F13) — la porte rapide et la
            // page complète pré-sélectionnent la même chose.
            defaultRole={vaultSettings.settings.defaultInviteRole}
            onSeeRow={setHighlighted}
            onDone={async () => {
              await load();
              // L'effectif a changé : la pastille de l'en-tête doit relire le
              // vrai nombre. L'invalidation D'ABORD — `loadVaultShareSummary` a
              // une condition de fraîcheur (TTL) qui, sans elle, ne partirait
              // même pas.
              dispatch(invalidateVaultShareSummary(vaultId));
              void dispatch(loadVaultShareSummary(vaultId));
            }}
          />
        </Section>
      )}

      {sections.people && (
        <Section title={t('shareDialog.people.title', 'People with access')}>
          {loadError ? (
            <div role="alert" className="flex items-center justify-between gap-2">
              <p className="text-sm text-[var(--color-text-primary)] m-0">
                {t(vaultErrorKey(loadError, 'teamVaults.errors.membersLoad'))}
              </p>
              <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
                {t('teamVaults.retry')}
              </Button>
            </div>
          ) : loading && members.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)] m-0">{t('common.loading')}</p>
          ) : (
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {rows.map((m) => (
                <li
                  key={m.userId}
                  ref={m.userId === highlighted ? highlightRef : undefined}
                  className={`flex items-center gap-3 min-h-[32px] rounded-md ${
                    m.userId === highlighted
                      ? 'ring-1 ring-[var(--color-primary-500)] px-2 -mx-2'
                      : ''
                  }`}
                >
                  <Avatar label={m.label} seed={m.userId} size="sm" />
                  <span className="flex-1 min-w-0 truncate text-sm text-[var(--color-text-primary)]">
                    {m.label}
                    {m.isSelf && (
                      <span className="ml-1.5 text-xs text-[var(--color-text-tertiary)]">
                        ({t('teamVaults.members.you')})
                      </span>
                    )}
                  </span>
                  {m.canChangeRole ? (
                    <div className="w-32 shrink-0">
                      <Select
                        size="sm"
                        value={m.role}
                        ariaLabel={t('teamVaults.members.roleFor', { name: m.label })}
                        disabled={busy}
                        onChange={(v) => void changeRole(m.userId, m.role, firstOf(v))}
                        options={vaultRoleOptions(t)}
                        fullWidth
                      />
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--color-text-secondary)] shrink-0">
                      {t(`teamVaults.role.${m.role}`, m.role)}
                    </span>
                  )}
                  {m.canRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => removal.requestRemove(m)}
                      title={t('teamVaults.members.removeCaveatTitle')}
                    >
                      {t('teamVaults.members.remove')}
                    </Button>
                  )}
                </li>
              ))}

              {/* Les invitations dehors — compactes : adresse, péremption, Révoquer. */}
              {canInvite &&
                invites.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 min-h-[32px]">
                    <Avatar label={inv.inviteeEmail} seed={inv.inviteeEmail} size="sm" />
                    <span className="flex-1 min-w-0 truncate text-sm text-[var(--color-text-secondary)]">
                      {inv.inviteeEmail}
                      <span className="ml-1.5 text-xs text-[var(--color-text-tertiary)]">
                        {t('shareDialog.people.pending', 'invited')} ·{' '}
                        {t('teamVaults.members.pendingExpires', {
                          date: new Date(inv.expiresAt).toLocaleDateString(),
                        })}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-text-secondary)] shrink-0">
                      {t(`teamVaults.role.${inv.role}`, inv.role)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void revokeInvite(inv)}
                    >
                      {t('teamVaults.members.pendingRevoke', 'Revoke')}
                    </Button>
                  </li>
                ))}
            </ul>
          )}
        </Section>
      )}

      {removal.overlays}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Le dialogue
// ─────────────────────────────────────────────────────────────────────────────

export interface ShareDialogProps {
  target: ShareTarget;
  onClose: () => void;
  /**
   * Le contenu LOCAL vient de changer (un « Déplacer » vers un coffre a mis
   * l'original à la corbeille) — l'hôte relit ce qu'il affiche.
   */
  onLocalChanged?: () => void;
  /**
   * `'invite'` : la main est posée sur le premier champ de la section
   * d'invitation (cible `vault`) ou du partage par personne (cible
   * `vaultItem`) — le raccourci « Partager avec une personne » du menu ouvre
   * le MÊME dialogue, pas une boîte de plus, mais sans faire chercher le champ.
   */
  initialFocus?: 'invite';
}

export const ShareDialog: React.FC<ShareDialogProps> = ({
  target,
  onClose,
  onLocalChanged,
  initialFocus,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const accountMode = useSelector((s: RootState) => s.auth.accountMode);
  const vaultId =
    target.kind === 'vault' || target.kind === 'vaultItem' || target.kind === 'vaultItems'
      ? target.vaultId
      : null;
  const vault = useSelector((s: RootState) => (vaultId ? selectVaultById(s, vaultId) : undefined));
  const myRole = vault?.role ?? 'viewer';
  const memberCount = useSelector((s: RootState) =>
    vaultId ? selectVaultMemberCount(s, vaultId) : undefined
  );
  const externalSharesDisabled = useSelector(selectExternalSharesDisabledByOrg);
  const addTargets = useVaultAddTargets();
  /**
   * COMBIEN DE DESTINATIONS OUVERTES, pas combien de coffres (F23). La liste
   * garde ses coffres gelés — pour qu'ils restent visibles et explicables dans
   * la boîte — mais une section « Ajouter au coffre » qui n'ouvrirait que sur
   * des options éteintes ne mène nulle part.
   */
  const writableAddCount = writableAddTargets(addTargets).length;
  const note = useSelector((s: RootState) =>
    target.kind === 'personalNote' ? selectNoteById(s, target.noteId) : undefined
  );

  const sections = useMemo(
    () =>
      shareDialogSections(target, {
        accountMode,
        myRole,
        hasAddTargets: writableAddCount > 0,
        externalSharesDisabled,
      }),
    [target, accountMode, myRole, writableAddCount, externalSharesDisabled]
  );

  // L'effectif de l'en-tête : UNE requête, dédupliquée et sous TTL (shareIndex).
  useEffect(() => {
    if (vaultId) void dispatch(loadVaultShareSummary(vaultId));
  }, [vaultId, dispatch]);

  /**
   * La section à focaliser — un seul ref pour deux enveloppes, parce qu'elles
   * s'excluent : la ligne d'invitation n'existe que pour un coffre, le corps
   * « partager avec une personne » que pour un élément. Le focus part APRÈS le
   * piège de focus de la Modal (qui prend le premier focalisable au montage),
   * d'où la frame suivante ; s'il n'y a rien à focaliser (rôle qui consulte),
   * le focus de la Modal reste où il est — jamais de vol de focus vers rien.
   */
  const inviteRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialFocus !== 'invite') return undefined;
    const frame = requestAnimationFrame(() => {
      inviteRef.current
        ?.querySelector<HTMLElement>('input, select, textarea, button:not([disabled])')
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [panel, setPanel] = useState<'activity' | null>(null);

  const closePanel = () => setPanel(null);

  /**
   * « Paramètres avancés » QUITTE le dialogue. Auparavant il ouvrait le panneau
   * des membres dans une modale par-dessus la modale — deux écrans du même
   * effectif, superposés, qu'il fallait ensuite tenir d'accord (d'où le
   * `bumpReload` + l'invalidation à la fermeture). Maintenant on ferme et on
   * navigue : un seul écran détient la liste à la fois.
   */
  const goToVaultPage = () => {
    if (!vaultId) return;
    onClose();
    navigate(vaultFolderRoute(vaultId, { view: 'settings', tab: 'members' }));
  };

  /** Ce qu'on enverrait dans un coffre — `null` quand la note n'existe plus. */
  const addSource: AddToVaultSource | null =
    target.kind === 'personalFile'
      ? {
          kind: 'file',
          id: target.file.id,
          name: target.file.name,
          size: target.file.size,
          mime: target.file.type,
          folderId: target.folderId,
        }
      : target.kind === 'personalNote' && note
        ? { kind: 'note', id: note.id, title: note.title, content: note.content }
        : null;

  const name = shareTargetName(target, vault?.name ?? '', t('teamVaults.items.untitled'));
  const subtitle =
    target.kind === 'vault'
      ? typeof memberCount === 'number'
        ? t('shareDialog.header.vaultWithCount', {
            count: memberCount,
            defaultValue: 'Shared vault · {{count}} members',
          })
        : t('shareDialog.header.vault', 'Shared vault')
      : target.kind === 'vaultItem'
        ? typeof memberCount === 'number'
          ? t('shareDialog.header.inVaultWithCount', {
              vault: vault?.name || t('teamVaults.locked'),
              count: memberCount,
              defaultValue: 'In “{{vault}}” · {{count}} members',
            })
          : t('shareDialog.header.inVault', 'In “{{vault}}”', {
              vault: vault?.name || t('teamVaults.locked'),
            })
        : target.kind === 'vaultItems'
          ? t('shareDialog.header.vaultItems', {
              vault: vault?.name || t('teamVaults.locked'),
              count: target.items.length,
              defaultValue: 'In “{{vault}}” · {{count}} items',
            })
          : target.kind === 'personalFile'
            ? t('shareDialog.header.personalFile', 'Personal file')
            : t('shareDialog.header.personalNote', 'Personal note');

  return (
    <>
      <Modal isOpen onClose={onClose} title={t('shareDialog.title', 'Manage access')} size="md">
        <ModalBody>
          <div className="flex flex-col gap-5">
            {/* En-tête : icône + nom + sous-titre. */}
            <div className="flex items-center gap-3">
              <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] shrink-0">
                <TargetGlyph kind={target.kind} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--color-text-primary)] m-0 truncate">
                  {name}
                </p>
                <p className="text-xs text-[var(--color-text-tertiary)] m-0 truncate">{subtitle}</p>
              </div>
            </div>

            {vaultId && (sections.invite || sections.people) && (
              <div ref={inviteRef} className="contents">
                <VaultAccessSections vaultId={vaultId} myRole={myRole} sections={sections} />
              </div>
            )}

            {/* Partager CET élément avec UNE personne — le corps existant, inline. */}
            {sections.itemGrant &&
              (target.kind === 'vaultItem' || target.kind === 'vaultItems') && (
                <div ref={inviteRef} className="contents">
                  <Section title={t('teamVaults.grants.shareWithPerson')}>
                    {/* Le MÊME corps pour un élément et pour un lot : c'est le
                      nombre d'éléments qui le fait basculer en mode lot. */}
                    <ShareItemToPersonBody
                      vaultId={target.vaultId}
                      items={target.kind === 'vaultItem' ? [target.item] : target.items}
                      basePath={target.kind === 'vaultItems' ? target.basePath : undefined}
                    />
                  </Section>
                </div>
              )}

            {/* Le lien public — ouvert en second niveau, et dit pour ce qu'il est. */}
            {sections.link && (
              <Section title={t('shareDialog.link.title', 'Public link')}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                    {t(
                      'shareDialog.link.snapshot',
                      'A snapshot: later edits are not reflected in the link.'
                    )}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setLinkOpen(true)}>
                    {t('shareDialog.link.create', 'Create a public link…')}
                  </Button>
                </div>
              </Section>
            )}

            {/* Les contenus personnels entrent dans un coffre — pour une note,
                c'est LA voie de partage, et on le dit. */}
            {sections.addToVault && addSource && (
              <Section title={t('shareDialog.vault.title', 'Shared vault')}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                    {target.kind === 'personalNote'
                      ? t(
                          'shareDialog.vault.noteHint',
                          'A note is shared through a shared vault: add it to one and its members can read it.'
                        )
                      : t(
                          'shareDialog.vault.fileHint',
                          'Add this file to a shared vault so its members can open it.'
                        )}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
                    {t('teamVaults.addToVault.menu', 'Add to shared vault…')}
                  </Button>
                </div>
              </Section>
            )}
          </div>
        </ModalBody>

        <ModalFooter>
          {sections.activity && (
            <Button variant="ghost" size="sm" onClick={() => setPanel('activity')}>
              {t('shareDialog.footer.activity', 'View activity')}
            </Button>
          )}
          {sections.advanced && (
            <Button variant="ghost" size="sm" onClick={goToVaultPage}>
              {t('shareDialog.footer.advanced', 'Advanced settings')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="primary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Second niveau : les boîtes existantes, telles quelles. */}
      {linkOpen && target.kind === 'vaultItem' && (
        <VaultShareModal
          vaultId={target.vaultId}
          item={target.item}
          fileName={target.itemName}
          onClose={() => setLinkOpen(false)}
        />
      )}
      {linkOpen && target.kind === 'personalFile' && (
        <ShareFileModal
          file={target.file}
          folderId={target.folderId}
          onClose={() => setLinkOpen(false)}
        />
      )}

      {addSource && (
        <AddToVaultDialog
          isOpen={addOpen}
          onClose={() => setAddOpen(false)}
          source={addSource}
          onLocalChanged={onLocalChanged}
        />
      )}

      {/* Activité (l'avertissement `recorded:false` est celui du panneau) : le
          même montage que le clic droit d'une carte de coffre
          (useVaultCardMenu) — deux vues du même fil qui divergeraient, c'est la
          panne qu'on ne remarque qu'au moment où l'une des deux ment. */}
      {panel && vaultId && (
        <Modal isOpen onClose={closePanel} title={t('teamVaults.viewTab.activity')} size="lg">
          <ModalBody>
            <VaultActivityPanel vaultId={vaultId} />
          </ModalBody>
        </Modal>
      )}
    </>
  );
};

export default ShareDialog;
