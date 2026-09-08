/**
 * LE PASSAGE PAR LE DISQUE, CÔTÉ NAVIGATEUR.
 *
 * Le défaut d'origine : `layouts:exportFile` et `layouts:importFile` étaient
 * classés portables depuis le début et n'avaient jamais été écrits. Sur
 * app.filarr.com, le shim levait, `safeInvoke` absorbait, et l'écran affichait
 * « le fichier n'a pas pu être écrit » — un message qui accuse le disque alors
 * qu'il n'y avait aucun dialogue de fichier.
 *
 * Ce qui se prouve ici, et qu'aucune relecture ne montre :
 *
 *   · le sélecteur moderne est PRÉFÉRÉ, et son abandon rend `canceled` — pas
 *     une erreur, sinon on ferait chercher une panne qui n'existe pas ;
 *   · son indisponibilité RETOMBE sur le téléchargement, au lieu d'échouer ;
 *   · l'annulation de l'`<input type=file>` résout la promesse : sans
 *     l'événement `cancel`, l'écran resterait figé sur un chargement éternel ;
 *   · un fichier trop gros est refusé AVANT d'être lu en mémoire.
 *
 * Environnement vitest `node` : pas de DOM. On en pose un minimal, juste assez
 * pour que les deux chemins soient observables.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ==================== Un DOM minimal ====================

interface FakeAnchor {
  href: string;
  download: string;
  click: () => void;
}

interface FakeInput {
  type: string;
  accept: string;
  style: Record<string, string>;
  files: File[] | null;
  click: () => void;
  remove: () => void;
  addEventListener: (name: string, fn: () => void, opts?: unknown) => void;
  dispatch: (name: string) => void;
}

const anchors: FakeAnchor[] = [];
let lastInput: FakeInput | null = null;
/** Ce que fera le prochain `<input type=file>` : un fichier, ou une annulation. */
let inputAnswer: { kind: 'file'; file: File } | { kind: 'cancel' } = { kind: 'cancel' };

const g = globalThis as unknown as Record<string, unknown>;

g.document = {
  createElement(tag: string) {
    if (tag === 'a') {
      const a: FakeAnchor = { href: '', download: '', click: () => undefined };
      anchors.push(a);
      return a;
    }
    const listeners = new Map<string, () => void>();
    const input: FakeInput = {
      type: '',
      accept: '',
      style: {},
      files: null,
      remove: () => undefined,
      addEventListener: (name, fn) => {
        listeners.set(name, fn);
      },
      dispatch: (name) => listeners.get(name)?.(),
      click: () => {
        // Le navigateur ouvre le sélecteur puis émet `change` ou `cancel`. On
        // reproduit l'asynchronisme : un appel synchrone masquerait un ordre
        // d'écoute fautif.
        setTimeout(() => {
          if (inputAnswer.kind === 'file') {
            input.files = [inputAnswer.file];
            input.dispatch('change');
          } else {
            input.dispatch('cancel');
          }
        }, 0);
      },
    };
    lastInput = input;
    return input;
  },
  body: { appendChild: () => undefined },
};

g.URL = {
  createObjectURL: () => 'blob:fake',
  revokeObjectURL: () => undefined,
};

// `DOMException` existe en node 18+, mais on ne présume rien.
if (typeof g.DOMException !== 'function') {
  g.DOMException = class extends Error {
    constructor(message?: string, name?: string) {
      super(message);
      this.name = name ?? 'Error';
    }
  };
}

g.window = g;

// ==================== Le module, après le DOM ====================

import { layoutHandlers } from '../handlers/layoutHandlers';
import { LAYOUT_FILE_MAX_BYTES } from '../../../services/layouts/layoutFormat';

const exportFile = (arg: unknown) =>
  layoutHandlers['layouts:exportFile'](arg) as Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>;

const importFile = () =>
  layoutHandlers['layouts:importFile']() as Promise<{
    success: boolean;
    canceled?: boolean;
    content?: string;
    fileName?: string;
    error?: string;
  }>;

const abort = (): DOMException => new DOMException('annulé', 'AbortError');

/** Un fichier minimal : `size` et `text()` sont tout ce que le code lit. */
function fakeFile(name: string, content: string, size = content.length): File {
  return { name, size, text: async () => content } as unknown as File;
}

beforeEach(() => {
  anchors.length = 0;
  lastInput = null;
  inputAnswer = { kind: 'cancel' };
  delete g.showSaveFilePicker;
  delete g.showOpenFilePicker;
  vi.restoreAllMocks();
});

// ==================== Exporter ====================

describe('layouts:exportFile — écrire depuis un onglet', () => {
  it('utilise le VRAI « Enregistrer sous » quand le navigateur l’a', async () => {
    const written: string[] = [];
    g.showSaveFilePicker = vi.fn(async () => ({
      name: 'choisi-par-la-personne.filarrlayout',
      createWritable: async () => ({
        write: async (data: string) => {
          written.push(data);
        },
        close: async () => undefined,
      }),
    }));

    const res = await exportFile({
      content: '{"kind":"filarr.layout"}',
      suggestedName: 'a.filarrlayout',
    });

    expect(res).toEqual({ success: true, path: 'choisi-par-la-personne.filarrlayout' });
    expect(written).toEqual(['{"kind":"filarr.layout"}']);
    // Pas de téléchargement de secours : on n'écrit pas deux fois le fichier.
    expect(anchors).toHaveLength(0);
  });

  it('ANNULER N’EST PAS UNE PANNE', async () => {
    g.showSaveFilePicker = vi.fn(async () => {
      throw abort();
    });

    const res = await exportFile({ content: '{}', suggestedName: 'a.filarrlayout' });

    expect(res).toEqual({ success: false, canceled: true });
    // Surtout pas de repli : la personne vient de dire non. Télécharger quand
    // même déposerait un fichier qu'elle a refusé.
    expect(anchors).toHaveLength(0);
  });

  it('un sélecteur INDISPONIBLE retombe sur le téléchargement', async () => {
    // Activation utilisateur perdue, contexte non sécurisé, permission refusée :
    // tout sauf un abandon. Échouer là serait refuser d'écrire un fichier qu'on
    // sait parfaitement déposer autrement.
    g.showSaveFilePicker = vi.fn(async () => {
      throw new DOMException('pas permis', 'SecurityError');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const res = await exportFile({ content: '{}', suggestedName: 'plan.filarrlayout' });

    expect(res).toEqual({ success: true, path: 'plan.filarrlayout' });
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe('plan.filarrlayout');
  });

  it('sans sélecteur du tout (Firefox, Safari), le téléchargement suffit', async () => {
    const res = await exportFile({ content: '{}', suggestedName: 'plan.filarrlayout' });
    expect(res.success).toBe(true);
    expect(anchors[0].download).toBe('plan.filarrlayout');
  });

  it('un contenu vide ou absent est refusé, sans rien déposer', async () => {
    expect(await exportFile({ content: '', suggestedName: 'a' })).toEqual({
      success: false,
      error: 'bad-request',
    });
    expect(await exportFile({})).toEqual({ success: false, error: 'bad-request' });
    expect(anchors).toHaveLength(0);
  });

  it('un nom manquant ne bloque pas l’export', async () => {
    const res = await exportFile({ content: '{}' });
    expect(res.success).toBe(true);
    expect(anchors[0].download).toBe('mise-en-page.filarrlayout');
  });
});

// ==================== Importer ====================

describe('layouts:importFile — lire depuis un onglet', () => {
  it('rend le contenu et le nom du fichier choisi', async () => {
    g.showOpenFilePicker = vi.fn(async () => [
      { getFile: async () => fakeFile('recu.filarrlayout', '{"kind":"filarr.layout"}') },
    ]);

    const res = await importFile();

    expect(res).toEqual({
      success: true,
      content: '{"kind":"filarr.layout"}',
      fileName: 'recu.filarrlayout',
    });
  });

  it('fermer le sélecteur rend `canceled`', async () => {
    g.showOpenFilePicker = vi.fn(async () => {
      throw abort();
    });
    expect(await importFile()).toEqual({ success: false, canceled: true });
  });

  it('LE PIÈGE : annuler l’`<input>` RÉSOUT la promesse', async () => {
    // Sans l'écoute de `cancel`, la promesse resterait en suspens pour
    // toujours, et l'écran d'import afficherait un chargement qui n'arrive
    // jamais — la pire des pannes, celle qui ne dit rien.
    inputAnswer = { kind: 'cancel' };
    const res = await importFile();
    expect(res).toEqual({ success: false, canceled: true });
    expect(lastInput?.accept).toContain('.filarrlayout');
  });

  it('le repli `<input>` lit bien le fichier', async () => {
    inputAnswer = { kind: 'file', file: fakeFile('local.filarrlayout', '{"a":1}') };
    expect(await importFile()).toEqual({
      success: true,
      content: '{"a":1}',
      fileName: 'local.filarrlayout',
    });
  });

  it('un fichier TROP GROS est refusé avant d’être lu', async () => {
    // Le contrôle porte sur `size`, pas sur le contenu : lire 300 Mo en mémoire
    // pour ensuite les refuser serait exactement ce que la borne doit éviter.
    let lu = false;
    const enorme = {
      name: 'enorme.filarrlayout',
      size: LAYOUT_FILE_MAX_BYTES + 1,
      text: async () => {
        lu = true;
        return 'x';
      },
    } as unknown as File;
    inputAnswer = { kind: 'file', file: enorme };

    expect(await importFile()).toEqual({ success: false, error: 'too-large' });
    expect(lu).toBe(false);
  });

  it('un fichier PILE à la borne passe', async () => {
    inputAnswer = {
      kind: 'file',
      file: fakeFile('limite.filarrlayout', '{}', LAYOUT_FILE_MAX_BYTES),
    };
    expect((await importFile()).success).toBe(true);
  });
});
