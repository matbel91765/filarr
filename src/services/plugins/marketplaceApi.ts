/**
 * marketplaceApi — la couche HTTP mince de la place de marché (motif
 * vaultApi.ts). Les DTO sont opaques : toute la crypto (signature, hash,
 * empreinte, TOFU) vit dans pluginSigning.ts / installedPlugins.ts — le
 * serveur n'est qu'un relais réputé hostile.
 */

import apiClient from '../network/apiClient';
import type { MarketplacePluginDetail, MarketplacePluginSummary } from './marketplaceTypes';

export function marketplaceErrorCode(e: unknown): string | null {
  const anyErr = e as { response?: { data?: { code?: unknown } } } | null;
  const code = anyErr?.response?.data?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * Le catalogue. `category` est un paramètre SERVEUR, pas un filtre d'affichage :
 * la réponse est bornée à 50 lignes, si bien qu'un filtrage local aurait
 * répondu « aucun plugin dans cette catégorie » alors qu'il en existait à la
 * page suivante — et se serait combiné de travers avec la recherche.
 */
export async function apiListMarketplace(
  q?: string,
  offset?: number,
  category?: string
): Promise<MarketplacePluginSummary[]> {
  const params: Record<string, string | number> = {};
  if (q) params.q = q;
  if (offset) params.offset = offset;
  if (category) params.category = category;
  const res = await apiClient.get('/marketplace', { params });
  return (res.data?.data?.plugins ?? []) as MarketplacePluginSummary[];
}

export async function apiGetMarketplacePlugin(slug: string): Promise<MarketplacePluginDetail> {
  const res = await apiClient.get(`/marketplace/${encodeURIComponent(slug)}`);
  return res.data?.data as MarketplacePluginDetail;
}

export async function apiDownloadPluginBundle(slug: string, version: string): Promise<Uint8Array> {
  const res = await apiClient.get(
    `/marketplace/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}/bundle`,
    { responseType: 'arraybuffer' }
  );
  return new Uint8Array(res.data as ArrayBuffer);
}

export interface PublishPayload {
  /** Les octets exacts signés — la chaîne part telle quelle, jamais re-sérialisée. */
  manifestJson: string;
  signature: string;
  bundleBase64: string;
}

export async function apiPublishPlugin(
  body: PublishPayload
): Promise<{ slug: string; version: string }> {
  const res = await apiClient.post('/marketplace', body);
  return res.data?.data as { slug: string; version: string };
}

export async function apiPublishPluginVersion(
  slug: string,
  body: PublishPayload
): Promise<{ version: string }> {
  const res = await apiClient.post(`/marketplace/${encodeURIComponent(slug)}/versions`, body);
  return res.data?.data as { version: string };
}

export async function apiUnlistPlugin(slug: string): Promise<void> {
  await apiClient.delete(`/marketplace/${encodeURIComponent(slug)}`);
}

/**
 * Signaler un plugin. 10–500 caractères, cinq par jour et par compte.
 * Un plugin invisible du signalant rend le 404 uniforme `plugin_not_found` —
 * identique à celui d'un slug inventé ; un second signalement du même compte
 * rend 409 `already_reported`.
 */
export async function apiReportPlugin(slug: string, reason: string): Promise<void> {
  await apiClient.post(`/marketplace/${encodeURIComponent(slug)}/report`, { reason });
}
