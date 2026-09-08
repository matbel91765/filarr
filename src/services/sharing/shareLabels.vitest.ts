/**
 * LE MODÈLE DE LA LISTE DES PARTAGES — nommer, fusionner, et savoir se taire.
 *
 * Ce que ce fichier protège, dans l'ordre de ce que ça coûte quand ça casse :
 *
 *   1. LA CONVERGENCE. `mergeServerLabels` décide qui gagne entre la copie
 *      locale et celle du serveur. Se tromper de sens fait diverger deux
 *      machines du même compte SANS aucun signe — chacune affiche « son » nom
 *      et croit avoir raison.
 *   2. LES QUATRE RAISONS DE RESTER LOCAL. Un libellé qui ne part pas n'est pas
 *      une erreur, c'est un état, et l'écran doit dire LEQUEL. « On réessaiera »
 *      sur un `app-origin` ou un `not-found` est un mensonge : rien ne changera
 *      au prochain essai.
 *   3. L'EFFACEMENT PAR MÉGARDE. Une chaîne vide EFFACE, une absence n'efface
 *      rien, et un partage encore listé garde son nom même révoqué.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyLabel,
  displayNameFor,
  isShareLabel,
  MAX_LABEL_ENTRIES,
  MAX_LABEL_LENGTH,
  mergeServerLabels,
  normalizeShareLabel,
  pruneLabels,
  syncLabelToServer,
  type ShareLabel,
  type ShareLabelMap,
} from './shareLabels';
import { putShareLabel } from '../custody/custodyApi';
import { resetCustodySessionForTests, setCustodyKey } from '../custody/custodySession';

vi.mock('../custody/custodyApi', () => ({
  putShareLabel: vi.fn(async () => 'saved' as const),
}));

// Le scellement n'est pas le sujet ici — il a son propre fichier de vecteurs.
// On le remplace par une empreinte lisible pour pouvoir affirmer CE QUI est
// envoyé au serveur, ce qu'un blob AES-GCM aléatoire ne permettrait pas.
vi.mock('../custody/custodyCrypto', () => ({
  sealJson: vi.fn(async (value: unknown, pub: string) => `sealed(${pub}):${JSON.stringify(value)}`),
  openJson: vi.fn(async () => null),
}));

const KEY = {
  custodyPublicKey: 'PUB',
  wrappedPrivateKey: 'w',
  kdfSalt: 's',
  kdfScheme: 'passphrase-v1',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCustodySessionForTests();
});

describe('normalizeShareLabel — ce qui distingue « effacer » de « vide »', () => {
  it('rend null quand il ne reste RIEN : c’est ce que le serveur attend pour effacer', () => {
    expect(normalizeShareLabel({ label: '   ', client: '' })).toBeNull();
    expect(normalizeShareLabel({})).toBeNull();
  });

  it('coupe les blancs de bord et n’émet que les champs réellement remplis', () => {
    expect(normalizeShareLabel({ label: '  Devis  ', client: '  ' })).toEqual({ label: 'Devis' });
  });

  it('tronque à la longueur maximale du site et du mobile — pas d’écart de contrat', () => {
    const long = 'é'.repeat(MAX_LABEL_LENGTH + 40);

    const out = normalizeShareLabel({ label: long });

    expect(out?.label).toHaveLength(MAX_LABEL_LENGTH);
  });

  it('reconnaît la forme d’un libellé, et refuse ce qui n’en est pas une', () => {
    expect(isShareLabel({ label: 'a' })).toBe(true);
    expect(isShareLabel({})).toBe(true);
    expect(isShareLabel({ label: 42 })).toBe(false);
    expect(isShareLabel(['a'])).toBe(false);
    expect(isShareLabel(null)).toBe(false);
  });
});

describe('applyLabel et pruneLabels — la croissance du magasin', () => {
  it('poser null RETIRE l’entrée plutôt que d’y ranger un objet vide', () => {
    const map = applyLabel({ a: { label: 'x' } }, 'a', null);

    expect(map).toEqual({});
  });

  it('borne le magasin en évinçant les PLUS ANCIENNES entrées insérées', () => {
    let map: ShareLabelMap = {};
    for (let i = 0; i < MAX_LABEL_ENTRIES + 3; i++) {
      map = applyLabel(map, `id${i}`, { label: `n${i}` });
    }

    expect(Object.keys(map)).toHaveLength(MAX_LABEL_ENTRIES);
    expect(map.id0).toBeUndefined();
    expect(map[`id${MAX_LABEL_ENTRIES + 2}`]).toEqual({ label: `n${MAX_LABEL_ENTRIES + 2}` });
  });

  it('ne garde que les partages encore listés — RÉVOQUÉS COMPRIS', () => {
    const map = { vivant: { label: 'a' }, revoque: { label: 'b' }, disparu: { label: 'c' } };

    // `revoque` est encore dans la liste du serveur : perdre son nom au moment
    // où l'utilisateur cherche à comprendre ce qu'il vient de couper serait le
    // pire instant possible.
    const out = pruneLabels(map, new Set(['vivant', 'revoque']));

    expect(out).toEqual({ vivant: { label: 'a' }, revoque: { label: 'b' } });
  });
});

describe('displayNameFor — quel nom la ligne porte', () => {
  it('le libellé CHOISI l’emporte sur le nom de fichier', () => {
    expect(displayNameFor({ label: 'Devis' }, 'IMG_4821.pdf')).toBe('Devis');
  });

  it('à défaut, le nom de fichier du manifeste', () => {
    expect(displayNameFor(undefined, 'IMG_4821.pdf')).toBe('IMG_4821.pdf');
    expect(displayNameFor({ client: 'Dupont' }, 'IMG_4821.pdf')).toBe('IMG_4821.pdf');
  });

  it('sans ni l’un ni l’autre, rend null — à l’écran de choisir sa phrase', () => {
    expect(displayNameFor(undefined, null)).toBeNull();
    expect(displayNameFor({ client: 'Dupont' }, '   ')).toBeNull();
  });
});

describe('mergeServerLabels — qui gagne, et ce qui remonte', () => {
  const ouvre = async (w: string): Promise<ShareLabel | null> =>
    w === 'illisible' ? null : { label: w };

  it('LE SERVEUR GAGNE quand il a un sceau lisible : c’est la copie que tous voient', async () => {
    const { merged } = await mergeServerLabels(
      { s1: { label: 'mon nom local' } },
      [{ id: 's1', wrappedLabel: 'nom du serveur' }],
      ouvre
    );

    expect(merged.s1).toEqual({ label: 'nom du serveur' });
  });

  it('un sceau ILLISIBLE laisse le nom local en place plutôt que de l’effacer', async () => {
    // Cas réel : libellé scellé sous une clé de garde ANTÉRIEURE, après
    // recréation du coffre. Plus personne ne pourra le reconstituer — effacer
    // la copie locale serait détruire le dernier exemplaire.
    const { merged } = await mergeServerLabels(
      { s1: { label: 'mon nom local' } },
      [{ id: 's1', wrappedLabel: 'illisible' }],
      ouvre
    );

    expect(merged.s1).toEqual({ label: 'mon nom local' });
  });

  it('une ligne SANS sceau n’efface rien — l’absence n’est pas un effacement', async () => {
    const { merged } = await mergeServerLabels(
      { s1: { label: 'local' } },
      [{ id: 's1', wrappedLabel: null }],
      ouvre
    );

    expect(merged.s1).toEqual({ label: 'local' });
  });

  it('remonte les identifiants dont NOUS avons un nom que le serveur ignore', async () => {
    const { toPush } = await mergeServerLabels(
      { s1: { label: 'local' }, s2: {}, s3: { label: 'aussi' } },
      [
        { id: 's1', wrappedLabel: null },
        { id: 's2', wrappedLabel: null },
        { id: 's3', wrappedLabel: 'déjà là' },
      ],
      ouvre
    );

    // s2 a une entrée VIDE : rien à pousser. s3 est déjà sur le serveur.
    expect(toPush).toEqual(['s1']);
  });

  it('ne touche pas aux entrées locales absentes du listing', async () => {
    const { merged } = await mergeServerLabels({ ailleurs: { label: 'x' } }, [], ouvre);

    expect(merged.ailleurs).toEqual({ label: 'x' });
  });
});

describe('syncLabelToServer — les quatre raisons de rester local', () => {
  it('`no-vault` : sans clé de garde publiée, il n’y a rien vers quoi sceller', async () => {
    // Session en `unknown` : aucune publique disponible.
    const out = await syncLabelToServer('send', 's1', { label: 'x' });

    expect(out).toEqual({ status: 'local', reason: 'no-vault' });
    expect(putShareLabel).not.toHaveBeenCalled();
  });

  it('`app-origin` : face à un serveur d’hier, on s’abstient AVANT de sceller pour rien', async () => {
    setCustodyKey(KEY);

    const out = await syncLabelToServer('send', 's1', { label: 'x' }, { appOrigin: true });

    expect(out).toEqual({ status: 'local', reason: 'app-origin' });
    expect(putShareLabel).not.toHaveBeenCalled();
  });

  it('un serveur qui rend `wrapped_label` lève l’abstention : le partage d’app est envoyé', async () => {
    setCustodyKey(KEY);

    const out = await syncLabelToServer(
      'send',
      's1',
      { label: 'x' },
      { appOrigin: true, serverKnowsAppLabels: true }
    );

    expect(out).toEqual({ status: 'synced' });
    expect(putShareLabel).toHaveBeenCalledWith('send', 's1', 'sealed(PUB):{"label":"x"}');
  });

  it('`not-found` : le serveur ne sait pas ranger ce libellé — un réessai n’y changera rien', async () => {
    setCustodyKey(KEY);
    vi.mocked(putShareLabel).mockResolvedValueOnce('not-found');

    const out = await syncLabelToServer('send', 's1', { label: 'x' });

    expect(out).toEqual({ status: 'local', reason: 'not-found' });
  });

  it('`network` : la panne, et c’est la SEULE des quatre qui mérite « on réessaiera »', async () => {
    setCustodyKey(KEY);
    vi.mocked(putShareLabel).mockRejectedValueOnce(new Error('offline'));

    const out = await syncLabelToServer('send', 's1', { label: 'x' });

    expect(out).toEqual({ status: 'local', reason: 'network' });
  });

  it('ne lève JAMAIS : la copie locale est déjà écrite, une panne ne doit pas défaire la saisie', async () => {
    setCustodyKey(KEY);
    vi.mocked(putShareLabel).mockRejectedValueOnce(new Error('boom'));

    await expect(syncLabelToServer('send', 's1', { label: 'x' })).resolves.toBeDefined();
  });

  it('SCELLER N’EXIGE PAS LE DÉVERROUILLAGE : la session `locked` suffit', async () => {
    setCustodyKey(KEY); // → 'locked', aucune privée en mémoire

    const out = await syncLabelToServer('send', 's1', { label: 'x' });

    expect(out).toEqual({ status: 'synced' });
  });

  it('un libellé null part en `null` — c’est l’effacement, pas un blob vide', async () => {
    setCustodyKey(KEY);

    await syncLabelToServer('send', 's1', null);

    expect(putShareLabel).toHaveBeenCalledWith('send', 's1', null);
  });

  it('une DEMANDE d’origine app n’existe pas : l’abstention ne vise que les envois', async () => {
    setCustodyKey(KEY);

    const out = await syncLabelToServer('request', 'r1', { label: 'x' }, { appOrigin: true });

    expect(out).toEqual({ status: 'synced' });
    expect(putShareLabel).toHaveBeenCalledWith('request', 'r1', expect.any(String));
  });
});
