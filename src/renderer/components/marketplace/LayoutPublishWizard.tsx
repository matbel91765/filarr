/**
 * LayoutPublishWizard — publier une disposition, en trois temps.
 *
 * ── L'ÉTAPE QUI REMPLACE « CAPACITÉS » ──────────────────────────────────────
 *
 * L'assistant des greffons vérifie à l'étape 3 les types de fichiers qu'une
 * extension prétend ouvrir. Un modèle n'ouvre rien : sa place est prise par
 * l'ASSAINISSEMENT, qui est le vrai risque ici.
 *
 * Une disposition contient naturellement le dossier que son auteur a épinglé,
 * le coffre qu'il regarde, la recherche qu'il a enregistrée. Publier sans
 * relire ce tableau serait un partage de coffre déguisé en partage de
 * disposition — le pire genre de fuite, celui que personne ne soupçonne parce
 * que l'objet partagé a l'air inoffensif.
 *
 * ⚠ ET LE SERVEUR NE PARDONNE PAS. Depuis le chantier 02, une publication dont
 * un bloc porte encore un identifiant est REFUSÉE (`layout_rejected`) — pas
 * nettoyée. La raison est dirimante : le worker range les octets signés tels
 * quels, donc écarter un bloc de son côté ne retirerait rien de ce qui est
 * servi. Ce tableau n'est donc pas une politesse, c'est la seule façon d'éviter
 * un refus.
 *
 * ── UN REFUS RAMÈNE À L'ÉTAPE COUPABLE ──────────────────────────────────────
 *
 * `slug_taken` rouvre l'identité avec le champ en erreur ; `layout_rejected:*`
 * rouvre l'assainissement. Le serveur nomme le problème : le laisser en bandeau
 * au-dessus d'un formulaire à relire en entier serait perdre l'information
 * qu'il vient de donner.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button, Input, Select } from '../ui';
import { Checkbox } from '../ui/Checkbox';
import { useSelector as useThemeSelector } from 'react-redux';
import { useNotification } from '../ui/Notification';
import type { RootState } from '../../../store';
import { getOwnPublicKey } from '../../../services/auth/userKeypair';
import {
  buildLayoutFile,
  currentAppVersion,
  planLayoutExport,
  type ExportBindingRow,
} from '../home/layoutTransfer';
import { listHomeViews } from '../home/homeViews';
import { homeGridSlots } from '../home/homeConfig';
import { TemplateMap } from '../home/presets/TemplateMap';
import { VaultKeypairGateModal } from '../vaults/VaultKeypairGate';
import {
  IconThumbnailFailure,
  makeListingImages,
  makePreviewImage,
} from '../../../services/layouts/layoutIconImage';
import {
  LAYOUT_PREVIEW_MAX_COUNT,
  isImageIcon,
  normalizeLayoutCategory,
} from '../../../services/layouts/layoutMarketTypes';
import {
  validateLayoutFile,
  type LayoutRejectedWidget,
} from '../../../services/layouts/layoutValidator';
import { LAYOUT_LIMITS, coreWidgetId } from '../../../services/layouts/layoutFormat';
import type { LayoutFileWidget } from '../../../services/layouts/layoutFormat';
import { resolveWidget } from '../home/widgetRegistry';
import { buildEnvelopeJson, signEnvelope } from '../../../services/layouts/layoutMarketSigning';
import { exportableAppFontId } from '../../../services/platform/appFonts';
import {
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
} from '../../../services/layouts/layoutMarketTypes';
import {
  apiPublishLayoutTemplate,
  apiPublishLayoutVersion,
  layoutMarketErrorCode,
  type LayoutMarketSummary,
} from '../../../services/layouts/layoutMarketApi';
import {
  EMPTY_LAYOUT_DRAFT,
  MAX_DESCRIPTION,
  MAX_NAME,
  PUBLISH_CATEGORIES,
  PUBLISH_STEPS,
  errorDetailKey,
  errorMessageKey,
  issueOfField,
  issuesOfStep,
  envelopeFromDraft,
  layoutDraftIssues,
  nextVersions,
  stepForLayoutErrorCode,
  suggestSlug,
  type LayoutPublishDraft,
  type LayoutPublishField,
  type LayoutPublishStepId,
} from './layoutPublishValidation';
import type { LayoutMarketCategory } from '../../../services/layouts/layoutMarketTypes';
// `home-template__map` (l'aperçu de géométrie) vit avec les modèles d'accueil :
// c'est la même carte, pour la même question — « à quoi ça ressemble ? ».
import '../home/presets/homePresets.css';
import '../home/layoutTransfer.css';
import './marketplace.css';

export interface LayoutPublishWizardProps {
  /** Mes fiches déjà publiées — décide entre première publication et version. */
  mine: readonly LayoutMarketSummary[];
  /**
   * Une fiche à mettre à jour : l'identité est reprise telle quelle, et seule
   * la version reste à choisir. Sans ce chemin, republier demandait de retaper
   * un identifiant définitif sans se tromper — une manœuvre que personne ne
   * devine et que personne ne devrait avoir à réussir.
   */
  prefill?: LayoutMarketSummary | null;
  onPublished: () => void;
}

export const LayoutPublishWizard: React.FC<LayoutPublishWizardProps> = ({
  mine,
  prefill,
  onPublished,
}) => {
  const { t } = useTranslation();
  const { success: notifySuccess, error: notifyError } = useNotification();
  const views = useSelector((s: RootState) => s.layout.document.views);
  const theme = useThemeSelector((s: RootState) => s.ui.theme);

  const [step, setStep] = useState<LayoutPublishStepId>('layout');
  const [draft, setDraft] = useState<LayoutPublishDraft>(EMPTY_LAYOUT_DRAFT);
  const [rows, setRows] = useState<ExportBindingRow[]>([]);
  const [touched, setTouched] = useState<Set<LayoutPublishField>>(new Set());
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  /** L'utilisateur a-t-il corrigé le slug à la main ? Alors on cesse de le deviner. */
  const [slugEdited, setSlugEdited] = useState(false);
  /**
   * LA PORTE DE LA CLÉ DE COMPTE — demander, plutôt que constater.
   *
   * Signer exige la paire de clés EN MÉMOIRE, et un déverrouillage par code PIN
   * ou par safeStorage ne la charge pas. L'écran affichait donc « votre clé
   * n'est pas disponible : déverrouillez votre coffre » — une phrase exacte et
   * parfaitement inutile : elle nomme un geste sans dire où le faire, et
   * l'auteur reste devant un formulaire rempli qu'il ne peut pas envoyer.
   *
   * `VaultKeypairGateModal` est la réponse que le reste du produit donne déjà à
   * ce cas : il demande le mot de passe du compte une fois, charge la clé, et
   * rend la main. On publie dans la foulée.
   */
  const [keyGateOpen, setKeyGateOpen] = useState(false);
  const setField = useCallback((patch: Partial<LayoutPublishDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setServerError(null);
  }, []);

  const setRow = useCallback((index: number, patch: Partial<ExportBindingRow>) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setServerError(null);
  }, []);

  /** Le fichier est en cours de reduction — l'operation passe par un decodage. */
  const [iconBusy, setIconBusy] = useState(false);
  /** Joindre le thème et la police au modèle — proposés, jamais imposés. */
  const [withTheme, setWithTheme] = useState(false);

  /**
   * Choisir une image. Le fichier n'est JAMAIS envoye tel quel : il est
   * redessine en 96×96 et reencode (voir `layoutIconImage`), si bien qu'une
   * capture d'ecran de deux megaoctets devient une vignette de quelques kilos
   * sans que personne ait a s'en occuper.
   */
  const pickIconImage = useCallback(
    async (files: FileList | null | undefined): Promise<void> => {
      const chosen = [...(files ?? [])];
      if (chosen.length === 0) return;
      setIconBusy(true);
      try {
        /**
         * LA PREMIÈRE IMAGE DONNE SON VISAGE À LA FICHE.
         *
         * Elle produit le couple (icône, première capture) ; les suivantes ne
         * sont que des captures. Laisser la quatrième décider de la pastille du
         * catalogue serait surprenant, et la redessiner en 96×96 pour jeter le
         * résultat serait du travail pur perte.
         */
        const first = await makeListingImages(chosen[0]);
        const rest: string[] = [];
        // ⚠ EN SÉRIE, et non `Promise.all`. Quatre canevas de 640×360 décodés
        // en parallèle réveillent quatre décodeurs d'image d'un coup ; sur une
        // machine modeste, l'onglet se fige le temps du dépôt.
        for (const file of chosen.slice(1)) rest.push(await makePreviewImage(file));

        const merged = [first.preview, ...rest].filter(Boolean);
        // ⚠ Par le SETTER FONCTIONNEL : on complète la galerie, et la valeur de
        // `draft` capturée dans cette fermeture date d'avant le dépôt (le
        // décodage des images est asynchrone). Lire l'état ici effacerait les
        // captures ajoutées entre-temps.
        setDraft((d) => ({
          ...d,
          icon: first.icon,
          preview: first.preview,
          previews: [...merged, ...(d.previews ?? []).filter((p) => !merged.includes(p))].slice(
            0,
            LAYOUT_PREVIEW_MAX_COUNT
          ),
        }));
      } catch (err) {
        const code = err instanceof IconThumbnailFailure ? err.code : 'unreadable';
        notifyError(t(`layouts.publish.iconErrors.${code}`));
      } finally {
        setIconBusy(false);
      }
    },
    [notifyError, t]
  );
  /**
   * `doPublish` par REF : la porte se referme avant que React n'ait re-rendu
   * avec la nouvelle empreinte. Capturer la fonction dans la fermeture du JSX
   * relancerait donc la version qui croit encore la clé absente — et
   * rouvrirait la porte en boucle.
   */
  const doPublishRef = useRef<((fp?: string) => Promise<void>) | null>(null);

  /**
   * L'empreinte est relue à CHAQUE entrée dans l'étape d'identité, et pas
   * seulement au montage.
   *
   * Le cas réel : on ouvre l'assistant coffre verrouillé (empreinte « — »), on
   * déverrouille ailleurs, on revient — et l'écran affichait toujours « — »,
   * parce que rien ne l'avait redemandé. La porte s'ouvrait alors pour une clé
   * qui était déjà là.
   */
  /**
   * Reprendre une fiche existante. On garde l'identifiant (il est définitif) et
   * tout l'habillage ; la VERSION, elle, est laissée telle quelle pour que la
   * personne la change sciemment — la deviner risquerait de republier un numéro
   * deja pris, refuse par le serveur apres tout le formulaire.
   */
  useEffect(() => {
    if (!prefill) return;
    setDraft((d) => ({
      ...d,
      slug: prefill.slug,
      name: prefill.name,
      description: prefill.description,
      author: prefill.author ?? '',
      icon: prefill.icon ?? '',
      category: normalizeLayoutCategory(prefill.category),
      // La suite la plus PRUDENTE par défaut : republier sans rien changer à la
      // composition est le cas le plus fréquent, et c'est celui qui ne
      // surprend personne.
      version: nextVersions(prefill.latestVersion)[0].value,
    }));
    setSlugEdited(true);
    setStep('layout');
  }, [prefill]);

  useEffect(() => {
    if (step !== 'identity') return;
    void getOwnPublicKey().then((pub) => setFingerprint(pub?.fingerprint ?? null));
  }, [step]);

  const homeViews = useMemo(() => listHomeViews(views, t('layouts.views.default')), [views, t]);

  /**
   * ⚠ `homeGridSlots` RETIRE L'EMPLACEMENT DE CONFIGURATION, et ce n'est pas un
   * détail de propreté.
   *
   * Régler « Accueil pleine largeur » écrit un emplacement réservé
   * (`home-config`) dans la mise en page : un marqueur de préférence, pas un
   * bloc. Il porte une géométrie nulle (w = 0), n'existe dans aucun registre, et
   * `homeConfig.ts` dit explicitement qu'il NE PART PAS à l'export — la largeur
   * est une préférence d'écran, et un modèle fabriqué sur un 34 pouces n'a pas à
   * forcer la pleine largeur sur un 13.
   *
   * `Home.tsx` filtre avant de passer au dialogue d'export ; cet assistant
   * prenait les blocs BRUTS. Résultat : toute disposition dont la largeur avait
   * été réglée était refusée à la publication, sur un « il déborde de la grille »
   * incompréhensible — le bloc occupait « les colonnes 1 à 0 ».
   */
  const slots = useMemo(
    () => (draft.viewId ? homeGridSlots(views[draft.viewId]?.slots ?? []) : []),
    [views, draft.viewId]
  );

  const plan = useMemo(
    // `t` change d'identité au changement de langue, ce qui est exactement quand
    // ce plan doit être recalculé : ses libellés par défaut sont traduits.
    () => planLayoutExport(slots, (key) => t(key)),
    [slots, t]
  );

  /**
   * Les lignes repartent du plan à CHAQUE changement de disposition. Garder les
   * arbitrages faits pour une autre mise en page emporterait des décisions
   * prises pour d'autres blocs — et personne ne relirait un tableau qu'il croit
   * déjà avoir rempli.
   */
  useEffect(() => {
    setRows(plan.rows);
  }, [plan.rows]);

  /** Un emplacement gardé mais SANS libellé : un bloc « à brancher sur… » rien. */
  const pendingLabels = rows.filter(
    (row) => !row.lock && row.choice === 'slot' && row.label.trim() === ''
  ).length;

  /**
   * LES BLOCS QUE LE SERVEUR REFUSERAIT, calculés ICI et maintenant.
   *
   * On fabrique le fichier tel qu'il partirait et on le passe au MÊME
   * validateur que le worker, en mode serveur (aucun type connu). Ce que cette
   * liste dit est donc exactement ce que la publication répondrait — à ceci
   * près qu'on le dit avant que la personne ait rempli le formulaire.
   *
   * Le nom et la description sont des bouchons : seul le sort des BLOCS nous
   * intéresse ici, et l'en-tête a ses propres contrôles à l'étape 3.
   */
  const rejection = useMemo<{ rows: LayoutRejectedWidget[]; widgets: LayoutFileWidget[] }>(() => {
    if (slots.length === 0) return { rows: [], widgets: [] };
    try {
      const probe = buildLayoutFile(
        slots,
        rows,
        { name: 'x', description: '', target: 'home' },
        (key) => t(key)
      );
      const res = validateLayoutFile(JSON.stringify(probe), { knownTypes: new Set<string>() });
      // Les blocs du fichier SONDE sont gardés : c'est sur eux que porte
      // l'`index` du refus, et c'est d'eux qu'on tire le nom et les chiffres.
      return { rows: res.status === 'ok' ? res.rejected : [], widgets: probe.widgets };
    } catch {
      // Une disposition que `buildLayoutFile` ne sait pas construire est un cas
      // que l'étape 1 attrapera : ne rien signaler ici vaut mieux qu'un
      // message qui ne désignerait rien.
      return { rows: [], widgets: [] };
    }
  }, [slots, rows, t]);

  const rejectedWidgets = rejection.rows;

  /**
   * Le nom lisible d'un bloc refusé.
   *
   * ⚠ PAR L'INDEX, ET SURTOUT PAS PAR L'UID. Le validateur rend l'`uid` du
   * FICHIER (`w1`, `w2`… fabriqués par `buildLayoutFile`), qui n'a rien à voir
   * avec l'identifiant de l'emplacement dans la mise en page. Chercher l'un
   * parmi les autres ne trouvait jamais rien, et la liste affichait « w1 » —
   * un nom que personne ne peut relier à un bloc de son accueil.
   */
  const widgetLabel = useCallback(
    (index: number): string => {
      const widget = rejection.widgets[index];
      const core = widget ? coreWidgetId(widget.type) : null;
      const definition = core ? resolveWidget(core) : null;
      if (definition) return t(definition.titleKey);
      return widget?.title ?? core ?? t('layouts.publish.rejectedUnnamed');
    },
    [rejection.widgets, t]
  );

  /**
   * Le DÉTAIL chiffré d'un refus, quand il en existe un.
   *
   * « Sa position ou sa taille sort de la grille » ne dit pas quoi faire. Les
   * colonnes réellement occupées, si : on voit tout de suite que le bloc
   * déborde à droite, et de combien.
   */
  const rejectionDetail = useCallback(
    (row: LayoutRejectedWidget): string | null => {
      const widget = rejection.widgets[row.index];
      if (row.code !== 'bad-geometry' || !widget) return null;
      return t('layouts.publish.rejectedGeometry', {
        from: widget.x + 1,
        to: widget.x + widget.w,
        columns: LAYOUT_LIMITS.columns,
      });
    },
    [rejection.widgets, t]
  );

  const issues = layoutDraftIssues(draft, pendingLabels, rejectedWidgets.length);
  const stepIndex = PUBLISH_STEPS.indexOf(step);

  /**
   * La phrase d'un refus serveur : la PRÉCISE si elle existe, la générique
   * sinon. Sans ce premier essai, un refus qui nomme exactement le champ fautif
   * s'affichait en conseillant d'en vérifier trois autres.
   */
  const serverMessage = useCallback(
    (code: string | null): string => {
      const generic = t(`layouts.publish.errors.${errorMessageKey(code)}`, {
        defaultValue: t('layouts.publish.errors.unknown'),
      });
      const detail = errorDetailKey(code);
      if (!detail) return generic;
      return t(`layouts.publish.errorDetails.${detail}`, { defaultValue: generic });
    },
    [t]
  );

  /** L'erreur d'un champ — seulement s'il a été VU, pour ne pas crier d'emblée. */
  const fieldError = (field: LayoutPublishField): string | null => {
    if (!touched.has(field)) return null;
    const issue = issueOfField(issuesOfStep(issues, step), field);
    return issue ? t(issue.messageKey) : null;
  };

  const goToStep = useCallback(
    (target: LayoutPublishStepId, leaving?: LayoutPublishStepId) => {
      if (leaving) {
        // Quitter une étape RÉVÈLE ses manques : on ne crie pas pendant la
        // frappe, on le dit quand la personne considère l'étape finie.
        const fields = issuesOfStep(issues, leaving).map((i) => i.field);
        if (fields.length > 0) setTouched((s) => new Set([...s, ...fields]));
      }
      setStep(target);
    },
    [issues]
  );

  /** Une disposition déjà publiée par MOI ⇒ c'est une version, pas une création. */
  const existing = mine.find((row) => row.slug === draft.slug);

  /**
   * LA VERSION SUIT LE SLUG, ET PAS SEULEMENT LE PRÉREMPLISSAGE.
   *
   * « Publier une nouvelle version » pose déjà la bonne suite. Mais on arrive
   * aussi sur une fiche existante en SAISISSANT son slug depuis une création :
   * `existing` apparaît alors sous une version restée à `1.0.0`, que la liste
   * ne propose pas — le champ se serait affiché VIDE, et publier aurait échoué
   * sur un numéro déjà pris, à la toute dernière étape.
   *
   * On recale donc dès que le couple (slug, dernière publiée) change, et
   * seulement si la version courante n'est pas déjà une suite valide : écraser
   * un choix délibéré de « majeure » à chaque frappe serait pire que le défaut.
   */
  const latestPublished = existing?.latestVersion;
  useEffect(() => {
    if (!latestPublished) return;
    const suites = nextVersions(latestPublished);
    setDraft((d) =>
      suites.some((v) => v.value === d.version) ? d : { ...d, version: suites[0].value }
    );
  }, [latestPublished]);

  /**
   * ⚠ L'EMPREINTE EST UN ARGUMENT, ET C'EST LA CORRECTION D'UNE BOUCLE RÉELLE.
   *
   * Reprendre la publication après la porte en rappelant `doPublish()` tel quel
   * relançait la fermeture créée au rendu PRÉCÉDENT, celle qui croit encore
   * l'empreinte absente : elle rouvrait la porte, qui se refermait, qui la
   * rappelait — une modale vide dont on ne sortait plus.
   *
   * Une ref ne suffit PAS à réparer ça : elle est réaffectée au rendu, et
   * l'appel part avant que React n'ait re-rendu. Il faut passer la valeur
   * fraîche, pas espérer la lire.
   */
  const doPublish = useCallback(
    async (freshFingerprint?: string) => {
      if (issues.length > 0) {
        setTouched(new Set(issues.map((i) => i.field)));
        goToStep(issues[0].step);
        return;
      }
      const signer = freshFingerprint ?? fingerprint;
      if (!signer) {
        // Pas une erreur : une porte. Voir `keyGateOpen`.
        setKeyGateOpen(true);
        return;
      }

      setBusy(true);
      setServerError(null);
      try {
        // 1. Le FICHIER, assaini : `buildLayoutFile` ne lit jamais la valeur d'une
        // liaison d'origine, seulement la ligne du plan qui lui correspond.
        const file = buildLayoutFile(
          slots,
          rows,
          {
            name: draft.name.trim(),
            description: draft.description.trim(),
            target: 'home',
            appVersion: currentAppVersion(),
            // Le thème SUGGÉRÉ, jamais impose : celui qui installe se le verra
            // proposer, et l'ecran d'accueil de quelqu'un ne change pas parce
            // qu'il a essaye une disposition.
            ...(withTheme ? { theme: { themeId: theme, fontId: exportableAppFontId() } } : {}),
            ...(draft.icon ? { icon: draft.icon } : {}),
            category: draft.category,
          },
          (key) => t(key)
        );

        // 2. L'ENVELOPPE. `layout` est une CHAÎNE : c'est elle qui sera signée, et
        // c'est exactement celle que le validateur relira des deux côtés.
        const envelopeJson = buildEnvelopeJson(
          envelopeFromDraft(draft, {
            publisherFingerprint: signer,
            layoutJson: JSON.stringify(file),
          })
        );

        const signature = await signEnvelope(envelopeJson);
        const body = { envelopeJson, signature };

        if (existing) await apiPublishLayoutVersion(draft.slug, body);
        else await apiPublishLayoutTemplate(body);

        notifySuccess(
          t('layouts.publish.done', { name: draft.name.trim(), version: draft.version })
        );
        setDraft(EMPTY_LAYOUT_DRAFT);
        setRows([]);
        setTouched(new Set());
        setSlugEdited(false);
        setStep('layout');
        onPublished();
      } catch (err) {
        const code = layoutMarketErrorCode(err);
        setServerError(code ?? 'unknown');
        const target = stepForLayoutErrorCode(code);
        if (target) {
          setTouched((s) => new Set([...s, target.field]));
          setStep(target.step);
        } else {
          notifyError(
            t(`layouts.publish.errors.${errorMessageKey(code)}`, {
              defaultValue: t('layouts.publish.errors.unknown'),
            })
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [
      issues,
      fingerprint,
      slots,
      rows,
      draft,
      existing,
      t,
      notifySuccess,
      notifyError,
      onPublished,
      goToStep,
    ]
  );

  doPublishRef.current = doPublish;

  // ==================== Les trois panneaux ====================

  /** Ce qui partirait vraiment d'une vue — sans le marqueur de configuration. */
  const publishable = useCallback(
    (viewId: string) => homeGridSlots(views[viewId]?.slots ?? []),
    [views]
  );

  const panelLayout = (): React.ReactNode => (
    <fieldset className="mkt-wiz__panel">
      <legend className="mkt-wiz__legend">{t('layouts.publish.steps.layout')}</legend>
      <p className="mkt-wiz__help">{t('layouts.publish.layoutHelp')}</p>
      {/*
        DES CARTES, ET CHACUNE MONTRE SA GÉOMÉTRIE.

        La liste de départ était trois rectangles gris portant un nom et un
        compte de blocs : on ne voyait NI ce qu'on allait publier, NI lequel
        était choisi. La même carte de géométrie sert déjà à choisir un modèle
        d'accueil — c'est la même question, elle mérite la même réponse.

        Le bouton porte `aria-pressed` : un groupe de cartes cliquables n'est pas
        une liste de cases à cocher, et l'annoncer comme telle mentirait au
        lecteur d'écran.
      */}
      <div className="layout-publish__grid">
        {homeViews.map((view) => {
          const chosen = draft.viewId === view.id;
          return (
            <button
              key={view.id}
              type="button"
              aria-pressed={chosen}
              className={['layout-publish__card', chosen ? 'layout-publish__card--chosen' : '']
                .filter(Boolean)
                .join(' ')}
              onClick={() =>
                setField({
                  viewId: view.id,
                  // Le nom SUIT la disposition tant qu'on ne l'a pas écrit
                  // soi-même : c'est presque toujours le bon, et le corriger
                  // reste possible à l'étape suivante.
                  ...(draft.name.trim() === '' ? { name: view.name } : {}),
                  ...(slugEdited ? {} : { slug: suggestSlug(view.name) }),
                })
              }
            >
              <span className="layout-publish__card-head">
                <span className="layout-publish__card-name">{view.name}</span>
                {chosen && (
                  <span className="layout-publish__card-badge">{t('layouts.publish.chosen')}</span>
                )}
              </span>
              <span className="layout-publish__card-meta">
                {t('layouts.market.blocks', { count: publishable(view.id).length })}
              </span>
              <TemplateMap slots={publishable(view.id)} />
            </button>
          );
        })}
      </div>
      {fieldError('view') && <p className="mkt-wiz__field-error">{fieldError('view')}</p>}
    </fieldset>
  );

  const panelSanitize = (): React.ReactNode => (
    <fieldset className="mkt-wiz__panel">
      <legend className="mkt-wiz__legend">{t('layouts.publish.steps.sanitize')}</legend>
      <p className="mkt-wiz__help">{t('layouts.publish.sanitizeHelp')}</p>

      {rows.length === 0 ? (
        <p className="layout-transfer__hint">{t('layouts.publish.noBindings')}</p>
      ) : (
        <ul className="layout-transfer__rows">
          {rows.map((row, index) => (
            <li key={`${row.slotId}:${row.key}`} className="layout-transfer__row">
              <div className="layout-transfer__row-head">
                <span className="layout-transfer__row-widget">{row.widgetTitle}</span>
                <span className="layout-transfer__row-key">{row.key}</span>
              </div>

              {row.lock ? (
                // Pas de choix, et la raison est DITE : « toujours vidé » sans
                // explication ressemblerait à une limitation technique.
                <p className="layout-transfer__row-locked">
                  {row.lock === 'free-text'
                    ? t('layouts.export.lockedFreeText')
                    : t('layouts.export.lockedUnknown')}
                </p>
              ) : (
                <div className="layout-transfer__row-choice">
                  <Button
                    variant={row.choice === 'clear' ? 'secondary' : 'tertiary'}
                    size="sm"
                    aria-pressed={row.choice === 'clear'}
                    onClick={() => setRow(index, { choice: 'clear' })}
                  >
                    {t('layouts.export.choiceClear')}
                  </Button>
                  <Button
                    variant={row.choice === 'slot' ? 'secondary' : 'tertiary'}
                    size="sm"
                    aria-pressed={row.choice === 'slot'}
                    onClick={() => setRow(index, { choice: 'slot' })}
                  >
                    {t('layouts.export.choiceSlot')}
                  </Button>
                  {row.choice === 'slot' && (
                    <Input
                      aria-label={t('layouts.export.labelAria', { widget: row.widgetTitle })}
                      value={row.label}
                      maxLength={80}
                      size="sm"
                      onChange={(event) => setRow(index, { label: event.target.value })}
                    />
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {plan.skipped > 0 && (
        <p className="layout-transfer__hint">
          {t('layouts.export.skipped', { count: plan.skipped })}
        </p>
      )}

      {/*
        LES BLOCS REFUSÉS, NOMMÉS UN PAR UN.

        « Un bloc porte encore une référence à votre coffre » était faux sept
        fois sur huit : le refus du serveur couvre aussi une géométrie hors
        grille, un réglage trop long, une adresse dans une option. Chaque cause
        a maintenant sa phrase, et chaque bloc son nom — parce que le seul geste
        utile est d'aller le retirer dans l'accueil, et qu'il faut savoir lequel.
      */}
      {rejectedWidgets.length > 0 && (
        <section className="layout-transfer__section">
          <h3 className="layout-transfer__heading">{t('layouts.publish.rejectedTitle')}</h3>
          <p className="layout-transfer__hint">{t('layouts.publish.rejectedHint')}</p>
          <ul className="layout-publish__rejected">
            {rejectedWidgets.map((row) => (
              <li key={`${row.index}:${row.uid ?? ''}`}>
                <strong>{widgetLabel(row.index)}</strong>
                <span> — {t(`layouts.publish.rejectedReasons.${row.code}`)}</span>
                {rejectionDetail(row) && (
                  <span className="layout-publish__rejected-detail">{rejectionDetail(row)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {fieldError('bindings') && <p className="mkt-wiz__field-error">{fieldError('bindings')}</p>}
    </fieldset>
  );

  const panelIdentity = (): React.ReactNode => (
    <fieldset className="mkt-wiz__panel">
      <legend className="mkt-wiz__legend">{t('layouts.publish.steps.identity')}</legend>

      {/* LES TROIS FAITS IRRÉVERSIBLES, avant les champs qui les engagent. */}
      <p className="mkt-wiz__help">
        {existing
          ? t('layouts.publish.identityHelpExisting', { version: existing.latestVersion })
          : t('layouts.publish.identityHelpNew')}
      </p>

      <div className="layout-transfer__fields">
        <Input
          label={t('layouts.publish.nameLabel')}
          value={draft.name}
          maxLength={MAX_NAME}
          error={fieldError('name') ?? undefined}
          onChange={(e) => {
            const name = e.target.value;
            setField({ name, ...(slugEdited ? {} : { slug: suggestSlug(name) }) });
          }}
          onBlur={() => setTouched((s) => new Set([...s, 'name']))}
          fullWidth
        />
        <Input
          label={t('layouts.publish.slugLabel')}
          value={draft.slug}
          maxLength={64}
          error={fieldError('slug') ?? undefined}
          helperText={t('layouts.publish.slugHelp')}
          onChange={(e) => {
            setSlugEdited(true);
            setField({ slug: e.target.value.trim().toLowerCase() });
          }}
          onBlur={() => setTouched((s) => new Set([...s, 'slug']))}
          fullWidth
        />
        {/*
          SUR UNE MISE À JOUR, LA VERSION SE CHOISIT — elle ne se tape pas.
          Le champ libre partait du numéro déjà publié et laissait saisir une
          version plus ancienne. Trois suites, toutes supérieures à la dernière
          en ligne : le retour en arrière devient impossible.
        */}
        {existing ? (
          <Select
            label={t('layouts.publish.versionLabel')}
            options={nextVersions(existing.latestVersion).map((v) => ({
              value: v.value,
              label: t(`layouts.publish.bump.${v.kind}`, { version: v.value }),
            }))}
            value={draft.version}
            onChange={(v) => setField({ version: (Array.isArray(v) ? v[0] : v) as string })}
            fullWidth
          />
        ) : (
          <Input
            label={t('layouts.publish.versionLabel')}
            value={draft.version}
            maxLength={16}
            error={fieldError('version') ?? undefined}
            helperText={t('layouts.publish.versionHelp')}
            onChange={(e) => setField({ version: e.target.value.trim() })}
            onBlur={() => setTouched((s) => new Set([...s, 'version']))}
            fullWidth
          />
        )}
        {/*
          LE PSEUDONYME EST FACULTATIF, ET IL NE PROUVE RIEN.
          Il voyage dans l'enveloppe signee — donc nul ne peut le modifier apres
          coup — mais rien n'empeche de le choisir trompeur. C'est l'empreinte
          qui identifie, et l'ecran affiche toujours les deux.
        */}
        <Input
          label={t('layouts.publish.authorLabel')}
          value={draft.author}
          maxLength={80}
          placeholder={t('layouts.publish.authorPlaceholder')}
          helperText={t('layouts.publish.authorHelp')}
          error={fieldError('author') ?? undefined}
          onChange={(e) => setField({ author: e.target.value })}
          onBlur={() => setTouched((s) => new Set([...s, 'author']))}
          fullWidth
        />
        <Input
          label={t('layouts.publish.descriptionLabel')}
          value={draft.description}
          maxLength={MAX_DESCRIPTION}
          error={fieldError('description') ?? undefined}
          onChange={(e) => setField({ description: e.target.value })}
          onBlur={() => setTouched((s) => new Set([...s, 'description']))}
          fullWidth
        />
        {/*
          DEUX FAÇONS DE DONNER UNE ICÔNE, et elles ne servent pas la même chose.
          Un emoji se tape en une seconde ; une vignette montre à quoi ressemble
          un thème. Forcer l'une ferait perdre l'autre.

          Le champ texte disparaît dès qu'une image est posée : afficher une URL
          de données de six mille caractères dans un `<input>` ne renseignerait
          personne et donnerait l'impression que le formulaire a déraillé.
        */}
        <div className="layout-publish__icon">
          <span className="layout-publish__icon-label">{t('layouts.publish.iconLabel')}</span>
          <div className="layout-publish__icon-row">
            <span className="layout-publish__icon-preview" aria-hidden="true">
              {draft.icon === '' ? (
                <span className="layout-publish__icon-empty">▤</span>
              ) : isImageIcon(draft.icon) ? (
                <img src={draft.icon} alt="" />
              ) : (
                <bdi>{draft.icon}</bdi>
              )}
            </span>

            {!isImageIcon(draft.icon) && (
              <Input
                aria-label={t('layouts.publish.iconEmojiAria')}
                value={draft.icon}
                maxLength={32}
                placeholder={t('layouts.publish.iconEmojiPlaceholder')}
                error={fieldError('icon') ?? undefined}
                onChange={(e) => setField({ icon: e.target.value })}
                onBlur={() => setTouched((s) => new Set([...s, 'icon']))}
              />
            )}

            <label className="layout-publish__icon-pick">
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => {
                  void pickIconImage(e.target.files);
                  // Le champ est vide apres coup : rechoisir LE MEME fichier
                  // doit relancer un `change`, ce qu'un input qui garde sa
                  // valeur ne fait pas.
                  e.target.value = '';
                }}
              />
              <span>
                {iconBusy ? t('layouts.publish.iconWorking') : t('layouts.publish.iconPick')}
              </span>
            </label>

            {draft.icon !== '' && (
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => setField({ icon: '', preview: '', previews: [] })}
              >
                {t('layouts.publish.iconClear')}
              </Button>
            )}
          </div>
          <p className="layout-publish__icon-help">{t('layouts.publish.iconHelp')}</p>
        </div>
        <Checkbox
          label={t('layouts.publish.withTheme')}
          checked={withTheme}
          onChange={(e) => setWithTheme(e.target.checked)}
        />
        <Select
          label={t('layouts.publish.categoryLabel')}
          options={PUBLISH_CATEGORIES.map((c) => ({
            value: c,
            label: t(`layouts.market.categories.${c}`),
          }))}
          value={draft.category}
          onChange={(v) =>
            setField({ category: (Array.isArray(v) ? v[0] : v) as LayoutMarketCategory })
          }
          fullWidth
        />
      </div>

      {/* CE QUI DEVIENT PUBLIC, dit avant de signer et non après. */}
      <section className="layout-transfer__section">
        <h3 className="layout-transfer__heading">{t('layouts.publish.publicTitle')}</h3>
        <ul className="layout-publish__public">
          <li>{t('layouts.publish.publicName')}</li>
          <li>{t('layouts.publish.publicGeometry', { count: plan.widgets })}</li>
          <li>
            {t('layouts.publish.publicSlots', {
              count: rows.filter((r) => !r.lock && r.choice === 'slot').length,
            })}
          </li>
          <li>{t('layouts.publish.publicFingerprint', { fingerprint: fingerprint ?? '—' })}</li>
        </ul>
      </section>
    </fieldset>
  );

  return (
    <div className="mkt-wiz">
      <ol className="mkt-wiz__steps">
        {PUBLISH_STEPS.map((s, i) => {
          const todo = issuesOfStep(issues, s).length > 0;
          return (
            <li key={s}>
              <button
                type="button"
                className={[
                  'mkt-wiz__step',
                  s === step ? 'mkt-wiz__step--current' : '',
                  todo && s !== step ? 'mkt-wiz__step--todo' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={s === step ? 'step' : undefined}
                onClick={() => goToStep(s, step)}
              >
                <span className="mkt-wiz__num">{i + 1}</span>
                {t(`layouts.publish.steps.${s}`)}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 'layout' && panelLayout()}
      {step === 'sanitize' && panelSanitize()}
      {step === 'identity' && panelIdentity()}

      {serverError && (
        <p className="mkt-wiz__field-error" role="alert">
          {serverMessage(serverError)}
        </p>
      )}

      {/* Elle ne s'affiche que si la clé manque VRAIMENT : le composant vérifie
          lui-même et rappelle `onReady` sans rien montrer si elle est là. */}
      <VaultKeypairGateModal
        isOpen={keyGateOpen}
        onClose={() => setKeyGateOpen(false)}
        onReady={() => {
          setKeyGateOpen(false);
          void getOwnPublicKey().then((pub) => {
            const fp = pub?.fingerprint ?? null;
            setFingerprint(fp);
            if (fp) {
              // On enchaîne, en PASSANT l'empreinte : la relire ici rouvrirait
              // la porte (voir l'en-tête de `doPublish`).
              void doPublishRef.current?.(fp);
            } else {
              // La porte s'est ouverte et la clé n'est toujours pas là. On le
              // DIT au lieu de redemander : redemander en boucle est
              // exactement ce qui bloquait l'écran.
              setServerError('no_account_key');
            }
          });
        }}
      />

      <div className="mkt-wiz__foot">
        <Button
          variant="tertiary"
          size="sm"
          disabled={stepIndex === 0 || busy}
          onClick={() => goToStep(PUBLISH_STEPS[stepIndex - 1], step)}
        >
          {t('layouts.publish.back')}
        </Button>
        {stepIndex < PUBLISH_STEPS.length - 1 ? (
          <Button
            variant="primary"
            size="sm"
            onClick={() => goToStep(PUBLISH_STEPS[stepIndex + 1], step)}
          >
            {t('layouts.publish.next')}
          </Button>
        ) : (
          <Button variant="primary" size="sm" loading={busy} onClick={() => void doPublish()}>
            {existing ? t('layouts.publish.publishVersion') : t('layouts.publish.publish')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default LayoutPublishWizard;
