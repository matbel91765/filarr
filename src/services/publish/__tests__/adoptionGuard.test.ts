/**
 * La garde d'adoption — et la porte qu'elle ouvre.
 *
 * Chaque test verrouille un comportement NOMMÉ, pas une implémentation : ce
 * sont les seules règles qui empêchent qu'un appairage rende illisible le
 * travail de plusieurs semaines d'un utilisateur.
 */

import { constantTimeEquals, decideFekAdoption } from '../../../../electron/publish/adoptionGuard';
import { describe, it, expect } from 'vitest';

const KEY_A = new Uint8Array(32).fill(0xa1);
const KEY_B = new Uint8Array(32).fill(0xb2);

describe('decideFekAdoption', () => {
  it('A1 — clé locale lisible + contenu + clé différente ⇒ publish (le cul-de-sac est fermé)', () => {
    expect(
      decideFekAdoption({
        localKey: { raw: KEY_A },
        incomingKey: KEY_B,
        localContentCount: 1247,
      })
    ).toEqual({ kind: 'publish', reason: 'content-under-other-key' });
  });

  it('A2 — clé locale ILLISIBLE + contenu ⇒ refus : on ne migre pas ce qu on ne peut pas lire', () => {
    expect(
      decideFekAdoption({
        localKey: 'unreadable',
        incomingKey: KEY_B,
        localContentCount: 12,
      })
    ).toEqual({ kind: 'refuse', reason: 'unverifiable-local-key' });
  });

  it('A3 — pas de clé locale ⇒ adoption, AVANT tout autre test (amorçage neuf fluide)', () => {
    expect(
      decideFekAdoption({ localKey: 'absent', incomingKey: KEY_B, localContentCount: 999 })
    ).toEqual({ kind: 'adopt', reason: 'no-local-key' });
  });

  it('A4 — coffre vide ⇒ adoption : une migration sur zéro élément serait une cérémonie creuse', () => {
    expect(
      decideFekAdoption({ localKey: { raw: KEY_A }, incomingKey: KEY_B, localContentCount: 0 })
    ).toEqual({ kind: 'adopt', reason: 'empty-vault' });
  });

  it('A5 — clés identiques ⇒ adoption, JAMAIS publish (un ré-appairage ne migre rien)', () => {
    expect(
      decideFekAdoption({
        localKey: { raw: new Uint8Array(KEY_A) },
        incomingKey: new Uint8Array(KEY_A),
        localContentCount: 500,
      })
    ).toEqual({ kind: 'adopt', reason: 'same-key' });
  });
});

describe('constantTimeEquals', () => {
  it('A6 — compare sans court-circuit, y compris sur des longueurs différentes', () => {
    expect(constantTimeEquals(KEY_A, new Uint8Array(KEY_A))).toBe(true);
    expect(constantTimeEquals(KEY_A, KEY_B)).toBe(false);
    // Longueurs différentes : la différence entre dans l'accumulateur, elle ne
    // provoque pas un retour anticipé qui ferait de la garde un oracle.
    expect(constantTimeEquals(KEY_A, new Uint8Array(16).fill(0xa1))).toBe(false);
    expect(constantTimeEquals(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('A6 — un préfixe commun ne suffit pas', () => {
    const almost = new Uint8Array(32).fill(0xa1);
    almost[31] = 0x00;
    expect(constantTimeEquals(KEY_A, almost)).toBe(false);
  });
});
