import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * SE CONNECTER DOIT RAMENER SES PROFILS.
 *
 * L'utilisateur se connectait à un compte dont les profils avaient pourtant été
 * synchronisés depuis un autre appareil, et ne voyait rien arriver — au mieux un
 * unique profil neuf nommé d'après le début de son adresse e-mail.
 *
 * La restauration existait pourtant, des deux côtés, mais enfermée :
 *
 *   · sur le BUREAU, dans le protocole d'appairage à six chiffres — que l'écran
 *     de connexion saute désormais dès que le serveur détient une copie
 *     enveloppée de la FEK ;
 *   · sur le WEB, dans un cycle de synchronisation mené pour un profil qu'on
 *     possède DÉJÀ, ce qui suppose résolu le problème qu'on cherche à résoudre.
 *
 * Ce fichier verrouille les trois propriétés du geste partagé : il appelle le
 * bon canal, il RELIT le manifeste pour que le travail devienne visible, et il
 * n'emporte jamais la connexion avec lui quand il échoue.
 */

// L'environnement de test est `node` : on pose le globe que le module attend,
// exactement comme le renderer le présente.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}

const h = vi.hoisted(() => ({
  invocations: [] as string[],
  reponse: null as unknown,
  leve: false,
  manifestesRelus: 0,
}));

vi.mock('../../../store', () => ({
  default: {
    dispatch: vi.fn(async (action: unknown) => {
      if (action === 'FETCH_MANIFEST') h.manifestesRelus += 1;
      return action;
    }),
  },
}));

vi.mock('../../../store/slices/profilesSlice', () => ({
  fetchManifest: () => 'FETCH_MANIFEST',
}));

import { restoreCloudProfiles } from '../cloudProfileRestore';

function poserLePont(present = true) {
  const w = window as unknown as { electron?: unknown };
  if (!present) {
    delete w.electron;
    return;
  }
  w.electron = {
    ipcRenderer: {
      invoke: vi.fn(async (canal: string) => {
        h.invocations.push(canal);
        if (h.leve) throw new Error('IPC injoignable');
        return h.reponse;
      }),
    },
  };
}

beforeEach(() => {
  h.invocations = [];
  h.reponse = { success: true, restored: 0 };
  h.leve = false;
  h.manifestesRelus = 0;
  poserLePont();
});

describe('restoreCloudProfiles', () => {
  it('demande la restauration par le canal partagé', async () => {
    h.reponse = { success: true, restored: 2, profileIds: ['a', 'b'] };

    const out = await restoreCloudProfiles();

    expect(h.invocations).toEqual(['sync:restoreCloudProfiles']);
    expect(out).toEqual({ success: true, restored: 2, profileIds: ['a', 'b'] });
  });

  it('RELIT le manifeste — sans quoi le travail resterait invisible', async () => {
    // Les entrées sont écrites sous l'écran, pas dans le magasin qui l'alimente.
    // C'est cette relecture qui les fait apparaître dans la liste : la moitié
    // du symptôme rapporté tenait à elle.
    h.reponse = { success: true, restored: 3 };

    await restoreCloudProfiles();

    expect(h.manifestesRelus).toBe(1);
  });

  it('relit MÊME quand le compteur dit zéro', async () => {
    // Conditionner la relecture à `restored > 0` était une erreur, et une
    // erreur qui reproduisait le symptôme : côté bureau,
    // `restoreProfileFromCloud` sort immédiatement sur un identifiant déjà
    // connu, si bien que le compteur peut valoir zéro alors qu'un AUTRE profil
    // vient d'apparaître. Relire coûte une lecture locale ; ne pas relire coûte
    // le bogue entier.
    h.reponse = { success: true, restored: 0 };

    const out = await restoreCloudProfiles();

    expect(out.restored).toBe(0);
    expect(h.manifestesRelus).toBe(1);
  });

  it('un échec ne remonte pas — la connexion réussie le reste', async () => {
    // Hors ligne, ou coffre encore verrouillé : les métadonnées d'un profil
    // vivent dans un manifeste chiffré, donc rien n'est lisible sans clé. Faire
    // échouer la connexion pour autant serait disproportionné.
    h.leve = true;

    await expect(restoreCloudProfiles()).resolves.toEqual({
      success: false,
      restored: 0,
      profileIds: [],
    });
    expect(h.manifestesRelus).toBe(0);
  });

  it('sans pont IPC, se tait au lieu de lever', async () => {
    poserLePont(false);

    await expect(restoreCloudProfiles()).resolves.toEqual({
      success: false,
      restored: 0,
      profileIds: [],
    });
    expect(h.invocations).toEqual([]);
  });

  it('REND LES IDENTIFIANTS, pas seulement leur nombre', async () => {
    // Le compteur suffisait tant que la restauration servait un appareil neuf :
    // tout ce qui s'y trouvait appartenait au compte qui venait de se
    // connecter. Depuis le sélecteur, la machine porte déjà des profils, et
    // « prendre le premier » ouvre celui de quelqu'un d'autre. Le côté principal
    // rendait déjà ces identifiants ; ils étaient jetés ici.
    h.reponse = { success: true, restored: 2, profileIds: ['p-1', 'p-2'] };

    const out = await restoreCloudProfiles();

    expect(out.profileIds).toEqual(['p-1', 'p-2']);
  });

  it('une liste absente devient une liste vide, jamais undefined', async () => {
    // L'appelant filtre dessus (`restoredIds.includes(...)`). Un `undefined`
    // qui remonte jusque-là ferait échouer l'arbitrage entier au lieu de le
    // faire retomber sur l'estampille `cloudAccount`.
    h.reponse = { success: true, restored: 1 };

    const out = await restoreCloudProfiles();

    expect(out.profileIds).toEqual([]);
  });

  it('une réponse malformée est traitée comme un échec silencieux', async () => {
    // Le canal a répondu, mais sans rien de lisible : on n'invente pas un
    // succès. La relecture a tout de même lieu — le disque a pu bouger, et
    // c'est le seul moyen de le savoir.
    h.reponse = undefined;

    const out = await restoreCloudProfiles();

    expect(out).toEqual({ success: false, restored: 0, profileIds: [] });
    expect(h.manifestesRelus).toBe(1);
  });
});
