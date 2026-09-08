/**
 * ActivityTab — le fil du coffre : filtrable, comptable, exportable (F12).
 *
 * `VaultActivityPanel` est RÉUTILISÉ SANS COPIE. C'est le même composant que
 * le volet de l'explorateur, que la modale du clic droit d'une carte et que le
 * pied du dialogue de partage : deux vues du même fil qui divergeraient, c'est
 * la panne qu'on ne remarque qu'au moment où l'une des deux ment. Les filtres
 * lui sont PASSÉS ; il ne les invente pas, et les trois autres écrans n'en
 * reçoivent aucun — un filtre par défaut serait un filtre invisible.
 *
 * CE QUE CET ONGLET AJOUTE :
 *
 *  · LA MARQUE « VU », que le panneau ne pose pas lui-même. C'est l'hôte qui
 *    décide de ce qui compte comme « regardé » — `VaultFolderView.toggleActivity`
 *    le faisait pour son volet, et l'ouverture de cet onglet vaut exactement la
 *    même chose, sinon la pastille du rail resterait allumée après lecture. Le
 *    curseur est posé sur la TÊTE du fil NON FILTRÉ : marquer d'après une page
 *    filtrée éteindrait la pastille sur des événements qu'on n'a pas vus.
 *
 *  · LES FILTRES. Quatre menus, et tout ce qui se raisonne est dans
 *    `vaultActivityExport` (familles, types, période) — y compris les deux
 *    gardes qui viennent du contrat du worker : `types=` vide est un 400, et une
 *    sélection qui couvre tout ne s'envoie pas.
 *
 *  · L'EXPORT, construit DANS L'APPLICATION. Les adresses et les titres sont
 *    résolus sur cet appareil (le serveur ne journalise que des identifiants
 *    opaques), l'échappement anti-injection de formule est celui du modèle, et
 *    l'enregistrement passe par la boîte système sur le bureau, par un `Blob`
 *    sur le web (`saveExportFile`).
 *
 * LE PIÈGE QUI A DÉCIDÉ DE LA FORME DU CODE : l'ancre de période. `periodRange`
 * prend un « maintenant », et le recalculer à chaque rendu changerait la borne
 * `since` à chaque milliseconde — donc la signature des filtres, donc la
 * dépendance de l'effet de chargement du panneau, donc une requête par image.
 * L'instant est donc figé dans un état, et il ne bouge QUE quand on change de
 * période.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Button, Checkbox, Modal, Radio, Select } from '../../ui';
import { useNotification } from '../../ui/Notification';
import type { AppDispatch, RootState } from '../../../../store';
import { vaultActivitySeen } from '../../../../store/slices/vaultsSlice';
import {
  apiGetVaultActivity,
  type VaultActivityEventDTO,
} from '../../../../services/vault/vaultApi';
import { vaultErrorKey, errorText } from '../../../../services/vault/vaultErrorMessages';
import { AdminSection } from '../../settings/enterprise/AdminPrimitives';
import { VaultActivityPanel } from '../VaultActivityPanel';
import { setSeenCursor } from '../vaultActivitySeen';
import {
  ACTIVITY_FAMILY_IDS,
  ACTIVITY_PERIOD_IDS,
  activityQueryTypes,
  buildActivityExport,
  familyEventTypes,
  periodRange,
  type ActivityFamilyId,
  type ActivityPeriodId,
} from './vaultActivityExport';
import { saveExportFile } from './saveExportFile';
import type { VaultManagement } from './useVaultManagement';
import type { MemberKeyWatch } from './useMemberKeyWatch';

/**
 * Le plafond de la route (200) et le nombre de pages qu'un export accepte de
 * tirer. Quatre mille lignes couvrent très largement un coffre réel sur
 * quatre-vingt-dix jours ; au-delà, le fichier le DIT (`truncated`) plutôt que
 * de s'arrêter en silence — un export court se lirait sinon « il ne s'est rien
 * passé », le silence exact que cette fiche existe pour supprimer.
 */
const EXPORT_PAGE_SIZE = 200;
const EXPORT_MAX_PAGES = 20;

interface Props {
  vaultId: string;
  /** Le nom déchiffré — il ne sert QU'au nom du fichier proposé. */
  vaultName: string;
  mgmt: VaultManagement;
  /** Les titres déchiffrés par la page — jamais rien du serveur. */
  nameByItemId: ReadonlyMap<string, string>;
  /** Le contrôle des clés (F11) : la case « inclure l'état de confiance ». */
  trust: MemberKeyWatch;
  /** L'époque courante du coffre : la case « couverture d'époques » (F10). */
  currentKeyEpoch: number;
}

export const ActivityTab: React.FC<Props> = ({
  vaultId,
  vaultName,
  mgmt,
  nameByItemId,
  trust,
  currentKeyEpoch,
}) => {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const { success, error } = useNotification();
  const myUserId = useSelector((s: RootState) => s.auth.cloudUser?.id ?? null);

  // ── La marque « vu » ───────────────────────────────────────────────────────
  /**
   * Une seule pose de curseur par montage : sans ce garde, un rendu déclenché
   * par autre chose relancerait la requête et réécrirait la marque à chaque
   * passage.
   */
  const marked = useRef(false);

  useEffect(() => {
    if (!myUserId || marked.current) return () => {};
    marked.current = true;
    let vivant = true;
    // SANS FILTRE, délibérément : la marque dit « j'ai vu la tête du fil ». La
    // poser d'après une page filtrée éteindrait la pastille du rail pour des
    // événements que la sélection cachait.
    void apiGetVaultActivity(vaultId, { limit: 50 })
      .then((page) => {
        const head = page.events[0];
        if (!vivant || !head) return;
        setSeenCursor(myUserId, vaultId, { occurredAt: head.occurredAt, id: head.id });
        // Le curseur vit dans localStorage, que rien n'observe : on réveille le
        // sélecteur de pastille pour que la carte de l'accueil s'éteigne sans
        // attendre une relecture des têtes.
        dispatch(vaultActivitySeen(vaultId));
      })
      .catch(() => {
        // Pas de marque « vu » : le panneau ci-dessous dira lui-même l'erreur.
      });
    return () => {
      vivant = false;
    };
  }, [vaultId, myUserId, dispatch]);

  // ── Les filtres ───────────────────────────────────────────────────────────
  const [families, setFamilies] = useState<ActivityFamilyId[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [actor, setActor] = useState('');
  const [period, setPeriod] = useState<ActivityPeriodId>('all');
  /**
   * L'INSTANT DE RÉFÉRENCE DE LA PÉRIODE — voir l'en-tête. Figé, et renouvelé
   * seulement quand on change de période : `Date.now()` au rendu ferait une
   * requête par image.
   */
  const [periodAnchor, setPeriodAnchor] = useState(() => Date.now());

  const typeOptions = useMemo(() => {
    const cibles: ActivityFamilyId[] = families.length === 0 ? [...ACTIVITY_FAMILY_IDS] : families;
    return cibles.flatMap((f) =>
      familyEventTypes(f).map((value) => ({
        value,
        // La clé i18n du fil est à UNDERSCORES (voir `vaultActivityModel`) : on
        // réutilise EXACTEMENT les libellés des lignes, sinon le menu et le fil
        // nommeraient différemment la même chose.
        label: t(`teamVaults.activity.type.${value.replace(/\./g, '_')}`, value),
      }))
    );
  }, [families, t]);

  const actorOptions = useMemo(
    () => [
      { value: '', label: t('teamVaults.activity.filter.anyActor') },
      ...mgmt.rows.map((r) => ({ value: r.userId, label: r.label })),
    ],
    [mgmt.rows, t]
  );

  const range = useMemo(() => periodRange(period, periodAnchor), [period, periodAnchor]);
  const queryTypes = useMemo(() => activityQueryTypes({ families, types }), [families, types]);
  const filter = useMemo(
    () => ({
      types: queryTypes,
      actor: actor || null,
      since: range.since ?? null,
      until: range.until ?? null,
    }),
    [queryTypes, actor, range]
  );
  const filtered = families.length > 0 || types.length > 0 || actor !== '' || period !== 'all';

  // ── Le compteur ───────────────────────────────────────────────────────────
  const [pageInfo, setPageInfo] = useState({ count: 0, recorded: true, hasMore: false });
  /**
   * STABLE, et c'est une condition de bon fonctionnement : le panneau appelle ce
   * rappel depuis un effet qui en dépend. Une fonction recréée à chaque rendu
   * ferait boucler l'effet.
   */
  const onPage = useCallback(
    (info: { count: number; recorded: boolean; hasMore: boolean }) => setPageInfo(info),
    []
  );

  // ── L'export ──────────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [exportPeriod, setExportPeriod] = useState<ActivityPeriodId>('all');
  const [withTrust, setWithTrust] = useState(false);
  const [withEpochs, setWithEpochs] = useState(false);
  const [exporting, setExporting] = useState(false);

  const emailByUserId = useMemo(
    () => new Map(Object.entries(mgmt.emailByUserId)),
    [mgmt.emailByUserId]
  );

  const runExport = async () => {
    setExporting(true);
    try {
      const maintenant = Date.now();
      const bornes = periodRange(exportPeriod, maintenant);
      const evenements: VaultActivityEventDTO[] = [];
      let cursor: string | null = null;
      let recorded = true;
      let truncated = false;
      let pages = 0;
      // Les pages sont tirées EN SÉQUENCE avec le curseur keyset : la même
      // sélection à chaque tour, sinon la « suite » n'en serait pas une.
      for (;;) {
        const p = await apiGetVaultActivity(vaultId, {
          limit: EXPORT_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
          ...(queryTypes ? { types: queryTypes } : {}),
          ...(actor ? { actor } : {}),
          ...(bornes.since !== undefined ? { since: bornes.since } : {}),
        });
        recorded = p.recorded;
        evenements.push(...p.events);
        pages += 1;
        cursor = p.nextCursor;
        if (!cursor) break;
        if (pages >= EXPORT_MAX_PAGES) {
          truncated = true;
          break;
        }
      }

      const fichier = buildActivityExport({
        vaultId,
        vaultName,
        format,
        generatedAt: maintenant,
        period: bornes,
        filters: { families, types, actor: actor || null },
        events: evenements,
        emailByUserId,
        nameByItemId,
        recorded,
        truncated,
        // Les marques de confiance sont LOCALES à cet appareil (F11) : le
        // fichier le dit dans son en-tête de section, et rien ne part au serveur.
        trust: withTrust
          ? mgmt.rows.flatMap((r) => {
              const v = trust.verdicts[r.userId];
              // Une personne jamais contrôlée n'a pas de LIGNE : écrire
              // « inconnu » décrirait l'état de notre ignorance, pas celui du
              // coffre (même règle que le compteur « N vérifiés sur M »).
              return v
                ? [{ userId: r.userId, state: v.state, reason: v.reason, verifiedAt: v.verifiedAt }]
                : [];
            })
          : null,
        epochs: withEpochs
          ? {
              currentEpoch: currentKeyEpoch,
              members: mgmt.rows.map((r) => ({
                userId: r.userId,
                wrappedEpoch: r.wrappedEpoch,
              })),
            }
          : null,
      });

      const issue = await saveExportFile(fichier);
      // Fermer la boîte système est un geste DÉLIBÉRÉ : on se tait, on ne
      // reproche rien.
      if (issue === 'saved') success(t('teamVaults.activity.export.done'));
      setExportOpen(false);
    } catch (e) {
      error(t(vaultErrorKey(errorText(e), 'teamVaults.activity.export.failed')));
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminSection
      title={t('teamVaults.activity.title')}
      actions={
        /* RIEN À FILTRER NI À EXPORTER QUAND L'OFFRE NE JOURNALISE PAS. Le
           panneau dit déjà pourquoi, et propose la seule réponse qui vaut
           (monter d'offre) : y ajouter quatre menus et un bouton « Exporter »
           qui produirait un fichier vide serait offrir des gestes qui ne
           peuvent rien. `recorded` vaut `true` tant qu'aucune page n'est
           arrivée — on affiche les contrôles par défaut, on ne les retire que
           sur une réponse REÇUE. */
        pageInfo.recorded && (
          <>
            <span className="ent-hint">
              {t(pageInfo.hasMore ? 'teamVaults.activity.shownMore' : 'teamVaults.activity.shown', {
                count: pageInfo.count,
              })}
            </span>
            {/* L'export reprend les filtres AFFICHÉS (sa propre période mise à
                part) : un fichier qui ne correspondrait pas à l'écran d'où on
                l'a demandé est le genre de surprise qu'on découvre trois
                semaines plus tard, dans un tableur. */}
            <Button variant="secondary" size="sm" onClick={() => setExportOpen(true)}>
              {t('teamVaults.activity.export.cta')}
            </Button>
          </>
        )
      }
      flush
    >
      <div style={{ padding: 'var(--spacing-4) var(--spacing-5) 0' }} hidden={!pageInfo.recorded}>
        <div className="ent-toolbar">
          <div className="ent-toolbar__field">
            <Select
              multiple
              size="sm"
              ariaLabel={t('teamVaults.activity.filter.familyLabel')}
              placeholder={t('teamVaults.activity.filter.anyFamily')}
              value={families}
              options={ACTIVITY_FAMILY_IDS.map((id) => ({
                value: id,
                label: t(`teamVaults.activity.family.${id}`),
              }))}
              onChange={(v) => {
                const next = (Array.isArray(v) ? v : [v]).filter(Boolean) as ActivityFamilyId[];
                setFamilies(next);
                // Les types cochés d'une famille qu'on vient de décocher sont
                // RETIRÉS : le modèle les ignorerait de toute façon pour la
                // requête, mais les laisser cochés à l'écran ferait croire
                // qu'ils comptent encore.
                setTypes((prev) =>
                  next.length === 0
                    ? prev
                    : prev.filter((ty) => next.some((f) => familyEventTypes(f).includes(ty)))
                );
              }}
            />
          </div>
          <div className="ent-toolbar__field" style={{ flex: '1 1 220px' }}>
            <Select
              multiple
              searchable
              size="sm"
              ariaLabel={t('teamVaults.activity.filter.typeLabel')}
              placeholder={t('teamVaults.activity.filter.anyType')}
              value={types}
              options={typeOptions}
              onChange={(v) => setTypes((Array.isArray(v) ? v : [v]).filter(Boolean) as string[])}
              fullWidth
            />
          </div>
          <div className="ent-toolbar__field">
            <Select
              size="sm"
              ariaLabel={t('teamVaults.activity.filter.actorLabel')}
              // « Personne choisie » est la chaîne VIDE, et le `Select` du
              // design système traite le vide comme « rien de sélectionné » : il
              // afficherait alors son placeholder par défaut, écrit en dur en
              // français. On le lui donne donc explicitement — l'option vide de
              // la liste reste le chemin de retour.
              placeholder={t('teamVaults.activity.filter.anyActor')}
              value={actor}
              options={actorOptions}
              onChange={(v) => setActor((Array.isArray(v) ? (v[0] ?? '') : v) as string)}
            />
          </div>
          <div className="ent-toolbar__field">
            <Select
              size="sm"
              ariaLabel={t('teamVaults.activity.filter.periodLabel')}
              value={period}
              options={ACTIVITY_PERIOD_IDS.map((id) => ({
                value: id,
                label: t(`teamVaults.activity.period.${id}`),
              }))}
              onChange={(v) => {
                setPeriod((Array.isArray(v) ? v[0] : v) as ActivityPeriodId);
                // L'ancre est renouvelée ICI, et nulle part ailleurs (en-tête).
                setPeriodAnchor(Date.now());
              }}
            />
          </div>
          <div className="ent-toolbar__spacer" />
          {/* Ce que le filtre laisse de côté est DIT, avec le geste qui le lève —
              même règle que la barre du trombinoscope. */}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFamilies([]);
                setTypes([]);
                setActor('');
                setPeriod('all');
                setPeriodAnchor(Date.now());
              }}
            >
              {t('teamVaults.settings.roster.clear')}
            </Button>
          )}
        </div>
      </div>

      {/* L'index des invitations est PRÊTÉ au panneau : c'est lui qui permet
          au fil de dire « a repris l'invitation de bob@… » plutôt que « a repris
          une invitation ». L'audit, lui, ne porte toujours aucune adresse — la
          jointure est locale, et le serveur n'en apprend rien. */}
      <VaultActivityPanel
        vaultId={vaultId}
        filter={filter}
        onPage={onPage}
        emailByInviteId={mgmt.emailByInviteId}
      />

      <Modal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t('teamVaults.activity.export.title')}
        size="md"
      >
        <div style={{ padding: 'var(--spacing-4)' }} className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-text-secondary)] m-0">
            {t('teamVaults.activity.export.hint')}
          </p>

          <fieldset className="border-0 p-0 m-0 flex flex-col gap-1.5">
            <legend className="text-sm font-medium text-[var(--color-text-primary)] mb-1">
              {t('teamVaults.activity.export.formatLabel')}
            </legend>
            <Radio
              name="activity-export-format"
              label={t('teamVaults.activity.export.csv')}
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            <Radio
              name="activity-export-format"
              label={t('teamVaults.activity.export.json')}
              checked={format === 'json'}
              onChange={() => setFormat('json')}
            />
          </fieldset>

          <Select
            label={t('teamVaults.activity.export.periodLabel')}
            value={exportPeriod}
            options={ACTIVITY_PERIOD_IDS.map((id) => ({
              value: id,
              label: t(`teamVaults.activity.period.${id}`),
            }))}
            onChange={(v) => setExportPeriod((Array.isArray(v) ? v[0] : v) as ActivityPeriodId)}
          />

          {/* Les deux cases n'apparaissent que quand il y a RÉELLEMENT quelque
              chose à joindre : une case « inclure l'état de confiance » sur un
              coffre dont aucune clé n'a encore été contrôlée produirait un
              tableau de « inconnu », c'est-à-dire l'état de notre ignorance. */}
          {trust.counter.total > 0 && (
            <Checkbox
              label={t('teamVaults.activity.export.withTrust')}
              checked={withTrust}
              onChange={(e) => setWithTrust(e.target.checked)}
            />
          )}
          {mgmt.canManage && (
            <Checkbox
              label={t('teamVaults.activity.export.withEpochs')}
              checked={withEpochs}
              onChange={(e) => setWithEpochs(e.target.checked)}
            />
          )}

          <p className="text-xs text-[var(--color-text-tertiary)] m-0">
            {t('teamVaults.activity.export.localNote')}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setExportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={exporting}
              disabled={exporting}
              onClick={() => void runExport()}
            >
              {t('teamVaults.activity.export.cta')}
            </Button>
          </div>
        </div>
      </Modal>
    </AdminSection>
  );
};

export default ActivityTab;
