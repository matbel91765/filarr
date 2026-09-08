/**
 * Le rattrapage des images des notes importées avant le 2026-08-26.
 *
 * Deux exigences, et la seconde est aussi importante que la première :
 *  1. l'image ne doit pas disparaître (c'est le défaut qu'on répare) ;
 *  2. la migration doit être REPRODUCTIBLE. Elle tourne à chaque ouverture de
 *     note : si elle produisait un document différent d'une fois sur l'autre,
 *     la synchronisation verrait une modification à chaque ouverture — et un
 *     appareil qui n'a rien fait remonterait une version, sur toutes les notes
 *     importées, à chaque lecture.
 */

import { describe, it, expect } from 'vitest';
import { migrateLegacyImageNodes, migrateLegacyImagesInContent } from '../legacyImageMigration';

const PIXEL = 'data:image/png;base64,iVBORw0KGgo=';

const docWith = (...nodes: unknown[]) => ({ type: 'doc', content: nodes });

const legacyImage = (attrs: Record<string, unknown>) => ({ type: 'image', attrs });

describe('migrateLegacyImageNodes', () => {
  it('convertit une data-URI en fileEmbed, octets compris', () => {
    const { doc, converted } = migrateLegacyImageNodes(
      docWith(legacyImage({ src: PIXEL, alt: 'schéma', width: 320 }))
    );
    expect(converted).toBe(1);
    const node = (doc as any).content[0];
    expect(node.type).toBe('fileEmbed');
    expect(node.attrs.src).toBe(PIXEL);
    expect(node.attrs.fileName).toBe('schéma');
    expect(node.attrs.fileType).toBe('image/png');
    expect(node.attrs.width).toBe(320);
  });

  it('garde une image distante en LIEN, jamais en image', () => {
    // La CSP du renderer la bloquerait, et la charger ferait fuiter
    // l'ouverture de la note vers cet hôte.
    const { doc } = migrateLegacyImageNodes(
      docWith(legacyImage({ src: 'https://exemple.test/a.png', alt: 'Logo' }))
    );
    const node = (doc as any).content[0];
    expect(node.type).toBe('paragraph');
    expect(node.content[0].text).toBe('Logo');
    expect(node.content[0].marks[0].attrs.href).toBe('https://exemple.test/a.png');
  });

  it('sans src exploitable, garde le texte alternatif s il existe', () => {
    const { doc } = migrateLegacyImageNodes(docWith(legacyImage({ src: '', alt: 'Croquis' })));
    expect((doc as any).content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Croquis' }],
    });
  });

  it('sans rien à sauver, retire le nœud plutôt que d écrire un vide', () => {
    const { doc, converted } = migrateLegacyImageNodes(
      docWith(legacyImage({ src: '', alt: '' }), { type: 'paragraph' })
    );
    expect(converted).toBe(1);
    expect((doc as any).content).toHaveLength(1);
    expect((doc as any).content[0].type).toBe('paragraph');
  });

  it('descend dans les blocs imbriqués (colonne, encadré, liste)', () => {
    const { converted } = migrateLegacyImageNodes(
      docWith({
        type: 'columns',
        content: [
          { type: 'column', content: [legacyImage({ src: PIXEL })] },
          {
            type: 'column',
            content: [{ type: 'callout', content: [legacyImage({ src: PIXEL })] }],
          },
        ],
      })
    );
    expect(converted).toBe(2);
  });

  it('EST REPRODUCTIBLE : deux passes donnent des octets identiques', () => {
    const source = docWith(legacyImage({ src: PIXEL, alt: 'a' }), legacyImage({ src: PIXEL }));
    const first = migrateLegacyImageNodes(structuredClone(source)).doc;
    const second = migrateLegacyImageNodes(structuredClone(source)).doc;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('est idempotente : repasser sur un document migré ne change rien', () => {
    const once = migrateLegacyImageNodes(docWith(legacyImage({ src: PIXEL }))).doc;
    const twice = migrateLegacyImageNodes(structuredClone(once));
    expect(twice.converted).toBe(0);
    expect(JSON.stringify(twice.doc)).toBe(JSON.stringify(once));
  });

  it('ne touche pas un document sans nœud hérité', () => {
    const source = docWith({ type: 'paragraph', content: [{ type: 'text', text: 'image' }] });
    const { doc, converted } = migrateLegacyImageNodes(source);
    expect(converted).toBe(0);
    // Même objet : rien n'a été recopié inutilement.
    expect(doc).toBe(source);
  });

  it('ne confond pas un fileEmbed déjà sain avec un nœud hérité', () => {
    const source = docWith({ type: 'fileEmbed', attrs: { src: PIXEL, fileType: 'image/png' } });
    expect(migrateLegacyImageNodes(source).converted).toBe(0);
  });
});

describe('migrateLegacyImagesInContent', () => {
  it('rend la MÊME chaîne quand il n y a rien à faire', () => {
    const content = JSON.stringify(docWith({ type: 'paragraph' }));
    expect(migrateLegacyImagesInContent(content)).toBe(content);
  });

  it('ne casse pas sur du contenu qui n est pas du JSON', () => {
    expect(migrateLegacyImagesInContent('pas du json "image"')).toBe('pas du json "image"');
  });

  it('migre un contenu sérialisé', () => {
    const migrated = migrateLegacyImagesInContent(
      JSON.stringify(docWith(legacyImage({ src: PIXEL })))
    );
    expect(migrated).toContain('fileEmbed');
    expect(migrated).not.toContain('"type":"image"');
  });
});
