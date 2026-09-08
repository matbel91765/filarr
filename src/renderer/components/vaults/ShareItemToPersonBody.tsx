/**
 * ShareItemToPersonBody — partager UN élément, ou un LOT d'éléments (un
 * dossier, une sélection), avec UNE personne (E3-6), sans la fenêtre autour.
 *
 * Extrait mécaniquement de ShareItemToPersonModal pour que ShareDialog puisse
 * le rendre inline ; la modale n'est plus qu'un cadre autour de ce corps.
 *
 * La cérémonie est celle de l'invitation (KeyVerification.tsx) : la clé du
 * destinataire est vérifiée (transparence + TOFU), son empreinte s'affiche, un
 * changement de clé exige une confirmation hors bande — jamais de scellement
 * silencieux vers une clé qui a tourné. Le destinataire doit DÉJÀ être dans
 * l'espace : la découverte de clé est org-scopée par conception
 * (anti-énumération) — « il n'est pas encore là » passe par l'invitation
 * d'espace du panneau des membres.
 *
 * LE MODE LOT. Le grant est PAR ÉLÉMENT côté serveur — un dossier de coffre
 * n'est qu'un préfixe de chemin. Partager un dossier, c'est donc UNE cérémonie
 * (la clé du destinataire vérifiée une fois, à l'écran) puis N scellements en
 * séquence (`createItemGrants`, qui rejoue le thunk unitaire pour chacun). Et
 * c'est dit honnêtement : un fichier ajouté plus tard dans le dossier n'est
 * PAS couvert — il n'existait pas quand on a scellé.
 *
 * En dessous : les accès existants — pour un lot, l'UNION des destinataires
 * de tous les éléments (« sur 3 éléments »), avec badge stale et révocation
 * qui porte sur tous ; au-delà de `GRANT_LIST_CAP` éléments on ne fait plus N
 * requêtes, on ne montre que le compte. Le texte dit la vérité : révoquer
 * RE-CHIFFRE l'élément (rotation K_item).
 *
 * CE QUE LE COFFRE AUTORISE (F13). Deux réglages s'appliquent ICI, et le
 * serveur les applique en un point chacun : `itemGrantsEnabled` ferme la
 * CRÉATION d'un accès (jamais ceux déjà donnés — le formulaire cède la place à
 * la phrase qui le dit, la liste des accès et son bouton Révoquer restent), et
 * `grantMaxExpiryDays` plafonne la durée, ce qui rend du même coup l'expiration
 * OBLIGATOIRE : « jamais » disparaît du menu, parce qu'un accès sans fin
 * contournerait le plafond entièrement. Ce corps est le SEUL rendu du partage
 * par élément — le dialogue unifié et l'ancienne modale l'affichent tous les
 * deux — donc les deux règles n'ont qu'un endroit où être tenues.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { rememberFolderShare } from '../../../services/vault/shareIntentStore';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Checkbox, Input, Select } from '../ui';
import { useNotification } from '../ui/Notification';
import type { AppDispatch, RootState } from '../../../store';
import {
  createItemGrants,
  revokeItemGrant,
  selectVaultById,
  type VaultItemSummary,
} from '../../../store/slices/vaultsSlice';
import { isVaultAdminRole } from './vaultExplorerModel';
import { selectGrantCountMap } from '../../../store/selectors/shareIndexSelectors';
import {
  apiListItemGrants,
  type ItemGrantDTO,
  type SpaceDirectoryEntry,
} from '../../../services/vault/vaultApi';
import { vaultErrorKey } from '../../../services/vault/vaultErrorMessages';
import { useSpaceDirectory, DirectoryNotice } from './spaceDirectory';
import { useVaultSettings } from './settings/useVaultSettings';
import {
  coerceGrantExpiry,
  grantExpiryChoices,
  type GrantExpiryChoice,
} from './settings/vaultSettingsModel';
import { usePeerKeyVerification, KeyVerificationPanel } from './KeyVerification';
import {
  PICKER_SEARCH_THRESHOLD,
  groupBySubfolder,
  groupCheckState,
  toggleGroup,
  toggleItem,
  checkAll,
  checkNone,
  checkedItems,
  pickerCounts,
  filterGroups,
  pickerItemName,
} from './shareItemPicker';

export interface ShareItemToPersonBodyProps {
  vaultId: string;
  /** UN élément = le mode d'origine ; plusieurs = le mode lot. */
  items: VaultItemSummary[];
  /**
   * Le dossier d'où part le lot (le dossier partagé, ou le dossier courant
   * d'une sélection) : le choix des éléments s'y groupe par sous-dossier
   * RELATIF. Absent, le préfixe commun des éléments fait office de base.
   */
  basePath?: string;
}

/**
 * Au-delà, la liste des accès n'est plus demandée élément par élément : N
 * requêtes pour peindre une liste, c'est le prix qu'on refuse de payer pour
 * un dossier de deux cents fichiers — on ne montre alors que le compte, lu
 * dans l'index déjà chargé.
 */
export const GRANT_LIST_CAP = 50;

/** Une ligne de la liste des accès : une PERSONNE, et ses grants sur le lot. */
interface GranteeRow {
  userId: string;
  label: string;
  grants: Array<{ itemId: string; grantId: string }>;
  /** Au moins un des grants est en retard sur la version réelle. */
  stale: boolean;
  /** L'échéance — affichée en mode UN élément seulement (un lot en aurait N). */
  expiresAt: string | null;
}

/** Union des destinataires sur tous les éléments du lot, triée par libellé. */
export function aggregateGrantees(grantsByItem: ReadonlyMap<string, ItemGrantDTO[]>): GranteeRow[] {
  const rows = new Map<string, GranteeRow>();
  for (const [itemId, grants] of grantsByItem) {
    for (const g of grants) {
      const row = rows.get(g.granteeUserId) ?? {
        userId: g.granteeUserId,
        label: g.granteeEmail ?? g.granteeUserId.slice(0, 8),
        grants: [],
        stale: false,
        expiresAt: g.expiresAt,
      };
      row.grants.push({ itemId, grantId: g.id });
      row.stale = row.stale || g.stale;
      if (g.granteeEmail && row.label !== g.granteeEmail) row.label = g.granteeEmail;
      rows.set(g.granteeUserId, row);
    }
  }
  return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const ShareItemToPersonBody: React.FC<ShareItemToPersonBodyProps> = ({
  vaultId,
  items,
  basePath,
}) => {
  const { t, i18n } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();

  // Mon rôle DANS CE COFFRE : la seule chose à savoir pour décider si l'annuaire
  // de l'espace m'est ouvert. L'espace lui-même n'est plus résolu ici — c'est le
  // serveur qui lit `vault.organization_id`, et lui seul peut se tromper.
  const myVaultRole = useSelector((s: RootState) => selectVaultById(s, vaultId)?.role ?? 'viewer');
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);
  const grantMap = useSelector((s: RootState) => selectGrantCountMap(s, vaultId));

  // Les marqueurs de dossier ne sont pas des contenus : jamais scellés.
  const shareable = useMemo(() => items.filter((i) => !i.meta.folderMarker), [items]);
  const isBatch = items.length > 1;
  const listable = shareable.length <= GRANT_LIST_CAP;

  /**
   * LE CHOIX des éléments (mode lot) : tous cochés par défaut, groupés par
   * sous-dossier relatif à `basePath`. Ce qui n'est pas coché n'est ni scellé
   * ni compté dans l'union des accès — le dialogue ne parle que de ce qui
   * partira. Remis à « tout » quand le lot change (autre dossier, autre
   * sélection) : un coché d'un lot précédent n'a aucun sens sur le suivant.
   */
  const shareableIdsKey = shareable.map((i) => i.id).join('\n');
  const [checked, setChecked] = useState<Set<string>>(() => checkAll(shareable));
  useEffect(() => {
    setChecked(new Set(shareableIdsKey ? shareableIdsKey.split('\n') : []));
  }, [shareableIdsKey]);
  const [pickerQuery, setPickerQuery] = useState('');
  const collator = useMemo(
    () => new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' }),
    [i18n.language]
  );
  const groups = useMemo(
    () => groupBySubfolder(shareable, basePath, collator),
    [shareable, basePath, collator]
  );
  const visibleGroups = useMemo(() => filterGroups(groups, pickerQuery), [groups, pickerQuery]);
  /** Le groupe ENTIER derrière un groupe filtré — la case de groupe se lit et se bascule sur lui. */
  const groupByRel = useMemo(() => new Map(groups.map((g) => [g.relativePath, g])), [groups]);
  /** Ce qui partira : les éléments COCHÉS, dans l'ordre du lot. */
  const picked = useMemo(() => checkedItems(shareable, checked), [shareable, checked]);
  const counts = pickerCounts(shareable, checked);

  const [selectedUserId, setSelectedUserId] = useState('');
  /** `null` = jamais. Rabattu dans ce que le coffre autorise — voir plus bas. */
  const [expiry, setExpiry] = useState<GrantExpiryChoice>(null);
  /** Les grants PAR élément — `null` tant qu'on ne sait pas (ou au-delà du plafond). */
  const [grantsByItem, setGrantsByItem] = useState<Map<string, ItemGrantDTO[]> | null>(null);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  /**
   * La clé de rechargement est la LISTE D'IDS, pas le tableau : les hôtes
   * passent volontiers `items={[item]}` inline, un tableau neuf à chaque rendu
   * — en dépendre relancerait N requêtes à chaque tick, à l'infini.
   */
  const shareableIds = shareable.map((i) => i.id).join('\n');
  const loadGrants = useCallback(async () => {
    if (!listable) {
      setGrantsByItem(null);
      return;
    }
    const ids = shareableIds ? shareableIds.split('\n') : [];
    const entries = await Promise.all(
      ids.map(async (id) => [id, await apiListItemGrants(vaultId, id)] as [string, ItemGrantDTO[]])
    );
    setGrantsByItem(new Map(entries));
  }, [vaultId, shareableIds, listable]);

  useEffect(() => {
    void loadGrants();
  }, [loadGrants]);

  /**
   * L'union des accès porte sur les éléments COCHÉS seulement : décocher un
   * fichier le sort de la liste — le dialogue ne parle que de ce qui partira.
   * Les grants restent chargés pour tout le lot (une requête par élément,
   * une fois) ; c'est la lecture qui se restreint, pas le chargement.
   */
  const rows = useMemo(() => {
    if (!grantsByItem) return [];
    const subset = new Map<string, ItemGrantDTO[]>();
    for (const i of picked) subset.set(i.id, grantsByItem.get(i.id) ?? []);
    return aggregateGrantees(subset);
  }, [grantsByItem, picked]);

  /** Les personnes qui ont DÉJÀ tout ce qui est coché : rien à leur sceller de plus. */
  const fullyCovered = useMemo(() => {
    const set = new Set<string>();
    if (picked.length === 0) return set;
    for (const r of rows) if (r.grants.length >= picked.length) set.add(r.userId);
    return set;
  }, [rows, picked.length]);

  /**
   * À qui proposer le scellement : l'annuaire de l'espace DU COFFRE (P2), moins
   * soi-même et moins ceux qui ont déjà tout ce qui est coché.
   *
   * L'ancienne lecture passait par le trombinoscope d'org, refusé à quiconque
   * n'administre pas l'ESPACE : un admin de coffre invité chez quelqu'un
   * d'autre — le cas le plus ordinaire d'un partage entre deux personnes —
   * voyait une liste vide et le message « invitez-la d'abord dans l'espace »,
   * alors qu'elle y était. La route du coffre pose la porte au bon endroit ;
   * `isVaultAdminRole` est la même condition que celle qui affiche ce corps.
   */
  const directory = useSpaceDirectory(vaultId, isVaultAdminRole(myVaultRole));
  const members: SpaceDirectoryEntry[] = useMemo(
    () => directory.entries.filter((m) => m.userId !== myUserId && !fullyCovered.has(m.userId)),
    [directory.entries, myUserId, fullyCovered]
  );

  /**
   * CE QUE LE COFFRE AUTORISE ICI (F13) — deux réglages, deux points
   * d'application côté serveur, et deux phrases à tenir côté écran.
   *
   * `itemGrantsEnabled = false` ferme la CRÉATION d'un accès ponctuel, et elle
   * seule : les accès déjà donnés continuent de fonctionner. On garde donc la
   * liste des accès existants et son bouton Révoquer — c'est même le seul geste
   * qui reste utile — et on remplace le formulaire par la phrase qui dit ce qui
   * a été fermé, ce qui ne l'a pas été, et où le rouvrir.
   *
   * ON NE DÉCLARE FERMÉ QUE CE QU'ON A LU. Un réglage non lu (panne, route
   * absente) laisse le formulaire ouvert : le serveur refusera avec
   * `grants_disabled`, phrase déjà traduite — alors qu'une section disparue sur
   * une panne réseau ferait chercher une fonctionnalité supprimée.
   */
  const vaultKeyEpoch = useSelector(
    (s: RootState) => selectVaultById(s, vaultId)?.currentKeyEpoch ?? 0
  );
  const vaultSettings = useVaultSettings(vaultId, vaultKeyEpoch);
  const grantsOff = vaultSettings.state === 'ok' && !vaultSettings.settings.itemGrantsEnabled;
  const maxExpiryDays = vaultSettings.settings.grantMaxExpiryDays;

  /**
   * UN PLAFOND REND L'EXPIRATION OBLIGATOIRE : le serveur refuse un accès sans
   * fin dès qu'il y en a un (`grant_expiry_too_far`), parce qu'un accès sans fin
   * le contournerait entièrement. « Jamais » disparaît donc du menu, et un choix
   * devenu illégal — l'hôte a pu poser le plafond pendant que ce dialogue était
   * ouvert — est ramené sur la borne au lieu de partir se faire refuser.
   */
  const expiryChoices = useMemo(() => grantExpiryChoices(maxExpiryDays), [maxExpiryDays]);
  const effectiveExpiry = coerceGrantExpiry(expiry, maxExpiryDays);
  const expiryLabel = useCallback(
    (choice: GrantExpiryChoice) =>
      choice === null
        ? t('teamVaults.grants.expiryNever')
        : t('teamVaults.grants.expiryDays', { count: choice }),
    [t]
  );

  // La même vérification que l'invitation — clé servie + journal + TOFU.
  const kv = usePeerKeyVerification(selectedUserId || null);
  // Zéro élément coché : le bouton est mort — rien à sceller, rien à promettre.
  const canShare = kv.canProceed && !busy && picked.length > 0;

  /** Ce qu'il reste à sceller pour CETTE personne : le COCHÉ moins ce qu'elle a déjà. */
  const remainingFor = (userId: string): VaultItemSummary[] => {
    if (!grantsByItem) return picked;
    return picked.filter(
      (i) => !(grantsByItem.get(i.id) ?? []).some((g) => g.granteeUserId === userId)
    );
  };

  const share = async () => {
    if (!canShare || !kv.sealArgs) return;
    const targets = remainingFor(selectedUserId);
    if (targets.length === 0) {
      // Tout est déjà partagé avec cette personne — le dire, pas rejouer N 409.
      success(t('teamVaults.grants.alreadySharedAll', 'Already shared with this person.'));
      return;
    }
    setBusy(true);
    try {
      // La confirmation hors bande vaut pour CETTE empreinte : épingler UNE fois,
      // avant les N scellements.
      kv.pinAcceptedChange();
      const r = await dispatch(
        createItemGrants({
          vaultId,
          itemIds: targets.map((i) => i.id),
          granteeUserId: selectedUserId,
          ...(effectiveExpiry === null ? {} : { expiresInDays: effectiveExpiry }),
          ...(kv.sealArgs.confirmedFingerprint
            ? { confirmedFingerprint: kv.sealArgs.confirmedFingerprint }
            : {}),
        })
      );
      if (createItemGrants.fulfilled.match(r)) {
        /*
          MÉMORISER L'INTENTION — et seulement pour un partage de DOSSIER.

          `basePath` n'existe que quand le geste part d'un dossier (l'explorateur
          le passe) ; une sélection faite à la main n'en a pas, et il n'y aurait
          rien à rattraper : l'utilisateur a choisi des fichiers, pas un contenant.

          Les EXCLUSIONS sont ce qui reste décoché — c'est la moitié qui
          empêchera un rattrapage de rouvrir ce qu'on vient de retirer.

          L'échec ne remonte PAS à l'utilisateur : les accès, eux, sont scellés.
          Dire « le partage a échoué » après un partage réussi serait faux, et
          l'inviter à recommencer redemanderait N scellements pour rien. Le
          rattrapage est un confort ; son absence ne casse rien.
        */
        if (basePath !== undefined) {
          const exclus = shareable.filter((i) => !checked.has(i.id)).map((i) => i.id);
          void rememberFolderShare(vaultId, vaultKeyEpoch, basePath, selectedUserId, exclus).catch(
            () => undefined
          );
        }
        if (!isBatch) {
          success(t('teamVaults.grants.shared'));
        } else {
          const { granted, skipped } = r.payload;
          success(
            skipped.length > 0
              ? t('teamVaults.grants.sharedManySkipped', {
                  count: granted.length,
                  skipped: skipped.length,
                  defaultValue:
                    '{{count}} items shared ({{skipped}} already shared with this person).',
                })
              : t('teamVaults.grants.sharedMany', {
                  count: granted.length,
                  defaultValue: '{{count}} items shared.',
                })
          );
        }
        setSelectedUserId('');
        await loadGrants();
      } else {
        const fail = r.payload;
        const reason = t(vaultErrorKey(fail?.code ?? '', 'teamVaults.errors.generic'));
        if (isBatch && fail) {
          // Le bilan HONNÊTE : ce qui est passé reste partagé, et on dit où ça
          // s'est arrêté — l'hôte peut relancer, le thunk saute les déjà-scellés.
          error(
            t('teamVaults.grants.batchStopped', {
              done: fail.granted.length + fail.skipped.length,
              total: fail.total,
              reason,
              defaultValue: 'Stopped after {{done}}/{{total}} items: {{reason}}',
            })
          );
          await loadGrants();
        } else {
          error(reason);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  /** Révoquer TOUS les grants d'une personne sur le lot — en séquence, comme le scellement. */
  const revoke = async (row: GranteeRow) => {
    setRevoking(row.userId);
    let rotationPending = false;
    let failed = 0;
    try {
      for (const g of row.grants) {
        const r = await dispatch(
          revokeItemGrant({
            vaultId,
            itemId: g.itemId,
            grantId: g.grantId,
            granteeUserId: row.userId,
          })
        );
        if (revokeItemGrant.fulfilled.match(r)) continue;
        if (r.payload === 'grant_revoked_rotation_failed') {
          // L'accès serveur EST coupé ; la rotation se rejouera au prochain commit.
          rotationPending = true;
        } else {
          failed++;
          // Un refus systémique (coffre verrouillé, réseau) se répéterait N fois.
          error(t(vaultErrorKey(String(r.payload ?? ''), 'teamVaults.errors.generic')));
          break;
        }
      }
      if (failed === 0) {
        if (rotationPending) error(t('teamVaults.grants.revokedRotationPending'));
        else success(t('teamVaults.grants.revoked'));
      }
      await loadGrants();
    } finally {
      setRevoking(null);
    }
  };

  /** Le compte quand la liste n'est pas demandée : les éléments du lot qui ont AU MOINS un grant. */
  const sharedItemCount = useMemo(
    () => picked.filter((i) => (grantMap.get(i.id) ?? 0) > 0).length,
    [picked, grantMap]
  );

  const hasNote = picked.some((i) => i.itemType === 'note');

  return (
    <div className="flex flex-col gap-4">
      {isBatch && (
        <div
          data-no-rubber-band
          className="rounded-lg border border-[var(--color-border-light)] bg-[var(--color-background-secondary)] px-3 py-2"
        >
          {/* « Éléments à partager » — AVANT le choix de la personne : on
              décide de QUOI avant de décider À QUI. Tous cochés par défaut ;
              le compteur dit N sur M sur le lot ENTIER, filtre ou pas. */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm font-medium text-[var(--color-text-primary)] m-0">
              {t('teamVaults.grants.pickerTitle', 'Items to share')}
              <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">
                {t('teamVaults.grants.pickerCount', {
                  checked: counts.checked,
                  total: counts.total,
                  defaultValue: '{{checked}} of {{total}}',
                })}
              </span>
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || counts.checked === counts.total}
                onClick={() => setChecked(checkAll(shareable))}
              >
                {t('teamVaults.grants.pickerAll', 'All')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || counts.checked === 0}
                onClick={() => setChecked(checkNone())}
              >
                {t('teamVaults.grants.pickerNone', 'None')}
              </Button>
            </div>
          </div>
          {shareable.length > PICKER_SEARCH_THRESHOLD && (
            <div className="mt-2">
              <Input
                size="sm"
                fullWidth
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t('teamVaults.grants.pickerSearch', 'Filter items…')}
                aria-label={t('teamVaults.grants.pickerSearch', 'Filter items…')}
              />
            </div>
          )}
          <div
            className="mt-2 max-h-[240px] overflow-y-auto pr-1 flex flex-col gap-2"
            role="group"
            aria-label={t('teamVaults.grants.pickerTitle', 'Items to share')}
          >
            {visibleGroups.length === 0 && (
              <p className="text-xs text-[var(--color-text-tertiary)] m-0">
                {t('teamVaults.grants.pickerNoMatch', 'No item matches.')}
              </p>
            )}
            {visibleGroups.map((group) => {
              // L'état de la case de groupe se lit sur le groupe ENTIER (pas
              // sur la part visible) : une case pleine avec un fichier caché
              // décoché mentirait. Sa bascule porte elle aussi sur le groupe
              // complet, tel que `groupBySubfolder` l'a construit.
              const full = groupByRel.get(group.relativePath) ?? group;
              const state = groupCheckState(full, checked);
              return (
                <div key={group.relativePath || '/'} className="flex flex-col gap-1">
                  <Checkbox
                    size="sm"
                    checked={state === 'all'}
                    indeterminate={state === 'some'}
                    disabled={busy}
                    onChange={() => setChecked((cur) => toggleGroup(cur, full))}
                    label={
                      group.relativePath === ''
                        ? t('teamVaults.grants.pickerRootGroup', 'This folder')
                        : group.relativePath
                    }
                    containerClassName="font-medium"
                  />
                  <ul className="list-none m-0 p-0 pl-6 flex flex-col gap-0.5">
                    {group.items.map((it) => (
                      <li key={it.id}>
                        <Checkbox
                          size="sm"
                          checked={checked.has(it.id)}
                          disabled={busy}
                          onChange={() => setChecked((cur) => toggleItem(cur, it.id))}
                          label={pickerItemName(it) || t('teamVaults.items.untitled')}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          {/* La phrase honnête : le grant est par élément, pas par dossier. */}
          <p className="text-xs text-[var(--color-text-tertiary)] m-0 mt-2">
            {t(
              'teamVaults.grants.batchLaterFilesNote',
              'Files added to this folder later are not included — share them again when they arrive.'
            )}
          </p>
        </div>
      )}

      <p className="text-xs text-[var(--color-text-tertiary)] m-0">
        {t('teamVaults.grants.readOnlyNote')}
        {hasNote ? ` ${t('teamVaults.grants.noRealtimeNote')}` : ''}
      </p>

      {/* LE COFFRE A FERMÉ CETTE PORTE (F13). Le formulaire disparaît, mais la
          liste des accès existants reste dessous : couper la création ne coupe
          pas les accès déjà donnés, et le seul geste qui les referme vraiment
          est la révocation, une par une. La phrase le dit, et dit aussi où
          rouvrir — c'est une décision d'administrateur, pas un manque de droit. */}
      {grantsOff ? (
        <p
          className="text-sm text-[var(--color-text-secondary)] m-0 rounded-lg border border-[var(--color-border-light)] bg-[var(--color-background-secondary)] px-3 py-2"
          role="status"
        >
          {t('teamVaults.grants.disabledHere')}
        </p>
      ) : (
        <>
          {/* Un sélecteur vide dirait « il n'y a personne dans cet espace », ce
              qui est faux quand c'est la lecture qui a échoué — et c'était le
              cas de TOUS les invités jusqu'à P2. */}
          <DirectoryNotice state={directory.state} onRetry={directory.reload} />

          {/* Choisir la personne — déjà dans l'espace, jamais une adresse libre. */}
          <Select
            label={t('teamVaults.grants.memberLabel')}
            placeholder={t('teamVaults.grants.memberPlaceholder')}
            helperText={t('teamVaults.grants.notHereHint')}
            options={members.map((m) => ({ value: m.userId, label: m.email }))}
            value={selectedUserId}
            onChange={(v) => setSelectedUserId(Array.isArray(v) ? (v[0] ?? '') : v)}
            searchable
            fullWidth
          />

          {/* L'empreinte — la même cérémonie que l'invitation, UNE fois pour tout le lot. */}
          {selectedUserId && <KeyVerificationPanel verification={kv} />}

          {/* Expiration — jamais par défaut (décision v1), sauf si le coffre pose
              un plafond : il rend alors l'expiration obligatoire et « jamais »
              n'est plus proposé. */}
          <div className="flex items-end gap-2">
            <Select
              label={t('teamVaults.grants.expiryLabel')}
              helperText={
                maxExpiryDays === null
                  ? undefined
                  : t('teamVaults.grants.expiryCapped', { count: maxExpiryDays })
              }
              size="sm"
              options={expiryChoices.map((c) => ({
                value: c === null ? 'never' : String(c),
                label: expiryLabel(c),
              }))}
              value={effectiveExpiry === null ? 'never' : String(effectiveExpiry)}
              onChange={(v) => {
                const raw = Array.isArray(v) ? (v[0] ?? 'never') : v;
                setExpiry(raw === 'never' ? null : Number(raw));
              }}
            />
            <div className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!canShare}
              onClick={() => void share()}
            >
              {isBatch
                ? t('teamVaults.grants.shareActionMany', {
                    count: picked.length,
                    defaultValue: 'Share {{count}} items',
                  })
                : t('teamVaults.grants.shareAction')}
            </Button>
          </div>
        </>
      )}

      {/* Les accès existants — l'union sur le lot, ou le compte au-delà du plafond. */}
      {!listable && sharedItemCount > 0 && (
        <p className="text-xs text-[var(--color-text-secondary)] m-0 border-t border-[var(--color-border-light)] pt-3">
          {t('teamVaults.grants.batchSharedCount', {
            count: sharedItemCount,
            defaultValue: '{{count}} of these items are already shared with someone.',
          })}
        </p>
      )}
      {rows.length > 0 && (
        <div className="border-t border-[var(--color-border-light)] pt-3">
          <p className="text-xs font-semibold text-[var(--color-text-secondary)] m-0 mb-2">
            {t('teamVaults.grants.accessList')}
          </p>
          <ul className="list-none m-0 p-0 flex flex-col gap-2">
            {rows.map((row) => (
              <li key={row.userId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-[var(--color-text-primary)]">
                  {row.label}
                  {isBatch && (
                    <span className="ml-2 text-[11px] text-[var(--color-text-tertiary)]">
                      {t('teamVaults.grants.onItems', {
                        count: row.grants.length,
                        defaultValue: 'on {{count}} items',
                      })}
                    </span>
                  )}
                  {row.stale && (
                    <span className="ml-2 text-[11px] text-[var(--color-warning-700)]">
                      {t('teamVaults.grants.staleBadge')}
                    </span>
                  )}
                  {!isBatch && row.expiresAt && (
                    <span className="ml-2 text-[11px] text-[var(--color-text-tertiary)]">
                      {t('teamVaults.grants.expiresOn', {
                        date: new Date(row.expiresAt).toLocaleDateString(),
                      })}
                    </span>
                  )}
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  loading={revoking === row.userId}
                  disabled={revoking !== null}
                  title={t('teamVaults.grants.revokeConfirmBody')}
                  onClick={() => void revoke(row)}
                >
                  {t('teamVaults.grants.revoke')}
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-2 mb-0">
            {t('teamVaults.grants.revokeConfirmBody')}
          </p>
        </div>
      )}
    </div>
  );
};

export default ShareItemToPersonBody;
