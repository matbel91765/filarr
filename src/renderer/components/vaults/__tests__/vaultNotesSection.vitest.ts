/**
 * Le modèle PUR de la section « Coffres partagés » de l'onglet Notes.
 *
 *   npx vitest run src/renderer/components/vaults/__tests__/vaultNotesSection.vitest.ts
 *
 * CE QUE CE FICHIER GARDE, et pourquoi ça ne se voit pas à la compilation : la
 * section traduit un état à TROIS inconnues (le coffre est-il ouvert ? sa liste
 * est-elle arrivée ? ce qu'elle contient s'est-il déchiffré ?) en une phrase
 * montrée à quelqu'un. Chacune de ces inconnues peut valoir « je ne sais pas »,
 * et la faute qu'on ferme ici est TOUJOURS la même : rendre « aucune note » pour
 * un silence. Un coffre verrouillé, une liste pas encore lue, une méta illisible,
 * une époque de clé manquante — quatre situations où il y a peut-être des notes,
 * et où prétendre qu'il n'y en a pas est un mensonge que l'utilisateur croit (il
 * referme la section et n'y revient jamais).
 *
 * C'est le principe « terminal ≠ jetable » du parcours d'invitation, appliqué à
 * une liste : ne jamais dériver un verdict définitif d'une absence d'information.
 */

import { describe, it, expect } from 'vitest';
import { buildVaultNotesSection, type VaultNotesSectionInput } from '../vaultNotesSection';

const UNTITLED = 'Sans titre';

/** Un coffre ouvert, à jour, dont la liste est arrivée — le cas nominal. */
function coffre(over: Partial<VaultNotesSectionInput['vaults'][number]> = {}) {
  return {
    vaultId: 'v1',
    name: 'Équipe',
    unlocked: true,
    currentKeyEpoch: 1,
    wrappedVaultKeyEpoch: 1,
    ...over,
  };
}

function note(over: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    itemType: 'note',
    updatedAt: '2026-08-20T10:00:00.000Z',
    meta: { title: 'Compte rendu' },
    ...over,
  } as VaultNotesSectionInput['itemsByVault'][string][number];
}

function entree(over: Partial<VaultNotesSectionInput> = {}): VaultNotesSectionInput {
  return {
    vaults: [coffre()],
    itemsByVault: { v1: [note()] },
    loadedVaultIds: ['v1'],
    decryptStatusByVault: {},
    untitledLabel: UNTITLED,
    ...over,
  };
}

describe('buildVaultNotesSection — les groupes', () => {
  it('un coffre ouvert rend un groupe avec ses notes', () => {
    const s = buildVaultNotesSection(entree());
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].state).toBe('ready');
    expect(s.groups[0].vaultName).toBe('Équipe');
    expect(s.groups[0].rows).toEqual([
      {
        vaultId: 'v1',
        itemId: 'i1',
        title: 'Compte rendu',
        updatedAt: '2026-08-20T10:00:00.000Z',
      },
    ]);
    expect(s.noteCount).toBe(1);
  });

  it('une note sans titre porte le libellé fourni, jamais une chaîne vide', () => {
    const s = buildVaultNotesSection(
      entree({ itemsByVault: { v1: [note({ meta: { title: '   ' } })] } })
    );
    expect(s.groups[0].rows[0].title).toBe(UNTITLED);
  });

  it('les notes les plus récemment modifiées viennent en tête', () => {
    const s = buildVaultNotesSection(
      entree({
        itemsByVault: {
          v1: [
            note({ id: 'vieux', updatedAt: '2026-08-01T00:00:00.000Z' }),
            note({ id: 'neuf', updatedAt: '2026-08-29T00:00:00.000Z' }),
          ],
        },
      })
    );
    expect(s.groups[0].rows.map((r) => r.itemId)).toEqual(['neuf', 'vieux']);
  });

  it('les groupes sont ordonnés par nom, les coffres sans nom en dernier', () => {
    const s = buildVaultNotesSection(
      entree({
        vaults: [
          coffre({ vaultId: 'c', name: 'Zèbre' }),
          coffre({ vaultId: 'b', name: '', unlocked: false }),
          coffre({ vaultId: 'a', name: 'Alpha' }),
        ],
        itemsByVault: {},
        loadedVaultIds: ['c', 'a'],
      })
    );
    expect(s.groups.map((g) => g.vaultId)).toEqual(['a', 'c', 'b']);
  });
});

describe('buildVaultNotesSection — ce qui n’est PAS une note de l’utilisateur', () => {
  it('un marqueur de dossier est un itemType `note` — il ne s’affiche jamais', () => {
    const s = buildVaultNotesSection(
      entree({
        itemsByVault: {
          v1: [note({ id: 'dossier', meta: { title: 'Contrats', folderMarker: true } })],
        },
      })
    );
    expect(s.groups[0].rows).toEqual([]);
    expect(s.groups[0].state).toBe('empty');
  });

  it('un fil de discussion de fichier est un itemType `note` — il ne s’affiche jamais', () => {
    const s = buildVaultNotesSection(
      entree({
        itemsByVault: {
          v1: [note({ id: 'fil', meta: { title: 'Fil', threadFor: 'autre-item' } })],
        },
      })
    );
    expect(s.groups[0].rows).toEqual([]);
  });

  it('un FICHIER n’est pas une note', () => {
    const s = buildVaultNotesSection(
      entree({ itemsByVault: { v1: [note({ id: 'f', itemType: 'file' })] } })
    );
    expect(s.groups[0].rows).toEqual([]);
  });
});

describe('buildVaultNotesSection — ce qui ne se déchiffre pas ne se devine pas', () => {
  it('un coffre VERROUILLÉ ne dit jamais « aucune note »', () => {
    const s = buildVaultNotesSection(
      entree({ vaults: [coffre({ unlocked: false })], itemsByVault: {}, loadedVaultIds: [] })
    );
    expect(s.groups[0].state).toBe('locked');
    expect(s.groups[0].rows).toEqual([]);
  });

  it('une époque de clé en retard se distingue d’un simple verrou', () => {
    // Le cadenas ordinaire conseille « déverrouillez votre compte » — un conseil
    // que cette personne peut suivre indéfiniment sans que rien ne change : ce
    // n'est pas son compte qui est fermé, c'est sa clé qui n'a pas été
    // renouvelée après une rotation.
    const s = buildVaultNotesSection(
      entree({
        vaults: [coffre({ unlocked: false, currentKeyEpoch: 3, wrappedVaultKeyEpoch: 2 })],
        itemsByVault: {},
        loadedVaultIds: [],
      })
    );
    expect(s.groups[0].state).toBe('stale-epoch');
  });

  it('l’époque en retard l’emporte même si le coffre est encore ouvert par une clé ancienne', () => {
    const s = buildVaultNotesSection(
      entree({
        vaults: [coffre({ unlocked: true, currentKeyEpoch: 3, wrappedVaultKeyEpoch: 2 })],
      })
    );
    expect(s.groups[0].state).toBe('stale-epoch');
  });

  it('une liste PAS ENCORE LUE dit « en cours », jamais « aucune note »', () => {
    const s = buildVaultNotesSection(entree({ itemsByVault: {}, loadedVaultIds: [] }));
    expect(s.groups[0].state).toBe('loading');
  });

  it('zéro note lisible + des métas illisibles ⇒ on le DIT, on ne conclut pas au vide', () => {
    const s = buildVaultNotesSection(
      entree({ itemsByVault: { v1: [] }, decryptStatusByVault: { v1: { undecryptable: 2 } } })
    );
    expect(s.groups[0].state).toBe('undecryptable');
    expect(s.groups[0].undecryptable).toBe(2);
  });

  it('des notes lisibles ET des métas illisibles : on montre les unes en avertissant des autres', () => {
    const s = buildVaultNotesSection(
      entree({ decryptStatusByVault: { v1: { undecryptable: 1 } } })
    );
    expect(s.groups[0].state).toBe('ready');
    expect(s.groups[0].rows).toHaveLength(1);
    expect(s.groups[0].undecryptable).toBe(1);
  });

  it('« aucune note » n’est rendu QUE sur une liste lue, ouverte et intégralement déchiffrée', () => {
    const s = buildVaultNotesSection(
      entree({ itemsByVault: { v1: [] }, decryptStatusByVault: { v1: { undecryptable: 0 } } })
    );
    expect(s.groups[0].state).toBe('empty');
  });
});

describe('buildVaultNotesSection — l’existence même de la section', () => {
  it('sans aucun coffre, il n’y a pas de section (règle 13 : hors nuage, rien de tout cela)', () => {
    const s = buildVaultNotesSection(entree({ vaults: [], itemsByVault: {}, loadedVaultIds: [] }));
    expect(s.hasSection).toBe(false);
    expect(s.groups).toEqual([]);
  });

  it('un seul coffre, fût-il verrouillé, suffit à faire exister la section', () => {
    const s = buildVaultNotesSection(
      entree({ vaults: [coffre({ unlocked: false })], itemsByVault: {}, loadedVaultIds: [] })
    );
    expect(s.hasSection).toBe(true);
  });

  it('le compte affiché n’additionne que des notes RÉELLEMENT lisibles', () => {
    const s = buildVaultNotesSection(
      entree({
        vaults: [coffre({ vaultId: 'v1' }), coffre({ vaultId: 'v2', name: 'B', unlocked: false })],
        itemsByVault: { v1: [note(), note({ id: 'i2' })] },
        loadedVaultIds: ['v1'],
        decryptStatusByVault: { v1: { undecryptable: 5 } },
      })
    );
    expect(s.noteCount).toBe(2);
  });
});

// ==================== L'ÉCHEC DE CHARGEMENT ====================

describe('un chargement qui ÉCHOUE ne reste pas « en cours »', () => {
  it('LA GARDE : un coffre dont la lecture a échoué sort de l’état « chargement »', () => {
    /**
     * ── LE DÉFAUT QUE CE TEST FERME ───────────────────────────────────────
     *
     * `loadVaultItems` avait un `.fulfilled` et AUCUN `.rejected`. Un échec
     * n'écrivait donc rien : le coffre restait absent de `itemsByVault`, et
     * `etatDuCoffre` — qui déduit « chargé » de cette seule présence —
     * répondait « chargement » pour toujours. L'écran affichait
     * « Chargement des notes… » indéfiniment, sans délai ni issue.
     *
     * C'est le miroir de la leçon des invitations (« terminal ≠ jetable ») :
     * là on tirait un verdict définitif d'une absence d'information ; ici on
     * présentait un état TRANSITOIRE pour une situation dont on ne sortait
     * jamais.
     */
    const section = buildVaultNotesSection(
      entree({ vaults: [coffre()], itemsByVault: {}, loadedVaultIds: [], failedVaultIds: ['v1'] })
    );
    expect(section.groups[0].state).toBe('failed');
  });

  it('sans échec déclaré, l’état reste « chargement » — rien n’a changé pour le cas normal', () => {
    const section = buildVaultNotesSection(
      entree({ vaults: [coffre()], itemsByVault: {}, loadedVaultIds: [] })
    );
    expect(section.groups[0].state).toBe('loading');
  });

  it('LE VERROU PASSE AVANT L’ÉCHEC, et c’est délibéré', () => {
    // Un coffre verrouillé échoue forcément : dire « échec » plutôt que
    // « verrouillé » enverrait chercher une panne là où il suffit de saisir un
    // mot de passe. C'est le pire message possible, parce qu'il est vrai.
    const section = buildVaultNotesSection(
      entree({
        vaults: [coffre({ unlocked: false })],
        itemsByVault: {},
        loadedVaultIds: [],
        failedVaultIds: ['v1'],
      })
    );
    expect(section.groups[0].state).toBe('locked');
  });

  it('une époque en retard passe avant l’échec aussi', () => {
    const section = buildVaultNotesSection(
      entree({
        vaults: [coffre({ wrappedVaultKeyEpoch: 1, currentKeyEpoch: 2 })],
        itemsByVault: {},
        loadedVaultIds: [],
        failedVaultIds: ['v1'],
      })
    );
    expect(section.groups[0].state).toBe('stale-epoch');
  });

  it('un échec sur un AUTRE coffre ne contamine pas celui-ci', () => {
    const section = buildVaultNotesSection(
      entree({
        vaults: [coffre()],
        itemsByVault: {},
        loadedVaultIds: [],
        failedVaultIds: ['autre'],
      })
    );
    expect(section.groups[0].state).toBe('loading');
  });

  it('un coffre CHARGÉ puis marqué en échec montre l’échec, pas ses lignes périmées', () => {
    // Les lignes d'une lecture précédente promettraient une ouverture qui
    // échouera — c'est la même règle que pour l'époque en retard, écrite dans
    // `buildVaultNotesSection`.
    const section = buildVaultNotesSection(
      entree({
        vaults: [coffre()],
        itemsByVault: { v1: [note()] },
        loadedVaultIds: ['v1'],
        failedVaultIds: ['v1'],
      })
    );
    expect(section.groups[0].state).toBe('failed');
    expect(section.groups[0].rows).toEqual([]);
  });
});
