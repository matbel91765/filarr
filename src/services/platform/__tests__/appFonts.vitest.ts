/**
 * UN DOCUMENT N'EMPORTE PAS UNE POLICE QUI N'EXISTE PAS.
 *
 * LE DÉFAUT. L'export d'une disposition et l'assistant de publication lisaient
 * `localStorage.getItem('filarr-font') ?? 'inter'`. Le `??` ne couvre que
 * l'ABSENCE : une valeur présente mais inconnue — police retirée, ou venue
 * d'une version plus récente, le stockage survivant aux mises à jour — partait
 * telle quelle dans le fichier. `layoutValidator` ne vérifie qu'une longueur,
 * pas une appartenance ; celui qui importait se la faisait écrire dans SON
 * stockage ; `applyAppFont` la refusait ensuite en silence. Le stockage
 * annonçait alors une police que l'application n'avait jamais posée, et
 * l'export suivant propageait l'identifiant mort.
 */

import { describe, it, expect, afterEach } from 'vitest';

import {
  APP_FONTS,
  APP_FONT_IDS,
  APP_FONT_KEY,
  DEFAULT_APP_FONT_ID,
  exportableAppFontId,
  isAppFontId,
  resolveAppFontId,
} from '../appFonts';

/** Un `localStorage` de laboratoire : ce module n'en connaît rien d'autre. */
function stubStorage(value: string | null): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => (k === APP_FONT_KEY ? value : null) },
  });
}

function stubThrowingStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('stockage refuse');
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('le vocabulaire', () => {
  it('APP_FONT_IDS est exactement la liste des polices — pas une seconde copie', () => {
    expect(APP_FONT_IDS).toEqual(APP_FONTS.map((f) => f.id));
  });

  it('le repli EST une police du vocabulaire', () => {
    // Sans quoi le repli lui-même serait refusé par `applyAppFont`.
    expect(isAppFontId(DEFAULT_APP_FONT_ID)).toBe(true);
  });

  it('reconnaît les identifiants annoncés', () => {
    for (const id of ['inter', 'georgia', 'system', 'jakarta', 'space-grotesk']) {
      expect(isAppFontId(id), id).toBe(true);
    }
  });

  it('refuse tout le reste, y compris ce qui n’est pas une chaîne', () => {
    for (const bad of ['comic-sans', 'Inter', 'INTER', '', ' inter', null, undefined, 42, {}]) {
      expect(isAppFontId(bad), String(bad)).toBe(false);
    }
  });
});

describe('resolveAppFontId — le repli ne s’applique qu’à ce qui est faux', () => {
  it('rend l’identifiant tel quel quand il existe', () => {
    expect(resolveAppFontId('georgia')).toBe('georgia');
  });

  it('replie une valeur PRÉSENTE mais inconnue — c’est le trou du `??`', () => {
    expect(resolveAppFontId('police-disparue')).toBe('inter');
  });

  it('replie l’absence et le vide', () => {
    expect(resolveAppFontId(null)).toBe('inter');
    expect(resolveAppFontId(undefined)).toBe('inter');
    expect(resolveAppFontId('')).toBe('inter');
  });

  it('accepte un repli explicite', () => {
    expect(resolveAppFontId('inconnue', 'jakarta')).toBe('jakarta');
  });
});

describe('exportableAppFontId — ce qui part vraiment dans le fichier', () => {
  it('emporte la police choisie', () => {
    stubStorage('nunito');
    expect(exportableAppFontId()).toBe('nunito');
  });

  it("n'emporte JAMAIS un identifiant inconnu", () => {
    stubStorage('police-dune-version-plus-recente');
    expect(exportableAppFontId()).toBe('inter');
  });

  it('sans choix enregistré, emporte le repli', () => {
    stubStorage(null);
    expect(exportableAppFontId()).toBe('inter');
  });

  it('un stockage REFUSÉ ne fait pas échouer l’export', () => {
    stubThrowingStorage();
    expect(exportableAppFontId()).toBe('inter');
  });

  it('tout ce qu’elle peut rendre est applicable par applyAppFont', () => {
    for (const value of ['nunito', 'inconnue', null, '']) {
      stubStorage(value);
      expect(isAppFontId(exportableAppFontId())).toBe(true);
    }
  });
});
