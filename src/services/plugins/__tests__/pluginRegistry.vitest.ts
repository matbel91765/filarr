import { describe, it, expect, beforeEach } from 'vitest';

/**
 * LE REGISTRE DES GREFFONS — petit exprès, et verrouillé sur trois règles.
 *
 * Un greffon d'édition reçoit les octets DÉCHIFFRÉS de l'utilisateur : le
 * registre est donc une frontière de sécurité avant d'être une commodité. Les
 * trois règles éprouvées ici : seul le régime `builtin` est servi tant que le
 * bac à sable n'existe pas ; une extension n'a qu'UN propriétaire — un conflit
 * est un bogue de configuration, jamais une préférence départagée en silence ;
 * et la résolution est insensible à la casse du nom de fichier.
 */

import {
  editorAcceptsSize,
  registerSandboxedPlugin,
  trustOfProvider,
  registerPlugin,
  editorForFileName,
  editorsForFileName,
  importerForFileName,
  listPlugins,
  registeredEditorExtensions,
  newDocumentFormats,
  PluginRegistrationError,
  __resetPluginRegistryForTests,
} from '../pluginRegistry';
import type { EditorProvider, FilarrPlugin } from '../pluginTypes';
import { MAX_EDITOR_FILE_SIZE } from '../../../constants/limits';

function greffon(id: string, extensions: string[], imports: string[] = []): FilarrPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      trust: 'builtin',
      provides: { editors: [{ id: `${id}-editor`, extensions, displayName: id }] },
    },
    editors: [
      {
        contribution: { id: `${id}-editor`, extensions, displayName: id, imports },
        mount: () => ({ destroy() {}, getBytes: () => new Uint8Array() }),
      },
    ],
  };
}

/**
 * Comme `greffon`, mais en choisissant ce qu'il déclare CRÉABLE — la
 * distinction entre ouvrir et créer est justement ce que ces cas éprouvent.
 */
function greffonCreable(
  id: string,
  extensions: string[],
  nouveaux: { ext: string; label: string; seed?: () => Uint8Array }[]
): FilarrPlugin {
  const contribution = {
    id: `${id}-editor`,
    extensions,
    displayName: id,
    newDocument: nouveaux,
  };
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      trust: 'builtin' as const,
      provides: { editors: [contribution] },
    },
    editors: [
      {
        contribution,
        mount: () => ({ destroy() {}, getBytes: () => new Uint8Array() }),
      },
    ],
  };
}

beforeEach(() => {
  __resetPluginRegistryForTests();
});

describe('le registre des greffons', () => {
  it('résout un éditeur par extension, sans se soucier de la casse', () => {
    registerPlugin(greffon('texte', ['md', 'txt']));

    expect(editorForFileName('notes.MD')?.contribution.id).toBe('texte-editor');
    expect(editorForFileName('journal.txt')?.contribution.id).toBe('texte-editor');
    expect(editorForFileName('photo.png')).toBeNull();
  });

  it('REFUSE un greffon non-builtin — le bac à sable n’existe pas encore', () => {
    // Servir du code tiers avec les octets déchiffrés serait un mensonge de
    // sécurité ; le refus est le contrat, pas une limitation temporaire tue.
    const tiers = greffon('tiers', ['xyz']);
    tiers.manifest.trust = 'sandboxed';

    expect(() => registerPlugin(tiers)).toThrow(PluginRegistrationError);
    expect(editorForFileName('a.xyz')).toBeNull();
  });

  /**
   * DÉCISION CHANGÉE, DÉLIBÉRÉMENT.
   *
   * Ce test figeait le refus : deux greffons sur la même extension =
   * PluginRegistrationError. La conséquence était qu'aucun éditeur markdown ne
   * pouvait EXISTER — `.md` appartient au greffon texte du cœur — et que le
   * refus était ATOMIQUE, donc le greffon tiers était rejeté en bloc, y compris
   * pour les extensions que personne ne revendiquait.
   *
   * Le registre accepte désormais plusieurs candidats, ORDONNÉS. Ce qui n'a pas
   * changé, et que les assertions ci-dessous tiennent : le défaut reste celui
   * d'avant — le builtin ouvre.
   */
  it('accepte un SECOND candidat sur la même extension, sans changer le défaut', () => {
    registerPlugin(greffon('premier', ['md']));
    expect(() => registerPlugin(greffon('second', ['md']))).not.toThrow();

    expect(editorsForFileName('note.md')).toHaveLength(2);
    // Le premier arrivé reste celui qui ouvre : aucun utilisateur ne voit son
    // comportement changer parce qu'il a installé quelque chose.
    expect(editorForFileName('note.md')?.contribution.id).toBe('premier-editor');
  });

  it('refuse qu’un MÊME greffon revendique deux fois la même extension', () => {
    // Là, rien ne peut départager sensément : c'est un bogue de configuration,
    // pas une préférence.
    const bogue = greffon('bogue', ['md']);
    bogue.editors = [...(bogue.editors ?? []), ...(bogue.editors ?? [])];
    expect(() => registerPlugin(bogue)).toThrow(PluginRegistrationError);
  });

  it('refuse un identifiant déjà pris', () => {
    registerPlugin(greffon('unique', ['aaa']));
    expect(() => registerPlugin(greffon('unique', ['bbb']))).toThrow(PluginRegistrationError);
  });

  it('sépare le format NATIF de ce qu’un éditeur sait IMPORTER', () => {
    // L'éditeur de documents revendique `.fdoc` et sait importer `.docx` : le
    // docx garde son aperçu lecture seule, mais le geste « ouvrir dans
    // l'éditeur » sait vers qui router.
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));

    expect(editorForFileName('rapport.fdoc')?.contribution.id).toBe('docs-editor');
    expect(editorForFileName('rapport.docx')).toBeNull();
    expect(importerForFileName('rapport.docx')?.contribution.id).toBe('docs-editor');
  });

  it('liste ce qui est enregistré', () => {
    registerPlugin(greffon('a', ['a1']));
    registerPlugin(greffon('b', ['b1']));
    expect(
      listPlugins()
        .map((p) => p.manifest.id)
        .sort()
    ).toEqual(['a', 'b']);
  });
});

describe('la seconde porte : registerSandboxedPlugin', () => {
  const source = {
    manifest: {
      id: 'sbx-demo',
      name: 'Démo',
      version: '0.1.0',
      trust: 'sandboxed' as const,
      provides: { editors: [{ id: 'pad', extensions: ['sbx'], displayName: 'Ouvrir' }] },
    },
    code: '(()=>{})()',
  };

  it('enregistre, résout par extension, et le provider se dit sandboxed', () => {
    registerSandboxedPlugin(source);
    const provider = editorForFileName('essai.sbx');
    expect(provider).not.toBeNull();
    expect(trustOfProvider(provider!)).toBe('sandboxed');
  });

  it('un provider builtin se dit builtin', () => {
    registerPlugin({
      manifest: {
        id: 'b1',
        name: 'B',
        version: '1',
        trust: 'builtin',
        provides: { editors: [] },
      },
      editors: [
        {
          contribution: { id: 'e', extensions: ['bui'], displayName: 'x' },
          mount: () => ({ destroy() {}, getBytes: () => new Uint8Array(0) }),
        },
      ],
    });
    expect(trustOfProvider(editorForFileName('a.bui')!)).toBe('builtin');
  });

  it('REFUSE un manifest builtin par cette porte — et registerPlugin refuse toujours sandboxed', () => {
    expect(() =>
      registerSandboxedPlugin({
        ...source,
        manifest: { ...source.manifest, id: 'autre', trust: 'builtin' as never },
      })
    ).toThrow(PluginRegistrationError);
    expect(() =>
      registerSandboxedPlugin({ ...source, manifest: { ...source.manifest, id: 'vide' }, code: '' })
    ).toThrow(PluginRegistrationError);
  });

  it('un builtin qui revendique la même extension qu’un sandboxé passe DEVANT lui', () => {
    // L'ordre est par RÉGIME, pas par ordre d'arrivée : le sandboxé était là en
    // premier, et le builtin devient quand même le défaut. C'est ce qui garantit
    // qu'installer un greffon tiers ne peut jamais détourner un format que le
    // cœur sait ouvrir.
    registerSandboxedPlugin(source);
    expect(() =>
      registerPlugin({
        manifest: {
          id: 'voleur',
          name: 'V',
          version: '1',
          trust: 'builtin',
          provides: { editors: [] },
        },
        editors: [
          {
            contribution: { id: 'e', extensions: ['sbx'], displayName: 'x' },
            mount: () => ({ destroy() {}, getBytes: () => new Uint8Array(0) }),
          },
        ],
      })
    ).not.toThrow();

    expect(editorsForFileName('a.sbx')).toHaveLength(2);
    expect(trustOfProvider(editorForFileName('a.sbx')!)).toBe('builtin');
  });

  it('ATOMIQUE : une collision INTERNE ne laisse RIEN derrière', () => {
    /**
     * Le vrai dégât n'était pas le refus, c'était ce qu'il abandonnait.
     * L'indexation écrivait au fil de la boucle : « libre » se retrouvait
     * indexée vers un provider dont le plugin n'était PAS enregistré — une
     * extension qui résolvait vers un éditeur fantôme, qu'aucune
     * désinstallation ne pouvait retirer (unregisterSandboxedPlugin ne connaît
     * que les plugins enregistrés). Le fichier `.libre` d'un utilisateur
     * s'ouvrait alors sur un pont mort, définitivement.
     */
    registerSandboxedPlugin(source); // revendique '.sbx'
    // Un greffon qui se marche dessus : deux contributions sur '.double', plus
    // une extension libre. Le refus doit être TOTAL — c'est '.libre' qui ne
    // doit rien garder.
    const glouton = {
      manifest: {
        id: 'glouton',
        name: 'Glouton',
        version: '1.0.0',
        trust: 'sandboxed' as const,
        provides: {
          editors: [
            { id: 'e', extensions: ['libre', 'double'], displayName: 'Glouton' },
            { id: 'f', extensions: ['double'], displayName: 'Glouton bis' },
          ],
        },
      },
      code: '(()=>{})()',
    };

    expect(() => registerSandboxedPlugin(glouton)).toThrow(PluginRegistrationError);
    // Ni l'extension libre, ni l'id : le registre est EXACTEMENT comme avant.
    expect(editorForFileName('a.libre')).toBeNull();
    expect(editorForFileName('a.double')).toBeNull();
    expect(listPlugins().map((p) => p.manifest.id)).toEqual(['sbx-demo']);
    // Et la place reste prenable par un plugin honnête.
    expect(() =>
      registerSandboxedPlugin({
        ...glouton,
        manifest: {
          ...glouton.manifest,
          id: 'honnete',
          provides: { editors: [{ id: 'e', extensions: ['libre'], displayName: 'Honnête' }] },
        },
      })
    ).not.toThrow();
    expect(editorForFileName('a.libre')?.contribution.id).toBe('e');
  });

  it('un builtin second sur une extension prise s’ajoute, sans rien perdre au passage', () => {
    registerPlugin({
      manifest: {
        id: 'premier',
        name: 'P',
        version: '1',
        trust: 'builtin',
        provides: { editors: [] },
      },
      editors: [
        {
          contribution: { id: 'e1', extensions: ['pris'], displayName: 'x' },
          mount: () => ({ destroy() {}, getBytes: () => new Uint8Array(0) }),
        },
      ],
    });

    const collision = {
      manifest: {
        id: 'second',
        name: 'S',
        version: '1',
        trust: 'builtin' as const,
        provides: { editors: [] },
      },
      editors: [
        {
          contribution: { id: 'e2', extensions: ['neuf', 'pris'], displayName: 'x' },
          mount: () => ({ destroy() {}, getBytes: () => new Uint8Array(0) }),
        },
      ],
    };
    // '.pris' est deja revendiquee : ce n'est plus un refus, c'est un second
    // candidat. Et '.neuf', que personne ne revendiquait, est bien enregistree
    // — c'est precisement ce que le refus ATOMIQUE faisait perdre autrefois.
    expect(() => registerPlugin(collision)).not.toThrow();
    expect(editorForFileName('a.neuf')?.contribution.id).toBe('e2');
    expect(editorsForFileName('a.pris')).toHaveLength(2);
    // Le premier arrive garde le defaut : deux builtins se departagent par
    // l'ordre d'enregistrement.
    expect(editorForFileName('a.pris')?.contribution.id).toBe('e1');
    expect(listPlugins().map((p) => p.manifest.id)).toEqual(['premier', 'second']);

    // Deux contributions du MÊME plugin sur la même extension : même verdict,
    // et rien n'est laissé derrière.
    expect(() =>
      registerSandboxedPlugin({
        manifest: {
          id: 'jumeau',
          name: 'J',
          version: '1',
          trust: 'sandboxed',
          provides: {
            editors: [
              { id: 'a', extensions: ['double'], displayName: 'A' },
              { id: 'b', extensions: ['double'], displayName: 'B' },
            ],
          },
        },
        code: '(()=>{})()',
      })
    ).toThrow(PluginRegistrationError);
    expect(editorForFileName('a.double')).toBeNull();
    // « second » s'est enregistré (il n'entrait en conflit avec personne au
    // sens interne) ; « jumeau », lui, n'a rien laissé derrière.
    expect(listPlugins().map((p) => p.manifest.id)).toEqual(['premier', 'second']);
  });

  it('registeredEditorExtensions recense ce que le menu « Nouveau document » peut offrir', () => {
    registerSandboxedPlugin(source); // '.sbx' → « Ouvrir »
    registerPlugin(greffon('texte', ['md', 'txt']));
    expect(registeredEditorExtensions()).toEqual([
      { ext: 'md', displayName: 'texte' },
      { ext: 'sbx', displayName: 'Ouvrir' },
      { ext: 'txt', displayName: 'texte' },
    ]);
    // Les IMPORTS ne sont pas des formats natifs : on ne propose pas de créer
    // un .docx vide sous prétexte que l'éditeur sait en ouvrir un.
    __resetPluginRegistryForTests();
    registerPlugin(greffon('docs', ['fdoc'], ['docx']));
    expect(registeredEditorExtensions().map((e) => e.ext)).toEqual(['fdoc']);
  });

  it('__resetPluginRegistryForTests nettoie les deux portes', () => {
    registerSandboxedPlugin(source);
    __resetPluginRegistryForTests();
    expect(editorForFileName('essai.sbx')).toBeNull();
    // Ré-enregistrable après reset — l'id n'est plus pris.
    expect(() => registerSandboxedPlugin(source)).not.toThrow();
  });
});

/**
 * LE PLAFOND D'OUVERTURE — l'aperçu avait sa garde, l'éditeur n'en avait
 * aucune. Un fichier trop gros ouvrait un éditeur qui gardait tout le clair en
 * état React, et le rendu gelait sans qu'aucun message ne l'annonce.
 */
describe('editorAcceptsSize', () => {
  const provider = (maxBytes?: number): EditorProvider => ({
    contribution: { id: 'x', extensions: ['x'], displayName: 'x', maxBytes },
    mount: () => ({ destroy: () => undefined, getBytes: () => new Uint8Array() }),
  });

  it('accepte en dessous du plafond du cœur', () => {
    expect(editorAcceptsSize(provider(), 1024)).toBe(true);
  });

  it('refuse au-dessus du plafond du cœur', () => {
    expect(editorAcceptsSize(provider(), MAX_EDITOR_FILE_SIZE + 1)).toBe(false);
  });

  it('accepte PILE au plafond — la borne est inclusive', () => {
    expect(editorAcceptsSize(provider(), MAX_EDITOR_FILE_SIZE)).toBe(true);
  });

  it('un greffon peut déclarer son PROPRE plafond, plus haut ou plus bas', () => {
    expect(editorAcceptsSize(provider(10), 11)).toBe(false);
    expect(editorAcceptsSize(provider(MAX_EDITOR_FILE_SIZE * 4), MAX_EDITOR_FILE_SIZE * 2)).toBe(
      true
    );
  });

  it('une taille INCONNUE passe — on ne refuse que sur une mesure', () => {
    // Refuser faute de mesure fermerait l'éditeur sur des fichiers
    // parfaitement ouvrables, pour une donnée qui manque souvent.
    expect(editorAcceptsSize(provider(), undefined)).toBe(true);
    expect(editorAcceptsSize(provider(), Number.NaN)).toBe(true);
    expect(editorAcceptsSize(provider(), -1)).toBe(true);
  });
});

describe('ce que « Nouveau document » a le droit de proposer', () => {
  /**
   * LA RÉGRESSION QUE CE BLOC EXISTE POUR EMPÊCHER.
   *
   * Le menu a été dérivé de `registeredEditorExtensions()` — TOUTE extension
   * ouvrable. Le jour où l'éditeur de code en a revendiqué une quarantaine, le
   * menu est passé de deux entrées à une cinquantaine, dont « texte (.txt) ».
   * Et comme la création écrivait zéro octet, le fichier neuf s'ouvrait vide :
   * indiscernable, pour qui le relit, d'un fichier vidé de son contenu.
   */
  it('ne propose QUE ce qui est déclaré, jamais les extensions ouvrables', () => {
    registerPlugin(greffonCreable('code', ['js', 'py', 'kt', 'yaml'], []));

    expect(registeredEditorExtensions().map((f) => f.ext)).toEqual(['js', 'kt', 'py', 'yaml']);
    // Ouvrables, oui. Créables, non — et c’est le défaut.
    expect(newDocumentFormats()).toEqual([]);
  });

  it('rend les formats déclarés, triés par libellé', () => {
    registerPlugin(
      greffonCreable(
        'texte',
        ['txt', 'md', 'log'],
        [
          { ext: 'txt', label: 'Texte brut' },
          { ext: 'md', label: 'Markdown' },
        ]
      )
    );

    expect(newDocumentFormats().map((f) => `${f.label}/${f.ext}`)).toEqual([
      'Markdown/md',
      'Texte brut/txt',
    ]);
  });

  it('n’offre pas deux fois la même extension', () => {
    registerPlugin(greffonCreable('a', ['md'], [{ ext: 'md', label: 'Markdown A' }]));
    registerPlugin(greffonCreable('b', ['md'], [{ ext: 'md', label: 'Markdown B' }]));

    // Deux entrées identiques dans un menu ne diraient pas laquelle on obtient.
    expect(newDocumentFormats()).toHaveLength(1);
    expect(newDocumentFormats()[0].label).toBe('Markdown A');
  });

  it('porte la graine jusqu’à l’appelant', async () => {
    const graine = new TextEncoder().encode('BEGIN:VCALENDAR');
    registerPlugin(
      greffonCreable('ics', ['ics'], [{ ext: 'ics', label: 'Calendrier', seed: () => graine }])
    );

    const format = newDocumentFormats()[0];
    expect(await format.seed!()).toBe(graine);
  });
});
