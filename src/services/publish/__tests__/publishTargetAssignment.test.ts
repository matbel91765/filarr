/**
 * L'ASSIGNATION DU PROFIL CIBLE — et surtout sa REPRISE.
 *
 * Le défaut que ces tests verrouillent a été constaté sur appareil réel : une
 * migration interrompue puis reprise re-tirait la cible au sort (la sonde
 * d'occupation voyait la place prise… par la première manche elle-même), et le
 * compte se retrouvait avec DEUX profils cibles dont un seul entièrement
 * prouvé. La règle est donc : UNE DÉCISION CONSIGNÉE AU JOURNAL N'EST JAMAIS
 * REJOUÉE — ni la sonde distante, ni le tirage d'UUID ne sont même consultés.
 * Les ports LÈVENT ici pour que le test échoue si ce branchement disparaît.
 */

import { assignTargets, type AssignTargetsPorts } from '../../../../electron/publish/targetProfile';
import { describe, it, expect } from 'vitest';

/** Ports qui LÈVENT : la preuve que la décision du journal suffit. */
function forbiddenPorts(): AssignTargetsPorts {
  return {
    remoteManifestIsNull: async (profileId: string) => {
      throw new Error(`sonde distante consultée pour ${profileId} malgré le journal`);
    },
    mintUuid: () => {
      throw new Error('UUID re-tiré au sort malgré le journal');
    },
  };
}

const DEVICE = 'Poste-Bureau';

describe('assignTargets — la reprise ne re-tire JAMAIS la cible au sort', () => {
  it('A1 — un profil déjà consigné reprend SA cible, sans sonde ni tirage', async () => {
    const targets = await assignTargets(
      {
        profiles: [{ id: 'affb7e4f', name: 'Mathis' }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map([
          ['affb7e4f', { targetProfileId: '287064a4', targetName: 'Mathis (2)' }],
        ]),
        occupiedNames: ['Mathis'],
        complete: true,
        deviceName: DEVICE,
      },
      forbiddenPorts()
    );

    expect(targets['affb7e4f']).toEqual({
      targetProfileId: '287064a4',
      targetName: 'Mathis (2)',
    });
  });

  it('A1bis — même quand le manifeste distant du local n est PLUS nul (occupé par nous-mêmes)', async () => {
    // Le scénario exact de la panne : la première manche a poussé un manifeste,
    // la sonde verrait donc « occupé » et frapperait un uuid NEUF. Le journal
    // doit couper court AVANT la sonde.
    const ports: AssignTargetsPorts = {
      remoteManifestIsNull: async () => false, // la place est prise… par nous
      mintUuid: () => {
        throw new Error('un second profil cible allait être semé');
      },
    };
    const targets = await assignTargets(
      {
        profiles: [{ id: 'p-local', name: 'Coffre' }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map([
          ['p-local', { targetProfileId: 'p-local', targetName: 'Coffre' }],
        ]),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
      },
      ports
    );
    expect(targets['p-local'].targetProfileId).toBe('p-local');
  });

  it('A2 — sans décision antérieure et place LIBRE, l identifiant local est réutilisé', async () => {
    const targets = await assignTargets(
      {
        profiles: [{ id: 'p-libre', name: 'Perso' }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map(),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
      },
      {
        remoteManifestIsNull: async () => true,
        mintUuid: () => {
          throw new Error('aucun uuid ne doit être frappé quand la place est libre');
        },
      }
    );
    expect(targets['p-libre']).toEqual({ targetProfileId: 'p-libre', targetName: 'Perso' });
  });

  it('A3 — sans décision antérieure et place OCCUPÉE, un uuid neuf est frappé et le nom désambiguïsé', async () => {
    const targets = await assignTargets(
      {
        profiles: [{ id: 'p-occupe', name: 'Mathis' }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map(),
        occupiedNames: ['Mathis'],
        complete: true,
        deviceName: DEVICE,
      },
      {
        remoteManifestIsNull: async () => false,
        mintUuid: () => 'uuid-neuf-1',
      }
    );
    expect(targets['p-occupe']).toEqual({
      targetProfileId: 'uuid-neuf-1',
      targetName: 'Mathis (2)',
    });
  });

  it('A4 — un profil NEUF ne peut pas prendre le nom d une cible déjà consignée', async () => {
    const targets = await assignTargets(
      {
        profiles: [
          { id: 'p-ancien', name: 'Coffre' },
          { id: 'p-nouveau', name: 'Coffre (2)' },
        ],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map([
          ['p-ancien', { targetProfileId: 't-ancien', targetName: 'Coffre (2)' }],
        ]),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
      },
      {
        remoteManifestIsNull: async (id) => id === 'p-nouveau',
        mintUuid: () => 'uuid-neuf-2',
      }
    );
    // Le nom consigné « Coffre (2) » compte parmi les noms pris : le nouveau
    // profil est repoussé plus loin au lieu de créer un homonyme.
    expect(targets['p-ancien'].targetName).toBe('Coffre (2)');
    expect(targets['p-nouveau'].targetName).toBe('Coffre (2) (2)');
  });

  it('A5 — un profil abandonné n est ni sondé, ni assigné', async () => {
    const targets = await assignTargets(
      {
        profiles: [{ id: 'p-abandonne', name: 'Archives' }],
        abandonedProfileIds: new Set(['p-abandonne']),
        previousAssignments: new Map(),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
      },
      forbiddenPorts()
    );
    expect(targets).toEqual({});
  });

  it('A6 — un profil ORPHELIN sans renommage reçoit un nom reconstruit, un renommage le remplace', async () => {
    const ports: AssignTargetsPorts = {
      remoteManifestIsNull: async () => true,
      mintUuid: () => 'jamais',
    };
    const orphan = await assignTargets(
      {
        profiles: [{ id: 'abcdef12', name: '', orphan: true }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map(),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
      },
      ports
    );
    expect(orphan['abcdef12'].targetName).toBe('Coffre retrouvé (abcdef)');

    const renamed = await assignTargets(
      {
        profiles: [{ id: 'abcdef12', name: '', orphan: true }],
        abandonedProfileIds: new Set(),
        previousAssignments: new Map(),
        occupiedNames: [],
        complete: true,
        deviceName: DEVICE,
        renames: { abcdef12: 'Mon vieux coffre' },
      },
      ports
    );
    expect(renamed['abcdef12'].targetName).toBe('Mon vieux coffre');
  });
});
