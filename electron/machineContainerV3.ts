/**
 * machineContainerV3.ts — Conteneur « clé machine » version 3 : la disposition
 * de `v2:`, la dérivation en moins.
 *
 * ── POURQUOI CE FORMAT EXISTE ────────────────────────────────────────────────
 * Le conteneur `v2:` (notes.enc, objets de notes v2, index, images, metadata.json
 * des dossiers, layout.enc…) dérive sa clé par PBKDF2-SHA-512 à 600 000 tours à
 * partir de la clé machine — un durcissement conçu pour un MOT DE PASSE, appliqué
 * à une clé qui est déjà aléatoire (32 octets). Mesuré le 05/09/2026 : 265 ms
 * par fichier. Au format « une note, un fichier », 32 notes coûtaient 8,3 s au
 * démarrage ; 500 notes, plus de deux minutes. HKDF coûte des microsecondes et
 * ne protège pas moins : l'entropie est dans la clé, pas dans les tours.
 *
 * ── LE CONTRAT (gelé le 2026-09-05, fiche
 *    `.filarr-parity/ledger/2026-09-05-conteneur-machine-v3-hkdf.md`) ─────────
 *   texte    : "v3:" + hex(sel 16 o) + hex(IV 16 o) + hex(chiffré) + hex(tag 16 o)
 *   binaire  : "v3:" || sel(16) || IV(16) || chiffré || tag(16)
 *   clé      : HKDF-SHA-256(ikm = clé machine, salt = sel, info = "filarr-container-v3", L = 32)
 *   chiffre  : AES-256-GCM, IV 16 octets, tag 16 octets, AUCUNE donnée additionnelle
 *
 * Même disposition que `v2:` à dessein : chaque lecteur (bureau, web, mobile)
 * ne change QUE la branche de dérivation. Pas d'AAD non plus : un `v2:`
 * relabellisé `v3:` dérive une autre clé et échoue au tag, et réciproquement —
 * le marqueur est déjà lié par la dérivation.
 *
 * Les vecteurs de `test-vectors/machine-container-v3.json` sont reproductibles
 * à l'octet (sel et IV fixés) : la suite exige que ce module les REPRODUISE,
 * pas seulement qu'il les déchiffre.
 *
 * ── QUI ÉCRIT ────────────────────────────────────────────────────────────────
 * La lecture de `v3:` est inconditionnelle. L'écriture est gatée par
 * `FILARR_MACHINE_CONTAINER_V3`, lu à chaque appel comme `FILARR_DELTA_V5` :
 *   · `notes`            → seuls les fichiers du coffre de notes v2 passent en v3 ;
 *   · `1` / `true` / `all` → tout ce que StorageService écrit ;
 *   · absent / autre     → `v2:`, comme avant. Défaut : ÉTEINT.
 * ── CE QUE RISQUE UN CLIENT QUI NE SAIT PAS LIRE `v3:` ──────────────────────
 *
 * CETTE MISE EN GARDE A CHANGÉ, ET DANS LE BON SENS. Elle disait qu'un ancien
 * bureau RÉINITIALISE le dossier dont il ne sait pas déchiffrer le
 * `metadata.json`. Ce n'est plus vrai : `getFolder` a cessé de réécrire un
 * dossier vide par-dessus un fichier illisible (une perte de données déclenchée
 * par une simple lecture ratée), et le laisse INTACT sur le disque.
 *
 * MAIS « PLUS DE DESTRUCTION » N'EST PAS « SANS CONSÉQUENCE », et adoucir la
 * mise en garde ferait relâcher la discipline qui la rend vraie. Un client sans
 * lecteur `v3:` voit le dossier VIDE ou absent de sa liste — ET toute écriture
 * dedans ÉCHOUE : `getFolder` marque le dossier `__unreadable`, et `saveFolder`
 * REFUSE de le persister, précisément pour ne pas réécrire du vide par-dessus le
 * contenu réel. Le dossier est donc inutilisable jusqu'au rétablissement du
 * déchiffrement, pas seulement mal affiché.
 *
 * C'est réversible, et infiniment préférable à la destruction. Ce n'est pas
 * anodin. Les deux moitiés de cette phrase doivent survivre ensemble : la
 * première seule fait répondre « jamais » à la question de savoir quand écrire
 * un format neuf ; la seconde seule fait croire que la contre-épreuve à
 * l'écriture peut sauter. (Nuance relevée par la session mobile, vérifiée dans
 * `storageService.saveFolder` le 2026-09-07.)
 *
 * Le périmètre `notes` garde donc son intérêt — s'allumer sur un poste de
 * développement sans gêner les autres clients du même profil — mais il ne
 * protège plus de la perte de données, il n'y en a plus à cette place.
 *
 * ── QUI SAIT LIRE, ET DEPUIS QUAND ──────────────────────────────────────────
 *
 * Bureau : depuis 3.1.0 (2026-09-05, ce module). Web : servi en continu, donc
 * toujours à jour. Mobile : le lecteur existe et est testé, mais l'application
 * n'est publiée nulle part — « tous les lecteurs sont expédiés » n'a pas le même
 * sens pour une surface sans canal de mise à jour, et c'est ce qui décide du
 * moment où le mobile peut se mettre à ÉCRIRE du `v3:`.
 */

import * as crypto from 'crypto';

export const MACHINE_MARKER_V1 = 'v1:';
export const MACHINE_MARKER_V2 = 'v2:';
export const MACHINE_MARKER_V3 = 'v3:';
/** Contexte HKDF — ne JAMAIS le versionner avec la disposition (voir deltaShared). */
export const MACHINE_V3_HKDF_INFO = 'filarr-container-v3';
export const MACHINE_SALT_LENGTH = 16;
export const MACHINE_IV_LENGTH = 16;
export const MACHINE_TAG_LENGTH = 16;
export const MACHINE_KEY_LENGTH = 32;
export const MACHINE_V3_FLAG = 'FILARR_MACHINE_CONTAINER_V3';
export const ERR_MACHINE_V3_MALFORMED = 'Conteneur v3 mal forme';

export type MachineContainerVersion = 'v2' | 'v3';
export type MachineWriteScope = 'notes' | 'all';

/**
 * Faut-il ÉCRIRE en `v3:` pour ce périmètre ? `notes` n'allume que le coffre de
 * notes v2 ; `1`/`true`/`all` allument tout. Lu à chaque appel : basculer ne
 * doit pas exiger de reconstruire l'application.
 */
/**
 * L'interrupteur SERVEUR (`/sync/capabilities` → `machineContainerV3Write`),
 * posé par la sonde de capacités à chaque cycle. Il vaut « all » : c'est
 * l'exploitant qui l'allume quand tous les clients lisent v3, et il s'éteint
 * seul si la sonde échoue ou change de profil. La variable d'environnement
 * reste le levier local (dev, essais) ; l'un OU l'autre suffit.
 */
let serverMachineV3Write = false;

export function setServerMachineV3Write(on: boolean): void {
  serverMachineV3Write = on;
}

export function isMachineV3WriteEnabled(scope: MachineWriteScope): boolean {
  if (serverMachineV3Write) return true;
  const raw = (process.env[MACHINE_V3_FLAG] ?? '').trim().toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'all') return true;
  if (raw === 'notes') return scope === 'notes';
  return false;
}

/** Version qu'un écrivain emploie quand l'appelant n'impose rien. */
export function machineWriteVersion(scope: MachineWriteScope = 'all'): MachineContainerVersion {
  return isMachineV3WriteEnabled(scope) ? 'v3' : 'v2';
}

/** Les trois premiers caractères d'un conteneur, texte ou octets. */
export function machineMarkerOf(head: string | Buffer): string {
  return typeof head === 'string' ? head.slice(0, 3) : head.subarray(0, 3).toString('utf8');
}

/**
 * Faut-il réécrire ce conteneur au format courant ? Règle : on ne RÉTROGRADE
 * jamais. Un `v3:` reste `v3:` même drapeau éteint (sinon chaque relecture le
 * réécrirait en `v2:`, puis la synchro renverrait le fichier, pour rien) ; un
 * `v1:` ou un sans-marqueur monte toujours au format courant.
 */
export function machineContainerNeedsRewrite(
  head: string | Buffer,
  scope: MachineWriteScope = 'all'
): boolean {
  const marker = machineMarkerOf(head);
  if (marker === MACHINE_MARKER_V3) return false;
  if (isMachineV3WriteEnabled(scope)) return true;
  return marker !== MACHINE_MARKER_V2;
}

export function deriveMachineKeyV3(machineKey: Buffer, salt: Buffer): Buffer {
  if (machineKey.length === 0) throw new Error('cle machine vide');
  if (salt.length !== MACHINE_SALT_LENGTH) {
    throw new Error(`sel de ${salt.length} octets (attendu ${MACHINE_SALT_LENGTH})`);
  }
  return Buffer.from(
    crypto.hkdfSync('sha256', machineKey, salt, MACHINE_V3_HKDF_INFO, MACHINE_KEY_LENGTH)
  );
}

export interface MachineNonce {
  salt: Buffer;
  iv: Buffer;
}

export function freshMachineNonce(): MachineNonce {
  return {
    salt: crypto.randomBytes(MACHINE_SALT_LENGTH),
    iv: crypto.randomBytes(MACHINE_IV_LENGTH),
  };
}

/** `"v3:" || sel || IV || chiffré || tag`. Le nonce n'est injectable que pour les vecteurs. */
export function sealMachineV3Bytes(
  machineKey: Buffer,
  plain: Buffer,
  nonce: MachineNonce = freshMachineNonce()
): Buffer {
  if (nonce.iv.length !== MACHINE_IV_LENGTH) {
    throw new Error(`IV de ${nonce.iv.length} octets (attendu ${MACHINE_IV_LENGTH})`);
  }
  const key = deriveMachineKeyV3(machineKey, nonce.salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce.iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from(MACHINE_MARKER_V3, 'utf8'), nonce.salt, nonce.iv, ciphertext, tag]);
}

/** `"v3:" + hex(...)` — la forme des fichiers texte (JSON). */
export function sealMachineV3Text(
  machineKey: Buffer,
  json: string,
  nonce: MachineNonce = freshMachineNonce()
): string {
  const binary = sealMachineV3Bytes(machineKey, Buffer.from(json, 'utf8'), nonce);
  return MACHINE_MARKER_V3 + binary.subarray(MACHINE_MARKER_V3.length).toString('hex');
}

/** Ouvre un conteneur binaire `v3:`. Rejette tout ce qui n'en est pas un. */
export function openMachineV3Bytes(machineKey: Buffer, container: Buffer): Buffer {
  const marker = Buffer.from(MACHINE_MARKER_V3, 'utf8');
  if (container.length < marker.length || !container.subarray(0, marker.length).equals(marker)) {
    throw new Error(ERR_MACHINE_V3_MALFORMED);
  }
  const body = container.subarray(marker.length);
  const min = MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH + MACHINE_TAG_LENGTH;
  if (body.length < min) throw new Error(ERR_MACHINE_V3_MALFORMED);
  const salt = body.subarray(0, MACHINE_SALT_LENGTH);
  const iv = body.subarray(MACHINE_SALT_LENGTH, MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH);
  const tag = body.subarray(body.length - MACHINE_TAG_LENGTH);
  const ciphertext = body.subarray(MACHINE_SALT_LENGTH + MACHINE_IV_LENGTH, body.length - MACHINE_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveMachineKeyV3(machineKey, salt), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Ouvre un conteneur texte `v3:` et rend le clair en octets (UTF-8 du JSON). */
export function openMachineV3Text(machineKey: Buffer, container: string): Buffer {
  if (!container.startsWith(MACHINE_MARKER_V3)) throw new Error(ERR_MACHINE_V3_MALFORMED);
  const hexBody = container.slice(MACHINE_MARKER_V3.length);
  if (hexBody.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hexBody)) {
    throw new Error(ERR_MACHINE_V3_MALFORMED);
  }
  return openMachineV3Bytes(
    machineKey,
    Buffer.concat([Buffer.from(MACHINE_MARKER_V3, 'utf8'), Buffer.from(hexBody, 'hex')])
  );
}
