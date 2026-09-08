/**
 * LA PRÉSENTATION D'UN PROFIL VOYAGE — nom, couleur, emoji, image, ordre.
 *
 * CE QUI ÉTAIT CASSÉ. Une synchronisation E2EE des profils existait bien : le
 * manifeste chiffré porte `profileMeta`, et un appareil neuf recrée les profils
 * du compte. Mais elle ne savait faire QUE la naissance. `restoreProfileFromCloud`
 * sort immédiatement sur un identifiant déjà connu, et le PIN était le seul
 * champ à disposer d'une fusion (`applyCloudPinUpdate`). Renommer un profil sur
 * l'appareil A ne se voyait donc nulle part ailleurs, JAMAIS : deux appareils du
 * même compte affichaient durablement deux noms pour un seul et même profil, et
 * rien, ni le temps ni un redémarrage, ne les réconciliait.
 *
 * CE QUE CETTE SUITE ÉPINGLE : l'arbitrage à l'horloge `metaUpdatedAt`. Il n'a
 * pas de bon comportement « par défaut » — chaque cas limite (pas d'horloge d'un
 * côté, horloges égales, horloge illisible) est une décision, et une décision
 * différente perdrait le travail de quelqu'un.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Le gestionnaire de profils ouvre `electron` à l'import et écrit un manifeste
// sur disque. On lui donne un faux disque en mémoire et un `safeStorage` muet :
// ce qu'on éprouve ici est la FUSION, pas le chiffrement du fichier.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/filarr-test' },
  safeStorage: { isEncryptionAvailable: () => false },
}));

const disque = new Map<string, Buffer>();

vi.mock('fs/promises', () => ({
  default: {
    mkdir: async () => undefined,
    rm: async () => undefined,
    access: async () => undefined,
    readFile: async (p: string) => {
      const buf = disque.get(p);
      if (!buf) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return buf;
    },
    writeFile: async (p: string, data: string | Buffer) => {
      disque.set(p, typeof data === 'string' ? Buffer.from(data, 'utf-8') : data);
    },
  },
}));

import profileManager from '../profileManager';

const T1 = '2026-08-20T10:00:00.000Z';
const T2 = '2026-08-21T10:00:00.000Z';

async function profilNeuf(nom = 'Atelier') {
  disque.clear();
  await profileManager.initialize();
  const p = await profileManager.createProfile(nom, '#4682B4');
  return p.id;
}

let id: string;

beforeEach(async () => {
  id = await profilNeuf();
});

describe('metaUpdatedAt — l’horloge de la présentation', () => {
  it('toute mutation visible avance l’horloge', async () => {
    // Sans estampille, le distant n'a aucun moyen de savoir que ce nom est plus
    // récent que le sien : il le reçoit et l'ignore, pour toujours.
    const avant = profileManager.getManifest().profiles[0].metaUpdatedAt;
    expect(avant).toBeUndefined();

    await profileManager.updateProfile(id, { name: 'Cabinet' });

    expect(profileManager.getManifest().profiles[0].metaUpdatedAt).toBeTruthy();
  });

  it('changer SEULEMENT le PIN ne touche pas à l’horloge de la présentation', async () => {
    // Les deux horloges sont indépendantes : un changement de PIN ne doit pas
    // faire gagner un vieux nom, ni l'inverse.
    await profileManager.updateProfile(id, { pin: '1234' });

    const p = profileManager.getManifest().profiles[0];
    expect(p.pinUpdatedAt).toBeTruthy();
    expect(p.metaUpdatedAt).toBeUndefined();
  });

  it('un réordonnancement qui ne déplace rien n’avance rien', async () => {
    // Un glisser-déposer sans effet ferait sinon gagner cet appareil sur tous
    // les autres, sans que personne n'ait rien décidé.
    await profileManager.reorderProfiles([id]);

    expect(profileManager.getManifest().profiles[0].metaUpdatedAt).toBeUndefined();
  });
});

describe('applyCloudMetaUpdate — qui gagne, et pourquoi', () => {
  it('le distant STRICTEMENT plus récent gagne', async () => {
    await profileManager.updateProfile(id, { name: 'Local' });
    profileManager.getManifest().profiles[0].metaUpdatedAt = T1;

    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Distant',
      avatarColor: '#E74C3C',
      metaUpdatedAt: T2,
    });

    expect(changed).toBe(true);
    const p = profileManager.getManifest().profiles[0];
    expect(p.name).toBe('Distant');
    expect(p.avatarColor).toBe('#E74C3C');
    expect(p.metaUpdatedAt).toBe(T2);
  });

  it('le local plus récent RESTE — le distant est simplement en retard', async () => {
    await profileManager.updateProfile(id, { name: 'Local' });
    profileManager.getManifest().profiles[0].metaUpdatedAt = T2;

    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Distant',
      metaUpdatedAt: T1,
    });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles[0].name).toBe('Local');
  });

  it('à horloges ÉGALES le local reste — c’est notre propre manifeste qui revient', async () => {
    // Chaque cycle relit ce que cet appareil vient de publier. Faire gagner le
    // distant à égalité ferait clignoter l'écran des profils toutes les cinq
    // minutes, en réécrivant le manifeste pour rien.
    profileManager.getManifest().profiles[0].metaUpdatedAt = T2;

    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Distant',
      metaUpdatedAt: T2,
    });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles[0].name).toBe('Atelier');
  });

  it('un distant SANS horloge ne réclame rien (manifeste d’avant ce champ)', async () => {
    // Compatibilité : un appareil resté sur une version antérieure publie une
    // présentation non estampillée. Elle n'est pas fausse, elle est muette — et
    // le silence n'est pas une opinion.
    const changed = await profileManager.applyCloudMetaUpdate(id, { name: 'Distant' });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles[0].name).toBe('Atelier');
  });

  it('un local SANS horloge n’a rien à opposer à un distant estampillé', async () => {
    // C'est le cas de l'appareil qui vient de rejoindre : son profil local n'a
    // jamais été modifié depuis l'introduction du champ.
    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Distant',
      metaUpdatedAt: T1,
    });

    expect(changed).toBe(true);
    expect(profileManager.getManifest().profiles[0].name).toBe('Distant');
  });

  it('une horloge distante illisible ne décide de rien', async () => {
    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Distant',
      metaUpdatedAt: 'pas une date',
    });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles[0].name).toBe('Atelier');
  });

  it('ne touche NI au PIN NI au profil par défaut', async () => {
    // `isDefault` répond à « quel profil s'ouvre sur CET appareil » : l'adopter
    // depuis le nuage promeut un second profil par défaut sans rétrograder
    // l'ancien. Le PIN, lui, a sa propre horloge et sa propre fusion.
    await profileManager.updateProfile(id, { pin: '4321' });
    const pinAvant = profileManager.getManifest().profiles[0].pinHash;

    await profileManager.applyCloudMetaUpdate(id, { name: 'Distant', metaUpdatedAt: T2 });

    const p = profileManager.getManifest().profiles[0];
    expect(p.pinHash).toBe(pinAvant);
    expect(p.isDefault).toBe(true);
  });

  it('un identifiant inconnu ne crée rien', async () => {
    const changed = await profileManager.applyCloudMetaUpdate('inconnu', {
      name: 'Distant',
      metaUpdatedAt: T2,
    });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles).toHaveLength(1);
  });

  it('l’horloge est adoptée même quand rien ne bouge — sinon on rejoue à chaque cycle', async () => {
    const changed = await profileManager.applyCloudMetaUpdate(id, {
      name: 'Atelier',
      avatarColor: '#4682B4',
      metaUpdatedAt: T2,
    });

    expect(changed).toBe(false);
    expect(profileManager.getManifest().profiles[0].metaUpdatedAt).toBe(T2);
  });
});

describe('restoreProfileFromCloud — la naissance porte déjà l’horloge', () => {
  it('un profil restauré garde le metaUpdatedAt du nuage', async () => {
    // Sans cela, l'appareil qui vient de restaurer se croirait sans horloge et
    // adopterait n'importe quelle présentation distante, même périmée.
    await profileManager.restoreProfileFromCloud({
      id: 'venu-du-nuage',
      name: 'Nuage',
      avatarColor: '#2ECC71',
      isDefault: false,
      order: 1,
      createdAt: T1,
      metaUpdatedAt: T2,
    });

    const p = profileManager.getManifest().profiles.find((x) => x.id === 'venu-du-nuage');
    expect(p?.metaUpdatedAt).toBe(T2);
  });

  it('un identifiant déjà connu n’est PAS écrasé par la restauration', async () => {
    // La mise à jour d'un profil connu passe par `applyCloudMetaUpdate`, qui
    // arbitre. Écraser ici perdrait un renommage local plus récent.
    await profileManager.updateProfile(id, { name: 'Local' });

    await profileManager.restoreProfileFromCloud({
      id,
      name: 'Distant',
      avatarColor: '#000000',
      isDefault: false,
      order: 0,
      createdAt: T1,
    });

    expect(profileManager.getManifest().profiles[0].name).toBe('Local');
  });
});
