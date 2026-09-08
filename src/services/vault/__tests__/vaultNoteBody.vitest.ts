/**
 * vaultNoteBody — l'enveloppe du corps de note de coffre.
 *
 * LA propriété de compatibilité : sans commentaire, les octets sérialisés sont
 * EXACTEMENT un document ProseMirror nu — lisible par un client antérieur dont
 * le parse exige type==='doc'.
 */

import { describe, it, expect } from 'vitest';
import {
  parseVaultNoteBody,
  parseVaultNoteBodyText,
  normalizeVaultNoteBodyValue,
  serializeVaultNoteBody,
  VAULT_NOTE_FORMAT,
} from '../vaultNoteBody';
import type { VaultComment } from '../vaultComments';

const DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
const COMMENT: VaultComment = {
  id: 'c1',
  parentId: null,
  text: 'un commentaire',
  authorName: 'alice@x.com',
  authorId: 'u1',
  createdAt: '2026-08-01T00:00:00.000Z',
  resolved: false,
};

describe('lecture', () => {
  it('accepte le doc nu (format historique) avec zéro commentaire', () => {
    const body = parseVaultNoteBodyText(JSON.stringify(DOC));
    expect(body).not.toBeNull();
    expect(body!.doc).toEqual(DOC);
    expect(body!.comments).toEqual({});
  });

  it('accepte l’enveloppe v1 et assainit ses commentaires', () => {
    const body = parseVaultNoteBodyText(
      JSON.stringify({
        format: VAULT_NOTE_FORMAT,
        v: 1,
        doc: DOC,
        comments: { c1: COMMENT, mauvais: { id: 42 } },
      })
    );
    expect(body!.doc).toEqual(DOC);
    expect(Object.keys(body!.comments)).toEqual(['c1']);
  });

  it('la branche OBJET (contenu déjà parsé — transclusions) passe par la même normalisation', () => {
    expect(normalizeVaultNoteBodyValue(DOC)!.doc).toEqual(DOC);
    expect(
      normalizeVaultNoteBodyValue({ format: VAULT_NOTE_FORMAT, v: 1, doc: DOC, comments: {} })!.doc
    ).toEqual(DOC);
  });

  it.each([
    ['JSON invalide', '{PAS DU JSON'],
    ['format inconnu', JSON.stringify({ format: 'autre', v: 1, doc: DOC })],
    ['version inconnue', JSON.stringify({ format: VAULT_NOTE_FORMAT, v: 9, doc: DOC })],
    ['doc absent', JSON.stringify({ format: VAULT_NOTE_FORMAT, v: 1 })],
    ['pas un doc', JSON.stringify({ hello: true })],
  ])('rejette %s', (_label, text) => {
    expect(parseVaultNoteBodyText(text)).toBeNull();
  });
});

describe('écriture', () => {
  it('SANS commentaire : les octets sont un doc NU — l’ancien client les lit', () => {
    const bytes = serializeVaultNoteBody(DOC, {});
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    // Le contrat de compatibilité : exactement ce que l'ancien parse attend.
    expect(parsed.type).toBe('doc');
    expect(parsed.format).toBeUndefined();
  });

  it('AVEC commentaires (tombstone compris) : l’enveloppe, et le round-trip est exact', () => {
    const comments = { c1: COMMENT, mort: { ...COMMENT, id: 'mort', deleted: true as const } };
    const bytes = serializeVaultNoteBody(DOC, comments);
    const back = parseVaultNoteBody(bytes);
    expect(back!.doc).toEqual(DOC);
    expect(back!.comments).toEqual(comments);
  });
});
