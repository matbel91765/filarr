/**
 * Le validateur de `.filarrlayout`, éprouvé sur ce qu'un fichier hostile fait
 * réellement : polluer un prototype, transporter un identifiant de dossier,
 * faire travailler la machine, nommer un composant qui n'existe pas.
 *
 * Chaque test dit la RÈGLE qu'il tient, pas le code qu'il traverse : ces
 * assertions doivent survivre à une réécriture du validateur.
 */

import { describe, expect, it } from 'vitest';

import {
  LAYOUT_FILE_KIND,
  LAYOUT_FILE_MAX_BYTES,
  LAYOUT_LIMITS,
  compareAppVersions,
  coreType,
  coreWidgetId,
  isUrlLike,
  looksLikeIdentifier,
  sanitizeOptions,
  serializeLayoutFile,
  utf8ByteLength,
  type LayoutFile,
} from '../layoutFormat';
import {
  importSummary,
  safeReviveTree,
  validateLayoutFile,
  type LayoutValidationOk,
} from '../layoutValidator';

const KNOWN = new Set(['greeting', 'pins', 'resume', 'folder-grid']);

/** Un fichier minimal et VALIDE — chaque test n'en modifie qu'une chose. */
function baseFile(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: LAYOUT_FILE_KIND,
    formatVersion: 1,
    id: 'lay-test-1',
    name: 'Focus',
    description: 'Un accueil calme',
    target: 'home',
    version: 1,
    requires: [{ kind: 'core', minAppVersion: '2.13' }],
    widgets: [
      { uid: 'w1', type: 'core:greeting', x: 0, y: 0, w: 12, h: 2 },
      { uid: 'w2', type: 'core:pins', x: 0, y: 2, w: 6, h: 3 },
    ],
    ...over,
  };
}

const validate = (raw: unknown) => validateLayoutFile(raw, { knownTypes: KNOWN });
const validateJson = (doc: unknown) => validate(JSON.stringify(doc));

/**
 * `{ __proto__: … }` écrit dans un littéral JavaScript ne crée PAS de propriété
 * : il change le prototype de l'objet, et `JSON.stringify` n'en garde rien. Un
 * test de pollution écrit naïvement passerait donc au vert sur un validateur
 * qui ne protège rien. On écrit la clé sous un pseudonyme et on la restitue
 * dans le TEXTE, ce qui produit exactement ce qu'un fichier hostile contient.
 */
function jsonWithForbiddenKey(doc: unknown, replaced: string): string {
  return JSON.stringify(doc).replace(/"__CLE__"/g, `"${replaced}"`);
}

/** Rend le résultat en forçant le cas nominal — les tests d'erreur ne l'utilisent pas. */
function okResult(doc: unknown): LayoutValidationOk {
  const result = validateJson(doc);
  if (result.status !== 'ok') throw new Error(`attendu ok, reçu ${result.code}`);
  return result;
}

// ==================== L'entrée ====================

describe('entrée', () => {
  it('refuse ce qui n’est pas une chaîne — on valide un fichier, pas un objet déjà analysé', () => {
    expect(validate({ kind: LAYOUT_FILE_KIND })).toEqual({
      status: 'error',
      code: 'not-a-string',
    });
  });

  it('refuse un JSON illisible sans lever', () => {
    expect(validate('{ pas du json')).toEqual({ status: 'error', code: 'not-json' });
  });

  it('refuse un JSON dont la racine n’est pas un objet', () => {
    expect(validate('[]')).toEqual({ status: 'error', code: 'not-object' });
    expect(validate('"texte"')).toEqual({ status: 'error', code: 'not-object' });
    expect(validate('null')).toEqual({ status: 'error', code: 'not-object' });
  });

  it('refuse un fichier sans le discriminant', () => {
    expect(validateJson(baseFile({ kind: 'filarr.plugin' }))).toEqual({
      status: 'error',
      code: 'bad-kind',
    });
  });
});

// ==================== La taille, EN OCTETS ====================

describe('plafond de taille', () => {
  it('accepte un fichier juste sous le plafond', () => {
    const filler = 'a'.repeat(1000);
    const doc = baseFile({ description: filler.slice(0, LAYOUT_LIMITS.description) });
    expect(okResult(doc).status).toBe('ok');
  });

  it('refuse au-delà de 256 Kio', () => {
    const widgets = Array.from({ length: 5000 }, (_, i) => ({
      uid: `w${i}`,
      type: 'core:greeting',
      x: 0,
      y: i,
      w: 12,
      h: 2,
    }));
    const raw = JSON.stringify(baseFile({ widgets }));
    expect(utf8ByteLength(raw)).toBeGreaterThan(LAYOUT_FILE_MAX_BYTES);
    expect(validate(raw)).toEqual({ status: 'error', code: 'too-large' });
  });

  it('MESURE DES OCTETS, PAS DES CARACTÈRES — le plafond ne se contourne pas en UTF-8 large', () => {
    // « 𝄞 » : 2 unités UTF-16, 4 octets. Une chaîne de 100 000 de ces
    // caractères pèse 400 Ko sur le disque alors que `.length` en annonce
    // 200 000 — sous un plafond de 256 * 1024 lu en `.length`, elle passerait.
    const wide = '𝄞'.repeat(100_000);
    expect(wide.length).toBeLessThan(LAYOUT_FILE_MAX_BYTES);
    expect(utf8ByteLength(wide)).toBeGreaterThan(LAYOUT_FILE_MAX_BYTES);
    expect(validate(wide)).toEqual({ status: 'error', code: 'too-large' });
  });
});

// ==================== Pollution de prototype ====================

describe('pollution de prototype', () => {
  it('refuse __proto__ à la racine', () => {
    const raw = `{"kind":"${LAYOUT_FILE_KIND}","formatVersion":1,"__proto__":{"polluted":true}}`;
    expect(validate(raw)).toEqual({ status: 'error', code: 'forbidden-key' });
  });

  it('refuse __proto__ EN PROFONDEUR, dans les réglages d’un bloc', () => {
    const raw = jsonWithForbiddenKey(
      baseFile({
        widgets: [
          {
            uid: 'w1',
            type: 'core:greeting',
            x: 0,
            y: 0,
            w: 12,
            h: 2,
            options: { style: { deep: { __CLE__: { polluted: true } } } },
          },
        ],
      }),
      '__proto__'
    );
    expect(validate(raw)).toEqual({ status: 'error', code: 'forbidden-key' });
  });

  it('refuse constructor et prototype, à toute profondeur', () => {
    expect(validate(JSON.stringify(baseFile({ constructor: { x: 1 } })))).toEqual({
      status: 'error',
      code: 'forbidden-key',
    });
    const nested = baseFile({ theme: { themeId: 'space', fontId: 'jakarta', prototype: {} } });
    expect(validate(JSON.stringify(nested))).toEqual({ status: 'error', code: 'forbidden-key' });
  });

  it('refuse aussi dans un TABLEAU (le parcours ne saute pas les éléments)', () => {
    const raw = jsonWithForbiddenKey(
      baseFile({ requires: [{ kind: 'core' }, { __CLE__: {} }] }),
      '__proto__'
    );
    expect(validate(raw)).toEqual({ status: 'error', code: 'forbidden-key' });
  });

  it('AUCUN prototype global n’est touché après une tentative', () => {
    const raw = `{"kind":"${LAYOUT_FILE_KIND}","formatVersion":1,"__proto__":{"pollué":"oui"}}`;
    validate(raw);
    expect(({} as Record<string, unknown>).pollué).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).pollué).toBeUndefined();
  });

  it('safeReviveTree reconstruit SANS prototype — rien n’est hérité', () => {
    const revived = safeReviveTree(JSON.parse('{"a":{"b":1}}'));
    expect(revived).not.toBeNull();
    const value = revived!.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.getPrototypeOf(value.a as object)).toBeNull();
    // Un objet sans prototype ne répond RIEN de son propre chef : c'est ce qui
    // garantit que toute valeur lue plus loin vient bien du fichier.
    expect((value as { constructor?: unknown }).constructor).toBeUndefined();
  });
});

// ==================== Versions ====================

describe('versions', () => {
  it('refuse une version de format inconnue plutôt que de deviner', () => {
    expect(validateJson(baseFile({ formatVersion: 2 }))).toEqual({
      status: 'error',
      code: 'unsupported-version',
    });
    expect(validateJson(baseFile({ formatVersion: '1' }))).toEqual({
      status: 'error',
      code: 'unsupported-version',
    });
  });

  it('lit minAppVersion et refuse une version qui n’en est pas une', () => {
    expect(okResult(baseFile()).file.requires[0].minAppVersion).toBe('2.13');
    expect(
      validateJson(baseFile({ requires: [{ kind: 'core', minAppVersion: 'demain' }] }))
    ).toEqual({ status: 'error', code: 'bad-requires' });
  });

  it('compare les versions par composant, pas par ordre lexical', () => {
    expect(compareAppVersions('2.9.0', '2.14.0')).toBeLessThan(0);
    expect(compareAppVersions('2.14', '2.14.0')).toBe(0);
    expect(compareAppVersions('3.0', '2.99.99')).toBeGreaterThan(0);
    expect(compareAppVersions('n’importe quoi', '0.0.0')).toBe(0);
  });

  it('un requires vide vaut « core » — un fichier sans exigence n’en réclame aucune', () => {
    const result = okResult(baseFile({ requires: undefined }));
    expect(result.file.requires).toEqual([{ kind: 'core' }]);
  });
});

// ==================== Le champ RÉSERVÉ aux greffons ====================

describe('requires[].kind === "plugin"', () => {
  it('est refusé en v1, et refusé HONNÊTEMENT (code dédié, pas « fichier invalide »)', () => {
    const doc = baseFile({ requires: [{ kind: 'core' }, { kind: 'plugin' }] });
    expect(validateJson(doc)).toEqual({ status: 'error', code: 'plugin-required' });
  });

  it('un kind inconnu est refusé aussi — on ne devine pas ce qu’il réclame', () => {
    expect(validateJson(baseFile({ requires: [{ kind: 'theme' }] }))).toEqual({
      status: 'error',
      code: 'bad-requires',
    });
  });
});

// ==================== Types de widgets ====================

describe('types de widgets', () => {
  it('n’accepte que « core:<id> »', () => {
    expect(coreWidgetId('core:greeting')).toBe('greeting');
    expect(coreWidgetId('greeting')).toBeNull();
    expect(coreWidgetId('plugin:evil')).toBeNull();
    expect(coreWidgetId('core:../../etc/passwd')).toBeNull();
    expect(coreWidgetId('core:Greeting')).toBeNull();
    expect(coreWidgetId('core:')).toBeNull();
    expect(coreType('greeting')).toBe('core:greeting');
    expect(coreType('Mon Widget')).toBeNull();
  });

  it('rejette un bloc dont le type n’est pas un identifiant de widget', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w1', type: 'core:greeting', x: 0, y: 0, w: 12, h: 2 },
        { uid: 'w2', type: '../../../src/evil', x: 0, y: 2, w: 6, h: 2 },
      ],
    });
    const result = okResult(doc);
    expect(result.ok).toHaveLength(1);
    expect(result.rejected).toEqual([{ index: 1, uid: 'w2', code: 'bad-type' }]);
  });

  it('UN TYPE INCONNU N’EST PAS UNE ERREUR : il est conservé, pas supprimé', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w1', type: 'core:greeting', x: 0, y: 0, w: 12, h: 2 },
        { uid: 'w2', type: 'core:crystal-ball', x: 0, y: 2, w: 6, h: 2, title: 'Boule de cristal' },
      ],
    });
    const result = okResult(doc);
    expect(result.ok.map((w) => w.uid)).toEqual(['w1']);
    expect(result.unknown.map((w) => w.uid)).toEqual(['w2']);
    expect(result.rejected).toEqual([]);
    // Il traverse ENTIER : sa géométrie et son titre de secours sont ce qui
    // permettra d'afficher une tuile inerte au bon endroit.
    expect(result.unknown[0]).toMatchObject({ x: 0, y: 2, w: 6, h: 2, title: 'Boule de cristal' });
    expect(result.file.widgets).toHaveLength(2);
  });

  it('compte les trois familles séparément dans le récapitulatif', () => {
    const widgets = [
      ...Array.from({ length: 12 }, (_, i) => ({
        uid: `ok${i}`,
        type: 'core:pins',
        x: 0,
        y: i,
        w: 6,
        h: 1,
      })),
      { uid: 'futur', type: 'core:crystal-ball', x: 6, y: 0, w: 6, h: 1 },
      { uid: 'cassé', type: 'core:pins', x: 99, y: 0, w: 6, h: 1 },
    ];
    expect(importSummary(okResult(baseFile({ widgets })))).toEqual({
      applied: 12,
      pending: 1,
      ignored: 1,
    });
  });
});

// ==================== Géométrie ====================

describe('géométrie', () => {
  it('rejette un bloc qui déborde des douze colonnes', () => {
    const doc = baseFile({
      widgets: [{ uid: 'w1', type: 'core:pins', x: 8, y: 0, w: 6, h: 2 }],
    });
    expect(validateJson(doc)).toEqual({ status: 'error', code: 'no-widgets' });
  });

  it('rejette les dimensions non entières, négatives ou infinies', () => {
    const bad = [
      { uid: 'a', type: 'core:pins', x: 0.5, y: 0, w: 6, h: 2 },
      { uid: 'b', type: 'core:pins', x: -1, y: 0, w: 6, h: 2 },
      { uid: 'c', type: 'core:pins', x: 0, y: 0, w: 0, h: 2 },
      { uid: 'd', type: 'core:pins', x: 0, y: 0, w: 6, h: '2' },
    ];
    for (const widget of bad) {
      const doc = baseFile({ widgets: [widget] });
      expect(validateJson(doc)).toEqual({ status: 'error', code: 'no-widgets' });
    }
  });

  it('rejette un doublon d’uid — deux blocs ne peuvent pas porter la même identité', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w1', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        { uid: 'w1', type: 'core:greeting', x: 6, y: 0, w: 6, h: 2 },
      ],
    });
    const result = okResult(doc);
    expect(result.ok).toHaveLength(1);
    expect(result.rejected).toEqual([{ index: 1, uid: 'w1', code: 'duplicate-uid' }]);
  });

  it('plafonne le nombre de blocs sans les avaler en silence', () => {
    const widgets = Array.from({ length: LAYOUT_LIMITS.widgets + 3 }, (_, i) => ({
      uid: `w${i}`,
      type: 'core:pins',
      x: 0,
      y: i,
      w: 6,
      h: 1,
    }));
    const result = okResult(baseFile({ widgets }));
    expect(result.ok).toHaveLength(LAYOUT_LIMITS.widgets);
    expect(result.rejected).toHaveLength(3);
    expect(result.rejected.every((r) => r.code === 'over-limit')).toBe(true);
  });
});

// ==================== VIE PRIVÉE : les liaisons ====================

describe('liaisons — la règle structurelle', () => {
  it('REFUSE un identifiant en clair, même fabriqué à la main', () => {
    const doc = baseFile({
      widgets: [
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 0,
          w: 12,
          h: 3,
          bindings: { folderId: '3f2a1c44-9e11-4a7b-8f60-2b7c9d0e1a55' },
        },
      ],
    });
    expect(validateJson(doc)).toEqual({ status: 'error', code: 'no-widgets' });
  });

  it('nomme le refus « binding-identifier » pour qu’il soit dicible', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w0', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 2,
          w: 12,
          h: 3,
          bindings: { folderId: 'abc' },
        },
      ],
    });
    expect(okResult(doc).rejected).toEqual([{ index: 1, uid: 'w1', code: 'binding-identifier' }]);
  });

  it('refuse un identifiant CACHÉ à côté de l’emplacement nommé', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w0', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 2,
          w: 12,
          h: 3,
          bindings: {
            folderId: {
              slot: { label: 'Vos projets', accepts: 'folder' },
              folderId: '3f2a1c44-9e11-4a7b-8f60-2b7c9d0e1a55',
            },
          },
        },
      ],
    });
    expect(okResult(doc).rejected).toEqual([{ index: 1, uid: 'w1', code: 'binding-identifier' }]);
  });

  it('refuse un identifiant caché DANS le libellé', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w0', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 2,
          w: 12,
          h: 3,
          bindings: {
            folderId: {
              slot: { label: '3f2a1c44-9e11-4a7b-8f60-2b7c9d0e1a55', accepts: 'folder' },
            },
          },
        },
      ],
    });
    expect(okResult(doc).rejected).toEqual([{ index: 1, uid: 'w1', code: 'binding-identifier' }]);
  });

  it('accepte un EMPLACEMENT NOMMÉ, qui ne désigne rien chez personne', () => {
    const doc = baseFile({
      widgets: [
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 0,
          w: 12,
          h: 3,
          bindings: {
            folderId: { slot: { label: 'Votre dossier de projets', accepts: 'folder' } },
          },
        },
      ],
    });
    const result = okResult(doc);
    expect(result.ok[0].bindings).toEqual({
      folderId: { slot: { label: 'Votre dossier de projets', accepts: 'folder' } },
    });
  });

  it('refuse un « accepts » hors de la liste close', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w0', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        {
          uid: 'w1',
          type: 'core:folder-grid',
          x: 0,
          y: 2,
          w: 12,
          h: 3,
          bindings: { any: { slot: { label: 'Quelque chose', accepts: 'password' } } },
        },
      ],
    });
    expect(okResult(doc).rejected).toEqual([{ index: 1, uid: 'w1', code: 'bad-bindings' }]);
  });

  it('reconnaît un jeton d’un libellé', () => {
    expect(looksLikeIdentifier('3f2a1c44-9e11-4a7b-8f60-2b7c9d0e1a55')).toBe(true);
    expect(looksLikeIdentifier('a1b2c3d4e5f60718')).toBe(true);
    expect(looksLikeIdentifier('Votre dossier de projets')).toBe(false);
    expect(looksLikeIdentifier('Projets')).toBe(false);
  });
});

// ==================== URL : nulle part ====================

describe('aucune URL, nulle part', () => {
  it('reconnaît les formes usuelles', () => {
    for (const value of [
      'https://exemple.test/a',
      'HTTP://EXEMPLE.TEST',
      '//exemple.test/a',
      'data:text/html;base64,AAAA',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'www.exemple.test',
    ]) {
      expect(isUrlLike(value)).toBe(true);
    }
    expect(isUrlLike('Mes notes 2026')).toBe(false);
    expect(isUrlLike('ratio 3:2')).toBe(false);
  });

  it('refuse une URL dans l’en-tête (le fichier entier est écarté)', () => {
    expect(validateJson(baseFile({ name: 'https://exemple.test' }))).toEqual({
      status: 'error',
      code: 'bad-header',
    });
  });

  it('rejette le BLOC qui porte une URL dans ses réglages, et garde les autres', () => {
    const doc = baseFile({
      widgets: [
        { uid: 'w1', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        {
          uid: 'w2',
          type: 'core:greeting',
          x: 6,
          y: 0,
          w: 6,
          h: 2,
          options: { background: 'https://exemple.test/pixel.png' },
        },
      ],
    });
    const result = okResult(doc);
    expect(result.ok.map((w) => w.uid)).toEqual(['w1']);
    expect(result.rejected).toEqual([{ index: 1, uid: 'w2', code: 'bad-options' }]);
  });

  it('oublie une icône qui serait une URL au lieu d’un emoji', () => {
    const result = okResult(baseFile({ icon: 'https://exemple.test/i.png' }));
    expect(result.file.icon).toBeUndefined();
    expect(okResult(baseFile({ icon: '🌿' })).file.icon).toBe('🌿');
  });
});

// ==================== Réglages ====================

describe('réglages', () => {
  it('laisse passer des réglages génériques', () => {
    const doc = baseFile({
      widgets: [
        {
          uid: 'w1',
          type: 'core:resume',
          x: 0,
          y: 0,
          w: 12,
          h: 3,
          options: { frame: 'column', rows: 5, compact: true, tags: ['a', 'b'] },
        },
      ],
    });
    expect(okResult(doc).ok[0].options).toEqual({
      frame: 'column',
      rows: 5,
      compact: true,
      tags: ['a', 'b'],
    });
  });

  it('rejette un bloc dont les réglages sont trop profonds ou trop nombreux', () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const doc = baseFile({
      widgets: [
        { uid: 'w0', type: 'core:pins', x: 0, y: 0, w: 6, h: 2 },
        { uid: 'w1', type: 'core:resume', x: 0, y: 2, w: 12, h: 3, options: deep },
      ],
    });
    expect(okResult(doc).rejected).toEqual([{ index: 1, uid: 'w1', code: 'bad-options' }]);
  });

  it('l’assainissement d’export, lui, RÉPARE au lieu de refuser', () => {
    const cleaned = sanitizeOptions({
      frame: 'column',
      lien: 'https://exemple.test',
      fn: () => 1,
      nombre: Number.POSITIVE_INFINITY,
    });
    expect(cleaned).toEqual({ frame: 'column' });
  });
});

// ==================== L'en-tête ====================

describe('en-tête', () => {
  it('exige un identifiant, un nom et une cible connue', () => {
    expect(validateJson(baseFile({ id: '' }))).toEqual({ status: 'error', code: 'bad-header' });
    expect(validateJson(baseFile({ name: 42 }))).toEqual({ status: 'error', code: 'bad-header' });
    expect(validateJson(baseFile({ target: 'bureau' }))).toEqual({
      status: 'error',
      code: 'bad-header',
    });
  });

  it('accepte les trois cibles du format', () => {
    for (const target of ['home', 'folder', 'board']) {
      expect(okResult(baseFile({ target })).file.target).toBe(target);
    }
  });

  it('refuse un fichier sans le moindre bloc', () => {
    expect(validateJson(baseFile({ widgets: [] }))).toEqual({
      status: 'error',
      code: 'no-widgets',
    });
    expect(validateJson(baseFile({ widgets: 'tous' }))).toEqual({
      status: 'error',
      code: 'no-widgets',
    });
  });

  it('garde le thème comme une SUGGESTION, et l’oublie s’il est illisible', () => {
    expect(
      okResult(baseFile({ theme: { themeId: 'space', fontId: 'jakarta' } })).file.theme
    ).toEqual({ themeId: 'space', fontId: 'jakarta' });
    expect(okResult(baseFile({ theme: { themeId: 42 } })).file.theme).toBeUndefined();
  });
});

// ==================== Aller-retour ====================

describe('aller-retour', () => {
  it('ce qui sort du validateur re-rentre à l’identique', () => {
    const first = okResult(baseFile());
    const second = validate(serializeLayoutFile(first.file as LayoutFile));
    expect(second.status).toBe('ok');
    expect((second as LayoutValidationOk).file).toEqual(first.file);
  });

  it('le fichier rendu ne contient QUE les champs du format', () => {
    const result = okResult(baseFile({ auteurEmail: 'moi@exemple.test', vaultId: 'abc' }));
    expect(Object.keys(result.file).sort()).toEqual(
      [
        'description',
        'formatVersion',
        'id',
        'kind',
        'name',
        'requires',
        'target',
        'version',
        'widgets',
      ].sort()
    );
  });
});
