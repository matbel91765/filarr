/**
 * publishValidation — REFUSER AVANT DE SIGNER, ET DIRE OÙ.
 *
 * Trois choses sont irréversibles à la publication : l'identifiant est
 * DÉFINITIF (premier arrivé, premier servi), un numéro de version est IMMUABLE
 * (jamais republiable), et le quota est de dix publications par jour. Une faute
 * de frappe s'y paie cher et longtemps.
 *
 * L'ancien formulaire connaissait déjà ces règles — il les appliquait sur un
 * `valid` booléen unique qui, quand il valait `false`, se contentait de griser
 * le bouton. L'auteur voyait un bouton mort et devait deviner lequel de ses huit
 * champs le tuait. Ici, chaque règle nomme SON champ et SON étape : le bouton
 * peut rester grisé, l'écran, lui, dit pourquoi.
 *
 * Module PUR — se teste sans DOM.
 */

import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceCategory,
} from '../../../services/plugins/marketplaceTypes';

export const SLUG_RE = /^[a-z][a-z0-9-]{1,63}$/;
export const SEMVER_RE = /^\d+\.\d+\.\d+$/;
export const EXT_RE = /^[a-z0-9]{1,10}$/;
export const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
export const MAX_NAME = 100;
export const MAX_DESCRIPTION = 2000;

/** Miroir de isValidPluginIcon du worker — en POINTS DE CODE, jamais en unités
 *  UTF-16 (un emoji ZWJ en vaut onze à lui seul). */
const MAX_ICON_CODE_POINTS = 8;
const EXTENDED_PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Le même verdict que le worker, rendu AVANT de dépenser une signature. */
export function isPluginIconValid(icon: string): boolean {
  const points = [...icon];
  if (points.length < 1 || points.length > MAX_ICON_CODE_POINTS) return false;
  let pictogramme = false;
  for (const ch of points) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0xfe0f || cp === 0x200d) continue;
    if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue;
    if (!EXTENDED_PICTOGRAPHIC.test(ch)) return false;
    pictogramme = true;
  }
  return pictogramme;
}

/** Les quatre temps du parcours guidé, dans l'ordre. */
export const PUBLISH_STEPS = ['bundle', 'identity', 'capabilities', 'review'] as const;
export type PublishStepId = (typeof PUBLISH_STEPS)[number];

export interface PublishDraft {
  slug: string;
  name: string;
  description: string;
  version: string;
  /** Saisie brute « md, csv » — normalisée par `parseExtensions`. */
  extensionsRaw: string;
  icon: string;
  category: MarketplaceCategory;
  /**
   * LES CAPTURES, déjà réencodées en 1280×720 WebP par `makePreviewImage`.
   *
   * Le brouillon ne garde jamais le fichier d'origine : une photo de six
   * mégaoctets déposée telle quelle ferait un manifeste que le serveur refuse,
   * et le refus arriverait après le clic « Publier », pas au dépôt.
   */
  previews: string[];
  bundle: { name: string; bytes: Uint8Array } | null;
}

export const EMPTY_DRAFT: PublishDraft = {
  slug: '',
  name: '',
  description: '',
  version: '1.0.0',
  extensionsRaw: '',
  icon: '',
  category: 'other',
  previews: [],
  bundle: null,
};

/** « .MD , csv,, md » → ['md', 'csv'] : minuscules, sans point, dédupliquées. */
export function parseExtensions(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(',')) {
    const ext = piece.trim().toLowerCase().replace(/^\./, '');
    if (ext && !out.includes(ext)) out.push(ext);
  }
  return out;
}

/** Les champs nommables — un problème pointe TOUJOURS l'un d'eux. */
export type PublishFieldName =
  | 'bundle'
  | 'slug'
  | 'name'
  | 'description'
  | 'version'
  | 'extensions'
  | 'icon'
  | 'category';

/** Un problème NOMMÉ : quel champ, quelle phrase, à quelle étape. */
export interface PublishIssue {
  step: PublishStepId;
  field: PublishFieldName;
  /** Clé i18n de la phrase — jamais un message en dur. */
  messageKey: string;
}

/** TOUS les problèmes du brouillon, dans l'ordre des étapes. */
export function draftIssues(draft: PublishDraft): PublishIssue[] {
  const issues: PublishIssue[] = [];

  if (!draft.bundle) {
    issues.push({
      step: 'bundle',
      field: 'bundle',
      messageKey: 'marketplace.wizard.issues.noBundle',
    });
  } else if (draft.bundle.bytes.byteLength > MAX_BUNDLE_BYTES) {
    issues.push({
      step: 'bundle',
      field: 'bundle',
      messageKey: 'marketplace.errors.bundle_too_large',
    });
  }

  if (!SLUG_RE.test(draft.slug)) {
    issues.push({ step: 'identity', field: 'slug', messageKey: 'marketplace.wizard.issues.slug' });
  }
  const name = draft.name.trim();
  if (name.length < 1 || name.length > MAX_NAME) {
    issues.push({ step: 'identity', field: 'name', messageKey: 'marketplace.wizard.issues.name' });
  }
  if (draft.description.length > MAX_DESCRIPTION) {
    issues.push({
      step: 'identity',
      field: 'description',
      messageKey: 'marketplace.wizard.issues.description',
    });
  }
  if (!SEMVER_RE.test(draft.version)) {
    issues.push({
      step: 'identity',
      field: 'version',
      messageKey: 'marketplace.wizard.issues.version',
    });
  }

  const exts = parseExtensions(draft.extensionsRaw);
  if (exts.length === 0) {
    issues.push({
      step: 'capabilities',
      field: 'extensions',
      messageKey: 'marketplace.wizard.issues.noExtensions',
    });
  } else if (!exts.every((e) => EXT_RE.test(e))) {
    issues.push({
      step: 'capabilities',
      field: 'extensions',
      messageKey: 'marketplace.wizard.issues.badExtensions',
    });
  }
  const icon = draft.icon.trim();
  if (icon !== '' && !isPluginIconValid(icon)) {
    issues.push({
      step: 'capabilities',
      field: 'icon',
      messageKey: 'marketplace.publish.iconInvalid',
    });
  }
  if (!(MARKETPLACE_CATEGORIES as readonly string[]).includes(draft.category)) {
    issues.push({
      step: 'capabilities',
      field: 'category',
      messageKey: 'marketplace.wizard.issues.category',
    });
  }

  return issues;
}

/** Les problèmes d'une étape — pour la marquer « à corriger » dans la frise. */
export function issuesOfStep(issues: readonly PublishIssue[], step: PublishStepId): PublishIssue[] {
  return issues.filter((i) => i.step === step);
}

export function issueOfField(
  issues: readonly PublishIssue[],
  field: PublishFieldName
): PublishIssue | undefined {
  return issues.find((i) => i.field === field);
}

/**
 * UN REFUS DU SERVEUR RAMÈNE À L'ÉTAPE COUPABLE.
 *
 * Sans cette table, « cet identifiant est déjà pris » s'affichait en bandeau
 * au-dessus d'un formulaire qu'il fallait relire en entier pour trouver le champ
 * concerné — alors que le serveur venait de le nommer. Une publication refusée
 * doit rouvrir l'étape fautive, pas laisser l'auteur chercher.
 */
export function stepForErrorCode(
  code: string | null
): { step: PublishStepId; field: PublishFieldName } | null {
  switch (code) {
    case 'slug_taken':
      return { step: 'identity', field: 'slug' };
    case 'version_exists':
    case 'version_rollback':
      return { step: 'identity', field: 'version' };
    case 'bundle_too_large':
    case 'hash_mismatch':
      return { step: 'bundle', field: 'bundle' };
    case 'bad_manifest':
      return { step: 'capabilities', field: 'extensions' };
    default:
      // bad_signature, fingerprint_mismatch, rate_limited, unknown : rien à
      // corriger dans un champ — le récapitulatif les affiche tels quels.
      return null;
  }
}
