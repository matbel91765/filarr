/**
 * LE RATTRAPAGE EST-IL BRANCHÉ, ET REFUSE-T-IL CE QU'IL DOIT REFUSER ?
 *
 * `planVaultCatchUp` a ses propres tests : il DÉCIDE, et il décide bien. Ce
 * fichier porte sur les deux choses qu'une décision juste ne garantit pas.
 *
 * ── 1. QUE QUELQU'UN L'APPELLE ──────────────────────────────────────────────
 *
 * Deux gardes de ce dépôt sont déjà restées vertes pendant que le vrai chemin
 * régressait (`ensureFolderId`, puis `keepsOpenConflict`), parce qu'elles
 * exerçaient une décision que plus personne ne consultait. Une lecture de
 * source ferme ça : l'appel doit être DANS `loadVaultItems`, pas ailleurs dans
 * le fichier.
 *
 * ── 2. QUE SES REFUS TIENNENT ───────────────────────────────────────────────
 *
 * Le mode d'échec à craindre n'est pas « il ne rattrape pas » — ça se voit.
 * C'est « il rattrape ce qu'on avait retiré » : silencieux, différé, contraire
 * au geste. Le refus central est le document ILLISIBLE, qui doit arrêter tout.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const etat = {
  readable: true,
  intents: [] as unknown[],
  grants: [] as Array<{ itemId: string; granteeUserId: string }>,
  grantsAppels: 0,
  scelles: [] as Array<{ granteeUserId: string; itemIds: string[] }>,
};

vi.mock('../../../services/vault/shareIntentStore', () => ({
  rememberExclusion: async () => ({ ok: true }),
  loadShareIntents: async () => ({
    version: 1,
    readable: etat.readable,
    document: { intents: etat.intents },
    serverNow: '2026-06-15T00:00:00.000Z',
  }),
}));

vi.mock('../../../services/vault/vaultApi', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiListVaultGrants: async () => {
    etat.grantsAppels++;
    return etat.grants;
  },
}));

const LOAD = 'src/store/slices/vaultsSlice.ts';

beforeEach(() => {
  etat.readable = true;
  etat.intents = [];
  etat.grants = [];
  etat.grantsAppels = 0;
  etat.scelles = [];
});

describe('LE RATTRAPAGE PART BIEN DU CHARGEMENT DES ÉLÉMENTS', () => {
  const source = (): string =>
    readFileSync(
      fileURLToPath(new URL('../vaultsSlice.ts', (import.meta as unknown as { url: string }).url)),
      'utf8'
    );

  it('l’appel est DANS `loadVaultItems`, pas seulement dans le fichier', () => {
    const s = source();
    const debut = s.indexOf('export const loadVaultItems = createAsyncThunk(');
    expect(
      debut,
      '`loadVaultItems` introuvable — ce test doit suivre le renommage'
    ).toBeGreaterThan(0);
    // Le thunk suivant borne la recherche : sans borne, un appel situé ailleurs
    // dans ces 4000 lignes ferait passer ce test à tort.
    const fin = s.indexOf('export const vaultRewrapProgress', debut);
    expect(fin).toBeGreaterThan(debut);
    expect(s.slice(debut, fin)).toContain('catchUpFolderShares({ vaultId: args.vaultId })');
  });

  it('il est FIRE-AND-FORGET — l’affichage des éléments ne l’attend pas', () => {
    // `await` ferait dépendre l'ouverture du coffre de deux requêtes de plus et
    // d'autant de scellements.
    expect(source()).toContain('void dispatch(catchUpFolderShares({ vaultId: args.vaultId }));');
  });

  it('la porte « une fois par session » se rouvre au changement de compte', () => {
    // Sans ça, le compte suivant hérite des coffres déjà balayés.
    const s = source();
    const debut = s.indexOf('.addCase(clearCloudAuth');
    expect(debut).toBeGreaterThan(0);
    expect(s.slice(debut, debut + 600)).toContain('resetFolderCatchUp()');
  });
});

/** Monte l'état minimal d'un coffre déverrouillé dont on est l'hôte. */
function scene(items: unknown[]) {
  return () => ({
    vaults: {
      vaults: { v1: { id: 'v1', role: 'owner' } },
      unlockedVaultIds: ['v1'],
      itemsByVault: { v1: items },
    },
  });
}

const INTENTION = {
  folderPath: 'Client Dupont',
  granteeUserId: 'marie',
  excludedItemIds: ['secret'],
  since: '2026-01-01T00:00:00.000Z',
};

const APRES = '2026-06-01T00:00:00.000Z';
const elem = (id: string, path: string) => ({
  id,
  ownerUserId: 'u1',
  itemType: 'file',
  sizeBytes: 1,
  updatedAt: APRES,
  createdAt: APRES,
  meta: { path, fileName: id },
});

describe('LE CHEMIN NOMINAL', () => {
  it('scelle ce qui est arrivé APRÈS le partage, et RIEN de ce qui est exclu', async () => {
    /*
      LE CONTRÔLE POSITIF du refus testé plus bas : sans lui, « aucun appel aux
      accès » serait vrai même si le thunk ne faisait rien du tout.
    */
    const { catchUpFolderShares, resetFolderCatchUp, createItemGrants } =
      await import('../vaultsSlice');
    etat.readable = true;
    etat.intents = [INTENTION];
    resetFolderCatchUp();

    /*
      ON N'INTERCEPTE PAS L'ARGUMENT DU SCELLEMENT, ET C'EST DÉLIBÉRÉ.

      Le thunk que RTK fabrique est une fonction opaque : lui arracher ses
      arguments demanderait de connaître son intérieur. Ce que ce test doit
      établir est ailleurs — que le balayage a LU les accès, TROUVÉ quelqu'un à
      servir, et COMPTÉ ce qui a été scellé. QUELS éléments, c'est la question
      de `planVaultCatchUp`, et elle a ses vingt-deux tests.
    */
    let scellements = 0;
    const dispatch = vi.fn((action: unknown) => {
      // RTK fait passer ses propres `pending` / `fulfilled` par ce même
      // `dispatch` : seuls les THUNKS (des fonctions) sont des scellements.
      if (typeof action === 'function') scellements++;
      return {
        type: createItemGrants.fulfilled.type,
        payload: { granted: ['neuf'], skipped: [], total: 1 },
        meta: { requestStatus: 'fulfilled' },
      };
    });

    const thunk = catchUpFolderShares({ vaultId: 'v1' });
    const r = await (thunk as unknown as (d: unknown, g: unknown) => Promise<unknown>)(
      dispatch,
      scene([elem('neuf', 'Client Dupont'), elem('secret', 'Client Dupont')])
    );

    expect(etat.grantsAppels).toBe(1);
    expect(scellements).toBe(1);
    const bilan = (r as { payload?: { sealed: number; grantees: number } }).payload;
    expect(bilan).toEqual({ vaultId: 'v1', sealed: 1, grantees: 1 });
  });
});

describe('LES REFUS', () => {
  it('un document ILLISIBLE n’entraîne AUCUNE lecture des accès', async () => {
    /*
      LE REFUS CENTRAL. Les exclusions vivent dans ce document. Ne pas savoir
      l'ouvrir, c'est ne pas savoir ce qui a été retiré — rattraper à l'aveugle
      rendrait accessible exactement ce qu'on avait décoché. On s'arrête AVANT
      même de demander les accès du coffre : c'est ce que ce test observe.
    */
    const { catchUpFolderShares, resetFolderCatchUp } = await import('../vaultsSlice');
    etat.readable = false;
    etat.intents = [
      { folderPath: 'X', granteeUserId: 'p', excludedItemIds: [], since: '2020-01-01T00:00:00Z' },
    ];
    resetFolderCatchUp();

    const getState = () => ({
      vaults: {
        vaults: { v1: { id: 'v1', role: 'owner' } },
        unlockedVaultIds: ['v1'],
        itemsByVault: { v1: [{ id: 'a', meta: { path: 'X' }, createdAt: '2026-01-01T00:00:00Z' }] },
      },
    });
    const dispatch = vi.fn();
    const thunk = catchUpFolderShares({ vaultId: 'v1' });
    const r = await (thunk as unknown as (d: unknown, g: unknown) => Promise<unknown>)(
      dispatch,
      getState
    );
    expect(etat.grantsAppels).toBe(0);
    expect((r as { payload?: { sealed: number } }).payload?.sealed ?? 0).toBe(0);
  });
});

describe('UN ÉCHEC DE LECTURE RESTE REJOUABLE', () => {
  it('un document illisible ne consomme PAS la porte « une fois par session »', async () => {
    /*
      MON DÉFAUT, SIGNALÉ PAR LA SESSION MOBILE.

      La marque se posait à l'entrée du thunk. Une première tentative tombant
      sur un coffre verrouillé — ou sur un bloc scellé sous une époque qu'on ne
      détient pas — marquait le coffre « fait », et le rattrapage ne se
      produisait JAMAIS de la session, alors que le déverrouillage qui suivait
      de trois secondes le rendait possible. Chez le mobile, où le coffre
      verrouillé est l'état par défaut, le trou est permanent.
    */
    const { catchUpFolderShares, resetFolderCatchUp, createItemGrants } =
      await import('../vaultsSlice');
    resetFolderCatchUp();
    etat.intents = [INTENTION];

    const jouer = async () => {
      let scellements = 0;
      const dispatch = vi.fn((action: unknown) => {
        if (typeof action === 'function') scellements++;
        return {
          type: createItemGrants.fulfilled.type,
          payload: { granted: ['neuf'], skipped: [], total: 1 },
          meta: { requestStatus: 'fulfilled' },
        };
      });
      const thunk = catchUpFolderShares({ vaultId: 'v1' });
      await (thunk as unknown as (d: unknown, g: unknown) => Promise<unknown>)(
        dispatch,
        scene([elem('neuf', 'Client Dupont')])
      );
      return scellements;
    };

    // Premier passage : illisible. Rien n'est scellé, et rien n'est consommé.
    etat.readable = false;
    expect(await jouer()).toBe(0);

    // Le coffre se déverrouille : le MÊME balayage doit encore pouvoir passer.
    etat.readable = true;
    expect(await jouer()).toBe(1);

    // Et une fois qu'il a lu, la porte se ferme pour de bon.
    expect(await jouer()).toBe(0);
  });
});

describe('LA PORTE EST DU BON CÔTÉ DES LECTURES', () => {
  /*
    Deux fois dans la même journée la marque « fait » a été posée trop tôt :
    avant la lecture des intentions, puis avant celle des accès vivants. Deux
    fois la même faute, corrigée deux fois en déplaçant une ligne.

    Tant que la porte vit à côté du réseau, le PROCHAIN appel ajouté aura le
    même défaut — et il se relira comme correct. La garde vérifie donc la
    STRUCTURE : les lectures sont derrière une seule fonction, et la porte se
    ferme après elle. (Observation de la session mobile, chez qui le découpage
    donnait la propriété gratuitement.)
  */
  const source = (): string =>
    readFileSync(
      fileURLToPath(new URL('../vaultsSlice.ts', (import.meta as unknown as { url: string }).url)),
      'utf8'
    );

  it('le thunk ne lit RIEN lui-même — tout passe par une seule fonction', () => {
    const s = source();
    const debut = s.indexOf('export const catchUpFolderShares = createAsyncThunk(');
    expect(debut).toBeGreaterThan(0);
    const fin = s.indexOf('export const fetchMyInvitations', debut);
    const corps = s.slice(debut, fin > 0 ? fin : undefined);
    expect(corps).toContain('lireLeNecessaireAuRattrapage(args.vaultId, state)');
    // Aucun appel réseau direct : ils vivent tous dans la fonction de lecture.
    expect(corps).not.toContain('loadShareIntents(');
    expect(corps).not.toContain('apiListVaultGrants(');
  });

  it('la porte se ferme APRÈS la lecture, jamais avant', () => {
    const s = source();
    const debut = s.indexOf('export const catchUpFolderShares = createAsyncThunk(');
    const corps = s.slice(debut, debut + 3000);
    const lecture = corps.indexOf('lireLeNecessaireAuRattrapage(');
    const refus = corps.indexOf('if (!lu) return vide;');
    const porte = corps.indexOf('folderCatchUpDone.add(');
    expect(lecture).toBeGreaterThan(-1);
    expect(refus).toBeGreaterThan(lecture);
    expect(porte).toBeGreaterThan(refus);
  });

  it('la fonction de lecture rend `null` sur chaque refus, sans effet de bord', () => {
    // C'est ce `null` qui fait sortir l'appelant avant la porte. S'il devenait
    // un objet vide, la porte se fermerait sur une lecture ratée.
    const s = source();
    const debut = s.indexOf('async function lireLeNecessaireAuRattrapage(');
    expect(debut).toBeGreaterThan(0);
    const corps = s.slice(debut, s.indexOf('export const catchUpFolderShares', debut));
    expect((corps.match(/return null;/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(corps).not.toContain('folderCatchUpDone');
  });
});
