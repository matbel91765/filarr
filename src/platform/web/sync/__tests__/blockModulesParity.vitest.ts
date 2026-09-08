/**
 * PARITÉ DES MODULES DE BLOCS — bureau ↔ web.
 *
 * `blockFormat.ts`, `blockCodec.ts` et `portableBlockCrypto.ts` sont des COPIES
 * verbatim de leurs jumeaux `electron/sync/*` : les deux programmes de
 * compilation ne peuvent pas partager un module (CRA refuse tout import hors de
 * `src/`). Une copie n'est sûre que tant qu'elle est prouvée identique — ici à
 * l'octet, fins de ligne mises à part. Si ce test tombe, on recopie depuis le
 * bureau ; on ne « corrige » jamais la copie web seule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const norm = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('copies web des modules de blocs delta', () => {
  for (const nom of ['blockFormat.ts', 'blockCodec.ts', 'portableBlockCrypto.ts']) {
    it(`${nom} est identique à electron/sync/${nom}`, () => {
      const web = norm(join(ROOT, 'src', 'platform', 'web', 'sync', nom));
      const bureau = norm(join(ROOT, 'electron', 'sync', nom));
      expect(web).toBe(bureau);
    });
  }
});
