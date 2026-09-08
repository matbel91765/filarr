/**
 * LA FICHE BINAIRE PARLE LA LANGUE DE L'UTILISATEUR.
 *
 * Le défaut corrigé : une table de libellés FRANÇAIS EN DUR dans le composant.
 * Ce qui le garde : toute clé rendue par la carte doit exister dans les DEUX
 * catalogues, et la nomenclature doit rester celle du mobile — sans quoi les
 * deux plates-formes se remettent à nommer la même chose autrement.
 */

import { describe, it, expect } from 'vitest';

import {
  binaryKindLabelKey,
  describeBinaryKind,
  normalizeBinaryExtension,
  type BinaryKindKey,
} from '../binaryInfoModel';
import fr from '../../../../i18n/locales/fr/translation.json';
import en from '../../../../i18n/locales/en/translation.json';

/** Les clés attendues, telles que le mobile les nomme (`binaryInfo.kind.*`). */
const MOBILE_KIND_KEYS: BinaryKindKey[] = [
  'exe',
  'msi',
  'dll',
  'dmg',
  'pkg',
  'app',
  'dylib',
  'deb',
  'rpm',
  'appimage',
  'so',
  'apk',
  'iso',
  'img',
  'bin',
  'unknown',
];

const frKinds = (fr as { preview: { binaryInfo: { kind: Record<string, string> } } }).preview
  .binaryInfo.kind;
const enKinds = (en as { preview: { binaryInfo: { kind: Record<string, string> } } }).preview
  .binaryInfo.kind;

describe('fiche binaire — genre reconnu', () => {
  it('reconnaît une extension et sa plate-forme', () => {
    expect(describeBinaryKind('setup.exe')).toEqual({
      key: 'exe',
      platform: 'Windows',
      extension: 'exe',
      badge: 'EXE',
    });
    expect(describeBinaryKind('app.deb').platform).toBe('Linux');
    expect(describeBinaryKind('mobile.apk').platform).toBe('Android');
  });

  it('les CAPITALES sont le même genre — la table est indexée en minuscules', () => {
    expect(describeBinaryKind('SETUP.EXE').key).toBe('exe');
    expect(describeBinaryKind('x', 'DMG').key).toBe('dmg');
  });

  it("l'extension passée en prop l'emporte sur celle du nom", () => {
    expect(describeBinaryKind('archive.tar.gz', 'iso').key).toBe('iso');
  });

  it('un point de tête ne casse pas la reconnaissance', () => {
    expect(describeBinaryKind('x', '.msi').key).toBe('msi');
  });

  it('une extension inconnue retombe sur « unknown », pas sur du français en dur', () => {
    const kind = describeBinaryKind('quelquechose.zzz');
    expect(kind.key).toBe('unknown');
    expect(kind.platform).toBe('');
    expect(kind.badge).toBe('ZZZ');
  });

  it('un fichier SANS extension ne s’en invente pas une', () => {
    // Le code d'origine faisait `name.split('.').pop()` : « LICENSE » devenait
    // l'extension « license », affichée telle quelle en pastille et en puce.
    const kind = describeBinaryKind('LICENSE');
    expect(kind.key).toBe('unknown');
    expect(kind.extension).toBe('bin');
    expect(kind.badge).toBe('BIN');
  });

  it('un point de TÊTE n’est pas une extension non plus', () => {
    expect(describeBinaryKind('.gitignore').extension).toBe('bin');
  });

  it('un point FINAL ne donne pas une extension vide', () => {
    expect(describeBinaryKind('archive.').extension).toBe('bin');
  });

  it('seul le DERNIER segment compte', () => {
    expect(describeBinaryKind('paquet.tar.deb').key).toBe('deb');
  });

  it('normalizeBinaryExtension rend une chaîne vide quand il n’y a rien', () => {
    expect(normalizeBinaryExtension('', '')).toBe('');
  });
});

describe('fiche binaire — les libellés sont traduits', () => {
  it('la clé pointe sous preview.binaryInfo.kind', () => {
    expect(binaryKindLabelKey('exe')).toBe('preview.binaryInfo.kind.exe');
  });

  it('CHAQUE genre a une traduction FR et EN', () => {
    for (const key of MOBILE_KIND_KEYS) {
      expect(frKinds[key], `fr manquant : ${key}`).toBeTruthy();
      expect(enKinds[key], `en manquant : ${key}`).toBeTruthy();
    }
  });

  it('la nomenclature est EXACTEMENT celle du mobile — ni plus, ni moins', () => {
    expect(Object.keys(frKinds).sort()).toEqual([...MOBILE_KIND_KEYS].sort());
    expect(Object.keys(enKinds).sort()).toEqual([...MOBILE_KIND_KEYS].sort());
  });

  it('la phrase « jamais exécuté » existe dans les deux langues', () => {
    const frNotice = (fr as { preview: { binaryInfo: { neverRun: string } } }).preview.binaryInfo
      .neverRun;
    const enNotice = (en as { preview: { binaryInfo: { neverRun: string } } }).preview.binaryInfo
      .neverRun;
    expect(frNotice.length).toBeGreaterThan(0);
    expect(enNotice.length).toBeGreaterThan(0);
    expect(frNotice).not.toBe(enNotice);
  });

  it('toute clé rendue par la carte est résoluble', () => {
    for (const name of ['setup.exe', 'x.zzz', 'LICENSE', 'disk.iso']) {
      const key = binaryKindLabelKey(describeBinaryKind(name).key).split('.').pop() as string;
      expect(frKinds).toHaveProperty(key);
    }
  });
});
