/**
 * PublishWizard — publier en quatre temps, sans surprise.
 *
 * ── CE QUE REMPLAÇAIT L'ANCIEN ÉCRAN ────────────────────────────────────────
 *
 * Huit champs à plat, un bouton « Publier », et un `valid` booléen unique qui,
 * quand il valait `false`, se contentait de griser le bouton. Trois choses
 * irréversibles s'y jouaient sans qu'un mot ne les annonce : l'identifiant est
 * DÉFINITIF, un numéro de version est IMMUABLE, et le quota est de dix
 * publications par jour. Ces règles étaient écrites — dans l'en-tête du fichier
 * source. L'auteur, lui, ne l'a jamais lu.
 *
 * ── LES QUATRE TEMPS ────────────────────────────────────────────────────────
 *
 *   1. LE FICHIER      — ce qui sera distribué, et le rappel qu'il est public ;
 *   2. L'IDENTITÉ      — nom, identifiant définitif, version immuable ;
 *   3. LES CAPACITÉS   — les types de fichiers, vérifiés contre ce que cette
 *                        installation sert DÉJÀ (un conflit d'extension se voit
 *                        avant, pas après) ;
 *   4. LA RELECTURE    — la fiche telle qu'elle apparaîtra, ET la liste
 *                        explicite de ce qui devient public, AVANT de signer.
 *
 * ── UN REFUS RAMÈNE À L'ÉTAPE COUPABLE ──────────────────────────────────────
 *
 * `slug_taken` rouvre l'étape 2 avec le champ identifiant en erreur ;
 * `bundle_too_large` rouvre l'étape 1 ; `bad_manifest` rouvre l'étape 3. Le
 * serveur nomme le problème : le laisser en bandeau au-dessus d'un formulaire à
 * relire en entier serait perdre l'information qu'il vient de donner.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { Button, Input, Select } from '../ui';
import { useNotification } from '../ui/Notification';
import type { RootState } from '../../../store';
import { getOwnPublicKey } from '../../../services/auth/userKeypair';
import {
  buildManifestJson,
  signManifest,
  sha256Hex,
} from '../../../services/plugins/pluginSigning';
import {
  apiPublishPlugin,
  apiPublishPluginVersion,
  marketplaceErrorCode,
} from '../../../services/plugins/marketplaceApi';
import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceCategory,
  type MarketplaceManifest,
} from '../../../services/plugins/marketplaceTypes';
import { extensionConflicts } from './capabilities';
import {
  EMPTY_DRAFT,
  MAX_BUNDLE_BYTES,
  PUBLISH_STEPS,
  draftIssues,
  issueOfField,
  issuesOfStep,
  parseExtensions,
  stepForErrorCode,
  type PublishDraft,
  type PublishFieldName,
  type PublishStepId,
} from './publishValidation';
import { Notice } from './MarketplaceNotices';
import { IconThumbnailFailure, makePreviewImage } from '../../../services/layouts/layoutIconImage';
import { LAYOUT_PREVIEW_MAX_COUNT } from '../../../services/layouts/layoutMarketTypes';
import { EyeGlyph, FileGlyph, InfoGlyph, ShieldGlyph, WarnGlyph } from './icons';
import './marketplace.css';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export interface PublishWizardProps {
  onPublished: () => void;
}

export const PublishWizard: React.FC<PublishWizardProps> = ({ onPublished }) => {
  const { t } = useTranslation();
  const { error: notifyError, success: notifySuccess } = useNotification();
  const ownedSlugs = useSelector((s: RootState) =>
    s.marketplace.catalog.filter((p) => p.ownedByMe).map((p) => p.slug)
  );

  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [keyChecked, setKeyChecked] = useState(false);
  const [step, setStep] = useState<PublishStepId>('bundle');
  const [draft, setDraft] = useState<PublishDraft>(EMPTY_DRAFT);
  const [publishing, setPublishing] = useState(false);
  /** Une image est en cours de réduction — l'opération passe par un décodage. */
  const [shotsBusy, setShotsBusy] = useState(false);

  /**
   * Choisir des captures. Le fichier n'est JAMAIS envoyé tel quel : il est
   * redessiné en 1280×720 et réencodé en WebP (voir `makePreviewImage`), si
   * bien qu'une capture de six mégaoctets tient dans le manifeste sans que
   * personne ait à s'en occuper.
   */
  const pickShots = useCallback(
    async (files: FileList | null | undefined): Promise<void> => {
      const chosen = [...(files ?? [])];
      if (chosen.length === 0) return;
      setShotsBusy(true);
      try {
        const made: string[] = [];
        // ⚠ EN SÉRIE, et non `Promise.all`. Quatre canevas de 1280×720 décodés
        // en parallèle réveillent quatre décodeurs d'un coup ; sur une machine
        // modeste, l'onglet se fige le temps du dépôt.
        for (const file of chosen) made.push(await makePreviewImage(file));
        // Par le SETTER FONCTIONNEL : le décodage est asynchrone, et lire
        // `draft` ici effacerait ce qui a été ajouté entre-temps.
        setDraft((d) => ({
          ...d,
          previews: [...d.previews, ...made].slice(0, LAYOUT_PREVIEW_MAX_COUNT),
        }));
      } catch (err) {
        const code = err instanceof IconThumbnailFailure ? err.code : 'unreadable';
        notifyError(t(`layouts.publish.iconErrors.${code}`));
      } finally {
        setShotsBusy(false);
      }
    },
    [notifyError, t]
  );
  /** Le refus du serveur, épinglé au champ que le serveur a nommé. */
  const [serverIssue, setServerIssue] = useState<{
    field: string | null;
    messageKey: string;
  } | null>(null);

  useEffect(() => {
    void getOwnPublicKey().then((pub) => {
      setFingerprint(pub?.fingerprint ?? null);
      setKeyChecked(true);
    });
  }, []);

  const issues = useMemo(() => draftIssues(draft), [draft]);
  const extList = useMemo(() => parseExtensions(draft.extensionsRaw), [draft.extensionsRaw]);
  const conflicts = useMemo(() => extensionConflicts(extList, draft.slug), [extList, draft.slug]);
  const isNewVersion = ownedSlugs.includes(draft.slug);
  const stepIndex = PUBLISH_STEPS.indexOf(step);

  /**
   * UN CHAMP JAMAIS TOUCHÉ N'EST PAS EN FAUTE. Peindre en rouge un formulaire
   * qu'on vient d'ouvrir accuse l'auteur de ce qu'il n'a pas encore eu le temps
   * de faire — et, à force, apprend à ignorer le rouge. Un champ ne parle donc
   * qu'après avoir été touché, ou après un « Suivant » qui l'a sauté.
   */
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const set = useCallback(
    <K extends keyof PublishDraft>(key: K, value: PublishDraft[K], field: PublishFieldName) => {
      setDraft((d) => ({ ...d, [key]: value }));
      setTouched((old) => (old[field] ? old : { ...old, [field]: true }));
      setServerIssue(null);
    },
    []
  );

  const fieldError = (field: PublishFieldName): string | undefined => {
    if (serverIssue?.field === field) return t(serverIssue.messageKey);
    if (!touched[field]) return undefined;
    const issue = issueOfField(issuesOfStep(issues, step), field);
    return issue ? t(issue.messageKey) : undefined;
  };

  /** Passer à l'étape suivante fait parler les champs de l'étape quittée. */
  const goToStep = (target: PublishStepId, leaving?: PublishStepId) => {
    if (leaving) {
      const fields = issuesOfStep(issues, leaving).map((i) => i.field);
      if (fields.length > 0) {
        setTouched((old) => {
          const next = { ...old };
          for (const f of fields) next[f] = true;
          return next;
        });
      }
    }
    setStep(target);
  };

  const onFile = (file: File | null) => {
    if (!file) return;
    void file.arrayBuffer().then((buf) => {
      const bytes = new Uint8Array(buf);
      if (bytes.byteLength > MAX_BUNDLE_BYTES) {
        notifyError(t('marketplace.errors.bundle_too_large'));
        return;
      }
      setServerIssue(null);
      setDraft((d) => ({
        ...d,
        bundle: { name: file.name, bytes },
        // Un nom d'extension vide se pré-remplit depuis le nom du fichier : le
        // suggérer fait gagner un aller-retour, et reste corrigeable.
        name: d.name || file.name.replace(/\.js$/i, ''),
      }));
    });
  };

  const publish = async () => {
    if (issues.length > 0 || !draft.bundle) return;
    const own = await getOwnPublicKey();
    if (!own) {
      notifyError(t('marketplace.publish.needKeypair'));
      return;
    }
    setPublishing(true);
    setServerIssue(null);
    try {
      /**
       * L'ORDRE DES CLÉS EST LA SIGNATURE. Ce littéral est stringifié UNE fois ;
       * icon et category ne sont ajoutés que s'ils existent — un manifeste sans
       * eux reste exactement ce qu'il était avant, donc toujours vérifiable par
       * les clients déjà installés.
       */
      const manifest: MarketplaceManifest = {
        id: draft.slug,
        name: draft.name.trim(),
        version: draft.version,
        description: draft.description,
        extensions: extList,
        bundleHash: await sha256Hex(draft.bundle.bytes),
        publisherFingerprint: own.fingerprint,
        trust: 'sandboxed',
        ...(draft.icon.trim() ? { icon: draft.icon.trim() } : {}),
        ...(draft.category !== 'other' ? { category: draft.category } : {}),
        ...(draft.previews.length > 0 ? { previews: draft.previews } : {}),
      };
      const manifestJson = buildManifestJson(manifest);
      const payload = {
        manifestJson,
        signature: await signManifest(manifestJson),
        bundleBase64: bytesToBase64(draft.bundle.bytes),
      };
      if (isNewVersion) {
        await apiPublishPluginVersion(draft.slug, payload);
      } else {
        await apiPublishPlugin(payload);
      }
      notifySuccess(t('marketplace.publish.success'));
      setDraft(EMPTY_DRAFT);
      setStep('bundle');
      onPublished();
    } catch (e) {
      const code = marketplaceErrorCode(e);
      const known = new Set([
        'slug_taken',
        'version_exists',
        'bad_signature',
        'hash_mismatch',
        'fingerprint_mismatch',
        'bundle_too_large',
        'rate_limited',
        'bad_manifest',
      ]);
      const messageKey =
        code && known.has(code) ? `marketplace.errors.${code}` : 'marketplace.errors.unknown';
      const target = stepForErrorCode(code);
      if (target) {
        setStep(target.step);
        setServerIssue({ field: target.field, messageKey });
      } else {
        setServerIssue({ field: null, messageKey });
      }
      notifyError(t(messageKey));
    } finally {
      setPublishing(false);
    }
  };

  /** Pas de clé d'identité : la publication est impossible, et on le dit. */
  if (keyChecked && fingerprint === null) {
    return (
      <div className="mkt-wiz">
        <h3 className="mkt-wiz__title">{t('marketplace.wizard.title')}</h3>
        <Notice
          tone="warn"
          glyph={<WarnGlyph />}
          title={t('marketplace.wizard.noKeyTitle')}
          text={t('marketplace.publish.needKeypair')}
        />
      </div>
    );
  }

  const stepPanel = () => {
    switch (step) {
      case 'bundle':
        return (
          <div className="mkt-wiz__panel">
            <div>
              <h3 className="mkt-wiz__legend">{t('marketplace.wizard.bundleTitle')}</h3>
              <p className="mkt-wiz__help">{t('marketplace.wizard.bundleHelp')}</p>
            </div>
            <label className={`mkt-drop${draft.bundle ? ' mkt-drop--filled' : ''}`}>
              <FileGlyph className="mkt-drop__glyph" />
              <span className="mkt-drop__title">
                {draft.bundle ? draft.bundle.name : t('marketplace.wizard.bundlePick')}
              </span>
              <span className="mkt-drop__hint">
                {draft.bundle
                  ? t('marketplace.wizard.bundleSize', {
                      size: (draft.bundle.bytes.byteLength / 1024).toFixed(1),
                    })
                  : t('marketplace.wizard.bundleHint')}
              </span>
              <input
                type="file"
                accept=".js"
                className="sr-only"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {fieldError('bundle') && <p className="mkt-wiz__field-error">{fieldError('bundle')}</p>}
            <Notice
              live="none"
              glyph={<InfoGlyph />}
              title={t('marketplace.wizard.bundlePublicTitle')}
              text={t('marketplace.wizard.bundlePublicText')}
            />
          </div>
        );

      case 'identity':
        return (
          <div className="mkt-wiz__panel">
            <div>
              <h3 className="mkt-wiz__legend">{t('marketplace.wizard.identityTitle')}</h3>
              <p className="mkt-wiz__help">{t('marketplace.wizard.identityHelp')}</p>
            </div>
            <div className="mkt-fields">
              <Input
                label={t('marketplace.publish.name')}
                value={draft.name}
                onChange={(e) => set('name', e.target.value, 'name')}
                error={fieldError('name')}
                fullWidth
              />
              <Input
                label={t('marketplace.publish.description')}
                value={draft.description}
                onChange={(e) => set('description', e.target.value, 'description')}
                error={fieldError('description')}
                helperText={t('marketplace.wizard.descriptionHelp')}
                fullWidth
              />
              <Input
                label={t('marketplace.publish.id')}
                value={draft.slug}
                onChange={(e) => set('slug', e.target.value, 'slug')}
                error={fieldError('slug')}
                placeholder="mon-extension"
                fullWidth
              />
              <p className="mkt-permanent">
                <WarnGlyph className="mkt-limits__glyph mkt-limits__glyph--warn" />
                {isNewVersion
                  ? t('marketplace.wizard.slugOwned', { slug: draft.slug })
                  : t('marketplace.wizard.slugPermanent')}
              </p>
              <Input
                label={t('marketplace.publish.version')}
                value={draft.version}
                onChange={(e) => set('version', e.target.value, 'version')}
                error={fieldError('version')}
                placeholder="1.0.0"
                fullWidth
              />
              <p className="mkt-permanent">
                <WarnGlyph className="mkt-limits__glyph mkt-limits__glyph--warn" />
                {t('marketplace.wizard.versionImmutable')}
              </p>
            </div>
          </div>
        );

      case 'capabilities':
        return (
          <div className="mkt-wiz__panel">
            <div>
              <h3 className="mkt-wiz__legend">{t('marketplace.wizard.capabilitiesTitle')}</h3>
              <p className="mkt-wiz__help">{t('marketplace.wizard.capabilitiesHelp')}</p>
            </div>
            <div className="mkt-fields">
              <Input
                label={t('marketplace.publish.extensions')}
                value={draft.extensionsRaw}
                onChange={(e) => set('extensionsRaw', e.target.value, 'extensions')}
                error={fieldError('extensions')}
                placeholder="sbx, memo"
                fullWidth
              />
              {conflicts.length > 0 && (
                <Notice
                  tone="warn"
                  glyph={<WarnGlyph />}
                  title={t('marketplace.wizard.conflictTitle')}
                  text={t('marketplace.wizard.conflictText', {
                    list: conflicts.map((c) => `.${c.ext} (${c.heldBy})`).join(', '),
                  })}
                />
              )}
              <Select
                label={t('marketplace.publish.category')}
                options={MARKETPLACE_CATEGORIES.map((c) => ({
                  value: c,
                  label: t(`marketplace.categories.${c}`),
                }))}
                value={draft.category}
                onChange={(v) =>
                  set('category', (Array.isArray(v) ? v[0] : v) as MarketplaceCategory, 'category')
                }
                fullWidth
              />
              <Input
                label={t('marketplace.publish.icon')}
                value={draft.icon}
                onChange={(e) => set('icon', e.target.value, 'icon')}
                error={fieldError('icon')}
                placeholder="🗂️"
                fullWidth
              />

              {/*
                LES CAPTURES — ce qui manquait le plus à une fiche d'extension.

                Un emoji et deux phrases, pour décider d'exécuter du code d'un
                inconnu : c'est tout ce qu'un lecteur avait. Les images voyagent
                DANS le manifeste signé, réencodées ici en 1280×720 WebP — le
                fichier d'origine n'est jamais envoyé (voir `makePreviewImage`).
              */}
              <div className="layout-publish__icon">
                <span className="layout-publish__icon-label">
                  {t('marketplace.publish.shots', 'Captures d’écran')}
                </span>
                <div className="mkt-wiz__shots">
                  {draft.previews.map((shot, i) => (
                    <span key={i} className="mkt-wiz__shot">
                      <img src={shot} alt="" />
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            previews: d.previews.filter((_, j) => j !== i),
                          }))
                        }
                        aria-label={t('marketplace.publish.shotRemove', 'Retirer cette capture')}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {draft.previews.length < LAYOUT_PREVIEW_MAX_COUNT && (
                    <label className="layout-publish__icon-pick">
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={(e) => {
                          void pickShots(e.target.files);
                          // Le champ est vide après coup : rechoisir LE MÊME
                          // fichier doit relancer un `change`.
                          e.target.value = '';
                        }}
                      />
                      <span>
                        {shotsBusy
                          ? t('marketplace.publish.shotsWorking', 'Réduction…')
                          : t('marketplace.publish.shotsPick', 'Ajouter une capture')}
                      </span>
                    </label>
                  )}
                </div>
                <p className="layout-publish__icon-help">
                  {t(
                    'marketplace.publish.shotsHelp',
                    'Quatre au maximum. Elles sont redessinées en 1280×720 et voyagent signées avec le manifeste.'
                  )}
                </p>
              </div>
            </div>
          </div>
        );

      case 'review':
      default:
        return (
          <div className="mkt-wiz__panel">
            <div>
              <h3 className="mkt-wiz__legend">{t('marketplace.wizard.reviewTitle')}</h3>
              <p className="mkt-wiz__help">{t('marketplace.wizard.reviewHelp')}</p>
            </div>

            {/* La fiche telle qu'elle apparaîtra dans le catalogue. */}
            <div className="mkt-preview">
              <p className="mkt-section__title">{t('marketplace.wizard.previewTitle')}</p>
              <div
                className="mkt-card"
                style={{ border: 0, padding: 0, background: 'transparent' }}
              >
                <span className="mkt-card__open" style={{ cursor: 'default' }}>
                  <span className="mkt-card__icon" aria-hidden="true">
                    <bdi>{draft.icon.trim() || '▦'}</bdi>
                  </span>
                  <span className="mkt-card__main">
                    <span className="mkt-card__title-row">
                      <span className="mkt-card__name">
                        {draft.name.trim() || t('marketplace.wizard.previewNoName')}
                      </span>
                      <span className="mkt-tag">
                        {t(`marketplace.categories.${draft.category}`)}
                      </span>
                    </span>
                    <span className="mkt-card__desc">{draft.description}</span>
                    <span className="mkt-card__foot">
                      <span className="mkt-caps">
                        {extList.map((e) => (
                          <span className="mkt-cap" key={e}>
                            .{e}
                          </span>
                        ))}
                      </span>
                      <span className="mkt-meta">
                        {t('marketplace.card.version', { version: draft.version })}
                      </span>
                    </span>
                  </span>
                </span>
              </div>
            </div>

            {/* CE QUI DEVIENT PUBLIC — dit AVANT la signature, pas après. */}
            <section>
              <h4 className="mkt-section__title">{t('marketplace.wizard.publicTitle')}</h4>
              <ul className="mkt-public">
                {['bundle', 'meta', 'fingerprint', 'downloads'].map((k) => (
                  <li className="mkt-public__item" key={k}>
                    <EyeGlyph className="mkt-public__glyph" />
                    {t(`marketplace.wizard.public.${k}`)}
                  </li>
                ))}
              </ul>
              <h4 className="mkt-section__title" style={{ marginTop: 'var(--spacing-4)' }}>
                {t('marketplace.wizard.privateTitle')}
              </h4>
              <ul className="mkt-limits">
                {['privateKey', 'account', 'files'].map((k) => (
                  <li className="mkt-limits__item" key={k}>
                    <ShieldGlyph className="mkt-limits__glyph" />
                    {t(`marketplace.wizard.private.${k}`)}
                  </li>
                ))}
              </ul>
            </section>

            {fingerprint && (
              <p className="mkt-meta">
                {t('marketplace.publish.yourFingerprint')}{' '}
                <span style={{ fontFamily: 'var(--font-family-mono)' }}>{fingerprint}</span>
              </p>
            )}

            {issues.length > 0 && (
              <Notice
                tone="warn"
                live="alert"
                glyph={<WarnGlyph />}
                title={t('marketplace.wizard.blockedTitle')}
                text={issues.map((i) => t(i.messageKey)).join(' · ')}
                actions={[
                  {
                    label: t('marketplace.wizard.goToFirstIssue'),
                    onClick: () => goToStep(issues[0].step),
                  },
                ]}
              />
            )}

            {serverIssue && serverIssue.field === null && (
              <Notice
                tone="danger"
                live="alert"
                glyph={<WarnGlyph />}
                title={t('marketplace.wizard.refusedTitle')}
                text={t(serverIssue.messageKey)}
              />
            )}
          </div>
        );
    }
  };

  return (
    <div className="mkt-wiz">
      <h3 className="mkt-wiz__title">{t('marketplace.wizard.title')}</h3>
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
                {t(`marketplace.wizard.steps.${s}`)}
              </button>
            </li>
          );
        })}
      </ol>

      {stepPanel()}

      <div className="mkt-wiz__foot">
        <Button
          variant="ghost"
          disabled={stepIndex === 0}
          onClick={() => goToStep(PUBLISH_STEPS[Math.max(0, stepIndex - 1)])}
        >
          {t('common.back')}
        </Button>
        {step === 'review' ? (
          <Button
            variant="primary"
            loading={publishing}
            disabled={issues.length > 0}
            onClick={() => void publish()}
          >
            {isNewVersion
              ? t('marketplace.publish.newVersion')
              : t('marketplace.wizard.signAndPublish')}
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() =>
              goToStep(PUBLISH_STEPS[Math.min(PUBLISH_STEPS.length - 1, stepIndex + 1)], step)
            }
          >
            {t('common.next')}
          </Button>
        )}
      </div>
    </div>
  );
};
