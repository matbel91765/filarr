/**
 * layoutMarketApi — la couche HTTP mince du marché de modèles (motif
 * `marketplaceApi.ts`).
 *
 * LES DTO SONT OPAQUES. Rien de ce que ce module rend n'est cru : toute la
 * confiance vit dans `layoutMarketSigning.ts` (signature, empreinte,
 * anti-substitution) et `layoutMarketInstall.ts` (le geste complet). Le serveur
 * est un relais réputé hostile — ces types décrivent la FORME de ce qu'il
 * envoie, pas sa véracité.
 *
 * ⚠ Ces DTO ne vivent PAS dans `layoutMarketTypes.ts`, et ce n'est pas un
 * oubli : ce module-là est PORTÉ tel quel dans le worker
 * (`scripts/layout-core-port.cjs`). Y ranger des types d'API client ferait
 * voyager dans le serveur des formes qui ne le concernent pas, et un import
 * `apiClient` impossible à résoudre le jour où quelqu'un les rapprocherait.
 */

import apiClient from '../network/apiClient';
import type { LayoutFileTarget } from './layoutFormat';

/** Le code d'erreur du worker, ou `null`. Miroir de `marketplaceErrorCode`. */
export function layoutMarketErrorCode(e: unknown): string | null {
  const anyErr = e as { response?: { data?: { code?: unknown } } } | null;
  const code = anyErr?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Une ligne du catalogue, telle que le worker la sert.
 *
 * `name`, `description` et `icon` sont des MIROIRS non signés de l'enveloppe :
 * le worker les duplique en colonnes pour trier sans analyser cinquante
 * enveloppes. Ils s'affichent en texte brut, dans un `<bdi>`, écrêtés — jamais
 * en HTML, jamais sans isolation bidirectionnelle.
 */
export interface LayoutMarketSummary {
  slug: string;
  name: string;
  description: string;
  latestVersion: string;
  publisherFingerprint: string;
  downloads: number;
  status: 'published' | 'unlisted';
  updatedAt: string;
  ownedByMe: boolean;
  icon: string | null;
  category: string | null;
  target: string;
  /** Pseudonyme REVENDIQUE — jamais une preuve. Voir `OFFICIAL_FINGERPRINTS`. */
  author: string | null;
}

/** Une version, vue de la fiche : les métadonnées SEULES. */
export interface LayoutMarketVersionSummary {
  version: string;
  sizeBytes: number;
  createdAt: string;
}

export interface LayoutMarketDetail extends LayoutMarketSummary {
  versions: LayoutMarketVersionSummary[];
}

/** L'enveloppe et sa signature — les octets, pas encore la confiance. */
export interface LayoutMarketEnvelopeDTO {
  /** LA CHAÎNE, verbatim. La re-sérialiser casserait la signature. */
  envelopeJson: string;
  signature: string;
  signPublicKey: string;
  sizeBytes: number;
  createdAt: string;
}

const base = '/layout-market';

/**
 * Le catalogue.
 *
 * `category` et `target` sont des paramètres SERVEUR, pas des filtres
 * d'affichage : la réponse est bornée à 50 lignes, si bien qu'un filtrage local
 * répondrait « aucun modèle d'accueil » alors qu'il en existe à la page
 * suivante — et se combinerait de travers avec la recherche.
 */
export async function apiListLayoutMarket(opts: {
  q?: string;
  offset?: number;
  category?: string;
  target?: LayoutFileTarget;
}): Promise<LayoutMarketSummary[]> {
  const params: Record<string, string | number> = {};
  if (opts.q) params.q = opts.q;
  if (opts.offset) params.offset = opts.offset;
  if (opts.category) params.category = opts.category;
  if (opts.target) params.target = opts.target;
  const res = await apiClient.get(base, { params });
  return (res.data?.data?.templates ?? []) as LayoutMarketSummary[];
}

export async function apiGetLayoutMarketTemplate(slug: string): Promise<LayoutMarketDetail> {
  const res = await apiClient.get(`${base}/${encodeURIComponent(slug)}`);
  return res.data?.data as LayoutMarketDetail;
}

/**
 * L'enveloppe d'une version précise.
 *
 * Servie pour TOUTE version existante, même après un retrait : les versions
 * sont immuables, et quelqu'un qui a déjà installé doit pouvoir réinstaller et
 * re-vérifier.
 */
export async function apiGetLayoutMarketEnvelope(
  slug: string,
  version: string,
  /**
   * `true` = un COUP D'ŒIL, pas une prise. Le worker n'incrémente alors pas le
   * compteur : la page de détail lit l'enveloppe pour dessiner la géométrie, et
   * sans cette distinction chaque consultation vaudrait une installation.
   */
  preview = false
): Promise<LayoutMarketEnvelopeDTO> {
  const res = await apiClient.get(
    `${base}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
    preview ? { params: { preview: '1' } } : undefined
  );
  return res.data?.data as LayoutMarketEnvelopeDTO;
}

export interface LayoutPublishPayload {
  /** Les octets exacts signés — la chaîne part telle quelle, jamais re-sérialisée. */
  envelopeJson: string;
  signature: string;
}

export async function apiPublishLayoutTemplate(
  body: LayoutPublishPayload
): Promise<{ slug: string; version: string }> {
  const res = await apiClient.post(base, body);
  return res.data?.data as { slug: string; version: string };
}

export async function apiPublishLayoutVersion(
  slug: string,
  body: LayoutPublishPayload
): Promise<{ version: string }> {
  const res = await apiClient.post(`${base}/${encodeURIComponent(slug)}/versions`, body);
  return res.data?.data as { version: string };
}

export async function apiUnlistLayoutTemplate(slug: string): Promise<void> {
  await apiClient.delete(`${base}/${encodeURIComponent(slug)}`);
}

/**
 * Signaler un modèle. 10–500 caractères, cinq par jour et par compte.
 *
 * Un modèle invisible du signalant rend le 404 uniforme `template_not_found` —
 * identique à celui d'un slug inventé, pour que le signalement ne devienne pas
 * un oracle d'existence. Un second signalement du même compte rend 409.
 */
export async function apiReportLayoutTemplate(slug: string, reason: string): Promise<void> {
  await apiClient.post(`${base}/${encodeURIComponent(slug)}/report`, { reason });
}
