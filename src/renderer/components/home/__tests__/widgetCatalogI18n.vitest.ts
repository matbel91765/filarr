/**
 * CHAQUE BLOC ET CHAQUE RÉGLAGE DOIT AVOIR SON LIBELLÉ, DANS LES DEUX LANGUES.
 *
 * ── POURQUOI CE TEST, ALORS QUE `i18n:check` EXISTE DÉJÀ ────────────────────
 *
 * `npm run i18n:check` compare EN et FR l'un à l'autre. Il garantit qu'aucune
 * clé n'existe d'un seul côté — et il est parfaitement content d'un catalogue
 * dont trente clés manquent des DEUX côtés à la fois.
 *
 * C'est exactement ce qui arrive quand on ajoute vingt blocs et vingt
 * variantes : le registre déclare `home.widgets.opt.heroTintEmber`, personne ne
 * l'écrit nulle part, et l'écran affiche « home.widgets.opt.heroTintEmber » en
 * toutes lettres dans le menu du bloc. i18next ne lève pas — il rend la clé.
 *
 * On confronte donc le registre, qui est L'AUTORITÉ sur ce qui existe, aux deux
 * fichiers de traduction. Une parité entre deux dérivés ne garde rien ; c'est à
 * la source qu'il faut se mesurer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listWidgets } from '../widgetRegistry';

// ==================== Les fichiers de traduction ====================

function loadLocale(language: string): Record<string, unknown> {
  const file = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'i18n',
    'locales',
    language,
    'translation.json'
  );
  return JSON.parse(readFileSync(file, 'utf-8'));
}

const LOCALES = { fr: loadLocale('fr'), en: loadLocale('en') };

/**
 * La valeur d'une clé pointée, ou `undefined`.
 *
 * ⚠ Une clé de PLURIEL n'existe pas telle quelle : i18next range
 * `linkCount_one` et `linkCount_other`, et `linkCount` n'est écrit nulle part.
 * On accepte donc l'une OU l'autre forme — sans quoi ce test refuserait des
 * traductions parfaitement correctes.
 */
function resolve(doc: Record<string, unknown>, key: string): unknown {
  const direct = key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, doc);
  if (direct !== undefined) return direct;

  const cut = key.lastIndexOf('.');
  if (cut < 0) return undefined;
  const parent = key
    .slice(0, cut)
    .split('.')
    .reduce<unknown>((node, part) => {
      if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
      return undefined;
    }, doc);
  if (!parent || typeof parent !== 'object') return undefined;
  const leaf = key.slice(cut + 1);
  const forms = parent as Record<string, unknown>;
  return forms[`${leaf}_one`] ?? forms[`${leaf}_other`];
}

/** Toutes les clés que le CATALOGUE déclare. */
function declaredKeys(): string[] {
  const keys = new Set<string>();
  for (const widget of listWidgets()) {
    keys.add(widget.titleKey);
    for (const field of widget.optionsSchema ?? []) {
      keys.add(field.labelKey);
      if (field.kind === 'enum') {
        for (const choice of field.choices) keys.add(choice.labelKey);
      }
      if (field.kind === 'text' && field.placeholderKey) keys.add(field.placeholderKey);
    }
  }
  return [...keys].sort();
}

// ==================== Les gardes ====================

describe('le catalogue de blocs, confronté aux traductions', () => {
  it('déclare bien plus de blocs qu’avant — le balayage a lieu', () => {
    // Une boucle vide passerait sans rien dire. Vingt-six blocs existaient
    // avant l'ajout ; ce plancher tombe si le registre cesse d'être lu.
    expect(listWidgets().length).toBeGreaterThanOrEqual(46);
  });

  for (const language of ['fr', 'en'] as const) {
    it(`LA GARDE : chaque clé déclarée existe en ${language}`, () => {
      const missing = declaredKeys().filter((key) => {
        const value = resolve(LOCALES[language], key);
        // Une chaîne VIDE compte comme absente : elle rend un libellé
        // invisible, ce qui est pire qu'une clé manquante — on ne voit même
        // pas qu'il manque quelque chose.
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(missing, `clés sans libellé en ${language}`).toEqual([]);
    });
  }

  it('LA SECONDE GARDE : les clés écrites EN DUR dans les composants existent aussi', () => {
    /**
     * Le registre ne déclare que les titres et les réglages. Tout le reste —
     * « Aucune note pour l'instant », « Une autre », « Clé en retard » — est
     * écrit directement dans le JSX, hors de portée du test précédent.
     *
     * On lit donc les fichiers de composants et on en extrait les littéraux
     * `home.blocks.…`. C'est grossier, et c'est exactement ce qu'il faut : la
     * seule alternative serait de recopier la liste ici, c'est-à-dire de créer
     * le second dérivé qui finit toujours par diverger du premier.
     */
    const dir = path.join(__dirname, '..', 'widgets');
    const sources = [
      'structureWidgets.tsx',
      'noteWidgets.tsx',
      'libraryWidgets.tsx',
      'pulseWidgets.tsx',
    ];

    const used = new Set<string>();
    for (const file of sources) {
      const code = readFileSync(path.join(dir, file), 'utf-8');
      for (const match of code.matchAll(/['"`](home\.blocks\.[a-zA-Z0-9_.]+)['"`]/g)) {
        used.add(match[1]);
      }
      // Les clés assemblées — `home.blocks.sync.${tone}` — ne se lisent pas
      // comme des littéraux. On les rend explicites plutôt que de faire semblant
      // que l'extraction les attrape.
      if (code.includes('home.blocks.sync.')) {
        for (const tone of ['ok', 'warn', 'danger']) used.add(`home.blocks.sync.${tone}`);
      }
    }

    // Le balayage doit avoir trouvé quelque chose : un chemin de fichier faux
    // rendrait un ensemble vide, et ce test passerait en ne vérifiant rien.
    expect(used.size).toBeGreaterThan(20);

    for (const language of ['fr', 'en'] as const) {
      const missing = [...used]
        .filter((key) => {
          const value = resolve(LOCALES[language], key);
          return typeof value !== 'string' || value.trim() === '';
        })
        .sort();
      expect(missing, `clés en dur sans libellé en ${language}`).toEqual([]);
    }
  });

  it('aucun bloc ne partage son identifiant, et `id` vaut `type`', () => {
    // Le registre lève déjà au chargement sur ces deux points. Ce test existe
    // pour que l'échec se lise comme une assertion et non comme un module qui
    // refuse de s'importer — un `throw` au chargement fait tomber toute la
    // suite d'un coup, sans dire lequel des quarante-six blocs est fautif.
    const seen = new Set<string>();
    for (const widget of listWidgets()) {
      expect(widget.id, 'id et type doivent être identiques').toBe(widget.type);
      expect(seen.has(widget.id), `identifiant dupliqué : ${widget.id}`).toBe(false);
      seen.add(widget.id);
    }
  });

  it('aucun choix de réglage n’est déclaré deux fois dans le même champ', () => {
    // Deux choix de même valeur donnent deux boutons radio qui s'allument
    // ensemble : le second est inatteignable, et rien ne le signale.
    for (const widget of listWidgets()) {
      for (const field of widget.optionsSchema ?? []) {
        if (field.kind !== 'enum') continue;
        const values = field.choices.map((choice) => choice.value);
        expect(new Set(values).size, `${widget.id}.${field.key}`).toBe(values.length);
      }
    }
  });

  it('le repli de chaque réglage à choix EST l’un des choix', () => {
    // ⚠ Un repli hors liste est le pire des défauts silencieux :
    // `readEnumOption` rend une valeur que le composant ne sait pas rendre, et
    // le bloc s'affiche dans un état qu'aucun bouton ne peut atteindre ni
    // quitter.
    for (const widget of listWidgets()) {
      for (const field of widget.optionsSchema ?? []) {
        if (field.kind !== 'enum') continue;
        expect(
          field.choices.some((choice) => choice.value === field.fallback),
          `${widget.id}.${field.key} : repli « ${field.fallback} » hors des choix`
        ).toBe(true);
      }
    }
  });

  it('chaque réglage de TEXTE déclare un plafond utilisable', () => {
    // Sans plafond, un titre de section de cent mille caractères passe par la
    // place de marché et casse la mise en page de qui l'installe.
    for (const widget of listWidgets()) {
      for (const field of widget.optionsSchema ?? []) {
        if (field.kind !== 'text') continue;
        expect(field.maxLength, `${widget.id}.${field.key}`).toBeGreaterThan(0);
        expect(field.maxLength, `${widget.id}.${field.key}`).toBeLessThanOrEqual(4000);
      }
    }
  });
});
