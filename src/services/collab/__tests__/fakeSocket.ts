/**
 * Faux WebSocket + concentrateur de salle, pour les tests du fournisseur.
 * Il imite le RELAIS AVEUGLE : il recopie les octets aux autres pairs sans
 * jamais les regarder, et n'a aucune clé.
 */

import type { CollabSocketLike } from '../collabProvider';
import type { RoomTicket } from '../collabTicket';

export const FAKE_CONNECTING = 0;
export const FAKE_OPEN = 1;
export const FAKE_CLOSED = 3;

export class FakeSocket implements CollabSocketLike {
  readyState = FAKE_CONNECTING;
  binaryType = 'arraybuffer';
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  /** Tout ce que ce pair a poussé sur le réseau, en octets bruts. */
  readonly sent: Uint8Array[] = [];
  /**
   * Les trames TEXTE émises — le battement de cœur, et lui seul.
   *
   * Le vrai relais déclare le couple ping/pong au runtime
   * (`setWebSocketAutoResponse`) et ferme le canal sur tout autre texte ; le
   * faux doit donc au moins savoir les recevoir sans jeter, sans quoi le ping
   * disparaît dans le `catch` du fournisseur et le test ne voit rien.
   */
  readonly sentText: string[] = [];

  constructor(
    readonly url: string,
    private readonly hub: FakeRoom,
    /** Sous-protocoles offerts — c'est là que voyage le jeton. */
    readonly protocols: string[] = []
  ) {}

  send(data: ArrayBuffer | ArrayBufferView | string): void {
    if (this.readyState !== FAKE_OPEN) throw new Error('socket fermé');
    if (typeof data === 'string') {
      // Le texte n'est jamais diffusé aux autres pairs : le relais y répond
      // lui-même, il ne le relaie pas.
      this.sentText.push(data);
      return;
    }
    const bytes =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const copy = new Uint8Array(bytes);
    this.sent.push(copy);
    this.hub.broadcast(this, copy);
  }

  close(code?: number): void {
    if (this.readyState === FAKE_CLOSED) return;
    this.readyState = FAKE_CLOSED;
    this.onclose?.({ code: code ?? 1000 });
  }

  // ---- pilotage depuis le test ----

  open(): void {
    this.readyState = FAKE_OPEN;
    this.onopen?.({});
  }

  /** Livre des octets arbitraires à ce pair (bruit, message corrompu…). */
  deliver(data: ArrayBufferLike | ArrayBufferView | string): void {
    this.onmessage?.({ data });
  }

  /**
   * Coupure côté réseau (pas un `close()` propre du client). `code` imite le
   * refus applicatif du relais, qui termine la poignée de main AVANT de fermer.
   */
  drop(code = 1006): void {
    this.readyState = FAKE_CLOSED;
    this.onclose?.({ code });
  }

  /** Refus du relais : la poignée de main aboutit, puis la salle ferme. */
  refuse(code: number): void {
    this.open();
    this.drop(code);
  }
}

export class FakeRoom {
  readonly sockets: FakeSocket[] = [];

  create = (url: string, protocols: string[] = []): FakeSocket => {
    const socket = new FakeSocket(url, this, protocols);
    this.sockets.push(socket);
    return socket;
  };

  openAll(): void {
    for (const s of this.sockets) if (s.readyState === FAKE_CONNECTING) s.open();
  }

  broadcast(from: FakeSocket, bytes: Uint8Array): void {
    for (const s of this.sockets) {
      if (s === from) continue;
      if (s.readyState !== FAKE_OPEN) continue;
      s.onmessage?.({
        data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
    }
  }

  get last(): FakeSocket {
    return this.sockets[this.sockets.length - 1];
  }
}

/** Billet de test — même forme que celui du Worker, jeton compris. */
export function fakeTicket(token = 'jeton-de-salle'): RoomTicket {
  return {
    token,
    url: 'wss://relais.filarr.test/collab/room/profil-1/note-1',
    protocols: ['filarr.collab.v1', `filarr.token.${token}`],
    expiresAt: null,
    role: null,
  };
}

/** Billet de salle de coffre — le rôle y voyage, c'est toute la différence. */
export function fakeVaultTicket(
  role: string | null = 'member',
  token = 'jeton-de-coffre'
): RoomTicket {
  return {
    token,
    url: 'wss://relais.filarr.test/collab/vault/coffre-1/element-1',
    protocols: ['filarr.collab.v1', `filarr.token.${token}`],
    expiresAt: null,
    role,
  };
}

/**
 * Laisse les promesses WebCrypto se résoudre. Vider la file de microtâches ne
 * suffit PAS : `crypto.subtle` de Node résout depuis son pool de threads, donc
 * il faut rendre la main à la boucle d'événements. On garde une référence au
 * vrai `setTimeout` pour rester valable même sous minuteurs simulés.
 */
const realSetImmediate = globalThis.setImmediate;
const realSetTimeout = globalThis.setTimeout;

export async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => {
      realSetImmediate(resolve);
    });
  }
}

/**
 * Attend qu'une condition soit vraie. Un nombre FIXE de tours ne suffit pas :
 * `crypto.subtle` prend un temps variable selon la charge de la machine, et la
 * suite tourne en parallèle. On attend donc le fait, pas une durée.
 */
export async function waitUntil(
  predicate: () => boolean,
  message = 'condition jamais atteinte',
  timeoutMs = 4000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`waitUntil: ${message}`);
    await new Promise<void>((resolve) => {
      realSetTimeout(resolve, 1);
    });
  }
}
