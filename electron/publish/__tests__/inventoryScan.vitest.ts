/**
 * INVENTAIRE DE PUBLICATION — ce qui doit être ramassé à la racine d'un profil.
 *
 * LA PANNE VERROUILLÉE ICI. « Publier ce coffre sur le compte » reconstruit le
 * manifeste du profil CIBLE d'après ce seul inventaire (`pushTargetManifests`) :
 * ce qui n'y figure pas n'existe plus pour le compte. `layout.enc` en était
 * absent — un utilisateur qui publiait son coffre local PERDAIT sa mise en page,
 * et la perte était silencieuse (l'accueil repartait simplement « comme neuf »
 * sur tous ses appareils, ce qui ressemble à une réinitialisation voulue).
 *
 * Les deux cas comptent autant l'un que l'autre :
 *  · AVEC `layout.enc` : l'entrée est là, sous la même clé d'élément que celle
 *    du cycle ordinaire (`meta:layout`), avec le chemin relatif que le bureau
 *    saura relire (`layout.enc`) et la classe de clé `machine` (elle survit
 *    intacte à la bascule, ses octets partent tels quels) ;
 *  · SANS `layout.enc` (un profil qui n'a jamais rien personnalisé, le cas le
 *    plus courant) : AUCUNE entrée, aucun échec, aucun élément fantôme — un
 *    inventaire qui promettrait un fichier absent ferait échouer le transfert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import * as nodePath from 'path';

// ── Mocks (hissés) ──────────────────────────────────────────────────────────

const env = vi.hoisted(() => ({ userData: '' }));

const storage = vi.hoisted(() => ({
  readProfileMachineKey: vi.fn(),
  isV3VaultFile: vi.fn(),
  probeV3KeyIndex: vi.fn(),
}));

const profiles = vi.hoisted(() => ({ getManifest: vi.fn() }));

vi.mock('electron', () => ({ app: { getPath: () => env.userData } }));
vi.mock('electron-log', () => ({
  default: {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  },
}));
vi.mock('../../storageService', () => ({ default: storage }));
vi.mock('../../profileManager', () => ({ default: profiles }));

import * as fs from 'fs/promises';
import { countLocalSealedItems, scanAllProfiles } from '../inventoryScan';
import type { PublishItem } from '../types';

// ── Décor ───────────────────────────────────────────────────────────────────

const PROFILE = 'p-1111';

let root: string;
let profileDir: string;

const write = async (relative: string, content: string): Promise<void> => {
  const full = nodePath.join(profileDir, relative);
  await fs.mkdir(nodePath.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf-8');
};

const itemOf = (items: PublishItem[], key: string): PublishItem | undefined =>
  items.find((it) => it.key === key);

beforeEach(async () => {
  root = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'filarr-inventory-'));
  env.userData = root;
  profileDir = nodePath.join(root, 'FilarData', 'profiles', PROFILE);
  await fs.mkdir(profileDir, { recursive: true });

  profiles.getManifest.mockReturnValue({
    profiles: [
      {
        id: PROFILE,
        name: 'Perso',
        order: 0,
        isDefault: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
      },
    ],
  });
  // Aucune clé machine chargée : l'inventaire n'en a pas besoin pour classer
  // les conteneurs de racine (ils sont `machine` par construction).
  storage.readProfileMachineKey.mockResolvedValue(null);
  storage.isV3VaultFile.mockResolvedValue(false);
  storage.probeV3KeyIndex.mockResolvedValue(-1);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  vi.clearAllMocks();
});

// ── Le cas qui a coûté la mise en page ──────────────────────────────────────

describe('layout.enc dans l’inventaire de publication', () => {
  it('ramasse `layout.enc` avec EXACTEMENT le traitement de `notes.enc`', async () => {
    await write('notes.enc', 'v2:' + 'ab'.repeat(40));
    await write('layout.enc', 'v2:' + 'cd'.repeat(60));

    const { items } = await scanAllProfiles({ activeFek: null, incomingFek: null });

    const notes = itemOf(items, 'meta:notes');
    const layout = itemOf(items, 'meta:layout');
    expect(notes).toBeDefined();
    expect(layout).toBeDefined();

    // Le chemin relatif : c'est lui qui dit au bureau OÙ écrire ce qu'il
    // télécharge. À la RACINE du profil, comme `notes.enc`.
    expect(layout!.localPath).toBe('layout.enc');
    expect(layout!.localProfileId).toBe(PROFILE);
    // Sous la clé MACHINE : la bascule de FEK ne le casse pas, ses octets
    // partent tels quels (`itemTransfer` cas 1).
    expect(layout!.keyClass).toBe('machine');
    // Même genre que le paquet de notes — aucun consommateur n'en dérive de
    // chemin ni de destination ; le genre ne sert qu'au classement du plan.
    expect(layout!.kind).toBe(notes!.kind);
    expect(layout!.size).toBeGreaterThan(0);
    expect(Date.parse(layout!.updatedAt)).not.toBeNaN();
  });

  it('n’invente RIEN quand le profil n’a jamais été personnalisé', async () => {
    await write('notes.enc', 'v2:' + 'ab'.repeat(40));

    const { items } = await scanAllProfiles({ activeFek: null, incomingFek: null });

    expect(itemOf(items, 'meta:notes')).toBeDefined();
    expect(itemOf(items, 'meta:layout')).toBeUndefined();
    // Et aucun élément ne désigne un fichier absent : chaque `localPath` doit
    // exister sur le disque, sinon le transfert échouerait sur un fichier
    // introuvable au lieu d'être simplement absent de l'inventaire.
    for (const item of items) {
      await expect(fs.stat(nodePath.join(profileDir, item.localPath))).resolves.toBeDefined();
    }
  });

  it('ramasse `layout.enc` même sans `notes.enc` (personnalisé, jamais écrit une note)', async () => {
    await write('layout.enc', 'v2:' + 'cd'.repeat(60));

    const { items } = await scanAllProfiles({ activeFek: null, incomingFek: null });

    expect(itemOf(items, 'meta:notes')).toBeUndefined();
    expect(itemOf(items, 'meta:layout')).toBeDefined();
  });

  it('n’en fait JAMAIS un blob : ni à la racine, ni dans un dossier de coffre', async () => {
    await write('layout.enc', 'v2:' + 'cd'.repeat(60));
    // Un fichier homonyme DANS un dossier de coffre serait un fichier de
    // travail, jamais un contenu à publier : la liste d'exclusion le couvre,
    // comme elle couvre `notes.enc` et `metadata.json`.
    await write('f-2222/layout.enc', 'v2:parasite');
    await write('f-2222/metadata.json', 'v2:' + '11'.repeat(20));
    await write('f-2222/piece.bin', 'v2:' + '22'.repeat(20));

    const { items } = await scanAllProfiles({ activeFek: null, incomingFek: null });

    const blobs = items.filter((it) => it.kind === 'blob');
    expect(blobs.map((b) => b.localPath)).toEqual(['f-2222/piece.bin']);
    // Le compteur de la garde d'adoption ne compte QUE les blobs : la mise en
    // page ne doit pas gonfler le total qui décide de bloquer une bascule.
    expect(await countLocalSealedItems()).toBe(1);
  });

  it('ordonne les conteneurs de racine AVANT les blobs, et de façon déterministe', async () => {
    await write('notes.enc', 'v2:' + 'ab'.repeat(40));
    await write('layout.enc', 'v2:' + 'cd'.repeat(60));
    await write('f-2222/metadata.json', 'v2:' + '11'.repeat(20));

    const first = await scanAllProfiles({ activeFek: null, incomingFek: null });
    const second = await scanAllProfiles({ activeFek: null, incomingFek: null });

    // Deux balayages successifs donnent la MÊME suite : c'est ce qui permet à
    // une migration interrompue de reprendre au même endroit.
    expect(second.items.map((i) => i.key)).toEqual(first.items.map((i) => i.key));
    expect(first.items.map((i) => i.key)).toContain('meta:layout');
  });
});
