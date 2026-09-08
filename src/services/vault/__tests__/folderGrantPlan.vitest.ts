/**
 * Le RATTRAPAGE d'un dossier partagé — ce qui manque après coup.
 *
 * Le CHOIX des éléments n'est pas testé ici : il vit dans `shareItemPicker` et
 * fonctionne depuis longtemps. Ces tests portent sur l'après, c'est-à-dire sur
 * un fichier déposé dans le dossier une fois le partage fait.
 *
 * Le mode d'échec à craindre n'est pas un mauvais calcul : c'est un écart entre
 * le geste et son effet, qui se voit des mois plus tard, quand quelqu'un lit un
 * document qu'on croyait avoir retiré.
 */

import { describe, it, expect } from 'vitest';
import {
  planFolderCatchUp,
  planVaultCatchUp,
  type CatchUpItem,
  type FolderShareIntent,
} from '../folderGrantPlan';
import type { VaultItemLike } from '../../../renderer/components/vaults/vaultExplorerModel';

/** L'instant du partage. Tout ce qui existait AVANT est réputé déjà arbitré. */
const PARTAGE = '2026-09-07T12:00:00.000Z';
const AVANT = '2026-09-01T00:00:00.000Z';
const APRES = '2026-09-08T00:00:00.000Z';

const item = (
  id: string,
  path: string,
  meta: Partial<VaultItemLike['meta']> = {},
  createdAt: string = AVANT
): CatchUpItem => ({
  id,
  ownerUserId: 'u1',
  itemType: 'file',
  sizeBytes: 10,
  createdAt,
  updatedAt: '2026-09-07T00:00:00.000Z',
  meta: { path, fileName: id, ...meta },
});

const coffre: CatchUpItem[] = [
  item('racine', ''),
  item('contrat', 'Client Dupont'),
  item('devis', 'Client Dupont'),
  item('interne', 'Client Dupont'),
  item('annexe', 'Client Dupont/Annexes'),
  item('autre', 'Client Martin'),
];

const intention = (over: Partial<FolderShareIntent> = {}): FolderShareIntent => ({
  folderPath: 'Client Dupont',
  granteeUserId: 'marie',
  excludedItemIds: ['interne'],
  since: PARTAGE,
  ...over,
});

/** Ce que Marie possède après le partage initial : tout sauf l'exclu. */
const DEJA = ['contrat', 'devis', 'annexe'];

describe('rien de neuf, rien à sceller', () => {
  it('ne rend aucun élément quand le dossier n’a pas bougé', () => {
    expect(planFolderCatchUp(coffre, intention(), DEJA)).toEqual([]);
  });
});

describe('un fichier ajouté depuis', () => {
  it('est le seul rendu', () => {
    const avecNouveau = [...coffre, item('avenant', 'Client Dupont', {}, APRES)];
    expect(planFolderCatchUp(avecNouveau, intention(), DEJA)).toEqual(['avenant']);
  });

  it('compte aussi dans un sous-dossier', () => {
    const avecNouveau = [...coffre, item('annexe-2', 'Client Dupont/Annexes', {}, APRES)];
    expect(planFolderCatchUp(avecNouveau, intention(), DEJA)).toEqual(['annexe-2']);
  });

  it('mais pas dans un dossier VOISIN', () => {
    const avecVoisin = [...coffre, item('facture-martin', 'Client Martin', {}, APRES)];
    expect(planFolderCatchUp(avecVoisin, intention(), DEJA)).toEqual([]);
  });
});

describe('LA RÉGRESSION À NE JAMAIS ROUVRIR : les exclusions survivent', () => {
  it('un élément décoché ne revient JAMAIS par le rattrapage', () => {
    /*
      Le pire défaut possible : rendre accessible un document explicitement
      retiré. Silencieux, différé, contraire au geste — l'utilisateur a décoché
      ce fichier une fois et ne reviendra pas vérifier.
    */
    expect(planFolderCatchUp(coffre, intention(), DEJA)).not.toContain('interne');
  });

  it('même quand il vient d’être modifié, et même seul de son dossier', () => {
    const seulementLExclu = [item('interne', 'Client Dupont')];
    expect(planFolderCatchUp(seulementLExclu, intention(), [])).toEqual([]);
  });

  it('un élément ANTÉRIEUR sans accès n’est jamais scellé — révoqué ou décoché, on ne sait pas', () => {
    /*
      LA GARANTIE STRUCTURELLE. Au partage, tout le contenu non décoché a reçu
      un accès. Un élément antérieur SANS accès a donc été soit décoché, soit
      révoqué — les deux disent « non ». La borne de date l'écarte sans qu'on
      ait besoin de savoir lequel des deux, et donc SANS dépendre d'une
      révocation qui aurait oublié d'écrire son exclusion.
    */
    const revoqueEnSilence = [item('devis', 'Client Dupont')]; // antérieur, sans accès, sans exclusion
    expect(planFolderCatchUp(revoqueEnSilence, intention({ excludedItemIds: [] }), [])).toEqual([]);
  });

  it('mais un élément POSTÉRIEUR révoqué a besoin de son exclusion', () => {
    // Le cas que la date ne couvre pas : arrivé après, scellé par un
    // rattrapage, puis révoqué. Seule l'exclusion le retient.
    const nouveau = [item('avenant', 'Client Dupont', {}, APRES)];
    expect(planFolderCatchUp(nouveau, intention({ excludedItemIds: ['avenant'] }), [])).toEqual([]);
    expect(planFolderCatchUp(nouveau, intention({ excludedItemIds: [] }), [])).toEqual(['avenant']);
  });

  it('une date ILLISIBLE ne vaut pas « récent » — on ne scelle rien', () => {
    const cassee = [item('bizarre', 'Client Dupont', {}, 'pas-une-date')];
    expect(planFolderCatchUp(cassee, intention({ excludedItemIds: [] }), [])).toEqual([]);
  });

  /*
    UN TEST A DISPARU ICI, ET SA DISPARITION EST LE PROGRÈS.

    Il affirmait : « une intention sans exclusion rattrape tout, d'où
    l'obligation de la mémoriser ». C'était vrai quand le rattrapage ne
    regardait que les exclusions — perdre l'intention rouvrait les accès
    retirés, et le test rendait cette fragilité visible.

    La borne de date l'a supprimée. Une intention amputée de ses exclusions ne
    rouvre plus rien pour les éléments ANTÉRIEURS : ils sont écartés par leur
    date, quelle que soit la mémoire. Les deux tests ci-dessus disent
    exactement où la protection tient toute seule et où l'exclusion reste
    indispensable.

    On ne garde pas un test qui décrit une fragilité qu'on vient de retirer :
    il passerait au rouge en défendant le pire des deux mondes.
  */
});

describe('ce qui n’est pas du contenu', () => {
  it('un marqueur de dossier n’est jamais scellé', () => {
    const avecMarqueur = [
      ...coffre,
      item('dossier-vide', 'Client Dupont', { folderMarker: true }, APRES),
    ];
    expect(planFolderCatchUp(avecMarqueur, intention(), DEJA)).toEqual([]);
  });

  it('un fil de discussion non plus', () => {
    // Même règle que `folderGrantRollup`, et c'est le POINT : les deux passent
    // par `isShareableUnder`. Deux définitions divergeraient sans qu'on le voie
    // — l'une compterait un élément que l'autre partagerait.
    const avecFil = [...coffre, item('fil', 'Client Dupont', { threadFor: 'contrat' }, APRES)];
    expect(planFolderCatchUp(avecFil, intention(), DEJA)).toEqual([]);
  });
});

describe('la cible', () => {
  it('un chemin non normalisé vise le même dossier', () => {
    const avecNouveau = [...coffre, item('avenant', 'Client Dupont', {}, APRES)];
    const p = planFolderCatchUp(avecNouveau, intention({ folderPath: '/Client Dupont/' }), DEJA);
    expect(p).toEqual(['avenant']);
  });

  it('la racine rattrape tout le coffre — mais seulement ce qui est POSTÉRIEUR', () => {
    // Le coffre de référence est entièrement antérieur au partage : rien à
    // rattraper, même à la racine, même sans exclusion.
    expect(
      planFolderCatchUp(coffre, intention({ folderPath: '', excludedItemIds: [] }), [])
    ).toEqual([]);
    const avecNouveau = [...coffre, item('neuf', '', {}, APRES)];
    expect(
      planFolderCatchUp(avecNouveau, intention({ folderPath: '', excludedItemIds: [] }), [])
    ).toEqual(['neuf']);
  });

  it('la casse compte — « client dupont » n’est pas « Client Dupont »', () => {
    // Décision assumée de `vaultPaths` : deux dossiers distincts. Un rattrapage
    // qui les confondrait scellerait des accès dans le mauvais.
    expect(planFolderCatchUp(coffre, intention({ folderPath: 'client dupont' }), [])).toEqual([]);
  });
});

/*
  ─────────────────────────────────────────────────────────────────────────────
  LE RATTRAPAGE DU COFFRE ENTIER — plusieurs intentions, plusieurs personnes.
  ─────────────────────────────────────────────────────────────────────────────

  `planFolderCatchUp` traite une intention. Les composer n'est pas une boucle :
  deux intentions de la MÊME personne peuvent se recouvrir, et la seconde ne
  connaît pas ce que la première avait retiré. Ces tests portent d'abord sur ce
  recouvrement — c'est là que la fuite se produirait.
*/

const APRES2 = '2026-09-09T00:00:00.000Z';

/** Un coffre où un fichier retiré vit dans un SOUS-dossier repartagé ensuite. */
const coffreRecouvrant: CatchUpItem[] = [
  item('contrat', 'Client Dupont', {}, APRES),
  item('secret', 'Client Dupont/Annexes', {}, APRES),
  item('annexe', 'Client Dupont/Annexes', {}, APRES),
];

describe('DEUX INTENTIONS QUI SE RECOUVRENT', () => {
  it('une exclusion vaut pour la PERSONNE, pas pour l’intention qui la porte', () => {
    /*
      LE DÉFAUT QUE CE TEST FERME, ET IL EST SILENCIEUX.

      « Client Dupont » partagé avec Marie sauf `secret`. Plus tard,
      « Client Dupont/Annexes » — où vit `secret` — partagé avec elle sans rien
      décocher. Une boucle naïve scelle `secret` : le geste de retrait est
      défait par un partage voisin, des semaines après, sans que personne ne
      regarde.
    */
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [
        intention({ folderPath: 'Client Dupont', excludedItemIds: ['secret'] }),
        intention({ folderPath: 'Client Dupont/Annexes', excludedItemIds: [] }),
      ],
      []
    );
    expect(plan).toEqual([{ granteeUserId: 'marie', itemIds: ['contrat', 'annexe'] }]);
  });

  it('l’union ne DOUBLE pas un élément couvert par les deux', () => {
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [
        intention({ folderPath: 'Client Dupont', excludedItemIds: [] }),
        intention({ folderPath: 'Client Dupont/Annexes', excludedItemIds: [] }),
      ],
      []
    );
    expect(plan[0].itemIds).toEqual(['contrat', 'secret', 'annexe']);
  });

  it('l’exclusion d’une personne ne s’applique PAS à une autre', () => {
    // Retirer un fichier à Marie ne le retire pas à Paul : ce sont deux gestes.
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [
        intention({ granteeUserId: 'marie', excludedItemIds: ['secret'] }),
        intention({ granteeUserId: 'paul', excludedItemIds: [] }),
      ],
      []
    );
    // « Client Dupont » couvre aussi ses sous-dossiers : Paul reçoit tout,
    // Marie tout sauf ce qu'ELLE avait vu retirer.
    expect(plan).toEqual([
      { granteeUserId: 'marie', itemIds: ['contrat', 'annexe'] },
      { granteeUserId: 'paul', itemIds: ['contrat', 'secret', 'annexe'] },
    ]);
  });
});

describe('ce que le coffre porte DÉJÀ', () => {
  it('un accès vivant écarte l’élément — on ne rescelle pas', () => {
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [intention({ excludedItemIds: [] })],
      [
        { itemId: 'contrat', granteeUserId: 'marie' },
        { itemId: 'secret', granteeUserId: 'marie' },
      ]
    );
    expect(plan).toEqual([{ granteeUserId: 'marie', itemIds: ['annexe'] }]);
  });

  it('un accès vivant d’UNE AUTRE personne n’écarte rien', () => {
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [intention({ excludedItemIds: [] })],
      [{ itemId: 'contrat', granteeUserId: 'paul' }]
    );
    expect(plan[0].itemIds).toEqual(['contrat', 'secret', 'annexe']);
  });

  it('tout est à jour → aucune personne rendue, donc AUCUN appel réseau', () => {
    // Le cas de loin le plus fréquent. Une liste vide, pas une liste de listes
    // vides : l'appelant boucle dessus sans avoir à filtrer.
    const plan = planVaultCatchUp(
      coffreRecouvrant,
      [intention({ excludedItemIds: [] })],
      coffreRecouvrant.map((i) => ({ itemId: i.id, granteeUserId: 'marie' }))
    );
    expect(plan).toEqual([]);
  });
});

describe('les bornes', () => {
  it('aucune intention → rien, sans même regarder les éléments', () => {
    expect(planVaultCatchUp(coffreRecouvrant, [], [])).toEqual([]);
  });

  it('la borne de date reste celle de CHAQUE intention', () => {
    // Deux partages faits à des moments différents : un fichier postérieur au
    // premier mais antérieur au second ne se rattrape que pour le premier.
    const entre = '2026-09-08T12:00:00.000Z';
    const plan = planVaultCatchUp(
      [item('neuf', 'Client Dupont', {}, entre)],
      [
        intention({ granteeUserId: 'marie', since: PARTAGE, excludedItemIds: [] }),
        intention({ granteeUserId: 'paul', since: APRES2, excludedItemIds: [] }),
      ],
      []
    );
    expect(plan).toEqual([{ granteeUserId: 'marie', itemIds: ['neuf'] }]);
  });
});
