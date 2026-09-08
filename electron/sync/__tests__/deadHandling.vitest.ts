/**
 * deadHandling.vitest.ts — Un gestionnaire sans declencheur est du code mort.
 *
 * ── D'OU VIENT CETTE SUITE ───────────────────────────────────────────────────
 * `DeltaUnavailableError` etait attrapee a DEUX endroits de `syncService`, avec
 * un repli complet derriere, et elle n'etait PRODUITE nulle part. Le repli ne
 * s'est donc jamais declenche depuis mars 2026, et le site qui aurait du la
 * lever levait une erreur de corruption a la place — annoncant une donnee
 * endommagee la ou il n'y avait qu'un index absent.
 *
 * C'est la troisieme occurrence du meme motif dans ce chantier, et la session
 * mobile en a rencontre deux autres de son cote (un lecteur d'URL de widget qui
 * affichait « Unmatched Route », un cadre de barre d'outils reste non monte).
 * La lecon n'est pas « faire attention » : c'est qu'une suite de module PUR
 * prouve la logique et jamais le cablage, et que seul le second manque.
 *
 * ── POURQUOI PAS « CETTE ERREUR EST LEVEE QUELQUE PART » ─────────────────────
 * C'etait la formulation naturelle, et elle produit des FAUX POSITIFS. Verifie :
 * `DirectUploadUnavailableError` et `ByosSyncError` ne sont jamais `throw new`
 * — elles sont RENDUES par une fabrique (`classifyError`) puis levees par
 * l'appelant. Une garde qui les signalerait serait bruyante, et une garde
 * bruyante finit desactivee. Elle serait alors pire que pas de garde.
 *
 * La formulation retenue est plus etroite et ne ment pas : **toute erreur
 * ATTRAPEE quelque part doit etre PRODUITE quelque part.** Elle couvre
 * exactement la classe de defaut — du traitement sans declencheur — et laisse
 * tranquilles les fabriques, puisqu'elles produisent bien l'objet.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codeOnly } from './sourceScan';

const SYNC_DIR = join(__dirname, '..');

/** Sources de production du dossier synchro — jamais les suites. */
function productionSources(): Array<{ name: string; code: string }> {
  return readdirSync(SYNC_DIR)
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => !f.includes('.vitest.') && !f.includes('.test.'))
    .map((f) => ({ name: f, code: codeOnly(readFileSync(join(SYNC_DIR, f), 'utf8')) }));
}

const SOURCES = productionSources();
const ALL = SOURCES.map((s) => s.code).join('\n');

/**
 * Noms d'erreurs attrapees, avec ou sans prefixe d'espace de noms.
 *
 * `err instanceof DeltaUnavailableError` comme
 * `err instanceof deltaSync.DeltaUnavailableError` : le second est la forme
 * reelle dans `syncService`, et l'oublier ferait rater precisement le bogue
 * qui a motive cette suite.
 */
function caughtErrorNames(source: string): Set<string> {
  const out = new Set<string>();
  const re = /instanceof\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?([A-Z][\w$]*Error)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return out;
}

/** Une erreur est PRODUITE si un `new X(` existe quelque part. */
function isProduced(name: string): boolean {
  return new RegExp(`new\\s+${name}\\s*\\(`).test(ALL);
}

/** Erreurs natives : produites par le moteur, jamais par nous. */
const NATIVES = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError',
  'EvalError', 'URIError', 'AggregateError', 'DOMException',
]);

describe('toute erreur attrapee doit etre produite quelque part', () => {
  const attrapees = [...caughtErrorNames(ALL)].filter((n) => !NATIVES.has(n)).sort();

  it('la suite examine bien quelque chose', () => {
    // Une garde qui n'inspecte rien passe toujours. On exige qu'elle ait
    // trouve des cas a examiner, sinon c'est le motif de recherche qui est
    // casse et personne ne le saurait.
    expect(SOURCES.length).toBeGreaterThan(15);
    expect(attrapees.length).toBeGreaterThan(3);
  });

  it('elle voit les erreurs attrapees SOUS PREFIXE', () => {
    // `syncService` ecrit `err instanceof deltaSync.DeltaUnavailableError`.
    // Sans la prise en charge du prefixe, la garde raterait exactement le
    // bogue qui l'a motivee.
    expect(caughtErrorNames('if (e instanceof deltaSync.FooError) {}')).toContain('FooError');
    expect(caughtErrorNames('if (e instanceof BarError) {}')).toContain('BarError');
  });

  for (const nom of [...new Set(attrapees)]) {
    it(`${nom} est produite quelque part`, () => {
      // Si celui-ci tombe : du code attrape une erreur que RIEN ne produit.
      // Le gestionnaire derriere ne s'executera jamais, et le site qui aurait
      // du lever leve probablement autre chose — c'est exactement ce qui est
      // arrive a `DeltaUnavailableError`, dont le repli dormait depuis mars.
      expect(isProduced(nom)).toBe(true);
    });
  }
});

describe('le cas qui a motive cette suite', () => {
  it('DeltaUnavailableError est attrapee ET levee', () => {
    const attrapees = caughtErrorNames(ALL);
    expect(attrapees.has('DeltaUnavailableError')).toBe(true);
    expect(ALL).toMatch(/throw new DeltaUnavailableError\s*\(/);
  });

  it('une fabrique compte comme une production', () => {
    // `DirectUploadUnavailableError` et `ByosSyncError` sont RENDUES par
    // `classifyError` puis levees par l'appelant. Les signaler serait un faux
    // positif, et une garde bruyante finit desactivee.
    expect(isProduced('DirectUploadUnavailableError')).toBe(true);
    expect(isProduced('ByosSyncError')).toBe(true);
    expect(ALL).not.toMatch(/throw new DirectUploadUnavailableError\s*\(/);
  });
});

describe('deux classes du meme nom sont deux IDENTITES differentes', () => {
  /**
   * LE DEFAUT QUE LA SUITE PRECEDENTE NE POUVAIT PAS VOIR, et que j ai
   * moi-meme introduit en extrayant `deltaShared.ts`.
   *
   * `DeltaBlockMissingError` etait declaree DEUX fois : dans `deltaShared` et
   * dans `deltaSync`. `deltaSyncV5` levait la premiere pendant que
   * `syncService` testait `err instanceof deltaSync.DeltaBlockMissingError` —
   * la seconde. Le test etait donc toujours FAUX, et le repli sur un objet
   * herite ne se serait jamais declenche pour un fichier v5.
   *
   * Latent tant que l ecriture v5 est eteinte, prêt a mordre le jour ou on
   * l allume. Exactement le genre de defaut qu une bascule revele, et le pire
   * moment pour le decouvrir.
   *
   * La garde « attrapee donc produite » ne pouvait rien voir : elle compare des
   * NOMS, et les deux classes en partageaient un. Une reexportation, elle,
   * preserve l identite — c est la seule facon correcte de partager une classe
   * entre deux modules.
   */
  function declaredClasses(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const { name, code } of SOURCES) {
      const re = /(?:export\s+)?class\s+([A-Z][\w$]*)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code)) !== null) {
        const liste = out.get(m[1]) ?? [];
        liste.push(name);
        out.set(m[1], liste);
      }
    }
    return out;
  }

  it('aucune classe n est DECLAREE dans deux fichiers a la fois', () => {
    const doublons = [...declaredClasses().entries()].filter(([, f]) => f.length > 1);
    // Message explicite : si ca tombe, il faut savoir QUOI est duplique sans
    // aller le chercher a la main.
    expect(
      doublons.map(([n, f]) => `${n} declaree dans ${f.join(' et ')}`),
      'une classe declaree deux fois casse tout `instanceof` entre les deux'
    ).toEqual([]);
  });

  it('DeltaBlockMissingError a UNE seule declaration, et deltaSync la reexporte', () => {
    const d = declaredClasses().get('DeltaBlockMissingError') ?? [];
    expect(d).toEqual(['deltaShared.ts']);
    const deltaSync = SOURCES.find((s) => s.name === 'deltaSync.ts')!.code;
    expect(deltaSync).toContain('DeltaBlockMissingError');
  });

  it('la detection reconnait une classe non exportee', () => {
    // Une classe interne dupliquee casse `instanceof` exactement pareil : ne
    // chercher que les exportees laisserait passer la moitie des cas.
    const m = /(?:export\s+)?class\s+([A-Z][\w$]*)\b/.exec('class InterneError extends Error {}');
    expect(m?.[1]).toBe('InterneError');
  });
});
