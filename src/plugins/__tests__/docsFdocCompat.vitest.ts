/**
 * La garde de rétrocompat du format .fdoc — sur le BUNDLE DÉPOSÉ, pas sur les
 * sources du plugin : c'est CE code que le cœur exécute, et c'est lui qui doit
 * tenir la promesse à travers les redéploiements (deploy:local).
 *
 * LA PROMESSE, EN v3. Tout document écrit par une version antérieure se LIT —
 * un fdoc v1 (v0.1 du plugin) comme un fdoc v2 (v0.2). L'écriture produit
 * TOUJOURS la version courante, 3 : le plugin est builtin, il est livré avec
 * le cœur, tous les clients avancent ensemble et un fichier ne doit jamais
 * mentir sur ce qu'il contient. Et une version INCONNUE — 4, aujourd'hui — est
 * REFUSÉE : refuser, jamais dégrader. L'ouvrir en jetant au parsing ce qu'on
 * ne comprend pas, puis le réécrire amputé à la première sauvegarde, serait
 * une corruption polie.
 *
 * Le MESSAGE de ce refus est lui aussi un contrat : PluginEditorModal le
 * reconnaît pour afficher « document écrit par une version plus récente » au
 * lieu du bandeau de crash générique.
 */

import { describe, it, expect } from 'vitest';
// Le bundle DÉPOSÉ, à dessein — pas les sources du plugin.
import { parseFdoc, serializeFdoc, FdocFormatError } from '../external/docs/fdoc.js';

const enc = new TextEncoder();
const CONTENT = { type: 'doc', content: [{ type: 'paragraph' }] };
const enveloppe = (version: unknown, content: unknown = CONTENT) =>
  enc.encode(JSON.stringify({ format: 'fdoc', version, content }));

describe('le bundle docs déposé — compat fdoc', () => {
  it('lit un v1 littéral (tout document de la v0.1)', () => {
    expect(parseFdoc(enveloppe(1)).content).toEqual(CONTENT);
  });

  it('lit un v2 littéral (tout document de la v0.2)', () => {
    expect(parseFdoc(enveloppe(2)).content).toEqual(CONTENT);
  });

  it('écrit la v3, et la relit', () => {
    const env = parseFdoc(serializeFdoc(CONTENT));
    expect(env.version).toBe(3);
    expect(env.content).toEqual(CONTENT);
  });

  it('rend un contenu v3 EXACT — tâches, exposant et indice compris', () => {
    const riche = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'fait' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'H' },
            { type: 'text', text: '2', marks: [{ type: 'subscript' }] },
            { type: 'text', text: 'O' },
          ],
        },
      ],
    };
    expect(parseFdoc(serializeFdoc(riche)).content).toEqual(riche);
  });

  it('refuse une version 4 — FdocFormatError, jamais une dégradation', () => {
    expect(() => parseFdoc(enveloppe(4))).toThrow(FdocFormatError);
  });

  it('le message du refus est le CONTRAT que PluginEditorModal reconnaît', () => {
    // Changer ce préfixe casse le bandeau « mettez à jour » de l'hôte.
    expect(() => parseFdoc(enveloppe(4))).toThrow(/^Unsupported fdoc version/);
  });

  it('refuse aussi ce qui n’est pas un fdoc du tout', () => {
    expect(() => parseFdoc(enc.encode('{PAS DU JSON'))).toThrow(FdocFormatError);
    expect(() => parseFdoc(enc.encode(JSON.stringify({ hello: true })))).toThrow(FdocFormatError);
    expect(() => parseFdoc(enc.encode(JSON.stringify({ format: 'fdoc', version: 3 })))).toThrow(
      FdocFormatError
    );
  });
});
