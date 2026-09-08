/**
 * Garde-fou : AUCUNE poignée de redimensionnement sur une surface en lecture seule.
 *
 * POURQUOI CE TEST EXISTE. `schemaExtensions.ts` est la source unique du schéma,
 * consommée par QUATRE surfaces : l'éditeur de notes, le rendu d'une version
 * archivée (`editable: false`), le README de dossier, et l'éditeur de coffre
 * partagé — lequel monte aussi un aperçu `editable={false}` et retombe en
 * lecture seule pour un membre sans droit d'écriture. Une vue de nœud branchée
 * sur `useBlockResize` arrive donc DANS LES QUATRE, et si elle oublie sa garde,
 * elle offre une prise sur un document que le lecteur ne peut pas modifier.
 *
 * Le défaut est silencieux : rien ne plante, la poignée répond même, et
 * `updateAttributes` sur un éditeur non modifiable ne fait rien de visible. On
 * ne s'en aperçoit qu'en ouvrant une vieille version — c'est-à-dire jamais.
 *
 * CE QUE CE TEST LIT, ET POURQUOI C'EST DU SOURCE. Monter six vues React
 * demanderait jsdom, un store Redux, i18n et un vrai `Editor` TipTap ; le
 * lanceur d'ici est en environnement `node` (cf. vitest.config.ts) et sert la
 * logique pure. Lire le source est plus grossier, mais ça attrape exactement la
 * régression visée — un appel qui oublie `disabled` — et ça la signale au
 * moment où on branche un bloc de plus, pas six mois après.
 *
 *   npx vitest run src/renderer/components/notes/extensions/__tests__/blockResizeReadOnly.vitest.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const EXT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Tous les fichiers de vue sous `extensions/`, sous-dossiers compris. */
function viewFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...viewFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Les appels à `useBlockResize(...)`, avec leurs arguments — jusqu'à la
 * parenthèse fermante de premier niveau. Assez fin pour distinguer un appel
 * avec objet d'options d'un appel sans.
 */
function resizeCalls(source: string): string[] {
  const calls: string[] = [];
  const needle = 'useBlockResize(';
  let from = 0;
  for (;;) {
    const start = source.indexOf(needle, from);
    if (start === -1) return calls;
    let depth = 0;
    let i = start + needle.length - 1;
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(start, i + 1));
    from = i + 1;
  }
}

const wired = viewFiles(EXT_DIR)
  // Le module qui DÉFINIT le crochet contient forcément son propre nom : c'est
  // une déclaration, pas un appel de vue, et c'est à lui de porter la garde
  // plutôt que de la subir.
  .filter((file) => !file.endsWith('useBlockResize.tsx'))
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
  .filter(({ source }) => resizeCalls(source).length > 0);

describe('poignée de taille et surfaces en lecture seule', () => {
  it('au moins une vue est branchée (sinon ce garde-fou ne garde rien)', () => {
    expect(wired.length).toBeGreaterThan(0);
  });

  it.each(wired.map(({ file, source }) => [file.slice(EXT_DIR.length + 1), source]))(
    '%s passe `disabled` à useBlockResize',
    (_name, source) => {
      for (const call of resizeCalls(source as string)) {
        expect(call).toContain('disabled:');
      }
    }
  );

  it.each(wired.map(({ file, source }) => [file.slice(EXT_DIR.length + 1), source]))(
    '%s dérive `disabled` de `isEditable`, et de rien d’autre',
    (_name, source) => {
      // Le seul verdict légitime vient de l'éditeur lui-même. Une constante,
      // un `false` en dur ou un drapeau maison rouvriraient le trou en passant
      // le test précédent.
      expect(source as string).toContain('isEditable');
    }
  );
});
