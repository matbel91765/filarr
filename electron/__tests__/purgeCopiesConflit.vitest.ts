/**
 * LES COPIES DE CONFLIT DÉJÀ PUBLIÉES SORTENT DU NUAGE — ET RIEN D'AUTRE.
 *
 * ── L'INTERBLOCAGE QUE CECI FERME ───────────────────────────────────────────
 *
 * Le matin du 2026-09-07, le balayage a cessé de prendre les répertoires
 * `<fileId>_conflict_<horodatage>` pour des dossiers du coffre. J'avais écrit
 * que les entrées DÉJÀ publiées « se périmeraient simplement ». C'était faux :
 * elles restent `synced`, le fusionneur les voit `local: synced / remote: NONE`
 * et les reprogramme en téléversement à CHAQUE cycle.
 *
 * Le soir même, sur le profil observé : 28 fichiers renvoyés par tour, dont
 * TROIS copies d'un fichier de 1,28 Go re-découpées en blocs à chaque fois. Le
 * cycle durait une minute ; l'autre appareil publiait deux fois pendant ce
 * temps ; le compare-and-set du manifeste était donc refusé — « Manifest
 * conflict during upload » — et le cycle suivant, aussi long, reperdait.
 * Interblocage vivant : deux postes qui travaillent sans fin sans converger.
 *
 * ── CE QUE CES TESTS DÉFENDENT ──────────────────────────────────────────────
 *
 * Une fonction qui rend TROP d'identifiants efface des données de l'utilisateur
 * dans le nuage. C'est le seul mode d'échec qui compte ici, et l'essentiel des
 * cas ci-dessous porte sur ce qu'elle doit REFUSER de désigner.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { conflictCopyEntriesToPurge } from '../sync/syncService';

const CONFLIT = 'a7fc2c0cd5b130f5837b88c709af29de_conflict_1788744226658';

describe('CE QUI DOIT ÊTRE PURGÉ', () => {
  it('les métadonnées inventées pour le répertoire', () => {
    // `getFolder` les avait écrites en prenant le répertoire pour un dossier.
    expect(conflictCopyEntriesToPurge({ [`meta:${CONFLIT}`]: {} })).toEqual([`meta:${CONFLIT}`]);
  });

  it('la copie elle-même, reconnue par son CHEMIN', () => {
    // Son identifiant est une empreinte : rien dans le nom ne trahit sa nature.
    // Seul le chemin local dit qu'elle vit sous un répertoire de conflit.
    const files = { abc123: { localPath: `${CONFLIT}/${CONFLIT}.bin` } };
    expect(conflictCopyEntriesToPurge(files)).toEqual(['abc123']);
  });

  it('les DEUX à la fois — n’en traiter qu’une laisserait l’autre boucler', () => {
    const files = {
      [`meta:${CONFLIT}`]: {},
      abc123: { localPath: `${CONFLIT}/${CONFLIT}.bin` },
    };
    expect(conflictCopyEntriesToPurge(files).sort()).toEqual(['abc123', `meta:${CONFLIT}`]);
  });
});

describe('CE QUI NE DOIT JAMAIS ÊTRE PURGÉ', () => {
  /*
    LA MOITIÉ QUI COMPTE. Trop désigner efface des données dans le nuage —
    et la suppression, elle, se propage à tous les appareils.
  */
  it('un dossier ordinaire et ses fichiers', () => {
    const files = {
      'meta:17741303646699kxl99l': {},
      def456: { localPath: '17741303646699kxl99l/rapport.pdf' },
      'meta:notes': {},
      'meta:layout': {},
      'meta:a5bec72c-2e8d-4a34-bd2e-2b6bc539e000': {},
    };
    expect(conflictCopyEntriesToPurge(files)).toEqual([]);
  });

  it('un dossier que l’utilisateur aurait nommé « …_conflict_… » sans horodatage', () => {
    // Le motif exige les chiffres d'un horodatage : « photos_conflict_final »
    // est un dossier comme un autre, et l'effacer serait une perte de données.
    const files = {
      'meta:photos_conflict_final': {},
      ghi: { localPath: 'photos_conflict_final/photo.jpg' },
    };
    expect(conflictCopyEntriesToPurge(files)).toEqual([]);
  });

  it('les répertoires de SERVICE, qui ne sont pas des copies de conflit', () => {
    // Ils ont leur propre défaut (des métadonnées inventées, elles aussi) mais
    // ce n'est pas à cette fonction de le traiter : `note-versions` porte
    // l'historique, et le purger le détruirait dans le nuage.
    const files = { 'meta:note-versions': {}, 'meta:file-versions': {} };
    expect(conflictCopyEntriesToPurge(files)).toEqual([]);
  });

  it('une entrée DÉJÀ en suppression — ne pas la reprogrammer', () => {
    const files = { [`meta:${CONFLIT}`]: { status: 'deleted' } };
    expect(conflictCopyEntriesToPurge(files)).toEqual([]);
  });

  it('une entrée sans chemin local ne se devine pas', () => {
    // Sans `localPath`, rien ne dit d'où elle vient. On s'abstient.
    expect(conflictCopyEntriesToPurge({ jkl: {} })).toEqual([]);
  });

  it('un chemin qui CONTIENT le motif ailleurs qu’en tête', () => {
    // Seul le PREMIER segment est le répertoire de la racine du profil.
    const files = { mno: { localPath: `dossier/${CONFLIT}/x.bin` } };
    expect(conflictCopyEntriesToPurge(files)).toEqual([]);
  });
});

describe('LE BALAYAGE APPELLE BIEN LA PURGE', () => {
  it('l’appel est DANS `scanLocalFiles`, et marque `deleted`', () => {
    /*
      Une décision juste que personne n'appelle ne protège rien — deux gardes
      de ce dépôt sont restées vertes aujourd'hui pendant que le vrai chemin
      régressait.
    */
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sync', 'syncService.ts'),
      'utf8'
    );
    const debut = source.indexOf('async function scanLocalFiles(');
    expect(debut).toBeGreaterThan(0);
    const fin = source.indexOf('async function findFileOnDisk', debut);
    const corps = source.slice(debut, fin > 0 ? fin : undefined);
    expect(corps).toContain('conflictCopyEntriesToPurge(localManifest.files)');
    // `deleted` et non un retrait local : un retrait ferait REDESCENDRE
    // l'entrée au tour suivant, et le répertoire se recréerait sur le disque.
    expect(corps).toContain("e.status = 'deleted'");
    expect(corps).toContain('manifest.markDeleted(profileId, fileId)');
  });

  it('la purge ne touche à AUCUN fichier du disque', () => {
    // Le fichier reste là où son propriétaire peut l'arbitrer. La fonction est
    // pure et l'appel ne fait qu'écrire un statut.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sync', 'syncService.ts'),
      'utf8'
    );
    const debut = source.indexOf('export function conflictCopyEntriesToPurge(');
    expect(debut).toBeGreaterThan(0);
    const corps = source.slice(debut, source.indexOf('async function scanLocalFiles(', debut));
    expect(corps).not.toContain('fs.');
    expect(corps).not.toContain('unlink');
    expect(corps).not.toContain('rm(');
  });
});
