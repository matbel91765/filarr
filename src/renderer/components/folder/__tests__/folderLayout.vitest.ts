/**
 * folderLayout — l'héritage, l'emplacement réservé, le catalogue de la palette.
 *
 * Ce que ces tests fixent, dans l'ordre où les défauts ont été trouvés :
 *   · « Comme le dossier parent » doit être ATTEIGNABLE : un patch de
 *     configuration (icône, pli) sur un dossier qui hérite ne change pas sa
 *     portée, et sa résolution vient bien du premier ancêtre « propre » ;
 *   · en portée héritée, l'affichage PROPRE du dossier prime sur celui de
 *     l'ancêtre (il était écrit ici et lu là-bas) ;
 *   · un gabarit ne retire jamais l'emplacement réservé, et la sortie du mode
 *     édition le refabrique s'il a disparu ;
 *   · la palette d'un dossier ouvre sur les blocs « de ce dossier ».
 *
 *   npx vitest run src/renderer/components/folder/__tests__/folderLayout.vitest.ts
 */

import { describe, expect, it } from 'vitest';

import type { LayoutSlot, LayoutView } from '../../../../services/layout/layoutTypes';
import {
  DEFAULT_FOLDER_CONFIG,
  FOLDER_BAND_TEMPLATES,
  FOLDER_CONFIG_SLOT_ID,
  FOLDER_CONFIG_TYPE,
  bandSlots,
  ensureFolderConfig,
  findConfigSlot,
  folderPaletteCatalog,
  folderViewId,
  isFolderPersonalized,
  readFolderConfigFromSlots,
  replaceBand,
  resolveFolderLayout,
  withFolderConfig,
  type FolderDisplay,
} from '../folderLayout';

function block(id: string, type = 'folder-recents', x = 0): LayoutSlot {
  return { id, role: 'recents', type, x, y: 0, w: 6, h: 2 };
}

function view(folderId: string, slots: LayoutSlot[]): Record<string, LayoutView> {
  const id = folderViewId(folderId);
  return { [id]: { id, slots, updatedAt: '2026-08-27T00:00:00.000Z' } };
}

const DISPLAY_A: FolderDisplay = {
  viewMode: 'list',
  sortField: 'date',
  sortOrder: 'desc',
  groupField: 'none',
  groupEnabled: false,
};

const DISPLAY_B: FolderDisplay = {
  viewMode: 'grid',
  sortField: 'name',
  sortOrder: 'asc',
  groupField: 'type',
  groupEnabled: true,
};

describe('résolution avec héritage', () => {
  const parentSlots = withFolderConfig([block('p1'), block('p2', 'folder-activity', 6)], {
    scope: 'own',
    display: DISPLAY_A,
    bandCollapsed: false,
  });

  it('un dossier « comme le parent » prend le bandeau du premier ancêtre propre', () => {
    const views = {
      ...view('cours', parentSlots),
      ...view('semestre', withFolderConfig([], { scope: 'inherit' })),
    };
    const resolved = resolveFolderLayout(views, 'semestre', ['cours', 'racine']);
    expect(resolved.scope).toBe('inherit');
    expect(resolved.inheritedFrom).toBe('cours');
    expect(resolved.band.map((slot) => slot.id)).toEqual(['p1', 'p2']);
    expect(resolved.display).toEqual(DISPLAY_A);
    expect(resolved.bandCollapsed).toBe(false);
  });

  it('un ancêtre lui-même « comme le parent » est sauté', () => {
    const views = {
      ...view('racine', parentSlots),
      ...view('cours', withFolderConfig([], { scope: 'inherit' })),
      ...view('semestre', withFolderConfig([], { scope: 'inherit' })),
    };
    const resolved = resolveFolderLayout(views, 'semestre', ['cours', 'racine']);
    expect(resolved.inheritedFrom).toBe('racine');
    expect(resolved.band).toHaveLength(2);
  });

  it('sans ancêtre propre, « comme le parent » vaut « comme partout » sans changer la portée', () => {
    const views = view('semestre', withFolderConfig([], { scope: 'inherit' }));
    const resolved = resolveFolderLayout(views, 'semestre', ['cours']);
    expect(resolved.scope).toBe('inherit');
    expect(resolved.band).toEqual([]);
    expect(resolved.inheritedFrom).toBeNull();
  });

  it('en portée héritée, l’affichage PROPRE du dossier prime sur celui de l’ancêtre', () => {
    const views = {
      ...view('cours', parentSlots),
      ...view('semestre', withFolderConfig([], { scope: 'inherit', display: DISPLAY_B })),
    };
    const resolved = resolveFolderLayout(views, 'semestre', ['cours']);
    expect(resolved.display).toEqual(DISPLAY_B);
    // Et l'ancêtre ne sert que s'il n'a rien dit — comme pour le pli.
    const bare = {
      ...view('cours', parentSlots),
      ...view('semestre', withFolderConfig([], { scope: 'inherit', bandCollapsed: true })),
    };
    const resolvedBare = resolveFolderLayout(bare, 'semestre', ['cours']);
    expect(resolvedBare.display).toEqual(DISPLAY_A);
    expect(resolvedBare.bandCollapsed).toBe(true);
  });
});

describe('un patch de configuration ne change pas la portée', () => {
  it('poser une icône sur un dossier qui hérite le laisse « comme le parent »', () => {
    // Le geste de `patchFolderConfig` : la configuration lue, reposée sur le
    // STOCKÉ, avec le correctif. Rien ici ne force « propre ».
    const stored = withFolderConfig([], { scope: 'inherit' });
    const config = readFolderConfigFromSlots(stored) ?? DEFAULT_FOLDER_CONFIG;
    const next = withFolderConfig(stored, { ...config, icon: '📚' });
    const reread = readFolderConfigFromSlots(next);
    expect(reread?.scope).toBe('inherit');
    expect(reread?.icon).toBe('📚');
    // Et c'est bien quelque chose à ÉCRIRE : « inherit » se stocke toujours.
    expect(isFolderPersonalized(reread!, bandSlots(next))).toBe(true);

    const views = {
      ...view('cours', withFolderConfig([block('p1')], { scope: 'own' })),
      ...view('semestre', next),
    };
    const resolved = resolveFolderLayout(views, 'semestre', ['cours']);
    expect(resolved.inheritedFrom).toBe('cours');
    expect(resolved.own.icon).toBe('📚');
  });

  it('la prise de main est un geste EXPLICITE, réservé aux blocs', () => {
    const inherited = withFolderConfig([block('copy-1')], { scope: 'inherit' });
    const config = readFolderConfigFromSlots(inherited)!;
    const taken = withFolderConfig(inherited, { ...config, scope: 'own' });
    expect(readFolderConfigFromSlots(taken)?.scope).toBe('own');
    expect(bandSlots(taken).map((slot) => slot.id)).toEqual(['copy-1']);
  });
});

describe('l’emplacement réservé survit', () => {
  const stored = withFolderConfig([block('old')], {
    scope: 'own',
    icon: '🎓',
    coverPresetId: 'sunset',
    readmeNoteId: 'note-readme',
  });

  it('un gabarit remplace les blocs et garde la configuration', () => {
    const template = FOLDER_BAND_TEMPLATES[0];
    const next = replaceBand(
      stored,
      template.slots.map((slot, index) => ({ ...slot, id: `t-${index}` }))
    );
    const config = readFolderConfigFromSlots(next);
    expect(findConfigSlot(next)?.id).toBe(FOLDER_CONFIG_SLOT_ID);
    expect(config?.icon).toBe('🎓');
    expect(config?.coverPresetId).toBe('sunset');
    expect(config?.readmeNoteId).toBe('note-readme');
    expect(bandSlots(next).map((slot) => slot.type)).toEqual(['folder-recents', 'folder-activity']);
    expect(bandSlots(next).some((slot) => slot.id === 'old')).toBe(false);
  });

  it('un gabarit qui porterait lui-même un emplacement réservé n’en fait pas deux', () => {
    const rogue: LayoutSlot = {
      id: 'rogue',
      role: 'folder-config',
      type: FOLDER_CONFIG_TYPE,
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      options: { scope: 'own', icon: '💣' },
    };
    const next = replaceBand(stored, [rogue, block('n1')]);
    expect(next.filter((slot) => slot.type === FOLDER_CONFIG_TYPE)).toHaveLength(1);
    expect(readFolderConfigFromSlots(next)?.icon).toBe('🎓');
  });

  it('la sortie du mode édition refabrique la configuration perdue, en portée propre', () => {
    // Ce que faisait le sélecteur de modèles d'accueil : un brouillon remplacé
    // en bloc, sans emplacement réservé.
    const amputated = [block('h1', 'greeting'), block('h2', 'pins', 6)];
    const repaired = ensureFolderConfig(amputated, stored);
    const config = readFolderConfigFromSlots(repaired);
    expect(config?.scope).toBe('own');
    expect(config?.icon).toBe('🎓');
    expect(config?.readmeNoteId).toBe('note-readme');
    expect(bandSlots(repaired).map((slot) => slot.id)).toEqual(['h1', 'h2']);
  });

  it('un stocké « comme le parent » redonne une configuration PROPRE à la sortie', () => {
    const inheritStored = withFolderConfig([], { scope: 'inherit', icon: '📁' });
    const repaired = ensureFolderConfig([block('n1')], inheritStored);
    expect(readFolderConfigFromSlots(repaired)?.scope).toBe('own');
    expect(readFolderConfigFromSlots(repaired)?.icon).toBe('📁');
  });

  it('un brouillon intact est rendu tel quel, même référence', () => {
    const intact = withFolderConfig([block('n1')], { scope: 'own' });
    expect(ensureFolderConfig(intact, stored)).toBe(intact);
  });

  it('un stocké vide donne une configuration propre nue', () => {
    const repaired = ensureFolderConfig([block('n1')], []);
    expect(readFolderConfigFromSlots(repaired)).toEqual({ scope: 'own' });
  });
});

describe('le catalogue de la palette d’un dossier', () => {
  const registry = [
    { type: 'greeting' },
    { type: 'search-launcher' },
    { type: 'folder-grid' },
    { type: 'old-thing', retired: true as const },
    { type: 'pins' },
    { type: 'folder-recents' },
    { type: 'folder-tasks' },
  ];

  it('ouvre sur les blocs « de ce dossier », dans l’ordre du registre', () => {
    const catalog = folderPaletteCatalog(registry).map((definition) => definition.type);
    expect(catalog.slice(0, 2)).toEqual(['folder-recents', 'folder-tasks']);
    expect(catalog).toEqual([
      'folder-recents',
      'folder-tasks',
      'greeting',
      'search-launcher',
      'pins',
    ]);
  });

  it('tait les blocs retirés et le bloc de page « Tous les dossiers »', () => {
    const catalog = folderPaletteCatalog(registry).map((definition) => definition.type);
    expect(catalog).not.toContain('old-thing');
    expect(catalog).not.toContain('folder-grid');
  });
});
