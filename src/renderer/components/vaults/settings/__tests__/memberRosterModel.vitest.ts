import { describe, it, expect } from 'vitest';

/**
 * F09 — CHERCHER, FILTRER, TRIER, ET COCHER SANS SE TROMPER DE LIGNE.
 *
 * Le trombinoscope d'un coffre partagé finit par compter plus de monde qu'un
 * écran n'en montre, et les trois gestes qui suivent (changer le rôle, retirer,
 * vérifier une clé) portent sur des LIGNES : se tromper de ligne coûte une
 * rotation de clé ou un accès rendu à quelqu'un. Tout ce qui décide de quelles
 * lignes sont à l'écran, dans quel ordre, et lesquelles une case à cocher peut
 * atteindre vit donc ici, en fonctions pures — pas dans le composant, où ça ne
 * se vérifierait qu'à l'œil, une fois.
 *
 * DEUX RÈGLES SONT DES GARDE-FOUS, PAS DU CONFORT :
 *   - la case à cocher n'atteint JAMAIS le propriétaire ni soi-même — la barre
 *     flottante propose « Changer le rôle » et « Retirer », deux gestes que le
 *     serveur refuse sur ces deux lignes-là (et « Quitter » vit dans Danger,
 *     avec sa garde `last_owner`) ;
 *   - un geste de lot ne porte QUE sur ce qui est à l'écran : une ligne cachée
 *     par un filtre ne doit pas partir dans une rotation qu'on croyait viser
 *     trois personnes.
 *
 * ET « Hors de l'espace » NE SE DÉDUIT PAS D'UN SILENCE : `inSpace` absent (un
 * Worker d'avant P2) vaut « on ne sait pas », jamais « hors » — même règle que
 * `orphanedMembers`, pour la même raison (le geste qu'on propose derrière fait
 * tourner la clé du coffre).
 */

import {
  DEFAULT_ROSTER_SORT,
  applySelectionChange,
  isSelectable,
  rosterPlaceholderKey,
  rosterView,
  selectedRows,
  visibleSelection,
  type RosterFilterId,
} from '../memberRosterModel';
import type { VaultMemberRow } from '../vaultManagementModel';

/** Une ligne de trombinoscope telle que `buildMemberRows` la rend. */
function row(over: Partial<VaultMemberRow> & { userId: string }): VaultMemberRow {
  const role = over.role ?? 'member';
  const isSelf = over.isSelf ?? false;
  return {
    userId: over.userId,
    role,
    joinedAt: over.joinedAt ?? '2026-01-01T00:00:00.000Z',
    email: over.email,
    inSpace: over.inSpace,
    label: over.label ?? `${over.userId}@filarr.com`,
    isSelf,
    // Les capacités par défaut sont celles d'un ADMINISTRATEUR qui regarde :
    // c'est le seul rôle pour lequel la sélection existe.
    removable: over.removable ?? (!isSelf && role !== 'owner'),
    canChangeRole: over.canChangeRole ?? (!isSelf && role !== 'owner'),
    transferable: over.transferable ?? false,
  };
}

const ROSTER = [
  row({
    userId: 'anne',
    label: 'anne@filarr.com',
    role: 'owner',
    joinedAt: '2026-01-01T00:00:00Z',
  }),
  row({ userId: 'bob', label: 'Bob@Filarr.com', role: 'admin', joinedAt: '2026-03-04T00:00:00Z' }),
  row({
    userId: 'carl',
    label: 'carl@ailleurs.fr',
    role: 'member',
    joinedAt: '2026-02-02T00:00:00Z',
  }),
  row({
    userId: 'dora',
    label: 'dora@filarr.com',
    role: 'viewer',
    joinedAt: '2026-05-05T00:00:00Z',
  }),
  row({
    userId: 'moi',
    label: 'moi@filarr.com',
    role: 'admin',
    isSelf: true,
    joinedAt: '2026-01-02T00:00:00Z',
  }),
];

function view(over: {
  rows?: VaultMemberRow[];
  search?: string;
  filter?: RosterFilterId;
  sort?: { key: 'member' | 'role' | 'joined'; direction: 'asc' | 'desc' };
  keyChanged?: string[];
}) {
  return rosterView({
    rows: over.rows ?? ROSTER,
    query: {
      search: over.search ?? '',
      filter: over.filter ?? 'all',
      sort: over.sort ?? DEFAULT_ROSTER_SORT,
    },
    keyChanged: new Set(over.keyChanged ?? []),
  });
}

const ids = (r: VaultMemberRow[]) => r.map((m) => m.userId);

describe('la recherche vise une personne, pas un rôle', () => {
  it('ignore la casse — une adresse tapée en minuscules trouve « Bob@Filarr.com »', () => {
    expect(ids(view({ search: 'bob@filarr' }).rows)).toEqual(['bob']);
  });

  it('trouve aussi par identifiant : c’est ce que la colonne montre quand l’annuaire est fermé', () => {
    // Un invité n'a pas l'annuaire de l'espace : sa table affiche des
    // identifiants. Une recherche qui ne porterait que sur l'adresse ne
    // trouverait alors plus personne.
    expect(ids(view({ search: 'CARL' }).rows)).toEqual(['carl']);
  });

  it('un espace de trop ne fait pas disparaître tout le monde', () => {
    expect(ids(view({ search: '  dora  ' }).rows)).toEqual(['dora']);
  });

  it('une recherche vide rend tout le monde, et ne se dit pas « filtrée »', () => {
    const v = view({ search: '   ' });
    expect(v.rows).toHaveLength(ROSTER.length);
    expect(v.filtered).toBe(false);
    expect(v.hidden).toBe(0);
  });

  it('ne cherche PAS dans le rôle — sinon « member » sortirait la moitié du coffre', () => {
    expect(view({ search: 'admin' }).rows).toHaveLength(0);
  });

  it('dit combien de lignes sont cachées, pour que l’écran ne mente pas sur l’effectif', () => {
    const v = view({ search: 'filarr.com' });
    expect(v.total).toBe(5);
    expect(v.rows).toHaveLength(4); // carl@ailleurs.fr sort
    expect(v.hidden).toBe(1);
    expect(v.filtered).toBe(true);
  });
});

describe('les six filtres', () => {
  it('« Owner + admins » réunit les deux rangs qui gèrent', () => {
    expect(ids(view({ filter: 'admins' }).rows).sort()).toEqual(['anne', 'bob', 'moi']);
  });

  it('« Membres » ne montre QUE les membres, et « Lecteurs » que les lecteurs', () => {
    expect(ids(view({ filter: 'members' }).rows)).toEqual(['carl']);
    expect(ids(view({ filter: 'viewers' }).rows)).toEqual(['dora']);
  });

  it('« Hors de l’espace » n’affirme rien sur un `inSpace` ABSENT', () => {
    // Le garde-fou : un Worker d'avant P2 n'envoie pas le champ. Le déduire
    // ferait entrer dans la liste des gens parfaitement en règle — et le geste
    // proposé derrière fait tourner la clé du coffre.
    const rows = [
      row({ userId: 'sorti', inSpace: false }),
      row({ userId: 'inconnu' }), // `inSpace` absent
      row({ userId: 'present', inSpace: true }),
    ];
    expect(ids(view({ rows, filter: 'outOfSpace' }).rows)).toEqual(['sorti']);
  });

  it('« Clé changée » vient du contrôle des clés, pas d’un champ du serveur', () => {
    expect(ids(view({ filter: 'keyChanged', keyChanged: ['carl', 'dora'] }).rows).sort()).toEqual([
      'carl',
      'dora',
    ]);
    // Aucune alerte : la liste est vide, et c'est un état FILTRÉ (l'écran doit
    // dire « aucun résultat », pas « ce coffre n'a personne »).
    const vide = view({ filter: 'keyChanged' });
    expect(vide.rows).toHaveLength(0);
    expect(vide.filtered).toBe(true);
  });

  it('le filtre et la recherche se CUMULENT', () => {
    expect(ids(view({ filter: 'admins', search: 'bob' }).rows)).toEqual(['bob']);
  });
});

describe('le tri', () => {
  it('par adresse, dans les deux sens', () => {
    expect(ids(view({ sort: { key: 'member', direction: 'asc' } }).rows)).toEqual([
      'anne',
      'bob',
      'carl',
      'dora',
      'moi',
    ]);
    expect(ids(view({ sort: { key: 'member', direction: 'desc' } }).rows)).toEqual([
      'moi',
      'dora',
      'carl',
      'bob',
      'anne',
    ]);
  });

  it('par rôle, du plus fort au plus faible — pas dans l’ordre alphabétique', () => {
    // « admin » < « member » < « owner » < « viewer » en alphabétique : trier
    // les libellés donnerait un classement qui ne veut rien dire.
    const v = view({ sort: { key: 'role', direction: 'asc' } });
    expect(v.rows.map((r) => r.role)).toEqual(['owner', 'admin', 'admin', 'member', 'viewer']);
    // À rôle égal, l'adresse tranche : sans quoi l'ordre dépendrait de ce que
    // le serveur a renvoyé, et deux rendus successifs échangeraient deux lignes.
    expect(ids(v.rows)).toEqual(['anne', 'bob', 'moi', 'carl', 'dora']);
  });

  it('par date d’arrivée', () => {
    expect(ids(view({ sort: { key: 'joined', direction: 'asc' } }).rows)).toEqual([
      'anne',
      'moi',
      'carl',
      'bob',
      'dora',
    ]);
  });

  it('une date illisible finit DERNIÈRE, dans les deux sens', () => {
    // « on ne sait pas quand » n'est ni le plus ancien ni le plus récent :
    // le pousser en tête d'un tri croissant en ferait le doyen du coffre.
    const rows = [
      row({ userId: 'sans-date', joinedAt: '' }),
      row({ userId: 'vieux', joinedAt: '2020-01-01T00:00:00Z' }),
      row({ userId: 'recent', joinedAt: '2026-06-06T00:00:00Z' }),
    ];
    expect(ids(view({ rows, sort: { key: 'joined', direction: 'asc' } }).rows)).toEqual([
      'vieux',
      'recent',
      'sans-date',
    ]);
    expect(ids(view({ rows, sort: { key: 'joined', direction: 'desc' } }).rows)).toEqual([
      'recent',
      'vieux',
      'sans-date',
    ]);
  });

  it('ne modifie pas le tableau qu’on lui donne', () => {
    const rows = [row({ userId: 'b' }), row({ userId: 'a' })];
    view({ rows, sort: { key: 'member', direction: 'asc' } });
    expect(ids(rows)).toEqual(['b', 'a']);
  });
});

describe('ce qu’une case à cocher peut atteindre', () => {
  it('jamais le propriétaire, jamais soi-même', () => {
    const v = view({});
    expect(v.selectableIds.sort()).toEqual(['bob', 'carl', 'dora']);
    expect(isSelectable(ROSTER[0])).toBe(false); // anne, propriétaire
    expect(isSelectable(ROSTER[4])).toBe(false); // moi
  });

  it('rien du tout pour qui ne gère pas le coffre', () => {
    // Un lecteur reçoit des lignes sans capacité : la table lui montre le
    // trombinoscope, la sélection n'a aucun sens pour lui.
    const rows = ROSTER.map((r) => ({ ...r, removable: false, canChangeRole: false }));
    expect(view({ rows }).selectableIds).toEqual([]);
  });

  it('exige les DEUX capacités : la barre propose les deux gestes', () => {
    // Une ligne qu'on pourrait retirer mais dont on ne peut pas changer le rôle
    // (ou l'inverse) ferait échouer la moitié d'un lot, en silence.
    expect(isSelectable(row({ userId: 'x', removable: true, canChangeRole: false }))).toBe(false);
    expect(isSelectable(row({ userId: 'y', removable: false, canChangeRole: true }))).toBe(false);
  });
});

describe('un geste de lot ne porte que sur ce qui est à l’écran', () => {
  it('une ligne cachée par un filtre sort de la sélection', () => {
    const v = view({ filter: 'viewers' });
    // « carl » avait été coché avant que le filtre ne se pose.
    expect(visibleSelection(['carl', 'dora'], v)).toEqual(['dora']);
  });

  it('le propriétaire coché par « tout sélectionner » est écarté', () => {
    // La case d'en-tête de la `Table` coche TOUT ce qu'elle affiche, y compris
    // les lignes qu'aucun geste ne peut atteindre : c'est ici qu'on les retire.
    const v = view({});
    expect(visibleSelection(['anne', 'bob', 'moi', 'dora'], v).sort()).toEqual(['bob', 'dora']);
  });

  it('rend les lignes, dans l’ordre de l’écran, pour que la confirmation les nomme', () => {
    const v = view({ sort: { key: 'member', direction: 'asc' } });
    expect(ids(selectedRows(['dora', 'bob'], v))).toEqual(['bob', 'dora']);
  });

  it('la case d’en-tête finit par tout DÉCOCHER, même avec un propriétaire à l’écran', () => {
    // La `Table` ne se croit « tout cochée » que si la sélection couvre toutes
    // ses lignes — ce qui n'arrivera jamais, le propriétaire étant hors
    // d'atteinte. Sans cette lecture d'intention, le second clic sur la case
    // d'en-tête renvoie la totalité, qu'on refiltre en ce qui était déjà coché :
    // rien ne bouge, et la case paraît morte.
    const v = view({});
    const tout = ['anne', 'bob', 'carl', 'dora', 'moi'];
    const premier = applySelectionChange(tout, v, []);
    expect(premier.sort()).toEqual(['bob', 'carl', 'dora']);
    expect(applySelectionChange(tout, v, premier)).toEqual([]);
  });

  it('cocher une ligne de plus reste un ajout, jamais un « tout décocher »', () => {
    const v = view({});
    expect(applySelectionChange(['bob', 'carl'], v, ['bob']).sort()).toEqual(['bob', 'carl']);
  });

  it('cocher une ligne HORS D’ATTEINTE ne décoche pas le reste', () => {
    // La `Table` n'expose pas la provenance de sa sélection : un clic sur la
    // case du propriétaire envoie `[...selectedRows, 'anne']`, exactement la
    // forme d'un « tout sélectionner ». Le lire comme « tout décocher » ferait
    // perdre cinq cases sans un mot, juste avant « Retirer (5) » — c'est-à-dire
    // avant une rotation de clé.
    const v = view({});
    expect(applySelectionChange(['bob', 'carl', 'anne'], v, ['bob', 'carl']).sort()).toEqual([
      'bob',
      'carl',
    ]);
  });

  it('cocher MA propre ligne non plus — c’est le même clic, l’autre ligne interdite', () => {
    const v = view({});
    expect(applySelectionChange(['dora', 'moi'], v, ['dora'])).toEqual(['dora']);
  });

  it('… même quand ce clic fait un tableau de la TAILLE de l’écran', () => {
    // Trois lignes à l'écran (anne propriétaire, bob, carl), les deux
    // atteignables déjà cochées : le clic sur anne envoie trois identifiants,
    // exactement le compte de l'écran. Ce n'est PAS la case d'en-tête pour
    // autant — elle, elle émet l'écran dans SON ordre.
    const trois = [ROSTER[0], ROSTER[1], ROSTER[2]];
    const v = view({ rows: trois });
    expect(applySelectionChange(['bob', 'carl', 'anne'], v, ['bob', 'carl']).sort()).toEqual([
      'bob',
      'carl',
    ]);
    // Et la vraie case d'en-tête, elle, décoche toujours.
    expect(applySelectionChange(['anne', 'bob', 'carl'], v, ['bob', 'carl'])).toEqual([]);
  });

  it('un identifiant inconnu ne fabrique pas une ligne fantôme', () => {
    const v = view({});
    expect(selectedRows(['fantome'], v)).toEqual([]);
    expect(visibleSelection(['fantome'], v)).toEqual([]);
  });
});

/**
 * UNE SURFACE VIDE N'EST PAS UNE PHRASE — et trois vides différents encore
 * moins.
 *
 * LE DÉFAUT, VÉCU. Le `<Table>` du trombinoscope portait ses deux replis
 * (`loading` et `emptyMessage`) ; la bande compacte, elle, rendait
 * `<ul>{rows.map(…)}</ul>` sans aucun repli. Sous 840 px, un filtre qui ne
 * laisse rien, un chargement en cours et un coffre où l'on est seul donnaient
 * donc LA MÊME surface blanche, sans un mot. C'est le travers de tout ce dossier
 * — une absence rendue comme un fait — simplement déplacé de la phrase vers le
 * blanc.
 *
 * D'OÙ CETTE FONCTION, ET POURQUOI ELLE EST ICI. Les deux surfaces doivent dire
 * LA MÊME chose ; deux `if` recopiés dans deux composants divergent au premier
 * quatrième cas. Le modèle rend une CLÉ i18n : ni traduction ni composant, comme
 * le reste de ce fichier.
 */
describe('rosterPlaceholderKey — ce qu’un tableau vide a le droit de dire', () => {
  it('CHARGEMENT d’abord : on ne conclut rien tant qu’on n’a pas lu', () => {
    // La distinction qui compte : « on n'a pas encore la liste » n'est pas
    // « personne ne correspond », et surtout pas « vous êtes seul ».
    expect(rosterPlaceholderKey({ loading: true, filtered: false })).toBe('common.loading');
    expect(rosterPlaceholderKey({ loading: true, filtered: true })).toBe('common.loading');
  });

  it('un FILTRE qui ne laisse rien le dit — sinon on croit les gens partis', () => {
    expect(rosterPlaceholderKey({ loading: false, filtered: true })).toBe(
      'teamVaults.settings.roster.none'
    );
  });

  it('sans filtre et sans personne : on est seul dans le coffre, et c’est une invitation', () => {
    expect(rosterPlaceholderKey({ loading: false, filtered: false })).toBe(
      'teamVaults.settings.members.aloneHint'
    );
  });
});
