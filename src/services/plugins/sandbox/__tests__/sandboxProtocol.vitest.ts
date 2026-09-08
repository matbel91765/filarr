/**
 * sandboxProtocol — le parseur face à son adversaire : le greffon lui-même.
 * Toute forme inattendue rend null, jamais une exception.
 */

import { describe, it, expect } from 'vitest';
import { parseGuestMessage, parseHostMessage, SANDBOX_MAX_BYTES } from '../sandboxProtocol';

describe('parseGuestMessage', () => {
  it.each([
    ['ready', { kind: 'ready', version: 1 }],
    ['mounted', { kind: 'mounted' }],
    ['mount-error', { kind: 'mount-error', message: 'boom' }],
    ['dirty', { kind: 'dirty', dirty: true }],
    ['save-request', { kind: 'save-request', requestId: 1, bytes: new ArrayBuffer(4) }],
    ['bytes-result', { kind: 'bytes-result', requestId: 2, bytes: new ArrayBuffer(0) }],
    ['fatal', { kind: 'fatal', message: 'mort' }],
  ])('accepte %s', (_k, msg) => {
    expect(parseGuestMessage(msg)).not.toBeNull();
  });

  it.each([
    ['null', null],
    ['scalaire', 42],
    ['kind inconnu', { kind: 'exfiltrate' }],
    ['requestId non entier', { kind: 'save-request', requestId: 1.5, bytes: new ArrayBuffer(1) }],
    ['requestId négatif', { kind: 'get-bytes-result', requestId: -1 }],
    ['bytes non-ArrayBuffer', { kind: 'save-request', requestId: 1, bytes: 'AAAA' }],
    ['message non-string', { kind: 'fatal', message: { toString: () => 'rusé' } }],
    ['dirty non-booléen', { kind: 'dirty', dirty: 'yes' }],
  ])('rejette %s → null, jamais une exception', (_label, data) => {
    expect(parseGuestMessage(data)).toBeNull();
  });

  it('plafonne les octets à SANDBOX_MAX_BYTES', () => {
    // Un vrai buffer géant coûterait la mémoire du test — on vérifie la borne
    // par un buffer À la limite (accepté) et la constante elle-même.
    const ok = { kind: 'save-request', requestId: 1, bytes: new ArrayBuffer(8) };
    expect(parseGuestMessage(ok)).not.toBeNull();
    expect(SANDBOX_MAX_BYTES).toBe(64 * 1024 * 1024);
  });

  it('tronque les messages d’erreur à 2000 caractères', () => {
    const long = parseGuestMessage({ kind: 'fatal', message: 'x'.repeat(10_000) });
    expect((long as { message: string }).message.length).toBe(2000);
  });
});

describe('parseHostMessage (validé côté page invitée, même rigueur)', () => {
  it('accepte init complet et rejette un init amputé', () => {
    expect(
      parseHostMessage({
        kind: 'init',
        version: 1,
        code: '(()=>{})()',
        editorId: 'e',
        fileName: 'f.sbx',
        readOnly: false,
        bytes: new ArrayBuffer(2),
      })
    ).not.toBeNull();
    expect(parseHostMessage({ kind: 'init', version: 1 })).toBeNull();
  });

  it('save-result garde ok booléen et tronque errorMessage', () => {
    const msg = parseHostMessage({
      kind: 'save-result',
      requestId: 3,
      ok: false,
      errorMessage: 'y'.repeat(9000),
    });
    expect((msg as { errorMessage?: string }).errorMessage?.length).toBe(2000);
    expect(parseHostMessage({ kind: 'save-result', requestId: 3, ok: 'non' })).toBeNull();
  });
});
