/**
 * grantOverviewModel (F17) — la seule fuite « hors membres » d'un coffre, mise
 * à plat.
 *
 * CE QUE CES TESTS GARDENT :
 *
 *  · ON NE MASQUE JAMAIS UNE LIGNE. Un accès dont on ne sait pas nommer
 *    l'élément (coffre verrouillé, élément purgé, méta illisible) reste À
 *    L'ÉCRAN, avec sa personne et son bouton Révoquer. Le filtrer serait faire
 *    disparaître exactement l'accès qu'on ne comprend pas — c'est-à-dire le plus
 *    inquiétant des trois.
 *
 *  · UNE ABSENCE D'INFORMATION N'EST PAS UN VERDICT. « L'élément a été
 *    supprimé » ne se conclut que d'une liste RÉELLEMENT lue. Un coffre jamais
 *    ouvert n'a aucun élément en mémoire : y lire « supprimé » sur les cinq
 *    accès vivants serait le mensonge le plus rassurant possible. Même règle que
 *    `unresolvedItemLabel`, `inSpace` (F08) et `wrappedEpoch` (F10).
 *
 *  · LE RÉSUMÉ COMPTE DES ÉLÉMENTS, PAS DES ACCÈS. « 4 éléments partagés à
 *    2 personnes » : deux personnes sur le même fichier font UN élément partagé,
 *    pas deux. Compter les lignes gonflerait le chiffre exactement dans le cas
 *    qu'on cherche à surveiller. Sa troisième clause, elle, compte des ACCÈS
 *    (deux extérieurs qui perdent le même fichier vendredi = deux échéances) :
 *    c'est la phrase i18n qui nomme l'unité, « N accès expirent cette semaine ».
 *
 *  · LA ROUTE NE SERT QUE DES ACCÈS VIVANTS (`expires_at > now` côté serveur) :
 *    « expiré » ne peut donc apparaître qu'entre la lecture et l'affichage, et
 *    « cette semaine » veut dire « expire dans les sept jours », jamais « a
 *    expiré ».
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/grantOverviewModel.vitest.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  authoritativeItemIds,
  buildGrantOverview,
  grantSummaryCounts,
} from '../grantOverviewModel';
import type { VaultGrantDTO } from '../../../../../services/vault/vaultApi';

const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);
const jours = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

const grant = (over: Partial<VaultGrantDTO> & Pick<VaultGrantDTO, 'grantId'>): VaultGrantDTO => ({
  itemId: 'i-1',
  granteeUserId: 'u-1',
  granteeEmail: 'ada@example.com',
  role: 'viewer',
  expiresAt: null,
  wrappedForVersion: 1,
  itemVersion: 1,
  stale: false,
  createdAt: new Date(NOW - 86_400_000).toISOString(),
  ...over,
});

const ctx = (over?: Partial<Parameters<typeof buildGrantOverview>[0]>) => ({
  grants: [] as VaultGrantDTO[],
  nowMs: NOW,
  titleByItemId: new Map<string, string>(),
  knownItemIds: new Set<string>(),
  ...over,
});

describe('le groupement', () => {
  it('groupe par PERSONNE puis par élément, et garde l’identifiant opaque à côté du nom', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({ grantId: 'g1', itemId: 'i-1', granteeUserId: 'u-1' }),
          grant({ grantId: 'g2', itemId: 'i-2', granteeUserId: 'u-1' }),
          grant({ grantId: 'g3', itemId: 'i-1', granteeUserId: 'u-2', granteeEmail: 'bo@x.io' }),
        ],
        titleByItemId: new Map([
          ['i-1', 'rapport.pdf'],
          ['i-2', 'notes.md'],
        ]),
        knownItemIds: new Set(['i-1', 'i-2']),
      })
    );
    expect(o.people).toHaveLength(2);
    const ada = o.people.find((p) => p.userId === 'u-1');
    expect(ada?.email).toBe('ada@example.com');
    expect(ada?.label).toBe('ada@example.com');
    expect(ada?.items.map((i) => i.title)).toEqual(['rapport.pdf', 'notes.md']);
    expect(ada?.items.map((i) => i.itemId)).toEqual(['i-1', 'i-2']);
  });

  it('sans adresse, la personne garde un libellé lisible tiré de son identifiant', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [grant({ grantId: 'g1', granteeUserId: 'abcdef01-2345', granteeEmail: null })],
      })
    );
    expect(o.people[0].email).toBeNull();
    expect(o.people[0].label).toBe('abcdef01');
  });

  it('les personnes sont triées par adresse — un ordre stable d’un rendu à l’autre', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({ grantId: 'g1', granteeUserId: 'u-z', granteeEmail: 'zoe@x.io' }),
          grant({ grantId: 'g2', granteeUserId: 'u-a', granteeEmail: 'ada@x.io' }),
        ],
      })
    );
    expect(o.people.map((p) => p.userId)).toEqual(['u-a', 'u-z']);
  });
});

describe('nommer l’élément — ou dire honnêtement qu’on ne sait pas', () => {
  it('un élément non nommable reste AFFICHÉ, marqué illisible', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [grant({ grantId: 'g1', itemId: 'i-9' })],
        knownItemIds: new Set(['i-9']),
      })
    );
    expect(o.people[0].items).toHaveLength(1);
    expect(o.people[0].items[0].title).toBeNull();
    expect(o.people[0].items[0].unreadable).toBe(true);
    expect(o.people[0].items[0].orphaned).toBe(false);
  });

  it('un élément ABSENT d’une liste réellement lue est un orphelin', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [grant({ grantId: 'g1', itemId: 'i-parti' })],
        knownItemIds: new Set(['i-1']),
      })
    );
    expect(o.people[0].items[0].orphaned).toBe(true);
    expect(o.summary.orphanCount).toBe(1);
  });

  it('LISTE NON LUE (coffre verrouillé) : personne n’est déclaré orphelin', () => {
    const o = buildGrantOverview(
      ctx({ grants: [grant({ grantId: 'g1', itemId: 'i-parti' })], knownItemIds: null })
    );
    expect(o.people[0].items[0].orphaned).toBe(false);
    expect(o.people[0].items[0].unreadable).toBe(true);
    expect(o.summary.orphanCount).toBe(0);
  });
});

describe('l’expiration', () => {
  it('sans date, l’accès ne meurt jamais tout seul — et le dit', () => {
    const o = buildGrantOverview(ctx({ grants: [grant({ grantId: 'g1', expiresAt: null })] }));
    expect(o.people[0].items[0].expiresAt).toBeNull();
    expect(o.people[0].items[0].expiringThisWeek).toBe(false);
    expect(o.people[0].items[0].expired).toBe(false);
  });

  it('« cette semaine » = dans les sept jours qui viennent, bornes comprises', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({ grantId: 'g1', itemId: 'i-1', expiresAt: jours(3) }),
          grant({ grantId: 'g2', itemId: 'i-2', expiresAt: jours(7) }),
          grant({ grantId: 'g3', itemId: 'i-3', expiresAt: jours(8) }),
        ],
      })
    );
    const parId = new Map(o.people[0].items.map((i) => [i.grantId, i.expiringThisWeek]));
    expect(parId.get('g1')).toBe(true);
    expect(parId.get('g2')).toBe(true);
    expect(parId.get('g3')).toBe(false);
    expect(o.summary.expiringThisWeek).toBe(2);
  });

  it('une date déjà passée (course entre la lecture et l’affichage) se dit expirée, pas « cette semaine »', () => {
    const o = buildGrantOverview(ctx({ grants: [grant({ grantId: 'g1', expiresAt: jours(-1) })] }));
    expect(o.people[0].items[0].expired).toBe(true);
    expect(o.people[0].items[0].expiringThisWeek).toBe(false);
    expect(o.summary.expiringThisWeek).toBe(0);
  });

  it('une date illisible ne fabrique NI expiration NI panique', () => {
    const o = buildGrantOverview(
      ctx({ grants: [grant({ grantId: 'g1', expiresAt: 'pas-une-date' })] })
    );
    expect(o.people[0].items[0].expiresAt).toBeNull();
    expect(o.people[0].items[0].expired).toBe(false);
  });
});

describe('« à réparer »', () => {
  it('le verdict vient du SERVEUR, jamais recalculé ici', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({
            grantId: 'g1',
            itemId: 'i-1',
            stale: true,
            wrappedForVersion: 1,
            itemVersion: 4,
          }),
          grant({
            grantId: 'g2',
            itemId: 'i-2',
            stale: false,
            wrappedForVersion: 9,
            itemVersion: 1,
          }),
        ],
      })
    );
    const parId = new Map(o.people[0].items.map((i) => [i.grantId, i.stale]));
    expect(parId.get('g1')).toBe(true);
    expect(parId.get('g2')).toBe(false);
    expect(o.people[0].staleCount).toBe(1);
    expect(o.summary.staleCount).toBe(1);
  });

  it('un orphelin n’est pas RÉPARABLE : il n’y a plus d’élément à resceller', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [grant({ grantId: 'g1', itemId: 'i-parti', stale: true })],
        knownItemIds: new Set(['i-1']),
      })
    );
    expect(o.people[0].items[0].repairable).toBe(false);
  });

  it('un stale dont l’élément est là EST réparable', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [grant({ grantId: 'g1', itemId: 'i-1', stale: true })],
        knownItemIds: new Set(['i-1']),
      })
    );
    expect(o.people[0].items[0].repairable).toBe(true);
  });
});

describe('le résumé', () => {
  it('compte des ÉLÉMENTS distincts, pas des accès', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({ grantId: 'g1', itemId: 'i-1', granteeUserId: 'u-1' }),
          grant({ grantId: 'g2', itemId: 'i-1', granteeUserId: 'u-2', granteeEmail: 'b@x.io' }),
          grant({ grantId: 'g3', itemId: 'i-2', granteeUserId: 'u-1' }),
        ],
      })
    );
    expect(o.summary.itemCount).toBe(2);
    expect(o.summary.personCount).toBe(2);
    expect(o.summary.grantCount).toBe(3);
  });

  it('aucun accès : la section est VIDE et ne prétend rien', () => {
    const o = buildGrantOverview(ctx());
    expect(o.empty).toBe(true);
    expect(o.people).toEqual([]);
    expect(grantSummaryCounts(o)).toEqual({
      items: 0,
      people: 0,
      expiring: 0,
    });
  });

  it('les trois nombres de la phrase sortent du MÊME calcul que la liste', () => {
    const o = buildGrantOverview(
      ctx({
        grants: [
          grant({ grantId: 'g1', itemId: 'i-1', granteeUserId: 'u-1', expiresAt: jours(2) }),
          grant({ grantId: 'g2', itemId: 'i-2', granteeUserId: 'u-2', granteeEmail: 'b@x.io' }),
        ],
      })
    );
    expect(grantSummaryCounts(o)).toEqual({ items: 2, people: 2, expiring: 1 });
    expect(o.empty).toBe(false);
  });
});

/**
 * L'EFFET DE CHARGEMENT, CONFRONTÉ À SA SOURCE.
 *
 * Le modèle ci-dessus est pur ; l'écran qui le nourrit ne l'est pas, et vitest
 * ne monte pas de composant (environnement `node`). Or le défaut le plus cher de
 * cette section ne vit pas dans le modèle : c'est une BOUCLE DE REQUÊTES.
 * `loadVaultItems.fulfilled` réassigne `itemsByVault[vaultId]` — donc un tableau
 * NEUF à chaque tour, donc une Map de titres neuve — si bien qu'un effet
 * dépendant de ces titres et conditionné à leur nombre se redéclenche sans fin
 * sur tout coffre qui n'a encore aucun élément nommable : exactement le parcours
 * principal (créer un coffre partagé, ouvrir « Gérer le coffre », onglet
 * Membres). La condition porte donc sur la LISTE RÉELLEMENT LUE, qui passe de
 * `null` à un Set une seule fois et n'y revient jamais.
 *
 * Ce garde-fou lit le fichier parce que c'est la seule autorité disponible ici :
 * une parité entre deux dérivés ne garderait rien.
 */
describe('VaultGrantsSection : l’effet qui charge les noms', () => {
  const source = fs.readFileSync(path.join(__dirname, '../VaultGrantsSection.tsx'), 'utf8');

  it('se déclenche sur la LISTE LUE (null → Set), jamais sur les titres', () => {
    expect(source).toContain(
      'if (knownItemIds === null) void dispatch(loadVaultItems({ vaultId }));'
    );
  });

  it('ne prend PAS les titres en dépendance — la boucle de requêtes est fermée', () => {
    const apres = source.split('void dispatch(loadVaultItems({ vaultId }))')[1];
    expect(apres).toBeDefined();
    const deps = apres.split('}, [')[1].split(']')[0];
    expect(deps).not.toContain('nameByItemId');
    expect(deps).toContain('knownItemIds');
  });
});

/**
 * LA PAGE DEMANDE LA LISTE ELLE-MÊME — SINON L'APERÇU JUGE SUR SON IGNORANCE.
 *
 * Le défaut, vécu : `VaultSettingsView` LIT `itemsByVault[vaultId]` (les noms,
 * l'autorité) mais ne le DEMANDAIT jamais. Le seul appelant de `loadVaultItems`
 * sur cette page vivait dans `VaultGrantsSection`, montée dans l'onglet MEMBRES.
 * Or `RouteContent` monte la page de gestion SEULE (`?view=settings`) et le menu
 * de la carte de coffre y envoie directement : sur ce chemin — le chemin
 * normal — `items` valait `undefined`, donc `knownItemIds` valait `null` et
 * `nameByItemId` était vide. La carte de la note épinglée rendait alors
 * « Épinglée, illisible sur cet appareil (8 car.) » sans aucun geste, pour une
 * note parfaitement lisible ; elle n'atteignait `readable` que si l'on avait
 * ouvert l'explorateur du coffre plus tôt dans la MÊME session.
 *
 * Le verdict n'était pas faux — c'est bien l'aveu d'ignorance, et il vaut mieux
 * que « n'existe plus ». Mais il était rendu sur une ignorance que la page
 * pouvait lever en une ligne, et une ignorance évitable n'est pas une excuse.
 *
 * C'EST LE MÊME EFFET, MOT POUR MOT, que celui de `VaultGrantsSection` — même
 * garde `=== null` (identique d'un tour à l'autre, donc la boucle de requêtes
 * reste fermée des deux côtés), même dépendances.
 */
describe('VaultSettingsView : la page CHARGE la liste qu’elle juge', () => {
  const vue = fs.readFileSync(path.join(__dirname, '../VaultSettingsView.tsx'), 'utf8');

  it('dispatche `loadVaultItems` — l’Aperçu ne dépend plus d’un autre onglet', () => {
    expect(vue).toContain('if (knownItemIds === null) void dispatch(loadVaultItems({ vaultId }));');
  });

  it('la garde porte sur la LISTE LUE, jamais sur les titres', () => {
    const apres = vue.split('void dispatch(loadVaultItems({ vaultId }))')[1];
    expect(apres).toBeDefined();
    const deps = apres.split('}, [')[1].split(']')[0];
    expect(deps).not.toContain('nameByItemId');
    expect(deps).toContain('knownItemIds');
  });
});

/**
 * QUI FAIT AUTORITÉ SUR « CET ÉLÉMENT EXISTE ENCORE ».
 *
 * La règle 2 du modèle (« une absence d'information n'est pas un verdict ») ne
 * vaut que si `knownItemIds` dit bien ce qu'il prétend : les éléments qui
 * EXISTENT, pas ceux qu'on a SU DÉCHIFFRER. Or `loadVaultItems` saute en silence
 * tout élément scellé sous une époque dont il n'a pas ramené la clé — réseau,
 * historique refusé — et se résout QUAND MÊME : la liste servie à l'écran est
 * alors AMPUTÉE, et n'en dit rien. Prise pour argent comptant, elle faisait
 * afficher « cet élément n'existe plus » sur un accès vivant, et retirait du
 * même coup le bouton « Réparer » (un `stale` n'est réparable que si son élément
 * est là) — précisément sur les accès les plus susceptibles d'être stale, ceux
 * d'un fichier qu'on ne touche plus, donc resté sous une époque ancienne.
 *
 * Les deux garde-fous ci-dessous se tiennent par la main : le premier établit
 * que la liste PEUT être partielle (c'est l'autorité, `vaultsSlice`), le second
 * que l'écran refuse alors de conclure. Enlever le premier ferait du second une
 * précaution sans objet ; enlever le second ramènerait le mensonge.
 */
describe('VaultSettingsView : la liste des éléments et son autorité', () => {
  const slice = fs.readFileSync(
    path.join(__dirname, '../../../../../store/slices/vaultsSlice.ts'),
    'utf8'
  );
  const vue = fs.readFileSync(path.join(__dirname, '../VaultSettingsView.tsx'), 'utf8');

  it('la liste du store PEUT être partielle : un élément indéchiffrable est SAUTÉ et seulement compté', () => {
    expect(slice).toContain('undecryptable++');
    expect(slice).toContain('undecryptable: action.payload.undecryptable');
  });

  it('un seul élément indéchiffrable retire son autorité à la liste (null, jamais un Set amputé)', () => {
    expect(authoritativeItemIds([{ id: 'i-1' }, { id: 'i-2' }], { undecryptable: 1 })).toBeNull();
  });

  it('liste lue et intégralement déchiffrée ⇒ elle fait autorité', () => {
    const set = authoritativeItemIds([{ id: 'i-1' }, { id: 'i-2' }], { undecryptable: 0 });
    expect(set && [...set]).toEqual(['i-1', 'i-2']);
  });

  it('liste jamais lue (coffre verrouillé, jamais ouvert) ⇒ personne n’est orphelin', () => {
    expect(authoritativeItemIds(undefined, undefined)).toBeNull();
    expect(authoritativeItemIds(undefined, { undecryptable: 0 })).toBeNull();
  });

  /**
   * LE TROU QUE `?? 0` LAISSAIT OUVERT, ET IL VIT DANS LE STORE.
   *
   * `itemsByVault[vaultId]` n'appartient PAS à `loadVaultItems` tout seul :
   * `addVaultItem.fulfilled` et `updateVaultItem.fulfilled` le CRÉENT à partir
   * d'un seul élément quand il n'existe pas encore, et aucun des deux ne pose
   * `decryptStatusByVault`. Une liste d'UN élément se présentait alors comme
   * complète — « zéro indéchiffrable », faute de compte-rendu — et tous les
   * autres accès du coffre étaient déclarés orphelins : le mensonge que la
   * règle 2 interdit, par le chemin qu'elle n'avait pas regardé. Un
   * compte-rendu ABSENT n'est pas un compte-rendu à zéro.
   */
  it('liste présente mais SANS compte-rendu de déchiffrement ⇒ elle ne fait pas autorité', () => {
    expect(authoritativeItemIds([{ id: 'i-1' }], undefined)).toBeNull();
  });

  it('le store PEUT poser une liste sans compte-rendu (c’est l’autorité qui le dit)', () => {
    // `addVaultItem.fulfilled` écrit `itemsByVault` et rien d'autre : la preuve
    // que le cas ci-dessus n'est pas théorique.
    const bloc = slice.split('.addCase(addVaultItem.fulfilled')[1]?.split('.addCase(')[0];
    expect(bloc).toBeDefined();
    expect(bloc).toContain('state.itemsByVault[item.vaultId]');
    expect(bloc).not.toContain('decryptStatusByVault');
  });

  it('la vue délègue à l’autorité plutôt que de refaire le calcul à la main', () => {
    const memo = vue.split('const knownItemIds = useMemo(')[1]?.split('\n  );')[0];
    expect(memo).toBeDefined();
    expect(memo).toContain('authoritativeItemIds(');
    // Le `?? 0` d'avant faisait passer une ABSENCE de compte-rendu pour un
    // zéro : la vue ne doit plus porter ce raccourci.
    expect(memo).not.toContain('?? 0');
  });
});
