/**
 * TRANSPORT v2 SUR R2 — la plomberie qui relie `syncNotesV2` au reseau reel.
 *
 * Tout le raisonnement vit dans `notesSyncV2` et s'eprouve sans reseau. Ici il
 * n'y a que du chiffrement et des appels : c'est voulu, ce fichier n'a presque
 * rien a prouver.
 *
 * ═══ LES NOTES NE SONT PAS DANS LE MANIFESTE, ET C'EST LE POINT CLE ═══
 *
 * Un objet par note, c'est potentiellement des milliers d'entrees. Les mettre
 * dans `sync-manifest.json` ferait deux index pour la meme chose — le manifeste
 * et l'index de notes — qui pourraient diverger, et gonflerait un fichier que
 * CHAQUE cycle telecharge et rechiffre.
 *
 * L'INDEX DE NOTES *EST* LEUR MANIFESTE. Le manifeste de synchronisation ne
 * porte qu'UNE entree, `meta:notes-index`, dont l'empreinte suffit a savoir si
 * le distant a bouge. Tout le reste — quelle note, quelle horloge, quelle
 * empreinte — vit dans l'index, qui est CHIFFRE. Le serveur voit donc des
 * objets opaques et un compteur, jamais la structure du coffre.
 *
 * ═══ LES CLES ═══
 *
 *   meta:notes-index   → l'index (petit, quelques Ko)
 *   note:<objectId>    → une note
 *
 * `note:` rejoint la convention deja en place (`meta:<folderId>`), donc la
 * comptabilite de stockage, les quotas et la suppression du serveur marchent
 * sans changement cote Worker.
 */

import log from 'electron-log';

import StorageService from '../storageService';
import * as r2 from './syncR2Client';
import {
  isNotesIndexShape,
  normalizeIndex,
  type NoteRecord,
  type NotesIndex,
} from './notesStoreV2';
import type { NotesTransport } from './notesSyncV2';
import { isValidObjectId } from './notesVaultStore';

/** Entree du manifeste qui porte l'index — la seule que la v2 y ajoute. */
export const NOTES_INDEX_FILE_ID = 'meta:notes-index';

/** Cle d'un objet de note. Le prefixe suit la convention `meta:<id>` existante. */
export function noteFileId(objectId: string): string {
  return `note:${objectId}`;
}

/**
 * Scelle un objet en clair. MEME CONTENEUR que `notes.enc` — cle MACHINE via
 * `StorageService` — pour que rien du chemin de dechiffrement ne change entre
 * v1 et v2, et que la migration ne soit qu'un deplacement d'octets.
 */
async function seal(plain: unknown): Promise<Buffer> {
  return Buffer.from(await StorageService.encrypt(plain), 'utf-8');
}

/**
 * Ouvre un conteneur, QUELLE QUE SOIT SA FAMILLE. `null` sur tout ce qui n'est
 * pas exploitable — un objet illisible n'est pas une exception a faire remonter
 * jusqu'au cycle, c'est une reponse : « je n'ai pas ca ».
 *
 * ⚠ DEUX FAMILLES COHABITENT DANS LE MEME COFFRE, et c'est le nominal :
 *
 *   · l'ORDINATEUR scelle en « v2: » (cle machine, `StorageService.encrypt`) ;
 *   · le CLIENT WEB scelle sous la FEK (`hybridCrypto.encryptFileContent`).
 *
 * Aucun des deux ne lisait l'autre. Un coffre ouvert des deux cotes voyait donc
 * les objets d'en face comme illisibles, donc comme ABSENTS : la note ecrite
 * dans le navigateur n'arrivait jamais sur l'ordinateur, sans la moindre erreur
 * affichee. Le mobile, lui, lit deja les deux
 * (`notesV2/notesTransport.openObject`).
 *
 * ON NE CHANGE PAS CE QU'ON ECRIT : `seal` continue de produire du « v2: ».
 * Rescelller dans l'autre famille rendrait les objets illisibles par les
 * versions deja installees.
 *
 * L'ORDRE COMPTE. La famille machine est un conteneur TEXTE reconnaissable a son
 * prefixe : on la tente d'abord, et l'echec y est immediat et sans cout. La
 * famille FEK n'est essayee qu'ensuite, et son echec ne dit rien de plus que
 * « ce n'est ni l'une ni l'autre ».
 */
async function open(buffer: Buffer): Promise<unknown | null> {
  if (buffer.length === 0) return null;
  try {
    const container = buffer.toString('utf-8');
    if (container.trim().length === 0) return null;
    return await StorageService.decrypt(container);
  } catch {
    // Pas la famille machine (ou clé indisponible) — on tente celle du web.
  }
  try {
    const plain = await StorageService.decryptWebFileContainer(buffer);
    return JSON.parse(plain.toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Fabrique le transport pour un profil.
 *
 * AUCUNE METHODE N'AVALE SES ERREURS. `syncNotesV2` compte dessus : c'est lui
 * qui distingue une descente ratee (sans consequence) d'une remontee ratee (qui
 * annule la publication). Un transport qui rendrait `null` au lieu de jeter lui
 * ferait prendre l'une pour l'autre.
 */
export function createR2NotesTransport(profileId: string): NotesTransport {
  return {
    async getRemoteIndex(): Promise<NotesIndex | null> {
      let buffer: Buffer;
      try {
        buffer = await r2.downloadChunk(profileId, NOTES_INDEX_FILE_ID, 0);
      } catch (err) {
        // Absent = le nuage n'a pas encore d'index v2 pour ce profil. C'est un
        // etat NORMAL (premier cycle), pas une panne : on rend `null` et le
        // cycle publiera le notre. Toute autre erreur remonte.
        const msg = (err as Error).message || '';
        if (/404|not found|introuvable/i.test(msg)) return null;
        throw err;
      }
      const plain = await open(buffer);
      if (plain === null) {
        log.warn('[notesTransport] index distant illisible — traite comme absent');
        return null;
      }
      /**
       * GARDE DE FORME. `normalizeIndex` rend un index VIDE ET VALIDE pour
       * n'importe quel objet : un dechiffrement qui a rendu autre chose qu'un
       * index se lisait donc comme « le nuage ne porte plus rien », et le cycle
       * concluait sur une contre-verite. Un objet qu'on ne reconnait pas est
       * traite comme ABSENT — c'est ce qu'on sait, et le cycle publiera le
       * notre sans rien detruire, la fusion etant une union.
       */
      if (!isNotesIndexShape(plain)) {
        log.warn(
          "[notesTransport] index distant sans la forme attendue — traite comme absent"
        );
        return null;
      }
      return normalizeIndex(plain);
    },

    async getNote(objectId: string): Promise<NoteRecord | null> {
      // L'`objectId` vient d'un index qui peut venir du nuage : c'est une
      // DONNEE. On le valide avant d'en faire une cle de requete.
      if (!isValidObjectId(objectId)) {
        throw new Error(`identifiant d'objet refuse : ${String(objectId).slice(0, 32)}`);
      }
      const buffer = await r2.downloadChunk(profileId, noteFileId(objectId), 0);
      const plain = await open(buffer);
      if (!plain || typeof plain !== 'object' || Array.isArray(plain)) return null;
      return plain as NoteRecord;
    },

    async putNote(objectId: string, note: NoteRecord): Promise<void> {
      if (!isValidObjectId(objectId)) {
        throw new Error(`identifiant d'objet refuse : ${String(objectId).slice(0, 32)}`);
      }
      await r2.uploadChunk(profileId, noteFileId(objectId), 0, await seal(note));
    },

    /**
     * LES IMAGES SONT DES OBJETS COMME LES AUTRES, sous la cle `blob:<empreinte>`.
     *
     * L'empreinte vient d'un contenu de note, qui peut venir du nuage : c'est
     * une DONNEE. On la valide avant d'en faire une cle de requete, comme pour
     * les identifiants d'objet de note.
     */
    async getBlob(hash: string): Promise<string | null> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error(`empreinte refusee : ${hash.slice(0, 32)}`);
      let buffer: Buffer;
      try {
        buffer = await r2.downloadChunk(profileId, `blob:${hash}`, 0);
      } catch (err) {
        const msg = (err as Error).message || '';
        if (/404|not found|introuvable/i.test(msg)) return null;
        throw err;
      }
      const plain = await open(buffer);
      return typeof plain === 'string' ? plain : null;
    },

    async putBlob(hash: string, base64: string): Promise<void> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error(`empreinte refusee : ${hash.slice(0, 32)}`);
      await r2.uploadChunk(profileId, `blob:${hash}`, 0, await seal(base64));
    },

    /**
     * LA SEULE METHODE DESTRUCTRICE. `syncNotesV2` ne l'appelle jamais ; le
     * cycle le fait, apres un balayage COMPLET et sous une pierre tombale qui
     * rend le geste reversible (voir `blobTombstones`). Une image deja absente
     * est le resultat voulu, pas une erreur.
     */
    async deleteBlob(hash: string): Promise<void> {
      if (!/^[0-9a-f]{16,64}$/.test(hash)) throw new Error(`empreinte refusee : ${hash.slice(0, 32)}`);
      try {
        await r2.deleteFile(profileId, `blob:${hash}`);
      } catch (err) {
        const msg = (err as Error).message || '';
        if (/404|not found|introuvable/i.test(msg)) return;
        throw err;
      }
    },

    async putIndex(index: NotesIndex): Promise<void> {
      await r2.uploadChunk(profileId, NOTES_INDEX_FILE_ID, 0, await seal(index));
    },
  };
}
