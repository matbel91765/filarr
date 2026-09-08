/**
 * LES DISPOSITIONS INTÉGRÉES, CONFRONTÉES AU REGISTRE.
 *
 * ── CE QUE CE TEST ATTRAPE ──────────────────────────────────────────────────
 *
 * Sept dispositions, plus de cinquante emplacements écrits à la main, chacun
 * nommant un type de bloc et parfois des valeurs de réglage. Rien dans le
 * typage ne les vérifie : `type` et `options` sont des chaînes et un
 * `Record<string, unknown>`.
 *
 * Une faute de frappe ne lève donc RIEN. Elle produit un bloc « inconnu », que
 * `resolveWidget` rend `null` et que l'accueil affiche vide — délibérément,
 * pour qu'une disposition venue d'une version plus récente ne perde pas ses
 * blocs. Ce silence, qui est une qualité pour un fichier reçu, est un piège
 * pour un modèle qu'on écrit soi-même : on livre une disposition trouée et
 * personne ne s'en aperçoit avant qu'un utilisateur la pose.
 *
 * ── ET LES BORNES, QUI SONT L'AUTRE MOITIÉ ──────────────────────────────────
 *
 * Un emplacement plus étroit que le plancher de son bloc est corrigé par la
 * poignée au premier geste, SOUS LES YEUX de l'utilisateur : la composition
 * qu'on lui a proposée se réarrange toute seule à la seconde où il la touche.
 */

import { describe, it, expect } from 'vitest';

import { HOME_PRESETS } from '../presets/homePresets';
import { resolveWidget } from '../widgetRegistry';
import { resolveConstraints } from '../../grid/gridSolver';
import { LAYOUT_LIMITS } from '../../../../services/layouts/layoutFormat';

describe('les dispositions intégrées', () => {
  it('il y en a sept, et chacune a des blocs', () => {
    expect(HOME_PRESETS).toHaveLength(7);
    for (const preset of HOME_PRESETS) {
      expect(preset.template.slots.length, preset.id).toBeGreaterThan(0);
    }
  });

  it('LA GARDE : chaque bloc posé EXISTE dans le registre', () => {
    for (const preset of HOME_PRESETS) {
      for (const slot of preset.template.slots) {
        expect(resolveWidget(slot.type), `${preset.id} → « ${slot.type} »`).not.toBeNull();
      }
    }
  });

  it('LA SECONDE GARDE : chaque valeur de réglage est DÉCLARÉE par son bloc', () => {
    /**
     * Un réglage inconnu, ou une valeur hors des choix, retombe en silence sur
     * le repli du schéma. La disposition s'affiche donc, mais pas comme on l'a
     * écrite — et l'écart ne se voit qu'en comparant à l'œil avec l'intention.
     */
    for (const preset of HOME_PRESETS) {
      for (const slot of preset.template.slots) {
        const schema = resolveWidget(slot.type)?.optionsSchema;
        for (const [key, value] of Object.entries(slot.options ?? {})) {
          const field = schema?.find((f) => f.key === key);
          expect(
            field,
            `${preset.id} → ${slot.type}.${key} n'est pas un réglage de ce bloc`
          ).toBeDefined();
          if (field?.kind === 'enum') {
            expect(
              field.choices.some((choice) => choice.value === value),
              `${preset.id} → ${slot.type}.${key} = « ${String(value)} » hors des choix`
            ).toBe(true);
          }
          if (field?.kind === 'boolean') expect(typeof value).toBe('boolean');
          if (field?.kind === 'text') expect(typeof value).toBe('string');
        }
      }
    }
  });

  it('LA TROISIÈME GARDE : chaque emplacement tient dans les bornes de son bloc', () => {
    for (const preset of HOME_PRESETS) {
      for (const slot of preset.template.slots) {
        const bounds = resolveConstraints(resolveWidget(slot.type)?.constraints);
        const where = `${preset.id} → ${slot.type} (${slot.w}×${slot.h})`;
        expect(
          slot.w,
          `${where} : sous le plancher de largeur ${bounds.minW}`
        ).toBeGreaterThanOrEqual(bounds.minW);
        expect(
          slot.h,
          `${where} : sous le plancher de hauteur ${bounds.minH}`
        ).toBeGreaterThanOrEqual(bounds.minH);
        expect(slot.h, `${where} : au-dessus du plafond ${bounds.maxH}`).toBeLessThanOrEqual(
          bounds.maxH
        );
        expect(slot.w, where).toBeLessThanOrEqual(bounds.maxW);
      }
    }
  });

  it('aucun bloc ne déborde des douze colonnes', () => {
    for (const preset of HOME_PRESETS) {
      for (const slot of preset.template.slots) {
        expect(slot.x, `${preset.id} → ${slot.type}`).toBeGreaterThanOrEqual(0);
        expect(
          slot.x + slot.w,
          `${preset.id} → ${slot.type} déborde à droite (x=${slot.x}, w=${slot.w})`
        ).toBeLessThanOrEqual(LAYOUT_LIMITS.columns);
      }
    }
  });

  it('deux blocs ne se CHEVAUCHENT jamais', () => {
    /**
     * Le solveur de grille sait recompacter, mais il le fait à SA façon : deux
     * blocs qui se recouvrent dans le modèle donnent une page dont la
     * disposition finale n'est pas celle qu'on a dessinée, et qui varie selon
     * l'ordre des emplacements.
     */
    for (const preset of HOME_PRESETS) {
      const slots = preset.template.slots;
      for (let a = 0; a < slots.length; a += 1) {
        for (let b = a + 1; b < slots.length; b += 1) {
          const p = slots[a];
          const q = slots[b];
          const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
          expect(overlap, `${preset.id} : « ${p.type} » et « ${q.type} » se chevauchent`).toBe(
            false
          );
        }
      }
    }
  });

  it('les identifiants sont uniques', () => {
    const seen = new Set<string>();
    for (const preset of HOME_PRESETS) {
      expect(seen.has(preset.id), preset.id).toBe(false);
      seen.add(preset.id);
      expect(preset.template.id).toBe(preset.id);
    }
  });
});
