/**
 * LE DÉPLACEMENT D'IDENTITÉ — répertoire, registre, profil actif : TOUT, ou
 * la bascule ne conclut pas.
 *
 * La panne que ces tests verrouillent : après la bascule, la clé du compte est
 * active mais le profil actif garde l'ANCIEN identifiant — dont la copie nuage
 * dort sous l'ANCIENNE clé. Le cycle lit, échoue, et conclut « clé forkée ».
 * Trois chemins y menaient : un `rename` avalé (log puis poursuite), une mort
 * entre le renommage et l'écriture du registre jamais réparée, et un crochet
 * optionnel jamais fourni. Les trois sont fermés ici, par morts simulées.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  relocatePublishedProfiles,
  type RelocatableRegistry,
  type RelocationPorts,
} from '../../../../electron/publish/profileRelocation';
import type { PublishTargetProfile } from '../../../../electron/publish/types';
import { describe, it, expect } from 'vitest';

function target(patch: Partial<PublishTargetProfile> = {}): PublishTargetProfile {
  return {
    localProfileId: 'ancien-id',
    targetProfileId: 'nouvel-id',
    targetName: 'Mathis (2)',
    itemCount: 3,
    byteCount: 300,
    notesBundle: false,
    relocated: true,
    ...patch,
  };
}

function registry(patch: Partial<RelocatableRegistry> = {}): RelocatableRegistry {
  return {
    activeProfileId: 'ancien-id',
    profiles: [{ id: 'ancien-id', name: 'Mathis' }],
    ...patch,
  };
}

/** Ports sur VRAI disque, registre en mémoire, écritures comptées. */
function realFsPorts(
  root: string,
  reg: RelocatableRegistry | null
): RelocationPorts & { renames: Array<[string, string]>; writes: number } {
  const ports: RelocationPorts & { renames: Array<[string, string]>; writes: number } = {
    renames: [],
    writes: 0,
    profileDir: (id: string) => path.join(root, 'profiles', id),
    dirExists: (dir: string) =>
      fs
        .access(dir)
        .then(() => true)
        .catch(() => false),
    renameDir: async (from: string, to: string) => {
      await fs.rename(from, to);
      ports.renames.push([from, to]);
    },
    readRegistry: async () => reg,
    writeRegistry: async () => {
      ports.writes += 1;
    },
  };
  return ports;
}

async function makeVault(profileIds: string[]): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'filarr-reloc-'));
  for (const id of profileIds) {
    const dir = path.join(root, 'profiles', id);
    await fs.mkdir(dir, { recursive: true });
    // La copie de clé PAR-PROFIL, déjà promue par S4 : elle doit VOYAGER.
    await fs.writeFile(path.join(dir, 'wrapped_fek.json'), 'CLE-DU-COMPTE');
    await fs.writeFile(path.join(dir, 'blob.enc'), 'contenu');
  }
  return root;
}

describe('relocatePublishedProfiles — le déplacement fait TOUT', () => {
  it('R1 — répertoire déplacé AVEC sa copie de clé, entrée de registre et profil actif réécrits', async () => {
    const root = await makeVault(['ancien-id']);
    const reg = registry();
    const ports = realFsPorts(root, reg);

    const report = await relocatePublishedProfiles([target()], ports);

    // Le répertoire est au nouvel emplacement, l'ancien n'existe plus…
    await expect(fs.access(path.join(root, 'profiles', 'ancien-id'))).rejects.toBeTruthy();
    // …et la copie de clé par-profil a voyagé avec lui, contenu compris.
    const key = await fs.readFile(
      path.join(root, 'profiles', 'nouvel-id', 'wrapped_fek.json'),
      'utf-8'
    );
    expect(key).toBe('CLE-DU-COMPTE');
    // Le registre porte le NOUVEL identifiant, le nouveau nom, ET le profil
    // actif suit — c'est lui qui décide quelle copie nuage le cycle lira.
    expect(reg.profiles).toEqual([{ id: 'nouvel-id', name: 'Mathis (2)' }]);
    expect(reg.activeProfileId).toBe('nouvel-id');
    expect(report).toEqual({ movedDirs: ['ancien-id'], repairedRegistryIds: ['ancien-id'] });
  });

  it('R2 — B-R : une mort ENTRE le renommage et le registre se répare à la reprise', async () => {
    // Simulation de la mort : le répertoire est DÉJÀ au nouvel emplacement,
    // mais le registre pointe encore sur l'ancien identifiant. C'est
    // exactement l'état qui produisait « clé forkée » au démarrage suivant.
    const root = await makeVault(['nouvel-id']);
    const reg = registry();
    const ports = realFsPorts(root, reg);

    const report = await relocatePublishedProfiles([target()], ports);

    // Aucun renommage retenté (le répertoire cible fait foi)…
    expect(ports.renames).toEqual([]);
    // …mais le registre est RÉPARÉ — la moitié manquante du déplacement.
    expect(reg.profiles).toEqual([{ id: 'nouvel-id', name: 'Mathis (2)' }]);
    expect(reg.activeProfileId).toBe('nouvel-id');
    expect(report.repairedRegistryIds).toEqual(['ancien-id']);
  });

  it('R3 — un renommage qui échoue LÈVE et le registre n est PAS touché', async () => {
    const reg = registry();
    let wrote = false;
    const ports: RelocationPorts = {
      profileDir: (id) => `/vault/profiles/${id}`,
      dirExists: async (dir) => dir.endsWith('ancien-id'), // seul `from` existe
      renameDir: async () => {
        throw new Error('EPERM: répertoire verrouillé');
      },
      readRegistry: async () => reg,
      writeRegistry: async () => {
        wrote = true;
      },
    };

    await expect(relocatePublishedProfiles([target()], ports)).rejects.toThrow('EPERM');
    // Le registre pointe toujours sur l'ancien identifiant : identité et
    // répertoire restent COHÉRENTS entre eux, et la reprise rejouera le tout.
    expect(wrote).toBe(false);
    expect(reg.profiles[0].id).toBe('ancien-id');
    expect(reg.activeProfileId).toBe('ancien-id');
  });

  it('R4 — la passe est IDEMPOTENTE : une seconde exécution ne touche plus rien', async () => {
    const root = await makeVault(['ancien-id']);
    const reg = registry();

    const first = realFsPorts(root, reg);
    await relocatePublishedProfiles([target()], first);
    expect(first.renames.length).toBe(1);
    expect(first.writes).toBe(1);

    const second = realFsPorts(root, reg);
    const report = await relocatePublishedProfiles([target()], second);
    expect(second.renames).toEqual([]);
    expect(second.writes).toBe(0);
    expect(report).toEqual({ movedDirs: [], repairedRegistryIds: [] });
  });

  it('R5 — un profil NON déplacé n est pas touché, et une liste sans déplacement ne lit même pas le registre', async () => {
    let readCount = 0;
    const ports: RelocationPorts = {
      profileDir: (id) => `/vault/profiles/${id}`,
      dirExists: async () => {
        throw new Error('le disque ne doit pas être consulté');
      },
      renameDir: async () => {
        throw new Error('aucun renommage attendu');
      },
      readRegistry: async () => {
        readCount += 1;
        return registry();
      },
      writeRegistry: async () => {
        throw new Error('aucune écriture attendue');
      },
    };

    const report = await relocatePublishedProfiles(
      [target({ relocated: false, targetProfileId: 'ancien-id' })],
      ports
    );
    expect(report).toEqual({ movedDirs: [], repairedRegistryIds: [] });
    expect(readCount).toBe(0);
  });

  it('R6 — sans registre lisible (coffre hérité), le répertoire est quand même déplacé', async () => {
    const root = await makeVault(['ancien-id']);
    const ports = realFsPorts(root, null);

    const report = await relocatePublishedProfiles([target()], ports);

    expect(report.movedDirs).toEqual(['ancien-id']);
    expect(report.repairedRegistryIds).toEqual([]);
    await expect(
      fs.access(path.join(root, 'profiles', 'nouvel-id', 'wrapped_fek.json'))
    ).resolves.toBeUndefined();
  });

  it('R7 — aucun répertoire nulle part : la réparation du registre reste DUE', async () => {
    const reg = registry();
    let wrote = false;
    const ports: RelocationPorts = {
      profileDir: (id) => `/vault/profiles/${id}`,
      dirExists: async () => false,
      renameDir: async () => {
        throw new Error('rien à renommer');
      },
      readRegistry: async () => reg,
      writeRegistry: async () => {
        wrote = true;
      },
    };

    const report = await relocatePublishedProfiles([target()], ports);
    expect(wrote).toBe(true);
    expect(reg.profiles[0].id).toBe('nouvel-id');
    expect(report.repairedRegistryIds).toEqual(['ancien-id']);
  });
});

describe('le doublon adopté — l’artéfact exact du défaut D', () => {
  it('fusionne au lieu de renommer : jamais deux entrées au même identifiant', async () => {
    // Le registre porte DÉJÀ une entrée à l'identifiant cible, adoptée par
    // la découverte pendant la fenêtre de migration. Renommer l'entrée
    // locale par-dessus créerait deux entrées au même id — le sélecteur
    // montrerait deux fois le même coffre.
    const reg = registry({
      profiles: [
        { id: 'ancien-id', name: 'Mathis' },
        { id: 'nouvel-id', name: 'Mathis (2) — adopté' },
      ],
    });
    const root = await makeVault(['ancien-id', 'nouvel-id']);
    const ports = realFsPorts(root, reg);
    await relocatePublishedProfiles([target()], ports);

    // UNE seule entrée à l'identifiant cible, au nom de la cible.
    const atTarget = reg.profiles.filter((p) => p.id === 'nouvel-id');
    expect(atTarget).toHaveLength(1);
    expect(atTarget[0]?.name).toBe('Mathis (2)');
    expect(reg.profiles.some((p) => p.id === 'ancien-id')).toBe(false);
    // Le profil actif est re-pointé sur la cible.
    expect(reg.activeProfileId).toBe('nouvel-id');
    // Et AUCUN octet n'a bougé : les deux répertoires existent encore —
    // on ne fusionne jamais des données à l'aveugle.
    expect(ports.renames).toHaveLength(0);
    await expect(fs.access(path.join(root, 'profiles', 'ancien-id'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'profiles', 'nouvel-id'))).resolves.toBeUndefined();
  });
});
