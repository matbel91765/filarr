/**
 * Le magasin d'intentions — ce qu'il refuse d'écrire compte plus que ce qu'il écrit.
 *
 * Ce document porte les EXCLUSIONS. En perdre une ne dégrade pas un affichage :
 * au prochain rattrapage, ça REND ACCESSIBLE ce qu'on avait retiré, des
 * semaines plus tard, sans que personne ne regarde. Ces tests portent donc
 * surtout sur les refus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = {
  version: 0,
  blob: null as { intentsEncrypted: string; intentsIv: string; intentsEpoch: number } | null,
  serverNow: null as string | null,
  cleDisponible: true as boolean,
  dechiffrable: true as boolean,
  ecritures: [] as Array<{ expectedVersion: number; contenu: unknown }>,
  refuserEcriture: null as string | null,
};

vi.mock('../vaultKeyCache', () => ({
  getVaultKey: () => (etat.cleDisponible ? new Uint8Array(32) : null),
}));

vi.mock('../vaultCrypto', () => ({
  // Le « chiffrement » est l'identité : ces tests portent sur la LOGIQUE du
  // magasin, pas sur AES — qui a ses propres tests.
  encryptVaultBlob: async (text: string) => ({ ciphertext: text, iv: 'IV' }),
  decryptVaultBlob: async (ciphertext: string) => {
    if (!etat.dechiffrable) throw new Error('bloc illisible');
    return ciphertext;
  },
}));

vi.mock('../vaultApi', () => ({
  apiGetVaultShareIntents: async () => ({
    version: etat.version,
    encrypted: etat.blob,
    serverNow: etat.serverNow,
  }),
  apiPutVaultShareIntents: async (
    _v: string,
    body: { expectedVersion: number; encrypted: { intentsEncrypted: string } | null }
  ) => {
    if (etat.refuserEcriture) return { ok: false, code: etat.refuserEcriture };
    etat.ecritures.push({
      expectedVersion: body.expectedVersion,
      contenu: body.encrypted ? JSON.parse(body.encrypted.intentsEncrypted) : null,
    });
    return { ok: true, version: body.expectedVersion + 1 };
  },
}));

import { rememberFolderShare, rememberExclusion, loadShareIntents } from '../shareIntentStore';

/** Pose un document déjà enregistré, « chiffré » par l'identité. */
function documentExistant(intents: unknown[], version = 3) {
  etat.version = version;
  etat.blob = {
    intentsEncrypted: JSON.stringify({ intents }),
    intentsIv: 'IV',
    intentsEpoch: 1,
  };
}

const dernierEcrit = () => etat.ecritures.at(-1)?.contenu as { intents: any[] } | null;

beforeEach(() => {
  etat.version = 0;
  etat.blob = null;
  etat.serverNow = null;
  etat.cleDisponible = true;
  etat.dechiffrable = true;
  etat.ecritures = [];
  etat.refuserEcriture = null;
});

describe('un coffre sans document', () => {
  it('se lit comme LISIBLE et vide — il n’y a rien à écraser', async () => {
    const l = await loadShareIntents('v1');
    expect(l.readable).toBe(true);
    expect(l.document.intents).toEqual([]);
  });

  it('accepte la première intention, avec un `since` posé', async () => {
    const r = await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', ['interne']);
    expect(r.ok).toBe(true);
    const doc = dernierEcrit()!;
    expect(doc.intents).toHaveLength(1);
    expect(doc.intents[0].folderPath).toBe('Client Dupont');
    expect(doc.intents[0].excludedItemIds).toEqual(['interne']);
    expect(Date.parse(doc.intents[0].since)).toBeGreaterThan(0);
  });
});

describe('UN DOCUMENT ILLISIBLE NE S’ÉCRASE JAMAIS', () => {
  it('refuse d’écrire quand le bloc existe mais ne s’ouvre pas', async () => {
    /*
      LA PROTECTION CENTRALE. Après une rotation de clé, un client qui ne
      détient pas l'époque du bloc le lit comme illisible. S'il écrivait
      par-dessus, il remplacerait TOUTES les exclusions du coffre par les
      siennes — c'est-à-dire par presque rien.
    */
    documentExistant([
      {
        folderPath: 'X',
        granteeUserId: 'p',
        excludedItemIds: ['a'],
        since: '2026-01-01T00:00:00Z',
      },
    ]);
    etat.dechiffrable = false;
    const r = await rememberFolderShare('v1', 1, 'Y', 'q', []);
    expect(r).toEqual({ ok: false, reason: 'unreadable' });
    expect(etat.ecritures).toHaveLength(0);
  });

  it('refuse aussi quand la clé du coffre manque (verrouillé)', async () => {
    documentExistant([]);
    etat.cleDisponible = false;
    const r = await rememberFolderShare('v1', 1, 'Y', 'q', []);
    expect(r.ok).toBe(false);
    expect(etat.ecritures).toHaveLength(0);
  });
});

describe('repartager le même dossier', () => {
  it('CONSERVE le `since` d’origine — sinon les anciens éléments rouvriraient', async () => {
    /*
      `since` borne le rattrapage : tout ce qui est antérieur est réputé
      arbitré. Le rafraîchir ferait redevenir « récents » des éléments
      décochés ou révoqués depuis des mois.
    */
    const origine = '2026-01-01T00:00:00.000Z';
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: ['interne'],
        since: origine,
      },
    ]);
    await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', ['brouillon']);
    expect(dernierEcrit()!.intents[0].since).toBe(origine);
  });

  it('AJOUTE les exclusions au lieu de les remplacer', async () => {
    // Repartager en décochant moins ne doit pas rouvrir ce qu'un partage
    // précédent avait retiré : retirer une exclusion est un geste explicite.
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: ['interne'],
        since: '2026-01-01T00:00:00Z',
      },
    ]);
    await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', ['brouillon']);
    expect(dernierEcrit()!.intents[0].excludedItemIds.sort()).toEqual(['brouillon', 'interne']);
  });

  it('n’écrase pas l’intention d’une AUTRE personne sur le même dossier', async () => {
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: ['interne'],
        since: '2026-01-01T00:00:00Z',
      },
    ]);
    await rememberFolderShare('v1', 1, 'Client Dupont', 'paul', []);
    expect(dernierEcrit()!.intents).toHaveLength(2);
  });
});

describe('la révocation devient une exclusion', () => {
  beforeEach(() => {
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: [],
        since: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('ajoute l’élément aux exclusions de l’intention qui le couvre', async () => {
    const r = await rememberExclusion('v1', 1, 'marie', 'avenant', 'Client Dupont');
    expect(r.ok).toBe(true);
    expect(dernierEcrit()!.intents[0].excludedItemIds).toEqual(['avenant']);
  });

  it('couvre aussi un sous-dossier', async () => {
    await rememberExclusion('v1', 1, 'marie', 'annexe', 'Client Dupont/Annexes');
    expect(dernierEcrit()!.intents[0].excludedItemIds).toEqual(['annexe']);
  });

  it('N’ÉCRIT RIEN quand aucune intention ne couvre l’élément', async () => {
    // Aucun rattrapage ne visera cet élément : l'exclure serait mémoriser un
    // partage de dossier qui n'a jamais eu lieu.
    const r = await rememberExclusion('v1', 1, 'marie', 'x', 'Client Martin');
    expect(r.ok).toBe(true);
    expect(etat.ecritures).toHaveLength(0);
  });

  it('n’écrit rien pour une AUTRE personne', async () => {
    await rememberExclusion('v1', 1, 'paul', 'avenant', 'Client Dupont');
    expect(etat.ecritures).toHaveLength(0);
  });

  it('est idempotente — réexclure n’écrit pas une seconde fois', async () => {
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: ['avenant'],
        since: '2026-01-01T00:00:00Z',
      },
    ]);
    await rememberExclusion('v1', 1, 'marie', 'avenant', 'Client Dupont');
    expect(etat.ecritures).toHaveLength(0);
  });
});

describe('le compare-and-set remonte tel quel', () => {
  it('un conflit n’est pas une panne, et le dit', async () => {
    etat.refuserEcriture = 'version_conflict';
    const r = await rememberFolderShare('v1', 1, 'X', 'p', []);
    expect(r).toEqual({ ok: false, reason: 'conflict' });
  });

  it('l’écriture renvoie la version LUE, jamais une devinée', async () => {
    documentExistant([], 7);
    await rememberFolderShare('v1', 1, 'X', 'p', []);
    expect(etat.ecritures[0].expectedVersion).toBe(7);
  });
});

describe('QUELLE HORLOGE POSE `since`', () => {
  /*
    `since` se compare à `created_at` d'un élément, que le SERVEUR estampille
    (migration 0019). Mélanger deux horloges n'est pas symétrique : une horloge
    locale en avance fait accorder trop peu — ça se voit et ça se signale. Une
    horloge en retard fait passer pour « arrivés depuis » des éléments qui
    existaient au partage, c'est-à-dire précisément les décochés et les
    révoqués. Le filet s'ouvre, et personne ne le remarque.
  */
  it('préfère l’heure du SERVEUR à celle de la machine', async () => {
    etat.serverNow = '2026-03-15T08:00:00.000Z';
    await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', []);
    expect(dernierEcrit()!.intents[0].since).toBe('2026-03-15T08:00:00.000Z');
  });

  it('retombe sur l’horloge locale quand le serveur ne la rend pas', async () => {
    // Ordre de déploiement : un worker antérieur ne connaît pas le champ. Ne
    // rien poser du tout empêcherait le partage lui-même.
    etat.serverNow = null;
    const avant = Date.now();
    await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', []);
    const pose = Date.parse(dernierEcrit()!.intents[0].since);
    expect(pose).toBeGreaterThanOrEqual(avant);
  });

  it('ne réécrit PAS `since` d’une intention existante, même avec l’heure serveur', async () => {
    // La conservation prime : rafraîchir la borne rouvrirait les éléments
    // antérieurs. L'heure du serveur n'est utile qu'à la POSE.
    const origine = '2026-01-01T00:00:00.000Z';
    etat.serverNow = '2026-03-15T08:00:00.000Z';
    documentExistant([
      {
        folderPath: 'Client Dupont',
        granteeUserId: 'marie',
        excludedItemIds: [],
        since: origine,
      },
    ]);
    await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', ['x']);
    expect(dernierEcrit()!.intents[0].since).toBe(origine);
  });
});

describe('UNE FORME INATTENDUE VAUT « ILLISIBLE », PAS « VIDE »', () => {
  /*
    Le bloc s'ouvre — donc la clé est la bonne — mais son contenu n'est pas le
    document attendu. Le rendre LISIBLE et vide autoriserait l'écriture
    suivante à le remplacer : on effacerait ce qu'on n'a pas su lire, ce que le
    module refuse déjà pour un bloc abîmé. Le cas concret : un client d'une
    version ULTÉRIEURE range les intentions autrement ; celui d'aujourd'hui
    doit s'abstenir, pas écraser.

    (Trou signalé par la session mobile, qui l'avait fermé de son côté.)
  */
  const malformes: Array<[string, unknown]> = [
    ['`intents` absent', { autre: 1 }],
    ['`intents` non tableau', { intents: 'rien' }],
    ['`intents` objet', { intents: { a: 1 } }],
    ['`intents` nul', { intents: null }],
    ['document nul', null],
    ['document tableau nu', [{ folderPath: 'X' }]],
  ];

  for (const [nom, forme] of malformes) {
    it(`refuse d'écrire par-dessus : ${nom}`, async () => {
      etat.version = 4;
      etat.blob = {
        intentsEncrypted: JSON.stringify(forme),
        intentsIv: 'IV',
        intentsEpoch: 1,
      };
      const l = await loadShareIntents('v1');
      expect(l.readable, nom).toBe(false);

      const r = await rememberFolderShare('v1', 1, 'Client Dupont', 'marie', []);
      expect(r).toEqual({ ok: false, reason: 'unreadable' });
      expect(etat.ecritures).toHaveLength(0);
    });
  }

  it('un document BIEN formé mais vide reste écrivable — il n’y a rien à perdre', () => {
    // La borne de l'autre côté : `{ intents: [] }` est un document valide, pas
    // une anomalie. Le confondre avec un malformé bloquerait tout premier
    // partage sur un coffre dont le document a déjà été créé puis vidé.
    documentExistant([]);
    return loadShareIntents('v1').then((l) => {
      expect(l.readable).toBe(true);
      expect(l.document.intents).toEqual([]);
    });
  });
});
