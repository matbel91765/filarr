/**
 * La garde anti-ReDoS de la recherche — les cas d'école, et la raison pour
 * laquelle l'ancienne implémentation ne les attrapait pas.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isSafePattern,
  compilePattern,
  testBounded,
  ScanBudget,
  MAX_PATTERN_LENGTH,
  MAX_SCANNED_TEXT_LENGTH,
} from '../regexGuard';

describe('isSafePattern — refus statique', () => {
  /**
   * LE cas d'école. L'ancien `isSafeRegex` du bureau le laissait passer : ses
   * cinq motifs ne couvraient que `(...)*+`, `(...)+*`, `(..+..)*`, `.*.*.*` et
   * `(.*|.*)+` — jamais `(a+)+`.
   */
  it.each([
    ['(a+)+', 'groupe quantifié re-quantifié'],
    ['(a*)*', 'idem avec une étoile'],
    ['(a+)+$', 'la forme complète du ReDoS classique'],
    ['(a|a)+', 'alternance répétée'],
    ['(a|ab)*', 'alternance ambiguë répétée'],
    ['(a{2,})+', 'quantificateur explicite re-quantifié'],
    ['(x+x+)+y', 'le motif « evil regex » de la littérature'],
    ['a++', 'quantificateurs collés'],
    ['a*+', 'possessif, absent de JS mais refusé quand même'],
    ['.*.*.*.*', '« .* » en série'],
  ])('refuse %s (%s)', (pattern) => {
    expect(isSafePattern(pattern)).toBe(false);
  });

  it.each([
    'facture',
    '^\\d{4}-\\d{2}-\\d{2}$',
    'rapport (2024|2025)',
    '[A-Z][a-z]+\\s+\\w+',
    'a.*b',
    'contrat\\.pdf',
  ])('accepte le motif honnête %s', (pattern) => {
    expect(isSafePattern(pattern)).toBe(true);
  });

  it('refuse un motif plus long que la borne', () => {
    expect(isSafePattern('a'.repeat(MAX_PATTERN_LENGTH + 1))).toBe(false);
    expect(isSafePattern('a'.repeat(MAX_PATTERN_LENGTH))).toBe(true);
  });
});

describe('compilePattern', () => {
  it('rend la raison du refus plutôt qu un booléen muet', () => {
    expect(compilePattern('(a+)+', false)).toEqual({ ok: false, reason: 'unsafe' });
    expect(compilePattern('a'.repeat(600), false)).toEqual({ ok: false, reason: 'too-long' });
    expect(compilePattern('[', false)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('compile avec le drapeau de casse demandé', () => {
    const insensible = compilePattern('abc', false);
    const sensible = compilePattern('abc', true);
    expect(insensible.ok && insensible.regex.flags).toBe('gi');
    expect(sensible.ok && sensible.regex.flags).toBe('g');
  });
});

describe('testBounded', () => {
  /**
   * LE défaut que l'ancienne implémentation masquait : avec le drapeau `g`,
   * `RegExp.test` reprend à `lastIndex`. Sans remise à zéro, un document sur
   * deux « ne correspond pas ».
   */
  it('ne dépend pas de l appel précédent (lastIndex remis à zéro)', () => {
    const compiled = compilePattern('facture', false);
    if (!compiled.ok) throw new Error('motif refusé à tort');
    const regex = compiled.regex;
    expect(testBounded(regex, 'facture 2024')).toBe(true);
    expect(testBounded(regex, 'facture 2025')).toBe(true);
    expect(testBounded(regex, 'facture 2026')).toBe(true);
  });

  it('rend faux sur un texte vide sans lever', () => {
    const compiled = compilePattern('a', false);
    if (!compiled.ok) throw new Error('motif refusé à tort');
    expect(testBounded(compiled.regex, '')).toBe(false);
  });

  it('borne le texte fouillé — au-delà de la limite, on ne regarde plus', () => {
    const compiled = compilePattern('aiguille', false);
    if (!compiled.ok) throw new Error('motif refusé à tort');
    const loin = 'x'.repeat(MAX_SCANNED_TEXT_LENGTH + 10) + 'aiguille';
    expect(testBounded(compiled.regex, loin)).toBe(false);
    const proche = 'x'.repeat(10) + 'aiguille';
    expect(testBounded(compiled.regex, proche)).toBe(true);
  });
});

describe('ScanBudget', () => {
  it('laisse passer tant que le budget tient', () => {
    let t = 1000;
    const budget = new ScanBudget(250, () => t);
    expect(budget.canContinue()).toBe(true);
    t = 1200;
    expect(budget.canContinue()).toBe(true);
    expect(budget.timedOut).toBe(false);
  });

  it('coupe et le DIT une fois le budget dépassé', () => {
    let t = 1000;
    const budget = new ScanBudget(250, () => t);
    t = 1400;
    expect(budget.canContinue()).toBe(false);
    expect(budget.timedOut).toBe(true);
    // Une fois épuisé, il le reste : pas de reprise si l'horloge recule.
    t = 1000;
    expect(budget.canContinue()).toBe(false);
  });

  it('un balayage lent s arrête au lieu de parcourir tout l index', () => {
    // Horloge qui avance de 100 ms à chaque consultation : le budget de 250 ms
    // autorise trois documents, pas deux mille.
    let t = 0;
    const now = vi.fn(() => {
      const v = t;
      t += 100;
      return v;
    });
    const budget = new ScanBudget(250, now);
    let vus = 0;
    for (let i = 0; i < 2000; i += 1) {
      if (!budget.canContinue()) break;
      vus += 1;
    }
    expect(vus).toBeLessThan(10);
    expect(budget.timedOut).toBe(true);
  });
});
