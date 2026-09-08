/**
 * LECTURE DU CONTENEUR DU CLIENT WEB — `hybridCrypto.encryptFileContent`.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 * Le bureau scelle ses objets de note dans la famille « v2: » (clé machine,
 * `StorageService.encrypt`) ; le client web les scelle sous la FEK, dans un
 * conteneur qui n'a rien à voir. AUCUN DES DEUX NE LISAIT L'AUTRE : un coffre
 * ouvert des deux côtés voyait les objets d'en face comme illisibles, donc comme
 * ABSENTS — et la note écrite dans le navigateur n'arrivait jamais sur
 * l'ordinateur, sans la moindre erreur affichée. Le mobile, lui, lit déjà les
 * deux (`notesV2/notesTransport.openObject`).
 *
 * ⚠ CE MODULE NE SERT QU'À LIRE. Le bureau continue de sceller en « v2: », le
 * web sous la FEK. Rescelller dans l'autre famille rendrait les objets
 * illisibles par des versions déjà installées, et personne n'a demandé ça.
 *
 * ── LE FORMAT ───────────────────────────────────────────────────────────────
 *
 *     marqueur(1) || IV(12) || AES-256-GCM(clé, clair)
 *
 * avec `0x01` = clair tel quel, `0x02` = clair passé par deflate (zlib). Et une
 * forme HÉRITÉE sans marqueur : IV(12) || ciphertext, jamais compressée.
 *
 * L'IV est uniformément aléatoire : environ un conteneur hérité sur cent
 * vingt-huit commence par un octet qui ressemble à un marqueur. La forme marquée
 * est donc essayée d'abord, et c'est l'échec d'AUTHENTIFICATION GCM — pas une
 * heuristique sur les octets — qui fait retomber sur la forme héritée. C'est
 * exactement la discipline de `decryptFileContent`, et il n'y en a pas d'autre
 * qui soit sûre.
 *
 * ── PUR, DONC ÉPROUVABLE ────────────────────────────────────────────────────
 * Les clés arrivent en paramètre. C'est ce qui permet de confronter ce lecteur à
 * des vecteurs construits comme le web les construit, sans monter un profil ni
 * un coffre déverrouillé.
 */

import * as crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const inflateAsync = promisify(zlib.inflate);

/** Longueur d'IV du conteneur web — douze octets, comme le recommande GCM. */
export const WEB_IV_LENGTH = 12;

/** Marqueur « le clair suit tel quel ». */
export const WEB_FORMAT_PLAIN = 0x01;

/** Marqueur « le clair a été passé par deflate ». */
export const WEB_FORMAT_DEFLATE = 0x02;

/** Longueur du tag GCM. En dessous d'IV + tag, il n'y a pas de conteneur. */
const GCM_TAG_LENGTH = 16;

/**
 * Ouvre un conteneur web avec la PREMIÈRE clé qui l'authentifie.
 *
 * `keys` est une liste ordonnée : la clé du compte d'abord, puis les clés
 * RETIRÉES. Ce n'est pas une rustine — après une bascule de clé, tout objet
 * antérieur n'ouvre que sous une clé retirée, et le web fait exactement le même
 * détour. Ne garder que la clé active ferait passer pour illisibles précisément
 * les objets les plus anciens.
 *
 * JETTE quand aucune clé n'ouvre : c'est l'appelant qui décide si « illisible »
 * vaut « absent ». Ici on ne sait que dire ce qui s'est passé.
 */
export async function openWebFileContainer(
  container: Buffer,
  keys: readonly Buffer[]
): Promise<Buffer> {
  if (container.length < WEB_IV_LENGTH + GCM_TAG_LENGTH) {
    throw new Error('conteneur web: trop court pour être valide');
  }
  if (keys.length === 0) {
    throw new Error('conteneur web: aucune clé de lecture disponible');
  }

  const marker = container[0];
  const tagged = marker === WEB_FORMAT_PLAIN || marker === WEB_FORMAT_DEFLATE;

  for (const raw of keys) {
    const key = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(raw),
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    if (tagged) {
      try {
        const iv = container.subarray(1, 1 + WEB_IV_LENGTH);
        const ct = container.subarray(1 + WEB_IV_LENGTH);
        const plain = Buffer.from(
          await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(ct))
        );
        return marker === WEB_FORMAT_DEFLATE ? await inflateAsync(plain) : plain;
      } catch {
        // Soit la clé n'est pas la bonne, soit ces octets n'étaient pas marqués
        // et leur IV commençait par hasard par 0x01/0x02 : la forme héritée est
        // essayée juste en dessous, avec la même clé.
      }
    }

    try {
      const iv = container.subarray(0, WEB_IV_LENGTH);
      const ct = container.subarray(WEB_IV_LENGTH);
      return Buffer.from(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(ct))
      );
    } catch {
      // Clé suivante.
    }
  }

  throw new Error('conteneur web: aucune clé n ouvre ce conteneur');
}
