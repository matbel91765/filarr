/**
 * Clés de salle — DEUX RÉGIMES, une seule règle.
 *
 * Phase 1, « mes propres appareils » :
 *   K_salle = HKDF-SHA-256(ikm = FEK, sel = utf8(noteId), info = "filarr-collab-v1")
 *
 * Phase 2, « à plusieurs, dans un coffre » :
 *   K_salle = HKDF-SHA-256(ikm = K_vault(époque), sel = utf8("vaultId:itemId"),
 *                          info = "filarr-collab-vault-v1")
 *
 * Mêmes conventions que le format de fichier V3 (`filarr-file-v3`) et que le
 * partage E2EE (`filarr-share-v1`) : importKey('raw', …, 'HKDF') puis
 * deriveBits({ name:'HKDF', hash:'SHA-256', salt, info }, …, 256).
 *
 * LES DEUX ÉTIQUETTES SONT DISTINCTES, ET CE N'EST PAS COSMÉTIQUE. Une même
 * suite d'octets ne doit jamais produire la même clé dans deux contextes : sans
 * cette séparation, un secret réutilisé par accident (ou un jour recopié d'un
 * régime à l'autre) ouvrirait les salles de l'autre régime. L'étiquette est le
 * seul endroit où cette frontière est écrite.
 *
 * POURQUOI CHAQUE IKM EST LE BON :
 *  · phase 1 — la FEK est DÉJÀ la même sur tous les appareils d'un compte (elle
 *    est enveloppée par le mot de passe, pas par la machine). Deux appareils
 *    ouvrant la même note dérivent la même clé sans qu'aucun secret ne transite ;
 *  · phase 2 — K_vault est déjà détenue par TOUT membre du coffre pour cette
 *    époque (elle lui est enveloppée à son adhésion, et l'éditeur l'ouvre déjà
 *    pour lire le corps de l'élément). Aucune nouvelle distribution de clé,
 *    aucun secret supplémentaire à faire circuler : les membres qui peuvent
 *    LIRE l'élément sont exactement ceux qui peuvent entrer dans sa salle.
 *
 * ⚠ POURQUOI PAS K_item — LA RAISON D'ÊTRE DE CETTE DÉRIVATION.
 * `updateVaultItem` fabrique un K_item NEUF à chaque révision. Dériver la clé de
 * salle de K_item PARTITIONNAIT la salle à chaque enregistrement : les pairs
 * restés en séance gardaient la clé de la révision avec laquelle ils étaient
 * entrés, un pair ouvrant l'élément juste après en dérivait une autre, et plus
 * personne ne se déchiffrait. K_vault, elle, ne bouge PAS d'une révision à
 * l'autre : la salle survit à autant d'enregistrements qu'on veut. Le sel
 * (`vaultId:itemId`) fait le travail que K_item faisait par accident — isoler
 * les éléments les uns des autres —, et il le fait sans dépendre de la révision.
 *
 * CE QUI FAIT ENCORE CHANGER LA CLÉ, ET C'EST VOULU : le RESCELLEMENT du coffre
 * (E3-5). Une nouvelle époque, c'est une nouvelle K_vault, donc une nouvelle clé
 * de salle — exactement l'effet recherché quand on retire un membre. Le cache
 * ci-dessous est donc indexé par l'ÉPOQUE : une entrée d'une autre époque est
 * périmée, jamais rendue en silence.
 *
 * LA CLÉ DE SALLE NE SORT JAMAIS DE LA MÉMOIRE. Elle n'est ni persistée, ni
 * envoyée, ni exportable (`extractable: false`). Le cache module suit les
 * secrets dont il dérive : `clearRoomKeys()` doit être appelé sur les mêmes
 * chemins que `clearHybridCrypto()` et `clearVaultKeys()` (verrouillage,
 * changement de profil, déconnexion), et `clearVaultRoomKeys(vaultId)` sur ceux
 * qui verrouillent UN coffre (`lockVault`).
 */

import { exportFEKRaw } from '../auth/hybridCrypto';
import { getVaultKey } from '../vault/vaultKeyCache';
import { VAULT_ROOM_PREFIX, vaultRoomId, vaultRoomSalt } from './collabRoom';

const HKDF_INFO = 'filarr-collab-v1';
/** Étiquette du régime coffre — distincte de celle de la phase 1, par contrat. */
export const VAULT_HKDF_INFO = 'filarr-collab-vault-v1';
const ROOM_KEY_BITS = 256;

interface CachedRoomKey {
  key: CryptoKey;
  /**
   * Ce qui a PRODUIT cette clé, quand ce n'est pas la FEK : l'ÉPOQUE de K_vault.
   * Une époque différente = une K_vault différente = une clé différente, donc
   * une entrée de cache différente — jamais une clé périmée rendue en silence.
   * Vide pour le régime personnel (la FEK n'a pas de version ici).
   */
  tag: string;
}

/** Clés dérivées de la session courante, indexées par salle. Mémoire uniquement. */
const _roomKeys = new Map<string, CachedRoomKey>();

function view(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** Cœur commun aux deux régimes : seuls le sel et l'étiquette changent. */
async function deriveBits(secret: Uint8Array, salt: string, info: string): Promise<Uint8Array> {
  if (secret.byteLength === 0) throw new Error('collab: secret de dérivation vide');
  if (!salt) throw new Error('collab: sel de dérivation requis');

  const ikm = await crypto.subtle.importKey('raw', view(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: view(new TextEncoder().encode(salt)),
      info: view(new TextEncoder().encode(info)),
    },
    ikm,
    ROOM_KEY_BITS
  );
  return new Uint8Array(bits);
}

/** Importe 32 octets en AES-GCM NON EXPORTABLE, puis efface la copie brute. */
async function importRoomKey(bits: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'raw',
      view(bits),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  } finally {
    bits.fill(0);
  }
}

/**
 * Dérivation pure du régime PERSONNEL — exposée pour les tests de déterminisme.
 * Retourne les octets bruts : l'appelant est responsable de les effacer.
 */
export async function deriveRoomKeyBits(secret: Uint8Array, noteId: string): Promise<Uint8Array> {
  if (!noteId) throw new Error('collab: noteId requis comme sel de dérivation');
  return deriveBits(secret, noteId, HKDF_INFO);
}

/**
 * Dérive la clé de salle personnelle depuis un secret arbitraire et l'importe
 * en AES-GCM NON EXPORTABLE.
 */
export async function deriveRoomKey(secret: Uint8Array, noteId: string): Promise<CryptoKey> {
  return importRoomKey(await deriveRoomKeyBits(secret, noteId));
}

/**
 * Dérivation pure du régime COFFRE. `secret` est K_vault à l'époque de la
 * révision chargée — mais la fonction ne le sait pas, et c'est voulu : ce qui
 * distingue deux salles vit entièrement dans le SEL, pas dans le secret.
 */
export async function deriveVaultRoomKeyBits(
  secret: Uint8Array,
  vaultId: string,
  itemId: string
): Promise<Uint8Array> {
  if (!vaultId || !itemId) throw new Error('collab: vaultId et itemId requis comme sel');
  return deriveBits(secret, vaultRoomSalt(vaultId, itemId), VAULT_HKDF_INFO);
}

/** Clé de salle de coffre, AES-GCM NON EXPORTABLE. */
export async function deriveVaultRoomKey(
  secret: Uint8Array,
  vaultId: string,
  itemId: string
): Promise<CryptoKey> {
  return importRoomKey(await deriveVaultRoomKeyBits(secret, vaultId, itemId));
}

/**
 * Clé de salle pour cette note, dérivée de la FEK de la session.
 *
 * Retourne `null` — sans lever — quand le coffre est verrouillé : c'est un
 * état NORMAL (démarrage, auto-verrouillage), et l'appelant doit simplement
 * rester en mode hors-collaboration. Une exception ici couperait l'édition.
 */
export async function getRoomKey(noteId: string): Promise<CryptoKey | null> {
  const cached = _roomKeys.get(noteId);
  if (cached) return cached.key;

  let fek: Uint8Array | null = null;
  try {
    fek = await exportFEKRaw();
  } catch {
    return null;
  }
  if (!fek || fek.byteLength === 0) return null;

  try {
    const key = await deriveRoomKey(fek, noteId);
    _roomKeys.set(noteId, { key, tag: '' });
    return key;
  } catch {
    return null;
  } finally {
    // La copie locale de la FEK ne traîne pas — l'original vit dans hybridCrypto.
    fek.fill(0);
  }
}

export interface VaultRoomKeyInput {
  vaultId: string;
  itemId: string;
  /**
   * Époque de K_vault sous laquelle la révision CHARGÉE est scellée (pas
   * forcément l'époque courante du coffre). C'est celle dont l'appelant tient
   * forcément la clé — il vient de s'en servir pour déchiffrer le corps.
   */
  epoch: number;
}

/**
 * Clé de salle d'un élément de coffre, dérivée de K_vault.
 *
 * Le secret est celui que l'éditeur détient DÉJÀ pour lire le corps de
 * l'élément : K_vault à l'époque de la révision chargée (cache mémoire
 * `vaultKeyCache`). Aucun secret nouveau, aucune requête supplémentaire — donc
 * tout membre qui peut LIRE l'élément peut entrer dans sa salle, et personne
 * d'autre.
 *
 * La clé ne dépend PAS de la révision : elle survit à un enregistrement, qui
 * n'en change que le K_item (voir l'avertissement en tête de fichier).
 *
 * Retourne `null` — sans lever — quand le coffre est verrouillé ou que l'époque
 * n'est plus détenue (membre retiré, rescellement). C'est un état NORMAL :
 * l'appelant reste hors collaboration et l'édition locale continue.
 *
 * K_vault n'est PAS effacée ici : la copie que rend `getVaultKey` est celle du
 * cache, l'effacer verrouillerait le coffre. Seuls les octets dérivés le sont
 * (`importRoomKey`), et la clé de salle rendue n'est pas exportable.
 */
export async function getVaultRoomKey(input: VaultRoomKeyInput): Promise<CryptoKey | null> {
  let roomId: string;
  try {
    roomId = vaultRoomId(input.vaultId, input.itemId);
  } catch {
    return null;
  }

  // Une entrée d'une autre époque est PÉRIMÉE : le coffre a été rescellé, donc
  // la salle a changé de clé. On re-dérive plutôt que de rendre une clé que
  // plus personne n'utilise.
  const tag = `epoch:${input.epoch}`;
  const cached = _roomKeys.get(roomId);
  if (cached && cached.tag === tag) return cached.key;

  const kVault = getVaultKey(input.vaultId, input.epoch);
  if (!kVault) return null;

  try {
    const key = await deriveVaultRoomKey(kVault, input.vaultId, input.itemId);
    _roomKeys.set(roomId, { key, tag });
    return key;
  } catch {
    return null;
  }
}

/** Oublie la clé d'une salle (fin de session sur cette note). */
export function clearRoomKey(noteId: string): void {
  _roomKeys.delete(noteId);
}

/**
 * Oublie les clés de salle d'UN coffre — le pendant de `lockVault(vaultId)`.
 *
 * Sans elle, verrouiller un coffre laissait en mémoire de quoi déchiffrer le
 * trafic de ses salles, ce que l'en-tête de ce fichier promet exactement
 * l'inverse. Les salles personnelles ne sont pas touchées.
 */
export function clearVaultRoomKeys(vaultId: string): void {
  if (!vaultId) return;
  const prefix = `${VAULT_ROOM_PREFIX}${vaultId}:`;
  for (const roomId of Array.from(_roomKeys.keys())) {
    if (roomId.startsWith(prefix)) _roomKeys.delete(roomId);
  }
}

/**
 * Oublie TOUTES les clés de salle. À appeler partout où la FEK quitte la
 * mémoire — verrouillage, changement de profil, déconnexion.
 */
export function clearRoomKeys(): void {
  _roomKeys.clear();
}

/** Diagnostic : combien de salles ont une clé en mémoire. */
export function roomKeyCount(): number {
  return _roomKeys.size;
}
