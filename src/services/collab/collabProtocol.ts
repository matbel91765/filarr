/**
 * Cadre binaire du canal de collaboration — la SEULE chose que le relais voit.
 *
 * Chaque trame qui entre sur le réseau est :
 *
 *   octet 0        magie 0xFC
 *   octet 1        version du protocole (0x01)
 *   octet 2        nature de la trame (CollabFrameKind)
 *   octet 3        drapeaux — 0 pour les trames chiffrées, sous-type pour
 *                  les trames de contrôle serveur→client
 *   octets 4..15   IV AES-GCM, TIRÉ AU HASARD À CHAQUE MESSAGE
 *   octets 16..    AES-256-GCM(clé de salle, IV, en-tête comme AAD)
 *
 * L'en-tête de quatre octets est en clair pour que le Durable Object puisse
 * faire son travail de relais sans clé : distinguer une trame compactable
 * (instantané) d'une trame éphémère (présence) ne demande pas de lire le
 * contenu. Il sert d'AAD, donc un relais qui retournerait le type se ferait
 * rejeter par la vérification GCM côté client.
 *
 * Le CONTRÔLE (0x00) est la seule trame non chiffrée, et elle ne va que du
 * relais vers le client : elle ne transporte aucune donnée d'utilisateur,
 * seulement l'avancement du canal (rejeu terminé, un pair est arrivé).
 */

export const COLLAB_MAGIC = 0xfc;
export const COLLAB_PROTOCOL_VERSION = 0x01;
export const COLLAB_HEADER_BYTES = 4;
export const COLLAB_IV_BYTES = 12;
export const COLLAB_TAG_BYTES = 16;

/**
 * Plafond défensif à la réception. Une note raisonnable pèse quelques dizaines
 * de kilo-octets ; 8 Mo laisse passer un instantané très gras tout en évitant
 * qu'un relais compromis fasse exploser la mémoire du client.
 */
export const COLLAB_MAX_FRAME_BYTES = 8 * 1024 * 1024;

/**
 * Plafond d'ÉMISSION, aligné sur celui du relais (MAX_FRAME_BYTES de
 * infra/cloudflare-worker/src/collab.ts) : au-delà, la salle ferme le canal.
 * Le client renonce donc à l'envoi — perdre un instantané de compaction est
 * anodin, se faire fermer en boucle sur une note chargée ne l'est pas.
 */
export const COLLAB_MAX_SEND_BYTES = 1024 * 1024;

/**
 * Le battement de cœur, en TEXTE — les deux seules trames non binaires du
 * protocole. Miroir exact de KEEPALIVE_REQUEST / KEEPALIVE_RESPONSE
 * (infra/cloudflare-worker/src/collab.ts) : la salle les a déclarées au runtime
 * via `setWebSocketAutoResponse`, si bien que le pong part sans réveiller un
 * objet hibernant — coût serveur nul. Tout AUTRE texte fait fermer le canal
 * (`binary_frames_only`), donc ces valeurs doivent rester identiques des deux
 * côtés, au caractère près.
 */
export const KEEPALIVE_REQUEST = 'ping';
export const KEEPALIVE_RESPONSE = 'pong';

export const CollabFrameKind = {
  /** Relais → client, EN CLAIR, sans charge utile chiffrée. */
  Control: 0x00,
  /** Mise à jour Yjs incrémentale. */
  Update: 0x01,
  /** Mise à jour de présence (y-protocols/awareness). */
  Awareness: 0x02,
  /** État complet du document — le relais peut oublier ce qui précède. */
  Snapshot: 0x03,
  /** Vecteur d'état : « voici ce que j'ai, envoyez-moi le reste ». */
  SyncStep1: 0x04,
  /** Différentiel calculé pour le vecteur d'état d'un pair. */
  SyncStep2: 0x05,
} as const;

// Le couple valeur + type sous le même nom est volontaire (on veut
// `CollabFrameKind.Update` ET `kind: CollabFrameKind`) ; la règle de base
// no-redeclare ne connaît pas cette forme TypeScript.
// eslint-disable-next-line no-redeclare
export type CollabFrameKind = (typeof CollabFrameKind)[keyof typeof CollabFrameKind];

/** Sous-types de la trame de contrôle, portés par l'octet de drapeaux. */
export const CollabControl = {
  /** Le relais a fini de rejouer son journal : nous sommes à jour. */
  ReplayDone: 0x01,
  /** Un pair vient d'ouvrir le canal. */
  PeerJoined: 0x02,
  /** Un pair a quitté le canal. */
  PeerLeft: 0x03,
} as const;

// eslint-disable-next-line no-redeclare
export type CollabControl = (typeof CollabControl)[keyof typeof CollabControl];

export interface CollabFrame {
  kind: CollabFrameKind;
  flags: number;
  payload: Uint8Array;
}

const KNOWN_KINDS: ReadonlySet<number> = new Set(Object.values(CollabFrameKind));

/** Vue `BufferSource` d'un Uint8Array sans recopie — les casts que WebCrypto réclame. */
function view(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

/** Normalise ce qu'un WebSocket peut livrer (ArrayBuffer, vue, Buffer Node). */
export function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return null;
}

/**
 * Lit l'en-tête sans clé. Retourne `null` sur tout ce qui n'est pas une trame
 * Filarr — une trame texte, une version future, un type inconnu.
 */
export function readFrameHeader(
  frame: Uint8Array
): { kind: CollabFrameKind; flags: number } | null {
  if (frame.byteLength < COLLAB_HEADER_BYTES) return null;
  if (frame[0] !== COLLAB_MAGIC) return null;
  if (frame[1] !== COLLAB_PROTOCOL_VERSION) return null;
  if (!KNOWN_KINDS.has(frame[2])) return null;
  return { kind: frame[2] as CollabFrameKind, flags: frame[3] };
}

/** Fabrique une trame de contrôle (utile aux tests et à un relais local). */
export function buildControlFrame(control: CollabControl): Uint8Array {
  const frame = new Uint8Array(COLLAB_HEADER_BYTES);
  frame[0] = COLLAB_MAGIC;
  frame[1] = COLLAB_PROTOCOL_VERSION;
  frame[2] = CollabFrameKind.Control;
  frame[3] = control;
  return frame;
}

/**
 * Chiffre une charge utile dans une trame prête à partir.
 * L'IV est tiré au hasard À CHAQUE APPEL — jamais de compteur, jamais de
 * réutilisation : la même clé de salle sert pendant toute la session.
 */
export async function encryptFrame(
  key: CryptoKey,
  kind: Exclude<CollabFrameKind, typeof CollabFrameKind.Control>,
  payload: Uint8Array
): Promise<Uint8Array> {
  const header = new Uint8Array(COLLAB_HEADER_BYTES);
  header[0] = COLLAB_MAGIC;
  header[1] = COLLAB_PROTOCOL_VERSION;
  header[2] = kind;
  header[3] = 0;

  const iv = crypto.getRandomValues(new Uint8Array(COLLAB_IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: view(iv), additionalData: view(header) },
    key,
    view(payload)
  );

  const frame = new Uint8Array(COLLAB_HEADER_BYTES + COLLAB_IV_BYTES + ciphertext.byteLength);
  frame.set(header, 0);
  frame.set(iv, COLLAB_HEADER_BYTES);
  frame.set(new Uint8Array(ciphertext), COLLAB_HEADER_BYTES + COLLAB_IV_BYTES);
  return frame;
}

/**
 * Déchiffre une trame reçue. Retourne `null` — JAMAIS d'exception — sur une
 * trame tronquée, d'une autre version, d'un type inconnu, ou dont le tag GCM
 * ne vérifie pas. Une session ne doit pas mourir parce qu'un octet a bougé :
 * l'appelant compte l'échec et passe au message suivant.
 */
export async function decryptFrame(key: CryptoKey, frame: Uint8Array): Promise<CollabFrame | null> {
  if (frame.byteLength > COLLAB_MAX_FRAME_BYTES) return null;
  const header = readFrameHeader(frame);
  if (!header) return null;

  if (header.kind === CollabFrameKind.Control) {
    return { kind: header.kind, flags: header.flags, payload: frame.slice(COLLAB_HEADER_BYTES) };
  }

  if (frame.byteLength < COLLAB_HEADER_BYTES + COLLAB_IV_BYTES + COLLAB_TAG_BYTES) return null;

  const iv = frame.slice(COLLAB_HEADER_BYTES, COLLAB_HEADER_BYTES + COLLAB_IV_BYTES);
  const ciphertext = frame.slice(COLLAB_HEADER_BYTES + COLLAB_IV_BYTES);
  const aad = frame.slice(0, COLLAB_HEADER_BYTES);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: view(iv), additionalData: view(aad) },
      key,
      view(ciphertext)
    );
    return { kind: header.kind, flags: header.flags, payload: new Uint8Array(plaintext) };
  } catch {
    return null;
  }
}
