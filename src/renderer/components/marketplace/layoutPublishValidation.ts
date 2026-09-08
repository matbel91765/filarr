/**
 * PUBLIER UN MODÈLE — les règles, hors de tout écran.
 *
 * Module PUR : aucun React, aucun réseau. Il dit ce qui manque et où, et c'est
 * l'assistant qui décide comment le montrer.
 *
 * ── POURQUOI TROIS ÉTAPES, ET PAS QUATRE ────────────────────────────────────
 *
 * L'assistant des greffons en a quatre, dont une « capacités » qui vérifie les
 * types de fichiers qu'une extension prétend ouvrir. Un modèle n'ouvre rien.
 *
 * Sa place est prise par l'ASSAINISSEMENT, qui est le vrai risque ici : une
 * disposition contient naturellement le dossier que son auteur a épinglé, le
 * coffre qu'il regarde, la recherche qu'il a enregistrée. Publier sans relire
 * ce tableau serait un partage de coffre déguisé en partage de disposition — le
 * pire genre de fuite, celui que personne ne soupçonne parce que l'objet
 * partagé a l'air inoffensif.
 *
 * ⚠ ET CE N'EST PAS DÉCORATIF. Depuis le chantier 02, le worker REFUSE une
 * publication dont un bloc porte encore un identifiant (`layout_rejected`). Ce
 * tableau n'est donc pas une politesse : c'est la seule façon d'éviter un refus
 * serveur, et l'écran doit le dire.
 *
 * ── LES TROIS FAITS IRRÉVERSIBLES ───────────────────────────────────────────
 *
 * Ils étaient écrits — dans l'en-tête d'un fichier source, que personne n'a
 * jamais lu. Ils vivent maintenant dans l'étape qui les engage :
 *
 *   · l'IDENTIFIANT est définitif (premier arrivé, premier servi) ;
 *   · un numéro de VERSION est immuable (on ne republie jamais le même) ;
 *   · le QUOTA est de dix publications par jour et par compte.
 */

import {
  LAYOUT_MARKET_CATEGORIES,
  LAYOUT_MARKET_FORMAT_VERSION,
  LAYOUT_MARKET_KIND,
  LAYOUT_MARKET_SEMVER_RE,
  LAYOUT_MARKET_SLUG_RE,
  isIconValue,
  type LayoutMarketCategory,
  type LayoutMarketEnvelope,
} from '../../../services/layouts/layoutMarketTypes';
import { LAYOUT_LIMITS, codePointLength } from '../../../services/layouts/layoutFormat';

/** Miroirs du worker — les mêmes bornes des deux côtés, ou rien ne sert. */
export const MAX_NAME = LAYOUT_LIMITS.name;
export const MAX_DESCRIPTION = LAYOUT_LIMITS.description;

export const PUBLISH_STEPS = ['layout', 'sanitize', 'identity'] as const;
export type LayoutPublishStepId = (typeof PUBLISH_STEPS)[number];

export interface LayoutPublishDraft {
  /** La vue choisie (`home`, `home:<slug>`) — vide tant qu'on n'a rien choisi. */
  viewId: string;
  slug: string;
  version: string;
  name: string;
  author: string;
  description: string;
  icon: string;
  /** La capture large — produite avec l'icone, jamais saisie a la main. */
  preview: string;
  /**
   * LA GALERIE — jusqu'a quatre captures, la premiere etant `preview`.
   *
   * Les deux coexistent parce que l'enveloppe SIGNEE porte les deux : `preview`
   * pour les versions deja publiees, qu'on ne peut pas migrer sans invalider
   * leur signature, et `previews` pour les nouvelles. Voir `previewsOf`.
   */
  previews: string[];
  category: LayoutMarketCategory;
}

export const EMPTY_LAYOUT_DRAFT: LayoutPublishDraft = {
  viewId: '',
  slug: '',
  version: '1.0.0',
  name: '',
  author: '',
  description: '',
  icon: '',
  preview: '',
  previews: [],
  category: 'other',
};

export type LayoutPublishField =
  | 'view'
  | 'bindings'
  | 'slug'
  | 'version'
  | 'name'
  | 'author'
  | 'description'
  | 'icon';

export interface LayoutPublishIssue {
  step: LayoutPublishStepId;
  field: LayoutPublishField;
  /** Clé i18n de la phrase — jamais un message en dur. */
  messageKey: string;
}

/**
 * Ce qui manque, dans l'ordre des étapes.
 *
 * `pendingLabels` compte les emplacements nommés laissés SANS libellé : garder
 * une liaison « comme emplacement nommé » et ne rien écrire dedans produit un
 * bloc que celui qui importe verra comme « à brancher sur… » suivi de rien.
 */
export function layoutDraftIssues(
  draft: LayoutPublishDraft,
  pendingLabels: number,
  rejectedWidgets = 0
): LayoutPublishIssue[] {
  const issues: LayoutPublishIssue[] = [];

  if (draft.viewId === '') {
    issues.push({ step: 'layout', field: 'view', messageKey: 'layouts.publish.issues.noView' });
  }

  /**
   * DES BLOCS QUE LE SERVEUR REFUSERA — vus AVANT d'y aller.
   *
   * Sans ce contrôle, l'auteur remplissait tout le formulaire, cliquait, et
   * découvrait un refus dont la cause n'était visible nulle part. Pire : le
   * refus le renvoyait à l'assainissement, qui pouvait très bien annoncer
   * « aucune liaison, rien à retirer » — parce que `layout_rejected` couvre
   * SEPT causes et qu'une seule concerne une liaison.
   */
  if (rejectedWidgets > 0) {
    issues.push({
      step: 'sanitize',
      field: 'bindings',
      messageKey: 'layouts.publish.issues.rejected',
    });
  }

  if (pendingLabels > 0) {
    issues.push({
      step: 'sanitize',
      field: 'bindings',
      messageKey: 'layouts.publish.issues.emptyLabel',
    });
  }

  if (!LAYOUT_MARKET_SLUG_RE.test(draft.slug)) {
    issues.push({ step: 'identity', field: 'slug', messageKey: 'layouts.publish.issues.slug' });
  }
  if (!LAYOUT_MARKET_SEMVER_RE.test(draft.version)) {
    issues.push({
      step: 'identity',
      field: 'version',
      messageKey: 'layouts.publish.issues.version',
    });
  }

  const name = draft.name.trim();
  if (name === '' || codePointLength(name) > MAX_NAME) {
    issues.push({ step: 'identity', field: 'name', messageKey: 'layouts.publish.issues.name' });
  }
  // Le pseudonyme suit la borne d'un libelle, pas celle d'un nom : c'est une
  // signature d'auteur, pas un titre.
  if (codePointLength(draft.author.trim()) > LAYOUT_LIMITS.slotLabel) {
    issues.push({ step: 'identity', field: 'author', messageKey: 'layouts.publish.issues.author' });
  }

  if (codePointLength(draft.description.trim()) > MAX_DESCRIPTION) {
    issues.push({
      step: 'identity',
      field: 'description',
      messageKey: 'layouts.publish.issues.description',
    });
  }

  // Une icône VIDE est légale (le champ disparaît de l'enveloppe) ; une icône
  // qui n'est ni un emoji ni une vignette ne l'est pas, et le worker la
  // refuserait.
  if (draft.icon !== '' && !isIconValue(draft.icon)) {
    issues.push({ step: 'identity', field: 'icon', messageKey: 'layouts.publish.issues.icon' });
  }

  return issues;
}

export function issuesOfStep(
  issues: readonly LayoutPublishIssue[],
  step: LayoutPublishStepId
): LayoutPublishIssue[] {
  return issues.filter((i) => i.step === step);
}

export function issueOfField(
  issues: readonly LayoutPublishIssue[],
  field: LayoutPublishField
): LayoutPublishIssue | undefined {
  return issues.find((i) => i.field === field);
}

/**
 * Une suggestion d'identifiant à partir d'un nom.
 *
 * Elle n'est qu'une SUGGESTION, et l'écran doit laisser la corriger : le slug
 * est définitif, et le déduire silencieusement d'un nom qu'on vient de taper
 * ferait prendre une décision irréversible sans la voir. Les diacritiques sont
 * dépliés (`é` → `e`) parce que le slug est en ASCII pur — un nom français
 * produirait sinon une suite de tirets.
 */
export function suggestSlug(name: string): string {
  const flat = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const slug = flat
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  // Le premier caractère doit être une lettre (`^[a-z]`) : un nom qui commence
  // par un chiffre produirait un slug que le worker refuse.
  return /^[a-z]/.test(slug) ? slug : slug === '' ? '' : `a-${slug}`.slice(0, 64);
}

/**
 * LES SUITES POSSIBLES D'UNE VERSION — et pourquoi c'est une LISTE.
 *
 * Republier demandait de taper un numéro à la main, en partant du défaut
 * `1.0.0` — c'est-à-dire du numéro déjà publié, refusé par le serveur après
 * tout le formulaire. Et rien n'empêchait de saisir une version PLUS ANCIENNE :
 * le worker l'aurait acceptée si elle était inédite, et le catalogue se serait
 * mis à annoncer une régression comme une nouveauté.
 *
 * Trois choix suffisent, et ce sont ceux que le semver définit :
 *
 *   · CORRECTIF — on répare, la composition ne bouge pas ;
 *   · MINEURE   — on ajoute ou on réarrange, ça reste le même modèle ;
 *   · MAJEURE   — c'est une autre disposition sous le même nom.
 *
 * Les trois sont strictement supérieurs au dernier publié : le retour en
 * arrière devient impossible par CONSTRUCTION, et non par un contrôle qu'on
 * pourrait oublier.
 */
export type VersionBump = 'patch' | 'minor' | 'major';

export function nextVersions(latest: string): { kind: VersionBump; value: string }[] {
  // ⚠ On lit par INDICE et non par déstructuration : `''.split('.')` rend un
  // tableau d'UN élément, et `[a, b, c]` aurait laissé `b` et `c` à `undefined`
  // — `undefined + 1` vaut `NaN`, et l'écran aurait proposé « NaN.NaN.NaN ».
  const parts = latest.split('.');
  const at = (i: number): number => {
    const n = parseInt(parts[i] ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const [major, minor, patch] = [at(0), at(1), at(2)];
  return [
    { kind: 'patch', value: `${major}.${minor}.${patch + 1}` },
    { kind: 'minor', value: `${major}.${minor + 1}.0` },
    { kind: 'major', value: `${major + 1}.0.0` },
  ];
}

/**
 * LA CLÉ i18n D'UN CODE D'ERREUR — et le piège qu'elle désamorce.
 *
 * Le worker rend des codes COMPOSÉS : `layout_rejected:binding-identifier`,
 * `bad_envelope:bad-name`. Or i18next lit `:` comme le séparateur d'espace de
 * noms : `t('layouts.publish.errors.layout_rejected:binding-identifier')`
 * chercherait la clé `binding-identifier` dans l'espace de noms
 * `layouts.publish.errors.layout_rejected`, ne la trouverait pas, et afficherait
 * la chaîne brute à l'utilisateur.
 *
 * On ne garde donc que la partie AVANT le deux-points. Le détail n'est pas
 * perdu pour autant : c'est lui qui pilote `stepForLayoutErrorCode`, et son
 * travail est de rouvrir la bonne étape, pas d'écrire une phrase.
 */
export function errorMessageKey(code: string | null): string {
  if (!code) return 'unknown';
  const head = code.split(':')[0];
  return head === '' ? 'unknown' : head;
}

/**
 * LE DÉTAIL d'un code composé, quand il en porte un.
 *
 * `errorMessageKey` jette la partie qui NOMME le problème, et c'est ce qui
 * produisait « la fiche est incomplète ou mal formée, vérifiez le nom,
 * l'identifiant et la version » alors que le serveur venait de dire
 * `bad_envelope:bad-icon` — trois champs cités, et pas le bon.
 *
 * Le détail est rendu séparément pour rester une clé i18n LÉGALE : c'est le
 * deux-points qui posait problème, pas l'information qu'il portait. L'appelant
 * cherche d'abord la phrase précise, et retombe sur la générique.
 */
export function errorDetailKey(code: string | null): string | null {
  if (!code) return null;
  const cut = code.indexOf(':');
  if (cut < 0) return null;
  const detail = code.slice(cut + 1);
  return detail === '' || detail.includes(':') ? null : detail;
}

/**
 * UN REFUS DU SERVEUR RAMÈNE À L'ÉTAPE COUPABLE.
 *
 * Sans cette table, « cet identifiant est déjà pris » s'afficherait en bandeau
 * au-dessus d'un formulaire à relire en entier — alors que le serveur vient de
 * nommer le champ concerné.
 *
 * ⚠ Les codes `layout_rejected:*` ramènent à l'ASSAINISSEMENT, et c'est le cas
 * le plus utile de toute cette table : le worker vient de dire qu'un bloc porte
 * encore un identifiant, et c'est exactement l'étape qui sert à l'enlever.
 */
export function stepForLayoutErrorCode(
  code: string | null
): { step: LayoutPublishStepId; field: LayoutPublishField } | null {
  if (code === null) return null;
  if (code.startsWith('layout_rejected')) {
    return { step: 'sanitize', field: 'bindings' };
  }
  switch (code) {
    case 'slug_taken':
    case 'slug_mismatch':
      return { step: 'identity', field: 'slug' };
    case 'version_exists':
      return { step: 'identity', field: 'version' };
    case 'bad_envelope:bad-name':
      return { step: 'identity', field: 'name' };
    case 'bad_envelope:bad-description':
      return { step: 'identity', field: 'description' };
    case 'bad_envelope:bad-icon':
      return { step: 'identity', field: 'icon' };
    case 'bad_envelope:bad-slug':
      return { step: 'identity', field: 'slug' };
    case 'bad_envelope:bad-version':
      return { step: 'identity', field: 'version' };
    case 'bad_envelope:no-widgets':
      return { step: 'layout', field: 'view' };
    default:
      // bad_signature, fingerprint_mismatch, envelope_too_large, rate_limited,
      // no_account_key : rien à corriger dans un champ — le récapitulatif les
      // affiche tels quels.
      return null;
  }
}

/** Les catégories, telles que le sélecteur les propose. */
export const PUBLISH_CATEGORIES: readonly LayoutMarketCategory[] = LAYOUT_MARKET_CATEGORIES;

// ==================== Du brouillon à l'enveloppe ====================

/**
 * CONSTRUIT L'ENVELOPPE À PARTIR DU BROUILLON.
 *
 * ── POURQUOI CETTE FONCTION EXISTE, ET POURQUOI ELLE EST PURE ───────────────
 *
 * Elle vivait à l'intérieur du composant, dans le corps d'un `doPublish`
 * asynchrone. Aucun test ne pouvait l'atteindre — et elle a perdu des champs
 * DEUX FOIS, en silence :
 *
 *   1. `buildEnvelopeJson` sérialise depuis une LISTE BLANCHE ; `author` et
 *      `preview` y manquaient. Corrigé.
 *   2. L'APPEL, lui, ne passait toujours ni `author` ni `preview`. La première
 *      correction n'a donc rien changé : il y avait deux portes, on n'en avait
 *      ouvert qu'une, et le diagnostic « republie en nouvelle version » était
 *      faux.
 *
 * Deux passoires successives pour la même valeur, et aucune des deux ne lève :
 * le champ est saisi, validé, affiché en aperçu, prérempli à la republication —
 * et il ne part jamais. C'est exactement le genre de défaut qu'un test de
 * bout en bout ne voit pas non plus, puisque tout « marche ».
 *
 * D'où cette fonction : sortie du composant, sans dépendance, et gardée par un
 * test qui remplit CHAQUE champ du brouillon et vérifie qu'il ressort.
 */
export function envelopeFromDraft(
  draft: LayoutPublishDraft,
  opts: { publisherFingerprint: string; layoutJson: string }
): LayoutMarketEnvelope {
  const author = draft.author.trim();
  const previews = (draft.previews ?? []).filter((image) => image !== '');

  return {
    kind: LAYOUT_MARKET_KIND,
    formatVersion: LAYOUT_MARKET_FORMAT_VERSION,
    slug: draft.slug,
    version: draft.version,
    name: draft.name.trim(),
    // Les champs facultatifs DISPARAISSENT quand ils sont vides plutôt que de
    // voyager comme chaîne vide : l'enveloppe est signée, et une chaîne vide y
    // est un contenu — pas une absence.
    ...(author ? { author } : {}),
    description: draft.description.trim(),
    ...(draft.icon ? { icon: draft.icon } : {}),
    ...(draft.preview ? { preview: draft.preview } : {}),
    ...(previews.length > 0 ? { previews } : {}),
    category: draft.category,
    target: 'home',
    publisherFingerprint: opts.publisherFingerprint,
    layout: opts.layoutJson,
  };
}
