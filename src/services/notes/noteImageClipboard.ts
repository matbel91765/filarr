/**
 * Copier / enregistrer une image d'une note.
 *
 * POURQUOI CE MODULE EXISTE — un « Ctrl+C » sur une image de note ne mettait
 * QUE du HTML dans le presse-papiers (ProseMirror sérialise le nœud), jamais
 * de bitmap. Résultat : coller dans Paint, Word, Discord ou un mail ne donnait
 * rien. Et Electron n'installe aucun menu contextuel par défaut, donc le
 * « clic droit → Copier l'image » du navigateur n'existait pas non plus.
 *
 * On écrit donc les DEUX formes : l'image (pour le monde extérieur) et le HTML
 * (pour que le collage dans Filarr retrouve son `fileEmbed`).
 */

import { isWebPlatform } from '../platform/isWebPlatform';

/** `true` quand le pont Electron est là (donc hors navigateur). */
function hasElectronBridge(): boolean {
  return (
    !isWebPlatform() &&
    typeof window !== 'undefined' &&
    typeof window.electron?.ipcRenderer?.invoke === 'function'
  );
}

/** Découpe une URL `data:` en type MIME + octets. */
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  try {
    if (isBase64) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return { mime, bytes };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  } catch {
    return null;
  }
}

/**
 * Ré-encode en PNG via un canvas.
 *
 * L'API presse-papiers des navigateurs n'accepte QUE `image/png` : une image
 * JPEG ou WebP collée telle quelle est refusée par `ClipboardItem`. Sous
 * Electron on n'en a pas besoin (`nativeImage` lit les deux), donc ce détour
 * ne sert qu'au client web.
 */
async function toPngBlob(dataUrl: string): Promise<Blob | null> {
  const decoded = decodeDataUrl(dataUrl);
  if (decoded?.mime === 'image/png') {
    return new Blob([decoded.bytes as unknown as BlobPart], { type: 'image/png' });
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/**
 * Met l'image dans le presse-papiers du système.
 *
 * Rend `false` (jamais d'exception) quand ça n'a pas pu se faire : l'appelant
 * prévient l'utilisateur au lieu de le laisser croire à une copie réussie.
 */
export async function copyNoteImage(src: string, fileName = 'image'): Promise<boolean> {
  if (!src) return false;

  if (hasElectronBridge()) {
    try {
      return (await window.electron.ipcRenderer.invoke(
        'clipboard:writeImage',
        src,
        fileName
      )) as boolean;
    } catch {
      return false;
    }
  }

  // Client web : ClipboardItem, PNG obligatoire.
  try {
    const png = await toPngBlob(src);
    if (!png || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}

export type SaveImageOutcome = 'saved' | 'cancelled' | 'failed';

/**
 * Enregistre l'image sur le disque via le dialogue natif. Sur le client web,
 * on retombe sur un téléchargement de navigateur.
 */
export async function saveNoteImageAs(src: string, fileName = 'image'): Promise<SaveImageOutcome> {
  const decoded = decodeDataUrl(src);
  if (!decoded) return 'failed';
  const safeName = suggestFileName(fileName, decoded.mime);

  if (hasElectronBridge()) {
    try {
      // Dialogue ET écriture dans le MÊME appel : le renderer ne choisit pas
      // le chemin (pas d'écriture arbitraire), et l'enregistrement hors du
      // dossier personnel reste possible — ce que `writeRawFile` refuse.
      return (await window.electron.ipcRenderer.invoke(
        'notes:saveImageAs',
        src,
        safeName
      )) as SaveImageOutcome;
    } catch {
      return 'failed';
    }
  }

  try {
    const blob = new Blob([decoded.bytes as unknown as BlobPart], { type: decoded.mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    link.click();
    URL.revokeObjectURL(url);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Nom de fichier proposé : celui de la note si utilisable, sinon `image.<ext>`. */
function suggestFileName(fileName: string, mime: string): string {
  const ext = mime.split('/')[1]?.split('+')[0] || 'png';
  const base = (fileName || 'image').replace(/[\\/:*?"<>|]/g, '_').trim() || 'image';
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${ext}`;
}
