/**
 * pinnedItemModel (F27) — la NOTE ÉPINGLÉE d'un coffre, et les trois choses
 * qu'on a le droit d'en dire.
 *
 * CE QUE CES TESTS GARDENT, ET POURQUOI :
 *
 *  · UN ÉLÉMENT ÉPINGLÉ N'EST PAS UN ÉLÉMENT CACHÉ. C'est une note ordinaire du
 *    coffre, qui se trouve aussi dans l'explorateur ; l'épingle n'est qu'un
 *    identifiant rangé dans le bloc chiffré. Le modèle ne fabrique donc aucune
 *    entité : il ne fait que qualifier un identifiant contre la liste du coffre.
 *
 *  · LES TROIS VERDICTS NE SE VALENT PAS, et les confondre est le travers
 *    récurrent de ce chantier :
 *      — « lisible » : on sait la nommer, on l'ouvre ;
 *      — « illisible sur cet appareil » : on ne sait pas la nommer, et on ne
 *        sait pas non plus si elle existe (liste jamais lue, ou amputée de ce
 *        qu'on n'a pas su déchiffrer) — c'est l'aveu d'ignorance, pas un
 *        verdict ;
 *      — « n'existe plus » : l'identifiant est ABSENT d'une liste qui fait
 *        autorité, et elle seule autorise cette phrase.
 *    Rendre « n'existe plus » sur un silence proposerait de désépingler une note
 *    parfaitement vivante — et, pire, ferait croire à sa disparition.
 *
 *  · L'AUTORITÉ EST CELLE D'`unresolvedItemLabel`, PAS UNE SECONDE. Le fil
 *    d'activité répond déjà à la question « que peut-on dire d'un `item_id`
 *    qu'on n'a pas su nommer ? » ; deux réponses à la même question finiraient
 *    par diverger, et c'est justement l'endroit où l'une des deux affirmerait
 *    une suppression.
 *
 *   npx vitest run src/renderer/components/vaults/settings/__tests__/pinnedItemModel.vitest.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pinnedItemVerdict, mayTogglePin } from '../pinnedItemModel';
import { vaultFileCaps, type VaultCapsContext, type VaultItemLike } from '../../vaultExplorerModel';

const NOMS = new Map<string, string>([['i-1', 'Charte de l’équipe']]);

describe('pinnedItemVerdict — rien d’épinglé ne se dit pas', () => {
  it('aucune épingle : le modèle rend « none », et l’écran ne pose aucune carte', () => {
    expect(
      pinnedItemVerdict({ pinnedItemId: undefined, nameByItemId: NOMS, knownItemIds: null })
    ).toEqual({ kind: 'none' });
    expect(pinnedItemVerdict({ pinnedItemId: '', nameByItemId: NOMS, knownItemIds: null })).toEqual(
      { kind: 'none' }
    );
    // Un bloc qu'on n'a pas su ouvrir ne porte AUCUNE épingle lisible : le
    // décodeur rend un bloc vide, et « none » est alors la seule phrase juste.
    expect(
      pinnedItemVerdict({ pinnedItemId: '   ', nameByItemId: NOMS, knownItemIds: null })
    ).toEqual({ kind: 'none' });
  });
});

describe('pinnedItemVerdict — les trois verdicts', () => {
  it('LISIBLE : on sait la nommer, donc on l’ouvre', () => {
    expect(
      pinnedItemVerdict({
        pinnedItemId: 'i-1',
        nameByItemId: NOMS,
        knownItemIds: new Set(['i-1', 'i-2']),
      })
    ).toEqual({ kind: 'readable', itemId: 'i-1', name: 'Charte de l’équipe' });
  });

  it('ILLISIBLE : la liste n’a pas été lue — on n’accuse RIEN', () => {
    // `knownItemIds === null` veut dire « on n'a pas lu, ou pas tout lu ».
    // Conclure la disparition d'ici est exactement le défaut que ce dossier
    // corrige partout ailleurs.
    expect(
      pinnedItemVerdict({ pinnedItemId: 'i-9', nameByItemId: NOMS, knownItemIds: null })
    ).toEqual({ kind: 'unreadable', itemId: 'i-9' });
  });

  it('ILLISIBLE : elle est là, mais sans nom déchiffrable sur cet appareil', () => {
    // Présente dans la liste qui fait autorité, absente de l'index des noms :
    // c'est un élément dont le titre n'a pas pu être ouvert (ou qui n'en a
    // pas). Il EXISTE — le dire supprimé serait faux.
    expect(
      pinnedItemVerdict({
        pinnedItemId: 'i-2',
        nameByItemId: NOMS,
        knownItemIds: new Set(['i-1', 'i-2']),
      })
    ).toEqual({ kind: 'unreadable', itemId: 'i-2' });
  });

  it('ABSENT : la liste fait autorité et ne le porte pas — là, et là seulement', () => {
    expect(
      pinnedItemVerdict({
        pinnedItemId: 'i-parti',
        nameByItemId: NOMS,
        knownItemIds: new Set(['i-1']),
      })
    ).toEqual({ kind: 'missing', itemId: 'i-parti' });
  });

  it('un NOM sans autorité suffit : nommer, c’est avoir lu cet élément-là', () => {
    // L'index des noms est bâti sur la liste ; un identifiant qu'il porte a bien
    // été déchiffré. On n'a pas besoin de l'ensemble pour l'ouvrir.
    expect(
      pinnedItemVerdict({ pinnedItemId: 'i-1', nameByItemId: NOMS, knownItemIds: null })
    ).toEqual({ kind: 'readable', itemId: 'i-1', name: 'Charte de l’équipe' });
  });
});

describe('mayTogglePin — qui a le droit d’épingler, et sur quoi', () => {
  it('réservé aux administrateurs du coffre', () => {
    expect(mayTogglePin({ role: 'admin', folderMarker: false })).toBe(true);
    expect(mayTogglePin({ role: 'owner', folderMarker: false })).toBe(true);
    expect(mayTogglePin({ role: 'member', folderMarker: false })).toBe(false);
    expect(mayTogglePin({ role: 'viewer', folderMarker: false })).toBe(false);
  });

  it('jamais sur un marqueur de dossier — il n’y a rien à ouvrir', () => {
    expect(mayTogglePin({ role: 'admin', folderMarker: true })).toBe(false);
  });

  it('UN COFFRE GELÉ S’ÉPINGLE ENCORE : les réglages ne sont pas du contenu', () => {
    // Le worker ne gèle que les écritures de CONTENU (409 `vault_frozen`) ;
    // `PUT /settings` n'en fait pas partie. Retirer le geste ici inventerait une
    // interdiction que le serveur n'applique pas.
    //
    // ON INTERROGE LA MATRICE, PAS `mayTogglePin`. La fonction a porté un
    // `frozen?` qu'elle ne lisait JAMAIS : lui passer `frozen: true` et voir
    // `true` ne prouvait rien — le paramètre était mort, et le test « gardait »
    // un champ décoratif. La règle réelle est l'absence de `&& !ctx.frozen`
    // autour de `pin`/`unpin` dans `vaultFileCaps` : c'est ce que le menu
    // contextuel consulte, donc c'est ce qu'il faut éprouver. Le paramètre a été
    // retiré ; le garde, lui, tape enfin au bon endroit.
    const gele: VaultCapsContext = {
      role: 'admin',
      myUserId: 'u1',
      restrictDownload: false,
      externalSharesDisabled: false,
      searching: false,
      frozen: true,
    };
    const note: VaultItemLike = {
      id: 'i-1',
      ownerUserId: 'u1',
      itemType: 'note',
      sizeBytes: 10,
      updatedAt: '2026-08-29T10:00:00Z',
      meta: { title: 'Charte' },
    };
    expect(vaultFileCaps(note, gele, false).pin).toBe(true);
    expect(vaultFileCaps(note, { ...gele, pinnedItemId: 'i-1' }, false).unpin).toBe(true);
    // Et l'écriture de CONTENU, elle, reste bien fermée : la preuve que `frozen`
    // est réellement transmis et lu par la matrice.
    expect(vaultFileCaps(note, gele, false).rename).toBe(false);
  });
});

/**
 * « N'EXISTE PLUS » ÉTAIT ENCORE UN VERDICT DE TROP — LE CAS LE PLUS PROBABLE
 * EST LA CORBEILLE.
 *
 * `authoritativeItemIds` est bâti sur `itemsByVault`, alimenté par
 * `loadVaultItems` → `apiListVaultItems` ; et le worker filtre `deleted_at IS
 * NULL`. Un élément MIS À LA CORBEILLE quitte donc la liste tout de suite — mais
 * il existe encore : la suppression est réversible pendant `trashRetentionDays`
 * (`GET /vaults/:id/items/deleted`, `restoreVaultItem`, le volet corbeille de
 * l'explorateur), et ses octets comptent toujours dans le quota du coffre.
 *
 * C'est le scénario le PLUS courant des trois — un administrateur supprime la
 * note épinglée — et l'écran y répondait par la seule phrase définitive du
 * modèle (« l'élément épinglé n'existe plus ») accompagnée du geste destructeur
 * « Désépingler », après quoi restaurer la note ne ramenait pas l'épingle.
 * L'en-tête du module promet pourtant l'inverse : « elle reste dans son dossier,
 * dans l'explorateur, dans la corbeille si on l'y met ».
 *
 * LE VERDICT NE CHANGE PAS — l'identifiant est bien absent d'une liste qui fait
 * autorité, et « Désépingler » reste légitime dans les deux cas. C'est la PHRASE
 * qui devient vraie des deux : « il n'est plus dans le coffre » couvre la
 * corbeille comme la purge, là où « il n'existe plus » ne couvre que la seconde.
 */
describe('teamVaults.pinned.missing — la phrase ne condamne pas une note à la corbeille', () => {
  const locale = (lang: 'en' | 'fr'): Record<string, unknown> =>
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../../../../i18n/locales', lang, 'translation.json'),
        'utf8'
      )
    );
  const missing = (lang: 'en' | 'fr'): string => {
    const j = locale(lang) as {
      teamVaults: { pinned: { missing: string } };
    };
    return j.teamVaults.pinned.missing;
  };

  it('EN : dit « plus dans le coffre », et nomme la corbeille', () => {
    const s = missing('en');
    expect(s.toLowerCase()).toContain('trash');
    expect(s.toLowerCase()).not.toContain('no longer exists');
  });

  it('FR : dit « plus dans le coffre », et nomme la corbeille', () => {
    const s = missing('fr');
    expect(s.toLowerCase()).toContain('corbeille');
    expect(s).not.toContain('n’existe plus');
    expect(s).not.toContain("n'existe plus");
  });
});
