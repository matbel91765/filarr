/**
 * LE GARDE-FOU DE LA QUATRIÈME DUPLICATION.
 *
 * Trois copies délibérées vivent déjà dans ce dépôt (`layoutMergeCore` ↔
 * `layoutTypes`, `notesMergeCore` ↔ `notesMerge`, l'amorçage de la mise en page
 * bureau ↔ web). Elles tiennent par la discipline, et la discipline tient tant
 * que quelqu'un se souvient de la règle.
 *
 * Celle-ci ne demande à personne de s'en souvenir : le noyau porté dans le
 * worker est GÉNÉRÉ depuis `src/services/layouts/`, et ce test refait le calcul.
 *
 * ── CE QU'IL EMPÊCHE, CONCRÈTEMENT ──────────────────────────────────────────
 *
 * Deux validateurs qui s'écartent d'un seul plafond, c'est un fichier ACCEPTÉ à
 * la publication et REFUSÉ à l'installation. L'auteur voit son modèle en ligne,
 * personne ne peut le poser, et rien dans l'interface ne dit pourquoi — le
 * serveur a dit oui, le client dit non, et les deux ont raison chez eux.
 *
 * ── POURQUOI UNE COMPARAISON D'OCTETS, ET PAS UNE PARITÉ D'API ──────────────
 *
 * Comparer les unions de codes d'erreur, ou les noms exportés, ne garderait
 * rien : les deux dérivent d'une même intention et resteraient d'accord sur les
 * NOMS pendant que les BORNES divergent. C'est la leçon consignée sur les tests
 * de garde — une parité entre deux dérivés ne prouve pas la conformité à
 * l'autorité. Ici l'autorité est la source, et on la compare telle quelle.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'node:module';

/**
 * Le script de portage est l'AUTORITÉ : le test appelle exactement la fonction
 * qui écrit les fichiers. Réimplémenter la réécriture ici ferait un cinquième
 * exemplaire de la même règle, et c'est précisément ce qu'on combat.
 *
 * ⚠ CHARGÉ PAR `createRequire`, ET LE NOM LOCAL N'EST PAS `require`. Ce fichier
 * de test est un module ESM ; le `require` global y est interdit par la règle
 * `no-require-imports`, et un `import` statique d'un `.cjs` hors de `src/`
 * sortirait de la racine du tsconfig. `createRequire` est le pont prévu pour
 * ça — reste à ne pas rebaptiser le résultat `require`, sinon la règle le
 * reconnaît quand même.
 */
const load = createRequire(import.meta.url);
const port = load('../../../../scripts/layout-core-port.cjs') as {
  PORTS: { source: string; target: string }[];
  SENTINEL: string;
  portedContent: (sourceText: string, sourceName: string) => string;
  SRC_DIR: string;
  OUT_DIR: string;
};

const read = (p: string): string => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

describe('noyau de mise en page porté dans le worker', () => {
  it('les trois modules attendus sont portés, et eux seuls', () => {
    expect(port.PORTS.map((p) => p.source)).toEqual([
      'layoutFormat.ts',
      'layoutValidator.ts',
      'layoutMarketTypes.ts',
    ]);
  });

  it.each(port.PORTS)('$target est la copie conforme de $source', ({ source, target }) => {
    const sourceText = read(path.join(port.SRC_DIR, source));
    const ported = read(path.join(port.OUT_DIR, target));

    // Le message compte autant que l'échec : sans lui, on lit « deux longues
    // chaînes diffèrent » et on cherche pendant dix minutes.
    expect(
      ported,
      `${target} a dérivé de sa source. NE LE CORRIGEZ PAS À LA MAIN : ` +
        `modifiez src/services/layouts/${source}, puis lancez ` +
        `\`node scripts/layout-core-port.cjs\`.`
    ).toBe(port.portedContent(sourceText, source));
  });

  it('chaque fichier porté annonce qu’il est généré, avant sa première ligne de code', () => {
    for (const { target } of port.PORTS) {
      const ported = read(path.join(port.OUT_DIR, target));
      expect(ported).toContain('FICHIER GÉNÉRÉ');
      expect(ported).toContain(port.SENTINEL);
      // L'avertissement est AVANT le code, pas en pied de fichier : personne ne
      // lit un pied de fichier avant d'éditer.
      expect(ported.indexOf(port.SENTINEL)).toBeLessThan(ported.indexOf('export'));
    }
  });

  it('le worker n’importe RIEN de `src/` — c’est toute la raison du portage', () => {
    for (const { target } of port.PORTS) {
      const ported = read(path.join(port.OUT_DIR, target));
      const imports = ported.match(/from '[^']+'/g) ?? [];
      for (const spec of imports) {
        expect(spec, `${target} : ${spec}`).not.toContain('../');
        expect(spec, `${target} : ${spec}`).not.toContain('src/');
      }
    }
  });

  it('la crypto de signature n’est PAS portée — le worker ne signe jamais', () => {
    // Il vérifie, avec sa propre implémentation Ed25519 et la clé DU COMPTE
    // appelant. Porter `layoutMarketSigning` y ferait entrer `userKeypair`,
    // c'est-à-dire une clé privée d'appareil dans un processus serveur.
    expect(port.PORTS.map((p) => p.source)).not.toContain('layoutMarketSigning.ts');
    expect(fs.existsSync(path.join(port.OUT_DIR, 'layoutMarketSigningCore.ts'))).toBe(false);
  });
});
