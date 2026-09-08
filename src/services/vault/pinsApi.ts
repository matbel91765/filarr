import apiClient from '../network/apiClient';
import { encryptVaultBlob, decryptVaultBlob } from './vaultCrypto';
import { getVaultKey } from './vaultKeyCache';
import { encodePinsDoc, parsePinsDoc, type PinsDoc } from './pinsModel';

/**
 * MES ÉPINGLES, CÔTÉ CLIENT — ce qui part, ce qui revient, et le scellé.
 *
 * LE SERVEUR NE LIT JAMAIS LE DOCUMENT. Il range un blob opaque par
 * (utilisateur, coffre) et une `version` pour le compare-and-set. Le blob est
 * scellé ici, sous la clé du coffre que ce compte détient déjà : qui peut lire
 * les épingles peut déjà lire les éléments, et aucun matériel cryptographique
 * n'est ajouté.
 *
 * LA FORME SUR LE FIL, gelée avec le mobile : `epoch.iv.ciphertext` — trois
 * segments base64-sûrs séparés par un point. L'ÉPOQUE est là pour la même
 * raison que `wrappedUnderEpoch` sur les éléments : la clé du coffre tourne
 * quand un membre est retiré, et un blob scellé sous l'époque N ne s'ouvre pas
 * avec la clé de N+1. On l'ouvre avec la clé de SON époque, et on rescelle
 * sous l'époque courante à la prochaine écriture.
 */

export interface PinsRemote {
  blob: string | null;
  version: number;
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export async function apiGetVaultPins(vaultId: string): Promise<PinsRemote> {
  const { data } = await apiClient.get<Envelope<PinsRemote>>(`/vaults/${vaultId}/pins`);
  return { blob: data.data?.blob ?? null, version: data.data?.version ?? 0 };
}

export type PutPinsResult = { ok: true; version: number } | { ok: false; current: PinsRemote };

/**
 * Compare-and-set. Un 409 n'est pas une erreur : c'est l'ÉTAT COURANT, rendu
 * pour qu'on fusionne dessus sans relecture — une relecture rouvrirait la
 * course que le 409 vient de fermer.
 */
export async function apiPutVaultPins(
  vaultId: string,
  blob: string,
  baseVersion: number
): Promise<PutPinsResult> {
  try {
    const { data } = await apiClient.put<Envelope<{ version: number }>>(`/vaults/${vaultId}/pins`, {
      blob,
      baseVersion,
    });
    return { ok: true, version: data.data?.version ?? baseVersion + 1 };
  } catch (e) {
    const resp = (e as { response?: { status?: number; data?: Envelope<PinsRemote> } })?.response;
    if (resp?.status === 409 && resp.data?.code === 'pins_version_conflict') {
      return {
        ok: false,
        current: { blob: resp.data.data?.blob ?? null, version: resp.data.data?.version ?? 0 },
      };
    }
    throw e;
  }
}

// ── Le scellé ───────────────────────────────────────────────────────────────

export async function sealPins(
  doc: PinsDoc,
  vaultId: string,
  epoch: number
): Promise<string | null> {
  const kVault = getVaultKey(vaultId, epoch);
  if (!kVault) return null;
  const { ciphertext, iv } = await encryptVaultBlob(encodePinsDoc(doc), kVault);
  return `${epoch}.${iv}.${ciphertext}`;
}

/**
 * Ouvrir un blob. `null` quand on ne PEUT pas (clé de cette époque absente de
 * la session, blob altéré) — jamais un document vide déguisé : l'appelant
 * décide s'il repart de zéro, et il le fait en le sachant.
 */
export async function unsealPins(blob: string | null, vaultId: string): Promise<PinsDoc | null> {
  if (!blob) return parsePinsDoc(null);
  const parts = blob.split('.');
  if (parts.length !== 3) return null;
  const epoch = Number(parts[0]);
  if (!Number.isInteger(epoch) || epoch < 0) return null;
  const kVault = getVaultKey(vaultId, epoch);
  if (!kVault) return null;
  try {
    return parsePinsDoc(await decryptVaultBlob(parts[2], parts[1], kVault));
  } catch {
    return null;
  }
}
