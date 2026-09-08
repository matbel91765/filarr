/**
 * LA RÈGLE QUI TIENT TOUT LE MODULE : sans préférence, RIEN NE CHANGE.
 *
 * Une fonctionnalité de confort qui modifie le comportement par défaut devient
 * une friction pour tous ceux qui ne l'ont pas demandée. Ces tests figent donc
 * d'abord l'immobilité — le double-clic ordinaire ouvre exactement ce qu'il
 * ouvrait — puis vérifient que le choix mémorisé porte, et qu'un choix devenu
 * caduc se retire tout seul.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  clearAllPreferences,
  defaultTargetFor,
  extensionOf,
  forgetPreference,
  openTargetsFor,
  preferenceFor,
  rememberPreference,
  shouldAskBeforeOpening,
} from '../openWith';
import { registerPlugin, __resetPluginRegistryForTests } from '../../plugins/pluginRegistry';
import type { FilarrPlugin } from '../../plugins/pluginTypes';

const greffon = (id: string, extensions: string[], imports?: string[]): FilarrPlugin => ({
  manifest: {
    id,
    name: id,
    version: '1.0.0',
    trust: 'builtin',
    provides: { editors: [] },
  },
  editors: [
    {
      contribution: { id: `${id}-editor`, extensions, displayName: `Éditer (${id})`, imports },
      mount: () => ({ destroy: () => undefined, getBytes: () => new Uint8Array(0) }),
    },
  ],
});

const contexte = (fileName: string, over: Partial<Parameters<typeof openTargetsFor>[0]> = {}) => ({
  fileName,
  hasPreview: true,
  canOpenSystem: true,
  ...over,
});

/**
 * UN `localStorage` MINIMAL — sans lui, ces tests ne prouvaient rien.
 *
 * Les préférences vivent dans `profileStorage`, qui s'appuie sur
 * `localStorage`. L'environnement de test est `node` : il n'en a pas. Or les
 * écritures du module sont volontairement TOLÉRANTES (un stockage plein ne
 * doit pas empêcher d'ouvrir un fichier), donc elles échouaient en silence et
 * chaque assertion sur une préférence lisait le vide en croyant lire un choix.
 *
 * On fournit donc la vraie dépendance plutôt que d'installer jsdom pour un
 * seul fichier.
 */
const memoire = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, String(v)),
  removeItem: (k: string) => void memoire.delete(k),
  clear: () => memoire.clear(),
  key: (i: number) => [...memoire.keys()][i] ?? null,
  get length() {
    return memoire.size;
  },
});

beforeEach(() => {
  memoire.clear();
  __resetPluginRegistryForTests();
  clearAllPreferences();
});

describe('extensionOf', () => {
  it('rend l’extension en minuscules, sans le point', () => {
    expect(extensionOf('Rapport.DOCX')).toBe('docx');
    expect(extensionOf('a.b.c.md')).toBe('md');
  });

  it('rend vide pour un nom sans extension, ou un point en tête', () => {
    // `.gitignore` est un NOM, pas une extension : le traiter comme telle
    // ferait partager une préférence entre tous les fichiers cachés.
    expect(extensionOf('LISEZMOI')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('les cibles disponibles', () => {
  it('classe du plus spécifique au plus générique', () => {
    registerPlugin(greffon('texte', ['md']));
    expect(openTargetsFor(contexte('note.md')).map((c) => c.id)).toEqual([
      'texte-editor',
      'preview',
      'system',
    ]);
  });

  it('n’offre que ce qui existe vraiment', () => {
    expect(
      openTargetsFor(contexte('x.inconnu', { hasPreview: false, canOpenSystem: false }))
    ).toEqual([]);
  });

  it('écarte un éditeur qui refuse la taille, plutôt que de le griser', () => {
    // Proposer une ouverture qu'on sait devoir refuser n'aide personne — et
    // l'aperçu, qui sait fenêtrer, est juste en dessous.
    registerPlugin(greffon('texte', ['log']));
    const cibles = openTargetsFor(contexte('gros.log', { size: 5 * 1024 * 1024 * 1024 }));
    expect(cibles.map((c) => c.id)).toEqual(['preview', 'system']);
  });

  it('n’offre l’import QUE si l’appelant le demande — c’est un opt-in, pas un défaut', () => {
    // `getBytes()` rend toujours le format natif de l'éditeur : enregistrer un
    // .docx ouvert par importeur écrirait du .fdoc sous un nom .docx. Seul un
    // appelant qui sait CONVERTIR (créer un fichier neuf, laisser l'original
    // intact) a le droit d'offrir cette cible. L'explorateur le fait ; un
    // appelant qui l'oublierait n'expose pas un geste destructeur par défaut.
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));
    expect(openTargetsFor(contexte('rapport.docx')).map((c) => c.id)).toEqual([
      'preview',
      'system',
    ]);
  });

  it('propose l’IMPORTEUR quand on l’autorise, et seulement hors format natif', () => {
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));

    const docx = openTargetsFor(contexte('rapport.docx', { allowImport: true }));
    expect(docx[0]).toMatchObject({ kind: 'editor', mode: 'import' });

    // Sur son format NATIF, l'importeur ne se propose pas une seconde fois.
    const fdoc = openTargetsFor(contexte('rapport.fdoc', { allowImport: true }));
    expect(fdoc.filter((c) => c.kind === 'editor')).toHaveLength(1);
    expect(fdoc[0]).toMatchObject({ mode: 'native' });
  });

  it('liste TOUS les candidats d’une extension partagée, dans l’ordre du registre', () => {
    registerPlugin(greffon('premier', ['md']));
    registerPlugin(greffon('second', ['md']));
    expect(openTargetsFor(contexte('note.md')).map((c) => c.id)).toEqual([
      'premier-editor',
      'second-editor',
      'preview',
      'system',
    ]);
  });
});

describe('la cible par défaut', () => {
  it('SANS préférence, c’est la première — donc le comportement d’avant', () => {
    registerPlugin(greffon('texte', ['md']));
    expect(defaultTargetFor(contexte('note.md'))?.id).toBe('texte-editor');
  });

  it('une préférence mémorisée porte', () => {
    registerPlugin(greffon('texte', ['md']));
    rememberPreference('note.md', 'system');
    expect(defaultTargetFor(contexte('note.md'))?.id).toBe('system');
  });

  it('la préférence vaut pour l’EXTENSION, pas pour le fichier', () => {
    registerPlugin(greffon('texte', ['md']));
    rememberPreference('note.md', 'system');
    expect(defaultTargetFor(contexte('autre.md'))?.id).toBe('system');
    expect(preferenceFor('encore.md')).toBe('system');
  });

  it('une préférence CADUQUE est ignorée, jamais devinée', () => {
    // Greffon désinstallé, fichier devenu trop gros : on retombe sur le défaut
    // plutôt que de refuser d'ouvrir, ou pire, d'ouvrir autre chose au hasard.
    registerPlugin(greffon('texte', ['md']));
    rememberPreference('note.md', 'greffon-disparu');
    expect(defaultTargetFor(contexte('note.md'))?.id).toBe('texte-editor');
  });

  it('s’oublie sur commande', () => {
    rememberPreference('note.md', 'system');
    forgetPreference('note.md');
    expect(preferenceFor('note.md')).toBeNull();
  });

  it('rend null quand il n’y a rien pour ouvrir', () => {
    expect(
      defaultTargetFor(contexte('x.zzz', { hasPreview: false, canOpenSystem: false }))
    ).toBeNull();
  });
});

describe('quand DEMANDER', () => {
  it('ne demande RIEN pour un format ordinaire — c’est toute la règle', () => {
    registerPlugin(greffon('texte', ['md']));
    expect(shouldAskBeforeOpening(contexte('note.md'))).toBe(false);
    expect(shouldAskBeforeOpening(contexte('photo.png'))).toBe(false);
  });

  it('demande pour un format qu’un éditeur sait seulement IMPORTER', () => {
    // Ouvrir un .docx dans Filarr y crée un document d'un AUTRE format : le
    // faire sans demander serait une conversion subie.
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));
    expect(shouldAskBeforeOpening(contexte('rapport.docx', { allowImport: true }))).toBe(true);
  });

  it('ne demande plus une fois le choix fait', () => {
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));
    rememberPreference('rapport.docx', 'system');
    expect(shouldAskBeforeOpening(contexte('rapport.docx', { allowImport: true }))).toBe(false);
  });
});
