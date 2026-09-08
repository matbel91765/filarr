/**
 * Pièces jointes d'un export Notion (images, PDF, fichiers).
 *
 * Un export « Markdown & CSV » range les fichiers d'une page dans un dossier
 * frère du `.md`, et les référence en relatif, URL-encodé :
 *
 *     ![Schéma](Ma%20page%20abc123def/schema.png)
 *
 * Rien de tout ça n'arrivait dans les notes : le lecteur d'archive décodait
 * pourtant déjà ces entrées en base64, mais l'orchestrateur jetait l'étiquette
 * qui les distinguait d'un fichier texte. Ce module reconstruit l'index et rend
 * les octets sous forme de data-URI — la forme sous laquelle une image voyage
 * CHIFFRÉE dans une note Filarr.
 */

import type { SourceEntry } from '../externalImportService';
import type { ResolvedAsset } from '../markdownBlocks';

/**
 * Au-delà, la pièce jointe n'est pas embarquée.
 *
 * Une image traverse le coffre en base64 (+33 %), et le coffre de notes est
 * déchiffré EN ENTIER à l'ouverture : embarquer quelques photos d'appareil
 * photo suffirait à faire ramer chaque frappe. Ce qui dépasse est signalé,
 * jamais avalé en silence.
 */
export const MAX_EMBEDDED_ASSET_BYTES = 8 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  pdf: 'application/pdf',
};

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function mimeOf(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? 'application/octet-stream';
}

/** Taille réelle des octets derrière une charge base64, sans la décoder. */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

export interface AssetIndex {
  /** Résout un href relatif depuis le dossier d'une note donnée. */
  resolve: (fromPath: string, href: string) => ResolvedAsset | null;
  /** Nombre d'entrées binaires vues dans l'archive. */
  total: number;
  /** Fichiers écartés pour cause de taille, dans l'ordre de rencontre. */
  skipped: string[];
}

function dirNameOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/** Décode un href, en tolérant un pourcentage isolé (Notion en produit). */
function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Normalise un chemin : `a/./b`, `a/b/../c` → `a/b`, `a/c`. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const piece of path.split('/')) {
    if (!piece || piece === '.') continue;
    if (piece === '..') {
      parts.pop();
      continue;
    }
    parts.push(piece);
  }
  return parts.join('/');
}

/**
 * Construit l'index des pièces jointes de l'archive.
 *
 * Trois clés par fichier : le chemin complet, le chemin décodé, et le nom seul.
 * Le nom seul est le filet de sécurité — les exports Notion mélangent parfois
 * l'encodage entre le lien et le nom réel du fichier, et une image retrouvée
 * par son nom vaut mieux qu'une image perdue.
 */
export function buildAssetIndex(entries: SourceEntry[]): AssetIndex {
  const byPath = new Map<string, SourceEntry>();
  const byName = new Map<string, SourceEntry>();
  const skipped: string[] = [];
  let total = 0;

  for (const entry of entries) {
    if (entry.isDirectory || entry.encoding !== 'base64') continue;
    total += 1;
    const path = normalize(entry.relativePath);
    byPath.set(path, entry);
    byPath.set(normalize(decodeHref(entry.relativePath)), entry);
    const name = path.split('/').pop() ?? path;
    // Premier arrivé, premier servi : deux fichiers de même nom dans deux
    // pages différentes se départagent par leur chemin complet, qui, lui, est
    // toujours tenté en premier.
    if (!byName.has(name)) byName.set(name, entry);
  }

  const resolve = (fromPath: string, href: string): ResolvedAsset | null => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null; // http(s), data:, mailto:…
    const decoded = decodeHref(href).split('#')[0].split('?')[0];
    const dir = dirNameOf(normalize(fromPath));
    const candidates = [
      normalize(dir ? `${dir}/${decoded}` : decoded),
      normalize(decoded),
      normalize(href),
    ];

    let entry: SourceEntry | undefined;
    for (const candidate of candidates) {
      entry = byPath.get(candidate);
      if (entry) break;
    }
    if (!entry) entry = byName.get(decoded.split('/').pop() ?? decoded);
    if (!entry) return null;

    const size = base64Bytes(entry.content);
    if (size > MAX_EMBEDDED_ASSET_BYTES) {
      if (!skipped.includes(entry.relativePath)) skipped.push(entry.relativePath);
      return null;
    }

    const mime = mimeOf(entry.relativePath);
    return {
      src: `data:${mime};base64,${entry.content}`,
      fileName: entry.relativePath.split('/').pop() ?? 'file',
      mime,
    };
  };

  return { resolve, total, skipped };
}
