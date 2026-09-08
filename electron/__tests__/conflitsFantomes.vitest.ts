/**
 * UN CONFLIT SANS COPIE N'EST PAS UN CONFLIT — c'est un gel.
 *
 * ── CE QUI LES FABRIQUE ─────────────────────────────────────────────────────
 *
 * `handleConflict` copie le fichier divergent, PUIS marque l'entrée `conflict`.
 * Quand la copie échoue, son `catch` marque quand même. Le statut dit alors « un
 * humain doit choisir entre deux versions » alors qu'il n'en reste qu'une.
 *
 * Le cas s'est produit en masse : un `meta:<...>` porte un deux-points, que
 * Windows lit comme le séparateur d'un flux de données alternatif, et `mkdir`
 * échouait en ENOENT. Sur le profil observé le 2026-09-07 au soir : 24 entrées
 * en conflit, 29 répertoires de copie sur le disque, **aucun** pour une entrée
 * `meta:`. Vingt conflits fantômes.
 *
 * ── CE QUE ÇA COÛTE, ET CE N'EST PAS LA PASTILLE ────────────────────────────
 *
 * Le fusionneur SAUTE les entrées `conflict`. Ces vingt métadonnées de dossier
 * ne se synchronisaient donc plus : un renommage, une couleur, un rangement
 * faits sur un poste ne partaient plus. Gelées, sans rien à arbitrer, et sans
 * qu'aucun écran puisse les libérer.
 *
 * ── LA BORNE QUE CES TESTS DÉFENDENT ────────────────────────────────────────
 *
 * Libérer une entrée dont la copie EXISTE choisirait à la place de
 * l'utilisateur, en silence, entre deux versions qu'il a sous les yeux. C'est
 * le seul mode d'échec grave ici, et la moitié des cas ci-dessous porte dessus.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { conflictsSansCopie } from '../sync/syncService';

const FICHIER = 'a7fc2c0cd5b130f5837b88c709af29de';
const COPIE = `${FICHIER}_conflict_1788744226658`;

describe('CE QUI EST LIBÉRÉ', () => {
  it('une entrée en conflit dont aucune copie n’existe', () => {
    expect(conflictsSansCopie({ [FICHIER]: { status: 'conflict' } }, [])).toEqual([FICHIER]);
  });

  it('un `meta:` dont la copie n’a jamais pu être créée — le cas de masse', () => {
    /*
      `meta:X` produit une copie nommée `meta-X_conflict_<ts>` : le deux-points
      est assaini. La comparaison doit donc se faire sur le nom ASSAINI, sinon
      une entrée `meta:` ne reconnaîtrait jamais sa propre copie et on
      libérerait un conflit réel.
    */
    const files = { 'meta:17873575196651nzde91': { status: 'conflict' } };
    expect(conflictsSansCopie(files, [])).toEqual(['meta:17873575196651nzde91']);
  });

  it('une entrée dont SEULE la copie d’un AUTRE fichier existe', () => {
    const files = { [FICHIER]: { status: 'conflict' } };
    const repertoires = ['d56104d063c915bace3fadcee146adf1_conflict_1788696206004'];
    expect(conflictsSansCopie(files, repertoires)).toEqual([FICHIER]);
  });
});

describe('CE QUI NE DOIT JAMAIS ÊTRE LIBÉRÉ', () => {
  it('une entrée dont la copie EXISTE — l’utilisateur a deux versions', () => {
    // La libérer choisirait à sa place, silencieusement.
    expect(conflictsSansCopie({ [FICHIER]: { status: 'conflict' } }, [COPIE])).toEqual([]);
  });

  it('un `meta:` dont la copie assainie existe', () => {
    const files = { 'meta:abc': { status: 'conflict' } };
    expect(conflictsSansCopie(files, ['meta-abc_conflict_1788744226658'])).toEqual([]);
  });

  it('une entrée qui n’est PAS en conflit, quoi qu’il traîne sur le disque', () => {
    const files = {
      [FICHIER]: { status: 'synced' },
      autre: { status: 'pending_upload' },
      troisieme: { status: 'deleted' },
    };
    expect(conflictsSansCopie(files, [])).toEqual([]);
  });

  it('aucun conflit → aucun parcours, et une liste vide', () => {
    expect(conflictsSansCopie({}, ['nimporte_conflict_1788744226658'])).toEqual([]);
  });

  it('un répertoire qui ressemble sans être une copie ne compte PAS comme copie', () => {
    // `photos_conflict_final` n'a pas d'horodatage : ce n'est pas une copie, donc
    // il ne doit pas faire croire qu'un conflit est arbitrable.
    const files = { photos: { status: 'conflict' } };
    expect(conflictsSansCopie(files, ['photos_conflict_final'])).toEqual(['photos']);
  });
});

describe('LE BALAYAGE LIBÈRE VRAIMENT', () => {
  it('l’appel est dans `scanLocalFiles`, et rend l’entrée au fusionneur', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'sync', 'syncService.ts'), 'utf8');
    const debut = source.indexOf('async function scanLocalFiles(');
    expect(debut).toBeGreaterThan(0);
    const fin = source.indexOf('async function findFileOnDisk', debut);
    const corps = source.slice(debut, fin > 0 ? fin : undefined);
    expect(corps).toContain('conflictsSansCopie(localManifest.files, repertoires)');
    /*
      `synced` et RIEN D'AUTRE. `pending_upload` forcerait notre version sur le
      nuage sans comparer ; retirer l'entrée la ferait redescendre. Le seul
      statut honnête est celui qui ne décide pas — le fusionneur re-décide avec
      les empreintes, et refait un vrai conflit si les contenus divergent.
    */
    expect(corps).toContain("e.status = 'synced'");
  });
});
