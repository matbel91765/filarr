/**
 * SettingsTab — les réglages du coffre (F13), en DEUX blocs visuellement
 * séparés.
 *
 * POURQUOI DEUX BLOCS, ET POURQUOI ILS NE PEUVENT PAS ÊTRE MÉLANGÉS. Les deux
 * moitiés n'ont pas la même force, et confondre les deux serait promettre une
 * garantie qui n'existe pas :
 *
 *  · « Appliqué par le serveur » — des entiers, des énumérés, des booléens, EN
 *    CLAIR, parce qu'une règle que le serveur ne peut pas lire n'est pas une
 *    règle. Ce que l'on pose ici, personne ne peut le contourner avec un client
 *    modifié. C'est aussi la raison pour laquelle il n'y a AUCUN champ de texte
 *    dans ce bloc : un texte libre lisible du serveur serait une fuite, pas une
 *    fonctionnalité.
 *  · « Appliqué par votre application » — un bloc scellé sous K_vault que le
 *    serveur range sans jamais l'ouvrir. Lisible par tout membre, et respecté
 *    seulement par les clients à jour. L'écran le DIT en toutes lettres : c'est
 *    la moitié de la vérité qu'un réglage ne peut pas porter tout seul.
 *
 * L'ENREGISTREMENT EST UN COMPARE-AND-SET. On envoie la version qu'on a lue ; si
 * quelqu'un a enregistré entre-temps, le serveur refuse
 * (`settings_version_conflict`) plutôt que d'écraser sa décision. On relit alors,
 * on montre ce qui est enregistré, et on PROPOSE de réappliquer — jamais on ne
 * réécrit par-dessus tout seul : le conflit signifie que deux personnes
 * administrent ce coffre, et la seconde n'a pas plus raison que la première.
 *
 * LE BLOC EST SCELLÉ SOUS LA CLÉ COURANTE, ET SON ÉPOQUE PART AVEC LUI. Le
 * serveur la vérifie (`vault_epoch_conflict`) : il ne l'invente plus. Quand ce
 * qui est enregistré a été scellé sous une clé RÉVOLUE — une rotation faite par
 * un client d'avant cette fiche — on tente quand même de l'ouvrir avec la clé de
 * SON époque (souvent encore en cache) et l'on dit qu'il faut le ré-enregistrer.
 * Sans cela, l'écran afficherait une description vide : un texte qu'on croirait
 * effacé. Ce geste-là EXISTE vraiment : le plan reçoit `forceReseal`, sans quoi
 * deux encodages identiques laisseraient le bouton éteint et l'avertissement à
 * demeure.
 *
 * ET QUAND ON N'A PAS SU L'OUVRIR, C'EST L'INVERSE QU'IL FAUT FAIRE. Les mêmes
 * causes (un bloc sans époque déclarée, une clé d'époque absente de cet appareil,
 * un tag AES-GCM qui refuse) donnent un champ vide qui n'est PAS la description du
 * coffre. Y afficher « ré-enregistrez » ferait sceller ce vide, sans les champs
 * portés, par-dessus un texte qu'un autre membre ouvre encore. Les deux phrases ne
 * s'excluent donc pas : `settingsBlockNotice` tranche, le champ se ferme, et le
 * bloc ne part pas.
 *
 * NI ÉTAT VIDE NI TABLEAU ICI. Un réglage a toujours une valeur — celle du
 * coffre, ou son défaut. Le seul état « autre » possible est l'échec de lecture,
 * et il dit qu'il en est un, avec son Réessayer.
 *
 * DEUX CARTES DE PLUS DANS LA MOITIÉ « SERVEUR » (F20/F24), et elles ne sont pas
 * rangées avec les autres par hasard. « Conservation » et « Stockage » sont
 * appliquées par le SERVEUR SEUL — c'est le balayage qui détruit, c'est le
 * contrôle de quota qui refuse, l'un comme l'autre sans qu'aucune application
 * soit ouverte. Elles ont leur propre carte parce qu'elles ne parlent ni
 * d'invitations ni de permissions mais de ce qui DISPARAÎT et de ce qui NE
 * RENTRE PLUS, et parce que l'audit du worker les nomme déjà ainsi
 * (`retention`, `storage`).
 *
 * DEUX REFUS DE CES CARTES NE SONT PAS DES PANNES, et l'écran les traite à part :
 * `retention_over_policy` (la politique de l'espace HÔTE plafonne — on cite le
 * plafond quand le serveur le donne) et le fait qu'un plafond de stockage SOUS
 * l'usage courant soit parfaitement acceptable côté serveur, mais doive être
 * signalé avant l'enregistrement : il ne détruit rien, il refuse la suite.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmModal, Input, ProgressBar, Select, Toggle } from '../../ui';
import { Skeleton } from '../../ui/Skeleton/Skeleton';
import { useNotification } from '../../ui/Notification';
import { AdminSection, InfoCallout, RelativeTime } from '../../settings/enterprise/AdminPrimitives';
import { getVaultKey } from '../../../../services/vault/vaultKeyCache';
import { encryptVaultBlob } from '../../../../services/vault/vaultCrypto';
import {
  VaultRetentionPolicyError,
  apiPutVaultSettings,
} from '../../../../services/vault/vaultApi';
import { errorText, vaultErrorKey } from '../../../../services/vault/vaultErrorMessages';
import { formatBytes } from '../useVaultBrowser';
import type { VaultManagement } from './useVaultManagement';
import type { VaultStatsHandle } from './useVaultStats';
import {
  DEFAULT_VAULT_SETTINGS,
  MAX_GRANT_EXPIRY_DAYS,
  MAX_RETAINED_REVISIONS,
  MAX_VAULT_DESCRIPTION,
  MIN_RETAINED_REVISIONS,
  TRASH_RETENTION_CHOICES,
  VAULT_INVITE_ROLES,
  clampGrantMaxExpiryDays,
  encodeVaultSettingsBlock,
  formatStorageCapGb,
  inviteTtlChoices,
  parseStorageCapGb,
  settingsBlockNotice,
  storageCapUsage,
  vaultSettingsSavePlan,
  type VaultInviteRole,
  type VaultSettingsDraft,
} from './vaultSettingsModel';

interface Props {
  vaultId: string;
  /** L'époque COURANTE du coffre — celle sous laquelle on scelle le bloc. */
  currentKeyEpoch: number;
  mgmt: VaultManagement;
  /**
   * Les agrégats du coffre (F07), pour la JAUGE du plafond de stockage (F24).
   *
   * Ils viennent de la PAGE, jamais d'une lecture propre à cet onglet : le seau
   * du worker est de 120 lectures par heure et par COFFRE, pour tous ses membres
   * à la fois. Ils peuvent être absents (429, panne) — la jauge se tait alors,
   * elle n'affiche pas zéro.
   */
  stats: VaultStatsHandle;
}

const SlidersIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const AppIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

/**
 * Une ligne « intitulé + explication + commande ». DÉFINIE AU NIVEAU DU MODULE :
 * un composant déclaré dans le corps du rendu change d'identité à chaque rendu,
 * donc React le démonte et le remonte — et le champ de saisie qu'il contient
 * perdrait le focus à chaque frappe.
 */
const SettingRow: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  /* F28 — `ent-stack` : sous 840 px, le libellé et son contrôle s'EMPILENT. Côte
     à côte, un plancher de 140 px pour le contrôle et une phrase d'explication de
     deux lignes ne tiennent pas dans 290 px de large — le texte se réduisait à
     un mot par ligne bien avant que quoi que ce soit ne déborde. La bande est
     posée par la console (`ent-console--band-compact`) : cette carte n'a pas à
     mesurer quoi que ce soit pour elle-même. */
  <div className="ent-stack flex items-start justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <div className="text-sm font-medium text-[var(--color-text-primary)]">{label}</div>
      {hint && <div className="text-xs mt-0.5 text-[var(--color-text-secondary)]">{hint}</div>}
    </div>
    <div className="shrink-0" style={{ minWidth: 140 }}>
      {children}
    </div>
  </div>
);

const HardDriveIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="22" y1="12" x2="2" y2="12" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    <line x1="6" y1="16" x2="6.01" y2="16" />
    <line x1="10" y1="16" x2="10.01" y2="16" />
  </svg>
);

const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export const SettingsTab: React.FC<Props> = ({ vaultId, currentKeyEpoch, mgmt, stats }) => {
  const { t } = useTranslation();
  const { success, error } = useNotification();
  const settings = mgmt.settings;

  /**
   * CE QUI EST ENREGISTRÉ, tel que le serveur le rend — la référence du diff.
   * Reconstruit à chaque rendu depuis le chargeur : c'est lui qui possède l'état,
   * cet onglet n'en garde qu'un brouillon.
   */
  const saved: VaultSettingsDraft = useMemo(
    () => ({ settings: settings.settings, block: settings.block }),
    [settings.settings, settings.block]
  );

  const [draft, setDraft] = useState<VaultSettingsDraft>(saved);
  const [busy, setBusy] = useState(false);
  /** Le brouillon qu'un conflit a mis de côté — pour pouvoir le réappliquer. */
  const [conflict, setConflict] = useState<VaultSettingsDraft | null>(null);
  /**
   * LE PLAFOND TEL QU'IL EST TAPÉ, le temps de la saisie — `null` = « suis le
   * brouillon ».
   *
   * Le brouillon, lui, reste TOUJOURS dans les bornes du serveur : c'est ce qui
   * garantit qu'aucune frappe de trop ne parte telle quelle. Mais rabattre à
   * l'affichage à chaque frappe faisait sauter le champ sous les doigts — taper
   * le « 0 » de « 60 » écrivait « 1 » à la place, et il fallait l'effacer pour
   * continuer. On montre donc ce qui est tapé jusqu'à ce que le champ soit
   * quitté, moment où il retombe sur la valeur bornée.
   */
  const [grantMaxTyped, setGrantMaxTyped] = useState<string | null>(null);
  /**
   * LE PLAFOND DE STOCKAGE TEL QU'IL EST TAPÉ (F24) — même raison, même remède
   * que ci-dessus. Le brouillon, lui, ne quitte jamais les bornes du serveur :
   * `parseStorageCapGb` rabat, et c'est cette valeur-là qui partira.
   */
  const [capTyped, setCapTyped] = useState<string | null>(null);

  /**
   * REPARTIR DE CE QUE LE SERVEUR DIT, à chaque fois qu'il le dit autrement.
   *
   * La signature est la seule dépendance : elle change quand la version, les
   * réglages ou le bloc changent, et à ce moment-là seulement. Dépendre des
   * objets eux-mêmes remettrait le brouillon à zéro à chaque rendu (le chargeur
   * les reconstruit), c'est-à-dire à chaque frappe.
   */
  const signature = useMemo(
    () =>
      [
        settings.stored?.version ?? -1,
        JSON.stringify(settings.settings),
        JSON.stringify(settings.block),
      ].join('|'),
    [settings.stored?.version, settings.settings, settings.block]
  );
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    setDraft(savedRef.current);
    // La frappe en cours porte sur un état que le serveur vient de remplacer :
    // la garder afficherait un nombre qui n'est plus celui de personne.
    setGrantMaxTyped(null);
    setCapTyped(null);
  }, [signature]);

  /**
   * CE QU'ON DIT DU BLOC SCELLÉ, ET CE QU'ON S'AUTORISE À EN FAIRE.
   *
   * Un seul prédicat, utilisé TROIS fois — la phrase affichée, le rescellement
   * forcé du plan, et la fermeture du champ de description — parce que les trois
   * décisions sont la même : un bloc lu se rescelle, un bloc jamais ouvert ne
   * s'écrit pas. Les séparer, c'était promettre un geste infaisable d'un côté et
   * en offrir un destructeur de l'autre.
   */
  const notice = settingsBlockNotice({
    seal: settings.seal,
    blockReadable: settings.blockReadable,
    hasStoredBlock: !!settings.stored?.encrypted,
  });

  const plan = useMemo(
    () => vaultSettingsSavePlan(saved, draft, { forceReseal: notice.reseal }),
    [saved, draft, notice.reseal]
  );
  /**
   * « Réinitialiser » ne parle que de ce qui a été TAPÉ. Le rescellement forcé
   * allume Enregistrer sans qu'un seul champ ait bougé : proposer d'annuler une
   * saisie qui n'existe pas ferait chercher ce qu'on aurait changé.
   */
  const dirty = useMemo(() => !vaultSettingsSavePlan(saved, draft).empty, [saved, draft]);

  const setSetting = useCallback(
    (patch: Partial<typeof DEFAULT_VAULT_SETTINGS>) =>
      setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } })),
    []
  );

  /**
   * Enregistrer. Prend le brouillon EN ARGUMENT plutôt que dans la portée : la
   * reprise après conflit rejoue exactement le brouillon mis de côté, pas celui
   * que la relecture vient de remettre à la place.
   */
  const save = useCallback(
    async (candidate: VaultSettingsDraft) => {
      const p = vaultSettingsSavePlan(saved, candidate, { forceReseal: notice.reseal });
      if (p.empty) {
        // ON LE DIT, ON NE SORT PAS EN SILENCE. Le bouton Enregistrer est éteint
        // quand il n'y a rien à faire ; le seul chemin qui arrive ici est la
        // REPRISE après conflit, quand l'autre administrateur a justement
        // enregistré ce qu'on voulait. Fermer la fenêtre sans un mot laisserait
        // croire que la reprise a échoué.
        success(t('teamVaults.settings.edit.noChangeNeeded'));
        return;
      }
      if (p.block && notice.unreadable) {
        // JAMAIS un bloc qu'on n'a pas su ouvrir. Le champ est fermé dans ce cas,
        // donc ce chemin ne reste ouvert que par la REPRISE après conflit, dont le
        // brouillon a pu être capturé avant que la clé ne manque. On refuse tout
        // l'enregistrement, comme pour une clé indisponible : la moitié en clair
        // passée toute seule laisserait croire que la description est partie aussi.
        error(t('teamVaults.settings.edit.blockUnreadable'));
        return;
      }
      setBusy(true);
      try {
        const body: Parameters<typeof apiPutVaultSettings>[1] = {
          // `version: 0` = aucune ligne enregistrée : c'est la valeur qu'attend
          // la PREMIÈRE écriture, pas une version inconnue.
          expectedVersion: settings.stored?.version ?? 0,
        };
        if (p.patch) body.patch = p.patch as Record<string, unknown>;
        if (p.block) {
          // LA CLÉ DE L'ÉPOQUE COURANTE, et elle seule : le serveur vérifie
          // l'époque déclarée et refuse un scellé fait sous une clé révolue,
          // plutôt que de condamner le bloc pour tous les membres.
          const kVault = getVaultKey(vaultId, currentKeyEpoch);
          if (!kVault) {
            // On refuse TOUT l'enregistrement, y compris sa moitié en clair :
            // enregistrer la moitié qui passe laisserait croire que le reste est
            // passé aussi, et l'écran afficherait ensuite un brouillon propre
            // au-dessus d'un serveur qui n'a rien reçu de la description.
            error(t('teamVaults.settings.edit.sealFailed'));
            return;
          }
          const { ciphertext, iv } = await encryptVaultBlob(
            encodeVaultSettingsBlock(p.block),
            kVault
          );
          body.encrypted = {
            settingsEncrypted: ciphertext,
            settingsIv: iv,
            sealedEpoch: currentKeyEpoch,
          };
        }
        await apiPutVaultSettings(vaultId, body);
        setConflict(null);
        success(t('teamVaults.settings.edit.saved'));
        await settings.reload();
        // Les réglages changent l'effectif futur (rôle par défaut, validité) :
        // les agrégats partagés doivent les revoir.
        mgmt.afterRosterChange();
      } catch (e) {
        /**
         * LA POLITIQUE DE L'ESPACE PLAFONNE LA CONSERVATION (F20), et ce refus
         * n'est PAS une saisie mal formée : la valeur demandée est légitime,
         * c'est l'espace HÔTE qui la borne — souvent celui de quelqu'un d'autre.
         * L'écran doit donc dire lequel des deux réglages céder, et citer le
         * plafond QUAND le serveur le donne. La phrase générique des 400
         * (« vérifiez votre saisie ») enverrait chercher une faute inexistante.
         */
        if (e instanceof VaultRetentionPolicyError) {
          error(
            e.limitDays === null
              ? t('teamVaults.settings.edit.retention.overPolicy')
              : t('teamVaults.settings.edit.retention.overPolicyCapped', { days: e.limitDays })
          );
          return;
        }
        const code = errorText(e);
        if (code === 'host_plan_lapsed') settings.notePlanRefusal();
        if (code === 'settings_version_conflict') {
          // Quelqu'un d'autre administre ce coffre. On garde ce qui vient d'être
          // tapé, on relit ce qui est enregistré, et on PROPOSE — écraser sa
          // décision sans la montrer serait le contraire d'un compare-and-set.
          setConflict(candidate);
          await settings.reload();
          return;
        }
        if (code === 'vault_epoch_conflict') {
          // L'AUTRE MOITIÉ DE L'HISTOIRE DES ÉPOQUES, et elle doit se lire comme
          // la première (`seal === 'superseded'`). La clé du coffre a tourné
          // entre le moment où l'on a scellé et celui où le serveur a lu : il
          // refuse TOUT l'enregistrement, y compris sa moitié en clair — rien
          // n'a été écrit. La phrase générique des concurrences (« réessayez »)
          // serait fausse ici : rejouer avec la même époque se ferait refuser à
          // l'identique tant que cet écran n'a pas repris la clé neuve.
          error(t('teamVaults.settings.edit.epochMoved'));
          return;
        }
        error(t(vaultErrorKey(code, 'teamVaults.errors.settingsSaveFailed')));
      } finally {
        setBusy(false);
      }
    },
    [
      saved,
      settings,
      vaultId,
      currentKeyEpoch,
      notice.reseal,
      notice.unreadable,
      success,
      error,
      t,
      mgmt,
    ]
  );

  /**
   * ── TANT QU'ON N'A RIEN LU, ON N'AFFIRME RIEN ──────────────────────────────
   *
   * Sans cette branche, la première image de l'écran était le formulaire rempli
   * avec les DÉFAUTS (7 jours, membre, partage ouvert, aucun plafond) : des
   * valeurs plausibles et fausses pour un coffre réglé autrement, que l'hôte
   * pouvait lire comme l'état du coffre. Pire, un interrupteur basculé dans
   * cette fenêtre était jeté sans un mot quand la vraie ligne arrivait (l'effet
   * de `signature` repart de ce que le serveur dit). Aucune mauvaise écriture
   * n'en sortait — le compare-and-set part avec `expectedVersion: 0` et le
   * serveur répond 409 — mais l'écran mentait le temps d'un aller-retour.
   *
   * `stored` plutôt que le seul `state` : une RELECTURE (après enregistrement,
   * après conflit) repasse par `loading`, et remplacer alors la page entière par
   * des rectangles gris ferait clignoter un écran qu'on est en train de lire.
   */
  if (settings.state === 'loading' && !settings.stored) {
    return (
      <div className="space-y-4" role="status" aria-label={t('common.loading')}>
        <Skeleton height="12rem" borderRadius="0.75rem" />
        <Skeleton height="9rem" borderRadius="0.75rem" />
      </div>
    );
  }

  // ── L'échec de lecture passe avant tout ───────────────────────────────────
  if (settings.state === 'unavailable') {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 p-4">
        <p className="text-sm text-[var(--color-text-primary)] m-0">
          {t('teamVaults.settings.edit.loadFailed')}
        </p>
        <Button size="sm" variant="secondary" onClick={() => void settings.reload()}>
          {t('teamVaults.retry')}
        </Button>
      </div>
    );
  }

  const grantsOff = !draft.settings.itemGrantsEnabled;
  const updatedAtMs = settings.stored?.updatedAt ? Date.parse(settings.stored.updatedAt) : NaN;

  /**
   * CE QUE LE COFFRE OCCUPE — `null` quand on n'a rien lu, jamais zéro.
   *
   * Un `?? 0` peindrait une jauge vide sur un coffre plein : c'est exactement
   * l'erreur qu'un chiffre affiché comme un fait ne pardonne pas. La règle est
   * celle des agrégats depuis F07, et elle vaut ici aussi.
   */
  const usedBytes = stats.stats ? stats.stats.storageUsedBytes : null;
  /** La jauge suit le BROUILLON : on voit ce qu'un plafond ferait avant de l'enregistrer. */
  const capUsage =
    usedBytes === null
      ? null
      : storageCapUsage({ capBytes: draft.settings.storageCapBytes, usedBytes });

  return (
    <div className="space-y-4">
      {/* ── APPLIQUÉ PAR LE SERVEUR ─────────────────────────────────────────── */}
      <AdminSection
        title={t('teamVaults.settings.edit.server.title')}
        description={t('teamVaults.settings.edit.server.hint')}
        icon={<SlidersIcon />}
      >
        <SettingRow
          label={t('teamVaults.settings.edit.ttl.label')}
          hint={t('teamVaults.settings.edit.ttl.hint')}
        >
          <Select
            size="sm"
            ariaLabel={t('teamVaults.settings.edit.ttl.label')}
            // LES PALIERS, PLUS CE QUE CE COFFRE PORTE DÉJÀ. Le serveur accepte
            // n'importe quel entier de 1 à 30 : un coffre réglé à 21 jours par
            // un autre client affichait un menu VIDE — le champ mentait sur
            // l'état du coffre, et rien n'était écrit pour autant (le correctif
            // est partiel). L'enregistré ET le brouillon, pour que
            // « Réinitialiser » reste affichable.
            options={inviteTtlChoices([
              saved.settings.inviteTtlDays,
              draft.settings.inviteTtlDays,
            ]).map((days) => ({
              value: String(days),
              label: t('teamVaults.settings.edit.ttl.days', { count: days }),
            }))}
            value={String(draft.settings.inviteTtlDays)}
            onChange={(v) => setSetting({ inviteTtlDays: Number(Array.isArray(v) ? v[0] : v) })}
            disabled={busy}
          />
        </SettingRow>

        <SettingRow
          label={t('teamVaults.settings.edit.defaultRole.label')}
          hint={t('teamVaults.settings.edit.defaultRole.hint')}
        >
          <Select
            size="sm"
            ariaLabel={t('teamVaults.settings.edit.defaultRole.label')}
            options={VAULT_INVITE_ROLES.map((r) => ({
              value: r,
              label: t(`teamVaults.role.${r}`, r),
            }))}
            value={draft.settings.defaultInviteRole}
            onChange={(v) =>
              setSetting({
                defaultInviteRole: (Array.isArray(v) ? v[0] : v) as VaultInviteRole,
              })
            }
            disabled={busy}
          />
        </SettingRow>

        {/* F21 — LA RELANCE AUTOMATIQUE, ET SA PLACE EST ICI, juste sous la durée
            de validité : c'est LA MÊME question vue de l'autre bout. La durée dit
            combien de temps une invitation vit ; ce réglage dit ce qui se passe
            quand elle est sur le point de mourir. Le défaut est ACTIF, parce que
            l'absence de rappel est précisément ce qui a coûté un accès — une
            invitation morte de vieillesse chez un hôte qui la croyait donnée. */}
        <SettingRow
          label={t('teamVaults.settings.edit.autoRemind.label')}
          hint={t('teamVaults.settings.edit.autoRemind.hint')}
        >
          <Toggle
            checked={draft.settings.autoRemindInvites}
            onChange={(e) => setSetting({ autoRemindInvites: e.target.checked })}
            disabled={busy}
            aria-label={t('teamVaults.settings.edit.autoRemind.label')}
          />
        </SettingRow>

        <SettingRow
          label={t('teamVaults.settings.edit.grants.label')}
          hint={t('teamVaults.settings.edit.grants.hint')}
        >
          <Toggle
            checked={draft.settings.itemGrantsEnabled}
            onChange={(e) => setSetting({ itemGrantsEnabled: e.target.checked })}
            disabled={busy}
            aria-label={t('teamVaults.settings.edit.grants.label')}
          />
        </SettingRow>

        <SettingRow
          label={t('teamVaults.settings.edit.grantMax.label')}
          hint={t('teamVaults.settings.edit.grantMax.hint')}
        >
          <Input
            type="number"
            size="sm"
            min={1}
            max={MAX_GRANT_EXPIRY_DAYS}
            // Le plafond ne veut rien dire quand la porte est fermée : le grisé
            // dit « ce champ dépend de celui du dessus », là où le retirer
            // ferait chercher un réglage qui a simplement l'air d'avoir disparu.
            // Le grisé ne RETIRE pas la valeur du brouillon : elle part donc dans le
            // correctif même quand la porte vient d'être fermée dans le même
            // enregistrement. C'est voulu — le serveur l'accepte, et c'est la bonne
            // valeur le jour où la porte se rouvre.
            disabled={busy || grantsOff}
            placeholder={t('teamVaults.settings.edit.grantMax.placeholder')}
            aria-label={t('teamVaults.settings.edit.grantMax.label')}
            // Ce qui est TAPÉ pendant la saisie, la valeur bornée sinon.
            value={grantMaxTyped ?? draft.settings.grantMaxExpiryDays ?? ''}
            onChange={(e) => {
              setGrantMaxTyped(e.target.value);
              setSetting({
                grantMaxExpiryDays:
                  e.target.value === '' ? null : clampGrantMaxExpiryDays(Number(e.target.value)),
              });
            }}
            // Quitter le champ le rend à sa valeur bornée : c'est elle qui
            // partira, et l'écran ne doit pas montrer autre chose que ce qu'il
            // s'apprête à enregistrer.
            onBlur={() => setGrantMaxTyped(null)}
          />
        </SettingRow>

        <SettingRow
          label={t('teamVaults.settings.edit.deleteAdmin.label')}
          hint={t('teamVaults.settings.edit.deleteAdmin.hint')}
        >
          <Toggle
            checked={draft.settings.itemDeleteRequiresAdmin}
            onChange={(e) => setSetting({ itemDeleteRequiresAdmin: e.target.checked })}
            disabled={busy}
            aria-label={t('teamVaults.settings.edit.deleteAdmin.label')}
          />
        </SettingRow>
      </AdminSection>

      {/* ── CONSERVATION (F20) ──────────────────────────────────────────────
          DEUX RÈGLES QUE LE SERVEUR APPLIQUE SEUL, y compris quand personne
          n'ouvre l'application : c'est le BALAYAGE qui détruit, pas le client.
          Elles sont donc en clair, dans la même moitié que le bloc du dessus —
          une conservation que le serveur ne pourrait pas lire ne conserverait
          rien. Elles ont leur propre carte parce qu'elles ne parlent ni
          d'invitations ni de permissions : elles parlent de ce qui DISPARAÎT, et
          l'audit du worker les range déjà sous leur propre nom (`retention`). */}
      <AdminSection
        title={t('teamVaults.settings.edit.retention.title')}
        description={t('teamVaults.settings.edit.retention.hint')}
        icon={<ClockIcon />}
      >
        <SettingRow
          label={t('teamVaults.settings.edit.retention.days.label')}
          hint={t('teamVaults.settings.edit.retention.days.hint')}
        >
          <Select
            size="sm"
            ariaLabel={t('teamVaults.settings.edit.retention.days.label')}
            /* UNE ÉNUMÉRATION, PAS UN INTERVALLE, et le menu ne propose donc que
               les quatre paliers. Contrairement à la validité d'invitation, on
               n'INJECTE jamais la valeur du coffre : la requête de balayage
               compare la valeur stockée à cette même liste avant de s'en servir,
               si bien qu'une durée hors liste retombe déjà sur le défaut à la
               lecture — l'écran ne peut donc pas en afficher une. */
            options={TRASH_RETENTION_CHOICES.map((days) => ({
              value: String(days),
              label: t('teamVaults.settings.edit.retention.days.option', { count: days }),
            }))}
            value={String(draft.settings.trashRetentionDays)}
            onChange={(v) =>
              setSetting({ trashRetentionDays: Number(Array.isArray(v) ? v[0] : v) })
            }
            disabled={busy}
          />
        </SettingRow>

        <SettingRow
          label={t('teamVaults.settings.edit.retention.revisions.label')}
          hint={t('teamVaults.settings.edit.retention.revisions.hint')}
        >
          <Select
            size="sm"
            ariaLabel={t('teamVaults.settings.edit.retention.revisions.label')}
            /* UN MENU PLUTÔT QU'UN CHAMP DE NOMBRE : la plage est de dix valeurs,
               et un menu ne peut pas produire de valeur hors borne — ce qu'un
               `input type=number` fait à la moindre frappe. */
            options={Array.from(
              { length: MAX_RETAINED_REVISIONS - MIN_RETAINED_REVISIONS + 1 },
              (_, i) => MIN_RETAINED_REVISIONS + i
            ).map((n) => ({
              value: String(n),
              label: t('teamVaults.settings.edit.retention.revisions.option', { count: n }),
            }))}
            value={String(draft.settings.retainedRevisions)}
            onChange={(v) => setSetting({ retainedRevisions: Number(Array.isArray(v) ? v[0] : v) })}
            disabled={busy}
          />
        </SettingRow>
      </AdminSection>

      {/* ── STOCKAGE (F24) ──────────────────────────────────────────────────
          LE PLAFOND NE RÉSERVE RIEN, et l'écran doit le dire : le pool mutualisé
          de l'espace reste la limite réelle, un coffre plafonné à 50 Go dans un
          espace plein est refusé par le POOL. Ce curseur répond au seul cas que
          le pool ne sait pas traiter — un coffre qui mange la place des autres —
          et c'est pour cela que son refus a son propre code
          (`vault_quota_exceeded`) et sa propre phrase. */}
      <AdminSection
        title={t('teamVaults.settings.edit.storage.title')}
        description={t('teamVaults.settings.edit.storage.hint')}
        icon={<HardDriveIcon />}
      >
        <SettingRow
          label={t('teamVaults.settings.edit.storage.cap.label')}
          hint={t('teamVaults.settings.edit.storage.cap.hint')}
        >
          <Input
            type="number"
            size="sm"
            min={0}
            step={1}
            disabled={busy}
            placeholder={t('teamVaults.settings.edit.storage.cap.placeholder')}
            aria-label={t('teamVaults.settings.edit.storage.cap.label')}
            // Ce qui est TAPÉ pendant la saisie, la valeur bornée sinon.
            value={capTyped ?? formatStorageCapGb(draft.settings.storageCapBytes)}
            onChange={(e) => {
              setCapTyped(e.target.value);
              // UN CHAMP VIDE EST « AUCUN PLAFOND », PAS « ZÉRO OCTET » : la
              // nuance décide du sort du coffre, et `Number('')` vaut zéro.
              setSetting({ storageCapBytes: parseStorageCapGb(e.target.value) });
            }}
            onBlur={() => setCapTyped(null)}
          />
        </SettingRow>

        {/* LA JAUGE SE TAIT QUAND ON N'A RIEN LU. Un « 0 Go » de repli sur un
            coffre plein est le genre de chiffre que personne ne soupçonne. */}
        <div className="mt-2">
          {usedBytes === null ? (
            <p className="ent-hint m-0">{t('teamVaults.settings.edit.storage.unknownUsage')}</p>
          ) : capUsage === null ? (
            <p className="ent-hint m-0">
              {t('teamVaults.settings.edit.storage.noCap', { used: formatBytes(usedBytes) })}
            </p>
          ) : (
            <ProgressBar
              value={capUsage.pct}
              size="sm"
              variant={
                capUsage.tone === 'danger'
                  ? 'error'
                  : capUsage.tone === 'warning'
                    ? 'warning'
                    : 'primary'
              }
              label={t('teamVaults.settings.edit.storage.gauge', {
                used: formatBytes(usedBytes),
                limit: formatBytes(draft.settings.storageCapBytes ?? 0),
              })}
              showValue
            />
          )}
        </div>

        {/* DÉJÀ AU-DESSUS : le serveur ACCEPTE ce réglage — il ne détruit rien,
            il refuse la SUITE — et c'est précisément pour cela qu'il faut le dire
            AVANT d'enregistrer. Découvrir le plafond au premier dépôt refusé,
            c'est lire un message sur une limite qu'on a soi-même posée sans le
            savoir. */}
        {capUsage?.over && usedBytes !== null && (
          <div className="mt-2">
            <InfoCallout tone="danger">
              {t('teamVaults.settings.edit.storage.alreadyOver', {
                used: formatBytes(usedBytes),
              })}
            </InfoCallout>
          </div>
        )}
        {capUsage && !capUsage.over && capUsage.tone === 'warning' && (
          <div className="mt-2">
            <InfoCallout>{t('teamVaults.settings.edit.storage.nearLimit')}</InfoCallout>
          </div>
        )}
      </AdminSection>

      {/* ── APPLIQUÉ PAR VOTRE APPLICATION ──────────────────────────────────── */}
      <AdminSection
        title={t('teamVaults.settings.edit.app.title')}
        description={t('teamVaults.settings.edit.app.hint')}
        icon={<AppIcon />}
      >
        <InfoCallout>{t('teamVaults.settings.edit.app.callout')}</InfoCallout>

        {/* LE BLOC A ÉTÉ SCELLÉ SOUS UNE CLÉ RÉVOLUE, ET ON A SU L'OUVRIR. On le dit,
            et le geste existe pour de bon : Enregistrer le rescelle sous la clé
            courante (`forceReseal`), même sans une lettre changée. Sans cette
            phrase, un champ vide ferait croire à une description effacée. */}
        {notice.reseal && (
          <div className="mt-2">
            <InfoCallout tone="danger">{t('teamVaults.settings.edit.sealSuperseded')}</InfoCallout>
          </div>
        )}
        {/* Un bloc qui EXISTE et qu'on n'a pas su ouvrir : distinct de « il n'y a
            pas de description ». Dit MÊME quand la clé est révolue — c'est
            précisément là que « ré-enregistrez » serait destructeur, et c'est aussi
            pour cela que le champ ci-dessous reste fermé. */}
        {notice.unreadable && (
          <div className="mt-2">
            <InfoCallout tone="danger">{t('teamVaults.settings.edit.blockUnreadable')}</InfoCallout>
          </div>
        )}

        <div className="mt-3">
          <Input
            label={t('teamVaults.settings.edit.description.label')}
            // LE COMPTEUR MENTIRAIT ICI : « 0/280 » sur un coffre qui porte bel et
            // bien une description dirait qu'elle a été effacée. On dit plutôt
            // pourquoi le champ est fermé.
            helperText={
              notice.unreadable
                ? t('teamVaults.settings.edit.description.sealedElsewhere')
                : t('teamVaults.settings.edit.description.counter', {
                    used: draft.block.description.length,
                    max: MAX_VAULT_DESCRIPTION,
                  })
            }
            placeholder={t('teamVaults.settings.edit.description.placeholder')}
            maxLength={MAX_VAULT_DESCRIPTION}
            fullWidth
            // FERMÉ plutôt que grisé par prudence : taper ici puis enregistrer
            // scellerait un texte que cet appareil n'a jamais lu par-dessus celui
            // qu'un porteur de l'ancienne clé ouvre encore.
            disabled={busy || notice.unreadable}
            value={draft.block.description}
            onChange={(e) =>
              setDraft((d) => ({ ...d, block: { ...d.block, description: e.target.value } }))
            }
          />
        </div>
      </AdminSection>

      {/* ── LE PIED : qui a enregistré, quand, et les deux boutons ──────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="ent-hint m-0">
          {settings.stored && settings.stored.version > 0 && !Number.isNaN(updatedAtMs) ? (
            <>
              {t('teamVaults.settings.edit.savedBy', {
                // L'adresse est résolue LOCALEMENT (annuaire + lignes du coffre) :
                // le serveur ne rend qu'un identifiant opaque.
                who: settings.stored.updatedBy
                  ? mgmt.display(settings.stored.updatedBy)
                  : t('teamVaults.activity.someone'),
              })}{' '}
              <RelativeTime ms={updatedAtMs} />
            </>
          ) : (
            t('teamVaults.settings.edit.neverSaved')
          )}
        </p>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(saved);
                setGrantMaxTyped(null);
                setCapTyped(null);
              }}
            >
              {t('common.reset')}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={busy || plan.empty}
            onClick={() => void save(draft)}
          >
            {t('common.save')}
          </Button>
        </div>
      </div>

      {/* LE CONFLIT : ce qui est enregistré est déjà revenu à l'écran ; on
          propose de réappliquer PAR-DESSUS, on ne le fait jamais tout seul. */}
      <ConfirmModal
        isOpen={!!conflict}
        onClose={() => setConflict(null)}
        onConfirm={() => {
          const reprise = conflict;
          setConflict(null);
          if (reprise) {
            setDraft(reprise);
            void save(reprise);
          }
        }}
        title={t('teamVaults.settings.edit.conflict.title')}
        message={t('teamVaults.settings.edit.conflict.body')}
        confirmText={t('teamVaults.settings.edit.conflict.reapply')}
        cancelText={t('teamVaults.settings.edit.conflict.discard')}
        variant="warning"
      />
    </div>
  );
};

export default SettingsTab;
