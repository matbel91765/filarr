/**
 * UN RÉPERTOIRE DE SERVICE N'EST PAS UN DOSSIER DU COFFRE.
 *
 * Ce fichier existe à cause d'une perte de données réelle. Le recensement des
 * dossiers lisait TOUS les sous-répertoires du profil, et `getFolder` sur un
 * répertoire sans métadonnées lui en ÉCRIVAIT. Résultat : `note-versions`
 * apparaissait dans le coffre sous le nom « Folder note-versions ». On le
 * prenait pour un résidu, on le mettait à la corbeille, on vidait la corbeille
 * — et tout l'historique des versions de notes partait avec.
 *
 * Le piège est que rien ne le signalait : la suppression réussissait, et seul
 * un `EPERM` sur un fichier encore ouvert a fini par le faire remonter dans le
 * journal.
 *
 * Ces cas gèlent le seul remède qui tienne : le nom du répertoire d'un service
 * et la liste des noms réservés viennent de la MÊME source. Un service qui
 * définirait son nom dans son coin retomberait dans le piège sans un bruit.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  REPERTOIRES_RESERVES,
  DIR_VERSIONS_NOTES,
  DIR_VERSIONS_FICHIERS,
  estRepertoireReserve,
  estCopieDeConflit,
  nomDeCopieDeConflit,
} from '../profileDirs';

describe('la liste des répertoires réservés', () => {
  it('couvre les deux services de versions', () => {
    expect(estRepertoireReserve(DIR_VERSIONS_NOTES)).toBe(true);
    expect(estRepertoireReserve(DIR_VERSIONS_FICHIERS)).toBe(true);
  });

  it('ne réserve PAS un identifiant de dossier ordinaire', () => {
    // Les dossiers du coffre sont nommés par un identifiant engendré. Réserver
    // trop large les ferait disparaître du coffre — la faute symétrique, et
    // bien pire.
    expect(estRepertoireReserve('17741303646699kxl99l')).toBe(false);
    expect(estRepertoireReserve('a5bec72c-2e8d-4a34-bd2e-2b6bc539e000')).toBe(false);
    expect(estRepertoireReserve('')).toBe(false);
  });
});

describe('les services tirent leur nom de la liste', () => {
  /**
   * Une lecture de la SOURCE, pas de l'exécution : importer ces services
   * entraînerait Electron et le disque. Ce qu'on veut prouver est de toute
   * façon structurel — le nom ne doit pas être écrit en dur.
   */
  const lire = (nom: string) =>
    fs.readFileSync(path.join(__dirname, '..', nom), 'utf8');

  it('fileVersionService ne code PAS son nom de répertoire en dur', () => {
    const source = lire('fileVersionService.ts');
    expect(source).toContain('DIR_VERSIONS_FICHIERS');
    expect(source).not.toContain("VERSIONS_DIRNAME = 'file-versions'");
  });

  it('noteVersionService ne code PAS son nom de répertoire en dur', () => {
    const source = lire('noteVersionService.ts');
    expect(source).toContain('DIR_VERSIONS_NOTES');
    expect(source).not.toContain("VERSIONS_DIRNAME = 'note-versions'");
  });

  it('le recensement des dossiers consulte la liste', () => {
    // La garde la plus importante : sans ce filtre, tout le reste est inutile.
    const source = lire('storageService.ts');
    // Le PRÉDICAT, pas l'ensemble : une copie de conflit porte un horodatage et
    // ne peut pas figurer dans une liste de noms fixes. Consulter l'ensemble
    // directement, c'est reproduire le trou qu'on vient de fermer.
    expect(source).toContain('estRepertoireReserve');
    expect(source).not.toContain('REPERTOIRES_RESERVES.has');
    // Et `getFolder` doit REFUSER, sans quoi il écrirait des métadonnées dans
    // le répertoire de service — l'adoption qui a tout déclenché.
    expect(source).toMatch(/estRepertoireReserve\(id\.toString\(\)\)/);
  });

  it('CHAQUE recensement filtre, pas seulement le premier', () => {
    // getAllFolders filtrait, getAllFoldersIncludingDeleted non : la garde de
    // getFolder levait alors a chaque tour de rappel, une trace par service.
    const source = lire('storageService.ts');
    const recensements = source.match(/const dirIds = dirChecks\.filter\(/g) ?? [];
    const filtres = source.match(/!estRepertoireReserve\(id\)/g) ?? [];
    expect(recensements.length).toBeGreaterThan(0);
    expect(filtres.length).toBe(recensements.length);
  });
});

describe('UNE COPIE DE CONFLIT N’EST PAS UN DOSSIER', () => {
  /*
    LE MÊME DÉFAUT QUE `note-versions`, ET LA LISTE NE POUVAIT PAS L’ATTRAPER.

    `handleConflict` fabrique `<fileId>_conflict_<horodatage>`. Le nom porte un
    horodatage : il ne peut pas figurer dans une liste de noms fixes. C’est
    exactement pourquoi le garde-fou posé pour les répertoires de versions l’a
    laissé passer, et pourquoi celui-ci est un MOTIF.

    Observé en production le 2026-09-07 : vingt-quatre de ces répertoires,
    chacun devenu un dossier « Folder a7fc2c0c…_conflict_1788744226658 » par la
    branche ENOENT de `getFolder` — une lecture qui écrit — puis synchronisé.
    Le fichier en conflit faisait 1,28 Go, et chaque copie prenait un `fileId`
    neuf : 2,7 Go téléversés pour un seul fichier.
  */
  it('reconnaît la forme exacte que `handleConflict` fabrique', () => {
    expect(estCopieDeConflit('a7fc2c0cd5b130f5837b88c709af29de_conflict_1788744226658')).toBe(true);
    expect(estRepertoireReserve('a7fc2c0cd5b130f5837b88c709af29de_conflict_1788744226658')).toBe(
      true
    );
  });

  it('N’ATTRAPE PAS un dossier que l’utilisateur aurait nommé ainsi', () => {
    /*
      LA FAUTE SYMÉTRIQUE, ET ELLE EST PIRE. Réserver trop large ferait
      DISPARAÎTRE un dossier du coffre — et `getFolder` refuserait de le lire.
      Le motif exige donc les chiffres d’un horodatage à la fin du nom.
    */
    for (const nom of [
      'photos_conflict_final',
      'conflict_1788744226658',
      'a7fc2c0c_conflict_',
      'a7fc2c0c_conflict_123',
      'a7fc2c0c_conflict_1788744226658_ancien',
      '17741303646699kxl99l',
    ]) {
      expect(estCopieDeConflit(nom), nom).toBe(false);
    }
  });

  it('le balayage de synchro la saute AUSSI', () => {
    /*
      Les deux moitiés sont nécessaires et ferment des choses différentes :
      `getFolders` empêche le dossier fantôme d’APPARAÎTRE, le balayage empêche
      la copie de PARTIR dans le nuage et de se propager aux autres postes.
      L’une sans l’autre laisse la moitié du dégât.
    */
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sync', 'syncService.ts'),
      'utf8'
    );
    const debut = source.indexOf('async function scanLocalFiles(');
    expect(debut).toBeGreaterThan(0);
    const fin = source.indexOf('async function findFileOnDisk', debut);
    expect(source.slice(debut, fin > 0 ? fin : undefined)).toContain('estCopieDeConflit(');
  });

  it('la copie ne charge PAS le fichier en mémoire', () => {
    // 1,28 Go dans le tas du processus principal — celui qui tient
    // l'interface — à chaque copie, six fois pendant la boucle.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sync', 'syncService.ts'),
      'utf8'
    );
    const debut = source.indexOf('async function handleConflict(');
    expect(debut).toBeGreaterThan(0);
    const corps = source.slice(debut, source.indexOf('export async function resolveConflict', debut));
    expect(corps).toContain('fs.copyFile(');
    expect(corps).not.toContain('fs.readFile(filePath)');
  });
});

describe('LE NOM DU RÉPERTOIRE DE CONFLIT', () => {
  /*
    LES DEUX-POINTS SONT INTERDITS SOUS WINDOWS.

    Une entrée de métadonnées s'appelle `meta:<quelque chose>`. Telle quelle,
    Windows lit le `:` comme le séparateur d'un flux de données alternatif et
    `mkdir` échoue en ENOENT. Onze fois dans les journaux du 2026-09-07 — et
    l'échec n'est pas anodin : `handleConflict` retombe dans son `catch`, qui
    marque quand même l'entrée `conflict` SANS copie. Le fichier divergent
    n'est alors nulle part, et l'entrée reste bloquée à jamais.
  */
  it('remplace le deux-points d’un identifiant `meta:`', () => {
    const nom = nomDeCopieDeConflit('meta:17873575196651nzde91', 1788765493429);
    expect(nom).toBe('meta-17873575196651nzde91_conflict_1788765493429');
    expect(nom).not.toContain(':');
  });

  it('neutralise TOUT ce que Windows refuse, séparateurs compris', () => {
    // Un identifiant HÉRITÉ contient une barre oblique : sans ça, `mkdir`
    // fabriquerait une arborescence au lieu d'un répertoire.
    const nom = nomDeCopieDeConflit('dossier/rapport<v2>.pdf', 1788765493429);
    expect(nom).toBe('dossier-rapport-v2-.pdf_conflict_1788765493429');
    const interdits = [':', '<', '>', '"', '/', '|', '?', '*', String.fromCharCode(92)];
    for (const c of interdits) {
      expect(nom.includes(c), c).toBe(false);
    }
  });

  it('ce qu’il fabrique est reconnu comme une copie de conflit', () => {
    // Les deux moitiés doivent rester d'accord : un nom que l'une produit et
    // que l'autre ne reconnaît pas ferait réapparaître le dossier fantôme.
    for (const id of ['meta:abc', 'a7fc2c0cd5b130f5837b88c709af29de', 'dossier/x.pdf']) {
      expect(estCopieDeConflit(nomDeCopieDeConflit(id, Date.now())), id).toBe(true);
      expect(estRepertoireReserve(nomDeCopieDeConflit(id, Date.now())), id).toBe(true);
    }
  });

  it('`handleConflict` passe par cette fonction, pas par un gabarit à lui', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'sync', 'syncService.ts'),
      'utf8'
    );
    expect(source).toContain('nomDeCopieDeConflit(fileId, timestamp)');
    // Le gabarit d'origine ne doit plus exister nulle part : c'est lui qui
    // laissait passer le deux-points.
    expect(source).not.toContain('`${fileId}_conflict_${timestamp}`');
  });
});
