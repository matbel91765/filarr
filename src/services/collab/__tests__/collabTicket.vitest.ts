/**
 * Billet d'entrée en salle — où passe le jeton, et que faire d'une fermeture.
 *
 * Patron de panne verrouillé ici : le jeton voyageait en QUERY STRING. Les
 * query strings atterrissent dans les journaux d'infrastructure, dans le
 * `Referer` et dans l'historique du navigateur — le contrat de confidentialité
 * du relais l'interdit explicitement.
 */

import { describe, expect, it } from 'vitest';
import {
  COLLAB_CLOSE,
  COLLAB_SUBPROTOCOL,
  COLLAB_TOKEN_SUBPROTOCOL_PREFIX,
  buildRoomUrl,
  closeDisposition,
  roomSubprotocols,
  toWebSocketBase,
} from '../collabTicket';

const BASE = 'https://api.filarr.test';

describe('URL de salle — aucun secret dedans', () => {
  it('ne porte NI query string NI jeton', () => {
    const url = buildRoomUrl('profil-1', 'note-42', BASE);
    expect(url).toBe('wss://api.filarr.test/collab/room/profil-1/note-42');
    expect(url).not.toContain('?');
    expect(url).not.toContain('t=');
  });

  it('échappe les identifiants sans ouvrir de chemin', () => {
    const url = buildRoomUrl('profil/../autre', 'note 42', BASE);
    expect(url).toContain(encodeURIComponent('profil/../autre'));
    expect(url).toContain(encodeURIComponent('note 42'));
  });

  it('bascule le schéma selon la base', () => {
    expect(toWebSocketBase('https://api.filarr.test')).toBe('wss://api.filarr.test');
    expect(toWebSocketBase('http://localhost:8787')).toBe('ws://localhost:8787');
  });
});

describe('sous-protocoles — le seul canal d’authentification d’un WebSocket', () => {
  it('annonce le protocole de salle ET porte le jeton', () => {
    const protocols = roomSubprotocols('FR1.charge.signature');
    expect(protocols[0]).toBe(COLLAB_SUBPROTOCOL);
    expect(protocols[1]).toBe(`${COLLAB_TOKEN_SUBPROTOCOL_PREFIX}FR1.charge.signature`);
  });

  it('le préfixe est celui que le relais lit', () => {
    expect(COLLAB_SUBPROTOCOL).toBe('filarr.collab.v1');
    expect(COLLAB_TOKEN_SUBPROTOCOL_PREFIX).toBe('filarr.token.');
  });
});

describe('codes de fermeture — réessayer, redemander un jeton, ou renoncer', () => {
  it('redemande un jeton quand il manquait ou a expiré', () => {
    expect(closeDisposition(COLLAB_CLOSE.TOKEN_MISSING)).toBe('renew-ticket');
    expect(closeDisposition(COLLAB_CLOSE.TOKEN_EXPIRED)).toBe('renew-ticket');
  });

  it('renonce sur un refus définitif — réessayer ne changerait rien', () => {
    for (const code of [
      COLLAB_CLOSE.TOKEN_INVALID,
      COLLAB_CLOSE.ROOM_MISMATCH,
      COLLAB_CLOSE.OWNER_MISMATCH,
      COLLAB_CLOSE.PROTOCOL_ERROR,
      COLLAB_CLOSE.NOT_CONFIGURED,
    ]) {
      expect(closeDisposition(code)).toBe('give-up');
    }
  });

  it('réessaie sur tout le reste (coupure, cadence)', () => {
    for (const code of [
      COLLAB_CLOSE.FRAME_TOO_LARGE,
      COLLAB_CLOSE.FLOODING,
      1000,
      1006,
      null,
      undefined,
    ]) {
      expect(closeDisposition(code)).toBe('retry');
    }
  });

  /**
   * LA SALLE PLEINE N'EST PAS « TOUT LE RESTE ».
   *
   * Elle l'a été, et c'était un défaut : réessayer marche — mais seulement
   * quand quelqu'un sera parti, ce qui peut ne jamais arriver. Confondue avec
   * une coupure réseau, elle produisait une reconnexion perpétuelle et
   * SILENCIEUSE : la frappe en direct s'arrêtait sans que rien ne dise pourquoi,
   * ni que c'était volontaire, ni que la sortie était un coffre partagé.
   *
   * Elle a donc sa propre disposition — on continue de réessayer, mais l'écran
   * peut enfin le DIRE.
   */
  it('la salle pleine a sa propre disposition, pour pouvoir être expliquée', () => {
    expect(closeDisposition(COLLAB_CLOSE.ROOM_FULL)).toBe('room-full');
    expect(closeDisposition(COLLAB_CLOSE.ROOM_FULL)).not.toBe('retry');
    // Et ce n'est PAS un abandon : la place peut se libérer.
    expect(closeDisposition(COLLAB_CLOSE.ROOM_FULL)).not.toBe('give-up');
  });
});
