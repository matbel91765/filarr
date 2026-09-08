/**
 * ETW-1004 — verrou d'exhaustivité de la table de routage web.
 *
 * La source de vérité est electron/preload.ts (les trois allowlists). Ce test
 * échoue si un canal est ajouté/retiré du preload sans que la classification
 * web soit mise à jour — c'est le garde-fou qui empêche la table de dériver.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_COUNTS,
  INVOKE_CHANNELS,
  RECEIVE_CHANNELS,
  SEND_CHANNELS,
} from '../channelClassification';

const preloadSource = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'electron', 'preload.ts'),
  'utf8'
);

/**
 * Extrait les chaînes littérales d'un `const NAME = new Set([...])` du preload.
 * Les commentaires sont retirés AVANT le match : les apostrophes du français
 * (« l'écran… ») et les canaux désactivés (// 'extension:…') ne comptent pas.
 */
function extractAllowlist(name: string): Set<string> {
  const start = preloadSource.indexOf(`const ${name} = new Set([`);
  expect(start, `allowlist ${name} introuvable dans preload.ts`).toBeGreaterThan(-1);
  const end = preloadSource.indexOf(']);', start);
  const block = preloadSource
    .slice(start, end)
    .split('\n')
    // Pas d'ancre $ : sur un fichier CRLF, `.` s'arrête avant \r (terminateur
    // de ligne en JS) et `$` sans flag m exige la fin de chaîne — le motif
    // ancré ne matcherait jamais. `.*` seul suffit et s'arrête au \r.
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const channels = new Set<string>();
  for (const m of block.matchAll(/'([^']+)'/g)) {
    channels.add(m[1]);
  }
  return channels;
}

describe('classification web vs allowlists du preload (ETW-1004)', () => {
  const cases = [
    { name: 'ALLOWED_INVOKE_CHANNELS', table: INVOKE_CHANNELS, expected: EXPECTED_COUNTS.invoke },
    { name: 'ALLOWED_SEND_CHANNELS', table: SEND_CHANNELS, expected: EXPECTED_COUNTS.send },
    {
      name: 'ALLOWED_RECEIVE_CHANNELS',
      table: RECEIVE_CHANNELS,
      expected: EXPECTED_COUNTS.receive,
    },
  ] as const;

  for (const { name, table, expected } of cases) {
    it(`${name} : mêmes canaux, ni plus ni moins`, () => {
      const preload = extractAllowlist(name);
      const classified = new Set(Object.keys(table));

      const missing = [...preload].filter((c) => !classified.has(c));
      const extra = [...classified].filter((c) => !preload.has(c));

      expect(missing, `canaux du preload absents de la classification`).toEqual([]);
      expect(extra, `canaux classés qui n'existent plus dans le preload`).toEqual([]);
      expect(classified.size).toBe(expected);
    });
  }

  it('chaque canal invoke a une cible valide, et un palier sauf desktop', () => {
    for (const [channel, cls] of Object.entries(INVOKE_CHANNELS)) {
      expect(['api', 'storage', 'crypto', 'desktop'], channel).toContain(cls.target);
      if (cls.target !== 'desktop') {
        expect(cls.palier, `${channel} : palier manquant`).toMatch(/^M[1-4]$/);
      }
    }
  });
});
