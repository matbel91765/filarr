/**
 * dragMime — l'intention d'un glisser, lue d'après ses types.
 *
 *   npx vitest run src/hooks/__tests__/dragMime.vitest.ts
 */

import { describe, expect, it } from 'vitest';

import {
  FILARR_FILE_MIME,
  FILARR_WIDGET_MIME,
  NATIVE_FILES_TYPE,
  classifyDragTypes,
} from '../dragMime';

describe('classifyDragTypes', () => {
  it('reconnaît un bloc de la palette malgré son text/plain de validité', () => {
    expect(classifyDragTypes(['text/plain', FILARR_WIDGET_MIME])).toBe('widget');
    expect(classifyDragTypes([FILARR_WIDGET_MIME])).toBe('widget');
  });

  it('reconnaît un déplacement interne de fichier ou de dossier', () => {
    expect(classifyDragTypes([FILARR_FILE_MIME, 'text/plain'])).toBe('internal');
  });

  it('ne voit un import que si le système annonce des fichiers', () => {
    expect(classifyDragTypes([NATIVE_FILES_TYPE])).toBe('files');
    expect(classifyDragTypes(['text/plain'])).toBe('none');
    expect(classifyDragTypes([])).toBe('none');
  });

  it('le bloc prime sur tout marqueur concurrent', () => {
    expect(classifyDragTypes([NATIVE_FILES_TYPE, FILARR_WIDGET_MIME])).toBe('widget');
    expect(classifyDragTypes([FILARR_FILE_MIME, FILARR_WIDGET_MIME])).toBe('widget');
  });

  it('accepte une DOMStringList (ce que `dataTransfer.types` est en pratique)', () => {
    const list = {
      length: 1,
      item: (i: number) => (i === 0 ? FILARR_WIDGET_MIME : null),
      contains: (s: string) => s === FILARR_WIDGET_MIME,
      [Symbol.iterator]: function* () {
        yield FILARR_WIDGET_MIME;
      },
    } as unknown as DOMStringList;
    expect(classifyDragTypes(list)).toBe('widget');
  });
});
